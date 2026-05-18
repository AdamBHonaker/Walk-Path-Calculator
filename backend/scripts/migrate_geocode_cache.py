"""
One-shot migration of the legacy JSON cache to SQLite.

Reads `backend/geocode_cache.json` (or `.deprecated` if it's already been
retired by an earlier run) and loads its entries into the `cached_forward`
+ `cached_reverse` tables of `chicago_geocode.db`. Idempotent — re-runs
just refresh the same rows.

Schema mapping:
    "free text query": [lat, lon]         -> cached_forward
    "free text query": null               -> skipped (negative-cache
                                              entries can be re-learned)
    "rev:LAT,LON": {label, source}        -> cached_reverse

Usage:
    python backend/scripts/migrate_geocode_cache.py

Status: the runtime has been cut over to the SQLite cache (geocoding.py),
so the JSON file is no longer read at request time. This script is kept
for historical migrations and one-off re-imports of an old cache.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts._geocode_db import connect  # noqa: E402

_BACKEND = Path(__file__).resolve().parent.parent
LEGACY_PATH = _BACKEND / "geocode_cache.json"
LEGACY_DEPRECATED_PATH = _BACKEND / "geocode_cache.json.deprecated"

_REV_KEY_RE = re.compile(r"^rev:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$")

logger = logging.getLogger("migrate_geocode_cache")


def main() -> int:
    source_path = LEGACY_PATH if LEGACY_PATH.exists() else LEGACY_DEPRECATED_PATH
    if not source_path.exists():
        logger.info("No legacy cache file (neither %s nor %s) -- nothing to migrate.",
                    LEGACY_PATH.name, LEGACY_DEPRECATED_PATH.name)
        return 0

    raw = json.loads(source_path.read_text(encoding="utf-8"))
    now = int(time.time())

    forward_rows: list[tuple[str, float, float, str, int]] = []
    reverse_rows: list[tuple[int, int, str, str, int]] = []
    skipped_negative = 0
    skipped_malformed = 0

    for key, value in raw.items():
        rev_match = _REV_KEY_RE.match(key)
        if rev_match:
            if not isinstance(value, dict):
                skipped_malformed += 1
                continue
            label = value.get("label")
            source = value.get("source") or "legacy"
            if not label:
                skipped_malformed += 1
                continue
            lat = float(rev_match.group(1))
            lon = float(rev_match.group(2))
            reverse_rows.append((round(lat * 1e5), round(lon * 1e5), label, source, now))
            continue

        # Forward entry: list[lat, lon] or null
        if value is None:
            skipped_negative += 1
            continue
        if not isinstance(value, list) or len(value) != 2:
            skipped_malformed += 1
            continue
        try:
            lat = float(value[0])
            lon = float(value[1])
        except (TypeError, ValueError):
            skipped_malformed += 1
            continue
        forward_rows.append((key, lat, lon, "legacy", now))

    conn = connect()
    try:
        cur = conn.cursor()
        cur.executemany(
            "INSERT OR REPLACE INTO cached_forward (query, lat, lon, source, fetched_at) "
            "VALUES (?, ?, ?, ?, ?)",
            forward_rows,
        )
        cur.executemany(
            "INSERT OR REPLACE INTO cached_reverse (lat_q, lon_q, label, source, fetched_at) "
            "VALUES (?, ?, ?, ?, ?)",
            reverse_rows,
        )
        conn.commit()
    finally:
        conn.close()

    logger.info(
        "Migrated %d forward + %d reverse entries (skipped %d negative, %d malformed).",
        len(forward_rows), len(reverse_rows), skipped_negative, skipped_malformed,
    )

    if source_path == LEGACY_PATH:
        # First-time migration: rename so the legacy file is no longer
        # mistaken for the source of truth. The runtime already reads from
        # SQLite, so this is safe.
        if LEGACY_DEPRECATED_PATH.exists():
            LEGACY_DEPRECATED_PATH.unlink()
        LEGACY_PATH.rename(LEGACY_DEPRECATED_PATH)
        logger.info("Renamed %s -> %s (runtime reads SQLite now).",
                    LEGACY_PATH.name, LEGACY_DEPRECATED_PATH.name)
    else:
        logger.info("Source file %s was already deprecated -- left in place.",
                    LEGACY_DEPRECATED_PATH.name)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
