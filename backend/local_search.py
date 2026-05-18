"""
Local-first search facade for the geocoder cascade.

Tier 1 (in-memory) sources:
    * NEIGHBORHOOD_COORDS from geocoding.py — curated Chicago landmarks
    * places_osm.json + places_curated.json via places.all_places()

Tier 2 (SQLite, backend/data/chicago_geocode.db):
    * addresses          — every Chicago OSM addr:* point
    * intersections      — geometric cross-streets from OSM centerlines

This module handles autocomplete (typeahead), forward (top-1 match), and
reverse (lat/lon -> label). The Tier-3 hosted fallback (LocationIQ) lives in
geocoding.py — local_search never makes a network call.

The DB connection is opened once at first use with mmap so concurrent
request threads can read with negligible overhead.
"""

from __future__ import annotations

import bisect
import logging
import math
import re
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from geocode_text import normalize_address, normalize_street_name
from utils import chicago_bbox_contains, haversine_miles, quantize_coord

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent / "data" / "chicago_geocode.db"

# Centroid used as the disambiguation anchor when several candidates tie on
# everything else. Loop / Millennium Park area — chosen so an ambiguous
# query like "730 N Franklin" prefers the downtown row over a similarly-named
# suburban address that happens to sit inside the wider Chicago bbox.
_CHICAGO_CENTER: tuple[float, float] = (41.8827, -87.6326)


@dataclass(frozen=True)
class Suggestion:
    """One ranked autocomplete result."""

    label: str           # human-readable display
    lat: float
    lon: float
    source: str          # 'neighborhood' | 'intersection' | 'address' | 'place'
    score: float = 0.0   # higher is better; only meaningful within a single call


# ── Lazy DB connection ──────────────────────────────────────────────────────

_db_lock = threading.Lock()
_db: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection | None:
    """Return a process-wide read-only SQLite connection over chicago_geocode.db.

    Returns None when the DB artifact is missing — callers in this module
    short-circuit to an empty result rather than opening a `:memory:` stub
    that would later raise `OperationalError: no such table` on the first
    `addresses` / `intersections` query.
    """
    global _db
    if _db is not None:
        return _db
    with _db_lock:
        if _db is not None:
            return _db
        if not DB_PATH.exists():
            logger.warning("%s missing -- local_search will only resolve neighborhoods", DB_PATH)
            return None
        conn = sqlite3.connect(
            f"file:{DB_PATH}?mode=ro",
            uri=True,
            check_same_thread=False,
        )
        try:
            conn.execute("PRAGMA mmap_size = 134217728")  # 128 MB
            conn.execute("PRAGMA temp_store = MEMORY")
        except sqlite3.OperationalError:
            pass
        conn.row_factory = sqlite3.Row
        _db = conn
    return _db


def _reset_db_for_test() -> None:
    """Test hook: drop the cached connection so tests can use a fresh DB path."""
    global _db
    with _db_lock:
        if _db is not None:
            try:
                _db.close()
            except Exception:
                pass
        _db = None


# ── Cross-street query parser ───────────────────────────────────────────────

# Common prefixes a user might type before "Clark and Belmont".
_CROSS_PREFIX_RE = re.compile(
    r"^(?:the\s+)?(?:intersection|corner)\s+of\s+",
    re.IGNORECASE,
)
# Separators that mean "A intersects B". Two flavors: word-like separators
# (`and`, `at`, `x`, `&`, `@`) require whitespace on both sides so they don't
# split inside ordinary words ("boxwood" -> not "bo wood"); slash and
# backslash accept optional whitespace because users frequently type
# "Clark/Belmont" without spaces.
_CROSS_SEP_RE = re.compile(
    r"(?:\s+(?:and|&|@|\bat\b|\bx\b)\s+|\s*[/\\]\s*)",
    re.IGNORECASE,
)


