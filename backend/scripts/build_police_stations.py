"""
One-time generator for the CPD "police_stations" entries in
backend/data/places_curated.json.

Source:
    Chicago Police Department — Police Stations.
    Classic SODA: https://data.cityofchicago.org/resource/z8bn-74gv.json
    ~25 rows: numeric districts + Headquarters.

Usage:
    python backend/scripts/build_police_stations.py

Auth: pulls credentials + URL from `backend/.env` via the shared
`_cdp_client` helper. Env var: `CDP_API_ENDPOINT_POLICE_STATIONS`.

Refresh cadence: annually. District boundaries rarely move; the data
holds steady.

Output category: "police_stations" (no subcategory).
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _curated_common import merge_and_write  # noqa: E402
from _cdp_client import fetch_rows, get_endpoint  # noqa: E402

ENDPOINT_ENV = "CDP_API_ENDPOINT_POLICE_STATIONS"
SOURCE_KEY = "cpd_stations"

logger = logging.getLogger("build_police_stations")


def _coords(row: dict) -> tuple[float, float] | None:
    try:
        return (float(row["latitude"]), float(row["longitude"]))
    except (KeyError, TypeError, ValueError):
        return None


def _format_address(row: dict) -> str | None:
    addr = (row.get("address") or "").strip()
    return addr.title() if addr else None


def _format_name(row: dict) -> str | None:
    district = (row.get("district") or "").strip()
    district_name = (row.get("district_name") or "").strip()
    if not district and not district_name:
        return None
    pretty_name = district_name.title() if district_name else ""
    if district.isdigit():
        return f"District {int(district)} — {pretty_name}".rstrip(" —")
    # Non-numeric district values (e.g. "Headquarters") — drop the prefix.
    return pretty_name or district.title()


def main() -> int:
    rows = fetch_rows(ENDPOINT_ENV, limit=500)
    logger.info("Fetched %d CPD station rows", len(rows))

    fresh: list[dict] = []
    for row in rows:
        coords = _coords(row)
        if coords is None:
            continue
        name = _format_name(row)
        if not name:
            continue
        fresh.append({
            "category":    "police_stations",
            "subcategory": None,
            "name":        name,
            "lat":         round(coords[0], 6),
            "lon":         round(coords[1], 6),
            "address":     _format_address(row),
        })

    total = merge_and_write(SOURCE_KEY, get_endpoint(ENDPOINT_ENV), fresh)
    logger.info("Wrote %d police stations (curated total now %d)", len(fresh), total)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
