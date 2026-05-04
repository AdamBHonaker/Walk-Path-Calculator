"""
Street-network walking time calculator using igraph + scipy.

The pedestrian street graph is loaded from the pre-built igraph artifact
(street_graph_igraph.pkl) produced by fetch_street_graph.py in CTA-Transit-PWA,
or falls back to parsing street_graph.graphml via igraph directly.

Walking speed assumption: 3 mph (1.34 m/s) — a comfortable pedestrian pace.
"""

import logging
import math
import pickle
import threading
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

import igraph as ig
import numpy as np
from scipy.spatial import cKDTree

from utils import haversine_miles as _haversine_miles, WALKING_SPEED_MPH

GRAPH_PATH  = Path(__file__).parent / "street_graph.graphml"
IGRAPH_PATH = Path(__file__).parent / "street_graph_igraph.pkl"

WALKING_SPEED_MPS = WALKING_SPEED_MPH * 1609.34 / 3600  # mph → metres per second ≈ 1.34 m/s

_LONG_BLOCK_METERS    = 201.17   # 1/8 mile = 660 ft — N-S numbered-address axis
_SHORT_BLOCK_METERS   = 100.58   # 1/16 mile = 330 ft — E-W cross streets
_BLOCK_TYPE_THRESHOLD = 150.0    # midpoint; ≥ threshold → long block

_DIRECTION_FULL = {
    "N":  "North",     "NE": "Northeast", "E":  "East",      "SE": "Southeast",
    "S":  "South",     "SW": "Southwest", "W":  "West",      "NW": "Northwest",
}

_SERVICE_HIGHWAY_TYPES = {"service", "alley"}

FLAVORS: tuple[str, ...] = ("fastest", "fewest_turns", "greenest")
DEFAULT_FLAVOR = "fastest"

# Per-edge fixed penalty for "fewest_turns" — adds a constant cost to every
# edge so routes with many short connector segments (which imply more turns)
# are penalized vs. routes that ride a few long edges. igraph cannot express
# true edge-pair turn penalties without an edge-expanded graph, and this
# approximation captures most of the effect at zero preprocessing cost.
_TURN_PENALTY_M = 30.0

# Highway tags that route as "greener" (off-street paths, plazas, trails).
# Note: park polygons are out of scope for v1 — see docs/FEATURE_HISTORY.md.
_GREEN_HIGHWAYS = {"footway", "path", "cycleway", "pedestrian", "track"}
_GREEN_DISCOUNT = 0.6


def _highway_path_type(highway: str, footway: str) -> str:
    """Map OSM highway/footway tags to a human-readable path type label."""
    if footway == "crossing" or highway == "crossing":
        return "crosswalk"
    if highway == "steps":
        return "steps"
    if highway == "pedestrian":
        return "pedestrian plaza"
    if highway == "cycleway":
        return "bike path"
    if highway == "track":
        return "trail"
    if highway in ("footway", "path"):
        return highway
    return "path"


_graph_lock: threading.Lock = threading.Lock()
_graph_cache: "ig.Graph | None" = None
_coord_kdtree: "cKDTree | None" = None
_vertex_lats: "np.ndarray | None" = None
_vertex_lons: "np.ndarray | None" = None
_kdtree_to_vertex: "np.ndarray | None" = None
_graph_load_failed: bool = False
_flavor_weights: dict[str, list[float]] = {}


def _parse_geometry_inplace(G: ig.Graph) -> None:
    """Convert geometry WKT strings to coordinate lists [(lon, lat), ...] in-place."""
    try:
        from shapely import wkt as shapely_wkt
        for e in G.es:
            geom = e["geometry"]
            if isinstance(geom, str) and geom:
                try:
                    e["geometry"] = list(shapely_wkt.loads(geom).coords)
                except Exception as exc:
                    logger.debug("Could not parse geometry for edge %s: %s", e.index, exc)
                    e["geometry"] = None
            elif not geom:
                e["geometry"] = None
    except ImportError:
        for e in G.es:
            e["geometry"] = None


