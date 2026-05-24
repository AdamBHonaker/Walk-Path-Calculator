"""
Location geocoding for Passage.

Resolution order for any free-text query:
  1. Coord-pair regex                    (instant, no network)
  2. Exact NEIGHBORHOOD_COORDS match     (instant, no network)
  3. Fuzzy NEIGHBORHOOD_COORDS match     (instant, no network)
  4. local_search.forward()              (instant, SQLite mmap)
                                         - Chicago OSM addresses
                                         - Chicago OSM cross-streets
                                         - POIs from places_*.json
  5. geocode_external() -> LocationIQ    (network, free tier)

The Tier-5 fallback is cached durably in `chicago_geocode.db` so any string
that ever resolves once is served locally on every subsequent call. The
breaker around Tier 5 still trips on 429 / persistent-failure responses.
"""

import atexit as _atexit
import hashlib
import logging
import math
import os
import re
import sqlite3
import threading
import time
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path

import requests

from utils import (
    CHICAGO_EAST,
    CHICAGO_NORTH,
    CHICAGO_SOUTH,
    CHICAGO_WEST,
    chicago_bbox_contains,
    haversine_miles,
    METERS_PER_MILE,
)

logger = logging.getLogger(__name__)


def _redact(query: str) -> str:
    """Return a short opaque tag for `query` so logs do not store user-typed text."""
    if not query:
        return "<empty>"
    return "q#" + hashlib.sha256(query.encode("utf-8")).hexdigest()[:10]


def _redact_coord(lat: "float | None", lon: "float | None") -> str:
    """Quantize a lat/lon to ~1 km precision for logging.

    Free-text geocoder queries commonly resolve to user homes / workplaces, so
    the resolved coordinate is the same PII `_redact()` exists to keep out of
    logs. Two decimals (~1.1 km at Chicago latitude) keeps the diagnostic
    value (is it in Chicago? is it lakefront vs. west side?) without pinning
    the user to an address.
    """
    if lat is None or lon is None:
        return "(?, ?)"
    return f"({lat:.2f}, {lon:.2f})"


class LocationOutsideChicagoError(Exception):
    """Raised when `resolve_location` finds real coordinates that fall outside
    Chicago's bbox. Distinct from a None return (which means "not found")."""

    def __init__(self, query: str, coords: "tuple[float, float]"):
        super().__init__(f"{query!r} resolved to {coords}, outside Chicago bbox")
        self.query = query
        self.coords = coords


class GeocoderDegradedError(Exception):
    """Raised when the hosted geocoder has recently returned 429 and the
    circuit breaker is open. Neighborhood / address / intersection / POI
    queries do not trip this — only queries that would need to hit the
    hosted fallback."""

    DEFAULT_MESSAGE = (
        "The geocoding service is overloaded — try a Chicago neighborhood "
        "name (e.g., 'Wrigleyville') instead."
    )


# ── Circuit breaker for hosted-geocoder 429s ─────────────────────────────────
# When LocationIQ returns HTTP 429 (or its `{"error":"Rate Limited..."}` body),
# open the breaker for an exponentially-increasing cool-off (60s -> 120s ->
# 240s, capped at 5 min). During cool-off, the network call is skipped and
# `GeocoderDegradedError` is raised. The first call after cool-off probes the
# service; success closes the breaker and resets backoff.
_CIRCUIT_INITIAL_COOLOFF_S: float = 60.0
_CIRCUIT_MAX_COOLOFF_S: float = 300.0
_circuit_open_until: float = 0.0
_circuit_consecutive_trips: int = 0
_circuit_lock = threading.Lock()


def _circuit_is_open() -> bool:
    return time.time() < _circuit_open_until


def _circuit_trip_429() -> None:
    """Record a 429; open the breaker with exponential backoff."""
    global _circuit_open_until, _circuit_consecutive_trips
    with _circuit_lock:
        _circuit_consecutive_trips += 1
        cooloff = min(
            _CIRCUIT_INITIAL_COOLOFF_S * (2 ** (_circuit_consecutive_trips - 1)),
            _CIRCUIT_MAX_COOLOFF_S,
        )
        _circuit_open_until = time.time() + cooloff
        logger.warning(
            "LocationIQ 429 -- circuit breaker open for %.0fs (trip=%d)",
            cooloff, _circuit_consecutive_trips,
        )


def _circuit_record_success() -> None:
    """Close the breaker after a successful probe."""
    global _circuit_open_until, _circuit_consecutive_trips
    with _circuit_lock:
        if _circuit_consecutive_trips > 0:
            logger.info("LocationIQ recovered -- circuit breaker closed")
        _circuit_open_until = 0.0
        _circuit_consecutive_trips = 0


def _circuit_reset_for_test() -> None:
    """Test-only: force the breaker back to closed/zero state."""
    global _circuit_open_until, _circuit_consecutive_trips
    with _circuit_lock:
        _circuit_open_until = 0.0
        _circuit_consecutive_trips = 0


