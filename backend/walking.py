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

from utils import (
    haversine_miles as _haversine_miles,
    WALKING_SPEED_MPH,
    SERVICE_HIGHWAY_TYPES,
    METERS_PER_MILE,
    quantize_coord,
)

GRAPH_PATH  = Path(__file__).parent / "street_graph.graphml"
IGRAPH_PATH = Path(__file__).parent / "street_graph_igraph.pkl"

WALKING_SPEED_MPS = WALKING_SPEED_MPH * METERS_PER_MILE / 3600  # mph → metres per second ≈ 1.34 m/s

_LONG_BLOCK_METERS    = 201.17   # 1/8 mile = 660 ft — N-S numbered-address axis
_SHORT_BLOCK_METERS   = 100.58   # 1/16 mile = 330 ft — E-W cross streets
_BLOCK_TYPE_THRESHOLD = 150.0    # midpoint; ≥ threshold → long block

_DIRECTION_FULL = {
    "N":  "North",     "NE": "Northeast", "E":  "East",      "SE": "Southeast",
    "S":  "South",     "SW": "Southwest", "W":  "West",      "NW": "Northwest",
}

FLAVORS: tuple[str, ...] = ("fastest", "fewest_turns", "greenest")
DEFAULT_FLAVOR = "fastest"

# LRU cache sizes for the routing pipeline. Both route caches share a value
# because their entries evict together (a miss in one implies a miss in the other).
_NEAREST_NODE_CACHE_SIZE = 2048
_ROUTE_CACHE_SIZE        = 1536

# Pace presets — these MUST match the values accepted by the API contract
# (steps.PACE_TO_MPH). Used to convert canonical 3 mph minutes into
# user-paced minutes at the response layer.
_PACE_TO_MPH = {"leisurely": 2.0, "normal": 3.0, "brisk": 4.0}

# Penalty (metres) added to "highway=steps" edges when avoid_stairs=True.
# Large enough to deter routing through stairs whenever any alternative exists,
# while remaining finite so isolated stair-only segments stay reachable.
_AVOID_STAIRS_PENALTY_M = 10_000.0

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

# Per-edge attribute columns, normalized once at graph load. igraph stores
# attributes column-wise internally; bulk reads avoid per-edge Python↔igraph
# crossings during routing. All lists are indexed by edge id and stay in sync
# with the post-filter graph.
_edge_names:      "list[str]   | None" = None
_edge_highways:   "list[str]   | None" = None
_edge_footways:   "list[str]   | None" = None
_edge_lengths:    "list[float] | None" = None
_edge_geometries: "list        | None" = None
# Endpoint columns sourced from `G.get_edgelist()` once at load. Indexing into
# these lists avoids the per-edge `G.es[eid].source / .target` Python-bridge
# crossings during vpath reconstruction.
_edge_sources:    "list[int]   | None" = None
_edge_targets:    "list[int]   | None" = None

# Cache of weight vectors used by routing variants that layer extra penalties
# on top of a flavor (currently only avoid_stairs). Keyed by (flavor, variant).
_combined_weights: dict[tuple[str, str], list[float]] = {}

# Guards writes to `_flavor_weights` and `_combined_weights` so concurrent
# cold-cache requests for the same flavor don't each rebuild the O(E) weight
# vector. Reads stay lock-free — CPython dict assignment is atomic, so the
# lock only serializes the build step itself.
_weights_lock: threading.Lock = threading.Lock()


def _normalize_edge_str(v) -> str:
    """Normalize a bulk-read igraph attribute value to a plain non-None string."""
    if isinstance(v, list):
        return v[0] if v else ""
    return v or ""


