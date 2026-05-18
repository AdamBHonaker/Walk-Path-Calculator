"""
Tests for the address / street-name normalizers shared between the geocoder
ingestion scripts and the runtime local-search module.

The same normalizer must run at ingest time (when populating `addresses` and
`intersections` in `chicago_geocode.db`) and at query time. These tests pin
the canonical form so a future refactor can't silently desync the two sides.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from geocode_text import normalize_address, normalize_street_name


class TestNormalizeStreetName:
    def test_leading_directional_and_suffix_stripped(self):
        assert normalize_street_name("N Clark St") == "clark"
        assert normalize_street_name("S Michigan Ave") == "michigan"
        assert normalize_street_name("W Diversey Pkwy") == "diversey"

    def test_multi_word_name_kept_intact(self):
        assert normalize_street_name("Lake Shore Dr") == "lake shore"

    def test_trailing_directional_after_suffix_stripped(self):
        # BUG-002 regression: "Lake Shore Dr S" used to canonicalize to
        # "lake shore dr s" because the trailing directional hid the suffix
        # from the strip pass. Now the suffix strips first, then the
        # directional that surfaces as the new last token strips too.
        assert normalize_street_name("Lake Shore Dr S") == "lake shore"
        assert normalize_street_name("Clark St N") == "clark"

    def test_compound_directional_after_suffix_stripped(self):
        # "Highway NE" / "Boulevard SW" — the multi-letter cardinals are also
        # in `_DIRECTIONALS`, so they should strip on the same pass.
        assert normalize_street_name("State Hwy NE") == "state"

    def test_punctuation_and_whitespace_collapsed(self):
        assert normalize_street_name("  N.  CLARK   ST. ") == "clark"

    def test_empty_input(self):
        assert normalize_street_name("") == ""
        assert normalize_street_name("   ") == ""

    def test_single_token_kept(self):
        # Single-token names are a degenerate case (rare in OSM but possible
        # for un-suffixed paths); we keep them as-is rather than risk over-
        # stripping a name that happens to also be in the directional set.
        assert normalize_street_name("Broadway") == "broadway"
        assert normalize_street_name("N") == "n"


class TestNormalizeAddress:
    def test_basic_address(self):
        assert normalize_address("1234 N Clark St") == "1234 clark"
        assert normalize_address("22 W Washington") == "22 washington"

    def test_no_house_number(self):
        # Falls through to the street-name path when there's no leading number.
        assert normalize_address("Clark St") == "clark"

    def test_trailing_directional_after_suffix_stripped(self):
        # BUG-002 regression: same root cause as normalize_street_name —
        # "1234 N Lake Shore Dr S" used to canonicalize to "1234 lake shore dr s".
        assert normalize_address("1234 N Lake Shore Dr S") == "1234 lake shore"
        assert normalize_address("400 Clark St N") == "400 clark"

    def test_punctuation_and_whitespace_collapsed(self):
        assert normalize_address("1234 N. CLARK ST.") == "1234 clark"

    def test_empty_input(self):
        assert normalize_address("") == ""
        assert normalize_address("   ") == ""

    def test_house_number_preserved(self):
        # Prefix search depends on the house number being the first token.
        assert normalize_address("100 N State St").startswith("100 ")
