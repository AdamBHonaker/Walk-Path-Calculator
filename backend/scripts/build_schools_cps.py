"""
One-time generator for the CPS "schools" entries in
backend/data/places_curated.json.

Source:
    Chicago Public Schools — School Locations & Grade Levels.
    Classic SODA: https://data.cityofchicago.org/resource/p83k-txqt.json
    Rows carry SHORT_NAME / ADDRESS uppercase, plus lat/long as strings.

Usage:
    python backend/scripts/build_schools_cps.py

Auth: pulls credentials + URL from `backend/.env` via the shared
`_cdp_client` helper. Env var: `CDP_API_ENDPOINT_Schools`.

Refresh cadence: annually (CPS publishes a new snapshot each school year).

Output category: "schools" (no subcategory).

Coverage note: OSM `amenity=school|university|college` entries remain in
`places_osm.json`. Curated CPS rows that collide with an OSM entry at the
same `(category, ~1m point)` win via the dedupe in `places.py:_load_all_sources`.
Universities, colleges, and private/parochial schools are still served by OSM.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _curated_common import merge_and_write  # noqa: E402
from _cdp_client import fetch_rows, get_endpoint  # noqa: E402

ENDPOINT_ENV = "CDP_API_ENDPOINT_Schools"
SOURCE_KEY = "cps_schools"

logger = logging.getLogger("build_schools_cps")


def _coords(row: dict) -> tuple[float, float] | None:
    try:
        return (float(row["lat"]), float(row["long"]))
    except (KeyError, TypeError, ValueError):
        return None


def _format_address(row: dict) -> str | None:
    addr = (row.get("address") or "").strip()
    return addr.title() if addr else None


def _format_name(row: dict) -> str | None:
    short = (row.get("short_name") or "").strip()
    if not short:
        return None
    return short.title()


def main() -> int:
    rows = fetch_rows(ENDPOINT_ENV, limit=5000)
    logger.info("Fetched %d CPS school rows", len(rows))

    fresh: list[dict] = []
    for row in rows:
        coords = _coords(row)
        if coords is None:
            continue
        name = _format_name(row)
        if not name:
            continue
        fresh.append({
            "category":    "schools",
            "subcategory": None,
            "name":        name,
            "lat":         round(coords[0], 6),
            "lon":         round(coords[1], 6),
            "address":     _format_address(row),
        })

    total = merge_and_write(SOURCE_KEY, get_endpoint(ENDPOINT_ENV), fresh)
    logger.info("Wrote %d CPS schools (curated total now %d)", len(fresh), total)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
