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


class TestReverseGeocode:
    """Coverage for GET /reverse-geocode — bbox validation, response shape, caching."""

    def test_in_bounds_returns_label_and_source(self):
        # Wrigleyville coordinates → should match the "wrigleyville" neighborhood
        resp = client.get("/reverse-geocode", params={"lat": 41.9476, "lon": -87.6553})
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)
        assert "label" in data and isinstance(data["label"], str)
        assert "source" in data and data["source"] in {"neighborhood", "google", "coordinates"}

    def test_near_neighborhood_resolves_to_neighborhood_source(self):
        # Within 200 m of Logan Square's pin
        resp = client.get("/reverse-geocode", params={"lat": 41.9290, "lon": -87.7000})
        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "neighborhood"
        assert "logan" in data["label"].lower()

    def test_north_of_chicago_rejected(self):
        # Above CHICAGO_NORTH (42.02)
        resp = client.get("/reverse-geocode", params={"lat": 42.5, "lon": -87.7})
        assert resp.status_code == 422

    def test_west_of_chicago_rejected(self):
        # West of CHICAGO_WEST (-87.94)
        resp = client.get("/reverse-geocode", params={"lat": 41.9, "lon": -88.5})
        assert resp.status_code == 422

    def test_missing_lat_lon_params_rejected(self):
        resp = client.get("/reverse-geocode")
        assert resp.status_code == 422


class TestRoutePersonalization:
    """Coverage for the personalization fields wired through /route."""

    def test_pace_brisk_yields_fewer_minutes_than_normal(self):
        body = {"origin": "Wrigleyville", "destination": "Logan Square"}
        normal = client.post("/route", json={**body, "pace": "normal"}).json()
        brisk  = client.post("/route", json={**body, "pace": "brisk"}).json()
        # Same distance, faster pace → fewer minutes.
        assert brisk["total_minutes"] < normal["total_minutes"]
        # Distance is pace-independent (same route).
        assert abs(brisk["total_miles"] - normal["total_miles"]) < 0.05
        # Both echo the requested pace.
        assert normal["pace"] == "normal"
        assert brisk["pace"]  == "brisk"

    def test_weight_kg_personalises_calories(self):
        body = {"origin": "Wrigleyville", "destination": "Logan Square"}
        default = client.post("/route", json=body).json()
        heavy   = client.post("/route", json={**body, "weight_kg": 120}).json()
        # Heavier walker → more calories (same distance, MET-based scaling).
        assert heavy["calories_approx"] > default["calories_approx"]
        assert heavy["personalized_calories"] is True
        assert default["personalized_calories"] is False

    def test_invalid_pace_rejected(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
            "pace": "sprint",
        })
        assert resp.status_code == 422

    def test_invalid_weight_kg_rejected(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
            "weight_kg": 1000,
        })
        assert resp.status_code == 422

    def test_daily_goal_changes_pct(self):
        body = {"origin": "Wrigleyville", "destination": "Logan Square"}
        default = client.post("/route", json=body).json()
        custom  = client.post("/route", json={**body, "daily_goal": 5000}).json()
        # Same step count vs a smaller goal → larger pct.
        assert custom["daily_goal_pct"] > default["daily_goal_pct"]

    def test_avoid_stairs_returns_custom_flavor(self):
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "Logan Square",
            "avoid_stairs": True,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["available_flavors"] == ["custom"]
        assert data["routes"][0]["flavor"] == "custom"


class TestGeocodeBboxRejection:
    """Coverage for Bolt-On A: queries that resolve to coordinates outside
    Chicago's bbox return HTTP 422 with a structured 'not in Chicago' error,
    rather than 200 with a nonsensical route or 400 with a generic 'not found'."""

    def test_explicit_coords_north_of_chicago_returns_422(self):
        # 42.5° N is well above CHICAGO_NORTH (42.02).
        resp = client.post("/route", json={
            "origin": "42.5, -87.7",
            "destination": "Logan Square",
        })
        assert resp.status_code == 422
        detail = resp.json().get("detail")
        assert isinstance(detail, dict)
        assert "isn't in Chicago" in detail["message"]
        assert detail["stop_index"] == 0

    def test_explicit_coords_south_of_chicago_returns_422(self):
        # 41.0° N is below CHICAGO_SOUTH (41.64).
        resp = client.post("/route", json={
            "origin": "Wrigleyville",
            "destination": "41.0, -87.7",
        })
        assert resp.status_code == 422
        detail = resp.json().get("detail")
        assert isinstance(detail, dict)
        assert detail["stop_index"] == 1

    def test_resolve_location_raises_for_outside_coords(self):
        """Direct unit test of the geocoding-layer contract."""
        from geocoding import resolve_location, LocationOutsideChicagoError
        with pytest.raises(LocationOutsideChicagoError) as exc_info:
            resolve_location("42.5, -87.7")
        assert exc_info.value.coords == (42.5, -87.7)

    def test_resolve_location_returns_coords_for_inside_pair(self):
        """Sanity: in-bbox coord pairs still resolve, no exception."""
        from geocoding import resolve_location
        coords = resolve_location("41.95, -87.65")
        assert coords == (41.95, -87.65)


