"""
Shared helpers for the curated-source ingestion scripts in this directory.

Both `build_libraries.py` and `build_farmers_markets.py` write into the same
file (`backend/data/places_curated.json`). To keep them independently
runnable, this module provides a "replace-by-source" merge: each script
declares its source key, and the merge function drops every existing entry
tagged with that source before appending the freshly fetched batch.

The output schema mirrors `places_osm.json` so `places.py` can load both
files into the same STRtree without translation.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "places_curated.json"


def merge_and_write(source: str, source_url: str, fresh: list[dict[str, Any]]) -> int:
    """Replace entries tagged `source=<source>` in places_curated.json with `fresh`.

    Returns the new total count across all sources.
    """
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {}
    if OUTPUT_PATH.exists():
        try:
            existing = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            existing = {}

    other_places = [
        p for p in existing.get("places", [])
        if p.get("_source") != source
    ]
    for p in fresh:
        p["_source"] = source

    sources_meta: dict[str, dict] = {
        s["name"]: s for s in existing.get("metadata", {}).get("sources", [])
    }
    sources_meta[source] = {
        "name": source,
        "url": source_url,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(fresh),
    }

    merged = other_places + fresh
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "metadata": {
                    "sources": list(sources_meta.values()),
                    "count": len(merged),
                },
                "places": merged,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return len(merged)
