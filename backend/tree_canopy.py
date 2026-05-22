"""
Tree canopy heatmap loader and isochrone clip for the Neighborhood Explorer.

Loads `backend/data/tree_canopy_kde.json` once at first use, builds a
shapely STRtree over each cell's centroid Point, and exposes
`tree_canopy_in_polygon(polygon)` — the runtime hook used by the
`/explore` endpoint to answer "how much tree canopy falls inside this
isochrone, and where?"

The artifact is a sparse 50 m KDE grid baked by
`scripts/build_tree_canopy.py`. Each cell carries a normalized 0-1
density value; cells below `MIN_DENSITY_KEEP` (set during ingest) are
not present in the file at all.

The runtime groups cells into three density bands (≥ 0.05, ≥ 0.15,
≥ 0.40) and unions the 50 m squares of each band into a single
MultiPolygon. The response is a GeoJSON FeatureCollection of up to
three features, one per band, which the frontend paints as three
opacity steps. Returning unioned geometries (instead of per-cell
squares) keeps the wire payload small even for a 30-minute isochrone
covering thousands of cells.
"""

from __future__ import annotations

import json
import logging
import math
import threading
from pathlib import Path
from typing import Any

import numpy as np
from shapely.geometry import MultiPolygon, Point, Polygon, box, mapping
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree

logger = logging.getLogger(__name__)

TREE_CANOPY_PATH = Path(__file__).resolve().parent / "data" / "tree_canopy_kde.json"

# Three contour bands, matching the FEATURE_PLANS "Resolved design decisions"
# entry — the frontend paints them as low/mid/high opacity steps. Order is
# ascending so a cell is assigned to its highest qualifying band by
# iterating in reverse.
DENSITY_BANDS: tuple[tuple[str, float], ...] = (
    ("low",  0.05),
    ("mid",  0.15),
    ("high", 0.40),
)

# Chicago-latitude conversion for the 100 m cell footprint. We rebuild the
# half-extent in lat/lon degrees from the artifact's `cell_size_m`
# metadata so the runtime is robust to future cell-size changes in the
# ingest script. Fallback to 100 m if metadata is missing (matches the
# shipped grid — see TD-033, the 50 m OSM-KDE → 100 m NLCD migration).
_DEFAULT_CELL_SIZE_M = 100.0
_METERS_PER_DEG_LAT = 111_320.0
_CHI_REF_LAT_RAD = math.radians(41.85)

_lock = threading.Lock()
# Parallel float64 columns for the canopy cells. Replaces a former
# `list[dict]` layout (~250 B/cell of PyDict + PyFloat overhead) with three
# contiguous numpy arrays — typical Chicago artifact is ~30k cells, so this
# cuts working-set memory by ~3-5×. STRtree still wants individual Point
# geometries, so the centroid list stays alongside the columns.
_cell_lats: "np.ndarray | None" = None
_cell_lons: "np.ndarray | None" = None
_cell_densities: "np.ndarray | None" = None
_centroids: list[Point] | None = None
_tree: STRtree | None = None
_half_cell_lat_deg: float = 0.0
_half_cell_lon_deg: float = 0.0


def _half_cell_extents(cell_size_m: float) -> tuple[float, float]:
    """Return (half_lat_deg, half_lon_deg) for a square cell of `cell_size_m`."""
    half_m = cell_size_m / 2.0
    half_lat = half_m / _METERS_PER_DEG_LAT
    half_lon = half_m / (_METERS_PER_DEG_LAT * math.cos(_CHI_REF_LAT_RAD))
    return half_lat, half_lon


