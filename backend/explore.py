"""
Isochrone ("Neighborhood Explorer") backend core.

Given an origin (lat, lon) and a time budget in minutes, return:
  - the alpha-shape polygon enclosing every graph vertex reachable on foot
    within that budget (as GeoJSON);
  - the list of NEIGHBORHOOD_COORDS names whose centroids fall inside it;
  - basic stats (reachable-node count, area in square miles).

Routing is a single-source bounded Dijkstra against the existing pedestrian
graph in walking.py. Walking speed is the project-wide WALKING_SPEED_MPH
constant from utils.py — no separate pace handling here; the caller can
rescale the budget if needed.
"""

from __future__ import annotations

import json
import logging
import math
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from shapely import concave_hull
from shapely.geometry import MultiPoint, MultiPolygon, Point, Polygon, mapping, shape
from shapely.prepared import prep

import walking
from geocoding import NEIGHBORHOOD_COORDS
from utils import WALKING_SPEED_MPH, METERS_PER_MILE, quantize_coord

logger = logging.getLogger(__name__)

BOUNDARY_PATH = Path(__file__).resolve().parent / "data" / "chicago_boundary.json"

# Concave-hull tightness ratio passed to shapely.concave_hull. 0.0 → convex
# hull; 1.0 → tightest (most concave) hull. 0.4 keeps the shape recognizably
# concave (so it doesn't engulf Lake Michigan or large park gaps) while still
# producing a closed polygon for typical reachable sets.
_CONCAVE_HULL_RATIO = 0.4

# Alpha-shape fallback alpha when shapely.concave_hull is unavailable. Larger
# alpha → tighter hull. Tuned empirically for ~lat-lon scale; users on shapely
# < 2.0 should upgrade rather than rely on the fallback.
_ALPHASHAPE_ALPHA = 100.0


def _meters_budget(max_minutes: float) -> float:
    return (max_minutes / 60.0) * WALKING_SPEED_MPH * METERS_PER_MILE


def _reachable_indices(orig_idx: int, budget_m: float) -> np.ndarray:
    """Single-source Dijkstra from `orig_idx` returning indices within `budget_m`.

    Uses igraph's C-level `distances(source=...)` with edge `length` weights.
    For Chicago's ~50–80k pedestrian-graph vertices this completes in well
    under 100 ms on commodity hardware.
    """
    G = walking._load_graph()
    if G is None:
        return np.empty(0, dtype=np.int64)

    # `distances` returns a list[list[float]]; one row per source.
    # Use cached edge-length array (v2 pickle has no "length" igraph attribute).
    weights = walking._edge_lengths if walking._edge_lengths is not None else "length"
    rows = G.distances(source=orig_idx, weights=weights)
    if not rows:
        return np.empty(0, dtype=np.int64)
    dists = np.asarray(rows[0], dtype=np.float64)
    # Unreachable vertices come back as inf; the budget filter excludes them.
    mask = np.isfinite(dists) & (dists <= budget_m)
    return np.where(mask)[0].astype(np.int64)


def _hull_polygon(lats: np.ndarray, lons: np.ndarray):
    """Return a shapely Polygon (lon/lat) enclosing the given coordinates.

    Prefers shapely.concave_hull (≥ 2.0). Falls back to convex hull if the
    concave-hull call fails or is unavailable — the convex-hull artifact
    over Lake Michigan is documented in FEATURE_PLANS.md as acceptable for v1.
    """
    if len(lats) < 4:
        # Concave hull degenerates with fewer than 3 unique points; fall back
        # to a small buffered MultiPoint so callers always get a polygon.
        pts = MultiPoint([(lon, lat) for lat, lon in zip(lats, lons)])
        return pts.buffer(0.0005)  # ~50 m at Chicago lat — generous enough.

    pts = MultiPoint([(lon, lat) for lat, lon in zip(lats, lons)])
    try:
        hull = concave_hull(pts, ratio=_CONCAVE_HULL_RATIO)
        if hull.is_empty or hull.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("concave_hull returned non-polygon")
        return hull
    except Exception as e:
        logger.warning("concave_hull failed (%s: %s); falling back to convex hull", type(e).__name__, e)
        return pts.convex_hull


def _polygon_area_sq_mi(polygon) -> float:
    """Approximate area of a lon/lat polygon in square miles.

    Uses an equirectangular projection centered on the polygon centroid.
    Accurate to within a fraction of a percent at city scale.

    The projection scales x by `111_320 × cos(lat)` and y by `111_320`, both
    constant across the polygon, so the projected area is just the lon/lat
    area times those two factors — no need to materialise a new geometry.
    """
    if polygon.is_empty:
        return 0.0
    cos_lat = math.cos(math.radians(polygon.centroid.y))
    area_m2 = polygon.area * (111_320.0 ** 2) * cos_lat
    return area_m2 / (METERS_PER_MILE ** 2)


# Per-request `Point(lon, lat)` allocation for every entry in
# NEIGHBORHOOD_COORDS adds up — the table has ~150 entries, the points are
# static, and shapely's C-level Point init is non-trivial. We build the list
# once on first call and reuse it across every `/explore` request. The
# coordinate-dedupe step (aliases like "loyola" / "loyola university") is
# folded into the build so the per-request loop is one prepared.contains()
# per unique point.
_neighborhood_points_lock = threading.Lock()
_neighborhood_points: "list[tuple[str, Point]] | None" = None


