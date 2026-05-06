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

import logging
import math
from functools import lru_cache
from typing import Any

import numpy as np
from shapely.geometry import MultiPoint, Point, mapping
from shapely.prepared import prep

import walking
from geocoding import NEIGHBORHOOD_COORDS
from utils import WALKING_SPEED_MPH, METERS_PER_MILE, quantize_coord

logger = logging.getLogger(__name__)

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
    rows = G.distances(source=orig_idx, weights="length")
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
        from shapely import concave_hull  # shapely ≥ 2.0
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


def _reachable_neighborhoods(polygon) -> list[str]:
    """Return NEIGHBORHOOD_COORDS keys whose centroids fall inside `polygon`.

    Names are returned in title case (matching how the frontend displays
    NEIGHBORHOOD_COORDS keys today) and de-duplicated by coordinate so
    aliases like "loyola" / "loyola university" don't both show.
    """
    if polygon.is_empty:
        return []
    # Prepared geometry builds the polygon's edge index once so the ~150
    # contains() checks below don't each rebuild it.
    prepared = prep(polygon)
    seen: set[tuple[float, float]] = set()
    names: list[str] = []
    for raw_name, (lat, lon) in NEIGHBORHOOD_COORDS.items():
        key = (round(lat, 5), round(lon, 5))
        if key in seen:
            continue
        if prepared.contains(Point(lon, lat)):
            seen.add(key)
            names.append(raw_name.title())
    names.sort()
    return names


@lru_cache(maxsize=128)
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


def explore(lat: float, lon: float, max_minutes: float) -> dict[str, Any] | None:
    """Public entry point — see module docstring.

    Returns None if the origin can't be snapped to the pedestrian graph
    (out of coverage, graph unavailable, or no reachable vertices).
    """
    if max_minutes <= 0:
        return None
    lat_q, lon_q = quantize_coord(lat, lon)
    return _explore_quantized(lat_q, lon_q, round(max_minutes))
