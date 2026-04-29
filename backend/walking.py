"""
Street-network walking time calculator using igraph + scipy.

The pedestrian street graph is loaded from the pre-built igraph artifact
(street_graph_igraph.pkl) produced by fetch_street_graph.py in CTA-Transit-PWA,
or falls back to parsing street_graph.graphml via igraph directly.

Walking speed assumption: 3 mph (1.34 m/s) — a comfortable pedestrian pace.
"""

import math
import pickle
import threading
from functools import lru_cache
from pathlib import Path

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


_graph_lock: threading.Lock = threading.Lock()
_graph_cache: "ig.Graph | None" = None
_coord_kdtree: "cKDTree | None" = None
_vertex_lats: "np.ndarray | None" = None
_vertex_lons: "np.ndarray | None" = None
_graph_load_failed: bool = False


def _parse_geometry_inplace(G: ig.Graph) -> None:
    """Convert geometry WKT strings to coordinate lists [(lon, lat), ...] in-place."""
    try:
        from shapely import wkt as shapely_wkt
        for e in G.es:
            geom = e["geometry"]
            if isinstance(geom, str) and geom:
                try:
                    e["geometry"] = list(shapely_wkt.loads(geom).coords)
                except Exception:
                    e["geometry"] = None
            elif not geom:
                e["geometry"] = None
    except ImportError:
        for e in G.es:
            e["geometry"] = None


def _load_graph() -> "ig.Graph | None":
    """Load street graph once; returns None (and never retries) if unavailable."""
    global _graph_cache, _coord_kdtree, _vertex_lats, _vertex_lons, _graph_load_failed

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
            print(f"[walking] Loading igraph artifact from {IGRAPH_PATH} ...")
            try:
                with open(IGRAPH_PATH, "rb") as f:
                    data = pickle.load(f)
                G = data["graph"]
                print(f"[walking] igraph loaded: {G.vcount():,} vertices, {G.ecount():,} edges")
            except Exception as e:
                print(f"[walking] igraph pickle failed ({type(e).__name__}: {e}) — trying graphml fallback")
                G = None

        if G is None:
            if not GRAPH_PATH.exists():
                print(f"[walking] Street graph not found at {GRAPH_PATH} — walking will use Haversine fallback.")
                _graph_load_failed = True
                return None
            print(f"[walking] Loading street graph from {GRAPH_PATH} ...")
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
                print(f"[walking] igraph loaded: {G.vcount():,} vertices, {G.ecount():,} edges")
            except Exception as e:
                print(f"[walking] Failed to load street graph ({type(e).__name__}: {e}) — walking will use Haversine fallback.")
                _graph_load_failed = True
                return None

        lons = np.array([v["x"] for v in G.vs], dtype=np.float64)
        lats = np.array([v["y"] for v in G.vs], dtype=np.float64)
        _vertex_lats = lats
        _vertex_lons = lons
        _coord_kdtree = cKDTree(np.column_stack([lons, lats]))
        _graph_cache = G

    return _graph_cache


@lru_cache(maxsize=2048)
def _get_nearest_node(lat: float, lon: float) -> "int | None":
    """Return the nearest igraph vertex index for a lat/lon coordinate; None if graph unavailable."""
    if _load_graph() is None:
        return None
    try:
        _, idx = _coord_kdtree.query([lon, lat])
        return int(idx)
    except Exception:
        return None


@lru_cache(maxsize=512)
def _get_shortest_path(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> "tuple[tuple[int, ...], tuple[int, ...]] | None":
    """
    Compute and cache the shortest path between two lat/lon coordinates.

    Returns (vpath, epath) or None if routing fails. All three public routing
    functions share this cache so the Dijkstra run happens at most once per
    unique origin/destination pair per process lifetime.
    """
    G = _load_graph()
    if G is None:
        return None
    orig_idx = _get_nearest_node(origin_lat, origin_lon)
    dest_idx = _get_nearest_node(dest_lat, dest_lon)
    if orig_idx is None or dest_idx is None:
        return None
    try:
        result = G.get_shortest_paths(orig_idx, to=dest_idx, weights="length", output="epath")
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
) -> float:
    try:
        G = _load_graph()
        if G is None:
            raise RuntimeError("street graph unavailable")
        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon)
        if path is None:
            raise RuntimeError("path unavailable")
        _, epath = path
        length_m = sum(G.es[e]["length"] or 0.0 for e in epath)
        return round(length_m / WALKING_SPEED_MPS / 60, 1)
    except Exception:
        return _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon)


