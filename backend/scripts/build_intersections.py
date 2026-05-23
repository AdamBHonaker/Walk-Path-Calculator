"""
Build the `intersections` table in backend/data/chicago_geocode.db from OSM
street centerlines.

The pedestrian graph artifact (street_graph_igraph.pkl) is unsuitable for
this task: OSMnx's `consolidate_intersections` step strips most street
names from edges that connect collapsed nodes, leaving major streets like
Clark with only a handful of named edges.

Instead, this script queries Overpass for every named `highway=*` way in
the Chicago bbox and computes true geometric crossings with Shapely STRtree.
For each pair of ways with different canonical names that geometrically
intersect, one row is written per intersection point.

Usage:
    python backend/scripts/build_intersections.py

Refresh cadence: quarterly (OSM contributors add/rename streets); rerun
alongside `build_places_osm.py`.
"""

from __future__ import annotations

import logging
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests
from shapely.geometry import LineString, MultiPoint, Point
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts._geocode_db import connect, normalize_street_name  # noqa: E402
from utils import (  # noqa: E402
    STREET_GRAPH_EAST, STREET_GRAPH_NORTH, STREET_GRAPH_SOUTH, STREET_GRAPH_WEST,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "Passage cross-street ingest (https://github.com/AdamBHonaker/Passage)"

# Highway types worth indexing for human cross-street queries. Drops service
# roads/alleys (the routing graph already filters these) and pure-pedestrian
# paths (footway/path/cycleway/steps) since users don't ask "the corner of
# park trail and lakefront path".
_HIGHWAY_KEEP: frozenset[str] = frozenset({
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
    "residential", "unclassified", "living_street",
    "trunk", "trunk_link",
})

logger = logging.getLogger("build_intersections")


def _bbox_str() -> str:
    return f"{STREET_GRAPH_SOUTH},{STREET_GRAPH_WEST},{STREET_GRAPH_NORTH},{STREET_GRAPH_EAST}"


def _overpass_query() -> str:
    keep = "|".join(sorted(_HIGHWAY_KEEP))
    return (
        f"[out:json][timeout:300];\n"
        f"way[\"highway\"~\"^({keep})$\"][\"name\"]({_bbox_str()});\n"
        f"out geom;\n"
    )


def fetch_streets() -> list[dict]:
    query = _overpass_query()
    logger.info("Posting Overpass query (%d chars) ...", len(query))
    t0 = time.perf_counter()
    resp = requests.post(
        OVERPASS_URL,
        data={"data": query},
        headers={"User-Agent": USER_AGENT},
        timeout=420,
    )
    resp.raise_for_status()
    data = resp.json()
    elapsed = time.perf_counter() - t0
    elements = data.get("elements", [])
    logger.info("  %d ways returned in %.1f s", len(elements), elapsed)
    return elements


def _build_linestrings(elements: list[dict]) -> tuple[list[LineString], list[str], list[str]]:
    """Return parallel lists of (line, canonical_name, raw_name) for usable ways."""
    lines: list[LineString] = []
    canon: list[str] = []
    raw:   list[str] = []
    skipped = 0
    for el in elements:
        name = (el.get("tags", {}).get("name") or "").strip()
        if not name:
            skipped += 1
            continue
        canonical = normalize_street_name(name)
        if not canonical:
            skipped += 1
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            skipped += 1
            continue
        coords = [(p["lon"], p["lat"]) for p in geom]
        lines.append(LineString(coords))
        canon.append(canonical)
        raw.append(name)
    if skipped:
        logger.info("  skipped %d ways (missing geometry/name)", skipped)
    return lines, canon, raw


def _find_intersections(
    lines: list[LineString], canon: list[str], raw: list[str]
) -> list[dict]:
    """Use an STRtree to find every pair of differently-named ways that cross,
    and emit one row per intersection point with both canonical + raw names.
    """
    tree = STRtree(lines)
    # canonical-pair -> {first-seen raw forms, set of (rounded lat, lon)}
    pair_state: dict[tuple[str, str], dict] = {}

    checked_pairs: set[tuple[int, int]] = set()
    intersection_count = 0

    for i, line in enumerate(lines):
        # STRtree.query returns indices of geometries whose bboxes intersect.
        for j_arr in [tree.query(line)]:
            for j in j_arr:
                j = int(j)
                if j <= i:
                    continue
                if canon[i] == canon[j]:
                    continue  # same street name, skip self-intersection
                key = (i, j)
                if key in checked_pairs:
                    continue
                checked_pairs.add(key)

                inter = line.intersection(lines[j])
                if inter.is_empty:
                    continue

                # Collect intersection point(s); ignore non-point geometries
                # (parallel overlaps produce LineString intersections, which
                # aren't real cross-streets in this context).
                pts: list[Point] = []
                if isinstance(inter, Point):
                    pts.append(inter)
                elif isinstance(inter, MultiPoint):
                    pts.extend(list(inter.geoms))
                else:
                    continue

                # Stabilize the (a, b) ordering by canonical sort so the same
                # pair always indexes the same dict bucket.
                a, b = canon[i], canon[j]
                ra, rb = raw[i], raw[j]
                if a > b:
                    a, b = b, a
                    ra, rb = rb, ra
                bucket = pair_state.get((a, b))
                if bucket is None:
                    bucket = {"raw_a": ra, "raw_b": rb, "points": set()}
                    pair_state[(a, b)] = bucket
                for p in pts:
                    bucket["points"].add((round(p.y * 1e5), round(p.x * 1e5)))
                    intersection_count += 1

    out: list[dict] = []
    for (a, b), bucket in pair_state.items():
        for lat_q, lon_q in bucket["points"]:
            out.append({
                "name_a": a,
                "name_b": b,
                "raw_a":  bucket["raw_a"],
                "raw_b":  bucket["raw_b"],
                "lat":    lat_q / 1e5,
                "lon":    lon_q / 1e5,
            })
    logger.info(
        "  examined %d candidate pairs, found %d total intersection points across %d named pairs",
        len(checked_pairs), intersection_count, len(pair_state),
    )
    return out


def main() -> int:
    elements = fetch_streets()
    logger.info("Building LineStrings ...")
    lines, canon, raw = _build_linestrings(elements)
    logger.info("  %d usable named ways", len(lines))

    logger.info("Finding geometric intersections ...")
    t0 = time.perf_counter()
    rows = _find_intersections(lines, canon, raw)
    logger.info("  computed in %.1f s, %d rows", time.perf_counter() - t0, len(rows))

    logger.info("Writing to SQLite ...")
    conn = connect()
    try:
        cur = conn.cursor()
        # OPT-029: build-time-only PRAGMAs (see build_address_points.py for the
        # full rationale). Net effect across both FTS5 ingests: ~4-7 min faster
        # geocode-DB rebuild.
        cur.execute("PRAGMA journal_mode=OFF")
        cur.execute("PRAGMA synchronous=OFF")
        cur.execute("PRAGMA temp_store=MEMORY")
        cur.execute("DELETE FROM intersections")
        cur.execute("DELETE FROM intersections_fts")
        cur.executemany(
            "INSERT INTO intersections (name_a, name_b, raw_a, raw_b, lat, lon) "
            "VALUES (:name_a, :name_b, :raw_a, :raw_b, :lat, :lon)",
            rows,
        )
        cur.execute(
            "INSERT INTO intersections_fts (rowid, name_a, name_b) "
            "SELECT id, name_a, name_b FROM intersections"
        )
        conn.commit()
    finally:
        conn.close()

    # Distinct-pair summary for the build log
    unique_pairs = len({(r["name_a"], r["name_b"]) for r in rows})
    logger.info(
        "Wrote %d intersection points (%d unique street pairs) to chicago_geocode.db",
        len(rows), unique_pairs,
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