def _load_graph() -> "ig.Graph | None":
    """Load street graph once; returns None (and never retries) if unavailable."""
    global _graph_cache, _coord_kdtree, _vertex_lats, _vertex_lons, _kdtree_to_vertex, _graph_load_failed

    if _graph_cache is not None:
        return _graph_cache
    if _graph_load_failed:
        return None

    with _graph_lock:
        if _graph_cache is not None:
            return _graph_cache
        if _graph_load_failed:
            return None

        G: "ig.Graph | None" = None

        if IGRAPH_PATH.exists():
            logger.info("Loading igraph artifact from %s ...", IGRAPH_PATH)
            try:
                with open(IGRAPH_PATH, "rb") as f:
                    data = pickle.load(f)
                G = data["graph"]
                logger.info("igraph loaded: %s vertices, %s edges", f"{G.vcount():,}", f"{G.ecount():,}")
            except (pickle.UnpicklingError, OSError, ValueError, KeyError) as e:
                logger.warning("igraph pickle failed (%s: %s) — trying graphml fallback", type(e).__name__, e)
                G = None

        if G is None:
            if not GRAPH_PATH.exists():
                logger.error("Street graph not found at %s — walking will use Haversine fallback.", GRAPH_PATH)
                _graph_load_failed = True
                return None
            logger.info("Loading street graph from %s ...", GRAPH_PATH)
            try:
                G = ig.Graph.Read_GraphML(str(GRAPH_PATH))
                # osmnx GraphML stores all attributes as strings; convert length to float
                # so igraph's Dijkstra receives numeric weights instead of failing silently.
                for e in G.es:
                    try:
                        e["length"] = float(e["length"]) if e["length"] else 0.0
                    except (TypeError, ValueError):
                        e["length"] = 0.0
                _parse_geometry_inplace(G)
                logger.info("igraph loaded: %s vertices, %s edges", f"{G.vcount():,}", f"{G.ecount():,}")
            except (OSError, ValueError, ig.InternalError) as e:
                logger.error("Failed to load street graph (%s: %s) — walking will use Haversine fallback.", type(e).__name__, e)
                _graph_load_failed = True
                return None

        if "highway" in G.es.attributes():
            to_delete = [
                e.index for e in G.es
                if (e["highway"] or "") in _SERVICE_HIGHWAY_TYPES
            ]
            if to_delete:
                G.delete_edges(to_delete)
                logger.info("Filtered %s service/alley edges", f"{len(to_delete):,}")

        lons = np.array([v["x"] for v in G.vs], dtype=np.float64)
        lats = np.array([v["y"] for v in G.vs], dtype=np.float64)
        _vertex_lats = lats
        _vertex_lons = lons

        # Snap only to vertices in the largest weakly-connected component so
        # geocoded coordinates can't latch onto isolated pockets (e.g. parking
        # lot interiors orphaned by the service/alley filter), which would
        # cause Dijkstra to fail with "couldn't reach some vertices".
        components = G.connected_components(mode="weak")
        sizes = components.sizes()
        biggest = sizes.index(max(sizes))
        membership = components.membership
        valid_idx = np.where(np.array(membership) == biggest)[0].astype(np.int64)
        orphans = G.vcount() - len(valid_idx)
        if orphans:
            logger.warning("Snapping restricted to giant component (%s of %s vertices, %s orphans excluded)", f"{len(valid_idx):,}", f"{G.vcount():,}", f"{orphans:,}")
        _kdtree_to_vertex = valid_idx
        _coord_kdtree = cKDTree(np.column_stack([lons[valid_idx], lats[valid_idx]]))
        _graph_cache = G

    return _graph_cache


@lru_cache(maxsize=2048)
def _get_nearest_node_quantized(lat_q: int, lon_q: int) -> "int | None":
    if _load_graph() is None:
        return None
    try:
        _, idx = _coord_kdtree.query([lon_q / 1e5, lat_q / 1e5])
        return int(_kdtree_to_vertex[idx])
    except Exception:
        return None


