"""
One-time generator for the "libraries" entries in
backend/data/places_curated.json.

Source:
    City of Chicago — Libraries: Locations, Hours and Contact Information.
    Classic SODA: https://data.cityofchicago.org/resource/x8fc-8rcq.json
    Each row's `location` field carries a SODA Point with `latitude` and
    `longitude` strings (numeric in the response despite the type tag).

Usage:
    python backend/scripts/build_libraries.py

Auth: pulls credentials + the dataset URL from `backend/.env` via the
shared `_cdp_client` helper (HTTP Basic with the user's CDP key-id/secret).
The env var `CDP_API_ENDPOINT_LIBRARIES` must point at the classic SODA
URL above.

Refresh cadence: annually. CPL branch openings/closings are uncommon and
the dataset is kept current by the City — quarterly is overkill, but a
yearly refresh keeps addresses and phone numbers in sync with reality.

Output category: "libraries" (no subcategory).
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _curated_common import merge_and_write  # noqa: E402
from _cdp_client import fetch_rows, get_endpoint  # noqa: E402

ENDPOINT_ENV = "CDP_API_ENDPOINT_LIBRARIES"
SOURCE_KEY = "cpl_locations"

logger = logging.getLogger("build_libraries")


def _coords(row: dict) -> tuple[float, float] | None:
    loc = row.get("location") or {}
    try:
        return (float(loc["latitude"]), float(loc["longitude"]))
    except (KeyError, TypeError, ValueError):
        return None


def _format_address(row: dict) -> str | None:
    addr = (row.get("address") or "").strip()
    return addr or None


def main() -> int:
    rows = fetch_rows(ENDPOINT_ENV, limit=500)
    logger.info("Fetched %d CPL rows", len(rows))

    fresh: list[dict] = []
    for row in rows:
        coords = _coords(row)
        if coords is None:
            continue
        name = (row.get("branch_") or "").strip()
        if not name:
            continue
        # Branch names in the dataset are bare ("Sulzer Regional"); add a
        # hint so the user-facing label disambiguates from any same-named
        # places of worship or schools.
        display_name = f"{name} Branch — Chicago Public Library"
        fresh.append({
            "category":    "libraries",
            "subcategory": None,
            "name":        display_name,
            "lat":         round(coords[0], 6),
            "lon":         round(coords[1], 6),
            "address":     _format_address(row),
        })

    total = merge_and_write(SOURCE_KEY, get_endpoint(ENDPOINT_ENV), fresh)
    logger.info("Wrote %d libraries (curated total now %d)", len(fresh), total)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
