"""
Unit tests for backend/parks.py.

The runtime loads its parks artifact lazily on first use, so each test
points `PARKS_PATH` at a temp file and calls `reset_index_for_tests()`
to force a re-load with the test data. No network or real ingest needed.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box, shape

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import parks


def _ring(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> list[list[float]]:
    return [
        [min_lon, min_lat],
        [max_lon, min_lat],
        [max_lon, max_lat],
        [min_lon, max_lat],
        [min_lon, min_lat],
    ]


def _write_artifact(path: Path, park_entries: list[dict]) -> None:
    path.write_text(
        json.dumps({
            "metadata": {
                "source":     "test",
                "fetched_at": "2026-05-12T00:00:00Z",
                "count":      len(park_entries),
            },
            "parks": park_entries,
        }),
        encoding="utf-8",
    )


@pytest.fixture
def patched_artifact(tmp_path, monkeypatch):
    path = tmp_path / "parks_polygons.json"
    monkeypatch.setattr(parks, "PARKS_PATH", path)

    def _set(park_entries):
        _write_artifact(path, park_entries)
        parks.reset_index_for_tests()

    yield _set
    parks.reset_index_for_tests()


class TestLoad:
    def test_missing_artifact_yields_no_features(self, tmp_path, monkeypatch):
        monkeypatch.setattr(parks, "PARKS_PATH", tmp_path / "nope.json")
        parks.reset_index_for_tests()
        poly = box(-87.70, 41.90, -87.69, 41.91)
        assert parks.parks_in_polygon(poly) is None

    def test_loads_parks_from_artifact(self, patched_artifact):
        patched_artifact([
            {"name": "Test Park",  "acres": 12.5,
             "ring": _ring(-87.695, 41.905, -87.692, 41.908)},
            {"name": "Other Park", "acres": 3.0,
             "ring": _ring(-87.690, 41.905, -87.687, 41.908)},
        ])
        poly = box(-87.70, 41.90, -87.685, 41.91)
        result = parks.parks_in_polygon(poly)
        assert result is not None
        assert result["type"] == "FeatureCollection"
        names = {f["properties"]["name"] for f in result["features"]}
        assert names == {"Test Park", "Other Park"}


class TestClip:
    def test_empty_polygon_returns_none(self, patched_artifact):
        patched_artifact([
            {"name": "X", "acres": 1.0,
             "ring": _ring(-87.695, 41.905, -87.692, 41.908)},
        ])
        assert parks.parks_in_polygon(Polygon()) is None

    def test_no_overlap_returns_none(self, patched_artifact):
        patched_artifact([
            {"name": "Logan Park", "acres": 5.0,
             "ring": _ring(-87.70, 41.93, -87.69, 41.94)},
        ])
        far_poly = box(-87.60, 41.65, -87.59, 41.66)
        assert parks.parks_in_polygon(far_poly) is None

    def test_feature_properties_carry_name_and_acres(self, patched_artifact):
        patched_artifact([
            {"name": "Lincoln Park", "acres": 1208.0,
             "ring": _ring(-87.695, 41.905, -87.692, 41.908)},
        ])
        poly = box(-87.70, 41.90, -87.69, 41.91)
        result = parks.parks_in_polygon(poly)
        feat = result["features"][0]
        assert feat["properties"]["name"] == "Lincoln Park"
        assert feat["properties"]["acres"] == 1208.0
        assert feat["geometry"]["type"] in ("Polygon", "MultiPolygon")
        geom = shape(feat["geometry"])
        assert geom.is_valid
        assert not geom.is_empty

    def test_multipolygon_park_emits_single_feature(self, patched_artifact):
        # Same park name across two disjoint outer rings (the ingest
        # script's MultiPolygon-split behavior). The runtime should
        # group them back into one Feature per park.
        patched_artifact([
            {"name": "Split Park", "acres": 50.0,
             "ring": _ring(-87.695, 41.905, -87.694, 41.906)},
            {"name": "Split Park", "acres": 50.0,
             "ring": _ring(-87.692, 41.905, -87.691, 41.906)},
        ])
        poly = box(-87.70, 41.90, -87.685, 41.91)
        result = parks.parks_in_polygon(poly)
        assert result is not None
        assert len(result["features"]) == 1
        feat = result["features"][0]
        assert feat["properties"]["name"] == "Split Park"
        assert feat["geometry"]["type"] == "MultiPolygon"

    def test_partial_overlap_clips_to_isochrone(self, patched_artifact):
        # Park extends well past the query polygon — the result must
        # be the intersection, not the full park footprint.
        patched_artifact([
            {"name": "Big Park", "acres": 100.0,
             "ring": _ring(-87.70, 41.90, -87.68, 41.92)},
        ])
        poly = box(-87.695, 41.905, -87.692, 41.908)
        result = parks.parks_in_polygon(poly)
        clipped = shape(result["features"][0]["geometry"])
        # Clipped area must be smaller than the full park (visually obvious
        # via bounds: park spans 0.02° square, query is 0.003° square).
        park_full = Polygon(_ring(-87.70, 41.90, -87.68, 41.92))
        assert clipped.area < park_full.area
        assert clipped.is_valid