def parse_cross_street(query: str) -> tuple[str, str] | None:
    """If `query` looks like a cross-street, return canonical (name_a, name_b).

    Accepts: "Clark and Belmont", "Clark & Belmont", "Clark/Belmont",
    "Clark at Belmont", "intersection of Clark and Belmont", "Clark x Belmont".
    """
    if not query:
        return None
    s = _CROSS_PREFIX_RE.sub("", query.strip())
    parts = _CROSS_SEP_RE.split(s, maxsplit=1)
    if len(parts) != 2:
        return None
    a = normalize_street_name(parts[0])
    b = normalize_street_name(parts[1])
    if not a or not b or a == b:
        return None
    return (a, b)


# ── In-memory indexes (neighborhoods + POIs) ────────────────────────────────

_in_mem_lock = threading.Lock()
_in_mem_built = False
_neighborhood_index: list[tuple[str, str, float, float]] = []
_poi_index: list[tuple[str, str, float, float]] = []  # (name_lower, display, lat, lon)
# Parallel key-only arrays for `bisect`-based prefix windowing. Kept in
# lockstep with the (name_lower, ...) tuple at the same index in the
# `_*_index` lists above. Built once inside `_ensure_in_mem_index`.
_neighborhood_keys: list[str] = []
_poi_keys: list[str] = []


def _ensure_in_mem_index() -> None:
    """Build sorted prefix lists for neighborhoods + POIs once per process."""
    global _in_mem_built
    if _in_mem_built:
        return
    with _in_mem_lock:
        if _in_mem_built:
            return
        # Avoid importing geocoding at module-top: it pulls in `requests` and
        # the circuit-breaker plumbing, which we don't want as a hard dep
        # if all you're doing is local-only autocomplete in a test fixture.
        from geocoding import NEIGHBORHOOD_COORDS  # noqa: PLC0415
        for name, (lat, lon) in NEIGHBORHOOD_COORDS.items():
            _neighborhood_index.append((name, name.title(), lat, lon))
        _neighborhood_index.sort(key=lambda t: t[0])
        _neighborhood_keys.extend(t[0] for t in _neighborhood_index)

        try:
            from places import all_places  # noqa: PLC0415
            for p in all_places():
                nm = (p.get("name") or "").strip()
                if not nm:
                    continue
                _poi_index.append((nm.lower(), nm, float(p["lat"]), float(p["lon"])))
            _poi_index.sort(key=lambda t: t[0])
            _poi_keys.extend(t[0] for t in _poi_index)
        except Exception as exc:
            logger.warning("POI index unavailable: %s", exc)

        _in_mem_built = True


def _prefix_window(keys: list[str], q: str) -> tuple[int, int]:
    """Return [lo, hi) such that every key in that slice has `q` as a prefix.

    `keys` must be lexicographically sorted. Empty `q` returns the full range,
    matching the prior loop's behavior (every key is a prefix of the empty
    string). `lo` is `bisect_left(keys, q)`; `hi` walks forward while the
    prefix still holds — cheaper than an Ω(log n) right-bound search via a
    sentinel character because the window is small in the common case and
    we avoid platform questions about high Unicode sentinels.
    """
    if not q:
        return (0, len(keys))
    lo = bisect.bisect_left(keys, q)
    hi = lo
    n = len(keys)
    while hi < n and keys[hi].startswith(q):
        hi += 1
    return (lo, hi)


# ── Ranking + dedupe helpers ────────────────────────────────────────────────

_SOURCE_PRIORITY = {
    "neighborhood": 1000.0,
    "intersection": 800.0,
    "address":      600.0,
    "place":        500.0,
}


