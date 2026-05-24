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


class TestDefaultFlavorInvariant:
    """C-08 — `default_flavor` must always correspond to an entry in `routes`.

    The /route handler picks `default` by filtering for `DEFAULT_FLAVOR` with
    a `routes[0]` fallback, so the invariant holds by construction in
    production. These tests pin the guard helper (`assert_default_flavor_in_routes`)
    so a future refactor that breaks the relationship surfaces loudly
    instead of silently shipping a response the frontend has to fall back on.
    """

    def test_helper_accepts_matching_flavor(self):
        from models import assert_default_flavor_in_routes
        # The happy path: every flavor in `routes` is a candidate, default
        # matches one of them.
        assert_default_flavor_in_routes(
            "greenest",
            [{"flavor": "fastest"}, {"flavor": "fewest_turns"}, {"flavor": "greenest"}],
        )

    def test_helper_raises_on_mismatch(self):
        """Deliberately-broken case — default flavor doesn't match any route."""
        from models import assert_default_flavor_in_routes
        with pytest.raises(AssertionError, match="not in routes flavors"):
            assert_default_flavor_in_routes(
                "greenest",
                [{"flavor": "fastest"}, {"flavor": "fewest_turns"}],
            )

    def test_helper_raises_on_empty_routes(self):
        """Empty routes list — no flavors to match against."""
        from models import assert_default_flavor_in_routes
        with pytest.raises(AssertionError):
            assert_default_flavor_in_routes("fastest", [])


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


class TestStitchLegs:
    """Direct coverage for `_stitch_legs` — the seam-sharing and empty-leg
    invariants are subtle enough that exercising them through `/route` only
    catches the happy path.
    """

    @staticmethod
    def _import():
        from main import _stitch_legs
        return _stitch_legs

    def test_shared_seam_drops_duplicate_point(self):
        stitch = self._import()
        legs = [
            {"path": [(41.94, -87.65), (41.93, -87.66), (41.92, -87.67)]},
            {"path": [(41.92, -87.67), (41.91, -87.68)]},
        ]
        path, slices = stitch(legs)
        assert path == [(41.94, -87.65), (41.93, -87.66), (41.92, -87.67), (41.91, -87.68)]
        # Adjacent slices share the seam index by design.
        assert slices == [(0, 2), (2, 3)]
        assert slices[0][1] == slices[1][0]
        # Slice semantics: path[start:end+1] reproduces the leg geometry.
        assert path[slices[0][0]:slices[0][1] + 1] == legs[0]["path"]
        assert path[slices[1][0]:slices[1][1] + 1] == legs[1]["path"]

    def test_no_shared_seam_keeps_both_endpoints(self):
        stitch = self._import()
        legs = [
            {"path": [(41.94, -87.65), (41.93, -87.66)]},
            # Leg 1 starts at a point that is NOT within ~1 m of leg 0's end
            # (the routing engine never produces this for contiguous legs, but
            # the stitch helper must handle it without dropping points).
            {"path": [(41.80, -87.60), (41.79, -87.61)]},
        ]
        path, slices = stitch(legs)
        assert path == [(41.94, -87.65), (41.93, -87.66), (41.80, -87.60), (41.79, -87.61)]
        # Leg 1's start sits at index 2 (no seam collapse), end at 3.
        assert slices == [(0, 1), (2, 3)]

    def test_empty_first_leg_emits_empty_slice(self):
        stitch = self._import()
        legs = [
            {"path": []},
            {"path": [(41.92, -87.67), (41.91, -87.68)]},
        ]
        path, slices = stitch(legs)
        # The empty seed must not steal index 0 from leg 1.
        assert path == [(41.92, -87.67), (41.91, -87.68)]
        assert slices[0] == (0, -1)
        assert path[slices[0][0]:slices[0][1] + 1] == []
        assert slices[1] == (0, 1)
        assert path[slices[1][0]:slices[1][1] + 1] == legs[1]["path"]

    def test_empty_subsequent_leg_emits_empty_slice_at_seam(self):
        stitch = self._import()
        legs = [
            {"path": [(41.94, -87.65), (41.93, -87.66)]},
            {"path": []},  # degenerate mid-stitch leg
            {"path": [(41.92, -87.67), (41.91, -87.68)]},
        ]
        path, slices = stitch(legs)
        # Empty mid-leg contributes nothing to the path; the next leg appends
        # at the current end (no shared seam between leg 0 end and leg 2 start).
        assert path == [(41.94, -87.65), (41.93, -87.66), (41.92, -87.67), (41.91, -87.68)]
        assert slices[0] == (0, 1)
        # Empty leg gets `(seam, seam - 1)` so path[start:end+1] == [].
        assert slices[1] == (2, 1)
        assert path[slices[1][0]:slices[1][1] + 1] == []
        assert slices[2] == (2, 3)


