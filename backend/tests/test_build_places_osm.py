"""Tests for the coffee_bakery subcategory classification in build_places_osm.py.

These exercise the pure tag → (category, subcategory) logic and the chain
detector — no Overpass network access required.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Same sys.path dance as test_cdp_client so the script is importable.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))
sys.path.insert(0, str(_BACKEND_DIR / "scripts"))

import build_places_osm as bpo  # noqa: E402


class TestIsCoffeeChain:
    def test_brand_wikidata_tag_marks_chain(self):
        assert bpo._is_coffee_chain({"brand:wikidata": "Q37158"}, "Some Cafe") is True

    def test_brand_tag_marks_chain(self):
        assert bpo._is_coffee_chain({"brand": "Starbucks"}, "Some Cafe") is True

    def test_empty_brand_tags_ignored(self):
        assert bpo._is_coffee_chain({"brand": "", "brand:wikidata": "  "}, "Joe") is False

    def test_name_fallback_matches_known_chain(self):
        assert bpo._is_coffee_chain({}, "Starbucks Reserve") is True

    def test_name_fallback_folds_curly_apostrophe(self):
        # "Dunkin’" must match the curated "dunkin" substring.
        assert bpo._is_coffee_chain({}, "Dunkin’ Donuts") is True

    def test_independent_cafe_is_not_a_chain(self):
        assert bpo._is_coffee_chain({}, "Bridgeport Coffee House") is False


class TestCategorizeCoffeeBakery:
    def test_bakery_shop_tag(self):
        assert bpo._categorize({"shop": "bakery", "name": "X"}) == ("coffee_bakery", "bakery")

    def test_chain_bakery_still_classified_as_bakery(self):
        # A brand-tagged shop=bakery stays a bakery — "chain coffee shop" is
        # a coffee-only bucket by design.
        tags = {"shop": "bakery", "brand": "Corner Bakery", "name": "Corner Bakery"}
        assert bpo._categorize(tags) == ("coffee_bakery", "bakery")

    def test_branded_cafe_is_chain(self):
        tags = {"amenity": "cafe", "brand:wikidata": "Q37158", "name": "Starbucks"}
        assert bpo._categorize(tags) == ("coffee_bakery", "chain_coffee_shop")

    def test_unbranded_chain_by_name(self):
        # No brand tag — caught by the curated name list.
        assert bpo._categorize({"amenity": "cafe", "name": "Dunkin'"}) == (
            "coffee_bakery", "chain_coffee_shop")

    def test_coffee_shop_by_cuisine(self):
        tags = {"amenity": "cafe", "cuisine": "coffee_shop", "name": "Metric Coffee"}
        assert bpo._categorize(tags) == ("coffee_bakery", "coffee_shop")

    def test_coffee_shop_cuisine_substring(self):
        # OSM cuisine is a semicolon list — substring match still classifies.
        tags = {"amenity": "cafe", "cuisine": "sandwich;coffee_shop", "name": "Cafe"}
        assert bpo._categorize(tags) == ("coffee_bakery", "coffee_shop")

    def test_plain_cafe_is_catch_all(self):
        assert bpo._categorize({"amenity": "cafe", "name": "Some Cafe"}) == (
            "coffee_bakery", "cafe")

    def test_chain_takes_priority_over_cuisine(self):
        tags = {"amenity": "cafe", "cuisine": "coffee_shop", "name": "Starbucks"}
        assert bpo._categorize(tags) == ("coffee_bakery", "chain_coffee_shop")


class TestCategorizeUnaffectedCategories:
    def test_restaurant_still_classified(self):
        assert bpo._categorize({"amenity": "restaurant", "name": "R"}) == (
            "restaurants", None)

    def test_place_of_worship_still_classified(self):
        tags = {"amenity": "place_of_worship", "religion": "christian", "name": "C"}
        assert bpo._categorize(tags) == ("places_of_worship", "christianity")
