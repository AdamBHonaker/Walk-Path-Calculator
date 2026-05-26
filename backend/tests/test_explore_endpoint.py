import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


pytestmark = pytest.mark.requires_artifact("street_graph_igraph.pkl")


class TestExploreValidation:
    def test_missing_origin_rejected(self):
        resp = client.post("/explore", json={"max_minutes": 20})
        assert resp.status_code == 422

    def test_origin_with_both_modes_rejected(self):
        resp = client.post("/explore", json={
            "origin": {"community_area": "Logan Square", "lat": 41.92, "lon": -87.7},
            "max_minutes": 20,
        })
        assert resp.status_code == 422

    def test_origin_with_neither_mode_rejected(self):
        resp = client.post("/explore", json={"origin": {}, "max_minutes": 20})
        assert resp.status_code == 422

    def test_origin_coords_outside_chicago_rejected(self):
        resp = client.post("/explore", json={
            "origin": {"lat": 40.0, "lon": -88.0},
            "max_minutes": 20,
        })
        assert resp.status_code == 422

    def test_max_minutes_too_low_rejected(self):
        resp = client.post("/explore", json={
            "origin": {"community_area": "Loop"},
            "max_minutes": 2,
        })
        assert resp.status_code == 422

    def test_max_minutes_too_high_rejected(self):
        resp = client.post("/explore", json={
            "origin": {"community_area": "Loop"},
            "max_minutes": 60,
        })
        assert resp.status_code == 422

    def test_unknown_community_area_returns_400(self):
        resp = client.post("/explore", json={
            "origin": {"community_area": "Atlantis"},
            "max_minutes": 20,
        })
        assert resp.status_code == 400

    def test_invalid_height_rejected(self):
        resp = client.post("/explore", json={
            "origin": {"community_area": "Loop"},
            "max_minutes": 20,
            "height_inches": 12,
        })
        assert resp.status_code == 422