class TestMultiStopEmptyLegEndpoint:
    """Integration test: one leg returns an empty path from the routing
    engine. The endpoint must either gracefully degrade or return a
    documented error shape — not crash with a 500."""

    def test_empty_middle_leg_does_not_500(self, monkeypatch):
        """When the routing engine returns an empty path for a middle leg, the
        endpoint must not raise an unhandled exception (500). Any structured
        4xx or a degraded 200 is acceptable — an unhandled 500 is not."""
        import walking as _walking

        # Only run if the graph is available; otherwise skip gracefully.
        if _walking._load_graph() is None:
            pytest.skip("street graph not available — skipping empty-leg endpoint test")

        import main as _main
        original_compute = _main._compute_route
        call_count = {"n": 0}

        def patched_compute(olat, olon, dlat, dlon, flavor="fastest"):
            call_count["n"] += 1
            # Return an empty path for the second leg only.
            if call_count["n"] == 2:
                return ((), (), 0.0)
            return original_compute(olat, olon, dlat, dlon, flavor)

        # Patch main's local binding (from walking import _compute_route).
        monkeypatch.setattr(_main, "_compute_route", patched_compute)

        resp = client.post("/route", json={
            "stops": ["Wrigleyville", "Lincoln Park", "Logan Square"],
        })
        # Must not crash with 500.
        assert resp.status_code != 500, (
            f"empty middle-leg caused a 500: {resp.text[:300]}"
        )


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
    """Coverage for the LocationIQ circuit breaker: when LocationIQ returns
    HTTP 429, the breaker opens for a cool-off period. Subsequent queries
    that need the hosted fallback skip the network and raise a structured
    503; neighborhood / local-tier queries continue to succeed because they
    short-circuit before LocationIQ."""

    _SYNTHETIC_QUERIES = (
        "__breaker_test_query__",
        "__breaker_test_query_other__",
        "__breaker_test_query__, chicago, il",
    )

    @pytest.fixture(autouse=True)
    def _isolate_breaker_state(self, monkeypatch):
        # Reset breaker before & after each test; clear the SQLite cache row
        # for every synthetic query so the network path is always exercised.
        # Force an API key so the early-return on missing-key doesn't fire.
        import geocoding
        geocoding._circuit_reset_for_test()
        monkeypatch.setattr(geocoding, "_LOCATIONIQ_API_KEY", "test-key")
        for q in self._SYNTHETIC_QUERIES:
            geocoding._cache_clear_forward_for_test(q)
        yield
        geocoding._circuit_reset_for_test()
        for q in self._SYNTHETIC_QUERIES:
            geocoding._cache_clear_forward_for_test(q)

    @staticmethod
    def _mock_429_response():
        """Build a Mock that quacks like a LocationIQ 429 response."""
        from unittest.mock import Mock
        resp = Mock()
        resp.status_code = 429
        resp.content = b'{"error":"Rate Limited Second"}'
        resp.json = lambda: {"error": "Rate Limited Second"}
        return resp

    def test_429_trips_breaker_and_raises_degraded(self, monkeypatch):
        import geocoding
        from geocoding import geocode_external, GeocoderDegradedError
        mock = self._mock_429_response()
        monkeypatch.setattr(geocoding._http_session, "get", lambda *a, **kw: mock)

        with pytest.raises(GeocoderDegradedError):
            geocode_external("__breaker_test_query__")
        assert geocoding._circuit_is_open() is True

    def test_subsequent_calls_during_cooloff_skip_network(self, monkeypatch):
        """Once the breaker is open, geocode_external must not reach the
        mocked HTTP get on follow-up calls — it short-circuits."""
        import geocoding
        from geocoding import geocode_external, GeocoderDegradedError

        call_count = {"n": 0}
        def counting_get(*a, **kw):
            call_count["n"] += 1
            return self._mock_429_response()
        monkeypatch.setattr(geocoding._http_session, "get", counting_get)

        with pytest.raises(GeocoderDegradedError):
            geocode_external("__breaker_test_query__")
        assert call_count["n"] == 1

        with pytest.raises(GeocoderDegradedError):
            geocode_external("__breaker_test_query_other__")
        assert call_count["n"] == 1, "breaker should have skipped the network call"

    def test_neighborhood_queries_succeed_during_cooloff(self, monkeypatch):
        """NEIGHBORHOOD_COORDS resolves before LocationIQ, so it still works
        with the breaker open."""
        import geocoding
        from geocoding import resolve_location, _circuit_trip_429

        _circuit_trip_429()
        assert geocoding._circuit_is_open() is True

        def boom(*a, **kw):
            raise AssertionError("Should not reach LocationIQ for a neighborhood query")
        monkeypatch.setattr(geocoding._http_session, "get", boom)

        coords = resolve_location("Wrigleyville")
        assert coords == (41.9476, -87.6553)

    def test_probe_after_cooloff_succeeds(self, monkeypatch):
        """When the cool-off elapses, the next call probes LocationIQ. On
        success the breaker closes and consecutive_trips resets."""
        import geocoding
        from geocoding import geocode_external, _circuit_trip_429

        _circuit_trip_429()
        assert geocoding._circuit_is_open() is True

        original_time = geocoding.time.time
        monkeypatch.setattr(geocoding.time, "time",
                            lambda: original_time() + _circuit_inflated_cooloff())

        from unittest.mock import Mock
        ok_resp = Mock()
        ok_resp.status_code = 200
        ok_resp.content = b'[{"lat":"41.9","lon":"-87.65","display_name":"Test"}]'
        ok_resp.json = lambda: [{"lat": "41.9", "lon": "-87.65", "display_name": "Test"}]
        monkeypatch.setattr(geocoding._http_session, "get", lambda *a, **kw: ok_resp)

        coords = geocode_external("__breaker_test_query__")
        assert coords == (41.9, -87.65)
        assert geocoding._circuit_consecutive_trips == 0
        assert geocoding._circuit_is_open() is False

    def test_main_returns_503_on_breaker_open(self, monkeypatch):
        """End-to-end: when the breaker is open and a stop forces LocationIQ,
        /route returns HTTP 503 with the friendly message."""
        import geocoding
        from geocoding import _circuit_trip_429

        _circuit_trip_429()
        # Use a query that's neither a coord pair nor a known neighborhood,
        # and won't match any local SQLite row — forces the LocationIQ path.
        resp = client.post("/route", json={
            "origin": "1234 W Synthetic Test Street",
            "destination": "Logan Square",
        })
        assert resp.status_code == 503
        detail = resp.json().get("detail")
        assert isinstance(detail, dict)
        assert "overloaded" in detail["message"]

    @pytest.mark.parametrize("status_code,should_trip", [
        (429, True),   # canonical rate-limit → trips breaker
        (500, False),  # server error → one-off failure, breaker stays closed
        (503, False),  # upstream unavailable → one-off failure
        (403, False),  # auth failure → one-off failure
    ])
    def test_non_429_http_errors_do_not_trip_breaker(self, monkeypatch, status_code, should_trip):
        """Only HTTP 429 should open the circuit breaker; other 4xx/5xx should
        propagate as one-off failures without engaging the cool-off window."""
        import geocoding
        from geocoding import geocode_external, GeocoderDegradedError

        def mock_resp(code):
            from unittest.mock import Mock
            resp = Mock()
            resp.status_code = code
            resp.content = b'{"error":"test"}'
            resp.json = lambda: {"error": "test"}
            return resp

        monkeypatch.setattr(geocoding._http_session, "get", lambda *a, **kw: mock_resp(status_code))

        try:
            geocode_external("__breaker_test_query__")
        except (GeocoderDegradedError, Exception):
            pass

        assert geocoding._circuit_is_open() is should_trip, (
            f"HTTP {status_code}: expected breaker open={should_trip}, "
            f"got open={geocoding._circuit_is_open()}"
        )