def _get_nearest_node(lat: float, lon: float) -> "int | None":
    """Return the nearest igraph vertex index for a lat/lon coordinate; None if graph unavailable.

    Coordinates are quantized to ~1m (5 decimal places) before cache lookup so attackers
    cannot defeat the cache by jittering inputs.
    """
    return _get_nearest_node_quantized(round(lat * 1e5), round(lon * 1e5))


def _edge_attr(attrs: dict, key: str) -> str:
    val = attrs.get(key) or ""
    if isinstance(val, list):
        val = val[0] if val else ""
    return val


def _build_flavor_weights(G: "ig.Graph", flavor: str) -> "list[float] | str":
    """Return the weight vector (or attribute name) used for Dijkstra under `flavor`."""
    if flavor == "fastest":
        return "length"

    weights: list[float] = []
    if flavor == "fewest_turns":
        for e in G.es:
            weights.append((e["length"] or 0.0) + _TURN_PENALTY_M)
        return weights
    if flavor == "greenest":
        has_highway = "highway" in G.es.attributes()
        for e in G.es:
            length = e["length"] or 0.0
            hw = _edge_attr(e.attributes(), "highway") if has_highway else ""
            weights.append(length * _GREEN_DISCOUNT if hw in _GREEN_HIGHWAYS else length)
        return weights

    return "length"


def _get_flavor_weights(flavor: str) -> "list[float] | str":
    G = _load_graph()
    if G is None or flavor == "fastest":
        return "length"
    cached = _flavor_weights.get(flavor)
    if cached is not None and len(cached) == G.ecount():
        return cached
    weights = _build_flavor_weights(G, flavor)
    if isinstance(weights, list):
        _flavor_weights[flavor] = weights
    return weights


@lru_cache(maxsize=1536)
def _get_shortest_path_by_node(
    orig_idx: int,
    dest_idx: int,
    flavor: str = DEFAULT_FLAVOR,
) -> "tuple[tuple[int, ...], tuple[int, ...]] | None":
    G = _load_graph()
    if G is None:
        return None
    weights = _get_flavor_weights(flavor)
    try:
        result = G.get_shortest_paths(orig_idx, to=dest_idx, weights=weights, output="epath")
        if not result or not result[0]:
            return None
        epath = result[0]
        vpath = [orig_idx]
        for eid in epath:
            e = G.es[eid]
            nxt = e.target if e.source == vpath[-1] else e.source
            vpath.append(nxt)
        return (tuple(vpath), tuple(epath))
    except Exception:
        return None


def _get_shortest_path(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> "tuple[tuple[int, ...], tuple[int, ...]] | None":
    """
    Compute and cache the shortest path between two lat/lon coordinates.

    Resolves each endpoint to a quantized graph vertex, then defers to a
    vertex-keyed LRU cache so jittered coordinates that snap to the same
    vertices share a single Dijkstra result.
    """
    if _load_graph() is None:
        return None
    orig_idx = _get_nearest_node(origin_lat, origin_lon)
    dest_idx = _get_nearest_node(dest_lat, dest_lon)
    if orig_idx is None or dest_idx is None:
        return None
    return _get_shortest_path_by_node(orig_idx, dest_idx, flavor)


def _haversine_walk_minutes(
    lat1: float, lon1: float, lat2: float, lon2: float
) -> float:
    """Straight-line walking time estimate — used as fallback only."""
    return round(_haversine_miles(lat1, lon1, lat2, lon2) / WALKING_SPEED_MPH * 60, 1)


# ---------------------------------------------------------------------------
# Private build helpers — not cached; called exactly once per _compute_route miss
# ---------------------------------------------------------------------------

def _build_minutes(
    origin_lat: float, origin_lon: float, dest_lat: float, dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> float:
    try:
        G = _load_graph()
        if G is None:
            raise RuntimeError("street graph unavailable")
        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon, flavor)
        if path is None:
            raise RuntimeError("path unavailable")
        _, epath = path
        length_m = sum(G.es[e]["length"] or 0.0 for e in epath)
        return round(length_m / WALKING_SPEED_MPS / 60, 1)
    except Exception as e:
        logger.warning("walk_minutes fallback: %s: %s", type(e).__name__, e)
        return _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon)