def _get_neighborhood_points() -> "list[tuple[str, Point]]":
    global _neighborhood_points
    if _neighborhood_points is not None:
        return _neighborhood_points
    with _neighborhood_points_lock:
        if _neighborhood_points is not None:
            return _neighborhood_points
        seen: set[tuple[float, float]] = set()
        points: list[tuple[str, Point]] = []
        for raw_name, (lat, lon) in NEIGHBORHOOD_COORDS.items():
            key = (round(lat, 5), round(lon, 5))
            if key in seen:
                continue
            seen.add(key)
            points.append((raw_name.title(), Point(lon, lat)))
        _neighborhood_points = points
    return _neighborhood_points


# City of Chicago administrative boundary. Used to clip isochrone hulls
# against the Lake Michigan shoreline (the city limits ARE the shoreline
# along the lakefront). Loaded lazily so absence of the file degrades
# gracefully — the hull is returned unclipped if the boundary is missing.
_boundary_lock = threading.Lock()
_boundary: "Polygon | MultiPolygon | None" = None
_boundary_loaded = False


def _get_chicago_boundary() -> "Polygon | MultiPolygon | None":
    global _boundary, _boundary_loaded
    if _boundary_loaded:
        return _boundary
    with _boundary_lock:
        if _boundary_loaded:
            return _boundary
        if not BOUNDARY_PATH.exists():
            logger.warning(
                "Chicago boundary missing at %s — isochrones will not be "
                "clipped against the lakefront; run "
                "`python backend/scripts/build_chicago_boundary.py` to generate it",
                BOUNDARY_PATH,
            )
            _boundary_loaded = True
            return None
        try:
            data = json.loads(BOUNDARY_PATH.read_text(encoding="utf-8"))
            geom = shape(data["polygon"])
            if not geom.is_valid:
                geom = geom.buffer(0)
            if not isinstance(geom, (Polygon, MultiPolygon)) or geom.is_empty:
                raise ValueError(f"unexpected geom: {geom.geom_type}")
            _boundary = geom
            logger.info("Loaded Chicago boundary (%s)", geom.geom_type)
        except (OSError, ValueError, KeyError) as e:
            logger.error("Failed to read %s (%s: %s)", BOUNDARY_PATH, type(e).__name__, e)
            _boundary = None
        _boundary_loaded = True
        return _boundary


def _clip_to_boundary(polygon):
    """Intersect `polygon` with the Chicago city boundary if available.

    Returns the original polygon unchanged when the boundary is missing or
    the intersection would be empty / degenerate — both safer than emitting
    a hull that vanishes because the user picked a lakefront origin where
    the concave hull mostly sat over water.
    """
    boundary = _get_chicago_boundary()
    if boundary is None:
        return polygon
    try:
        clipped = polygon.intersection(boundary)
    except Exception as e:  # noqa: BLE001 — shapely can throw various GEOS errors
        logger.warning("boundary intersection failed (%s: %s); keeping unclipped hull", type(e).__name__, e)
        return polygon
    if clipped.is_empty or clipped.geom_type not in ("Polygon", "MultiPolygon"):
        return polygon
    return clipped


def _reachable_neighborhoods(polygon) -> list[str]:
    """Return NEIGHBORHOOD_COORDS keys whose centroids fall inside `polygon`.

    Names are returned in title case (matching how the frontend displays
    NEIGHBORHOOD_COORDS keys today). Coordinate dedupe (so aliases like
    "loyola" / "loyola university" don't both show) is baked into the
    pre-built point list — see `_get_neighborhood_points`.
    """
    if polygon.is_empty:
        return []
    # Prepared geometry builds the polygon's edge index once so the
    # contains() checks below don't each rebuild it.
    prepared = prep(polygon)
    points = _get_neighborhood_points()
    names = [name for name, pt in points if prepared.contains(pt)]
    names.sort()
    return names


@lru_cache(maxsize=32)
def _explore_quantized(
    lat_q: int,
    lon_q: int,
    max_minutes_q: int,
) -> dict[str, Any] | None:
    """Cached explore implementation keyed on quantized inputs.

    Coordinates are quantized to ~1 m (5 decimals) and minutes to whole-number
    granularity so jittered inputs share a cache entry. Returns None when the
    origin can't be snapped to the graph (caller maps this to a 422).
    """
    lat = lat_q / 1e5
    lon = lon_q / 1e5
    max_minutes = float(max_minutes_q)

    if walking._load_graph() is None:
        return None

    orig_idx = walking._get_nearest_node(lat, lon)
    if orig_idx is None:
        return None

    budget_m = _meters_budget(max_minutes)
    reachable = _reachable_indices(orig_idx, budget_m)
    if reachable.size == 0:
        return None

    lats = walking._vertex_lats[reachable]
    lons = walking._vertex_lons[reachable]
    polygon = _hull_polygon(lats, lons)
    polygon = _clip_to_boundary(polygon)
    area_sq_mi = round(_polygon_area_sq_mi(polygon), 4)
    neighborhoods = _reachable_neighborhoods(polygon)

    return {
        "polygon": mapping(polygon),
        "reachable_neighborhoods": neighborhoods,
        "stats": {
            "node_count": int(reachable.size),
            "area_sq_mi": area_sq_mi,
        },
    }


def explore(lat: float, lon: float, max_minutes: int) -> dict[str, Any] | None:
    """Public entry point — see module docstring.

    Returns None if the origin can't be snapped to the pedestrian graph
    (out of coverage, graph unavailable, or no reachable vertices).
    """
    if max_minutes <= 0:
        return None
    lat_q, lon_q = quantize_coord(lat, lon)
    # Accept floats from legacy callers but normalize to the int the cache
    # key + Dijkstra cutoff expect. The /explore endpoint already rounds at
    # the pydantic boundary so the response echoes the same value.
    return _explore_quantized(lat_q, lon_q, round(max_minutes))
