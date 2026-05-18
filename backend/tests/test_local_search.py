"""
Tests for backend/local_search.py.

These tests hit the real chicago_geocode.db artifact under backend/data/.
If that file isn't present (e.g. a fresh clone before the ingestion scripts
run), the SQLite-dependent tests are skipped rather than failing -- the
in-memory neighborhood/POI tests still exercise the autocomplete cascade.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import local_search
from local_search import (
    Suggestion,
    autocomplete,
    forward,
    nearest_address,
    parse_cross_street,
)

DB_PRESENT = local_search.DB_PATH.exists()
needs_db = pytest.mark.skipif(
    not DB_PRESENT,
    reason="chicago_geocode.db not built; run backend/scripts/build_*.py first",
)


# ── Cross-street parser ──────────────────────────────────────────────────────

class TestParseCrossStreet:
    def test_and(self):
        assert parse_cross_street("Clark and Belmont") == ("clark", "belmont")

    def test_ampersand(self):
        assert parse_cross_street("Clark & Belmont") == ("clark", "belmont")

    def test_slash(self):
        assert parse_cross_street("Clark/Belmont") == ("clark", "belmont")

    def test_at(self):
        assert parse_cross_street("Clark at Belmont") == ("clark", "belmont")

    def test_x(self):
        assert parse_cross_street("Clark x Belmont") == ("clark", "belmont")

    def test_intersection_of(self):
        assert parse_cross_street("intersection of Clark and Belmont") == ("clark", "belmont")

    def test_corner_of(self):
        assert parse_cross_street("corner of Clark and Belmont") == ("clark", "belmont")

    def test_the_corner_of(self):
        assert parse_cross_street("the corner of Clark and Belmont") == ("clark", "belmont")

    def test_directionals_stripped(self):
        assert parse_cross_street("N Clark St and W Belmont Ave") == ("clark", "belmont")

    def test_not_a_cross_street(self):
        assert parse_cross_street("Wrigleyville") is None
        assert parse_cross_street("1234 N Clark") is None
        assert parse_cross_street("") is None
        assert parse_cross_street("   ") is None

    def test_same_name_rejected(self):
        # "Clark and Clark" isn't a real intersection.
        assert parse_cross_street("Clark and Clark") is None


# ── Neighborhoods (no DB needed) ─────────────────────────────────────────────

class TestNeighborhoodAutocomplete:
    def test_exact_match(self):
        s = autocomplete("Wrigleyville", limit=3)
        assert s, "expected at least one suggestion"
        assert s[0].source == "neighborhood"
        assert s[0].label.lower().startswith("wrigleyville")

    def test_prefix_match(self):
        s = autocomplete("wrigle", limit=5)
        labels = [x.label.lower() for x in s]
        assert any("wrigley" in lb for lb in labels)

    def test_empty_query(self):
        assert autocomplete("", limit=5) == []
        assert autocomplete("   ", limit=5) == []


# ── DB-backed tests ──────────────────────────────────────────────────────────

@needs_db
class TestCrossStreetLookup:
    @pytest.mark.parametrize("query, expected_token", [
        ("Clark and Belmont",        "belmont"),
        ("Clark & Belmont",          "belmont"),
        ("Clark/Belmont",            "belmont"),
        ("clark at belmont",         "belmont"),
        ("N Clark St and W Belmont Ave", "belmont"),
        ("Halsted and Fullerton",    "fullerton"),
        ("State and Madison",        "madison"),
    ])
    def test_famous_intersections(self, query, expected_token):
        s = autocomplete(query, limit=3)
        assert s, f"no suggestion for {query!r}"
        # Top suggestion should be an intersection containing the expected name.
        assert s[0].source == "intersection"
        assert expected_token.lower() in s[0].label.lower()


@needs_db
class TestAddressLookup:
    @pytest.mark.parametrize("query, expected_prefix", [
        ("1060 W Addison St",     "1060"),
        ("233 S Wacker Dr",       "233"),
        ("875 N Michigan Ave",    "875"),
        ("22 W Washington",       "22"),
    ])
    def test_famous_addresses(self, query, expected_prefix):
        s = autocomplete(query, limit=3)
        assert s, f"no suggestion for {query!r}"
        addresses = [x for x in s if x.source == "address"]
        assert addresses, f"no address suggestion for {query!r} (got {[x.source for x in s]})"
        assert addresses[0].label.startswith(expected_prefix)

    def test_partial_house_number(self):
        # Prefix on house number returns multiple candidates.
        s = autocomplete("1060 W Addi", limit=5)
        addr = [x for x in s if x.source == "address"]
        assert addr


@needs_db
class TestForward:
    def test_returns_coords_for_neighborhood(self):
        coords = forward("Wrigleyville")
        assert coords is not None
        lat, lon = coords
        # Wrigleyville is around (41.9476, -87.6553).
        assert 41.93 < lat < 41.96
        assert -87.67 < lon < -87.64

    def test_returns_coords_for_intersection(self):
        coords = forward("Clark and Belmont")
        assert coords is not None
        lat, lon = coords
        # Clark & Belmont is around (41.9395, -87.6531).
        assert 41.93 < lat < 41.95
        assert -87.66 < lon < -87.64

    def test_returns_none_on_miss(self):
        # A wildly out-of-vocab query shouldn't match anything locally.
        assert forward("zzz_nonexistent_xyzzy_quux") is None


@needs_db
class TestNearestAddress:
    def test_finds_nearby(self):
        # Right on top of 1060 W Addison St per the spot-check earlier.
        result = nearest_address(41.94773, -87.656596, max_miles=0.05)
        assert result is not None
        assert "Addison" in result["raw"]
        assert result["distance_miles"] < 0.001

    def test_returns_none_when_far(self):
        # Coords way outside Chicago should return nothing.
        assert nearest_address(45.0, -85.0, max_miles=0.05) is None


@needs_db
class TestDedupe:
    def test_intersection_label_deduped(self):
        # OSM splits busy intersections like Halsted & Randolph and Adams &
        # Michigan into 2-4 graph nodes a few meters apart. The autocomplete
        # list should show each crossroads only once.
        for query in ("halsted", "michigan"):
            s = autocomplete(query, limit=8)
            inter_labels = [x.label.lower() for x in s if x.source == "intersection"]
            assert len(inter_labels) == len(set(inter_labels)), (
                f"duplicate intersection labels for {query!r}: {inter_labels}"
            )


@needs_db
class TestSourcePriority:
    def test_neighborhood_outranks_intersection(self):
        # "Logan Square" is both a neighborhood name and a real intersection
        # (Milwaukee + Kedzie + Logan area). The neighborhood entry should win.
        s = autocomplete("Logan Square", limit=5)
        assert s
        assert s[0].source == "neighborhood"

    def test_chicago_bbox_bias(self):
        # Multiple addresses share the normalized form "730 franklin" across
        # the Chicago bbox (downtown + a suburban Franklin Avenue match).
        # The downtown coord should outrank the suburban one.
        s = autocomplete("730 N Franklin St", limit=4)
        addresses = [x for x in s if x.source == "address"]
        if len(addresses) >= 2:
            # Downtown Chicago Franklin is around lon -87.63; western suburbs
            # are around lon -87.81+. Top result should be the closer one.
            top = addresses[0]
            assert -87.65 < top.lon < -87.60, f"top match at {top.lat},{top.lon} -- expected downtown"