# ── LocationIQ HTTP client ──────────────────────────────────────────────────

_LOCATIONIQ_BASE = "https://us1.locationiq.com/v1"
_LOCATIONIQ_API_KEY = os.getenv("LOCATIONIQ_API_KEY", "")
_LOCATIONIQ_TIMEOUT_S = 5

# Chicago viewbox for LocationIQ — note its `viewbox` parameter takes
# `min_lon,max_lat,max_lon,min_lat` (NW, SE) rather than the GIS-standard
# (min, min, max, max). The `bounded=1` flag tells LocationIQ to restrict
# results to inside the viewbox rather than just preferring them.
_LOCATIONIQ_VIEWBOX = f"{CHICAGO_WEST},{CHICAGO_NORTH},{CHICAGO_EAST},{CHICAGO_SOUTH}"

# TD-055 / B-21: configure the long-lived HTTP session with three things:
#   1. A descriptive User-Agent — LocationIQ's ToS (and good citizenship)
#      asks every client to identify itself. Without this, requests goes
#      out as "python-requests/2.x" which is indistinguishable from a
#      scraper and unhelpful in their logs.
#   2. A retry adapter on transient 5xx + rate-limit responses. We back
#      off exponentially (0.5 s, 1.0 s, 2.0 s) on 502/503/504 — these are
#      LocationIQ's own gateway hiccups, distinct from the 429-driven
#      circuit breaker. Retries on 429 are intentionally OFF (the breaker
#      handles that path so we don't double-count the budget).
#   3. The session is closed at shutdown via the FastAPI lifespan
#      teardown registered in main.py (TD-056 added that hook).
def _build_http_session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = (
        "Passage/1.0 (+https://wayfarer-passage.vercel.app/) "
        "python-requests"
    )
    try:
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        retry = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=(502, 503, 504),
            allowed_methods=frozenset(("GET", "HEAD")),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
    except ImportError:
        # urllib3 retry support is optional — if it's somehow not
        # installed (it ships with requests, so this is paranoid), the
        # session still works without retries.
        pass
    return session


_http_session = _build_http_session()


def close_http_session() -> None:
    """Close the geocoding HTTP session. Called from FastAPI lifespan
    teardown so pooled keep-alive connections don't outlive the worker.
    """
    try:
        _http_session.close()
    except Exception:  # pragma: no cover — defensive
        pass

# Latch so the missing-API-key warning fires at most once per process.
_missing_api_key_warned: bool = False


def _warn_missing_api_key() -> None:
    global _missing_api_key_warned
    if not _missing_api_key_warned:
        logger.warning("LOCATIONIQ_API_KEY not set -- hosted fallback unavailable")
        _missing_api_key_warned = True


# ── SQLite-backed cache ─────────────────────────────────────────────────────

# Cache lives in the same chicago_geocode.db file that local_search reads.
# A dedicated write connection (separate from local_search's read-only
# connection) lets concurrent reads continue during a cache insert.
_CACHE_DB_PATH = Path(__file__).resolve().parent / "data" / "chicago_geocode.db"
_cache_lock = threading.Lock()
_cache_db: sqlite3.Connection | None = None


def _cache_connect() -> sqlite3.Connection | None:
    """Open the writeable cache DB, or return None if the artifact is missing.

    A missing DB is recoverable: forward / reverse calls just skip caching
    and continue to hit LocationIQ on every miss. That's expected during
    a fresh clone before the ingestion scripts run.
    """
    global _cache_db
    if _cache_db is not None:
        return _cache_db
    with _cache_lock:
        if _cache_db is not None:
            return _cache_db
        if not _CACHE_DB_PATH.exists():
            logger.warning(
                "%s missing -- LocationIQ responses will not be cached. "
                "Run backend/scripts/build_*.py to populate it.",
                _CACHE_DB_PATH,
            )
            return None
        conn = sqlite3.connect(str(_CACHE_DB_PATH), check_same_thread=False, isolation_level=None)
        # WAL gives us non-blocking reads alongside writes. autocommit
        # (isolation_level=None) avoids transaction-management overhead
        # for the single-row cache updates we do.
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
        except sqlite3.OperationalError:
            pass
        conn.row_factory = sqlite3.Row
        _cache_db = conn
        return _cache_db


# Sentinel used to distinguish "cache miss" from "cached negative result".
# `_cache_get_forward` returns NEG_HIT when the table has a row with
# lat/lon = NULL (meaning we previously asked and got nothing), so callers
# don't re-query LocationIQ for known-bad queries.
class _Neg:
    __slots__ = ()
    def __repr__(self): return "<NEG_HIT>"
NEG_HIT = _Neg()


def _cache_get_forward(query: str):
    """Return (lat, lon) tuple on hit, NEG_HIT for a cached negative, or None on miss."""
    db = _cache_connect()
    if db is None:
        return None
    row = db.execute(
        "SELECT lat, lon FROM cached_forward WHERE query = ?", (query,),
    ).fetchone()
    if row is None:
        return None
    if row["lat"] is None or row["lon"] is None:
        return NEG_HIT
    return (float(row["lat"]), float(row["lon"]))


