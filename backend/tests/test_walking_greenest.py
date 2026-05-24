"""Regression tests for the Feature 4 greenest-routing weight function.

The greenest flavor's weight is

    L * max(_GREEN_DETOUR_FLOOR,
            1 - _GREEN_FOOTWAY_WEIGHT * is_footway_or_path
              - _GREEN_CANOPY_WEIGHT  * tree_canopy_score
              - _GREEN_PARK_WEIGHT    * park_proximity_score)

The combined formula activates only when the v3 pickle's canopy + park columns
are loaded; v1 graphml / v2 pickle loads fall back to the legacy footway-only
discount. These tests pin both branches and the per-edge floor.

Most fixtures hit the real Chicago street graph because the calibration
question — "does this formula prefer routes that linger under parks?" — only
makes sense against real geometry. They skip cleanly when the pickle is missing
so the suite still passes on a fresh checkout.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import walking  # noqa: E402


@pytest.fixture(scope="module")
def _graph_loaded():
    """Ensure the street graph is loaded once for the whole module.

    The @requires_artifact mark on each consumer class handles the
    skip-locally / fail-in-CI gate before this fixture ever runs.
    """
    g = walking._load_graph()
    assert g is not None, "graph should be loaded when artifact is present"
    return g


# ---------------------------------------------------------------------------
# Weight-vector pinning — exercise _build_flavor_weights directly. These don't
# require the actual graph, just the populated edge cache columns.
# ---------------------------------------------------------------------------

@pytest.mark.requires_artifact("street_graph_igraph.pkl")
class TestGreenestWeightVector:
    def test_v3_pickle_populates_canopy_and_park_columns(self, _graph_loaded):
        assert walking._edge_tree_canopy is not None, "v3 pickle should populate canopy column"
        assert walking._edge_park_proximity is not None, "v3 pickle should populate park column"
        n = len(walking._edge_lengths)
        assert len(walking._edge_tree_canopy) == n
        assert len(walking._edge_park_proximity) == n

    def test_canopy_and_park_scores_clamped_to_unit_interval(self, _graph_loaded):
        c = np.asarray(walking._edge_tree_canopy, dtype=np.float64)
        p = np.asarray(walking._edge_park_proximity, dtype=np.float64)
        assert float(c.min()) >= 0.0 and float(c.max()) <= 1.0
        assert float(p.min()) >= 0.0 and float(p.max()) <= 1.0

    def test_greenest_discount_respects_detour_floor(self, _graph_loaded):
        """Per-edge weight/length ratio must never dip below _GREEN_DETOUR_FLOOR."""
        weights = walking._get_flavor_weights("greenest")
        lengths = np.asarray(walking._edge_lengths, dtype=np.float64)
        w = np.asarray(weights, dtype=np.float64)
        mask = lengths > 0
        ratios = w[mask] / lengths[mask]
        assert float(ratios.min()) >= walking._GREEN_DETOUR_FLOOR - 1e-6, \
            f"some edge dipped below the {walking._GREEN_DETOUR_FLOOR}× detour floor"
        # The max-discount edge happens to land right at the floor (footway +
        # canopy=1 + park=1 → 1 - 0.20 - 0.15 - 0.15 = 0.50), so the bound is tight.
        assert float(ratios.max()) <= 1.0 + 1e-6, "no edge should be PENALIZED by greenest"

    def test_greenest_weight_strictly_less_than_length_for_some_edges(self, _graph_loaded):
        """The combined formula must actually discount edges that score
        non-zero on canopy or parks — otherwise we're just paying the cost of
        the new pickle columns for no behavioral change."""
        weights = walking._get_flavor_weights("greenest")
        lengths = np.asarray(walking._edge_lengths, dtype=np.float64)
        w = np.asarray(weights, dtype=np.float64)
        discounted = (w < lengths - 1e-3).sum()
        assert discounted > 1000, (
            f"expected thousands of discounted edges in the Chicago graph, got {discounted}"
        )

    def test_fastest_weights_are_unchanged_pure_lengths(self, _graph_loaded):
        """Feature 4 explicitly preserves byte-identical fastest behavior — the
        weight vector for fastest must be the raw lengths column."""
        weights = walking._get_flavor_weights("fastest")
        lengths = walking._edge_lengths
        # When the lengths column is a numpy array (v2+ pickle), `fastest`
        # returns it directly without copy. Use `is` so a future regression that
        # decides to materialize a defensive copy gets caught loudly.
        if isinstance(lengths, np.ndarray):
            assert weights is lengths, "fastest must return the lengths array unchanged"
        else:
            assert weights == "length", "v1 graphml fallback should use the 'length' attr"

    def test_fewest_turns_weights_are_length_plus_constant(self, _graph_loaded):
        """Feature 4 explicitly preserves fewest_turns behavior — weight is
        still length + _TURN_PENALTY_M everywhere, no canopy/park awareness."""
        weights = walking._get_flavor_weights("fewest_turns")
        lengths = np.asarray(walking._edge_lengths, dtype=np.float64)
        w = np.asarray(weights, dtype=np.float64)
        diffs = w - lengths
        # Every edge should differ from its length by exactly the turn penalty.
        assert np.allclose(diffs, walking._TURN_PENALTY_M, atol=1e-3), \
            "fewest_turns weight must be length + _TURN_PENALTY_M everywhere"


# ---------------------------------------------------------------------------
# Fixture routes — real Chicago coordinates picked to exercise the formula:
# (a) routes the greenest signal should clearly improve (Lincoln Park, etc.)
# (b) routes too short to justify any detour (utility errand)
# (c) a sanity case (boulevard system) to confirm we don't ROUTE AROUND green
#
# Per FEATURE_PLANS.md "Calibration is a real engineering task": these are the
# starting fixtures. Future calibration rounds add more / refine bounds.
# ---------------------------------------------------------------------------

# (label, origin_lat, origin_lon, dest_lat, dest_lon)
FIXTURE_ROUTES = [
    # The marquee example — across-the-park route into Lincoln Park.
    ("lakeview_east_to_lincoln_park", 41.9405, -87.6420, 41.9210, -87.6500),
    # Lakeview → Old Town: greenest may parallel Clark a block over toward the park.
    ("lakeview_to_old_town",          41.9405, -87.6486, 41.9100, -87.6362),
    # Short utility route — UIC → the Loop. Should not detour through a park.
    ("uic_to_loop_short_utility",     41.8757, -87.6500, 41.8819, -87.6298),
    # Boulevard system — greenest should pick this over a parallel arterial.
    ("logan_square_to_wicker_park",   41.9290, -87.7080, 41.9089, -87.6770),
]


def _build_edge_lookup() -> dict[tuple[int, int], int]:
    """Return {(min(u,v), max(u,v)) -> eid} for the loaded graph."""
    src = walking._edge_sources
    tgt = walking._edge_targets
    table: dict[tuple[int, int], int] = {}
    for eid in range(len(src)):
        u, v = int(src[eid]), int(tgt[eid])
        table[(min(u, v), max(u, v))] = eid
    return table


def _vpath_metrics(vpath: tuple, lookup: dict) -> tuple[float, float, float]:
    """Return (avg_canopy, avg_park, total_meters) over the edges of `vpath`,
    averaged by edge length."""
    canopy = walking._edge_tree_canopy
    parks  = walking._edge_park_proximity
    lens   = walking._edge_lengths
    tot_c = tot_p = tot_l = 0.0
    for u, v in zip(vpath, vpath[1:]):
        eid = lookup.get((min(int(u), int(v)), max(int(u), int(v))))
        if eid is None:
            continue
        L = float(lens[eid])
        tot_c += float(canopy[eid]) * L
        tot_p += float(parks[eid]) * L
        tot_l += L
    if tot_l <= 0:
        return 0.0, 0.0, 0.0
    return tot_c / tot_l, tot_p / tot_l, tot_l


@pytest.fixture(scope="module")
def edge_lookup(_graph_loaded):
    return _build_edge_lookup()


@pytest.mark.requires_artifact("street_graph_igraph.pkl")
class TestGreenestFixtureRoutes:
    @pytest.mark.parametrize("label,olat,olon,dlat,dlon", FIXTURE_ROUTES,
                             ids=[r[0] for r in FIXTURE_ROUTES])
    def test_greenest_distance_within_detour_floor(
        self, _graph_loaded, edge_lookup, label, olat, olon, dlat, dlon
    ):
        """Greenest distance must never exceed 2× fastest distance.

        The 0.5× per-edge floor caps the WORST-CASE Dijkstra weight ratio at 2×;
        the actual end-to-end distance ratio is always ≤ that bound.
        """
        fastest_sp  = walking._get_shortest_path(olat, olon, dlat, dlon, flavor="fastest")
        greenest_sp = walking._get_shortest_path(olat, olon, dlat, dlon, flavor="greenest")
        assert fastest_sp is not None and greenest_sp is not None
        _, _, fmeters = _vpath_metrics(fastest_sp[0],  edge_lookup)
        _, _, gmeters = _vpath_metrics(greenest_sp[0], edge_lookup)
        ratio = gmeters / max(fmeters, 1e-9)
        assert ratio <= 2.0, (
            f"{label}: greenest {gmeters:.1f}m exceeds 2× fastest {fmeters:.1f}m (ratio {ratio:.2f}×)"
        )

    def test_lincoln_park_route_picks_greener_path(self, _graph_loaded, edge_lookup):
        """The across-the-park route should expose the walker to materially
        more park area under greenest than under fastest. The bar is set well
        below what hand-inspection showed (0.187 vs 0.037 — 5×) so calibration
        room remains without losing the regression signal.
        """
        olat, olon, dlat, dlon = 41.9405, -87.6420, 41.9210, -87.6500
        f_sp = walking._get_shortest_path(olat, olon, dlat, dlon, flavor="fastest")
        g_sp = walking._get_shortest_path(olat, olon, dlat, dlon, flavor="greenest")
        f_canopy, f_park, _ = _vpath_metrics(f_sp[0], edge_lookup)
        g_canopy, g_park, _ = _vpath_metrics(g_sp[0], edge_lookup)
        assert g_park > f_park * 1.5, (
            f"greenest park exposure ({g_park:.3f}) should clearly beat fastest "
            f"({f_park:.3f}) on the Lincoln Park route"
        )

    def test_short_utility_route_does_not_pathologically_detour(
        self, _graph_loaded, edge_lookup
    ):
        """Negative test: a ~1.5 mile errand route should not lengthen by more
        than 10% under greenest. The floor + small coefficients keep small
        routes honest — the spec calls out 3-block grocery runs explicitly."""
        olat, olon, dlat, dlon = 41.8757, -87.6500, 41.8819, -87.6298
        f_sp = walking._get_shortest_path(olat, olon, dlat, dlon, flavor="fastest")
        g_sp = walking._get_shortest_path(olat, olon, dlat, dlon, flavor="greenest")
        _, _, f_m = _vpath_metrics(f_sp[0], edge_lookup)
        _, _, g_m = _vpath_metrics(g_sp[0], edge_lookup)
        ratio = g_m / max(f_m, 1e-9)
        assert ratio <= 1.10, (
            f"short utility route detoured by {ratio:.2f}× — too aggressive for a ~1.5 mi run"
        )


# ---------------------------------------------------------------------------
# Graceful degradation (TD-068) — the prior chunk-3 fail-fast guard refused to
# boot when v3 columns were missing. Multi-city support (Feature 1) needs to
# onboard cities whose source datasets don't include canopy or park data, so
# the contract relaxed: missing columns now zero-fill, log a clear warning,
# and set the `_greenest_degraded` flag so /health can surface the state.
# ---------------------------------------------------------------------------

@pytest.mark.requires_artifact("street_graph_igraph.pkl")
class TestV3GracefulDegradation:
    def test_v2_shaped_pickle_loads_with_degraded_flag(self, _graph_loaded, tmp_path, monkeypatch, caplog):
        """A pickle that lacks the v3 canopy + park columns must still load —
        greenest degrades to footway-only discount on the missing signals,
        and `greenest_degradation_status()` reports the degradation so
        /health can expose it (TD-068)."""
        import pickle as _pickle

        # Build a v2-shaped pickle by reading the v3 one and stripping the new keys.
        with open(walking.IGRAPH_PATH, "rb") as f:
            v3_data = _pickle.load(f)
        assert "edge_tree_canopy_f32" in v3_data and "edge_park_proximity_f32" in v3_data
        v2_data = {k: v for k, v in v3_data.items()
                   if k not in ("edge_tree_canopy_f32", "edge_park_proximity_f32")}
        v2_data["format_version"] = 2  # backdate so the populate path treats it as v2

        v2_path = tmp_path / "street_graph_igraph.pkl"
        with open(v2_path, "wb") as f:
            _pickle.dump(v2_data, f, protocol=_pickle.HIGHEST_PROTOCOL)

        # Force the loader to look at our v2-shaped pickle and forget the
        # previously-loaded v3 cache. We reset the cache state by hand because
        # `_evict_graph` short-circuits when nothing has been loaded yet inside
        # a fresh test process, and we need a deterministic reload.
        monkeypatch.setattr(walking, "IGRAPH_PATH", v2_path)
        monkeypatch.setattr(walking, "_graph_cache", None)
        monkeypatch.setattr(walking, "_graph_load_failed", False)
        # Force a graphml fallback impossibility too — the v2 pickle must
        # itself be the failure point, not a downstream graphml load.
        monkeypatch.setattr(walking, "GRAPH_PATH", tmp_path / "does_not_exist.graphml")
        # Bypass the SHA-256 integrity check — the test artifact intentionally
        # has a different hash than the production pickle, and we want the
        # v3-attribute guard to be the failure point, not the integrity check.
        monkeypatch.setattr(walking, "_STREET_GRAPH_SHA256", "")

        with caplog.at_level("WARNING", logger="walking"):
            result = walking._load_graph()

        assert result is not None, "v2 pickle must load with graceful degradation (TD-068)"
        assert walking._graph_load_failed is False, "graceful degradation must not flip the load-failed flag"
        # Both degradation warnings should have fired — one per missing column.
        canopy_warned = any("missing edge_tree_canopy_f32" in r.message for r in caplog.records)
        parks_warned  = any("missing edge_park_proximity_f32" in r.message for r in caplog.records)
        assert canopy_warned, "missing canopy column must log a clear degradation warning"
        assert parks_warned,  "missing parks column must log a clear degradation warning"
        # /health exposes this via greenest_degradation_status().
        status = walking.greenest_degradation_status()
        assert status["canopy"] is True, "canopy must report degraded after a v2-load"
        assert status["parks"]  is True, "parks must report degraded after a v2-load"

        # Restore the real graph for any test that runs after this one in the
        # same session. monkeypatch undoes IGRAPH_PATH / GRAPH_PATH at test
        # teardown — which hasn't happened yet — so we explicitly stop
        # monkeypatch first, then clear our cache mutations and reload
        # against the production paths. The TD-068 degradation flags will
        # be reset by the per-column check inside the fresh load.
        monkeypatch.undo()
        walking._graph_cache = None
        walking._graph_load_failed = False
        walking._load_graph()


@pytest.mark.requires_artifact("street_graph_igraph.pkl")
class TestAvoidStairsStillWorks:
    def test_avoid_stairs_layers_on_greenest_weights(self, _graph_loaded):
        """`avoid_stairs=True` adds _AVOID_STAIRS_PENALTY_M on top of the
        flavor weights. Verify the combined vector is EXACTLY additive:
        - On stairs edges: combined - base ≈ _AVOID_STAIRS_PENALTY_M
        - On non-stairs edges: combined - base ≈ 0
        """
        import numpy as np
        base = np.asarray(walking._get_flavor_weights("greenest"), dtype=np.float64)
        combined = np.asarray(walking._get_avoid_stairs_weights("greenest"), dtype=np.float64)
        assert combined.shape == base.shape

        diffs = combined - base
        # Build stairs mask from the edge cache
        highways = np.asarray(walking._edge_highways)
        stairs_mask = highways == "steps"
        non_stairs_mask = ~stairs_mask

        # On every non-stairs edge, avoid_stairs must add nothing.
        assert float(diffs[non_stairs_mask].max()) <= 1e-3, (
            "avoid_stairs penalty bled onto non-stairs edges"
        )
        # On stairs edges, the penalty must be exactly _AVOID_STAIRS_PENALTY_M
        # (within numerical tolerance). If there are no stairs in this graph,
        # the test still passes (avoid_stairs is a no-op on stairless graphs).
        if stairs_mask.any():
            np.testing.assert_allclose(
                diffs[stairs_mask],
                walking._AVOID_STAIRS_PENALTY_M,
                atol=1e-3,
                err_msg="avoid_stairs penalty not exactly additive on stairs edges",
            )


class TestPickleIntegrity:
    """Verify that _verify_pickle_integrity fails closed on SHA-256 mismatch
    and warns-and-loads when the env var is unset. These tests do NOT require
    the real pickle artifact — they write a tiny synthetic pickle to tmp_path."""

    def _write_tiny_pickle(self, path):
        import pickle as _pkl
        path.write_bytes(_pkl.dumps({"format_version": 3, "test": True}))
        return path

    def test_mismatch_returns_false_without_loading(self, tmp_path, monkeypatch, caplog):
        """SHA-256 mismatch must return False and must not call pickle.load."""
        import pickle as _pkl
        from unittest.mock import patch

        pkl_path = self._write_tiny_pickle(tmp_path / "test.pkl")
        # Set the env var to a known-wrong digest (all-zeros, 64 hex chars)
        monkeypatch.setattr(walking, "_STREET_GRAPH_SHA256", "0" * 64)

        with patch.object(_pkl, "load", side_effect=AssertionError("pickle.load must NOT be called")) as mock_load:
            with caplog.at_level("ERROR", logger="walking"):
                result = walking._verify_pickle_integrity(pkl_path)

        assert result is False, "mismatch must return False"
        mock_load.assert_not_called()
        assert any("SHA-256 mismatch" in r.message for r in caplog.records), (
            "must log the mismatch with 'SHA-256 mismatch' in the message"
        )

    def test_match_returns_true_and_logs_verified(self, tmp_path, monkeypatch, caplog):
        """Correct SHA-256 must return True and log a verification confirmation."""
        import hashlib

        pkl_path = self._write_tiny_pickle(tmp_path / "test.pkl")
        digest = hashlib.sha256(pkl_path.read_bytes()).hexdigest()
        monkeypatch.setattr(walking, "_STREET_GRAPH_SHA256", digest)

        with caplog.at_level("INFO", logger="walking"):
            result = walking._verify_pickle_integrity(pkl_path)

        assert result is True
        assert any("SHA-256 verified" in r.message for r in caplog.records)

    def test_unset_env_var_warns_once_and_returns_true(self, tmp_path, monkeypatch, caplog):
        """No env var → warn exactly once and allow load (backward compat)."""
        pkl_path = self._write_tiny_pickle(tmp_path / "test.pkl")
        monkeypatch.setattr(walking, "_STREET_GRAPH_SHA256", "")
        monkeypatch.setattr(walking, "_pickle_hash_warned", False)

        with caplog.at_level("WARNING", logger="walking"):
            result1 = walking._verify_pickle_integrity(pkl_path)
            result2 = walking._verify_pickle_integrity(pkl_path)

        assert result1 is True
        assert result2 is True
        warn_msgs = [r for r in caplog.records if "without integrity check" in r.message]
        assert len(warn_msgs) == 1, "warning must fire exactly once, not on every call"

    def test_load_graph_sets_failed_flag_on_mismatch(self, tmp_path, monkeypatch):
        """_load_graph must set _graph_load_failed=True when integrity check fails."""
        pkl_path = self._write_tiny_pickle(tmp_path / "test.pkl")
        monkeypatch.setattr(walking, "IGRAPH_PATH", pkl_path)
        monkeypatch.setattr(walking, "GRAPH_PATH", tmp_path / "no.graphml")
        monkeypatch.setattr(walking, "_STREET_GRAPH_SHA256", "0" * 64)
        monkeypatch.setattr(walking, "_graph_cache", None)
        monkeypatch.setattr(walking, "_graph_load_failed", False)

        result = walking._load_graph()

        assert result is None
        assert walking._graph_load_failed is True

        # Cleanup so the module stays usable after this test.
        walking._graph_load_failed = False


# ---------------------------------------------------------------------------
# Non-finite score sanitization (BUG-004) — a NaN/inf baked canopy or park
# score must never produce a NaN edge weight. A NaN weight silently corrupts
# the shortest-path priority queue (NaN comparisons are always false), so the
# greenest branch clamps non-finite discounts before returning. This runs
# without the artifact: `_build_flavor_weights` reads the module's edge cache
# columns and ignores its graph argument on the numpy path.
# ---------------------------------------------------------------------------

class TestGreenestNonFiniteSanitization:
    def test_nan_and_inf_scores_yield_a_finite_weight_vector(self, monkeypatch):
        lengths = np.array([100.0, 200.0, 300.0, 400.0], dtype=np.float64)
        # canopy[1]=NaN and parks[2]=NaN are the corruption under test;
        # canopy[3]=inf checks the floored-but-still-finite path.
        canopy = np.array([0.5, np.nan, 0.3, np.inf], dtype=np.float32)
        parks  = np.array([0.2, 0.4, np.nan, 0.1], dtype=np.float32)
        monkeypatch.setattr(walking, "_edge_lengths", lengths)
        monkeypatch.setattr(walking, "_edge_highways", ["", "", "", ""])
        monkeypatch.setattr(walking, "_edge_tree_canopy", canopy)
        monkeypatch.setattr(walking, "_edge_park_proximity", parks)

        weights = walking._build_flavor_weights(None, "greenest")
        w = np.asarray(weights, dtype=np.float64)

        assert np.all(np.isfinite(w)), \
            "greenest weight vector must stay finite even with NaN/inf scores"
        # A corrupt (NaN) edge degrades to a length-only weight (discount 1.0).
        assert w[1] == pytest.approx(lengths[1])
        assert w[2] == pytest.approx(lengths[2])
        # A clean edge still gets a real discount; the inf edge is floored.
        assert w[0] < lengths[0]
        assert w[3] == pytest.approx(lengths[3] * walking._GREEN_DETOUR_FLOOR)