def _score(source: str, lat: float, lon: float, *, exact: bool) -> float:
    """Higher is better.

    Source priority dominates so neighborhoods always sort ahead of addresses.
    Within a source, an exact match beats a prefix match, and an in-bbox row
    beats an out-of-bbox row (cheap insurance against the wider Chicago bbox
    that includes a sliver of suburbs).
    """
    base = _SOURCE_PRIORITY.get(source, 0.0)
    base += 100.0 if exact else 0.0
    if chicago_bbox_contains(lat, lon):
        base += 50.0
    # Distance from Chicago center (max ~12 mi inside the bbox) — break ties
    # toward the city core when otherwise everything is equal.
    d = haversine_miles(_CHICAGO_CENTER[0], _CHICAGO_CENTER[1], lat, lon)
    base -= d  # subtract miles; ~12-mile penalty in the worst case
    return base


def _dedupe(suggestions: Iterable[Suggestion]) -> list[Suggestion]:
    """Drop later suggestions that collide on label or quantized coord (~1 m).

    Label-level dedupe matters for intersections: OSM often models a single
    real-world crossroads as 2–4 graph nodes a few meters apart, so the same
    "Belmont & Clark" string would otherwise appear multiple times in the list.
    """
    seen_keys: set[tuple[int, int]] = set()
    seen_labels: set[tuple[str, str]] = set()
    out: list[Suggestion] = []
    for s in suggestions:
        key = quantize_coord(s.lat, s.lon)
        label_key = (s.source, s.label.lower())
        if key in seen_keys or label_key in seen_labels:
            continue
        seen_keys.add(key)
        seen_labels.add(label_key)
        out.append(s)
    return out


# ── Autocomplete ────────────────────────────────────────────────────────────

def autocomplete(query: str, limit: int = 8) -> list[Suggestion]:
    """Return up to `limit` ranked suggestions across all local sources."""
    if not query or not query.strip():
        return []
    q = query.strip()
    q_lower = q.lower()

    _ensure_in_mem_index()
    suggestions: list[Suggestion] = []

    # 1. Neighborhoods -- exact + prefix. The index is sorted by `name`, so
    # `bisect` finds the prefix window in O(log N + k) and we only iterate
    # the entries that can possibly match.
    n_lo, n_hi = _prefix_window(_neighborhood_keys, q_lower)
    for j in range(n_lo, n_hi):
        name, display, lat, lon = _neighborhood_index[j]
        exact = name == q_lower
        suggestions.append(Suggestion(display, lat, lon, "neighborhood",
                                      _score("neighborhood", lat, lon, exact=exact)))

    # 2. Cross-street parse (highest-confidence intersection lookup)
    parsed = parse_cross_street(q)
    if parsed is not None:
        a, b = parsed
        suggestions.extend(_query_intersections_exact(a, b))

    # 3. Address normalized prefix -- only if the query has a leading number
    norm_addr = normalize_address(q)
    if norm_addr and norm_addr[0].isdigit():
        suggestions.extend(_query_addresses_prefix(norm_addr, limit=limit * 2))

    # 4. Single-name intersection FTS (e.g. user typed "clark" -- show some
    #    Clark intersections so they can refine).
    norm_street = normalize_street_name(q)
    if norm_street and " " not in norm_street and parsed is None and not (norm_addr and norm_addr[0].isdigit()):
        suggestions.extend(_query_intersections_prefix(norm_street, limit=limit))

    # 5. POI exact + prefix match (downtown Chicago landmarks etc.). Same
    # bisect-window trick as the neighborhood scan — the POI index can be
    # thousands of entries, so this is the hottest part of the autocomplete
    # path and the prior linear scan dominated short-query latency.
    p_lo, p_hi = _prefix_window(_poi_keys, q_lower)
    suggestion_cap = limit * 4
    for j in range(p_lo, p_hi):
        name_lower, display, lat, lon = _poi_index[j]
        exact = name_lower == q_lower
        suggestions.append(Suggestion(display, lat, lon, "place",
                                      _score("place", lat, lon, exact=exact)))
        # Capping so a common prefix like "the" doesn't run the whole window.
        if len(suggestions) >= suggestion_cap:
            break

    suggestions.sort(key=lambda s: -s.score)
    return _dedupe(suggestions)[:limit]