def _cache_set_forward(query: str, coords: "tuple[float, float] | None", source: str) -> None:
    """Store (lat, lon) or a negative entry (None) for `query`."""
    db = _cache_connect()
    if db is None:
        return
    lat = coords[0] if coords is not None else None
    lon = coords[1] if coords is not None else None
    try:
        db.execute(
            "INSERT OR REPLACE INTO cached_forward (query, lat, lon, source, fetched_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (query, lat, lon, source, int(time.time())),
        )
    except sqlite3.Error as exc:
        logger.warning("cached_forward write failed for %s: %s", _redact(query), exc)


def _cache_get_reverse(lat: float, lon: float) -> dict | None:
    """Return {"label", "source"} on hit, or None on miss."""
    db = _cache_connect()
    if db is None:
        return None
    lat_q = round(lat * 1e5)
    lon_q = round(lon * 1e5)
    row = db.execute(
        "SELECT label, source FROM cached_reverse WHERE lat_q = ? AND lon_q = ?",
        (lat_q, lon_q),
    ).fetchone()
    if row is None:
        return None
    return {"label": row["label"], "source": row["source"]}


def _cache_set_reverse(lat: float, lon: float, label: str, source: str) -> None:
    db = _cache_connect()
    if db is None:
        return
    try:
        db.execute(
            "INSERT OR REPLACE INTO cached_reverse (lat_q, lon_q, label, source, fetched_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (round(lat * 1e5), round(lon * 1e5), label, source, int(time.time())),
        )
    except sqlite3.Error as exc:
        logger.warning("cached_reverse write failed for %s: %s", _redact_coord(lat, lon), exc)


def _cache_clear_forward_for_test(query: str) -> None:
    """Test hook: remove a single forward-cache entry. Used by the breaker
    tests so a synthetic query is guaranteed to hit the network path."""
    db = _cache_connect()
    if db is None:
        return
    try:
        db.execute("DELETE FROM cached_forward WHERE query = ?", (query,))
    except sqlite3.Error:
        pass


@_atexit.register
def _close_cache_db() -> None:
    global _cache_db
    db = _cache_db
    if db is None:
        return
    try:
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except sqlite3.Error:
        pass
    try:
        db.close()
    except Exception:
        pass
    _cache_db = None


# ─────────────────────────────────────────────────────────────────────────────
# Neighborhood / landmark coordinates
# Geographic scope: full Chicago city limits — all 77 community areas
# (Howard St on the north → southern city edge near 138th St; Lakefront on
# the east → western city edge near Harlem Ave / Pulaski Rd).
# ─────────────────────────────────────────────────────────────────────────────

