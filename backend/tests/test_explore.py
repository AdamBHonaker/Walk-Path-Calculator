import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from shapely.geometry import shape

import explore
import walking


pytestmark = pytest.mark.skipif(
    walking._load_graph() is None,
    reason="street graph unavailable in this environment",
)


# Wicker Park / Bucktown — central enough that a 20-min isochrone stays
# well inside the Chicago bbox, so behavior is independent of map edges.
ORIGIN_LAT = 41.9088
ORIGIN_LON = -87.6796


class TestExplore:
    def test_returns_polygon_and_stats(self):
        result = explore.explore(ORIGIN_LAT, ORIGIN_LON, 20)
        assert result is not None
        poly = shape(result["polygon"])
        assert poly.is_valid
        assert not poly.is_empty
        assert poly.contains_properly(shape({"type": "Point", "coordinates": [ORIGIN_LON, ORIGIN_LAT]}))
        stats = result["stats"]
        assert stats["node_count"] > 100
        # 20 min @ 3 mph ≈ 1 mile radius → polygon area is bounded.
        # Allow a wide window for graph-density variance, but reject obvious bugs.
        assert 0.1 < stats["area_sq_mi"] < 25.0

    def test_polygon_grows_with_budget(self):
        small = explore.explore(ORIGIN_LAT, ORIGIN_LON, 10)
        large = explore.explore(ORIGIN_LAT, ORIGIN_LON, 30)
        assert small is not None and large is not None
        assert small["stats"]["node_count"] < large["stats"]["node_count"]
        assert small["stats"]["area_sq_mi"] < large["stats"]["area_sq_mi"]

    def test_returns_neighborhood_names(self):
        result = explore.explore(ORIGIN_LAT, ORIGIN_LON, 25)
        assert result is not None
        names = result["reachable_neighborhoods"]
        assert isinstance(names, list)
        assert all(isinstance(n, str) for n in names)
        # No coordinate-key duplicates — title-cased aliases at the same
        # point are filtered by the (lat, lon) seen-set.
        assert len(names) == len(set(names))

    def test_zero_or_negative_minutes_returns_none(self):
        assert explore.explore(ORIGIN_LAT, ORIGIN_LON, 0) is None
        assert explore.explore(ORIGIN_LAT, ORIGIN_LON, -5) is None

    def test_caches_repeat_calls(self):
        explore._explore_quantized.cache_clear()
        explore.explore(ORIGIN_LAT, ORIGIN_LON, 15)
        first = explore._explore_quantized.cache_info()
        explore.explore(ORIGIN_LAT, ORIGIN_LON, 15)
        second = explore._explore_quantized.cache_info()
        assert second.hits == first.hits + 1
