import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from shapely.geometry import shape

import explore


pytestmark = pytest.mark.requires_artifact("street_graph_igraph.pkl")


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

    def test_within_reach_landmarks_shape_and_sort(self):
        result = explore.explore(ORIGIN_LAT, ORIGIN_LON, 25)
        assert result is not None
        polygon = shape(result["polygon"])
        landmarks = explore.within_reach_landmarks(polygon, ORIGIN_LAT, ORIGIN_LON)
        assert isinstance(landmarks, list)
        for item in landmarks:
            assert set(item.keys()) == {"name", "lat", "lon"}
            assert isinstance(item["name"], str)
            assert isinstance(item["lat"], float)
            assert isinstance(item["lon"], float)
        # Ascending haversine distance from the origin.
        from utils import haversine_miles
        distances = [
            haversine_miles(ORIGIN_LAT, ORIGIN_LON, p["lat"], p["lon"])
            for p in landmarks
        ]
        assert distances == sorted(distances), "landmarks must be sorted by distance"

    def test_within_reach_landmarks_only_returns_landmark_category(self):
        # Every name returned should match a `category == "landmarks"` record
        # in places_curated.json (i.e., the dataset is the sole source).
        import places as places_module
        all_landmarks = {
            p["name"]
            for p in places_module.all_places()
            if p.get("category") == "landmarks"
        }
        result = explore.explore(ORIGIN_LAT, ORIGIN_LON, 25)
        assert result is not None
        polygon = shape(result["polygon"])
        landmarks = explore.within_reach_landmarks(polygon, ORIGIN_LAT, ORIGIN_LON)
        assert landmarks, "expected at least one landmark in a 25-min Wicker Park isochrone"
        for item in landmarks:
            assert item["name"] in all_landmarks

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

    @pytest.mark.requires_artifact("data/chicago_boundary.json")
    def test_lakefront_polygon_is_clipped_to_boundary(self):
        # Streeterville — sits a few blocks from Navy Pier, so a generous
        # walking budget naturally extends the unclipped hull east into the
        # lake. The clip step should pull that overshoot back to the shoreline.
        explore._explore_quantized.cache_clear()
        result = explore.explore(41.8920, -87.6196, 35)
        assert result is not None
        poly = shape(result["polygon"])
        boundary = explore._get_chicago_boundary()
        assert boundary is not None
        # Allow a tiny floating-point slack (≤ 0.1% of the polygon area) for
        # rounding in the boundary geometry — anything larger means real
        # overshoot into the lake.
        overshoot = poly.difference(boundary).area / max(poly.area, 1e-12)
        # 0.01% tolerance — tight enough to catch real lake overshoot
        # (the old 0.1% allowed hundreds of m² past the shoreline).
        assert overshoot < 0.0001, f"polygon overshoots boundary by {overshoot:.5%}"