NEIGHBORHOOD_COORDS: dict[str, tuple[float, float]] = {

    # ── ROGERS PARK / FAR NORTH ──────────────────────────────────────────────
    "rogers park":          (42.0085, -87.6688),
    "loyola":               (42.0012, -87.6611),
    "loyola university":    (41.9998, -87.6586),
    "granville":            (41.9943, -87.6579),
    "thorndale":            (41.9898, -87.6577),
    "morse":                (42.0082, -87.6660),
    "jarvis":               (42.0159, -87.6692),

    # ── EDGEWATER ────────────────────────────────────────────────────────────
    "edgewater":            (41.9889, -87.6600),
    "bryn mawr":            (41.9846, -87.6585),
    "foster beach":         (41.9790, -87.6498),
    "foster avenue beach":  (41.9790, -87.6498),

    # ── ANDERSONVILLE ────────────────────────────────────────────────────────
    "andersonville":        (41.9800, -87.6682),
    "berwyn":               (41.9778, -87.6593),
    "berwyn station":       (41.9778, -87.6593),
    "swedish american museum": (41.9767, -87.6682),

    # ── UPTOWN ───────────────────────────────────────────────────────────────
    "uptown":               (41.9650, -87.6550),
    "wilson":               (41.9646, -87.6580),
    "lawrence":             (41.9692, -87.6588),
    "argyle":               (41.9734, -87.6580),
    "sheridan":             (41.9542, -87.6537),
    "montrose beach":       (41.9643, -87.6384),
    "montrose harbor":      (41.9643, -87.6384),
    "uptown theatre":       (41.9695, -87.6605),
    "green mill":           (41.9694, -87.6603),
    "illinois masonic":     (41.9362, -87.6505),
    "advocate illinois masonic": (41.9362, -87.6505),

    # ── LINCOLN SQUARE / RAVENSWOOD ──────────────────────────────────────────
    "lincoln square":       (41.9679, -87.6848),
    "ravenswood":           (41.9656, -87.6741),

    # ── WRIGLEYVILLE / LAKEVIEW ──────────────────────────────────────────────
    "wrigleyville":         (41.9476, -87.6553),
    "wrigley field":        (41.9484, -87.6553),
    "lakeview":             (41.9433, -87.6513),
    "east lakeview":        (41.9395, -87.6420),
    "boystown":             (41.9444, -87.6491),
    "addison":              (41.9472, -87.6535),
    "belmont":              (41.9395, -87.6531),
    "southport corridor":   (41.9416, -87.6641),
    "southport":            (41.9438, -87.6636),
    "diversey":             (41.9321, -87.6527),
    "wellington":           (41.9360, -87.6545),
    "paulina":              (41.9437, -87.6705),
    "diversey harbor":      (41.9307, -87.6341),
    "theater on the lake":  (41.9271, -87.6307),

    # ── LINCOLN PARK ─────────────────────────────────────────────────────────
    "lincoln park":         (41.9228, -87.6482),
    "lincoln park zoo":     (41.9220, -87.6332),
    "fullerton":            (41.9253, -87.6527),
    "armitage":             (41.9175, -87.6513),
    "depaul":               (41.9253, -87.6554),
    "depaul university":    (41.9253, -87.6554),
    "north avenue beach":   (41.9172, -87.6270),
    "oz park":               (41.9209, -87.6456),
    "chicago history museum": (41.9120, -87.6313),
    "peggy notebaert nature museum": (41.9268, -87.6353),
    "steppenwolf theatre":  (41.9117, -87.6479),
    "steppenwolf":          (41.9117, -87.6479),

    # ── OLD TOWN ─────────────────────────────────────────────────────────────
    "old town":             (41.9101, -87.6364),
    "sedgwick":             (41.9101, -87.6386),
    "north/clybourn":       (41.9103, -87.6486),
    "north clybourn":       (41.9103, -87.6486),
    "second city":          (41.9052, -87.6302),
    "wells street":         (41.9101, -87.6340),

    # ── GOLD COAST ───────────────────────────────────────────────────────────
    "gold coast":           (41.9016, -87.6298),
    "clark/division":       (41.9046, -87.6312),
    "clark division":       (41.9046, -87.6312),
    "newberry library":     (41.9019, -87.6317),
    "washington square park": (41.8993, -87.6306),
    "lurie childrens hospital": (41.8965, -87.6212),
    "lurie children's hospital": (41.8965, -87.6212),
    "chicago water tower":  (41.8972, -87.6244),
    "water tower place":    (41.8972, -87.6244),
    "pumping station":      (41.8972, -87.6244),

    # ── RIVER NORTH ──────────────────────────────────────────────────────────
    "river north":          (41.8944, -87.6333),
    "merchandise mart":     (41.8883, -87.6360),
    "chicago avenue":       (41.8966, -87.6269),
    "gallery district":     (41.8933, -87.6348),

    # ── NEAR NORTH / STREETERVILLE / MAG MILE ────────────────────────────────
    "near north":           (41.8976, -87.6271),
    "streeterville":        (41.8924, -87.6196),
    "magnificent mile":     (41.8951, -87.6249),
    "mag mile":             (41.8951, -87.6249),
    "michigan avenue":      (41.8847, -87.6240),
    "navy pier":            (41.8919, -87.6053),
    "grand":                (41.8912, -87.6276),
    "john hancock":         (41.8988, -87.6232),
    "northwestern memorial hospital": (41.8951, -87.6218),
    "northwestern memorial": (41.8951, -87.6218),

    # ── THE LOOP ─────────────────────────────────────────────────────────────
    "loop":                 (41.8827, -87.6326),
    "the loop":             (41.8827, -87.6326),
    "downtown":             (41.8827, -87.6326),
    "downtown chicago":     (41.8827, -87.6326),
    "millennium park":      (41.8827, -87.6233),
    "maggie daley park":    (41.8832, -87.6196),
    "grant park":           (41.8757, -87.6189),
    "art institute":            (41.8796, -87.6237),
    "art institute of chicago": (41.8796, -87.6237),
    "the art institute":        (41.8796, -87.6237),
    "theater district":     (41.8854, -87.6295),
    "state street":         (41.8800, -87.6278),
    "union station":        (41.8789, -87.6401),
    "ogilvie":              (41.8821, -87.6416),
    "ogilvie transportation center": (41.8821, -87.6416),
    "museum campus":        (41.8666, -87.6151),
    "soldier field":        (41.8623, -87.6167),
    "shedd aquarium":       (41.8676, -87.6139),
    "field museum":         (41.8663, -87.6168),
    "adler planetarium":    (41.8664, -87.6069),
    "harold washington library": (41.8762, -87.6286),
    "chicago cultural center": (41.8838, -87.6248),
    "millennium station":   (41.8844, -87.6244),
    "willis tower":         (41.8789, -87.6359),
    "sears tower":          (41.8789, -87.6359),
    "wrigley building":     (41.8891, -87.6244),
    "chicago riverwalk":    (41.8885, -87.6232),
    "lyric opera":          (41.8823, -87.6374),
    "art museum":           (41.8872, -87.6542),
    "auditorium theatre":   (41.8762, -87.6263),
    "chicago symphony orchestra": (41.8796, -87.6263),
    "symphony center":      (41.8796, -87.6263),
    "columbia college":     (41.8723, -87.6247),
    "columbia college chicago": (41.8723, -87.6247),
    "daley plaza":          (41.8840, -87.6318),
    "city hall":            (41.8840, -87.6318),

    # ── SOUTH LOOP / NEAR SOUTH ──────────────────────────────────────────────
    "south loop":           (41.8674, -87.6278),
    "printers row":         (41.8723, -87.6278),
    "printer's row":        (41.8723, -87.6278),
    "chinatown":            (41.8508, -87.6326),
    "armour square":        (41.8500, -87.6350),
    "bridgeport":           (41.8350, -87.6450),

    # ── NEAR WEST SIDE ───────────────────────────────────────────────────────
    "near west side":       (41.8750, -87.6600),
    "greektown":            (41.8775, -87.6475),
    "little italy":         (41.8725, -87.6550),
    "uic":                  (41.8700, -87.6500),
    "university village":   (41.8700, -87.6500),
    "united center":        (41.8806, -87.6742),
    "medical district":     (41.8700, -87.6730),

    # ── WEST TOWN / UKRAINIAN VILLAGE / WICKER PARK ──────────────────────────
    "west town":            (41.9000, -87.6700),
    "ukrainian village":    (41.8950, -87.6800),
    "wicker park":          (41.9090, -87.6800),
    "bucktown":             (41.9190, -87.6800),
    "noble square":         (41.8980, -87.6650),
    "east village":         (41.8980, -87.6750),

    # ── LOGAN SQUARE / HUMBOLDT PARK ─────────────────────────────────────────
    "logan square":         (41.9290, -87.7000),
    "humboldt park":        (41.9000, -87.7200),
    "palmer square":        (41.9230, -87.7000),

    # ── AVONDALE / HERMOSA ───────────────────────────────────────────────────
    "avondale":             (41.9400, -87.7100),
    "hermosa":              (41.9200, -87.7200),

    # ── IRVING PARK / NORTH PARK ─────────────────────────────────────────────
    "irving park":          (41.9540, -87.7200),
    "mayfair":              (41.9730, -87.7100),
    "north park":           (41.9800, -87.7200),
    "west ridge":           (41.9990, -87.6950),

    # ── EAST GARFIELD PARK / NORTH LAWNDALE ──────────────────────────────────
    "east garfield park":   (41.8800, -87.7200),
    "north lawndale":       (41.8650, -87.7200),

    # ── SOUTH LAWNDALE / PILSEN / BACK OF THE YARDS ──────────────────────────
    "little village":       (41.8250, -87.7200),
    "south lawndale":       (41.8250, -87.7200),
    "pilsen":               (41.8550, -87.6600),
    "18th street":          (41.8576, -87.6809),
    "back of the yards":    (41.8100, -87.6550),
    "mckinley park":        (41.8290, -87.6750),
    "brighton park":        (41.8250, -87.6950),

    # ── BRONZEVILLE / DOUGLAS / GRAND BOULEVARD ──────────────────────────────
    "bronzeville":          (41.8350, -87.6150),
    "douglas":              (41.8420, -87.6200),
    "grand boulevard":      (41.8200, -87.6150),
    "sox-35th":             (41.8312, -87.6304),
    "35th street":          (41.8304, -87.6728),

    # ── KEY CTA STATIONS (within coverage area) ───────────────────────────────
    "cermak-chinatown":     (41.8534, -87.6306),
    "pulaski":              (41.9390, -87.7272),
    "kedzie":               (41.8864, -87.7063),

    # ── LOOP TRAIN STATIONS ──────────────────────────────────────────────────
    "lake":                 (41.8847, -87.6280),
    "monroe":               (41.8806, -87.6278),
    "jackson":              (41.8783, -87.6276),
    "harrison":             (41.8742, -87.6278),
    "roosevelt":            (41.8674, -87.6278),
    "clark/lake":           (41.8858, -87.6310),
    "state/lake":           (41.8858, -87.6278),
    "washington/wabash":    (41.8832, -87.6258),
    "washington/wells":     (41.8829, -87.6340),
    "adams/wabash":         (41.8796, -87.6258),
    "quincy":               (41.8784, -87.6340),
    "lasalle/van buren":    (41.8757, -87.6315),
    "clinton":              (41.8753, -87.6411),
}


