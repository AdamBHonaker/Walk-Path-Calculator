"""
One-time generator for the COMMUNITY_AREA_CENTROIDS table in
backend/community_areas.py.

Source:
    City of Chicago — Boundaries — Community Areas (current).
    SODA endpoint: https://data.cityofchicago.org/resource/igwz-8jzy.json
    Each feature has fields { the_geom (MultiPolygon GeoJSON), community,
    area_numbe }. There are exactly 77 community areas.

Usage:
    python backend/scripts/build_community_area_centroids.py

The script prints a Python literal you can paste into community_areas.py,
and also writes backend/data/community_area_centroids.json so the data is
available as raw JSON for tooling that doesn't import the Python module.

Refresh cadence: re-run only if the City of Chicago redraws community-area
boundaries. The 77 areas have been stable since 1981; refreshes are not
expected.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import requests
from shapely.geometry import shape

DATASET_URL = "https://data.cityofchicago.org/resource/igwz-8jzy.json"
OUTPUT_JSON = Path(__file__).resolve().parent.parent / "data" / "community_area_centroids.json"

# The City of Chicago dataset uppercases everything and strips punctuation.
# Restore conventional spelling for the few names that don't title-case cleanly.
_NAME_OVERRIDES: dict[str, str] = {
    "Ohare": "O'Hare",
    "Mckinley Park": "McKinley Park",
}

logger = logging.getLogger("build_centroids")


def fetch_features() -> list[dict]:
    resp = requests.get(DATASET_URL, params={"$limit": 200}, timeout=60)
    resp.raise_for_status()
    rows = resp.json()
    if len(rows) != 77:
        logger.warning("Expected 77 community areas, got %d", len(rows))
    return rows


def compute_centroid(geom: dict) -> tuple[float, float]:
    """Return (lat, lon) representative point for a MultiPolygon GeoJSON.

    Uses representative_point() rather than centroid so the result is
    guaranteed to lie inside the polygon — important for centroids of
    irregular shapes (e.g. O'Hare) whose true centroid falls outside the
    boundary.
    """
    geometry = shape(geom)
    pt = geometry.representative_point()
    return (round(pt.y, 5), round(pt.x, 5))


def main() -> int:
    features = fetch_features()
    centroids: dict[str, tuple[float, float]] = {}
    for row in features:
        name = row["community"].strip().title()
        name = _NAME_OVERRIDES.get(name, name)
        centroids[name] = compute_centroid(row["the_geom"])

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(
        json.dumps({k: list(v) for k, v in sorted(centroids.items())}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_JSON} ({len(centroids)} entries)\n")

    print("# Paste below into backend/community_areas.py:")
    print("COMMUNITY_AREA_CENTROIDS: dict[str, tuple[float, float]] = {")
    for name, (lat, lon) in sorted(centroids.items()):
        print(f"    {name!r:32} ({lat}, {lon}),")
    print("}")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
