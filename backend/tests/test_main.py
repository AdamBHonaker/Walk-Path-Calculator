import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Reset slowapi storage between tests so the 10/min limit doesn't bleed across cases."""
    try:
        app.state.limiter.reset()
    except Exception:
        pass
    yield


class TestHealth:
    def test_health_returns_ok(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestRouteValidation:
    def test_empty_origin_rejected(self):
        resp = client.post("/route", json={"origin": "", "destination": "Logan Square"})
        assert resp.status_code == 422

    def test_whitespace_origin_rejected(self):
        resp = client.post("/route", json={"origin": "   ", "destination": "Logan Square"})
        assert resp.status_code == 422

    def test_invalid_height_rejected(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
            "height_inches": 200,
        })
        assert resp.status_code == 422

    def test_same_location_rejected(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Wrigleyville",
        })
        assert resp.status_code == 400

    def test_unknown_origin_rejected(self):
        resp = client.post("/route", json={
            "origin": "zzz_nonexistent_place_xyzzy_abc",
            "destination": "Logan Square",
        })
        assert resp.status_code == 400

    def test_unknown_destination_rejected(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "zzz_nonexistent_place_xyzzy_abc",
        })
        assert resp.status_code == 400


class TestRouteSuccess:
    def test_known_neighborhoods_return_route(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "total_steps" in data
        assert "total_miles" in data
        assert "total_minutes" in data
        assert "calories_approx" in data
        assert "daily_goal_pct" in data
        assert "path" in data
        assert "directions" in data

    def test_response_values_are_positive(self):
        resp = client.post("/route", json={
            "origin": "Lincoln Park",
            "destination": "Wicker Park",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_steps"] > 0
        assert data["total_miles"] > 0
        assert data["total_minutes"] > 0
        assert data["calories_approx"] > 0

    def test_personalized_steps_with_height(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
            "height_inches": 69,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["personalized"] is True
        assert data["step_length_inches"] > 0

    def test_default_steps_without_height(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["personalized"] is False
        # Default step length is 30 inches
        assert data["step_length_inches"] == 30.0

    def test_directions_have_required_fields(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
        })
        assert resp.status_code == 200
        directions = resp.json()["directions"]
        assert len(directions) > 0
        for step in directions:
            assert "street" in step
            assert "direction" in step
            assert "blocks" in step
            assert "minutes" in step
            assert "steps" in step
            assert "distance_miles" in step

    def test_coords_are_in_chicago(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
        })
        assert resp.status_code == 200
        data = resp.json()
        for lat, lon in [data["origin_coords"], data["dest_coords"]]:
            assert 41.6 < lat < 42.1
            assert -88.0 < lon < -87.5


class TestAlternativeRoutes:
    """Single /route call shared across assertions to stay under the 10/min limit."""

    @pytest.fixture(scope="class")
    def route_data(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
        })
        assert resp.status_code == 200, resp.text
        return resp.json()

    def test_routes_array_returned_with_three_flavors(self, route_data):
        assert "routes" in route_data
        assert "default_flavor" in route_data
        assert "available_flavors" in route_data
        flavors = [r["flavor"] for r in route_data["routes"]]
        assert flavors == ["fastest", "fewest_turns", "greenest"]

    def test_each_alternative_has_full_route_payload(self, route_data):
        for r in route_data["routes"]:
            assert r["total_steps"] > 0
            assert r["total_miles"] > 0
            assert r["total_minutes"] > 0
            assert r["calories_approx"] > 0
            assert len(r["path"]) >= 2
            assert len(r["directions"]) >= 1

    def test_legacy_top_level_fields_match_default_route(self, route_data):
        default = next(r for r in route_data["routes"] if r["flavor"] == route_data["default_flavor"])
        assert route_data["total_miles"]   == default["total_miles"]
        assert route_data["total_minutes"] == default["total_minutes"]
        assert route_data["total_steps"]   == default["total_steps"]
        assert route_data["path"]          == default["path"]

    def test_fastest_is_not_undercut_by_other_flavors(self, route_data):
        routes = {r["flavor"]: r for r in route_data["routes"]}
        fastest_miles = routes["fastest"]["total_miles"]
        # Other flavors trade extra distance for their respective preferences,
        # so they cannot be strictly shorter than the fastest route.
        for flavor in ("fewest_turns", "greenest"):
            assert routes[flavor]["total_miles"] >= fastest_miles - 0.01, (
                f"{flavor} ({routes[flavor]['total_miles']} mi) must not undercut "
                f"fastest ({fastest_miles} mi)"
            )


class TestMultiStopRoutes:
    """Most assertions share a single 3-stop fixture call to stay under the 10/min limit."""

    @pytest.fixture(scope="class")
    def three_stop(self):
        resp = client.post("/route", json={
            "stops": ["Wrigleyville", "Lincoln Park", "Logan Square"],
        })
        assert resp.status_code == 200, resp.text
        return resp.json()

    def test_three_stops_returns_two_legs(self, three_stop):
        data = three_stop
        assert data["stops"] == ["Wrigleyville", "Lincoln Park", "Logan Square"]
        assert len(data["stop_coords"]) == 3
        assert "legs" in data
        assert len(data["legs"]) == 2
        sum_miles = sum(leg["miles"] for leg in data["legs"])
        assert abs(data["total_miles"] - sum_miles) < 0.05
        assert data["legs"][-1]["path_slice"][1] == len(data["path"]) - 1
        # Adjacent legs share the seam index.
        assert data["legs"][0]["path_slice"][1] == data["legs"][1]["path_slice"][0]
        last = -1
        for d in data["directions"]:
            assert "leg_index" in d
            assert d["leg_index"] >= last
            last = d["leg_index"]

    def test_multi_stop_forces_single_fastest_flavor(self, three_stop):
        assert three_stop["available_flavors"] == ["fastest"]
        assert len(three_stop["routes"]) == 1

    def test_too_many_stops_rejected(self):
        # 422 from pydantic — does not hit the rate-limited handler.
        resp = client.post("/route", json={
            "stops": ["Wrigleyville"] * 9,
        })
        assert resp.status_code == 422

    def test_adjacent_duplicate_stops_rejected_with_index(self):
        resp = client.post("/route", json={
            "stops": ["Wrigleyville", "Lincoln Park", "Lincoln Park", "Logan Square"],
        })
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert isinstance(detail, dict)
        assert detail["stop_index"] == 2