def _populate_edge_caches(G: "ig.Graph") -> None:
    """Materialize per-edge attribute columns once after the graph is loaded
    and service edges are filtered. Subsequent routing reads index these lists
    instead of doing per-edge igraph attribute lookups."""
    global _edge_names, _edge_highways, _edge_footways, _edge_lengths, _edge_geometries
    global _edge_sources, _edge_targets
    n = G.ecount()
    attrs = G.es.attributes()
    raw_names    = G.es["name"]     if "name"     in attrs else [""]   * n
    raw_highways = G.es["highway"]  if "highway"  in attrs else [""]   * n
    raw_footways = G.es["footway"]  if "footway"  in attrs else [""]   * n
    raw_lengths  = G.es["length"]   if "length"   in attrs else [0.0]  * n
    raw_geoms    = G.es["geometry"] if "geometry" in attrs else [None] * n
    _edge_names      = [_normalize_edge_str(v) for v in raw_names]
    _edge_highways   = [_normalize_edge_str(v) for v in raw_highways]
    _edge_footways   = [_normalize_edge_str(v) for v in raw_footways]
    _edge_lengths    = [float(v) if v else 0.0 for v in raw_lengths]
    _edge_geometries = list(raw_geoms)
    edgelist = G.get_edgelist()
    _edge_sources = [u for u, _ in edgelist]
    _edge_targets = [v for _, v in edgelist]
    # Invalidate any cached weight vectors derived from a prior graph load.
    _flavor_weights.clear()
    _combined_weights.clear()


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
                if (e["highway"] or "") in SERVICE_HIGHWAY_TYPES
            ]
            if to_delete:
                G.delete_edges(to_delete)
                logger.info("Filtered %s service/alley edges", f"{len(to_delete):,}")

        lons = np.asarray(G.vs["x"], dtype=np.float64)
        lats = np.asarray(G.vs["y"], dtype=np.float64)
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
        _populate_edge_caches(G)
        _graph_cache = G

    return _graph_cache


@lru_cache(maxsize=_NEAREST_NODE_CACHE_SIZE)
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
    return _get_nearest_node_quantized(*quantize_coord(lat, lon))


def _build_flavor_weights(G: "ig.Graph", flavor: str) -> "list[float] | str":
    """Return the weight vector (or attribute name) used for Dijkstra under `flavor`."""
    if flavor == "fastest":
        return "length"

    lengths = _edge_lengths
    if lengths is None:
        return "length"

    if flavor == "fewest_turns":
        return [L + _TURN_PENALTY_M for L in lengths]
    if flavor == "greenest":
        highways = _edge_highways or [""] * len(lengths)
        return [
            L * _GREEN_DISCOUNT if h in _GREEN_HIGHWAYS else L
            for L, h in zip(lengths, highways)
        ]

    return "length"


def _get_flavor_weights(flavor: str) -> "list[float] | str":
    G = _load_graph()
    if G is None or flavor == "fastest":
        return "length"
    cached = _flavor_weights.get(flavor)
    if cached is not None and len(cached) == G.ecount():
        return cached
    with _weights_lock:
        # Double-checked: another thread may have built it while we waited.
        cached = _flavor_weights.get(flavor)
        if cached is not None and len(cached) == G.ecount():
            return cached
        weights = _build_flavor_weights(G, flavor)
        if isinstance(weights, list):
            _flavor_weights[flavor] = weights
    return weights


def _vpath_from_epath(orig_idx: int, epath, G: "ig.Graph") -> list[int]:
    """Reconstruct the vertex path from an edge path. Uses the cached
    `_edge_sources` / `_edge_targets` columns when available so each step is
    a Python list index instead of a `G.es[eid].source` round-trip into the
    igraph C layer.
    """
    sources, targets = _edge_sources, _edge_targets
    vpath = [orig_idx]
    if sources is not None and targets is not None:
        for eid in epath:
            prev = vpath[-1]
            vpath.append(targets[eid] if sources[eid] == prev else sources[eid])
    else:
        for eid in epath:
            e = G.es[eid]
            vpath.append(e.target if e.source == vpath[-1] else e.source)
    return vpath


@lru_cache(maxsize=_ROUTE_CACHE_SIZE)
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
        vpath = _vpath_from_epath(orig_idx, epath, G)
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
        if _load_graph() is None:
            raise RuntimeError("street graph unavailable")
        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon, flavor)
        if path is None:
            raise RuntimeError("path unavailable")
        _, epath = path
        length_m = sum(_edge_lengths[e] for e in epath)
        return round(length_m / WALKING_SPEED_MPS / 60, 1)
    except Exception as e:
        logger.warning("walk_minutes fallback: %s: %s", type(e).__name__, e)
        return _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon)


