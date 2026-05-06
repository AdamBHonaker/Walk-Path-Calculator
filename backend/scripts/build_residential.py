"""
One-time generator for backend/data/residential_polygons.json — the
`landuse=residential` polygons inside the Chicago street-graph bbox,
used by the Neighborhood Explorer to render a heatmap-style fill of
where people live within the isochrone.

Usage:
    python backend/scripts/build_residential.py

Refresh cadence: yearly. OSM landuse polygons change rarely.

Output schema:
    {
      "metadata": { "source": "overpass", "fetched_at": ..., "count": ... },
      "polygons": [ [[lon, lat], [lon, lat], ...], ... ]
    }

Each polygon is the outer ring as a list of [lon, lat] pairs (matches the
GeoJSON Polygon coordinate convention). Inner rings are intentionally
dropped — at city scale a heatmap fill doesn't need hole geometry, and
omitting holes keeps the JSON file under a megabyte.

We intentionally skip `building=apartments` / `building=residential` from
the FEATURE_PLANS table for v1: those are tens of thousands of individual
building footprints that don't help a heatmap visualization and would
balloon the asset size by ~50×. If a future render needs per-building
granularity, add a second script and a separate output file.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import (  # noqa: E402
    STREET_GRAPH_EAST,
    STREET_GRAPH_NORTH,
    STREET_GRAPH_SOUTH,
    STREET_GRAPH_WEST,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "residential_polygons.json"
USER_AGENT = "Passage isochrone ingest (https://github.com/AdamBHonaker/Passage)"

logger = logging.getLogger("build_residential")


def _bbox() -> str:
    return f"{STREET_GRAPH_SOUTH},{STREET_GRAPH_WEST},{STREET_GRAPH_NORTH},{STREET_GRAPH_EAST}"


def fetch() -> list[dict]:
    """Return raw way elements with full geometry for every residential way."""
    bbox = _bbox()
    query = (
        "[out:json][timeout:120];\n"
        f"way[landuse=residential]({bbox});\n"
        "out geom;\n"
    )
    logger.info("Posting Overpass query for residential polygons ...")
    t0 = time.perf_counter()
    resp = requests.post(
        OVERPASS_URL,
        data={"data": query},
        headers={"User-Agent": USER_AGENT},
        timeout=240,
    )
    resp.raise_for_status()
    data = resp.json()
    elapsed = time.perf_counter() - t0
    elements = data.get("elements", [])
    logger.info("Overpass returned %d ways in %.1f s", len(elements), elapsed)
    return elements


def normalize(elements: list[dict]) -> list[list[list[float]]]:
    """Convert Overpass ways into [[lon, lat], ...] outer rings.

    Drops degenerate rings (< 4 vertices once closed) and ways missing
    geometry. Coordinates are rounded to 5 decimals (~1 m) to keep the
    file size reasonable.
    """
    polygons: list[list[list[float]]] = []
    for el in elements:
        geom = el.get("geometry") or []
        if len(geom) < 3:
            continue
        ring = [[round(p["lon"], 5), round(p["lat"], 5)] for p in geom]
        # Close the ring if the source didn't.
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) < 4:
            continue
        polygons.append(ring)
    return polygons


def main() -> int:
    elements = fetch()
    polygons = normalize(elements)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "metadata": {
                    "source": "overpass",
                    "tag": "landuse=residential",
                    "bbox": [STREET_GRAPH_SOUTH, STREET_GRAPH_WEST, STREET_GRAPH_NORTH, STREET_GRAPH_EAST],
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "count": len(polygons),
                },
                "polygons": polygons,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    logger.info("Wrote %s (%d polygons, %.0f KB)", OUTPUT_PATH, len(polygons), size_kb)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
