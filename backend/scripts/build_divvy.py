"""
One-time generator for the "bike_share" entries in
backend/data/places_curated.json.

Source:
    City of Chicago — Divvy Bicycle Stations.
    Classic SODA: https://data.cityofchicago.org/resource/bbyy-e7gq.json
    Each row carries `station_name` plus `latitude` / `longitude` as top-level
    numeric fields (and/or a nested `location` SODA Point as a fallback shape).

Usage:
    python backend/scripts/build_divvy.py

Auth: pulls credentials + the dataset URL from `backend/.env` via the
shared `_cdp_client` helper (HTTP Basic with the user's CDP key-id/secret).
The env var `CDP_API_ENDPOINT_DIVVY` must point at the classic SODA URL above.

Refresh cadence: annually. Divvy station openings/closings happen but the
CDP feed is kept current — a yearly refresh keeps the roster in sync with
the current footprint.

Output category: "bike_share" (no subcategory).  Source key: "cdp_divvy".
Only rows with status "In Service" (case-insensitive) are included; rows
whose status is missing are also included so the script degrades gracefully
if the field is absent or renamed.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _curated_common import merge_and_write  # noqa: E402
from _cdp_client import fetch_rows, get_endpoint  # noqa: E402

ENDPOINT_ENV = "CDP_API_ENDPOINT_DIVVY"
SOURCE_KEY = "cdp_divvy"

logger = logging.getLogger("build_divvy")


def _coords(row: dict) -> tuple[float, float] | None:
    # Top-level lat/lon — primary shape for the Divvy Stations dataset.
    try:
        lat = float(row["latitude"])
        lon = float(row["longitude"])
        return (lat, lon)
    except (KeyError, TypeError, ValueError):
        pass
    # Nested SODA Point fallback (used by some CDP datasets such as libraries).
    loc = row.get("location") or {}
    try:
        return (float(loc["latitude"]), float(loc["longitude"]))
    except (KeyError, TypeError, ValueError):
        return None


def _is_active(row: dict) -> bool:
    status = (row.get("status") or "").strip().lower()
    # Include rows where status is absent — graceful degradation if field renamed.
    return status in ("in service", "")


def main() -> int:
    rows = fetch_rows(ENDPOINT_ENV, limit=2000)
    logger.info("Fetched %d Divvy rows", len(rows))

    fresh: list[dict] = []
    skipped_inactive = 0
    skipped_no_coords = 0
    skipped_no_name = 0
    for row in rows:
        if not _is_active(row):
            skipped_inactive += 1
            continue
        coords = _coords(row)
        if coords is None:
            skipped_no_coords += 1
            continue
        name = (row.get("station_name") or "").strip()
        if not name:
            skipped_no_name += 1
            continue
        fresh.append({
            "category":    "bike_share",
            "subcategory": None,
            "name":        name,
            "lat":         round(coords[0], 6),
            "lon":         round(coords[1], 6),
            "address":     None,
        })

    total = merge_and_write(SOURCE_KEY, get_endpoint(ENDPOINT_ENV), fresh)
    logger.info(
        "Wrote %d Divvy stations (curated total now %d) — skipped %d inactive, "
        "%d no-coords, %d no-name",
        len(fresh), total, skipped_inactive, skipped_no_coords, skipped_no_name,
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