def _path_coords_from_path(vpath: tuple, epath: tuple) -> tuple:
    """Build the same coordinate sequence as `_build_path` from a known vpath/epath.

    Reads geometry from the cached `_edge_geometries` column. The cache is
    populated unconditionally inside `_load_graph`, so any caller that has a
    routed `vpath`/`epath` is guaranteed to see a populated cache.
    """
    if len(vpath) < 2:
        return ()

    geoms = _edge_geometries

    result_coords: list[tuple[float, float]] = []
    for eid, u, v in zip(epath, vpath, vpath[1:]):
        geom_coords = geoms[eid]

        if geom_coords:
            u_lon = _vertex_lons[u]
            u_lat = _vertex_lats[u]
            du_start = (geom_coords[0][0] - u_lon)**2 + (geom_coords[0][1] - u_lat)**2
            du_end   = (geom_coords[-1][0] - u_lon)**2 + (geom_coords[-1][1] - u_lat)**2
            # Iterate forward or reverse without copying the geometry list.
            reverse = du_start > du_end
            n = len(geom_coords)
            head_idx = n - 1 if reverse else 0
            head_lon, head_lat = geom_coords[head_idx][0], geom_coords[head_idx][1]
            first = (head_lat, head_lon)
            last  = result_coords[-1] if result_coords else None
            skip_first = bool(last and abs(first[0] - last[0]) < 1e-9 and abs(first[1] - last[1]) < 1e-9)
            if reverse:
                rng = range(n - 2, -1, -1) if skip_first else range(n - 1, -1, -1)
            else:
                rng = range(1, n) if skip_first else range(n)
            for j in rng:
                lon, lat = geom_coords[j][0], geom_coords[j][1]
                result_coords.append((lat, lon))
        else:
            if not result_coords:
                result_coords.append((_vertex_lats[u], _vertex_lons[u]))
            result_coords.append((_vertex_lats[v], _vertex_lons[v]))

    return tuple(result_coords)


def _build_directions(
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
            return ()
        return _directions_from_path(vpath, epath)

    except Exception as e:
        logger.warning("walk_directions fallback: %s: %s", type(e).__name__, e)
        total_min = _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon)
        fallback_meters = total_min * 60 * WALKING_SPEED_MPS
        fallback_blocks = max(0.5, round(fallback_meters / _LONG_BLOCK_METERS * 2) / 2)
        return ({"street": "Walk", "path_type": "", "direction": "", "direction_full": "",
                 "blocks": fallback_blocks, "block_type": "long", "minutes": total_min,
                 "distance_meters": round(fallback_meters, 1)},)


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
        return _path_coords_from_path(vpath, epath)

    except Exception as e:
        logger.error("routing failed: %s: %s", type(e).__name__, e)
        return ((origin_lat, origin_lon), (dest_lat, dest_lon))


# ---------------------------------------------------------------------------
# Single shared cache — resolves OPT-005 (stampede) and OPT-006 (uncoordinated eviction)
# ---------------------------------------------------------------------------

def _haversine_fallback(
    olat: float, olon: float, dlat: float, dlon: float, flavor: str,
) -> "tuple[tuple, tuple, float]":
    """Straight-line approximation when the graph or shortest path is unavailable.

    Returns the same `(path, directions, minutes)` shape as the routed branch
    so callers can be agnostic. Each helper independently logs why it fell
    back, which is why we still go through them rather than computing inline.
    """
    return (
        _build_path(olat, olon, dlat, dlon, flavor),
        _build_directions(olat, olon, dlat, dlon, flavor),
        _build_minutes(olat, olon, dlat, dlon, flavor),
    )


