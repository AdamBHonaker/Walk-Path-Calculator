"""
Performance budgets for the Neighborhood Explorer's polygon compute path.

Per FEATURE_PLANS.md FEAT #1, Chunk 4:
  - 30-minute isochrone must complete under 500 ms (polygon only).
  - 45-minute isochrone must complete under 1.5 s (slider worst case).

Reachable-node count grows roughly with time² (area scales with budget²),
so the 45 / 30 ratio is ~2.25× — both budgets land comfortably above that.

These tests measure *cold* compute time (LRU cache cleared before each run)
because that's what a user perceives on the first slider release at a new
position. The graph itself is pre-warmed once at module load so we don't
charge graph deserialization to the per-request budget — that cost is paid
exactly once at server startup in the real lifespan handler.

Each budget is taken as the median of three runs to reduce noise from
GC / OS scheduling. CI machines vary; if these prove flaky in CI, the
right fix is usually to widen the budget rather than retry, since the
real-world budget is a hard SLO not a probabilistic one.
"""

import os
import statistics
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

import explore
import walking


pytestmark = pytest.mark.requires_artifact("street_graph_igraph.pkl")


# Loop — central, dense graph coverage; a 45-minute isochrone from the Loop
# touches the largest plausible reachable set (the densest part of the
# pedestrian graph radiates outward in every direction).
ORIGIN_LAT = 41.8786
ORIGIN_LON = -87.6298

_RUNS = 3


def _measure_cold(max_minutes: float) -> float:
    """Return the median wall-time (seconds) across `_RUNS` cold computes."""
    samples: list[float] = []
    for _ in range(_RUNS):
        explore._explore_quantized.cache_clear()
        t0 = time.perf_counter()
        result = explore.explore(ORIGIN_LAT, ORIGIN_LON, max_minutes)
        elapsed = time.perf_counter() - t0
        assert result is not None, "explore returned None — graph or snap failure"
        samples.append(elapsed)
    return statistics.median(samples)


@pytest.fixture(scope="module", autouse=True)
def _prewarm_graph_and_caches():
    """Make sure the graph and column caches are hot before timing."""
    walking._load_graph()
    explore.explore(ORIGIN_LAT, ORIGIN_LON, 10)


class TestExplorePerf:
    def test_30_minute_isochrone_under_500ms(self):
        elapsed = _measure_cold(30)
        assert elapsed < 0.5, f"30-min isochrone took {elapsed*1000:.0f} ms, budget 500 ms"

    def test_45_minute_isochrone_under_1500ms(self):
        elapsed = _measure_cold(45)
        assert elapsed < 1.5, f"45-min isochrone took {elapsed*1000:.0f} ms, budget 1500 ms"

    def test_30_minute_node_count_under_80k(self):
        # The plan's reachable-set estimate. Caps the polygon work since
        # concave_hull cost scales with the input vertex count.
        explore._explore_quantized.cache_clear()
        result = explore.explore(ORIGIN_LAT, ORIGIN_LON, 30)
        assert result is not None
        assert result["stats"]["node_count"] <= 80_000, (
            f"30-min reachable set is {result['stats']['node_count']} nodes — "
            "if this fails the graph has grown unexpectedly and the perf "
            "budget needs to be re-validated."
        )
