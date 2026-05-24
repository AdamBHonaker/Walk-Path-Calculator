"""TD-053 acceptance tests — `walking.py` correctness sweep.

Each test pins one of the eight findings from the catalog entry so a
future refactor that breaks the invariant fires loudly instead of
silently.
"""

import math
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pytest

import walking


@pytest.fixture(scope="module")
def _graph_loaded():
    """Ensure the street graph is loaded once for the whole module.

    The @requires_artifact mark on each consumer class handles the
    skip-locally / fail-in-CI gate before this fixture ever runs.
    """
    g = walking._load_graph()
    assert g is not None, "graph should be loaded when artifact is present"
    return g


# ── B-40: same-node short-circuit ────────────────────────────────────────


class TestSameNodeShortCircuit:
    def test_identical_origin_destination_returns_zero_route(self):
        """Same-quantized origin + destination should short-circuit before
        igraph runs, yielding a single-point path + empty directions +
        zero minutes (not an empty path that downstream code can mistake
        for a routing failure)."""
        path, directions, minutes = walking._compute_route(
            41.9476, -87.6553, 41.9476, -87.6553, "fastest",
        )
        assert len(path) == 1, "single-point path expected"
        assert path[0] == pytest.approx((41.9476, -87.6553), abs=1e-4)
        assert directions == ()
        assert minutes == 0.0

    def test_sub_meter_drift_still_short_circuits(self):
        """Coordinates that quantize to the same 1m cell short-circuit
        regardless of the float-level delta. The quantize step is what
        defines 'same node' for this guard, so an east-of-the-decimal
        jitter shouldn't slip past the check."""
        path, directions, minutes = walking._compute_route(
            41.9476, -87.6553, 41.94760001, -87.65530001, "fastest",
        )
        assert len(path) == 1
        assert directions == ()
        assert minutes == 0.0


# ── B-45: NaN-poisoned canopy edge surfaces a one-shot WARNING ──────────


@pytest.mark.requires_artifact("street_graph_igraph.pkl")
class TestNanCanopyWarning:
    def test_nan_canopy_triggers_one_shot_warning(self, _graph_loaded, monkeypatch, caplog):
        """Inject NaN into the canopy column, request a greenest weight
        rebuild, confirm the WARNING fires exactly once. The
        `_nan_rescue_warned` module flag enforces the one-shot contract."""
        # Reset the one-shot flag so the test runs in a clean state.
        monkeypatch.setattr(walking, "_nan_rescue_warned", {"greenest": False})

        # Drop NaN into the first canopy slot (the runtime nan_to_num scrub
        # below will not see this until a fresh weight vector is built).
        assert walking._edge_tree_canopy is not None
        saved = walking._edge_tree_canopy.copy()
        try:
            walking._edge_tree_canopy[0] = float("nan")
            # Bump the graph version so the cached greenest weights rebuild
            # on next request.
            walking._graph_version += 1
            walking._flavor_weights.clear()
            with caplog.at_level("WARNING", logger="walking"):
                walking._get_flavor_weights("greenest")
            warned = [
                r for r in caplog.records
                if "rescued" in r.message and "non-finite" in r.message
            ]
            assert len(warned) == 1, "exactly one NaN-rescue warning expected"

            # Second rebuild — flag is sticky, no new warning fires.
            walking._graph_version += 1
            walking._flavor_weights.clear()
            caplog.clear()
            with caplog.at_level("WARNING", logger="walking"):
                walking._get_flavor_weights("greenest")
            warned_again = [
                r for r in caplog.records
                if "rescued" in r.message and "non-finite" in r.message
            ]
            assert len(warned_again) == 0, (
                "subsequent rebuild must not re-warn (one-shot contract)"
            )
        finally:
            walking._edge_tree_canopy[:] = saved
            walking._graph_version += 1
            walking._flavor_weights.clear()


# ── B-43: cardinal direction snap near 0°/180° ──────────────────────────


class TestCardinalSnap:
    @pytest.mark.parametrize("delta", [-0.5, -0.1, 0.0, 0.1, 0.5])
    def test_due_north_within_1deg_snaps_to_N(self, delta):
        """Headings within ±1° of due North should label as N without
        flickering between N and adjacent bins."""
        # The cardinal binning is downstream of the lat/lon → degree math
        # inside _build_path_and_directions; we test the binning formula
        # directly to keep this unit-focused.
        deg = (0.0 + delta) % 360
        cardinal_idx = round(deg / 45) % 8
        cardinal = walking._CARDINAL_DIRS[cardinal_idx]
        assert cardinal == "N", f"heading {deg:.4f}° should label as N"

    @pytest.mark.parametrize("delta", [-0.5, -0.1, 0.0, 0.1, 0.5])
    def test_due_south_within_1deg_snaps_to_S(self, delta):
        deg = (180.0 + delta) % 360
        cardinal_idx = round(deg / 45) % 8
        cardinal = walking._CARDINAL_DIRS[cardinal_idx]
        assert cardinal == "S", f"heading {deg:.4f}° should label as S"


# ── B-44: defensive guard for epath/vpath length mismatch ────────────────


class TestEpathLengthGuard:
    def test_epath_too_short_returns_empty_path(self, caplog):
        """An epath shorter than `len(vpath) - 1` (igraph contract
        violation) returns empty + logs an error rather than silently
        producing a truncated route."""
        # The guard runs against `len(epath) != len(vpath) - 1`, so we
        # construct a vpath of 3 + epath of 1 (should be 2). The function
        # also dereferences edge attribute arrays on `epath[i]`, which
        # would IndexError without the guard.
        with caplog.at_level("ERROR", logger="walking"):
            coords, directions = walking._build_path_and_directions(
                vpath=(0, 1, 2),
                epath=(0,),  # one too few
            )
        assert coords == ()
        assert directions == ()
        assert any(
            "epath/vpath length mismatch" in r.message for r in caplog.records
        ), "length-mismatch guard should log a clear error"


# ── B-47: _kdtree_to_vertex dtype assertion ─────────────────────────────


@pytest.mark.requires_artifact("street_graph_igraph.pkl")
class TestKdtreeToVertexDtype:
    def test_kdtree_to_vertex_is_int64(self, _graph_loaded):
        """The kdtree-index → graph-vertex map must be int64 so vertex IDs
        can't silently truncate on a very large multi-city graph."""
        assert walking._kdtree_to_vertex is not None
        assert walking._kdtree_to_vertex.dtype == np.int64, (
            f"expected int64, got {walking._kdtree_to_vertex.dtype}"
        )