class TestFuzzyMatchRegression:
    """Coverage for Bolt-On B: the fuzzy-match threshold (`_FUZZY_THRESHOLD`)
    must reject confusable non-Chicago place names while still accepting
    legitimate typos. This is the canonical regression set; if you change the
    threshold, every assertion here must still hold."""

    @pytest.fixture(autouse=True)
    def _clear_fuzzy_cache(self):
        from geocoding import fuzzy_match_neighborhood
        fuzzy_match_neighborhood.cache_clear()

    # ── Negatives: must NOT fuzzy-match ────────────────────────────────────
    def test_huntington_does_not_match(self):
        from geocoding import fuzzy_match_neighborhood
        coords, key = fuzzy_match_neighborhood("huntington")
        assert coords is None
        assert key is None

    def test_huntington_wv_does_not_match(self):
        from geocoding import fuzzy_match_neighborhood
        coords, key = fuzzy_match_neighborhood("huntington wv")
        assert coords is None

    def test_times_square_does_not_match(self):
        # NYC place; must fall through to Google (which then gets bbox-rejected).
        from geocoding import fuzzy_match_neighborhood
        coords, key = fuzzy_match_neighborhood("times square")
        assert coords is None

    def test_pilsn_does_not_match(self):
        # Too mangled — should fall through, not silently match Pilsen.
        from geocoding import fuzzy_match_neighborhood
        coords, key = fuzzy_match_neighborhood("pilsn")
        assert coords is None

    # ── Positives: must fuzzy-match the intended neighborhood ──────────────
    def test_wriggleyville_matches_wrigleyville(self):
        from geocoding import fuzzy_match_neighborhood
        coords, key = fuzzy_match_neighborhood("wriggleyville")
        assert key == "wrigleyville"

    def test_logn_square_matches_logan_square(self):
        # Single-character typo on the first word of a multi-word neighborhood.
        from geocoding import fuzzy_match_neighborhood
        coords, key = fuzzy_match_neighborhood("logn square")
        assert key == "logan square"

    def test_broonzeville_matches_bronzeville(self):
        from geocoding import fuzzy_match_neighborhood
        coords, key = fuzzy_match_neighborhood("broonzeville")
        assert key == "bronzeville"

    # ── End-to-end via resolve_location: abbreviation expansion path ───────
    def test_logan_sq_abbreviation_resolves(self):
        # "Logan Sq" hits _normalize_street_abbr → "logan square" → exact match.
        # Documents that this path does NOT depend on the fuzzy matcher.
        from geocoding import resolve_location
        coords = resolve_location("Logan Sq")
        assert coords == (41.929, -87.7)


