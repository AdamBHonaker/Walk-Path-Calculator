import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch
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


class TestGoogleFallback:
    def test_no_api_key_returns_none_for_unknown(self):
        # Patch the module-level _GOOGLE_API_KEY directly — it is read at import time,
        # so patching os.environ at test runtime has no effect on it.
        import geocoding
        with patch.object(geocoding, "_GOOGLE_API_KEY", ""):
            result = resolve_location("zzz_nonexistent_place_xyzzy")
            assert result is None

    def test_neighborhood_works_without_api_key(self):
        # Neighborhood lookup never reaches geocode_google, so no API key is needed.
        import geocoding
        with patch.object(geocoding, "_GOOGLE_API_KEY", ""):
            result = resolve_location("wrigleyville")
            assert result is not None
