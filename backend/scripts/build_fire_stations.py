"""
One-time generator for the CFD "fire_stations" entries in
backend/data/places_curated.json.

Source:
    Chicago Fire Department — Fire Stations.
    Classic SODA: https://data.cityofchicago.org/resource/28km-gtjn.json
    ~100 rows: short unit names like "E5", "T25", "S1"; coords nested
    under `location.latitude` / `location.longitude`.

Usage:
    python backend/scripts/build_fire_stations.py

Auth: pulls credentials + URL from `backend/.env` via the shared
`_cdp_client` helper. Env var: `CDP_API_ENDPOINT_FIRE_STATIONS`.

Refresh cadence: annually. CFD reorganizes rarely; yearly keeps the
unit catalog in sync with reality.

Output category: "fire_stations" (no subcategory).

Display names expand the unit prefix so the map popup reads "Engine 5"
instead of "E5". Unknown prefixes fall through to the raw name.
"""

from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _curated_common import merge_and_write  # noqa: E402
from _cdp_client import fetch_rows, get_endpoint  # noqa: E402

ENDPOINT_ENV = "CDP_API_ENDPOINT_FIRE_STATIONS"
SOURCE_KEY = "cfd_stations"

logger = logging.getLogger("build_fire_stations")

_PREFIX_EXPANSIONS = {
    "E": "Engine",
    "T": "Truck",
    "S": "Squad",
}

_NAME_PATTERN = re.compile(r"^([A-Za-z]+)\s*(\d+.*)$")


def _coords(row: dict) -> tuple[float, float] | None:
    loc = row.get("location") or {}
    try:
        return (float(loc["latitude"]), float(loc["longitude"]))
    except (KeyError, TypeError, ValueError):
        return None


def _format_address(row: dict) -> str | None:
    addr = (row.get("address") or "").strip()
    return addr.title() if addr else None


def _format_name(row: dict) -> str | None:
    raw = (row.get("name") or "").strip()
    if not raw:
        return None
    match = _NAME_PATTERN.match(raw)
    if not match:
        return raw
    prefix, rest = match.group(1).upper(), match.group(2).strip()
    expansion = _PREFIX_EXPANSIONS.get(prefix)
    if expansion is None:
        return raw
    return f"{expansion} {rest}"


def main() -> int:
    rows = fetch_rows(ENDPOINT_ENV, limit=500)
    logger.info("Fetched %d CFD station rows", len(rows))

    fresh: list[dict] = []
    for row in rows:
        coords = _coords(row)
        if coords is None:
            continue
        name = _format_name(row)
        if not name:
            continue
        fresh.append({
            "category":    "fire_stations",
            "subcategory": None,
            "name":        name,
            "lat":         round(coords[0], 6),
            "lon":         round(coords[1], 6),
            "address":     _format_address(row),
        })

    total = merge_and_write(SOURCE_KEY, get_endpoint(ENDPOINT_ENV), fresh)
    logger.info("Wrote %d fire stations (curated total now %d)", len(fresh), total)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
