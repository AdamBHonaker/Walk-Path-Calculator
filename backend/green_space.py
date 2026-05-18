"""
Non-CPD green-space heatmap loader and isochrone clip for the
Neighborhood Explorer. Complements `parks.py` (CPD park footprints) by
clipping the OSM-derived green-space polygons that CPD's dataset
deliberately excludes — cemeteries, golf courses, Forest Preserves /
nature reserves, and recreation grounds.

Loads `backend/data/green_space_polygons.json` once at first use,
builds a shapely STRtree over each polygon, and exposes
`green_space_in_polygon(polygon)` — the runtime hook used by the
`/explore` endpoint.

Output shape mirrors `parks.py` and `tree_canopy.py`: a GeoJSON
FeatureCollection. One Feature per `kind` group — all clipped
polygons of a given kind are unioned and emitted as a single
MultiPolygon, with `properties.kind` set so the frontend can paint
each kind distinctly (cemeteries differently from golf courses, etc.)
without N round-trips.

Clip pipeline (STRtree prefilter → prep+intersect → group-and-union)
lives in `heatmap_clipper.py`; this module owns the JSON shape and the
per-kind grouping rule only.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

from shapely.geometry import Polygon
from shapely.strtree import STRtree

from heatmap_clipper import (
    clip_polygons_to_feature_collection,
    load_polygon_rings,
)

logger = logging.getLogger(__name__)

GREEN_SPACE_PATH = Path(__file__).resolve().parent / "data" / "green_space_polygons.json"

VALID_KINDS = frozenset({"cemetery", "golf_course", "nature_reserve", "recreation_ground"})

_lock = threading.Lock()
_kinds: list[str] | None = None
_polys: list[Polygon] | None = None
_tree: STRtree | None = None


def _ensure_index() -> tuple[list[str], STRtree | None]:
    """Lazily load the green-space artifact and build the STRtree."""
    global _kinds, _polys, _tree
    if _kinds is not None and _tree is not None:
        return _kinds, _tree
    with _lock:
        if _kinds is not None and _tree is not None:
            return _kinds, _tree
        entries: list[dict[str, Any]] = []
        if GREEN_SPACE_PATH.exists():
            try:
                data = json.loads(GREEN_SPACE_PATH.read_text(encoding="utf-8"))
                entries = [
                    e for e in data.get("polygons", [])
                    if e.get("kind") in VALID_KINDS
                ]
            except (OSError, ValueError) as e:
                logger.error("Failed to read %s (%s: %s)", GREEN_SPACE_PATH, type(e).__name__, e)
                entries = []
        else:
            logger.warning("Green-space artifact missing at %s", GREEN_SPACE_PATH)

        polys, valid = load_polygon_rings(entries)
        kinds = [entries[i]["kind"] for i in valid]
        _kinds = kinds
        _polys = polys
        _tree = STRtree(polys) if polys else STRtree([])
        if kinds:
            by_kind: dict[str, int] = {}
            for k in kinds:
                by_kind[k] = by_kind.get(k, 0) + 1
            logger.info("Loaded %d green-space polygons (%s)", len(kinds), by_kind)
        return _kinds, _tree


def reset_index_for_tests() -> None:
    """Clear the cached index so test fixtures can swap the data file."""
    global _kinds, _polys, _tree
    with _lock:
        _kinds = None
        _polys = None
        _tree = None


def green_space_in_polygon(polygon) -> dict[str, Any] | None:
    """Return a GeoJSON FeatureCollection of green space clipped to `polygon`.

    Shape:
        {
          "type": "FeatureCollection",
          "features": [
            { "type": "Feature",
              "properties": { "kind": "cemetery" | "golf_course" | ... },
              "geometry": { "type": "MultiPolygon", ... } },
            ...
          ]
        }

    Returns `None` when no green-space polygons overlap the isochrone.
    """
    kinds, tree = _ensure_index()
    if not kinds:
        return None
    return clip_polygons_to_feature_collection(
        polygon,
        polys=_polys,
        tree=tree,
        group_key=lambda i: kinds[i],
        properties_for=lambda kind, _members: {"kind": kind},
    )
