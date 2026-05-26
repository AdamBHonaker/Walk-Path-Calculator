"""
Build the `addresses` table in backend/data/chicago_geocode.db from every
OSM node/way in the Chicago bbox that carries `addr:housenumber` +
`addr:street` tags.

The bbox is chunked into an N x N grid so any single Overpass response stays
well below the public instance's soft 200 MB cap. A short pause between
chunks keeps us inside the standard fair-use limits.

Usage:
    python backend/scripts/build_address_points.py [--grid 4] [--sleep 10]

Refresh cadence: quarterly (mirrors `build_places_osm.py`).
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts._geocode_db import connect, normalize_address  # noqa: E402
from utils import (  # noqa: E402
    STREET_GRAPH_EAST, STREET_GRAPH_NORTH, STREET_GRAPH_SOUTH, STREET_GRAPH_WEST,
    quantize_coord,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "Passage address ingest (https://github.com/AdamBHonaker/Passage)"

logger = logging.getLogger("build_address_points")


def _chunk_bboxes(grid: int) -> list[tuple[float, float, float, float]]:
    """Split the Chicago bbox into grid x grid sub-bboxes (south, west, north, east)."""
    south, north = STREET_GRAPH_SOUTH, STREET_GRAPH_NORTH
    west, east = STREET_GRAPH_WEST, STREET_GRAPH_EAST
    dlat = (north - south) / grid
    dlon = (east - west) / grid
    out: list[tuple[float, float, float, float]] = []
    for i in range(grid):
        for j in range(grid):
            out.append((
                south + i * dlat,
                west + j * dlon,
                south + (i + 1) * dlat,
                west + (j + 1) * dlon,
            ))
    return out


def _overpass_query(bbox: tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    return (
        f"[out:json][timeout:180];\n"
        f"(\n"
        f"  nwr[\"addr:housenumber\"][\"addr:street\"]({s},{w},{n},{e});\n"
        f");\n"
        f"out center tags;\n"
    )


def _fetch_chunk(bbox: tuple[float, float, float, float], max_retries: int = 3) -> list[dict]:
    """POST one Overpass query; retry on transient failures (504, connection
    errors) with exponential backoff. Re-raises after `max_retries` attempts."""
    query = _overpass_query(bbox)
    backoff = 15.0
    last_exc: Exception | None = None
    for attempt in range(1, max_retries + 1):
        t0 = time.perf_counter()
        try:
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
            logger.info("  bbox=%s -> %d elements in %.1fs",
                        tuple(round(x, 4) for x in bbox), len(elements), elapsed)
            return elements
        except Exception as exc:
            last_exc = exc
            logger.warning("  attempt %d/%d failed: %s", attempt, max_retries, exc)
            if attempt < max_retries:
                logger.info("  sleeping %.0fs before retry ...", backoff)
                time.sleep(backoff)
                backoff *= 2
    assert last_exc is not None
    raise last_exc


def _extract_coords(el: dict) -> tuple[float, float] | None:
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    c = el.get("center")
    if c and "lat" in c and "lon" in c:
        return float(c["lat"]), float(c["lon"])
    return None


def normalize_elements(elements: list[dict]) -> list[dict]:
    """Pull addr:housenumber + addr:street into the (normalized, raw, lat, lon)
    row shape, deduplicating by (normalized, quantized coord).
    """
    seen: set[tuple[str, int, int]] = set()
    out: list[dict] = []
    skipped = 0
    for el in elements:
        tags = el.get("tags") or {}
        house = (tags.get("addr:housenumber") or "").strip()
        street = (tags.get("addr:street") or "").strip()
        if not house or not street:
            skipped += 1
            continue
        coords = _extract_coords(el)
        if coords is None:
            skipped += 1
            continue
        raw = f"{house} {street}"
        normalized = normalize_address(raw)
        if not normalized:
            skipped += 1
            continue
        lat, lon = coords
        key = (normalized, *quantize_coord(lat, lon))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "normalized": normalized,
            "raw":        raw,
            "lat":        round(lat, 6),
            "lon":        round(lon, 6),
        })
    if skipped:
        logger.info("  skipped %d elements (missing tags/coords)", skipped)
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--grid", type=int, default=4,
                   help="N x N bbox chunks (default 4 = 16 queries)")
    p.add_argument("--sleep", type=float, default=10.0,
                   help="Seconds to wait between Overpass chunks (default 10)")
    p.add_argument("--allow-partial", action="store_true",
                   help="Overwrite the addresses table even when some "
                        "Overpass chunks failed. Default: abort instead.")
    args = p.parse_args()

    bboxes = _chunk_bboxes(args.grid)
    logger.info("Fetching %d Overpass chunks (grid=%d, sleep=%.0fs) ...",
                len(bboxes), args.grid, args.sleep)

    all_elements: list[dict] = []
    failed_chunks = 0
    for idx, bbox in enumerate(bboxes, 1):
        logger.info("[%d/%d] fetching ...", idx, len(bboxes))
        try:
            all_elements.extend(_fetch_chunk(bbox))
        except Exception as exc:
            logger.error("  chunk failed: %s", exc)
            failed_chunks += 1
        if idx < len(bboxes) and args.sleep > 0:
            time.sleep(args.sleep)
    logger.info("Total raw elements: %d", len(all_elements))

    if failed_chunks and not args.allow_partial:
        logger.error(
            "%d / %d Overpass chunks failed — aborting to avoid "
            "overwriting the addresses table with a partial dataset. "
            "Re-run after the transient failure clears, or pass "
            "--allow-partial to accept the incomplete fetch.",
            failed_chunks, len(bboxes),
        )
        return 1

    rows = normalize_elements(all_elements)
    logger.info("Normalized + deduplicated to %d unique addresses", len(rows))

    logger.info("Writing to SQLite ...")
    conn = connect()
    try:
        cur = conn.cursor()
        # OPT-029: build-time-only PRAGMAs. The runtime cache connection
        # (`geocoding._cache_connect`) reopens with WAL + synchronous=NORMAL,
        # so these settings don't leak into prod. `journal_mode=OFF` skips
        # the rollback journal entirely; `synchronous=OFF` skips fsync after
        # every page; `temp_store=MEMORY` keeps the FTS5 SELECT-INTO scratch
        # in RAM. Together: ~4-7 min off the 519k-address build.
        cur.execute("PRAGMA journal_mode=OFF")
        cur.execute("PRAGMA synchronous=OFF")
        cur.execute("PRAGMA temp_store=MEMORY")
        cur.execute("DELETE FROM addresses")
        cur.execute("DELETE FROM addresses_fts")
        cur.executemany(
            "INSERT INTO addresses (normalized, raw, lat, lon) "
            "VALUES (:normalized, :raw, :lat, :lon)",
            rows,
        )
        cur.execute(
            "INSERT INTO addresses_fts (rowid, normalized) "
            "SELECT id, normalized FROM addresses"
        )
        conn.commit()
    finally:
        conn.close()

    logger.info("Wrote %d addresses to chicago_geocode.db", len(rows))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
