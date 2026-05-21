import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from shapely.geometry import Polygon

import places


@pytest.fixture(autouse=True)
def _reset_index():
    places.reset_index_for_tests()
    yield
    places.reset_index_for_tests()


def _box(south: float, west: float, north: float, east: float) -> Polygon:
    """Helper: lon/lat axis-aligned rectangle (matches places.py coord frame)."""
    return Polygon([(west, south), (east, south), (east, north), (west, north), (west, south)])


class TestPlacesInPolygon:
    @pytest.fixture
    def loop_box(self):
        # Tight box around the Loop — enough to capture cafes and museums
        # without dragging in tens of thousands of north-side restaurants.
        return _box(41.875, -87.640, 41.890, -87.620)

    def test_returns_places_inside_box(self, loop_box):
        results = places.places_in_polygon(loop_box)
        assert len(results) > 0
        for p in results:
            assert loop_box.contains(places.Point(p["lon"], p["lat"]))

    def test_filters_by_category(self, loop_box):
        all_results = places.places_in_polygon(loop_box)
        cafes_only = places.places_in_polygon(loop_box, categories=["coffee_bakery"])
        assert len(cafes_only) > 0
        assert len(cafes_only) < len(all_results)
        assert all(p["category"] == "coffee_bakery" for p in cafes_only)

    def test_multiple_categories(self, loop_box):
        results = places.places_in_polygon(
            loop_box, categories=["coffee_bakery", "art_museums"],
        )
        assert len(results) > 0
        cats = {p["category"] for p in results}
        assert cats <= {"coffee_bakery", "art_museums"}
        # Both categories should be represented in the Loop.
        assert "coffee_bakery" in cats
        assert "art_museums" in cats

    def test_unknown_category_returns_empty(self, loop_box):
        results = places.places_in_polygon(loop_box, categories=["does_not_exist"])
        assert results == []

    def test_empty_polygon_returns_empty(self):
        empty = Polygon()
        assert places.places_in_polygon(empty) == []

    def test_polygon_outside_chicago_returns_empty(self):
        # Iowa farmland — no Chicago places inside.
        results = places.places_in_polygon(_box(42.5, -93.0, 42.6, -92.9))
        assert results == []

    def test_index_built_only_once(self, loop_box):
        # Two queries should not rebuild the STRtree.
        places.places_in_polygon(loop_box)
        first_tree = places._tree
        places.places_in_polygon(loop_box)
        assert places._tree is first_tree


class TestDataFile:
    """Smoke tests against the checked-in places_osm.json artifact."""

    def test_file_exists(self):
        assert places.PLACES_OSM_PATH.exists(), (
            "places_osm.json missing — run "
            "`python backend/scripts/build_places_osm.py` to generate it."
        )

    def test_metadata_present(self):
        data = json.loads(places.PLACES_OSM_PATH.read_text(encoding="utf-8"))
        assert "metadata" in data
        assert "places" in data
        assert data["metadata"]["count"] == len(data["places"])
        assert data["metadata"]["source"] == "overpass"

    def test_all_known_categories_present(self):
        data = json.loads(places.PLACES_OSM_PATH.read_text(encoding="utf-8"))
        cats = {p["category"] for p in data["places"]}
        # Every category from the FEATURE_PLANS table that's OSM-sourced.
        expected = {
            "grocery", "medical", "train_stations", "gyms_fitness",
            "coffee_bakery", "restaurants", "bars_nightlife", "parks",
            "art_museums", "theaters", "bookstores", "schools",
            "places_of_worship",
        }
        missing = expected - cats
        assert not missing, f"Missing categories in places_osm.json: {missing}"

    def test_every_place_has_required_fields(self):
        data = json.loads(places.PLACES_OSM_PATH.read_text(encoding="utf-8"))
        for p in data["places"]:
            assert isinstance(p["category"], str) and p["category"]
            assert isinstance(p["name"], str) and p["name"]
            assert isinstance(p["lat"], (int, float))
            assert isinstance(p["lon"], (int, float))