# ─────────────────────────────────────────────────────────────────────────────
# Street abbreviation normalization
# ─────────────────────────────────────────────────────────────────────────────

_ABBR_PAIRS = (
    ("ave",  "avenue"),
    ("blvd", "boulevard"),
    ("cir",  "circle"),
    ("ct",   "court"),
    ("dr",   "drive"),
    ("expy", "expressway"),
    ("hwy",  "highway"),
    ("ln",   "lane"),
    ("pkwy", "parkway"),
    ("pl",   "place"),
    ("rd",   "road"),
    ("sq",   "square"),
    ("st",   "street"),
)
_ABBR_MAP: dict[str, str] = dict(_ABBR_PAIRS)
_sorted_abbrs = sorted(_ABBR_MAP, key=len, reverse=True)
_STREET_ABBR_RE = re.compile(
    r"\b(" + "|".join(re.escape(a) + r"\.?" for a in _sorted_abbrs) + r")\b(?=\s*(?:,|$))",
    re.IGNORECASE,
)


def _normalize_street_abbr(query: str) -> str:
    """Expand USPS street suffix abbreviations (e.g. "Ave" → "avenue")."""
    def _replace(m: re.Match) -> str:
        token = m.group(0).lower().rstrip(".")
        return _ABBR_MAP.get(token, m.group(0))
    return _STREET_ABBR_RE.sub(_replace, query)


