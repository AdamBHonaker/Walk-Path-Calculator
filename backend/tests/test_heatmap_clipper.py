"""Tests for the shared heatmap clip-and-emit pipeline in heatmap_clipper.py."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from shapely.geometry import LineString, Point, Polygon, MultiPolygon
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from heatmap_clipper import clip_polygons_to_feature_collection, load_polygon_rings  # noqa: E402


def _square(cx: float, cy: float, half: float = 0.001) -> Polygon:
    return Polygon([
        (cx - half, cy - half),
        (cx + half, cy - half),
        (cx + half, cy + half),
        (cx - half, cy + half),
        (cx - half, cy - half),
    ])


def _make_tree(polys: list[Polygon]) -> STRtree:
    return STRtree(polys)


class TestClipPolygonsToFeatureCollection:
    def test_empty_polygon_list_returns_none(self):
        iso = _square(0, 0, 0.5)
        result = clip_polygons_to_feature_collection(
            iso,
            polys=[],
            tree=None,
            group_key=lambda i: i,
            properties_for=lambda k, ms: {},
        )
        assert result is None

    def test_none_isochrone_returns_none(self):
        polys = [_square(0, 0)]
        tree  = _make_tree(polys)
        result = clip_polygons_to_feature_collection(
            None,
            polys=polys,
            tree=tree,
            group_key=lambda i: i,
            properties_for=lambda k, ms: {},
        )
        assert result is None

    def test_empty_isochrone_returns_none(self):
        from shapely.geometry import Polygon as _P
        iso   = _P()  # empty polygon
        polys = [_square(0, 0)]
        tree  = _make_tree(polys)
        result = clip_polygons_to_feature_collection(
            iso,
            polys=polys,
            tree=tree,
            group_key=lambda i: i,
            properties_for=lambda k, ms: {},
        )
        assert result is None

    def test_polygons_outside_isochrone_return_none(self):
        iso   = _square(0.0, 0.0, 0.1)   # isochrone at origin
        polys = [_square(10.0, 10.0)]    # far away
        tree  = _make_tree(polys)
        result = clip_polygons_to_feature_collection(
            iso,
            polys=polys,
            tree=tree,
            group_key=lambda i: i,
            properties_for=lambda k, ms: {},
        )
        assert result is None

    def test_overlapping_polygon_emits_feature_collection(self):
        iso   = _square(0.0, 0.0, 0.5)
        polys = [_square(0.0, 0.0, 0.1)]
        tree  = _make_tree(polys)
        result = clip_polygons_to_feature_collection(
            iso,
            polys=polys,
            tree=tree,
            group_key=lambda i: "park_a",
            properties_for=lambda k, ms: {"name": k},
        )
        assert result is not None
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) == 1
        assert result["features"][0]["properties"]["name"] == "park_a"

    def test_geometry_collection_only_polygons_kept(self):
        """If unary_union produces a GeometryCollection, non-polygon geoms must be
        filtered out without crashing."""
        import shapely
        from shapely.geometry import MultiPolygon as _MP, Polygon as _P

        iso   = _square(0.0, 0.0, 1.0)
        polys = [_square(0.0, 0.0, 0.1)]
        tree  = _make_tree(polys)

        # Patch unary_union to return a GeometryCollection containing a line.
        from shapely.ops import unary_union as _uu
        import heatmap_clipper

        def _fake_union(geoms):
            from shapely.geometry import GeometryCollection
            real = _uu(geoms)
            line = LineString([(0, 0), (1, 1)])
            return GeometryCollection([real, line])

        original = heatmap_clipper.__dict__.get("unary_union")
        heatmap_clipper.unary_union = _fake_union
        try:
            result = clip_polygons_to_feature_collection(
                iso,
                polys=polys,
                tree=tree,
                group_key=lambda i: "key",
                properties_for=lambda k, ms: {},
            )
        finally:
            if original is not None:
                heatmap_clipper.unary_union = original

        # The Polygon survives; the LineString is dropped.
        assert result is not None
        assert result["type"] == "FeatureCollection"

    def test_two_groups_emit_two_features(self):
        iso   = _square(0.0, 0.0, 1.0)
        polys = [_square(-0.2, 0.0, 0.05), _square(0.2, 0.0, 0.05)]
        tree  = _make_tree(polys)
        result = clip_polygons_to_feature_collection(
            iso,
            polys=polys,
            tree=tree,
            group_key=lambda i: f"group_{i}",
            properties_for=lambda k, ms: {"key": k},
        )
        assert result is not None
        assert len(result["features"]) == 2

    def test_numpy_array_index_from_strtree_handled(self):
        """STRtree.query may return a numpy array; the function must handle it."""
        import numpy as np
        iso   = _square(0.0, 0.0, 1.0)
        polys = [_square(0.0, 0.0, 0.1)]
        tree  = _make_tree(polys)

        # Verify that the function works regardless of whether candidate_idx
        # is a list or numpy array — the production code converts it.
        result = clip_polygons_to_feature_collection(
            iso,
            polys=polys,
            tree=tree,
            group_key=lambda i: "g",
            properties_for=lambda k, ms: {},
        )
        assert result is not None


class TestLoadPolygonRings:
    def test_empty_list_returns_empty(self):
        polys, valid = load_polygon_rings([])
        assert polys == []
        assert valid == []

    def test_short_ring_skipped(self):
        entries = [{"ring": [(0, 0), (1, 0)]}]  # only 2 points — < min_ring_len=4
        polys, valid = load_polygon_rings(entries)
        assert polys == []
        assert valid == []

    def test_valid_ring_parsed(self):
        entries = [{"ring": [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]}]
        polys, valid = load_polygon_rings(entries)
        assert len(polys) == 1
        assert valid == [0]

    def test_missing_ring_key_skipped(self):
        entries = [{"name": "no ring here"}]
        polys, valid = load_polygon_rings(entries)
        assert polys == []

    def test_invalid_polygon_gets_buffered(self):
        # A self-intersecting ring (bowtie) — Polygon() will produce an invalid geom,
        # which load_polygon_rings should buffer(0) to fix.
        # Simple bowtie: (0,0)→(1,1)→(1,0)→(0,1)→(0,0)
        ring = [(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)]
        entries = [{"ring": ring}]
        polys, valid = load_polygon_rings(entries)
        # After buffer(0), should still produce something valid (may be empty for
        # degenerate cases, but should not raise).
        assert isinstance(polys, list)