class TestGeocoderCircuitBreaker:
    """Coverage for Bolt-On C: when Google returns 429 / OVER_QUERY_LIMIT,
    the breaker opens for a cool-off period. Subsequent street-address
    queries skip Google entirely and raise a structured 503; neighborhood
    queries continue to succeed because they short-circuit before Google."""

    @pytest.fixture(autouse=True)
    def _isolate_breaker_state(self, monkeypatch):
        # Reset breaker before & after each test; clear cache for the synthetic
        # query so we exercise the network path. Force an API key so the
        # cached `not _GOOGLE_API_KEY` early-return doesn't short-circuit.
        import geocoding
        geocoding._circuit_reset_for_test()
        monkeypatch.setattr(geocoding, "_GOOGLE_API_KEY", "test-key")
        # Ensure the synthetic query is never pre-cached.
        for q in ("__breaker_test_query__", "__breaker_test_query__, chicago, il"):
            geocoding._geocode_cache.pop(q, None)
        yield
        geocoding._circuit_reset_for_test()
        for q in ("__breaker_test_query__", "__breaker_test_query__, chicago, il"):
            geocoding._geocode_cache.pop(q, None)

    @staticmethod
    def _mock_429_response():
        """Build a Mock that quacks like a `requests.Response` returning 429."""
        from unittest.mock import Mock
        resp = Mock()
        resp.status_code = 429
        resp.content = b'{"status":"OVER_QUERY_LIMIT","results":[]}'
        resp.json = lambda: {"status": "OVER_QUERY_LIMIT", "results": []}
        return resp

    def test_429_trips_breaker_and_raises_degraded(self, monkeypatch):
        import geocoding
        from geocoding import geocode_google, GeocoderDegradedError
        mock = self._mock_429_response()
        monkeypatch.setattr(geocoding._http_session, "get", lambda *a, **kw: mock)

        with pytest.raises(GeocoderDegradedError):
            geocode_google("__breaker_test_query__")
        assert geocoding._circuit_is_open() is True

    def test_subsequent_calls_during_cooloff_skip_network(self, monkeypatch):
        """Verify that once the breaker is open, geocode_google never reaches the
        mocked HTTP get on follow-up calls — it short-circuits."""
        import geocoding
        from geocoding import geocode_google, GeocoderDegradedError

        call_count = {"n": 0}
        def counting_get(*a, **kw):
            call_count["n"] += 1
            return self._mock_429_response()
        monkeypatch.setattr(geocoding._http_session, "get", counting_get)

        # First call trips the breaker (1 network call).
        with pytest.raises(GeocoderDegradedError):
            geocode_google("__breaker_test_query__")
        assert call_count["n"] == 1

        # Subsequent uncached query — must NOT hit the network.
        with pytest.raises(GeocoderDegradedError):
            geocode_google("__breaker_test_query_other__")
        assert call_count["n"] == 1, "breaker should have skipped the network call"

    def test_neighborhood_queries_succeed_during_cooloff(self, monkeypatch):
        """Names in NEIGHBORHOOD_COORDS resolve before the Google fallback,
        so they continue to work even while the breaker is open."""
        import geocoding
        from geocoding import resolve_location, _circuit_trip_429

        # Force the breaker open without making a real call.
        _circuit_trip_429()
        assert geocoding._circuit_is_open() is True

        # If anything reaches the network, fail loudly.
        def boom(*a, **kw):
            raise AssertionError("Should not reach Google for a neighborhood query")
        monkeypatch.setattr(geocoding._http_session, "get", boom)

        coords = resolve_location("Wrigleyville")
        assert coords == (41.9476, -87.6553)

    def test_probe_after_cooloff_succeeds(self, monkeypatch):
        """When time advances past the cool-off, the next call probes Google.
        On success, the breaker closes and consecutive_trips resets."""
        import geocoding
        from geocoding import geocode_google, _circuit_trip_429

        _circuit_trip_429()
        assert geocoding._circuit_is_open() is True

        # Simulate the cool-off having elapsed.
        original_time = geocoding.time.time
        monkeypatch.setattr(geocoding.time, "time",
                            lambda: original_time() + _circuit_inflated_cooloff())

        from unittest.mock import Mock
        ok_resp = Mock()
        ok_resp.status_code = 200
        ok_resp.content = b'{"status":"OK"}'
        ok_resp.json = lambda: {
            "status": "OK",
            "results": [{"geometry": {"location": {"lat": 41.9, "lng": -87.65}}}],
        }
        monkeypatch.setattr(geocoding._http_session, "get", lambda *a, **kw: ok_resp)

        coords = geocode_google("__breaker_test_query__")
        assert coords == (41.9, -87.65)
        assert geocoding._circuit_consecutive_trips == 0
        assert geocoding._circuit_is_open() is False

    def test_main_returns_503_on_breaker_open(self, monkeypatch):
        """End-to-end: when the breaker is open and a stop forces Google,
        /route returns HTTP 503 with the friendly message."""
        import geocoding
        from geocoding import _circuit_trip_429

        _circuit_trip_429()
        # Use a query that's neither a coord pair nor a known neighborhood —
        # a synthetic string forces the Google fallback path.
        resp = client.post("/route", json={
            "origin": "1234 W Synthetic Test Street",
            "destination": "Logan Square",
        })
        assert resp.status_code == 503
        detail = resp.json().get("detail")
        assert isinstance(detail, dict)
        assert "overloaded" in detail["message"]


def _circuit_inflated_cooloff() -> float:
    """Helper for `test_probe_after_cooloff_succeeds` — advance well past
    the initial 60 s cool-off without hard-coding the constant."""
    import geocoding
    return geocoding._CIRCUIT_INITIAL_COOLOFF_S + 1.0