# ─────────────────────────────────────────────────────────────────────────────
# Fuzzy neighborhood matching
# ─────────────────────────────────────────────────────────────────────────────

_FUZZY_STOP_WORDS: frozenset[str] = frozenset(
    {"the", "of", "a", "an", "and", "at", "in", "on", "chicago"}
)
# 0.95 is calibrated against the regression set in test_main.py
# `TestFuzzyMatchRegression`. Letting it slip below 0.94 starts admitting
# false positives like "huntington" -> "uptown"; above 0.96 starts rejecting
# legitimate typos like "broonzeville" -> "bronzeville".
_FUZZY_THRESHOLD = 0.95


@lru_cache(maxsize=1)
def _word_index() -> dict[str, frozenset[str]]:
    """Inverted word index for fast candidate filtering."""
    word_keys: dict[str, set[str]] = {}
    for key in NEIGHBORHOOD_COORDS:
        for w in set(key.split()) - _FUZZY_STOP_WORDS:
            word_keys.setdefault(w, set()).add(key)
    return {w: frozenset(ks) for w, ks in word_keys.items()}


@lru_cache(maxsize=1024)
def fuzzy_match_neighborhood(query: str) -> "tuple[tuple[float, float] | None, str | None]":
    """Fuzzy-match a lowercased, stripped query against NEIGHBORHOOD_COORDS."""
    q_words = set(query.split()) - _FUZZY_STOP_WORDS

    if not q_words:
        return None, None

    if len(q_words) > 1:
        idx = _word_index()
        candidate_keys: set[str] = set()
        for w in q_words:
            candidate_keys |= idx.get(w, frozenset())
        if not candidate_keys:
            candidate_keys = set(NEIGHBORHOOD_COORDS.keys())
    else:
        candidate_keys = set(NEIGHBORHOOD_COORDS.keys())

    matcher = SequenceMatcher(None, "", query)
    best_score = 0.0
    best_key: str | None = None
    for key in candidate_keys:
        matcher.set_seq1(key)
        score = matcher.ratio()
        if score > best_score:
            best_score = score
            best_key = key

    if best_score >= _FUZZY_THRESHOLD and best_key:
        return NEIGHBORHOOD_COORDS[best_key], best_key
    return None, None


# ─────────────────────────────────────────────────────────────────────────────
# LocationIQ forward + reverse
# ─────────────────────────────────────────────────────────────────────────────

def geocode_external(query: str) -> "tuple[float, float] | None":
    """Forward geocode `query` via LocationIQ, biased to Chicago.

    Results (positive and negative) are cached in chicago_geocode.db so the
    same query never hits the network twice. Returns None when the API key
    is missing, the response says no match, or the result falls outside
    Chicago's bbox. Raises `GeocoderDegradedError` when the breaker is open.
    """
    # 1. Cache hit short-circuits the network call (whether positive or negative).
    cached = _cache_get_forward(query)
    if cached is NEG_HIT:
        return None
    if cached is not None:
        return cached  # tuple[float, float]

    if not _LOCATIONIQ_API_KEY:
        _warn_missing_api_key()
        return None

    # 2. Breaker check -- skip network during cool-off.
    if _circuit_is_open():
        raise GeocoderDegradedError(GeocoderDegradedError.DEFAULT_MESSAGE)

    # 3. Real network call.
    coords: "tuple[float, float] | None" = None
    cache_negative = False
    biased_query = query if "chicago" in query.lower() else f"{query}, Chicago, IL"
    try:
        resp = _http_session.get(
            f"{_LOCATIONIQ_BASE}/search",
            params={
                "key": _LOCATIONIQ_API_KEY,
                "q": biased_query,
                "format": "json",
                "limit": 1,
                "countrycodes": "us",
                "viewbox": _LOCATIONIQ_VIEWBOX,
                "bounded": 1,
                "normalizeaddress": 1,
            },
            headers={"Accept": "application/json"},
            timeout=_LOCATIONIQ_TIMEOUT_S,
        )

        # 429 -> trip breaker. LocationIQ returns plain 429 for rate-limited;
        # 401 / 403 for bad API key; 404 for "no result"; 200 for hits.
        if resp.status_code == 429:
            _circuit_trip_429()
            raise GeocoderDegradedError(GeocoderDegradedError.DEFAULT_MESSAGE)

        if resp.status_code == 404:
            # Definitive "no match" -- cache negatively so we don't retry.
            cache_negative = True
            _circuit_record_success()
        elif resp.status_code in (401, 403):
            # Bad / missing API key. Don't cache (so a key fix takes effect
            # immediately) and don't probe the breaker (it's a config issue,
            # not a rate-limit issue).
            logger.error(
                "LocationIQ %s for %s -- check LOCATIONIQ_API_KEY",
                resp.status_code, _redact(query),
            )
        elif resp.status_code == 200:
            data = resp.json() if resp.content else []
            if isinstance(data, list) and data:
                entry = data[0]
                try:
                    candidate = (float(entry["lat"]), float(entry["lon"]))
                except (KeyError, TypeError, ValueError):
                    candidate = None
                if candidate is None:
                    cache_negative = True
                elif not chicago_bbox_contains(*candidate):
                    logger.warning(
                        "LocationIQ returned out-of-bbox coords for %s -> %s; ignoring",
                        _redact(query), _redact_coord(*candidate),
                    )
                    cache_negative = True
                else:
                    coords = candidate
                    logger.info("LocationIQ geocoded %s -> %s", _redact(query), _redact_coord(*coords))
            else:
                cache_negative = True
            _circuit_record_success()
        else:
            logger.warning(
                "LocationIQ returned unexpected status %s for %s",
                resp.status_code, _redact(query),
            )
    except GeocoderDegradedError:
        raise
    except Exception as exc:
        logger.error("LocationIQ forward failed for %s: %s", _redact(query), exc)

    # 4. Write result through.
    if coords is not None:
        _cache_set_forward(query, coords, "locationiq")
    elif cache_negative:
        _cache_set_forward(query, None, "locationiq")
    return coords


