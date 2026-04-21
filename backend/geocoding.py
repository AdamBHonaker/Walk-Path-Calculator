"""
Location geocoding for Walk-Path-Calculator.

Resolution order for any query:
  1. Exact match against NEIGHBORHOOD_COORDS (instant, no network)
  2. Fuzzy match against NEIGHBORHOOD_COORDS (instant, no network)
  3. Google Maps Geocoding API (network call, biased to Chicago)

Requires GOOGLE_MAPS_API_KEY in .env for step 3. Steps 1 and 2 work offline.
"""

import json
import os
import re
import threading
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path

import requests

from utils import CHICAGO_BBOX_GOOGLE

_GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
_GOOGLE_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")

_GEOCODE_CACHE_PATH = Path(__file__).parent / "geocode_cache.json"
_geocode_lock = threading.Lock()
_http_session = requests.Session()


def _load_geocode_cache() -> dict:
    if _GEOCODE_CACHE_PATH.exists():
        try:
            raw = json.loads(_GEOCODE_CACHE_PATH.read_text(encoding="utf-8"))
            return {k: tuple(v) if v is not None else None for k, v in raw.items()}
        except Exception:
            pass
    return {}


def _save_geocode_cache(cache: dict) -> None:
    tmp = _GEOCODE_CACHE_PATH.with_suffix(".tmp")
    try:
        tmp.write_text(
            json.dumps({k: list(v) if v is not None else None for k, v in cache.items()},
                       indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(_GEOCODE_CACHE_PATH)
    except Exception as exc:
        print(f"[geocoding] Could not save geocode cache: {exc}")


_geocode_cache: dict = _load_geocode_cache()


# ---------------------------------------------------------------------------
# Neighborhood / landmark coordinates
# Geographic scope: Howard St (north) → 50th St (south) | Lakefront → Pulaski Rd (west)
# ---------------------------------------------------------------------------

NEIGHBORHOOD_COORDS: dict[str, tuple[float, float]] = {

    # ── ROGERS PARK / FAR NORTH ──────────────────────────────────────────────
    "rogers park":          (42.0085, -87.6688),
    "loyola":               (41.9998, -87.6586),
    "loyola university":    (41.9998, -87.6586),
    "granville":            (41.9943, -87.6579),
    "thorndale":            (41.9898, -87.6577),
    "morse":                (41.9832, -87.6590),
    "jarvis":               (41.9930, -87.6693),

    # ── EDGEWATER ────────────────────────────────────────────────────────────
    "edgewater":            (41.9889, -87.6600),
    "bryn mawr":            (41.9834, -87.6590),
    "foster beach":         (41.9791, -87.6403),
    "foster avenue beach":  (41.9791, -87.6403),

    # ── ANDERSONVILLE ────────────────────────────────────────────────────────
    "andersonville":        (41.9800, -87.6682),
    "berwyn":               (41.9778, -87.6593),
    "berwyn station":       (41.9778, -87.6593),
    "swedish american museum": (41.9799, -87.6690),

    # ── UPTOWN ───────────────────────────────────────────────────────────────
    "uptown":               (41.9650, -87.6550),
    "wilson":               (41.9648, -87.6575),
    "lawrence":             (41.9688, -87.6580),
    "argyle":               (41.9735, -87.6580),
    "sheridan":             (41.9542, -87.6537),
    "montrose beach":       (41.9643, -87.6384),
    "montrose harbor":      (41.9643, -87.6384),
    "uptown theatre":       (41.9648, -87.6545),
    "green mill":           (41.9656, -87.6556),
    "illinois masonic":     (41.9437, -87.6561),
    "advocate illinois masonic": (41.9437, -87.6561),

    # ── LINCOLN SQUARE / RAVENSWOOD ──────────────────────────────────────────
    "lincoln square":       (41.9679, -87.6848),
    "ravenswood":           (41.9656, -87.6741),

    # ── WRIGLEYVILLE / LAKEVIEW ──────────────────────────────────────────────
    "wrigleyville":         (41.9476, -87.6553),
    "wrigley field":        (41.9484, -87.6553),
    "lakeview":             (41.9433, -87.6513),
    "east lakeview":        (41.9395, -87.6420),
    "boystown":             (41.9444, -87.6491),
    "addison":              (41.9476, -87.6542),
    "belmont":              (41.9394, -87.6527),
    "southport corridor":   (41.9416, -87.6641),
    "southport":            (41.9416, -87.6641),
    "diversey":             (41.9321, -87.6527),
    "wellington":           (41.9360, -87.6545),
    "paulina":              (41.9437, -87.6705),
    "diversey harbor":      (41.9321, -87.6385),
    "theater on the lake":  (41.9258, -87.6334),

    # ── LINCOLN PARK ─────────────────────────────────────────────────────────
    "lincoln park":         (41.9228, -87.6482),
    "lincoln park zoo":     (41.9220, -87.6332),
    "fullerton":            (41.9253, -87.6527),
    "armitage":             (41.9175, -87.6513),
    "depaul":               (41.9253, -87.6554),
    "depaul university":    (41.9253, -87.6554),
    "north avenue beach":   (41.9168, -87.6354),
    "oz park":              (41.9257, -87.6395),
    "chicago history museum": (41.9218, -87.6318),
    "peggy notebaert nature museum": (41.9218, -87.6341),
    "steppenwolf theatre":  (41.9119, -87.6316),
    "steppenwolf":          (41.9119, -87.6316),

    # ── OLD TOWN ─────────────────────────────────────────────────────────────
    "old town":             (41.9101, -87.6364),
    "sedgwick":             (41.9101, -87.6386),
    "north/clybourn":       (41.9103, -87.6486),
    "north clybourn":       (41.9103, -87.6486),
    "second city":          (41.9101, -87.6356),
    "wells street":         (41.9101, -87.6340),

    # ── GOLD COAST ───────────────────────────────────────────────────────────
    "gold coast":           (41.9016, -87.6298),
    "clark/division":       (41.9046, -87.6312),
    "clark division":       (41.9046, -87.6312),
    "newberry library":     (41.9019, -87.6317),
    "washington square park": (41.9019, -87.6317),
    "lurie childrens hospital": (41.9049, -87.6241),
    "lurie children's hospital": (41.9049, -87.6241),
    "chicago water tower":  (41.9007, -87.6235),
    "water tower place":    (41.9007, -87.6235),
    "pumping station":      (41.9007, -87.6233),

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
    "chicago riverwalk":    (41.8876, -87.6291),
    "lyric opera":          (41.8855, -87.6371),
    "art museum":           (41.8796, -87.6237),
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
    "18th street":          (41.8575, -87.6700),
    "back of the yards":    (41.8100, -87.6550),
    "mckinley park":        (41.8290, -87.6750),
    "brighton park":        (41.8250, -87.6950),

    # ── BRONZEVILLE / DOUGLAS / GRAND BOULEVARD ──────────────────────────────
    "bronzeville":          (41.8350, -87.6150),
    "douglas":              (41.8420, -87.6200),
    "grand boulevard":      (41.8200, -87.6150),
    "sox-35th":             (41.8312, -87.6304),
    "35th street":          (41.8312, -87.6304),

    # ── KEY CTA STATIONS (within coverage area) ───────────────────────────────
    "cermak-chinatown":     (41.8534, -87.6306),
    "pulaski":              (41.8866, -87.7260),
    "kedzie":               (41.8864, -87.7063),

    # ── LOOP TRAIN STATIONS ──────────────────────────────────────────────────
    "lake":                 (41.8849, -87.6278),
    "monroe":               (41.8806, -87.6278),
    "jackson":              (41.8781, -87.6278),
    "harrison":             (41.8742, -87.6278),
    "roosevelt":            (41.8674, -87.6278),
    "clark/lake":           (41.8858, -87.6310),
    "state/lake":           (41.8858, -87.6278),
    "washington/wabash":    (41.8832, -87.6258),
    "washington/wells":     (41.8829, -87.6340),
    "adams/wabash":         (41.8796, -87.6258),
    "quincy":               (41.8784, -87.6340),
    "lasalle/van buren":    (41.8757, -87.6315),
    "clinton":              (41.8749, -87.6408),
}


# ---------------------------------------------------------------------------
# Street abbreviation normalization
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Fuzzy neighborhood matching
# ---------------------------------------------------------------------------

_FUZZY_STOP_WORDS: frozenset[str] = frozenset(
    {"the", "of", "a", "an", "and", "at", "in", "on", "chicago"}
)
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
    """
    Fuzzy-match a lowercased, stripped query against NEIGHBORHOOD_COORDS.
    Requires similarity ≥ 0.95 and at least one meaningful word in common.
    Returns (coords, matched_key) or (None, None).
    """
    q_words = set(query.split()) - _FUZZY_STOP_WORDS

    if len(q_words) > 1:
        idx = _word_index()
        candidate_keys: set[str] = set()
        for w in q_words:
            candidate_keys |= idx.get(w, frozenset())
        if not candidate_keys:
            candidate_keys = set(NEIGHBORHOOD_COORDS.keys())
    else:
        candidate_keys = set(NEIGHBORHOOD_COORDS.keys())

    best_score = 0.0
    best_key: str | None = None
    for key in candidate_keys:
        score = SequenceMatcher(None, query, key).ratio()
        if score > best_score:
            best_score = score
            best_key = key

    if best_score >= _FUZZY_THRESHOLD and best_key:
        return NEIGHBORHOOD_COORDS[best_key], best_key
    return None, None


# ---------------------------------------------------------------------------
# Google Maps geocoding
# ---------------------------------------------------------------------------

def geocode_google(query: str) -> "tuple[float, float] | None":
    """
    Geocode a free-text query using Google Maps API, biased to Chicago.
    Results are cached in-memory and persisted to geocode_cache.json.
    Returns None if GOOGLE_MAPS_API_KEY is not set or geocoding fails.
    """
    if query in _geocode_cache:
        return _geocode_cache[query]

    with _geocode_lock:
        if query in _geocode_cache:
            return _geocode_cache[query]

        api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
        if not api_key:
            print("[geocoding] GOOGLE_MAPS_API_KEY not set — geocoding unavailable")
            return None

        try:
            resp = _http_session.get(
                _GOOGLE_GEOCODE_URL,
                params={
                    "address": query if "chicago" in query.lower() else query + ", Chicago, IL",
                    "key": api_key,
                    "components": "country:US",
                    "bounds": CHICAGO_BBOX_GOOGLE,
                },
                timeout=5,
            )
            data = resp.json()
            if data.get("status") == "OK" and data.get("results"):
                loc = data["results"][0]["geometry"]["location"]
                coords: tuple[float, float] = (float(loc["lat"]), float(loc["lng"]))
                _geocode_cache[query] = coords
                _save_geocode_cache(_geocode_cache)
                print(f"[geocoding] Geocoded '{query}' → {coords}")
                return coords
            status = data.get("status")
            print(f"[geocoding] Google returned status '{status}' for '{query}'")
            if status == "ZERO_RESULTS":
                _geocode_cache[query] = None
                _save_geocode_cache(_geocode_cache)
        except Exception as exc:
            print(f"[geocoding] Google geocoding failed for '{query}': {exc}")

        return None


# ---------------------------------------------------------------------------
# Main resolution entry point
# ---------------------------------------------------------------------------

def resolve_location(query: str) -> "tuple[float, float] | None":
    """
    Convert a free-text Chicago location query to (lat, lon).

    Tries in order: exact neighborhood match → fuzzy match → Google Maps.
    Returns None if all three fail.
    """
    q = query.strip().lower()
    q = _normalize_street_abbr(q)

    coords = NEIGHBORHOOD_COORDS.get(q)
    if coords:
        return coords

    coords, _ = fuzzy_match_neighborhood(q)
    if coords:
        return coords

    return geocode_google(q)
