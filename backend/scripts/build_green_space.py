"""
One-time generator for backend/data/green_space_polygons.json — non-CPD
green space inside the Chicago street-graph bbox. Complements the CPD
parks heatmap (`parks_polygons.json` / `parks_heatmap`) so the Explorer
can show *all* walkable open space, not just Park District land.

Source: OpenStreetMap via Overpass. The CPD dataset is authoritative for
Park District boundaries but excludes cemeteries (Graceland, Rosehill,
Mt. Olive, Calvary), Cook County Forest Preserves, golf courses, and
school / hospital grounds. OSM tags those under separate keys, which is
why we pull them with a single Overpass query and tag each polygon with
its source `kind` so the frontend (and future routing weights) can read
them apart.

Tags pulled:
    landuse=cemetery        → "cemetery"
    leisure=golf_course     → "golf_course"
    landuse=recreation_ground → "recreation_ground"  (athletic fields, etc.)
    leisure=nature_reserve  → "nature_reserve"        (Forest Preserves carry this)

Usage:
    python backend/scripts/build_green_space.py

Refresh cadence: yearly. OSM open-space polygons change rarely.

Output schema:
    {
      "metadata": { "source": "overpass", "fetched_at": ..., "count": ..., "bbox": [...] },
      "polygons": [
        { "kind": "cemetery"|"golf_course"|"recreation_ground"|"nature_reserve",
          "name": str | null,
          "ring": [[lon, lat], ...] },
        ...
      ]
    }

A MultiPolygon way / relation is emitted as multiple entries sharing
the same `name` and `kind`. Inner rings (holes) are dropped — matches
the `residential_polygons.json` and `parks_polygons.json` precedent.
Relations are handled via `way[...]; out geom;` semantics by also
querying their member ways.
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
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "green_space_polygons.json"
USER_AGENT = "Passage green-space ingest (https://github.com/AdamBHonaker/Passage)"

# Each tuple is (osm_tag, osm_value, kind_label). Order is also the
# priority for tag-collision tiebreaking (a polygon with two of these
# tags lands in the first match).
TAG_TO_KIND: list[tuple[str, str, str]] = [
    ("landuse",  "cemetery",          "cemetery"),
    ("leisure",  "golf_course",       "golf_course"),
    ("leisure",  "nature_reserve",    "nature_reserve"),
    ("landuse",  "recreation_ground", "recreation_ground"),
]

logger = logging.getLogger("build_green_space")


def _bbox() -> str:
    return f"{STREET_GRAPH_SOUTH},{STREET_GRAPH_WEST},{STREET_GRAPH_NORTH},{STREET_GRAPH_EAST}"


def fetch() -> list[dict]:
    """Return Overpass elements (ways + relations) for every tagged polygon."""
    bbox = _bbox()
    way_lines = "\n".join(
        f"way[{key}={val}]({bbox});" for key, val, _kind in TAG_TO_KIND
    )
    rel_lines = "\n".join(
        f"relation[{key}={val}]({bbox});" for key, val, _kind in TAG_TO_KIND
    )
    # `out geom;` includes inline geometry for ways. Relations need
    # `out body; >; out skel qt;` style to resolve members — but for a
    # heatmap we just want each constituent way's geometry, so we union
    # the way + relation-member ways via `(.a; .b;);`.
    query = (
        "[out:json][timeout:180];\n"
        "(\n"
        f"{way_lines}\n"
        f"{rel_lines}\n"
        ");\n"
        "(._;>;);\n"
        "out geom;\n"
    )
    logger.info("Posting Overpass query for green-space polygons ...")
    t0 = time.perf_counter()
    resp = requests.post(
        OVERPASS_URL,
        data={"data": query},
        headers={"User-Agent": USER_AGENT},
        timeout=300,
    )
    resp.raise_for_status()
    data = resp.json()
    elapsed = time.perf_counter() - t0
    elements = data.get("elements", [])
    logger.info("Overpass returned %d elements in %.1f s", len(elements), elapsed)
    return elements


def _kind_for(tags: dict) -> str | None:
    if not tags:
        return None
    for key, val, kind in TAG_TO_KIND:
        if tags.get(key) == val:
            return kind
    return None


def normalize(elements: list[dict]) -> list[dict]:
    """Convert Overpass ways into kind-tagged outer-ring polygons.

    We only iterate `way` elements (relations are expanded by `(._;>;);`
    into their member ways, which carry the parent's tags via the
    Overpass server's tag propagation). Each way must:
      - have a `kind` resolvable from its tags
      - have at least 3 geometry points
      - close (we force-close if it doesn't)
    """
    out: list[dict] = []
    for el in elements:
        if el.get("type") != "way":
            continue
        kind = _kind_for(el.get("tags") or {})
        if kind is None:
            continue
        geom = el.get("geometry") or []
        if len(geom) < 3:
            continue
        ring = [[round(p["lon"], 5), round(p["lat"], 5)] for p in geom]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) < 4:
            continue
        name = (el.get("tags") or {}).get("name") or None
        out.append({"kind": kind, "name": name, "ring": ring})
    return out


def main() -> int:
    elements = fetch()
    polygons = normalize(elements)

    by_kind: dict[str, int] = {}
    for p in polygons:
        by_kind[p["kind"]] = by_kind.get(p["kind"], 0) + 1
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "metadata": {
                    "source":     "overpass",
                    "tags":       [f"{k}={v}" for k, v, _ in TAG_TO_KIND],
                    "bbox":       [STREET_GRAPH_SOUTH, STREET_GRAPH_WEST, STREET_GRAPH_NORTH, STREET_GRAPH_EAST],
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "count":      len(polygons),
                    "by_kind":    by_kind,
                },
                "polygons": polygons,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    logger.info(
        "Wrote %s (%d polygons, %.0f KB) — %s",
        OUTPUT_PATH,
        len(polygons),
        size_kb,
        ", ".join(f"{k}={n}" for k, n in sorted(by_kind.items())),
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
