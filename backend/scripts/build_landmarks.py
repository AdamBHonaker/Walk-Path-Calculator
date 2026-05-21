"""
One-time generator for the "landmarks" entries in
backend/data/places_curated.json.

Source:
    City of Chicago — Commission on Chicago Landmarks, "Individual Landmarks".
    CDP resource uct4-hrvh, last refreshed 2026-05-08. ~400 designated
    buildings and sites; each row carries a MultiPolygon building footprint
    in `the_geom`, a landmark name, and a street address.

    Geospatial asset — use the .geojson endpoint:
        https://data.cityofchicago.org/resource/uct4-hrvh.geojson
    The classic .json SODA endpoint returns empty column maps for geospatial
    assets on CDP (same limitation documented in build_parks.py for ejsh-fztr).

Usage:
    python backend/scripts/build_landmarks.py

Auth: pulls credentials + the dataset URL from `backend/.env` via the shared
`_cdp_client` helper. CDP_API_ENDPOINT_LANDMARKS must point at the .geojson
URL above.

Refresh cadence: annually. The Commission designates new landmarks
occasionally; a yearly refresh keeps the list current with recent additions.

Output category: "landmarks" (no subcategory).
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import requests
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _cdp_client import _auth_header, get_endpoint  # noqa: E402
from _curated_common import merge_and_write  # noqa: E402

ENDPOINT_ENV = "CDP_API_ENDPOINT_LANDMARKS"
SOURCE_KEY = "cdp_landmarks"

logger = logging.getLogger("build_landmarks")


def fetch_features() -> list[dict]:
    """GET the configured endpoint and return its `features` list.

    The Landmarks dataset is a geospatial asset on CDP — the classic .json
    SODA endpoint returns rows with empty column maps. The .geojson variant
    returns a proper FeatureCollection with geometry + properties.
    """
    url = get_endpoint(ENDPOINT_ENV)
    headers = _auth_header()
    resp = requests.get(url, params={"$limit": 2000}, headers=headers, timeout=120)
    resp.raise_for_status()
    payload = resp.json()
    if isinstance(payload, dict) and payload.get("type") == "FeatureCollection":
        return payload.get("features") or []
    raise RuntimeError(
        f"Expected a GeoJSON FeatureCollection from {url}; got a "
        f"{type(payload).__name__}. Set {ENDPOINT_ENV} to the dataset's "
        f"`.geojson` URL (not `.json`)."
    )


def _representative_point(geom: dict) -> tuple[float, float] | None:
    """Return (lat, lon) for the geometry's representative point.

    Uses shapely's representative_point(), which guarantees the returned
    point lies inside the polygon — important for U-shaped or irregular
    building footprints where the centroid may fall outside.
    Returns None when the geometry cannot be parsed.
    """
    if not geom:
        return None
    try:
        pt = shape(geom).representative_point()
        return (round(pt.y, 6), round(pt.x, 6))
    except Exception:
        return None


def main() -> int:
    features = fetch_features()
    logger.info("Fetched %d landmark features", len(features))

    fresh: list[dict] = []
    skipped_no_geom = 0
    skipped_no_name = 0
    for feat in features:
        props = (feat or {}).get("properties") or {}
        name = (props.get("name") or "").strip()
        if not name:
            skipped_no_name += 1
            continue
        coords = _representative_point(feat.get("geometry"))
        if coords is None:
            skipped_no_geom += 1
            continue
        lat, lon = coords
        address = (props.get("address") or "").strip() or None
        fresh.append({
            "category":    "landmarks",
            "subcategory": None,
            "name":        name,
            "lat":         lat,
            "lon":         lon,
            "address":     address,
        })

    if not fresh:
        logger.error(
            "No landmark records produced — aborting to avoid overwriting with empty set"
        )
        return 1

    total = merge_and_write(SOURCE_KEY, get_endpoint(ENDPOINT_ENV), fresh)
    logger.info(
        "Wrote %d landmarks (skipped %d no-geom, %d no-name; curated total now %d)",
        len(fresh), skipped_no_geom, skipped_no_name, total,
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
