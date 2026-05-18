"""
Unit tests for backend/green_space.py.

Mirrors test_parks.py's pattern: each test points GREEN_SPACE_PATH at a
temp artifact and calls reset_index_for_tests() so the lazy loader
re-reads the fixture data.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box, shape

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import green_space


def _ring(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> list[list[float]]:
    return [
        [min_lon, min_lat],
        [max_lon, min_lat],
        [max_lon, max_lat],
        [min_lon, max_lat],
        [min_lon, min_lat],
    ]


def _write_artifact(path: Path, entries: list[dict]) -> None:
    path.write_text(
        json.dumps({
            "metadata": {
                "source":     "test",
                "fetched_at": "2026-05-12T00:00:00Z",
                "count":      len(entries),
            },
            "polygons": entries,
        }),
        encoding="utf-8",
    )


@pytest.fixture
def patched_artifact(tmp_path, monkeypatch):
    path = tmp_path / "green_space_polygons.json"
    monkeypatch.setattr(green_space, "GREEN_SPACE_PATH", path)

    def _set(entries):
        _write_artifact(path, entries)
        green_space.reset_index_for_tests()

    yield _set
    green_space.reset_index_for_tests()


class TestLoad:
    def test_missing_artifact_yields_no_features(self, tmp_path, monkeypatch):
        monkeypatch.setattr(green_space, "GREEN_SPACE_PATH", tmp_path / "nope.json")
        green_space.reset_index_for_tests()
        poly = box(-87.70, 41.90, -87.69, 41.91)
        assert green_space.green_space_in_polygon(poly) is None

    def test_invalid_kind_skipped(self, patched_artifact):
        patched_artifact([
            {"kind": "made_up", "name": None,
             "ring": _ring(-87.695, 41.905, -87.692, 41.908)},
        ])
        poly = box(-87.70, 41.90, -87.685, 41.91)
        assert green_space.green_space_in_polygon(poly) is None


class TestClip:
    def test_empty_polygon_returns_none(self, patched_artifact):
        patched_artifact([
            {"kind": "cemetery", "name": "Test",
             "ring": _ring(-87.695, 41.905, -87.692, 41.908)},
        ])
        assert green_space.green_space_in_polygon(Polygon()) is None

    def test_no_overlap_returns_none(self, patched_artifact):
        patched_artifact([
            {"kind": "cemetery", "name": "Far away",
             "ring": _ring(-87.70, 41.93, -87.69, 41.94)},
        ])
        far_poly = box(-87.60, 41.65, -87.59, 41.66)
        assert green_space.green_space_in_polygon(far_poly) is None

    def test_feature_per_kind(self, patched_artifact):
        # Two cemeteries + one golf course → response has 2 features.
        patched_artifact([
            {"kind": "cemetery",    "name": "A",
             "ring": _ring(-87.695, 41.905, -87.694, 41.906)},
            {"kind": "cemetery",    "name": "B",
             "ring": _ring(-87.693, 41.905, -87.692, 41.906)},
            {"kind": "golf_course", "name": "C",
             "ring": _ring(-87.691, 41.905, -87.690, 41.906)},
        ])
        poly = box(-87.70, 41.90, -87.685, 41.91)
        result = green_space.green_space_in_polygon(poly)
        assert result is not None
        assert result["type"] == "FeatureCollection"
        kinds = {f["properties"]["kind"] for f in result["features"]}
        assert kinds == {"cemetery", "golf_course"}
        for feat in result["features"]:
            geom = shape(feat["geometry"])
            assert geom.is_valid
            assert not geom.is_empty
            assert feat["geometry"]["type"] in ("Polygon", "MultiPolygon")

    def test_kind_union_into_multipolygon(self, patched_artifact):
        # Two disjoint cemeteries should union into a single MultiPolygon
        # feature, not two separate features.
        patched_artifact([
            {"kind": "cemetery", "name": "A",
             "ring": _ring(-87.695, 41.905, -87.694, 41.906)},
            {"kind": "cemetery", "name": "B",
             "ring": _ring(-87.692, 41.905, -87.691, 41.906)},
        ])
        poly = box(-87.70, 41.90, -87.685, 41.91)
        result = green_space.green_space_in_polygon(poly)
        assert len(result["features"]) == 1
        assert result["features"][0]["properties"]["kind"] == "cemetery"
        assert result["features"][0]["geometry"]["type"] == "MultiPolygon"

    def test_partial_overlap_clips_to_isochrone(self, patched_artifact):
        # Polygon extends past the query — clip must shrink it.
        patched_artifact([
            {"kind": "nature_reserve", "name": "Big",
             "ring": _ring(-87.70, 41.90, -87.68, 41.92)},
        ])
        poly = box(-87.695, 41.905, -87.692, 41.908)
        result = green_space.green_space_in_polygon(poly)
        clipped = shape(result["features"][0]["geometry"])
        full = Polygon(_ring(-87.70, 41.90, -87.68, 41.92))
        assert clipped.area < full.area
        assert clipped.is_valid
