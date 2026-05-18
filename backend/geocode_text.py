"""
Text normalization helpers shared by the geocoder ingestion scripts and the
runtime local-search module.

The same canonical form must be produced at ingest time (when populating
`addresses` and `intersections` in `chicago_geocode.db`) and at query time
(when matching what the user typed). Keeping the rules in one place is the
only way to guarantee that.
"""

from __future__ import annotations

import re

# Directional prefixes / suffixes we strip from street names so "N Clark St"
# and "Clark Street" canonicalize to the same token sequence.
_DIRECTIONALS: frozenset[str] = frozenset({
    "n", "s", "e", "w", "ne", "nw", "se", "sw",
    "north", "south", "east", "west",
    "northeast", "northwest", "southeast", "southwest",
})

_SUFFIXES: frozenset[str] = frozenset({
    "st", "street",
    "ave", "av", "avenue",
    "blvd", "boulevard",
    "rd", "road",
    "dr", "drive",
    "ln", "lane",
    "ct", "court",
    "pl", "place",
    "pkwy", "parkway",
    "hwy", "highway",
    "expy", "expressway",
    "ter", "terrace",
    "way",
    "cir", "circle",
    "sq", "square",
    "plz", "plaza",
    "pt", "point",
    "row",
})

_PUNCT_RE = re.compile(r"[.,;:'\"()]")
_WS_RE = re.compile(r"\s+")


def normalize_street_name(raw: str) -> str:
    """Reduce a raw OSM street name to a search-canonical token sequence.

    "N Clark St"      -> "clark"
    "S Michigan Ave"  -> "michigan"
    "W Diversey Pkwy" -> "diversey"
    "Lake Shore Dr"   -> "lake shore"
    "Lake Shore Dr S" -> "lake shore"   (trailing directional after suffix)
    "Clark St N"      -> "clark"        (trailing directional before suffix)
    """
    if not raw:
        return ""
    s = _PUNCT_RE.sub(" ", raw.lower())
    s = _WS_RE.sub(" ", s).strip()
    tokens = s.split(" ")
    if len(tokens) > 1 and tokens[0] in _DIRECTIONALS:
        tokens = tokens[1:]
    # Strip trailing tokens that are either suffixes or directionals — in any
    # order, until none remain. Handles "Clark St" (suffix), "Clark St N"
    # (directional then suffix surfaces), and "Lake Shore Dr S" (directional
    # hiding the suffix). The single-pass version that ran the suffix strip
    # then the directional strip missed the "Lake Shore Dr S" case because
    # the suffix wasn't last yet.
    while len(tokens) > 1 and (tokens[-1] in _SUFFIXES or tokens[-1] in _DIRECTIONALS):
        tokens = tokens[:-1]
    return " ".join(tokens)


def normalize_address(raw: str) -> str:
    """Normalize a full street address like "1234 N Clark St".

    Lowercases, collapses punctuation/whitespace, strips a leading directional
    after the house number, strips a trailing street suffix and any trailing
    directional that follows it. Preserves the house number as the first token
    so prefix-search by number works.

    "1234 N Clark St"          -> "1234 clark"
    "22 W Washington"          -> "22 washington"
    "1234 N Lake Shore Dr S"   -> "1234 lake shore"   (trailing directional)
    """
    if not raw:
        return ""
    s = _PUNCT_RE.sub(" ", raw.lower())
    s = _WS_RE.sub(" ", s).strip()
    tokens = s.split(" ")
    if not tokens:
        return ""
    if tokens[0] and tokens[0][0].isdigit():
        house = tokens[0]
        rest = tokens[1:]
    else:
        house = ""
        rest = tokens
    if rest and rest[0] in _DIRECTIONALS:
        rest = rest[1:]
    # Strip trailing suffixes and directionals in any order until none remain.
    # See `normalize_street_name` for why a single-pass suffix-then-directional
    # strip missed "1234 N Lake Shore Dr S".
    while len(rest) > 1 and (rest[-1] in _SUFFIXES or rest[-1] in _DIRECTIONALS):
        rest = rest[:-1]
    parts = ([house] if house else []) + rest
    return " ".join(parts)