def _build_directions(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> tuple:
    def _cardinal(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        deg = math.degrees(math.atan2(dlon, dlat)) % 360
        dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        return dirs[round(deg / 45) % 8]

    def _street_name(attrs: dict) -> str:
        return _edge_attr(attrs, "name").strip()

    def _edge_path_type(attrs: dict) -> str:
        return _highway_path_type(_edge_attr(attrs, "highway"), _edge_attr(attrs, "footway"))

    try:
        G = _load_graph()
        if G is None:
            raise RuntimeError("street graph unavailable")

        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon, flavor)
        if path is None:
            raise RuntimeError("path unavailable")

        vpath, epath = path

        if len(vpath) < 2:
            return ()

        raw: list[tuple[str, str, float, int, int]] = []
        for eid, u, v in zip(epath, vpath, vpath[1:]):
            edge = G.es[eid]
            attrs = edge.attributes()
            name = _street_name(attrs)
            path_type = _edge_path_type(attrs) if not name else ""
            raw.append((name, path_type, edge["length"] or 0.0, u, v))

        steps: list[dict] = []
        i = 0
        while i < len(raw):
            name, path_type = raw[i][0], raw[i][1]
            total_length = 0.0
            edge_count   = 0
            start_vertex = raw[i][3]
            end_vertex   = raw[i][4]
            while i < len(raw) and raw[i][0] == name and raw[i][1] == path_type:
                total_length += raw[i][2]
                edge_count   += 1
                end_vertex = raw[i][4]
                i += 1
            lat1 = _vertex_lats[start_vertex]
            lon1 = _vertex_lons[start_vertex]
            lat2 = _vertex_lats[end_vertex]
            lon2 = _vertex_lons[end_vertex]
            minutes = round(total_length / WALKING_SPEED_MPS / 60, 1)
            direction_abbrev = _cardinal(lat1, lon1, lat2, lon2)
            avg_edge_m = total_length / edge_count
            is_long    = avg_edge_m >= _BLOCK_TYPE_THRESHOLD
            block_m    = _LONG_BLOCK_METERS if is_long else _SHORT_BLOCK_METERS
            blocks     = max(0.5, round(total_length / block_m * 2) / 2)
            block_type = "long" if is_long else "short"
            steps.append({
                "street":         name,
                "path_type":      path_type,
                "direction":      direction_abbrev,
                "direction_full": _DIRECTION_FULL.get(direction_abbrev, direction_abbrev),
                "blocks":         blocks,
                "block_type":     block_type,
                "minutes":        minutes,
                "distance_meters": round(total_length, 1),
            })
        return tuple(steps)

    except Exception as e:
        logger.warning("walk_directions fallback: %s: %s", type(e).__name__, e)
        total_min = _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon)
        fallback_meters = total_min * 60 * WALKING_SPEED_MPS
        fallback_blocks = max(0.5, round(fallback_meters / _LONG_BLOCK_METERS * 2) / 2)
        return ({"street": "Walk", "direction": "", "direction_full": "", "blocks": fallback_blocks,
                 "block_type": "long", "minutes": total_min, "distance_meters": round(fallback_meters, 1)},)


