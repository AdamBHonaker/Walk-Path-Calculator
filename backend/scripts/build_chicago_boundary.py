"""
One-time generator for backend/data/chicago_boundary.json — the City of
Chicago administrative boundary polygon, used by the Neighborhood Explorer
to clip isochrones against the Lake Michigan shoreline.

The city limits along the lakefront ARE the shoreline, so intersecting the
hull polygon with this boundary cleanly removes the water artifact that the
concave hull leaves behind on lakefront origins.

Usage:
    python backend/scripts/build_chicago_boundary.py

Refresh cadence: rarely — Chicago's municipal boundary changes once a decade
at most. Regenerate only if OSM has a corrected geometry you want to pick up.

Output schema:
    {
      "metadata": { "source": "overpass", "fetched_at": ..., "members": ... },
      "polygon": {
        "type": "Polygon" | "MultiPolygon",
        "coordinates": [...]  // standard GeoJSON coordinate convention
      }
    }
"""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import requests
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.ops import polygonize, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "chicago_boundary.json"
USER_AGENT = "Passage isochrone ingest (https://github.com/AdamBHonaker/Passage)"

logger = logging.getLogger("build_chicago_boundary")


def fetch() -> list[dict]:
    """Return the way members of the City of Chicago admin boundary relation."""
    query = (
        "[out:json][timeout:120];\n"
        'relation["name"="Chicago"]["admin_level"="8"]["boundary"="administrative"];\n'
        "out body;\n"
        ">;\n"
        "out geom;\n"
    )
    logger.info("Posting Overpass query for City of Chicago boundary ...")
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
    logger.info("Overpass returned %d elements in %.1f s", len(elements), elapsed)
    return elements


def assemble(elements: list[dict]) -> Polygon | MultiPolygon:
    """Stitch the relation's outer-way segments into a (Multi)Polygon.

    Overpass returns the relation and every member way with full geometry.
    Admin boundaries are line segments — `polygonize` walks the line graph
    and emits closed polygons, then we union them to consolidate the result.
    """
    lines: list[list[tuple[float, float]]] = []
    for el in elements:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        lines.append([(p["lon"], p["lat"]) for p in geom])

    if not lines:
        raise RuntimeError("Overpass returned no way geometry for the boundary")

    polys = list(polygonize(lines))
    if not polys:
        raise RuntimeError("polygonize produced no closed polygons — boundary stitching failed")

    merged = unary_union(polys)
    if isinstance(merged, (Polygon, MultiPolygon)):
        return merged
    raise RuntimeError(f"unary_union returned unexpected geometry: {merged.geom_type}")


def main() -> int:
    elements = fetch()
    boundary = assemble(elements)
    geom = mapping(boundary)
    member_count = sum(1 for el in elements if el.get("type") == "way")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "metadata": {
                    "source": "overpass",
                    "query": 'relation["name"="Chicago"]["admin_level"="8"]',
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "members": member_count,
                    "geom_type": boundary.geom_type,
                },
                "polygon": geom,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    logger.info(
        "Wrote %s (geom=%s, %.0f KB)",
        OUTPUT_PATH, boundary.geom_type, size_kb,
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
