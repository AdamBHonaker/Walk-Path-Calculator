"""
One-time generator for backend/data/parks_polygons.json — Chicago Park
District park boundaries, used by the Neighborhood Explorer to render a
parks-footprint heatmap distinct from the OSM `leisure=park` place pins.

Source:
    Chicago Data Portal — "Parks - Chicago Park District Park Boundaries
    (current)". Classic SODA: https://data.cityofchicago.org/resource/ej32-qgdr.json
    Each row's `multipolygon` field carries a GeoJSON MultiPolygon; per-park
    metadata includes `park` (name) and `acres`.

Usage:
    python backend/scripts/build_parks.py

Auth: pulls credentials + the dataset URL from `backend/.env` via the
shared `_cdp_client` helper. The env var `CDP_API_ENDPOINT_PARKS` must
point at the classic SODA URL above.

Refresh cadence: yearly. CPD boundaries rarely change.

Output schema:
    {
      "metadata": { "source": "cdp_parks", "fetched_at": ..., "count": ... },
      "parks": [
        { "name": "Lincoln Park", "acres": 1208.0, "ring": [[lon, lat], ...] },
        ...
      ]
    }

A park with a MultiPolygon geometry is emitted as multiple entries sharing
the same `name` and `acres` — one per outer ring. Inner rings (holes) are
intentionally dropped: at city scale a heatmap fill does not need hole
geometry, and omitting them keeps the asset well under 1 MB (matches the
`residential_polygons.json` precedent).
"""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _cdp_client import _auth_header, get_endpoint  # noqa: E402

ENDPOINT_ENV = "CDP_API_ENDPOINT_PARKS"
SOURCE_KEY = "cpd_parks"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "parks_polygons.json"

logger = logging.getLogger("build_parks")


def _parse_acres(raw) -> float | None:
    if raw is None:
        return None
    try:
        return round(float(raw), 2)
    except (TypeError, ValueError):
        return None


def _rings_from_geometry(geom: dict) -> list[list[list[float]]]:
    """Return outer rings only, each as [[lon, lat], ...] rounded to 5 dp.

    Accepts GeoJSON Polygon or MultiPolygon. Inner rings (holes) are
    dropped intentionally — the heatmap render does not need them and
    keeping outers-only halves the asset size.
    """
    if not isinstance(geom, dict):
        return []
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        polygons = [coords]
    elif gtype == "MultiPolygon":
        polygons = coords
    else:
        return []
    rings: list[list[list[float]]] = []
    for polygon in polygons:
        if not polygon:
            continue
        outer = polygon[0]
        if not outer or len(outer) < 3:
            continue
        ring = [[round(float(pt[0]), 5), round(float(pt[1]), 5)] for pt in outer]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) < 4:
            continue
        rings.append(ring)
    return rings


def fetch_features() -> list[dict]:
    """GET the configured endpoint and return its `features` list.

    The Parks dataset is a geospatial asset on CDP — the classic `.json`
    SODA endpoint returns rows with empty column maps. The `.geojson`
    variant returns a proper FeatureCollection with geometry + properties.
    """
    url = get_endpoint(ENDPOINT_ENV)
    headers = _auth_header()
    resp = requests.get(url, params={"$limit": 5000}, headers=headers, timeout=120)
    resp.raise_for_status()
    payload = resp.json()
    if isinstance(payload, dict) and payload.get("type") == "FeatureCollection":
        return payload.get("features") or []
    raise RuntimeError(
        f"Expected a GeoJSON FeatureCollection from {url}; got a "
        f"{type(payload).__name__}. Set {ENDPOINT_ENV} to the dataset's "
        f"`.geojson` URL (not `.json`)."
    )


def main() -> int:
    features = fetch_features()
    logger.info("Fetched %d CPD park features", len(features))

    name_keys = ("park", "label", "park_name", "name")

    parks: list[dict] = []
    skipped_no_geom = 0
    skipped_no_name = 0
    for feat in features:
        props = (feat or {}).get("properties") or {}
        name = ""
        for k in name_keys:
            v = props.get(k)
            if isinstance(v, str) and v.strip():
                name = v.strip()
                break
        if not name:
            skipped_no_name += 1
            continue
        acres = _parse_acres(props.get("acres"))
        rings = _rings_from_geometry(feat.get("geometry"))
        if not rings:
            skipped_no_geom += 1
            continue
        for ring in rings:
            parks.append({"name": name, "acres": acres, "ring": ring})

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "metadata": {
                    "source": SOURCE_KEY,
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "count": len(parks),
                },
                "parks": parks,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    logger.info(
        "Wrote %s (%d park rings from %d features, %.0f KB) — skipped %d no-geom, %d no-name",
        OUTPUT_PATH,
        len(parks),
        len(features),
        size_kb,
        skipped_no_geom,
        skipped_no_name,
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
