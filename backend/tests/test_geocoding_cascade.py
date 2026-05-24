"""TD-059 / B-12 — integration test for the full geocoding cascade.

The catalog: individual tiers are unit-tested in isolation, but the
*order* of tier traversal is load-bearing — a refactor that accidentally
ran LocationIQ before the local neighborhood lookup would burn API quota
silently. This module pins the advancement order by mocking each tier
and confirming the cascade hits them in sequence + stops at the first
hit.

The cascade order (per `geocoding._resolve_location_inner`):
  1. coord-pair regex
  2. NEIGHBORHOOD_COORDS exact match
  3. fuzzy_match_neighborhood
  4. local_search.forward (SQLite-backed)
  5. geocode_external (LocationIQ)
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

import geocoding


@pytest.fixture(autouse=True)
def _reset_breaker_state():
    """Each test starts with a closed circuit breaker so a prior test's
    429 simulation can't gate the LocationIQ tier."""
    saved_open_until = geocoding._circuit_open_until
    saved_consecutive = geocoding._circuit_consecutive_trips
    geocoding._circuit_open_until = 0.0
    geocoding._circuit_consecutive_trips = 0
    yield
    geocoding._circuit_open_until = saved_open_until
    geocoding._circuit_consecutive_trips = saved_consecutive


class TestCascadeAdvancement:
    def test_tier1_neighborhood_short_circuits(self, monkeypatch):
        """A query that matches NEIGHBORHOOD_COORDS exactly must NOT
        advance to fuzzy / local / LocationIQ tiers."""
        fuzzy_calls = []
        local_calls = []
        ext_calls = []

        monkeypatch.setattr(
            geocoding, "fuzzy_match_neighborhood",
            lambda q: fuzzy_calls.append(q) or (None, None),
        )
        monkeypatch.setitem(
            sys.modules, "local_search",
            type(sys)("local_search"),  # stub module
        )
        sys.modules["local_search"].forward = (
            lambda q: local_calls.append(q) or None
        )
        monkeypatch.setattr(
            geocoding, "geocode_external",
            lambda q: ext_calls.append(q) or None,
        )

        # Pick a name that's in NEIGHBORHOOD_COORDS — "wrigleyville" is in
        # the bundled list. Use lowercase since the cascade normalizes.
        coords = geocoding.resolve_location("Wrigleyville")
        assert coords is not None
        assert fuzzy_calls == [], "fuzzy tier should not fire on exact match"
        assert local_calls == [], "local_search should not fire on exact match"
        assert ext_calls == [], "LocationIQ should not fire on exact match"

    def test_tier5_locationiq_runs_when_all_local_tiers_miss(self, monkeypatch):
        """A query that misses every local tier should fall through to
        geocode_external (LocationIQ). Mocks the network call so this
        test doesn't burn real quota."""
        monkeypatch.setattr(
            geocoding, "fuzzy_match_neighborhood",
            lambda q: (None, None),
        )
        # Stub local_search.forward to None — every local tier misses.
        stub = type(sys)("local_search")
        stub.forward = lambda q: None
        monkeypatch.setitem(sys.modules, "local_search", stub)
        # The LocationIQ tier returns Chicago coords so the bbox check
        # in resolve_location() passes.
        ext_calls = []
        def _stub_ext(q):
            ext_calls.append(q)
            return (41.9, -87.65)  # somewhere in Chicago

        monkeypatch.setattr(geocoding, "geocode_external", _stub_ext)
        coords = geocoding.resolve_location("zzz_synthetic_query_xyzzy")
        assert coords == (41.9, -87.65)
        assert len(ext_calls) == 1, "LocationIQ tier should fire exactly once"

    def test_tier4_local_search_short_circuits_locationiq(self, monkeypatch):
        """When local_search.forward returns coords, LocationIQ must NOT
        run. Pins the "local before vendor" cost-control invariant."""
        monkeypatch.setattr(
            geocoding, "fuzzy_match_neighborhood",
            lambda q: (None, None),
        )
        stub = type(sys)("local_search")
        stub.forward = lambda q: (41.95, -87.7)
        monkeypatch.setitem(sys.modules, "local_search", stub)

        ext_calls = []
        monkeypatch.setattr(
            geocoding, "geocode_external",
            lambda q: ext_calls.append(q) or None,
        )

        coords = geocoding.resolve_location("zzz_synthetic_query_xyzzy")
        assert coords == (41.95, -87.7)
        assert ext_calls == [], "LocationIQ must not fire when local tier hits"

    def test_coord_pair_regex_short_circuits_all_tiers(self, monkeypatch):
        """A coord-pair query (e.g. '41.9, -87.65') should bypass every
        downstream tier — it's already in the canonical form."""
        fuzzy_calls = []
        ext_calls = []
        monkeypatch.setattr(
            geocoding, "fuzzy_match_neighborhood",
            lambda q: fuzzy_calls.append(q) or (None, None),
        )
        monkeypatch.setattr(
            geocoding, "geocode_external",
            lambda q: ext_calls.append(q) or None,
        )
        coords = geocoding.resolve_location("41.9, -87.65")
        assert coords == (41.9, -87.65)
        assert fuzzy_calls == []
        assert ext_calls == []
