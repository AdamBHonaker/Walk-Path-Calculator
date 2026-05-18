"""
Unit tests for backend/tree_canopy.py.

The runtime loads its KDE artifact lazily on first use, so each test
points `TREE_CANOPY_PATH` at a temp file and calls `reset_index_for_tests()`
to force a re-load with the test data. No network or real ingest needed.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box, mapping, shape

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import tree_canopy


def _write_artifact(path: Path, cells: list[dict], cell_size_m: int = 50) -> None:
    path.write_text(
        json.dumps({
            "metadata": {
                "source":      "test",
                "fetched_at":  "2026-05-12T00:00:00Z",
                "cell_size_m": cell_size_m,
                "bandwidth_m": 75,
                "cell_count":  len(cells),
                "bbox":        [41.64, -87.94, 42.02, -87.52],
            },
            "cells": cells,
        }),
        encoding="utf-8",
    )


@pytest.fixture
def patched_artifact(tmp_path, monkeypatch):
    """Yield a writer for an isolated test artifact. Each call resets the index."""
    path = tmp_path / "tree_canopy_kde.json"
    monkeypatch.setattr(tree_canopy, "TREE_CANOPY_PATH", path)

    def _set(cells, cell_size_m: int = 50):
        _write_artifact(path, cells, cell_size_m=cell_size_m)
        tree_canopy.reset_index_for_tests()

    yield _set
    tree_canopy.reset_index_for_tests()


class TestLoad:
    def test_missing_artifact_yields_no_index(self, tmp_path, monkeypatch):
        monkeypatch.setattr(tree_canopy, "TREE_CANOPY_PATH", tmp_path / "nope.json")
        tree_canopy.reset_index_for_tests()
        # Any polygon should harmlessly return None when no artifact is loaded.
        poly = box(-87.70, 41.90, -87.69, 41.91)
        assert tree_canopy.tree_canopy_in_polygon(poly) is None

    def test_loads_cells_from_artifact(self, patched_artifact):
        patched_artifact([
            {"lat": 41.905, "lon": -87.695, "density": 0.10},
            {"lat": 41.906, "lon": -87.695, "density": 0.50},
        ])
        # Polygon that contains both cell centroids.
        poly = box(-87.70, 41.90, -87.69, 41.91)
        result = tree_canopy.tree_canopy_in_polygon(poly)
        assert result is not None
        assert result["type"] == "FeatureCollection"
        bands = {f["properties"]["density_band"] for f in result["features"]}
        # 0.10 → low band (≥ 0.05); 0.50 → high band (≥ 0.40); no mid here.
        assert bands == {"low", "high"}


class TestClip:
    def test_empty_polygon_returns_none(self, patched_artifact):
        patched_artifact([{"lat": 41.905, "lon": -87.695, "density": 0.6}])
        # An empty geometry should short-circuit.
        empty = Polygon()
        assert tree_canopy.tree_canopy_in_polygon(empty) is None

    def test_no_overlap_returns_none(self, patched_artifact):
        # Cell sits at Logan Square; query polygon is at the south edge of the bbox.
        patched_artifact([{"lat": 41.93, "lon": -87.70, "density": 0.9}])
        far_poly = box(-87.60, 41.65, -87.59, 41.66)
        assert tree_canopy.tree_canopy_in_polygon(far_poly) is None

    def test_subthreshold_density_excluded(self, patched_artifact):
        # Density below the lowest band threshold (0.05) — kept in the artifact
        # (the file's MIN_DENSITY_KEEP gate is 0.02) but should NOT produce a
        # band feature.
        patched_artifact([{"lat": 41.905, "lon": -87.695, "density": 0.03}])
        poly = box(-87.70, 41.90, -87.69, 41.91)
        assert tree_canopy.tree_canopy_in_polygon(poly) is None

    def test_features_are_valid_multipolygons(self, patched_artifact):
        patched_artifact([
            {"lat": 41.905, "lon": -87.695, "density": 0.20},
            {"lat": 41.906, "lon": -87.695, "density": 0.20},
        ])
        poly = box(-87.70, 41.90, -87.69, 41.91)
        result = tree_canopy.tree_canopy_in_polygon(poly)
        assert result is not None
        feature = result["features"][0]
        geom = shape(feature["geometry"])
        assert geom.geom_type == "MultiPolygon"
        assert geom.is_valid
        assert not geom.is_empty

    def test_band_assignment_highest_qualifying(self, patched_artifact):
        # Boundary values: 0.05 → low, 0.15 → mid, 0.40 → high.
        patched_artifact([
            {"lat": 41.904, "lon": -87.695, "density": 0.05},
            {"lat": 41.905, "lon": -87.695, "density": 0.15},
            {"lat": 41.906, "lon": -87.695, "density": 0.40},
        ])
        poly = box(-87.70, 41.90, -87.69, 41.91)
        result = tree_canopy.tree_canopy_in_polygon(poly)
        bands = {f["properties"]["density_band"] for f in result["features"]}
        assert bands == {"low", "mid", "high"}