def _reverse_geocode_external(lat: float, lon: float) -> "str | None":
    """Reverse geocode via LocationIQ; return a short label or None.

    Honors the same 429 breaker as `geocode_external`. The caller is
    responsible for caching successful labels into `cached_reverse`.
    """
    if not _LOCATIONIQ_API_KEY:
        _warn_missing_api_key()
        return None
    if _circuit_is_open():
        return None
    try:
        resp = _http_session.get(
            f"{_LOCATIONIQ_BASE}/reverse",
            params={
                "key": _LOCATIONIQ_API_KEY,
                "lat": lat,
                "lon": lon,
                "format": "json",
                "normalizeaddress": 1,
                "zoom": 18,
            },
            headers={"Accept": "application/json"},
            timeout=_LOCATIONIQ_TIMEOUT_S,
        )
        if resp.status_code == 429:
            _circuit_trip_429()
            return None
        if resp.status_code == 404:
            _circuit_record_success()
            return None
        if resp.status_code in (401, 403):
            logger.error(
                "LocationIQ reverse %s -- check LOCATIONIQ_API_KEY", resp.status_code,
            )
            return None
        if resp.status_code != 200:
            logger.warning("LocationIQ reverse unexpected %s", resp.status_code)
            return None
        data = resp.json() if resp.content else {}
        display = (data.get("display_name") or "").strip()
        _circuit_record_success()
        if not display:
            return None
        # LocationIQ returns full multi-comma addresses ("123 Main St, ...,
        # Cook County, Illinois, 60601, United States of America"). Trim
        # everything after the ZIP for a tighter label.
        m = re.search(r",\s*(\d{5})(?:-\d{4})?\b", display)
        if m:
            display = display[: m.end()]
        # Strip a trailing ", USA" if any leftover punctuation didn't catch
        # earlier (defensive — display_name format can vary).
        display = re.sub(r",\s*(USA|United States(?: of America)?)\s*$", "", display).strip()
        return display or None
    except Exception as exc:
        logger.error("LocationIQ reverse failed for %s: %s", _redact_coord(lat, lon), exc)
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Main resolution entry point
# ─────────────────────────────────────────────────────────────────────────────

_COORD_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")


def resolve_location(query: str) -> "tuple[float, float] | None":
    """Convert a free-text Chicago location query to (lat, lon).

    Cascade order:
        coord pair  ->  NEIGHBORHOOD_COORDS exact  ->  fuzzy match
                    ->  local_search.forward (SQLite addresses/intersections/POIs)
                    ->  LocationIQ (via geocode_external)

    Raises `LocationOutsideChicagoError` when a path resolves to real
    coordinates outside Chicago's bbox.
    """
    coords = _resolve_location_inner(query)
    if coords is not None and not chicago_bbox_contains(*coords):
        raise LocationOutsideChicagoError(query, coords)
    return coords