def _query_intersections_exact(a: str, b: str) -> list[Suggestion]:
    db = _connect()
    if db is None:
        return []
    rows = db.execute(
        "SELECT raw_a, raw_b, lat, lon FROM intersections "
        "WHERE (name_a = ? AND name_b = ?) OR (name_a = ? AND name_b = ?) "
        "LIMIT 20",
        (a, b, b, a),
    ).fetchall()
    out: list[Suggestion] = []
    for r in rows:
        label = f"{r['raw_a']} & {r['raw_b']}"
        out.append(Suggestion(label, r["lat"], r["lon"], "intersection",
                              _score("intersection", r["lat"], r["lon"], exact=True)))
    return out


def _query_intersections_prefix(name: str, limit: int) -> list[Suggestion]:
    """Return intersections where one canonical name starts with `name`.

    Useful when the user has typed a single street name and is still deciding
    on the cross. We return a few representative pairs.
    """
    db = _connect()
    if db is None:
        return []
    rows = db.execute(
        "SELECT raw_a, raw_b, lat, lon FROM intersections "
        "WHERE name_a = ? OR name_b = ? "
        "LIMIT ?",
        (name, name, limit),
    ).fetchall()
    out: list[Suggestion] = []
    for r in rows:
        label = f"{r['raw_a']} & {r['raw_b']}"
        out.append(Suggestion(label, r["lat"], r["lon"], "intersection",
                              _score("intersection", r["lat"], r["lon"], exact=False)))
    return out


def _query_addresses_prefix(norm: str, limit: int) -> list[Suggestion]:
    db = _connect()
    if db is None:
        return []
    rows = db.execute(
        "SELECT raw, lat, lon, (normalized = ?) AS is_exact "
        "FROM addresses WHERE normalized LIKE ? LIMIT ?",
        (norm, norm + "%", limit),
    ).fetchall()
    out: list[Suggestion] = []
    for r in rows:
        out.append(Suggestion(r["raw"], r["lat"], r["lon"], "address",
                              _score("address", r["lat"], r["lon"], exact=bool(r["is_exact"]))))
    return out


# ── Forward ─────────────────────────────────────────────────────────────────

def forward(query: str) -> tuple[float, float] | None:
    """Resolve `query` to a single (lat, lon) using the local cascade.

    Returns None on miss so the caller can fall back to Tier 3 (LocationIQ).
    """
    top = autocomplete(query, limit=1)
    if top:
        return (top[0].lat, top[0].lon)
    return None


# ── Reverse ─────────────────────────────────────────────────────────────────

def nearest_address(lat: float, lon: float, max_miles: float = 0.031) -> dict | None:
    """Return the nearest address-point row within `max_miles` (~50 m default).

    Implemented with a small bounding-box prefilter plus per-candidate
    Haversine; for the few thousand candidates this returns at most, the
    overhead is < 1 ms and avoids needing a second KDTree in process memory.
    """
    db = _connect()
    if db is None:
        return None
    # 1° latitude ≈ 69 mi; 1° longitude ≈ 69 mi · cos(lat). Using a single
    # /60 denominator made the longitude box narrower than max_miles at
    # Chicago's latitude (~42°), silently excluding in-range candidates.
    span_lat = max_miles / 69.0
    cos_lat = math.cos(math.radians(lat))
    span_lon = max_miles / (69.0 * cos_lat) if cos_lat > 1e-6 else span_lat
    rows = db.execute(
        "SELECT raw, lat, lon FROM addresses "
        "WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
        (lat - span_lat, lat + span_lat, lon - span_lon, lon + span_lon),
    ).fetchall()
    best: dict | None = None
    best_d = max_miles
    for r in rows:
        d = haversine_miles(lat, lon, r["lat"], r["lon"])
        if d < best_d:
            best_d = d
            best = {"raw": r["raw"], "lat": r["lat"], "lon": r["lon"], "distance_miles": d}
    return best
