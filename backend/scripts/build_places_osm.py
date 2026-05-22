"""
One-time generator for backend/data/places_osm.json — every OSM-sourced
place inside the Chicago street-graph bbox, categorized for the
Neighborhood Explorer's place panel.

Usage:
    python backend/scripts/build_places_osm.py

Refresh cadence: quarterly. OSM contributors add and rename places
constantly; a quarterly refresh keeps the place list reasonably fresh
without spamming the public Overpass instance.

Categories (matches the table in docs/FEATURE_PLANS.md FEAT #1):

    grocery{supermarket|greengrocer|convenience|specialty},
    medical{pharmacy|urgent_care|hospital},
    el_train_stations, metra_stations, gyms_fitness,
    coffee_bakery{bakery|chain_coffee_shop|coffee_shop|cafe}, restaurants,
    bars_nightlife, parks{playground|dog_park},
    art_museums, theaters{movie|live}, bookstores,
    schools, places_of_worship{buddhism|christianity|hinduism|islam|judaism}

The "Residential Area" heatmap and the curated city-feed categories
(Libraries, Farmers Markets) are intentionally NOT fetched here:
  - Residential is polygon data, not points; ships in a follow-on chunk
    alongside its heatmap-layer rendering.
  - Libraries and Farmers Markets come from the City of Chicago Data
    Portal (Chunk 6), not OSM.

Each output entry has:
    {
      "category": str,
      "subcategory": str | null,
      "name": str,
      "lat": float,
      "lon": float,
      "address": str | null
    }
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
    quantize_coord,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "places_osm.json"
USER_AGENT = "Passage isochrone ingest (https://github.com/AdamBHonaker/Passage)"

logger = logging.getLogger("build_places_osm")


# Stable Overpass tag-filter expressions, grouped by output category. Each
# value is a list of (overpass_filter_expr, output_category, output_subcategory).
# Overpass nwr captures nodes + ways + relations; `out center` returns a
# single representative coordinate for ways/relations, so all elements have
# (lat, lon).
_QUERIES: list[tuple[str, str, str | None]] = [
    # Daily life — Grocery. Subcategory splits the OSM shop tags into the
    # Explorer's per-type checkboxes; `farmers_market` is the fifth sub but
    # comes from the curated city feed (build_farmers_markets.py), not here.
    ('shop=supermarket',                    "grocery",            "supermarket"),
    ('shop=greengrocer',                    "grocery",            "greengrocer"),
    ('shop=convenience',                    "grocery",            "convenience"),
    ('shop=butcher',                        "grocery",            "specialty"),
    ('shop=deli',                           "grocery",            "specialty"),
    ('shop=cheese',                         "grocery",            "specialty"),
    ('shop=health_food',                    "grocery",            "specialty"),
    # Medical
    ('amenity=pharmacy',                    "medical",            "pharmacy"),
    ('amenity=clinic',                      "medical",            "urgent_care"),
    ('amenity=hospital',                    "medical",            "hospital"),
    # Train stations — operator filter applied post-fetch (Overpass regex
    # filters here would over-fetch since OSM operator tags are inconsistent).
    # _categorize() splits these into el_train_stations (CTA) vs.
    # metra_stations from the operator tag; the category below is a
    # placeholder it overrides.
    ('railway=station',                     "el_train_stations",  None),
    # Gyms & fitness
    ('leisure=fitness_centre',              "gyms_fitness",       None),
    ('leisure=sports_centre',               "gyms_fitness",       None),
    # Food & drink
    ('amenity=cafe',                        "coffee_bakery",      None),
    ('shop=bakery',                         "coffee_bakery",      None),
    ('amenity=restaurant',                  "restaurants",        None),
    ('amenity=fast_food',                   "restaurants",        None),
    ('amenity=bar',                         "bars_nightlife",     None),
    ('amenity=pub',                         "bars_nightlife",     None),
    ('amenity=nightclub',                   "bars_nightlife",     None),
    # Outdoors
    ('leisure=park',                        "parks",              None),
    ('leisure=dog_park',                    "parks",              "dog_park"),
    ('leisure=playground',                  "parks",              "playground"),
    # Culture
    ('tourism=museum',                      "art_museums",        None),
    ('tourism=artwork',                     "art_museums",        None),
    ('amenity=cinema',                      "theaters",           "movie"),
    ('amenity=theatre',                     "theaters",           "live"),
    ('shop=books',                          "bookstores",         None),
    # Living (no Residential Area — polygon-only, deferred)
    ('amenity=school',                      "schools",            None),
    ('amenity=university',                  "schools",            None),
    ('amenity=college',                     "schools",            None),
    # Places of worship — subcategory by religion tag, post-fetch.
    ('amenity=place_of_worship',            "places_of_worship",  None),
]

# Train-station operator classifier — case-insensitive substring match
# against the OSM `operator` tag. Tag values are inconsistent (e.g. "CTA",
# "Chicago Transit Authority", "METRA", "Metra Rail") so we classify in
# Python rather than in the Overpass query itself. A station is kept only
# if its operator matches one of these groups; the matching group decides
# whether it lands as an El (CTA rapid transit) or a Metra station.
_EL_OPERATORS = ("cta", "chicago transit")
_METRA_OPERATORS = ("metra",)

# Religion → subcategory key for Places of Worship.
_RELIGION_SUBCATEGORY = {
    "buddhist":  "buddhism",
    "christian": "christianity",
    "hindu":     "hinduism",
    "muslim":    "islam",
    "jewish":    "judaism",
}

# Coffee-shop chain detection for the coffee_bakery subcategory split.
# OSM-data-first: an `amenity=cafe` element is treated as a chain when it
# carries a `brand` or `brand:wikidata` tag. The curated name list below is a
# fallback for the (many) chain locations whose mappers never added a brand
# tag — a maintained allowlist of substrings matched against the normalized
# name.
_COFFEE_CHAIN_NAMES: frozenset[str] = frozenset({
    "starbucks",
    "dunkin",          # "Dunkin'", "Dunkin' Donuts"
    "peet",            # "Peet's Coffee"
    "caribou coffee",
    "einstein",        # "Einstein Bros. Bagels"
    "panera",
    "pret a manger",
    "philz",
    "blue bottle",
    "biggby",
    "tim hortons",
})


def _normalize_chain_name(name: str) -> str:
    """Lowercase + fold curly apostrophes so chain-name matching is robust."""
    return name.strip().lower().replace("’", "'")


def _is_coffee_chain(tags: dict, name: str) -> bool:
    """True when an `amenity=cafe` element belongs to a coffee chain.

    OSM-first: any non-empty `brand` / `brand:wikidata` tag marks a chain.
    Fallback: the normalized name contains a curated chain substring.
    """
    if (tags.get("brand:wikidata") or "").strip():
        return True
    if (tags.get("brand") or "").strip():
        return True
    normalized = _normalize_chain_name(name)
    return any(chain in normalized for chain in _COFFEE_CHAIN_NAMES)


def _bbox_str() -> str:
    """Overpass bbox: south,west,north,east."""
    return f"{STREET_GRAPH_SOUTH},{STREET_GRAPH_WEST},{STREET_GRAPH_NORTH},{STREET_GRAPH_EAST}"


def _build_overpass_query(filter_exprs: list[str]) -> str:
    """Build a single Overpass query that batches every category filter.

    Wraps each filter in `nwr[key=value](bbox)` so we get nodes, ways, and
    relations for every category in one HTTP round-trip. `out center;`
    requests a representative coordinate for non-node elements so the
    output is uniform.
    """
    bbox = _bbox_str()
    body = "\n  ".join(f"nwr[{f}]({bbox});" for f in filter_exprs)
    return f"[out:json][timeout:120];\n(\n  {body}\n);\nout center tags;\n"


def _extract_coords(element: dict) -> tuple[float, float] | None:
    """Return (lat, lon) for any Overpass element type, or None if missing."""
    if "lat" in element and "lon" in element:
        return (element["lat"], element["lon"])
    center = element.get("center")
    if center and "lat" in center and "lon" in center:
        return (center["lat"], center["lon"])
    return None


def _format_address(tags: dict) -> str | None:
    """Compose `<housenumber> <street>` from addr:* tags when both are present."""
    housenumber = tags.get("addr:housenumber", "").strip()
    street = tags.get("addr:street", "").strip()
    if housenumber and street:
        return f"{housenumber} {street}"
    if street:
        return street
    return None


def _categorize(tags: dict) -> tuple[str, str | None] | None:
    """Map an Overpass element's tags to (category, subcategory).

    Walks _QUERIES in order, taking the first matching tag pair. Three
    post-fetch filters: railway=station elements are kept only for CTA or
    Metra operators and split into el_train_stations / metra_stations
    accordingly, places_of_worship breaks down by `religion=*`, and
    coffee_bakery splits `shop=bakery` / `amenity=cafe` into
    bakery / chain / coffee_shop / café.
    """
    for filter_expr, category, subcategory in _QUERIES:
        key, _, value = filter_expr.partition("=")
        if tags.get(key) != value:
            continue

        if filter_expr == "railway=station":
            operator = (tags.get("operator") or "").lower()
            # Metra checked first so a rare dual-tagged platform
            # (operator="Metra;CTA") resolves to Metra.
            if any(op in operator for op in _METRA_OPERATORS):
                return ("metra_stations", None)
            if any(op in operator for op in _EL_OPERATORS):
                return ("el_train_stations", None)
            return None  # Private/freight/Amtrak/NICTD stations we skip.

        if category == "coffee_bakery":
            if value == "bakery":  # shop=bakery — a bakery even if it's a chain.
                return (category, "bakery")
            # value == "cafe" (amenity=cafe)
            name = (tags.get("name") or "").strip()
            if _is_coffee_chain(tags, name):
                return (category, "chain_coffee_shop")
            if "coffee_shop" in (tags.get("cuisine") or "").lower():
                return (category, "coffee_shop")
            return (category, "cafe")

        if category == "places_of_worship":
            religion = (tags.get("religion") or "").lower()
            sub = _RELIGION_SUBCATEGORY.get(religion)
            if sub is None:
                return None  # Skip POW with unrecognized/missing religion tag.
            return (category, sub)

        return (category, subcategory)
    return None


def fetch_overpass() -> list[dict]:
    """Run a single batched Overpass query and return raw elements."""
    filter_exprs = sorted({q[0] for q in _QUERIES})
    query = _build_overpass_query(filter_exprs)
    logger.info("Posting Overpass query (%d filters, ~%d chars) ...",
                len(filter_exprs), len(query))
    t0 = time.perf_counter()
    resp = requests.post(
        OVERPASS_URL,
        data={"data": query},
        headers={"User-Agent": USER_AGENT},
        timeout=180,
    )
    resp.raise_for_status()
    data = resp.json()
    elapsed = time.perf_counter() - t0
    logger.info("Overpass returned %d elements in %.1f s",
                len(data.get("elements", [])), elapsed)
    return data.get("elements", [])


def normalize(elements: list[dict]) -> list[dict]:
    """Convert raw Overpass elements into the project's place schema.

    Drops anything without coordinates, an empty/missing name, or a tag set
    that doesn't match one of the configured categories. De-duplicates by
    rounded (lat, lon, category) so a node + a way at the same spot don't
    both appear.
    """
    out: list[dict] = []
    seen: set[tuple[str, int, int]] = set()

    for el in elements:
        tags = el.get("tags") or {}
        name = (tags.get("name") or "").strip()
        if not name:
            continue
        coords = _extract_coords(el)
        if coords is None:
            continue
        cat = _categorize(tags)
        if cat is None:
            continue
        category, subcategory = cat

        lat, lon = coords
        key = (category, *quantize_coord(lat, lon))
        if key in seen:
            continue
        seen.add(key)

        out.append({
            "category": category,
            "subcategory": subcategory,
            "name": name,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "address": _format_address(tags),
        })

    return out


def main() -> int:
    elements = fetch_overpass()
    places = normalize(elements)

    # Per-category counts for the build log so a future maintainer can spot
    # categories that suddenly dropped to zero (usually a tag-schema change
    # in OSM, not a real disappearance).
    counts: dict[tuple[str, str | None], int] = {}
    for p in places:
        key = (p["category"], p["subcategory"])
        counts[key] = counts.get(key, 0) + 1
    for (cat, sub), n in sorted(counts.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
        label = f"{cat}/{sub}" if sub else cat
        logger.info("  %-30s %5d", label, n)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "metadata": {
                    "source": "overpass",
                    "bbox": [STREET_GRAPH_SOUTH, STREET_GRAPH_WEST, STREET_GRAPH_NORTH, STREET_GRAPH_EAST],
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "count": len(places),
                },
                "places": places,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    logger.info("Wrote %s (%d places)", OUTPUT_PATH, len(places))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