def _build_directions(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> tuple:
    def _cardinal(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        deg = math.degrees(math.atan2(dlon, dlat)) % 360
        dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        return dirs[round(deg / 45) % 8]

    def _street_name(attrs: dict) -> str:
        name = attrs.get("name", "")
        if isinstance(name, list):
            name = name[0] if name else ""
        name = (name or "").strip()
        return name if name else "unnamed path"

    try:
        G = _load_graph()
        if G is None:
            raise RuntimeError("street graph unavailable")

        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon)
        if path is None:
            raise RuntimeError("path unavailable")

        vpath, epath = path

        if len(vpath) < 2:
            return ()

        raw: list[tuple[str, float, int, int]] = []
        for eid, u, v in zip(epath, vpath, vpath[1:]):
            edge = G.es[eid]
            raw.append((_street_name(edge.attributes()), edge["length"] or 0.0, u, v))

        steps: list[dict] = []
        i = 0
        while i < len(raw):
            name = raw[i][0]
            total_length = 0.0
            edge_count   = 0
            start_vertex = raw[i][2]
            end_vertex   = raw[i][3]
            while i < len(raw) and raw[i][0] == name:
                total_length += raw[i][1]
                edge_count   += 1
                end_vertex = raw[i][3]
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
                "direction":      direction_abbrev,
                "direction_full": _DIRECTION_FULL.get(direction_abbrev, direction_abbrev),
                "blocks":         blocks,
                "block_type":     block_type,
                "minutes":        minutes,
                "distance_meters": round(total_length, 1),
            })
        return tuple(steps)

    except Exception:
        total_min = _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon)
        fallback_meters = total_min * 60 * WALKING_SPEED_MPS
        fallback_blocks = max(0.5, round(fallback_meters / _LONG_BLOCK_METERS * 2) / 2)
        return ({"street": "Walk", "direction": "", "direction_full": "", "blocks": fallback_blocks,
                 "block_type": "long", "minutes": total_min, "distance_meters": round(fallback_meters, 1)},)


def walk_directions(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> list[dict]:
    """
    Return turn-by-turn walking directions as a list of steps:
      [{"street": "Broadway", "direction": "S", "blocks": 2.0, "minutes": 1.2,
        "distance_meters": 401.0}, ...]

    Each step represents a continuous segment along a named street.
    Returns a fresh list on every call (safe to mutate).
    """
    return list(_compute_route(origin_lat, origin_lon, dest_lat, dest_lon)[1])


def _build_path(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> tuple:
    try:
        G = _load_graph()
        if G is None:
            raise RuntimeError("street graph unavailable")

        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon)
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
        print(f"[walk_path] routing failed: {type(e).__name__}: {e}")
        return ((origin_lat, origin_lon), (dest_lat, dest_lon))


# ---------------------------------------------------------------------------
# Single shared cache — resolves OPT-005 (stampede) and OPT-006 (uncoordinated eviction)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=512)
def _compute_route(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> "tuple[tuple, tuple, float]":
    """
    Compute and cache all route data in one call.

    Returns (path_coords_tuple, directions_tuple, minutes_float). All three
    public routing functions read from this single cache, so Dijkstra runs at
    most once per unique origin/destination pair and LRU evictions are coordinated.
    """
    return (
        _build_path(origin_lat, origin_lon, dest_lat, dest_lon),
        _build_directions(origin_lat, origin_lon, dest_lat, dest_lon),
        _build_minutes(origin_lat, origin_lon, dest_lat, dest_lon),
    )


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