class TestExploreSuccess:
    def test_community_area_origin(self):
        resp = client.post("/explore", json={
            "origin": {"community_area": "Logan Square"},
            "max_minutes": 20,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["max_minutes"] == 20
        assert len(body["origin_coords"]) == 2
        assert body["polygon"]["type"] in ("Polygon", "MultiPolygon")
        assert isinstance(body["reachable_neighborhoods"], list)
        assert body["stats"]["node_count"] > 0
        assert body["stats"]["area_sq_mi"] > 0
        assert isinstance(body["places"], list)
        # `residential_heatmap` is null when no `landuse=residential`
        # polygons fall inside the isochrone — most Chicago neighborhoods
        # have at least one, but the response shape always includes the key.
        assert "residential_heatmap" in body
        # `tree_canopy_heatmap` is null when no canopy cells overlap the
        # isochrone (or when the KDE artifact isn't present in this
        # environment); the shape always includes the key.
        assert "tree_canopy_heatmap" in body
        canopy = body["tree_canopy_heatmap"]
        if canopy is not None:
            assert canopy["type"] == "FeatureCollection"
            for feat in canopy["features"]:
                assert feat["properties"]["density_band"] in ("low", "mid", "high")
                assert feat["geometry"]["type"] in ("MultiPolygon", "Polygon")
        # `parks_heatmap` is null when no CPD park polygons fall inside
        # the isochrone; the shape always includes the key. When present,
        # each feature carries `name` + `acres` for popups and Feature 4.
        assert "parks_heatmap" in body
        parks_hm = body["parks_heatmap"]
        if parks_hm is not None:
            assert parks_hm["type"] == "FeatureCollection"
            for feat in parks_hm["features"]:
                assert isinstance(feat["properties"]["name"], str)
                assert feat["properties"]["name"]
                assert "acres" in feat["properties"]
                assert feat["geometry"]["type"] in ("MultiPolygon", "Polygon")
        # `green_space_heatmap` is null when no non-CPD green space overlaps;
        # when present, each feature is unioned per `kind` (cemetery /
        # golf_course / nature_reserve / recreation_ground).
        assert "green_space_heatmap" in body
        green = body["green_space_heatmap"]
        if green is not None:
            assert green["type"] == "FeatureCollection"
            kinds_seen = set()
            for feat in green["features"]:
                kind = feat["properties"]["kind"]
                assert kind in {"cemetery", "golf_course", "nature_reserve", "recreation_ground"}
                kinds_seen.add(kind)
                assert feat["geometry"]["type"] in ("MultiPolygon", "Polygon")
            # One feature per kind — no duplicate kinds.
            assert len(kinds_seen) == len(green["features"])

    def test_lat_lon_origin(self):
        # Wicker Park-ish — central, dense graph coverage.
        resp = client.post("/explore", json={
            "origin": {"lat": 41.9088, "lon": -87.6796},
            "max_minutes": 15,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["origin_coords"] == [41.9088, -87.6796]

    def test_categories_filter_returns_only_requested(self):
        resp = client.post("/explore", json={
            "origin": {"community_area": "Loop"},
            "max_minutes": 20,
            "categories": ["coffee_bakery"],
        })
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["places"]) > 0
        assert all(p["category"] == "coffee_bakery" for p in body["places"])
        # `source` is always populated — "osm" for OSM-derived, the
        # curated source key otherwise. Used by the frontend for citation.
        assert all(p.get("source") for p in body["places"])

    def test_unknown_category_returns_422(self):
        """TD-057 / B-04: previously /explore returned 200 with empty
        places for unknown categories — silent and unhelpful. Now the
        validator rejects at the boundary so a typo / stale rename
        surfaces immediately."""
        resp = client.post("/explore", json={
            "origin": {"community_area": "Loop"},
            "max_minutes": 15,
            "categories": ["does_not_exist"],
        })
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        # FastAPI's standard Pydantic-validation error shape.
        assert any(
            "unknown key" in (item.get("msg") or "").lower()
            for item in detail
        ), f"expected an 'unknown key' validation error, got {detail!r}"

    def test_no_categories_returns_all(self):
        # Omitting `categories` (or sending null) returns every place inside
        # the polygon — admin / debug behavior, not the frontend's default.
        resp = client.post("/explore", json={
            "origin": {"community_area": "Loop"},
            "max_minutes": 15,
        })
        assert resp.status_code == 200
        cats = {p["category"] for p in resp.json()["places"]}
        # Loop @ 15 min should hit at least three top-level categories
        # (restaurants, coffee, museums all dense downtown).
        assert len(cats) >= 3

    def test_residential_heatmap_present_for_residential_isochrone(self):
        # Logan Square is heavily residential — heatmap should be non-null.
        resp = client.post("/explore", json={
            "origin": {"community_area": "Logan Square"},
            "max_minutes": 20,
            "categories": [],
        })
        assert resp.status_code == 200
        heatmap = resp.json()["residential_heatmap"]
        assert heatmap is not None
        assert heatmap["type"] in ("MultiPolygon", "Polygon")

    def test_case_insensitive_community_area(self):
        resp = client.post("/explore", json={
            "origin": {"community_area": "logan square"},
            "max_minutes": 15,
        })
        assert resp.status_code == 200


class TestCpdParkPins:
    """Verifies the CPD-parks pin injection: the /explore handler derives
    one pin per park ∩ isochrone intersection, deduping any OSM `parks`
    entry that names the same park within ~75 m. Closes the gap where
    CPD parks not tagged in OSM never surfaced as clickable pins."""

    def test_response_includes_cpd_park_pins(self):
        # Lincoln Park community area sits squarely on top of several CPD
        # parks; a 20-minute walkshed should overlap many of them.
        resp = client.post("/explore", json={
            "origin": {"community_area": "Lincoln Park"},
            "max_minutes": 20,
            "categories": ["parks"],
        })
        assert resp.status_code == 200
        body = resp.json()
        cpd_pins = [p for p in body["places"] if p.get("source") == "cdp_parks"]
        if not cpd_pins:
            pytest.skip("parks_polygons.json absent or no CPD parks overlap this isochrone")
        for pin in cpd_pins:
            assert pin["category"] == "parks"
            assert pin["subcategory"] is None
            assert pin["name"]
            # `address` carries the park's acreage when available
            # (e.g., "12.3 acres"); when null the source had no acres.
            if pin["address"] is not None:
                assert pin["address"].endswith("acres")

    def test_cpd_pins_lie_inside_isochrone(self):
        # The point of polygon-aware injection: every pin coordinate must
        # be inside the isochrone polygon, not at the park's true centroid
        # (which can fall outside a tight walkshed for big parks).
        from shapely.geometry import Point, shape

        resp = client.post("/explore", json={
            "origin": {"community_area": "Lincoln Park"},
            "max_minutes": 15,
            "categories": ["parks"],
        })
        assert resp.status_code == 200
        body = resp.json()
        cpd_pins = [p for p in body["places"] if p.get("source") == "cdp_parks"]
        if not cpd_pins:
            pytest.skip("parks_polygons.json absent or no CPD parks overlap this isochrone")
        isochrone = shape(body["polygon"])
        for pin in cpd_pins:
            # Tiny float slack — `representative_point()` may land on the
            # boundary after coordinate quantization.
            assert isochrone.buffer(1e-6).contains(Point(pin["lon"], pin["lat"])), (
                f"CPD pin {pin['name']!r} at ({pin['lat']}, {pin['lon']}) "
                f"fell outside the isochrone polygon"
            )

    def test_pins_suppressed_when_parks_not_in_category_filter(self):
        # CPD pins are subject to the same category filter as OSM places:
        # if the caller didn't ask for `parks`, they shouldn't appear.
        resp = client.post("/explore", json={
            "origin": {"community_area": "Lincoln Park"},
            "max_minutes": 15,
            "categories": ["coffee_bakery"],
        })
        assert resp.status_code == 200
        cpd_pins = [p for p in resp.json()["places"] if p.get("source") == "cdp_parks"]
        assert cpd_pins == []

    def test_parks_heatmap_suppressed_but_pins_present_when_only_pins_requested(self):
        # When `with_heatmaps` excludes "parks" but the user wants the
        # parks pin category, the response should carry pins but null out
        # the heatmap footprint payload.
        resp = client.post("/explore", json={
            "origin": {"community_area": "Lincoln Park"},
            "max_minutes": 15,
            "categories": ["parks"],
            "with_heatmaps": ["residential"],
        })
        assert resp.status_code == 200
        body = resp.json()
        # Heatmap explicitly suppressed.
        assert body["parks_heatmap"] is None
        # But pins survived (assuming the artifact is present in this env).
        cpd_pins = [p for p in body["places"] if p.get("source") == "cdp_parks"]
        if not cpd_pins:
            pytest.skip("parks_polygons.json absent or no CPD parks overlap this isochrone")
        assert len(cpd_pins) > 0
