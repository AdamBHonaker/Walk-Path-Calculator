import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


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
        assert resp.status_code == 400

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