@lru_cache(maxsize=_ROUTE_CACHE_SIZE)
def _compute_route_quantized(
    olat_q: int, olon_q: int, dlat_q: int, dlon_q: int,
    flavor: str = DEFAULT_FLAVOR,
) -> "tuple[tuple, tuple, float]":
    olat, olon = olat_q / 1e5, olon_q / 1e5
    dlat, dlon = dlat_q / 1e5, dlon_q / 1e5

    G = _load_graph()
    if G is None:
        return _haversine_fallback(olat, olon, dlat, dlon, flavor)

    sp = _get_shortest_path(olat, olon, dlat, dlon, flavor)
    if sp is None:
        return _haversine_fallback(olat, olon, dlat, dlon, flavor)

    vpath, epath = sp
    if len(vpath) < 2:
        return (
            ((olat, olon), (dlat, dlon)),
            (),
            _build_minutes(olat, olon, dlat, dlon, flavor),
        )

    path       = _path_coords_from_path(vpath, epath)
    directions = _directions_from_path(vpath, epath)
    # Derive minutes from the per-step distance_meters already summed inside
    # _directions_from_path, avoiding a second full epath traversal.
    if directions:
        total_meters = sum(d["distance_meters"] for d in directions)
        minutes = round(total_meters / WALKING_SPEED_MPS / 60, 1)
    else:
        minutes = _build_minutes(olat, olon, dlat, dlon, flavor)
    return (path, directions, minutes)


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
    path, directions, minutes = _compute_route_quantized(
        *quantize_coord(origin_lat, origin_lon),
        *quantize_coord(dest_lat,   dest_lon),
        flavor,
    )
    # Break the alias on cached direction dicts so callers can mutate them
    # without corrupting the LRU cache. `path` is a tuple of tuples (immutable)
    # and `minutes` is a float, so only `directions` needs defensive copying.
    return (path, tuple(dict(d) for d in directions), minutes)


def pace_minutes_factor(pace: str) -> float:
    """Multiplicative factor that converts canonical 3 mph minutes to user-paced minutes."""
    pace_mph = _PACE_TO_MPH.get(pace, WALKING_SPEED_MPH)
    return WALKING_SPEED_MPH / pace_mph


def _get_avoid_stairs_weights(flavor: str) -> "list[float] | None":
    """Return (and cache) the weight vector for `flavor` with stair penalties layered on."""
    G = _load_graph()
    if G is None or _edge_lengths is None:
        return None
    key = (flavor, "avoid_stairs")
    cached = _combined_weights.get(key)
    if cached is not None and len(cached) == G.ecount():
        return cached
    # Resolve the base flavor weights outside the lock — `_get_flavor_weights`
    # acquires `_weights_lock` itself, and `threading.Lock` is non-reentrant.
    base = _get_flavor_weights(flavor)
    with _weights_lock:
        # Double-checked: another thread may have built it while we waited.
        cached = _combined_weights.get(key)
        if cached is not None and len(cached) == G.ecount():
            return cached
        weights = list(_edge_lengths) if isinstance(base, str) else list(base)
        highways = _edge_highways
        if highways is not None:
            for i, h in enumerate(highways):
                if h == "steps":
                    weights[i] += _AVOID_STAIRS_PENALTY_M
        _combined_weights[key] = weights
    return weights


def _shortest_path_with_avoid_stairs(
    orig_idx: int, dest_idx: int, flavor: str,
) -> "tuple[tuple[int, ...], tuple[int, ...]] | None":
    """Dijkstra with a per-edge step-avoidance penalty layered on `flavor`. Weights cached."""
    G = _load_graph()
    if G is None:
        return None
    weights = _get_avoid_stairs_weights(flavor)
    if weights is None:
        return None
    try:
        result = G.get_shortest_paths(orig_idx, to=dest_idx, weights=weights, output="epath")
        if not result or not result[0]:
            return None
        epath = result[0]
        vpath = _vpath_from_epath(orig_idx, epath, G)
        return (tuple(vpath), tuple(epath))
    except Exception:
        return None