def _resolve_location_inner(query: str) -> "tuple[float, float] | None":
    m = _COORD_RE.match(query)
    if m:
        return float(m.group(1)), float(m.group(2))

    q = query.strip().lower()
    q = _normalize_street_abbr(q)

    coords = NEIGHBORHOOD_COORDS.get(q)
    if coords:
        return coords

    coords, _ = fuzzy_match_neighborhood(q)
    if coords:
        return coords

    # Tier 2 -- local SQLite-backed search. Lazy import to keep the geocoding
    # module loadable in test fixtures that don't have chicago_geocode.db.
    try:
        from local_search import forward as _local_forward  # noqa: PLC0415
        coords = _local_forward(q)
        if coords:
            return coords
    except Exception as exc:
        logger.warning("local_search.forward failed for %s: %s", _redact(q), exc)

    # Tier 3 -- LocationIQ
    return geocode_external(q)


# ─────────────────────────────────────────────────────────────────────────────
# Reverse geocoding
# ─────────────────────────────────────────────────────────────────────────────

_REV_THRESHOLD_MI: float = 200.0 / METERS_PER_MILE          # 200 m in miles — neighborhood tier
_REV_ADDRESS_THRESHOLD_MI: float = 50.0 / METERS_PER_MILE   # 50 m in miles — address tier

_neighborhood_kdtree = None
_neighborhood_names: tuple[str, ...] = ()
_neighborhood_coords_arr = None
_neighborhood_kdtree_lock = threading.Lock()

# The KDTree pre-filter ranks candidates by Euclidean distance. In raw
# lon/lat degrees that is not the true geographic ordering — one degree of
# longitude is shorter than one of latitude. Scaling longitude by
# cos(reference latitude) makes the pre-filter metric-consistent so it
# cannot drop the genuinely-nearest neighborhood before the haversine
# re-rank. (Same projection pattern as local_search.py.)
from utils import KDTREE_LON_SCALE as _KDTREE_LON_SCALE  # noqa: E402


def _get_neighborhood_kdtree():
    global _neighborhood_kdtree, _neighborhood_names, _neighborhood_coords_arr
    if _neighborhood_kdtree is not None:
        return _neighborhood_kdtree
    with _neighborhood_kdtree_lock:
        if _neighborhood_kdtree is not None:
            return _neighborhood_kdtree
        from scipy.spatial import cKDTree
        import numpy as np

        items = list(NEIGHBORHOOD_COORDS.items())
        names = tuple(name for name, _ in items)
        coords = np.array(
            [[lon * _KDTREE_LON_SCALE, lat] for _, (lat, lon) in items], dtype=float
        )
        tree = cKDTree(coords)
        _neighborhood_names = names
        _neighborhood_coords_arr = coords
        _neighborhood_kdtree = tree
    return _neighborhood_kdtree


def reverse_geocode_point(lat: float, lon: float) -> dict:
    """Reverse geocode a (lat, lon) to a human-readable label.

    Returns {"label": str, "source": str}. Cascade:
        1. cached_reverse SQLite hit
        2. nearest neighborhood within 200 m
        3. nearest OSM address-point within ~50 m (via local_search)
        4. LocationIQ fallback (cached on success)
        5. coordinate-string fallback (never cached)
    """
    # 1. Cache hit
    cached = _cache_get_reverse(lat, lon)
    if cached is not None:
        return cached

    # 2. Nearest neighborhood via KDTree pre-filter, Haversine final ranking
    tree = _get_neighborhood_kdtree()
    k = min(5, len(_neighborhood_names))
    # Project the query point's longitude to match the tree's coordinate
    # space (see _KDTREE_LON_SCALE) so the pre-filter ranks by true distance.
    _, idx = tree.query([lon * _KDTREE_LON_SCALE, lat], k=k)
    candidate_idx = [int(idx)] if k == 1 else [int(i) for i in idx]
    best_name: str | None = None
    best_dist = float("inf")
    for i in candidate_idx:
        name = _neighborhood_names[i]
        nlat, nlon = NEIGHBORHOOD_COORDS[name]
        d = haversine_miles(lat, lon, nlat, nlon)
        if d < best_dist:
            best_dist = d
            best_name = name

    if best_name and best_dist <= _REV_THRESHOLD_MI:
        result = {"label": best_name.title(), "source": "neighborhood"}
        _cache_set_reverse(lat, lon, result["label"], result["source"])
        return result

    # 3. Nearest OSM address-point (Tier 2 reverse)
    try:
        from local_search import nearest_address as _local_nearest  # noqa: PLC0415
        addr = _local_nearest(lat, lon, max_miles=_REV_ADDRESS_THRESHOLD_MI)
        if addr is not None:
            result = {"label": addr["raw"], "source": "address"}
            _cache_set_reverse(lat, lon, result["label"], result["source"])
            return result
    except Exception as exc:
        logger.warning("local_search.nearest_address failed: %s", exc)

    # 4. LocationIQ fallback
    label = _reverse_geocode_external(lat, lon)
    if label:
        result = {"label": label, "source": "locationiq"}
        _cache_set_reverse(lat, lon, result["label"], result["source"])
        return result

    # 5. Coordinate fallback -- intentionally NOT cached so a transient
    # network failure doesn't permanently poison this lat/lon.
    return {"label": f"{lat:.5f}, {lon:.5f}", "source": "coordinates"}
