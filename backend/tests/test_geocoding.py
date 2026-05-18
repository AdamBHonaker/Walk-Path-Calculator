import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch, MagicMock
from geocoding import resolve_location, NEIGHBORHOOD_COORDS


class TestExactNeighborhoodMatch:
    def test_wrigleyville_exact(self):
        coords = resolve_location("wrigleyville")
        assert coords == NEIGHBORHOOD_COORDS["wrigleyville"]

    def test_case_insensitive(self):
        lower = resolve_location("logan square")
        upper = resolve_location("Logan Square")
        assert lower is not None
        assert lower == upper

    def test_known_landmarks(self):
        assert resolve_location("navy pier") is not None
        assert resolve_location("millennium park") is not None
        assert resolve_location("wrigley field") is not None

    def test_returns_lat_lon_tuple(self):
        coords = resolve_location("lincoln park")
        assert coords is not None
        lat, lon = coords
        # Must be in the Chicago area
        assert 41.6 < lat < 42.1
        assert -88.0 < lon < -87.5


class TestFuzzyNeighborhoodMatch:
    def test_typo_wrigleyville(self):
        # "wrigleyvile" — one letter dropped
        result = resolve_location("wrigleyvile")
        assert result is not None
        assert result == NEIGHBORHOOD_COORDS["wrigleyville"]

    def test_partial_match_logan(self):
        result = resolve_location("logan sq")
        # Fuzzy match may or may not succeed depending on threshold; just verify no crash
        # and if returned, it's in Chicago bounds
        if result is not None:
            lat, lon = result
            assert 41.6 < lat < 42.1


class TestLocationIQFallback:
    """Coverage for the Tier-3 hosted fallback (LocationIQ).

    The legacy name `TestGoogleFallback` referred to the Google geocoder
    that was retired in favor of LocationIQ + a local SQLite tier; the
    behavioral contract (no key + nonexistent query -> None) is unchanged.
    """

    def test_no_api_key_returns_none_for_unknown(self):
        # Patch the module-level _LOCATIONIQ_API_KEY directly — it is read
        # at import time, so patching os.environ at test runtime has no
        # effect on it. Also negative-cache for any prior run.
        import geocoding
        geocoding._cache_clear_forward_for_test("zzz_nonexistent_place_xyzzy_local")
        with patch.object(geocoding, "_LOCATIONIQ_API_KEY", ""):
            result = resolve_location("zzz_nonexistent_place_xyzzy_local")
            assert result is None

    def test_neighborhood_works_without_api_key(self):
        # Neighborhood lookup never reaches LocationIQ, so no API key is needed.
        import geocoding
        with patch.object(geocoding, "_LOCATIONIQ_API_KEY", ""):
            result = resolve_location("wrigleyville")
            assert result is not None


class TestReverseDisplayNameTrim:
    """The ZIP-trim regex must not truncate 5-digit house numbers
    (Chicago's south-side grid runs out to ~13800)."""

    def _call(self, display_name):
        import geocoding
        resp = MagicMock()
        resp.status_code = 200
        resp.content = b"{}"
        resp.json = lambda: {"display_name": display_name}
        with patch.object(geocoding, "_LOCATIONIQ_API_KEY", "k"), \
             patch.object(geocoding, "_circuit_is_open", return_value=False), \
             patch.object(geocoding._http_session, "get", return_value=resp):
            return geocoding._reverse_geocode_external(41.7, -87.68)

    def test_five_digit_house_number_preserved(self):
        # The bug: a 5-digit house number anchored the regex and dropped
        # everything after the house number, leaving the label as "13700".
        label = self._call(
            "13700, South Western Avenue, Chicago, IL, 60643, United States"
        )
        assert label is not None
        assert label.startswith("13700, South Western Avenue")
        assert "60643" in label

    def test_zip_trim_still_drops_country(self):
        label = self._call(
            "123 North Clark Street, Chicago, IL, 60601, United States"
        )
        assert label is not None
        assert label.endswith("60601")
        assert "United States" not in label