def _circuit_inflated_cooloff() -> float:
    """Helper for `test_probe_after_cooloff_succeeds` — advance well past
    the initial 60 s cool-off without hard-coding the constant."""
    import geocoding
    return geocoding._CIRCUIT_INITIAL_COOLOFF_S + 1.0


def _fake_request(xff=None, peer="10.9.9.9"):
    """Minimal ASGI scope for exercising `main._client_ip` directly."""
    from fastapi import Request
    headers = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    return Request({"type": "http", "headers": headers, "client": (peer, 54321)})


class TestClientIpKeyFunc:
    """`main._client_ip` — the rate-limiter key function. Verifies the
    X-Forwarded-For hop-counting that keeps each client in its own bucket
    behind a reverse proxy, and that it stays spoof-resistant."""

    def test_zero_hops_ignores_forwarded_for(self, monkeypatch):
        import main
        monkeypatch.setattr(main, "_TRUSTED_PROXY_HOPS", 0)
        req = _fake_request(xff="1.2.3.4", peer="10.9.9.9")
        assert main._client_ip(req) == "10.9.9.9"

    def test_one_hop_reads_last_forwarded_entry(self, monkeypatch):
        import main
        monkeypatch.setattr(main, "_TRUSTED_PROXY_HOPS", 1)
        req = _fake_request(xff="203.0.113.7", peer="10.9.9.9")
        assert main._client_ip(req) == "203.0.113.7"

    def test_two_hops_reads_second_from_right(self, monkeypatch):
        import main
        monkeypatch.setattr(main, "_TRUSTED_PROXY_HOPS", 2)
        # client -> Cloudflare -> Railway -> app
        req = _fake_request(xff="203.0.113.7, 198.51.100.2", peer="10.9.9.9")
        assert main._client_ip(req) == "203.0.113.7"

    def test_spoofed_prefix_is_ignored(self, monkeypatch):
        import main
        monkeypatch.setattr(main, "_TRUSTED_PROXY_HOPS", 1)
        # A malicious client prepends fake hops; the real client IP is still
        # the rightmost entry our single trusted proxy appended.
        req = _fake_request(xff="9.9.9.9, 8.8.8.8, 203.0.113.7", peer="10.9.9.9")
        assert main._client_ip(req) == "203.0.113.7"

    def test_missing_header_falls_back_to_peer(self, monkeypatch):
        import main
        monkeypatch.setattr(main, "_TRUSTED_PROXY_HOPS", 1)
        req = _fake_request(xff=None, peer="10.9.9.9")
        assert main._client_ip(req) == "10.9.9.9"

    def test_short_header_falls_back_to_peer(self, monkeypatch):
        import main
        # Two hops declared but only one entry present — a misconfiguration;
        # fall back to the peer rather than read a client-controlled value.
        monkeypatch.setattr(main, "_TRUSTED_PROXY_HOPS", 2)
        req = _fake_request(xff="203.0.113.7", peer="10.9.9.9")
        assert main._client_ip(req) == "10.9.9.9"

    def test_resolve_hops_parses_integer(self, monkeypatch):
        import main
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
        assert main._resolve_trusted_proxy_hops() == 2

    def test_resolve_hops_default_is_zero(self, monkeypatch):
        import main
        monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
        assert main._resolve_trusted_proxy_hops() == 0

    def test_resolve_hops_rejects_garbage(self, monkeypatch):
        import main
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "abc")
        assert main._resolve_trusted_proxy_hops() == 0

    def test_resolve_hops_rejects_negative(self, monkeypatch):
        import main
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "-1")
        assert main._resolve_trusted_proxy_hops() == 0
