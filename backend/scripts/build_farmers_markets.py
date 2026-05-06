"""
One-time generator for the "grocery/farmers_market" entries in
backend/data/places_curated.json.

Source:
    City of Chicago — Farmers Markets - 2013.
    SODA: https://data.cityofchicago.org/resource/i8y3-ytj4.json

    *Why 2013:* The City stopped publishing a yearly Farmers Markets
    dataset with coordinates after 2013. The 2015 dataset (`x5xx-pszi`)
    has more current intersection text but no lat/lon, so geocoding
    every entry would add a Google Maps Geocoding API dependency to the
    build pipeline. The 2013 list is stale (~13 years old) but the
    recurring summer/fall markets are largely the same locations year
    over year, and 24 known markets is materially better for the
    Explorer than zero. **If a fresher feed becomes available, change
    only `DATASET_URL` and `_extract_*` below — the rest is reusable.**

Usage:
    python backend/scripts/build_farmers_markets.py

Refresh cadence: annually if a fresher dataset surfaces. Otherwise the
2013 baseline is treated as static.

Output category: "grocery" with subcategory "farmers_market" — matches
the FEATURE_PLANS table where Farmers Markets is a sub-category of the
Grocery Stores group.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import quantize_coord  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _curated_common import merge_and_write  # noqa: E402

DATASET_URL = "https://data.cityofchicago.org/resource/i8y3-ytj4.json"
SOURCE_KEY = "farmers_markets_2013"

logger = logging.getLogger("build_farmers_markets")


def _extract_coords(row: dict) -> tuple[float, float] | None:
    try:
        return (float(row["latitude"]), float(row["longitude"]))
    except (KeyError, TypeError, ValueError):
        return None


def _extract_name(row: dict) -> str:
    """Build a display name from `location` (neighborhood) + intersection."""
    location = (row.get("location") or "").strip()
    intersection = (row.get("intersection") or "").strip()
    if location and intersection:
        return f"{location} Farmers Market ({intersection})"
    return f"{location or intersection or 'Farmers Market'} Farmers Market".strip()


def fetch_rows() -> list[dict]:
    resp = requests.get(DATASET_URL, params={"$limit": 500}, timeout=60)
    resp.raise_for_status()
    return resp.json()


def main() -> int:
    rows = fetch_rows()
    logger.info("Fetched %d farmers-market rows", len(rows))

    fresh: list[dict] = []
    seen: set[tuple[int, int]] = set()
    for row in rows:
        coords = _extract_coords(row)
        if coords is None:
            continue
        # The same physical market can appear twice in the row stream when
        # it runs on multiple days; collapse by rounded coordinates.
        key = quantize_coord(*coords)
        if key in seen:
            continue
        seen.add(key)
        fresh.append({
            "category":    "grocery",
            "subcategory": "farmers_market",
            "name":        _extract_name(row),
            "lat":         round(coords[0], 6),
            "lon":         round(coords[1], 6),
            "address":     row.get("intersection") or None,
        })

    total = merge_and_write(SOURCE_KEY, DATASET_URL, fresh)
    logger.info("Wrote %d farmers markets (curated total now %d)", len(fresh), total)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
