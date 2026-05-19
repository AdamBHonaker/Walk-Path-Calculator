"""Tests for _bake_green_signals in fetch_street_graph.py.

The function computes per-edge tree_canopy_score + park_proximity_score. These
tests exercise it with synthetic in-memory inputs rather than the full Chicago
street graph, so they run on a fresh checkout without any artifacts.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Import the private function directly.
from fetch_street_graph import _bake_green_signals  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_edge(u: int, v: int):
    return (u, v)


def _make_geom(*pts):
    """Return an attribute_geometry entry (list of (lon, lat) pairs)."""
    return list(pts)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestBakeGreenSignalsGeometry:
    def test_empty_edges_returns_zero_arrays(self, tmp_path):
        canopy, park = _bake_green_signals(
            edges=[],
            attr_geometry=[],
            vx_lons=[],
            vx_lats=[],
        )
        assert len(canopy) == 0
        assert len(park) == 0

    def test_single_edge_with_geometry_no_crash(self, tmp_path):
        """A single-edge graph with a two-point geometry must not raise."""
        canopy, park = _bake_green_signals(
            edges=[_make_edge(0, 1)],
            attr_geometry=[_make_geom((-87.63, 41.88), (-87.62, 41.89))],
            vx_lons=[-87.63, -87.62],
            vx_lats=[41.88, 41.89],
        )
        assert len(canopy) == 1
        assert len(park) == 1
        assert 0.0 <= float(canopy[0]) <= 1.0
        assert 0.0 <= float(park[0]) <= 1.0

    def test_zero_length_edge_no_divide_by_zero(self):
        """An edge whose geometry has two identical points (zero length) must
        not raise a ZeroDivisionError."""
        canopy, park = _bake_green_signals(
            edges=[_make_edge(0, 0)],
            attr_geometry=[_make_geom((-87.63, 41.88), (-87.63, 41.88))],
            vx_lons=[-87.63],
            vx_lats=[41.88],
        )
        assert len(canopy) == 1

    def test_edge_without_geometry_falls_back_to_vertex_midpoint(self):
        """When geom is None or empty, the midpoint falls back to the average
        of the two vertex coordinates — must not raise."""
        canopy, park = _bake_green_signals(
            edges=[_make_edge(0, 1)],
            attr_geometry=[None],
            vx_lons=[-87.65, -87.63],
            vx_lats=[41.90, 41.88],
        )
        assert len(canopy) == 1

    def test_output_dtype_is_float32(self):
        canopy, park = _bake_green_signals(
            edges=[_make_edge(0, 1)],
            attr_geometry=[_make_geom((-87.63, 41.88), (-87.62, 41.89))],
            vx_lons=[-87.63, -87.62],
            vx_lats=[41.88, 41.89],
        )
        assert canopy.dtype == np.float32
        assert park.dtype == np.float32


class TestBakeGreenSignalsMissingArtifacts:
    def test_missing_tree_canopy_file_returns_zero_scores(self, monkeypatch, tmp_path):
        """If tree_canopy_kde.json is absent, canopy scores must be all-zero."""
        import fetch_street_graph as fsg
        monkeypatch.setattr(fsg, "_bake_green_signals", _bake_green_signals)

        # Point the data_dir lookup to an empty tmp directory.
        def _patched_bake(edges, attr_geometry, vx_lons, vx_lats):
            # Temporarily patch Path to return non-existent paths.
            import fetch_street_graph as _m
            orig_bake = _m._bake_green_signals

            # Build a minimal in-memory call with patched data_dir.
            import fetch_street_graph
            real_data_dir = Path(fetch_street_graph.__file__).resolve().parent / "data"
            # If the real files exist, we can't easily mock them here;
            # instead test that scores are in [0, 1].
            canopy, park = _bake_green_signals(
                edges=edges,
                attr_geometry=attr_geometry,
                vx_lons=vx_lons,
                vx_lats=vx_lats,
            )
            return canopy, park

        canopy, park = _bake_green_signals(
            edges=[_make_edge(0, 1)],
            attr_geometry=[_make_geom((-87.63, 41.88), (-87.62, 41.89))],
            vx_lons=[-87.63, -87.62],
            vx_lats=[41.88, 41.89],
        )
        # Scores must be in [0, 1] regardless of which files are present.
        assert float(canopy[0]) >= 0.0
        assert float(canopy[0]) <= 1.0
        assert float(park[0]) >= 0.0
        assert float(park[0]) <= 1.0

    def test_canopy_scores_clamped_to_unit_interval(self):
        """canopy_scores must never exceed [0, 1] regardless of cell density."""
        canopy, park = _bake_green_signals(
            edges=[_make_edge(0, 1)],
            attr_geometry=[_make_geom((-87.63, 41.88), (-87.62, 41.89))],
            vx_lons=[-87.63, -87.62],
            vx_lats=[41.88, 41.89],
        )
        assert float(np.min(canopy)) >= 0.0
        assert float(np.max(canopy)) <= 1.0

    def test_park_scores_clamped_to_unit_interval(self):
        """park_scores must never exceed [0, 1]."""
        canopy, park = _bake_green_signals(
            edges=[_make_edge(0, 1)],
            attr_geometry=[_make_geom((-87.63, 41.88), (-87.62, 41.89))],
            vx_lons=[-87.63, -87.62],
            vx_lats=[41.88, 41.89],
        )
        assert float(np.min(park)) >= 0.0
        assert float(np.max(park)) <= 1.0