class TestCuratedSources:
    """Smoke tests for the curated city-feed file (Chunk 6)."""

    def test_curated_file_present(self):
        assert places.PLACES_CURATED_PATH.exists(), (
            "places_curated.json missing — run "
            "`python backend/scripts/build_libraries.py` and "
            "`python backend/scripts/build_farmers_markets.py`."
        )

    def test_curated_metadata_lists_both_sources(self):
        data = json.loads(places.PLACES_CURATED_PATH.read_text(encoding="utf-8"))
        sources = {s["name"] for s in data["metadata"]["sources"]}
        assert "cpl_locations" in sources
        assert "farmers_markets_2013" in sources

    def test_libraries_loaded_into_index(self):
        # CPL category isn't in OSM ingestion, so it must come from curated.
        # Wide bbox covering most of Chicago — should hit dozens of branches.
        bbox = _box(41.66, -87.94, 42.02, -87.52)
        results = places.places_in_polygon(bbox, categories=["libraries"])
        assert len(results) > 30, f"expected many libraries city-wide, got {len(results)}"
        for p in results:
            assert p["category"] == "libraries"
            assert "Chicago Public Library" in p["name"]

    def test_farmers_markets_under_grocery_subcategory(self):
        bbox = _box(41.66, -87.94, 42.02, -87.52)
        results = places.places_in_polygon(bbox, categories=["grocery"])
        farmers = [p for p in results if p.get("subcategory") == "farmers_market"]
        # 2013 dataset has ~24 entries; expect at least a handful inside the city bbox.
        assert len(farmers) > 5

    def test_curated_metadata_lists_divvy(self):
        data = json.loads(places.PLACES_CURATED_PATH.read_text(encoding="utf-8"))
        sources = {s["name"] for s in data["metadata"]["sources"]}
        assert "cdp_divvy" in sources, (
            "cdp_divvy missing — run "
            "`python backend/scripts/build_divvy.py` with CDP credentials "
            "to populate Divvy stations."
        )

    def test_divvy_stations_loaded_into_index(self):
        # Divvy dataset has ~800 stations city-wide; a full-city bbox should
        # return well over 200 even accounting for inactive-status filtering.
        bbox = _box(41.66, -87.94, 42.02, -87.52)
        results = places.places_in_polygon(bbox, categories=["bike_share"])
        assert len(results) > 200, f"expected many Divvy stations city-wide, got {len(results)}"
        for p in results:
            assert p["category"] == "bike_share"
            assert p["source"] == "cdp_divvy"


class TestResidentialHeatmap:
    """Tests for places.residential_heatmap — the single-unioned MultiPolygon
    returned for the explorer's heatmap fill."""

    def test_none_polygon_returns_none(self):
        result = places.residential_heatmap(None)
        assert result is None

    def test_empty_polygon_returns_none(self):
        from shapely.geometry import Polygon
        result = places.residential_heatmap(Polygon())
        assert result is None

    def test_non_overlapping_polygon_returns_none(self):
        # A box in the Pacific Ocean — no Chicago residential polygons there.
        from shapely.geometry import Polygon
        pacific_box = Polygon([(-160, 20), (-159, 20), (-159, 21), (-160, 21), (-160, 20)])
        result = places.residential_heatmap(pacific_box)
        assert result is None

    def test_chicago_box_returns_geojson_mapping(self):
        # Logan Square — dense residential neighbourhood, should have
        # residential polygons in the real dataset.
        from shapely.geometry import Polygon
        logan_sq = Polygon([
            (-87.72, 41.92), (-87.69, 41.92),
            (-87.69, 41.94), (-87.72, 41.94),
            (-87.72, 41.92),
        ])
        result = places.residential_heatmap(logan_sq)
        if result is None:
            pytest.skip("residential_polygons.json absent or has no Logan Sq coverage")
        assert result["type"] in ("MultiPolygon", "Polygon"), (
            f"expected MultiPolygon or Polygon, got {result.get('type')}"
        )

    def test_result_coordinates_inside_query_polygon(self):
        """All coordinate vertices in the returned geometry must be within the
        original query polygon's bounding box (clipping must work correctly)."""
        from shapely.geometry import Polygon, shape
        logan_sq = Polygon([
            (-87.72, 41.92), (-87.69, 41.92),
            (-87.69, 41.94), (-87.72, 41.94),
            (-87.72, 41.92),
        ])
        result = places.residential_heatmap(logan_sq)
        if result is None:
            pytest.skip("residential_polygons.json absent or has no Logan Sq coverage")
        geom = shape(result)
        minx, miny, maxx, maxy = logan_sq.bounds
        # All ring coordinates must be within the query bbox (with tiny float slack).
        for coord in geom.geoms if hasattr(geom, "geoms") else [geom]:
            for x, y in list(coord.exterior.coords):
                assert minx - 1e-8 <= x <= maxx + 1e-8
                assert miny - 1e-8 <= y <= maxy + 1e-8