def _ensure_index() -> tuple["np.ndarray | None", STRtree | None]:
    """Lazily load the canopy KDE artifact and build the centroid STRtree.

    Returns `(_cell_densities, _tree)` — callers use the densities array to
    drive band assignment and use the STRtree query indices to look up
    coordinates via `_cell_lats` / `_cell_lons`.
    """
    global _cell_lats, _cell_lons, _cell_densities, _centroids, _tree
    global _half_cell_lat_deg, _half_cell_lon_deg
    if _cell_densities is not None and _tree is not None:
        return _cell_densities, _tree
    with _lock:
        if _cell_densities is not None and _tree is not None:
            return _cell_densities, _tree
        lats: list[float] = []
        lons: list[float] = []
        densities: list[float] = []
        cell_size_m = _DEFAULT_CELL_SIZE_M
        if TREE_CANOPY_PATH.exists():
            try:
                data = json.loads(TREE_CANOPY_PATH.read_text(encoding="utf-8"))
                cell_size_m = float(
                    (data.get("metadata") or {}).get("cell_size_m") or _DEFAULT_CELL_SIZE_M
                )
                for entry in data.get("cells", []):
                    try:
                        lat = float(entry["lat"])
                        lon = float(entry["lon"])
                        density = float(entry["density"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    lats.append(lat)
                    lons.append(lon)
                    densities.append(density)
            except (OSError, ValueError) as e:
                logger.error(
                    "Failed to read %s (%s: %s)",
                    TREE_CANOPY_PATH, type(e).__name__, e,
                )
        else:
            logger.warning("Tree canopy artifact missing at %s", TREE_CANOPY_PATH)

        _half_cell_lat_deg, _half_cell_lon_deg = _half_cell_extents(cell_size_m)
        _cell_lats = np.asarray(lats, dtype=np.float64)
        _cell_lons = np.asarray(lons, dtype=np.float64)
        _cell_densities = np.asarray(densities, dtype=np.float64)
        centroids = [Point(lon, lat) for lat, lon in zip(lats, lons)]
        _centroids = centroids
        _tree = STRtree(centroids) if centroids else STRtree([])
        if lats:
            logger.info("Loaded %d tree canopy cells (cell %.0f m)", len(lats), cell_size_m)
        return _cell_densities, _tree


def reset_index_for_tests() -> None:
    """Clear the cached index so test fixtures can swap the data file."""
    global _cell_lats, _cell_lons, _cell_densities, _centroids, _tree
    with _lock:
        _cell_lats = None
        _cell_lons = None
        _cell_densities = None
        _centroids = None
        _tree = None


def _band_for_density(d: float) -> str | None:
    """Return the highest band name a density value qualifies for, or None."""
    for name, threshold in reversed(DENSITY_BANDS):
        if d >= threshold:
            return name
    return None


def tree_canopy_in_polygon(polygon) -> dict[str, Any] | None:
    """Return a GeoJSON FeatureCollection of canopy bands clipped to `polygon`.

    Shape:
        {
          "type": "FeatureCollection",
          "features": [
            { "type": "Feature",
              "properties": { "density_band": "low" | "mid" | "high" },
              "geometry": { "type": "MultiPolygon", ... } },
            ...
          ]
        }

    Up to three features (one per density band, ascending). Returns
    `None` when no canopy cells fall inside the isochrone — the caller
    passes that through as `null` so the frontend can hide the layer.
    """
    if polygon is None or polygon.is_empty:
        return None
    densities, tree = _ensure_index()
    if densities is None or densities.size == 0:
        return None

    candidate_idx = tree.query(polygon)
    if isinstance(candidate_idx, np.ndarray):
        candidate_idx = candidate_idx.tolist()
    if not candidate_idx:
        return None

    prepared = prep(polygon)

    # Bucket cell squares by band. Build the square from the centroid
    # ± half-cell on each axis; the cells were emitted as centroids
    # specifically to make this cheap. Read lat/lon/density from the
    # parallel numpy columns by index — no per-cell dict lookup.
    lats_col = _cell_lats
    lons_col = _cell_lons
    band_squares: dict[str, list[Polygon]] = {name: [] for name, _ in DENSITY_BANDS}
    for i in candidate_idx:
        if not prepared.contains(_centroids[i]):
            continue
        band = _band_for_density(float(densities[i]))
        if band is None:
            continue
        lat = float(lats_col[i])
        lon = float(lons_col[i])
        square = box(
            lon - _half_cell_lon_deg, lat - _half_cell_lat_deg,
            lon + _half_cell_lon_deg, lat + _half_cell_lat_deg,
        )
        band_squares[band].append(square)

    features: list[dict[str, Any]] = []
    for name, _threshold in DENSITY_BANDS:
        squares = band_squares[name]
        if not squares:
            continue
        merged = unary_union(squares)
        if merged.is_empty:
            continue
        if isinstance(merged, Polygon):
            merged = MultiPolygon([merged])
        features.append({
            "type":       "Feature",
            "properties": {"density_band": name},
            "geometry":   mapping(merged),
        })

    if not features:
        return None
    return {"type": "FeatureCollection", "features": features}