def _build_path(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> tuple:
    try:
        G = _load_graph()
        if G is None:
            raise RuntimeError("street graph unavailable")

        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon, flavor)
        if path is None:
            raise RuntimeError("path unavailable")

        vpath, epath = path

        if len(vpath) < 2:
            return ((origin_lat, origin_lon), (dest_lat, dest_lon))

        result_coords: list[tuple[float, float]] = []

        for eid, u, v in zip(epath, vpath, vpath[1:]):
            geom_coords = G.es[eid]["geometry"]

            if geom_coords:
                u_lon = _vertex_lons[u]
                u_lat = _vertex_lats[u]
                du_start = (geom_coords[0][0] - u_lon)**2 + (geom_coords[0][1] - u_lat)**2
                du_end   = (geom_coords[-1][0] - u_lon)**2 + (geom_coords[-1][1] - u_lat)**2
                if du_start > du_end:
                    geom_coords = geom_coords[::-1]
                first = (geom_coords[0][1], geom_coords[0][0])
                last  = result_coords[-1] if result_coords else None
                start = 1 if last and abs(first[0] - last[0]) < 1e-9 and abs(first[1] - last[1]) < 1e-9 else 0
                for lon, lat in geom_coords[start:]:
                    result_coords.append((lat, lon))
            else:
                if not result_coords:
                    result_coords.append((_vertex_lats[u], _vertex_lons[u]))
                result_coords.append((_vertex_lats[v], _vertex_lons[v]))

        return tuple(result_coords)

    except Exception as e:
        logger.error("routing failed: %s: %s", type(e).__name__, e)
        return ((origin_lat, origin_lon), (dest_lat, dest_lon))


# ---------------------------------------------------------------------------
# Single shared cache — resolves OPT-005 (stampede) and OPT-006 (uncoordinated eviction)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1536)
def _compute_route_quantized(
    olat_q: int, olon_q: int, dlat_q: int, dlon_q: int,
    flavor: str = DEFAULT_FLAVOR,
) -> "tuple[tuple, tuple, float]":
    olat, olon = olat_q / 1e5, olon_q / 1e5
    dlat, dlon = dlat_q / 1e5, dlon_q / 1e5
    return (
        _build_path(olat, olon, dlat, dlon, flavor),
        _build_directions(olat, olon, dlat, dlon, flavor),
        _build_minutes(olat, olon, dlat, dlon, flavor),
    )


def _compute_route(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> "tuple[tuple, tuple, float]":
    """
    Compute and cache all route data in one call.

    Coordinates are quantized to ~1m before cache lookup so floating-point
    jitter on the input cannot defeat the cache.
    """
    if flavor not in FLAVORS:
        flavor = DEFAULT_FLAVOR
    return _compute_route_quantized(
        round(origin_lat * 1e5), round(origin_lon * 1e5),
        round(dest_lat * 1e5),   round(dest_lon * 1e5),
        flavor,
    )


def walk_paths_alternatives(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> list[dict]:
    """
    Return route data for all FLAVORS as a list of dicts:
      [{"flavor": "fastest", "path": [...], "directions": [...], "minutes": ...}, ...]

    Each call hits a per-flavor LRU cache, so repeated requests for the same
    OD pair are O(flavors) lookups after the first computation.
    """
    out: list[dict] = []
    for flavor in FLAVORS:
        path, directions, minutes = _compute_route(
            origin_lat, origin_lon, dest_lat, dest_lon, flavor,
        )
        out.append({
            "flavor": flavor,
            "path": [list(pt) for pt in path],
            "directions": list(directions),
            "minutes": minutes,
        })
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def walk_path(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> list[list[float]]:
    """
    Return the street-network path between two lat/lon points as [[lat, lon], ...].

    For each edge the actual street geometry is used when present (curved / diagonal
    streets like Milwaukee Ave). Falls back to a straight line if routing fails.
    Returns a fresh list on every call (safe to mutate).
    """
    return [list(pt) for pt in _compute_route(origin_lat, origin_lon, dest_lat, dest_lon)[0]]


def walk_minutes(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> float:
    """
    Return the estimated walking time in minutes between two lat/lon points,
    routed along the real pedestrian street network.

    Falls back to a straight-line Haversine estimate if routing fails.
    """
    return _compute_route(origin_lat, origin_lon, dest_lat, dest_lon)[2]
