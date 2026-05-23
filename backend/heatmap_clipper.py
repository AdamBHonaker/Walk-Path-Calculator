"""
Shared isochrone clip-and-emit pipeline for the polygon heatmap layers.

`parks_in_polygon` and `green_space_in_polygon` previously each carried their
own copy of the same STRtree-prefilter / prep+intersect / group-and-union /
emit-FeatureCollection pipeline; this module owns that pipeline once.

`tree_canopy.py` and `places.residential_heatmap` are deliberately not routed
through here — tree canopy works on point centroids + synthesized squares
(different geometry primitive), and the residential heatmap returns a single
unioned MultiPolygon rather than a FeatureCollection (different output shape).
The cost of folding either of those in is more conditional plumbing than the
duplication it would remove.
"""

from __future__ import annotations

from typing import Any, Callable

import numpy as np
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree


def clip_polygons_to_feature_collection(
    polygon,
    *,
    polys: list[Polygon],
    tree: STRtree | None,
    group_key: Callable[[int], Any],
    properties_for: Callable[[Any, list[int]], dict],
    simplify_tolerance: float | None = None,
) -> dict[str, Any] | None:
    """Clip `polys` to `polygon`, group the survivors by `group_key`, and emit
    a GeoJSON FeatureCollection (one Feature per group).

    `group_key(i)` returns the hashable group identifier for `polys[i]` — park
    name, green-space kind, etc. `properties_for(key, member_indices)` returns
    the Feature's `properties` dict; callers use it to attach extras (acres,
    kind label, ...) sourced from a parallel metadata list.

    `simplify_tolerance`, when set, applies Douglas–Peucker on the unioned
    Feature geometry before `mapping()`. Cuts vertex count 60–80% at ~5 m
    tolerance with no visible change at the zoom levels the UI renders.

    Returns `None` when nothing overlaps `polygon` — the caller passes that
    through as `null` so the frontend can hide the layer.
    """
    if polygon is None or polygon.is_empty:
        return None
    if not polys or tree is None:
        return None

    candidate_idx = tree.query(polygon)
    if isinstance(candidate_idx, np.ndarray):
        candidate_idx = candidate_idx.tolist()
    if not candidate_idx:
        return None

    prepared = prep(polygon)

    groups: dict[Any, list] = {}
    members: dict[Any, list[int]] = {}
    for i in candidate_idx:
        poly = polys[i]
        if not prepared.intersects(poly):
            continue
        clipped = poly.intersection(polygon)
        if clipped.is_empty:
            continue
        key = group_key(i)
        groups.setdefault(key, []).append(clipped)
        members.setdefault(key, []).append(i)

    if not groups:
        return None

    features: list[dict[str, Any]] = []
    for key, pieces in groups.items():
        merged = unary_union(pieces)
        if merged.is_empty:
            continue
        if merged.geom_type == "GeometryCollection":
            polys_only = [g for g in merged.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
            if not polys_only:
                continue
            merged = unary_union(polys_only)
            if merged.is_empty:
                continue
        if simplify_tolerance is not None:
            merged = merged.simplify(simplify_tolerance, preserve_topology=True)
            if merged.is_empty:
                continue
        features.append({
            "type":       "Feature",
            "properties": properties_for(key, members[key]),
            "geometry":   mapping(merged),
        })

    if not features:
        return None
    return {"type": "FeatureCollection", "features": features}


def load_polygon_rings(
    entries: list[dict[str, Any]],
    *,
    ring_key: str = "ring",
    min_ring_len: int = 4,
) -> tuple[list[Polygon], list[int]]:
    """Parse a list of `{ring: [...], ...}` entries into validated Polygons.

    Returns `(polys, valid_indices)` — `valid_indices[k]` is the index into
    `entries` from which `polys[k]` was built. Callers use that to project
    parallel metadata (name, acres, kind) onto the surviving polygons
    without re-walking the JSON.

    Invalid polygons get `buffer(0)`'d once; truly empty / wrong-type
    results are dropped.
    """
    polys: list[Polygon] = []
    valid: list[int] = []
    for idx, entry in enumerate(entries):
        ring = entry.get(ring_key)
        if not ring or len(ring) < min_ring_len:
            continue
        try:
            poly = Polygon(ring)
        except (ValueError, TypeError):
            continue
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or not isinstance(poly, (Polygon, MultiPolygon)):
            continue
        polys.append(poly)
        valid.append(idx)
    return polys, valid
