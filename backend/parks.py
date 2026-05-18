"""
CPD parks heatmap loader and isochrone clip for the Neighborhood Explorer.

Loads `backend/data/parks_polygons.json` once at first use, builds a
shapely STRtree over each park's outer-ring Polygon, and exposes
`parks_in_polygon(polygon)` — the runtime hook used by the `/explore`
endpoint to answer "which CPD parks fall inside this isochrone, and
what is their footprint?"

The artifact is baked by `scripts/build_parks.py` from the Chicago Data
Portal "CPD_Parks" dataset. Each entry carries `name`, `acres`, and a
single outer ring; MultiPolygon parks are pre-split into one entry per
outer ring sharing `name` + `acres`. At runtime we group the clipped
pieces back by `name` so the response emits one Feature per park (a
MultiPolygon if the park has multiple parcels inside the isochrone).

The output shape is a GeoJSON FeatureCollection with `properties.name`
and `properties.acres` on each feature — distinct from the residential
heatmap (single unioned MultiPolygon, no per-park identity) so the
frontend can render park popups. The same `parks_polygons.json` file
also feeds FEAT-4's `_bake_green_signals` step in `fetch_street_graph.py`,
where `acres` drives the log-scaled park-size multiplier on the
per-edge `park_proximity_score` baked into `street_graph_igraph.pkl`.

Clip pipeline (STRtree prefilter → prep+intersect → group-and-union)
lives in `heatmap_clipper.py`; this module owns the JSON shape and the
per-park grouping rule only.
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

PARKS_PATH = Path(__file__).resolve().parent / "data" / "parks_polygons.json"

_lock = threading.Lock()
_parks: list[dict[str, Any]] | None = None
_polys: list[Polygon] | None = None
_tree: STRtree | None = None


def _ensure_index() -> tuple[list[dict[str, Any]], STRtree | None]:
    """Lazily load the parks artifact and build the STRtree."""
    global _parks, _polys, _tree
    if _parks is not None and _tree is not None:
        return _parks, _tree
    with _lock:
        if _parks is not None and _tree is not None:
            return _parks, _tree
        entries: list[dict[str, Any]] = []
        if PARKS_PATH.exists():
            try:
                data = json.loads(PARKS_PATH.read_text(encoding="utf-8"))
                entries = [e for e in data.get("parks", []) if (e.get("name") or "").strip()]
            except (OSError, ValueError) as e:
                logger.error("Failed to read %s (%s: %s)", PARKS_PATH, type(e).__name__, e)
                entries = []
        else:
            logger.warning("Parks artifact missing at %s", PARKS_PATH)

        polys, valid = load_polygon_rings(entries)
        parks = [
            {"name": entries[i]["name"].strip(), "acres": entries[i].get("acres")}
            for i in valid
        ]
        _parks = parks
        _polys = polys
        _tree = STRtree(polys) if polys else STRtree([])
        if parks:
            logger.info("Loaded %d CPD park rings", len(parks))
        return _parks, _tree


def reset_index_for_tests() -> None:
    """Clear the cached index so test fixtures can swap the data file."""
    global _parks, _polys, _tree
    with _lock:
        _parks = None
        _polys = None
        _tree = None


def parks_in_polygon(polygon) -> dict[str, Any] | None:
    """Return a GeoJSON FeatureCollection of parks clipped to `polygon`.

    Shape:
        {
          "type": "FeatureCollection",
          "features": [
            { "type": "Feature",
              "properties": { "name": "Lincoln Park", "acres": 1208.0 },
              "geometry": { "type": "Polygon"|"MultiPolygon", ... } },
            ...
          ]
        }

    Returns `None` when no park polygons overlap the isochrone — the
    caller passes that through as `null` so the frontend can hide the
    layer.
    """
    parks, tree = _ensure_index()
    if not parks:
        return None
    # `acres` is the same across every ring of a multi-parcel park by
    # construction in the ingest script — take the first non-None value
    # from the members hitting this group.
    def _props(name, member_indices):
        acres = None
        for i in member_indices:
            a = parks[i].get("acres")
            if a is not None:
                acres = a
                break
        return {"name": name, "acres": acres}

    return clip_polygons_to_feature_collection(
        polygon,
        polys=_polys,
        tree=tree,
        group_key=lambda i: parks[i]["name"],
        properties_for=_props,
    )
