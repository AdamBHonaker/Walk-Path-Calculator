"""
Tests for GET /autocomplete.

Covers the local cascade (neighborhood / address / intersection / POI),
input validation, and the gated LocationIQ supplement that only fires
when the local layer returned < 3 results AND the query smells like a
free-text address.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import local_search
from main import app

client = TestClient(app)

needs_db = pytest.mark.requires_artifact("data/chicago_geocode.db")


# ── Validation ───────────────────────────────────────────────────────────────

class TestValidation:
    def test_empty_query_returns_empty_list(self):
        resp = client.get("/autocomplete", params={"q": ""})
        assert resp.status_code == 200
        assert resp.json() == {"suggestions": []}

    def test_whitespace_query_returns_empty_list(self):
        resp = client.get("/autocomplete", params={"q": "   "})
        assert resp.status_code == 200
        assert resp.json() == {"suggestions": []}

    def test_missing_query_is_422(self):
        resp = client.get("/autocomplete")
        assert resp.status_code == 422

    def test_oversized_query_is_422(self):
        resp = client.get("/autocomplete", params={"q": "x" * 250})
        assert resp.status_code == 422

    @pytest.mark.parametrize("limit", [0, -1, 21, 1000])
    def test_invalid_limit_is_422(self, limit):
        resp = client.get("/autocomplete", params={"q": "wrigley", "limit": limit})
        assert resp.status_code == 422


# ── Local cascade ────────────────────────────────────────────────────────────

class TestNeighborhoodSuggestions:
    def test_wrigley_prefix(self):
        resp = client.get("/autocomplete", params={"q": "wrigley", "limit": 5})
        assert resp.status_code == 200
        data = resp.json()
        assert "suggestions" in data
        labels = [s["label"].lower() for s in data["suggestions"]]
        assert any("wrigley" in lb for lb in labels)
        # Top result must be a neighborhood (highest source-priority bucket).
        assert data["suggestions"][0]["source"] == "neighborhood"

    def test_logan_square_exact(self):
        resp = client.get("/autocomplete", params={"q": "logan square"})
        assert resp.status_code == 200
        first = resp.json()["suggestions"][0]
        assert first["source"] == "neighborhood"
        assert "Logan Square" in first["label"]

    def test_response_fields_are_complete(self):
        resp = client.get("/autocomplete", params={"q": "wrigleyville"})
        assert resp.status_code == 200
        for s in resp.json()["suggestions"]:
            # OPT-085: `id` is a stable per-suggestion key (composed of
            # source + label + quantized coords) the frontend uses as the
            # React list key. Same suggestion across two requests must get
            # the same id; assert presence + stable shape here.
            assert set(s) == {"label", "lat", "lon", "source", "id"}
            assert isinstance(s["lat"], float)
            assert isinstance(s["lon"], float)
            assert isinstance(s["id"], str) and len(s["id"]) > 0

    def test_id_is_stable_across_requests(self):
        """Same query → identical `id` values per suggestion. Guarantees the
        React-key contract: list reconciliation across keystrokes that
        re-issue the same query won't remount rows."""
        r1 = client.get("/autocomplete", params={"q": "wrigleyville"}).json()["suggestions"]
        r2 = client.get("/autocomplete", params={"q": "wrigleyville"}).json()["suggestions"]
        assert [s["id"] for s in r1] == [s["id"] for s in r2]


@needs_db
class TestCrossStreetSuggestions:
    def test_clark_and_belmont(self):
        resp = client.get("/autocomplete", params={"q": "Clark and Belmont"})
        assert resp.status_code == 200
        top = resp.json()["suggestions"][0]
        assert top["source"] == "intersection"
        assert "belmont" in top["label"].lower()
        assert "clark" in top["label"].lower()


@needs_db
class TestAddressSuggestions:
    def test_house_number_prefix(self):
        resp = client.get("/autocomplete", params={"q": "1060 W Addison"})
        assert resp.status_code == 200
        addr = [s for s in resp.json()["suggestions"] if s["source"] == "address"]
        assert addr
        assert addr[0]["label"].startswith("1060")


# ── LocationIQ supplement gate ───────────────────────────────────────────────

class TestExternalSupplement:
    """The endpoint only supplements with LocationIQ when both: local layer
    returned < 3 results AND the query's first token is digit-prefixed
    (heuristic for an address typed by hand)."""

    def test_does_not_supplement_for_neighborhood_prefix(self):
        """`'wri'` returns plenty of neighborhood matches AND isn't an address,
        so no LocationIQ call is made even if it returns fewer than 3 hits."""
        with patch("main.geocode_external") as mock_geo:
            mock_geo.return_value = (41.9, -87.65)
            resp = client.get("/autocomplete", params={"q": "wri"})
            assert resp.status_code == 200
            mock_geo.assert_not_called()

    def test_supplement_fires_for_unfamiliar_address(self):
        """A digit-prefixed query with NO local hits triggers exactly one
        LocationIQ call, and the result is appended to the suggestions."""
        with patch("main.geocode_external") as mock_geo:
            mock_geo.return_value = (41.8500, -87.7000)
            # `999999 Imaginary Lane` won't match any OSM address point.
            resp = client.get("/autocomplete", params={"q": "999999 Imaginary Lane"})
            assert resp.status_code == 200
            mock_geo.assert_called_once()
            data = resp.json()["suggestions"]
            sources = [s["source"] for s in data]
            assert "locationiq" in sources

    def test_supplement_skipped_when_local_returns_three(self):
        """If local search already produced ≥ 3 results, the supplement
        gate stays closed even for an address-shaped query."""
        with patch("main.geocode_external") as mock_geo, \
             patch("main.local_search.autocomplete") as mock_local:
            # Three fake local hits.
            mock_local.return_value = [
                local_search.Suggestion("A", 41.9, -87.6, "address", 100.0),
                local_search.Suggestion("B", 41.9, -87.6, "address", 99.0),
                local_search.Suggestion("C", 41.9, -87.6, "address", 98.0),
            ]
            resp = client.get("/autocomplete", params={"q": "123 fake street"})
            assert resp.status_code == 200
            mock_geo.assert_not_called()

    def test_supplement_silently_swallows_degraded_geocoder(self):
        """When the breaker is open during a supplement attempt, the request
        still succeeds — local results return as-is, the external call is
        skipped, and no 503 surfaces."""
        from geocoding import GeocoderDegradedError
        with patch("main.geocode_external") as mock_geo:
            mock_geo.side_effect = GeocoderDegradedError(GeocoderDegradedError.DEFAULT_MESSAGE)
            resp = client.get("/autocomplete", params={"q": "999999 Imaginary Lane"})
            assert resp.status_code == 200
            mock_geo.assert_called_once()