def compute_route_with_prefs(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
    avoid_stairs: bool = False,
    prefer_pedestrian: bool = False,
) -> "tuple[tuple, tuple, float]":
    """
    Routing variant that honours `avoid_stairs` and `prefer_pedestrian`.

    `prefer_pedestrian` is satisfied by routing under the existing `greenest`
    flavor (which already discounts footway/path/cycleway edges), so it just
    forces that flavor when set. `avoid_stairs` requires bespoke per-edge
    weights, so when it is set we run an uncached Dijkstra with stair penalties
    layered on top of the chosen flavor.

    Falls back to the cached `_compute_route` path when neither pref is set.
    """
    if prefer_pedestrian:
        flavor = "greenest"
    if not avoid_stairs:
        return _compute_route(origin_lat, origin_lon, dest_lat, dest_lon, flavor)

    if _load_graph() is None:
        return (
            _build_path(origin_lat, origin_lon, dest_lat, dest_lon, flavor),
            _build_directions(origin_lat, origin_lon, dest_lat, dest_lon, flavor),
            _build_minutes(origin_lat, origin_lon, dest_lat, dest_lon, flavor),
        )

    orig_idx = _get_nearest_node(origin_lat, origin_lon)
    dest_idx = _get_nearest_node(dest_lat, dest_lon)
    if orig_idx is None or dest_idx is None:
        return (
            ((origin_lat, origin_lon), (dest_lat, dest_lon)),
            (),
            _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon),
        )

    path = _shortest_path_with_avoid_stairs(orig_idx, dest_idx, flavor)
    if path is None:
        return _compute_route(origin_lat, origin_lon, dest_lat, dest_lon, flavor)

    vpath, epath = path
    length_m = sum(_edge_lengths[e] for e in epath)
    minutes = round(length_m / WALKING_SPEED_MPS / 60, 1)

    coords = _path_coords_from_path(vpath, epath)
    # Re-build directions from the same vpath/epath we just computed; reusing
    # _build_directions would re-run the cached Dijkstra and return the
    # stairs-included path, defeating avoid_stairs.
    directions = _directions_from_path(vpath, epath)
    return (coords if coords else ((origin_lat, origin_lon), (dest_lat, dest_lon)),
            directions, minutes)


_CARDINAL_DIRS: tuple[str, ...] = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def _directions_from_path(vpath: tuple, epath: tuple) -> tuple:
    """Build the same direction-step tuples as _build_directions from a known vpath/epath.

    Reads names/highways/footways/lengths from the per-edge cache columns,
    which `_load_graph` populates unconditionally — any caller that has a
    routed `vpath`/`epath` is guaranteed to see populated columns.
    """
    if len(vpath) < 2:
        return ()

    names_col    = _edge_names
    highways_col = _edge_highways
    footways_col = _edge_footways
    lengths_col  = _edge_lengths

    raw: list[tuple[str, str, float, int, int]] = []
    for eid, u, v in zip(epath, vpath, vpath[1:]):
        name = names_col[eid].strip()
        path_type = "" if name else _highway_path_type(highways_col[eid], footways_col[eid])
        length = lengths_col[eid]
        raw.append((name, path_type, length, u, v))

    steps: list[dict] = []
    i = 0
    n = len(raw)
    while i < n:
        name, path_type = raw[i][0], raw[i][1]
        total_length = 0.0
        edge_count = 0
        start_v = raw[i][3]
        end_v = raw[i][4]
        while i < n and raw[i][0] == name and raw[i][1] == path_type:
            total_length += raw[i][2]
            edge_count   += 1
            end_v = raw[i][4]
            i += 1
        lat1, lon1 = _vertex_lats[start_v], _vertex_lons[start_v]
        lat2, lon2 = _vertex_lats[end_v],   _vertex_lons[end_v]
        minutes = round(total_length / WALKING_SPEED_MPS / 60, 1)
        # Scale the longitude delta by cos(lat) so the cardinal classification
        # matches physical bearing — without this, ~5° of true headings near
        # the inter-cardinal boundaries flip to the wrong cardinal at Chicago lat.
        cos_lat = math.cos(math.radians(lat1))
        deg = math.degrees(math.atan2((lon2 - lon1) * cos_lat, lat2 - lat1)) % 360
        cardinal = _CARDINAL_DIRS[round(deg / 45) % 8]
        avg_edge_m = total_length / edge_count
        is_long  = avg_edge_m >= _BLOCK_TYPE_THRESHOLD
        block_m  = _LONG_BLOCK_METERS if is_long else _SHORT_BLOCK_METERS
        blocks   = max(0.5, round(total_length / block_m * 2) / 2)
        steps.append({
            "street":         name,
            "path_type":      path_type,
            "direction":      cardinal,
            "direction_full": _DIRECTION_FULL.get(cardinal, cardinal),
            "blocks":         blocks,
            "block_type":     "long" if is_long else "short",
            "minutes":        minutes,
            "distance_meters": round(total_length, 1),
        })
    return tuple(steps)


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
