import asyncio
import logging
import os
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

load_dotenv()

from walking import (
    _compute_route,
    walk_paths_alternatives,
    compute_route_with_prefs,
    pace_minutes_factor,
    WALKING_SPEED_MPH,
    _load_graph,
    _start_eviction_daemon,
    FLAVORS,
    DEFAULT_FLAVOR,
)
from geocoding import (
    GeocoderDegradedError,
    LocationOutsideChicagoError,
    _normalize_street_abbr,
    geocode_external,
    resolve_location,
    reverse_geocode_point,
)
import local_search
from utils import (
    CHICAGO_SOUTH, CHICAGO_NORTH, CHICAGO_WEST, CHICAGO_EAST,
    haversine_miles, METERS_PER_MILE, quantize_coord,
)
from steps import (
    step_length_from_height,
    steps_from_miles,
    calories_from_minutes,
    daily_goal_pct,
    DEFAULT_STEP_LENGTH_FT,
    DEFAULT_PACE,
    PACE_TO_MET,
)
from explore import explore as compute_explore
from community_areas import lookup_centroid
from places import places_in_polygon, residential_heatmap
from parks import parks_in_polygon
from green_space import green_space_in_polygon
from tree_canopy import tree_canopy_in_polygon
from shapely.geometry import shape as _shape

# Two points within this many miles of each other are treated as the same
# location. ~0.07 mi (~113 m) was the prior implicit threshold for north-south
# deltas; using true haversine here makes the guard symmetric in every direction.
_SAME_LOCATION_THRESHOLD_MILES: float = 0.07


# Only honor X-Forwarded-Proto when explicitly told we sit behind a trusted
# reverse proxy (Railway, Cloudflare, etc.). Without this guard, an attacker
# hitting a directly-exposed instance over HTTP could set the header to coax
# an HSTS response and downgrade future plaintext access.
_TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "").lower() in ("1", "true", "yes")

_extra_origins = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
] + [
    o.strip() for o in _extra_origins.split(",")
    if o.strip() and o.strip() != "*"
]

# Dev-tunnel mode: when scripts/dev-tunnel.mjs spawns uvicorn, it sets
# DEV_TUNNEL_ORIGIN_REGEX to a pattern matching the ephemeral
# trycloudflare.com hostnames so the dynamic per-session frontend tunnel
# origin is accepted without manual .env edits. This MUST stay dev-only —
# production deploys never set this var. See docs/MOBILE_TESTING.md.
#
# Two safety nets enforce dev-only use:
#   1. APP_ENV must be one of {"dev","development","local"} or the regex is
#      ignored (documentation alone is fragile — a stray prod .env that
#      happens to contain DEV_TUNNEL_ORIGIN_REGEX would otherwise widen
#      CORS silently).
#   2. The regex must be anchored with ^...$ — an unanchored pattern like
#      "https://my-app\.com" matches "https://my-app.com.evil.tld" too.
_APP_ENV = os.getenv("APP_ENV", "").strip().lower()
_IS_DEV_ENV = _APP_ENV in ("dev", "development", "local")
_raw_dev_regex = os.getenv("DEV_TUNNEL_ORIGIN_REGEX", "").strip()
if not _raw_dev_regex:
    _DEV_TUNNEL_ORIGIN_REGEX: "str | None" = None
elif not _IS_DEV_ENV:
    logger.error(
        "Refusing DEV_TUNNEL_ORIGIN_REGEX outside dev (APP_ENV=%r). "
        "Unset the var or set APP_ENV=development to enable.",
        _APP_ENV,
    )
    _DEV_TUNNEL_ORIGIN_REGEX = None
elif not (_raw_dev_regex.startswith("^") and _raw_dev_regex.endswith("$")):
    logger.error(
        "DEV_TUNNEL_ORIGIN_REGEX must be anchored with ^...$ — refusing %r",
        _raw_dev_regex,
    )
    _DEV_TUNNEL_ORIGIN_REGEX = None
else:
    _DEV_TUNNEL_ORIGIN_REGEX = _raw_dev_regex
    logger.warning(
        "Dev CORS regex active: %s (APP_ENV=%s). "
        "This widens CORS to a third-party-owned domain — never use in production.",
        _DEV_TUNNEL_ORIGIN_REGEX, _APP_ENV,
    )

def _preload_graph() -> None:
    """Load graph in a background thread so startup doesn't block."""
    _load_graph()


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    logger.info("Scheduling background graph preload ...")
    asyncio.ensure_future(loop.run_in_executor(None, _preload_graph))
    _start_eviction_daemon()
    yield


# Per-IP rate limiter. Limits are tuned per endpoint cost; see each route
# handler for its specific @limiter.limit decorator.
#
# Proxy-aware keying: behind a reverse-proxy chain (Railway, Cloudflare, ...)
# the TCP peer is the proxy, so `request.client.host` collapses every user
# into one bucket. TRUSTED_PROXY_HOPS declares how many proxies append to
# X-Forwarded-For; `_client_ip` then reads the client IP that many entries
# from the right of the header. Counting from the right is the spoof-resistant
# part — a client can prepend bogus X-Forwarded-For values, but it cannot
# forge the entries our own proxies append after it. TRUSTED_PROXY_HOPS=0
# (default) ignores X-Forwarded-For entirely and keys on the connection peer,
# the correct un-spoofable behavior for a directly-exposed instance.
#
# RATE_LIMIT_ENABLED=false disables the limiter (used by the pytest suite,
# which would otherwise blow past the per-endpoint limits inside a single test
# run since the TestClient host is a single key).
_RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").strip().lower() not in ("false", "0", "no")


def _resolve_trusted_proxy_hops() -> int:
    raw = os.getenv("TRUSTED_PROXY_HOPS", "0").strip()
    try:
        hops = int(raw)
    except ValueError:
        logger.error("TRUSTED_PROXY_HOPS=%r is not an integer — keying on the connection peer", raw)
        return 0
    if hops < 0:
        logger.error("TRUSTED_PROXY_HOPS=%r is negative — keying on the connection peer", raw)
        return 0
    return hops


_TRUSTED_PROXY_HOPS = _resolve_trusted_proxy_hops()


def _client_ip(request: Request) -> str:
    """Rate-limit key: the real client IP rather than the proxy connection peer.

    With TRUSTED_PROXY_HOPS proxies in front of the app, the client IP is the
    X-Forwarded-For entry that many positions from the end. Falls back to the
    connection peer when X-Forwarded-For is absent or shorter than the declared
    hop count, so the limiter always has a usable key."""
    if _TRUSTED_PROXY_HOPS > 0:
        parts = [
            p.strip()
            for p in request.headers.get("x-forwarded-for", "").split(",")
            if p.strip()
        ]
        if len(parts) >= _TRUSTED_PROXY_HOPS:
            return parts[-_TRUSTED_PROXY_HOPS]
    return get_remote_address(request)


limiter = Limiter(key_func=_client_ip, default_limits=[], enabled=_RATE_LIMIT_ENABLED)

app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)



app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=_DEV_TUNNEL_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.scheme == "https" or (
        _TRUST_PROXY_HEADERS and request.headers.get("x-forwarded-proto") == "https"
    ):
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


_MAX_STOPS = 8


class RouteRequest(BaseModel):
    # New multi-stop field. Accepts 2–8 ordered stops.
    stops: list[str] | None = Field(default=None, min_length=2, max_length=_MAX_STOPS)
    # Legacy fields — accepted for backwards compatibility, normalized into stops.
    origin: str | None = Field(default=None, max_length=200)
    destination: str | None = Field(default=None, max_length=200)
    height_inches: float | None = None
    # Personalization + routing-preference fields. Each is optional; the response
    # falls back to neutral defaults when omitted.
    weight_kg: float | None = None
    daily_goal: int | None = Field(default=None, ge=1_000, le=100_000)
    pace: str | None = None
    avoid_stairs: bool = False
    prefer_pedestrian: bool = False

    @field_validator("height_inches")
    @classmethod
    def validate_height(cls, v: float | None) -> float | None:
        if v is not None and not (36 <= v <= 108):  # 3 ft to 9 ft — sanity range
            raise ValueError("height_inches must be between 36 and 108")
        return v

    @field_validator("weight_kg")
    @classmethod
    def validate_weight(cls, v: float | None) -> float | None:
        # 30 kg (small child) to 300 kg — UI allows 66–661 lb so this is the
        # outer envelope; we tolerate slightly outside the UI range.
        if v is not None and not (30 <= v <= 300):
            raise ValueError("weight_kg must be between 30 and 300")
        return v

    @field_validator("pace")
    @classmethod
    def validate_pace(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v not in PACE_TO_MET:
            raise ValueError(f"pace must be one of {sorted(PACE_TO_MET)}")
        return v

    @model_validator(mode="after")
    def _normalize_stops(self):
        if self.stops is None:
            if self.origin is not None and self.destination is not None:
                self.stops = [self.origin, self.destination]
            else:
                raise ValueError(
                    "must provide either `stops` (2–8 entries) or both `origin` and `destination`"
                )
        cleaned = [s.strip() for s in self.stops]
        if any(not s for s in cleaned):
            raise ValueError("stops must not contain empty entries")
        if any(len(s) > 200 for s in cleaned):
            raise ValueError("each stop must be ≤ 200 characters")
        self.stops = cleaned
        # Mirror normalized origin/destination for downstream code.
        self.origin = cleaned[0]
        self.destination = cleaned[-1]
        return self


class ExploreOrigin(BaseModel):
    """One of two start-point modes for the Neighborhood Explorer.

    Exactly one of `community_area` or (`lat`, `lon`) must be supplied. The
    `community_area` form anchors the isochrone at the area's representative
    point from `community_areas.COMMUNITY_AREA_CENTROIDS`; the lat/lon form
    is for the "📍 My location" mode driven by the browser's geolocation API.
    """
    community_area: str | None = Field(default=None, max_length=100)
    lat: float | None = None
    lon: float | None = None

    @model_validator(mode="after")
    def _exactly_one_mode(self):
        has_area = bool(self.community_area and self.community_area.strip())
        has_coords = self.lat is not None and self.lon is not None
        if has_area == has_coords:
            raise ValueError(
                "origin must have either `community_area` or both `lat` and `lon` (not both, not neither)"
            )
        if has_coords:
            if not (CHICAGO_SOUTH <= self.lat <= CHICAGO_NORTH):
                raise ValueError("origin.lat is outside the Chicago coverage area")
            if not (CHICAGO_WEST <= self.lon <= CHICAGO_EAST):
                raise ValueError("origin.lon is outside the Chicago coverage area")
        return self


class ExploreRequest(BaseModel):
    origin: ExploreOrigin
    max_minutes: int = Field(ge=5, le=45)
    categories: list[str] | None = None
    height_inches: float | None = None

    @field_validator("max_minutes", mode="before")
    @classmethod
    def round_max_minutes(cls, v):
        # Routing quantizes max_minutes to an integer (see explore.py), so
        # round here at the schema boundary to keep the echoed value in
        # the response consistent with the polygon that was computed.
        if isinstance(v, float):
            return round(v)
        return v

    @field_validator("height_inches")
    @classmethod
    def validate_height(cls, v: float | None) -> float | None:
        if v is not None and not (36 <= v <= 108):
            raise ValueError("height_inches must be between 36 and 108")
        return v

    @field_validator("categories")
    @classmethod
    def validate_categories(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        if len(v) > 32:
            raise ValueError("too many categories (max 32)")
        cleaned = [c.strip() for c in v if isinstance(c, str) and c.strip()]
        return cleaned or None


@app.get("/health")
async def health(request: Request):
    return {"status": "ok"}


@app.post("/explore")
@limiter.limit("30/minute")
async def explore_endpoint(request: Request, payload: ExploreRequest):
    """Return the walkable isochrone polygon for an origin + time budget.

    Response shape:
        {
          "origin_coords": [lat, lon],
          "max_minutes": int,
          "polygon": GeoJSON Polygon,
          "reachable_neighborhoods": [str, ...],
          "stats": { "node_count": int, "area_sq_mi": float },
          "places": [ {category, subcategory, name, lat, lon, address, source}, ... ],
          "residential_heatmap": GeoJSON MultiPolygon | null,
          "tree_canopy_heatmap": GeoJSON FeatureCollection | null,
          "parks_heatmap": GeoJSON FeatureCollection | null,
          "green_space_heatmap": GeoJSON FeatureCollection | null,
        }

    `categories` filters `places` to the named top-level category keys (omit
    or send null to return every place inside the polygon). `height_inches`
    is currently accepted but unused — reserved for future step-count
    enrichment of the place list.
    """
    origin = payload.origin
    if origin.community_area:
        coords = lookup_centroid(origin.community_area)
        if coords is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown community area: {origin.community_area!r}",
            )
        origin_lat, origin_lon = coords
    else:
        origin_lat, origin_lon = origin.lat, origin.lon

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None, compute_explore, origin_lat, origin_lon, payload.max_minutes,
    )
    if result is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "Could not anchor the explorer at this origin — either it "
                "falls outside the Chicago street graph, or no walkable "
                "vertex is within snapping range."
            ),
        )

    # Place + heatmap work runs in the threadpool — both are CPU-bound and
    # the event loop should not block on shapely's intersection calls for
    # large isochrones.
    #
    # Each clip below runs on its own worker thread. A shapely geometry is
    # NOT safe to share across threads: GEOS lazily computes and caches state
    # (envelope, prepared index) onto the geometry the first time it is
    # touched, so concurrent first-touch from multiple workers races and
    # corrupts the GEOS heap (Windows access violation / segfault). Hand each
    # worker the plain GeoJSON dict — read-only, safe to share — and let it
    # parse its own private geometry, created and used on the same thread.
    geojson_polygon = result["polygon"]

    def _clip(fn, *args):
        return fn(_shape(geojson_polygon), *args)

    places, heatmap, canopy, parks, green = await asyncio.gather(
        loop.run_in_executor(None, _clip, places_in_polygon, payload.categories),
        loop.run_in_executor(None, _clip, residential_heatmap),
        loop.run_in_executor(None, _clip, tree_canopy_in_polygon),
        loop.run_in_executor(None, _clip, parks_in_polygon),
        loop.run_in_executor(None, _clip, green_space_in_polygon),
    )

    return {
        "origin_coords": [origin_lat, origin_lon],
        "max_minutes": payload.max_minutes,
        "polygon": result["polygon"],
        "reachable_neighborhoods": result["reachable_neighborhoods"],
        "stats": result["stats"],
        "places": places,
        # GeoJSON MultiPolygon (or null if no residential land falls inside
        # the isochrone — happens for tight Loop-area budgets).
        "residential_heatmap": heatmap,
        # GeoJSON FeatureCollection of up to three density bands (low/mid/
        # high), or null when no canopy cells overlap the isochrone.
        "tree_canopy_heatmap": canopy,
        # GeoJSON FeatureCollection of CPD park footprints clipped to the
        # isochrone (one Feature per park with name + acres properties),
        # or null when no park polygons overlap.
        "parks_heatmap": parks,
        # GeoJSON FeatureCollection of non-CPD green space (cemeteries,
        # golf courses, nature reserves / Forest Preserves, recreation
        # grounds) clipped to the isochrone. One Feature per `kind`
        # (kind ∈ {cemetery, golf_course, nature_reserve, recreation_ground}),
        # or null when none overlap.
        "green_space_heatmap": green,
    }


@app.get("/reverse-geocode")
@limiter.limit("60/minute")
async def reverse_geocode(request: Request, lat: float, lon: float):
    if not (CHICAGO_SOUTH <= lat <= CHICAGO_NORTH and CHICAGO_WEST <= lon <= CHICAGO_EAST):
        raise HTTPException(status_code=422, detail="Location is outside the Chicago coverage area.")
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, reverse_geocode_point, lat, lon)
    return result


_AUTOCOMPLETE_MAX_LIMIT = 20
_AUTOCOMPLETE_SUPPLEMENT_THRESHOLD = 3


def _looks_like_free_text_address(q: str) -> bool:
    """True when the query starts with a digit token — heuristic for an address
    typed by hand. Used to gate the LocationIQ supplement so that partial
    neighborhood / POI lookups never burn quota.
    """
    head = q.lstrip().split(None, 1)[0] if q.strip() else ""
    return bool(head) and head[0].isdigit()


@app.get("/autocomplete")
@limiter.limit("60/minute")
async def autocomplete_endpoint(request: Request, q: str, limit: int = 8):
    """Typeahead suggestions for the route / explore forms.

    Local-first: returns up to `limit` ranked suggestions from
    `local_search.autocomplete` (neighborhoods, intersections, addresses,
    POIs — all from the bundled SQLite + curated tables). If the query
    smells like a free-text address (first token is digit-prefixed) and the
    local layer returned fewer than 3 results, supplement with a single
    LocationIQ forward lookup so user-typed addresses outside the OSM
    address-point set still resolve. Otherwise no network call is made.
    """
    q = (q or "").strip()
    if not q:
        return {"suggestions": []}
    if len(q) > 200:
        raise HTTPException(status_code=422, detail="query too long")
    if not (1 <= limit <= _AUTOCOMPLETE_MAX_LIMIT):
        raise HTTPException(
            status_code=422,
            detail=f"limit must be between 1 and {_AUTOCOMPLETE_MAX_LIMIT}",
        )

    loop = asyncio.get_running_loop()
    suggestions = await loop.run_in_executor(None, local_search.autocomplete, q, limit)

    out = [
        {"label": s.label, "lat": s.lat, "lon": s.lon, "source": s.source}
        for s in suggestions
    ]

    if (
        len(out) < _AUTOCOMPLETE_SUPPLEMENT_THRESHOLD
        and _looks_like_free_text_address(q)
    ):
        # Match resolve_location's normalization so the cached_forward key
        # written here is the same one /route will look up later — otherwise
        # the same address pays for two LocationIQ calls (BUG-003).
        supplement_q = _normalize_street_abbr(q.lower())
        try:
            coords = await loop.run_in_executor(None, geocode_external, supplement_q)
        except GeocoderDegradedError:
            coords = None  # silently degrade — the local list is still useful
        if coords is not None:
            out.append({
                "label": q,
                "lat": coords[0],
                "lon": coords[1],
                "source": "locationiq",
            })

    return {"suggestions": out[:limit]}


def _dist2(a, b) -> float:
    """Squared lat/lon delta between two [lat, lon] points (degrees²)."""
    dlat = a[0] - b[0]
    dlon = a[1] - b[1]
    return dlat * dlat + dlon * dlon


def _approx_eq(a, b) -> bool:
    """True when two [lat, lon] points are within ~1 m of each other."""
    return _dist2(a, b) < 1e-10


def _stitch_legs(legs_raw: list[dict]) -> tuple[list, list[tuple[int, int]]]:
    """
    Concatenate per-leg paths into one continuous path, dropping the duplicated
    seam point where leg N+1's start equals leg N's end. Returns the stitched
    path plus per-leg `(start, end)` index ranges into that path. Adjacent
    leg slices share the seam index by design (`legs[i].end == legs[i+1].start`).
    """
    # `path` entries are the cached tuple-of-tuples from `_compute_route`;
    # FastAPI's encoder serialises tuples and lists identically, so the
    # stitched list holds `(lat, lon)` tuples without a per-point list rebuild.
    # `_approx_eq` indexes into the points either way.
    full_path = list(legs_raw[0]["path"])
    # When leg 0's path is empty (a degenerate routing fallback), emit
    # `(0, -1)` so `path[start:end+1]` evaluates to `[]` — i.e., "no
    # geometry." A previous fix collapsed this to `(0, 0)`, but once a
    # later leg appended points, index 0 belonged to *that* leg and the
    # phantom 1-point slice incorrectly attributed leg 1's start to leg 0.
    leg_slices: list[tuple[int, int]] = [(0, len(full_path) - 1)]
    for leg in legs_raw[1:]:
        pts = leg["path"]
        if not pts:
            # Empty subsequent leg — same convention as the seed: empty slice
            # anchored at the current seam so `path[start:end+1] == []`.
            seam = len(full_path)
            leg_slices.append((seam, seam - 1))
            continue
        if full_path and _approx_eq(full_path[-1], pts[0]):
            start_idx = len(full_path) - 1   # shared seam index
            full_path.extend(pts[1:])
        else:
            start_idx = len(full_path)
            full_path.extend(pts)
        leg_slices.append((start_idx, len(full_path) - 1))
    return full_path, leg_slices


@app.post("/route")
@limiter.limit("30/minute")
async def route(request: Request, payload: RouteRequest):
    loop = asyncio.get_running_loop()

    stops = payload.stops
    is_multi = len(stops) > 2

    # Resolve all stops concurrently. `return_exceptions=True` lets us surface
    # a per-stop "not in Chicago" 422 with the offending stop's index instead
    # of taking gather's first-raise-wins behavior, which loses that index.
    resolved = await asyncio.gather(*[
        loop.run_in_executor(None, resolve_location, s) for s in stops
    ], return_exceptions=True)
    for i, coords in enumerate(resolved):
        if isinstance(coords, LocationOutsideChicagoError):
            raise HTTPException(
                status_code=422,
                detail={
                    "message": f"'{stops[i]}' isn't in Chicago. Try a Chicago neighborhood, landmark, or street address.",
                    "stop_index": i,
                },
            )
        if isinstance(coords, GeocoderDegradedError):
            raise HTTPException(
                status_code=503,
                detail={"message": GeocoderDegradedError.DEFAULT_MESSAGE},
            )
        if isinstance(coords, BaseException):
            raise coords  # unexpected — let FastAPI's 500 handler surface it
        if not coords:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": (
                        f"Could not find '{stops[i]}' in Chicago. "
                        "Try a neighborhood name or a street address. "
                        "Coverage: the full Chicago city limits (all 77 community areas)."
                    ),
                    "stop_index": i,
                },
            )

    # Adjacent-duplicate validation: true haversine so the threshold is symmetric
    # in every direction (degrees² shortcuts skew because 1° lon ≠ 1° lat).
    for i in range(len(resolved) - 1):
        a, b = resolved[i], resolved[i + 1]
        if haversine_miles(a[0], a[1], b[0], b[1]) < _SAME_LOCATION_THRESHOLD_MILES:
            if not is_multi:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message": "Your origin and destination appear to be the same location.",
                        "stop_index": 1,
                    },
                )
            raise HTTPException(
                status_code=400,
                detail={
                    "message": f"Stop {i + 1} and {i + 2} are the same location.",
                    "stop_index": i + 1,
                },
            )

    step_len = (
        step_length_from_height(payload.height_inches)
        if payload.height_inches is not None
        else DEFAULT_STEP_LENGTH_FT
    )

    pace            = payload.pace or DEFAULT_PACE
    pace_factor     = pace_minutes_factor(pace)
    weight_kg       = payload.weight_kg
    daily_goal      = payload.daily_goal or 10_000
    personalized_calories = weight_kg is not None
    has_routing_prefs = bool(payload.avoid_stairs or payload.prefer_pedestrian)

    def _enrich_directions(directions, leg_index: int | None = None):
        out = []
        for d in directions:
            seg_miles   = d["distance_meters"] / METERS_PER_MILE
            seg_minutes = round(d["minutes"] * pace_factor, 1) if "minutes" in d else 0.0
            # Explicit construction (rather than `{**d, "minutes": ...}`) skips
            # the spread's wasted copy of the source `minutes` value that the
            # very next key would overwrite. The cached `d` is a
            # `MappingProxyType` view, so this dict is the response-side copy
            # boundary either way.
            entry = {
                "street":          d["street"],
                "path_type":       d["path_type"],
                "direction":       d["direction"],
                "direction_full":  d["direction_full"],
                "blocks":          d["blocks"],
                "block_type":      d["block_type"],
                "minutes":         seg_minutes,
                "distance_meters": d["distance_meters"],
                "distance_miles":  round(seg_miles, 3),
                "steps":           steps_from_miles(seg_miles, step_len),
            }
            if leg_index is not None:
                entry["leg_index"] = leg_index
            out.append(entry)
        return out

    def _summarize_alt(alt: dict) -> dict:
        # alt["minutes"] is computed at canonical 3 mph in walking.py — rescale here.
        # Compute miles from the unrounded canonical minutes (matches the multi-stop
        # branch); deriving miles from the already-rounded total_minutes introduces
        # pace-dependent drift of ±0.01 mi at brisk pace.
        total_miles   = round(alt["minutes"] * WALKING_SPEED_MPH / 60.0, 2)
        total_minutes = round(alt["minutes"] * pace_factor, 1)
        total_steps   = steps_from_miles(total_miles, step_len)
        return {
            "flavor":          alt["flavor"],
            "path":            alt["path"],
            "directions":      _enrich_directions(alt["directions"]),
            "total_miles":     total_miles,
            "total_minutes":   total_minutes,
            "total_steps":     total_steps,
            "calories_approx": calories_from_minutes(total_minutes, weight_kg, pace),
            "daily_goal_pct":  daily_goal_pct(total_steps, daily_goal),
        }

    # Coordinate shapes shared across both response branches.
    stops_out        = list(stops)
    stop_coords_out  = [list(c) for c in resolved]
    origin_out       = list(resolved[0])
    dest_out         = list(resolved[-1])
    step_length_in   = round(step_len * 12, 1)
    personalized     = payload.height_inches is not None

    if not is_multi:
        if has_routing_prefs:
            # Custom routing prefs (avoid_stairs / prefer_pedestrian) bypass the
            # alternative-routes pipeline and return a single tailored route.
            path, directions, minutes = await loop.run_in_executor(
                None, compute_route_with_prefs,
                *resolved[0], *resolved[1],
                DEFAULT_FLAVOR, payload.avoid_stairs, payload.prefer_pedestrian,
            )
            alternatives = [{
                "flavor": "custom",
                # Pass the cached tuple-of-tuples through; FastAPI encodes
                # tuples and lists identically, so the per-point `list(pt)`
                # rebuild is redundant.
                "path": path,
                "directions": list(directions),
                "minutes": minutes,
            }]
        else:
            alternatives = await loop.run_in_executor(
                None, walk_paths_alternatives, *resolved[0], *resolved[1],
            )
        routes = [_summarize_alt(alt) for alt in alternatives]
        default = next((r for r in routes if r["flavor"] == DEFAULT_FLAVOR), routes[0])
        available_flavors = ["custom"] if has_routing_prefs else list(FLAVORS)
        return {
            "stops":              stops_out,
            "stop_coords":        stop_coords_out,
            "origin_coords":      origin_out,
            "dest_coords":        dest_out,
            "step_length_inches": step_length_in,
            "personalized":       personalized,
            "personalized_calories": personalized_calories,
            "pace":               pace,
            "default_flavor":     default["flavor"],
            "available_flavors":  available_flavors,
            "routes":             routes,
            # Legacy mirror of the default route.
            "total_miles":        default["total_miles"],
            "total_minutes":      default["total_minutes"],
            "total_steps":        default["total_steps"],
            "calories_approx":    default["calories_approx"],
            "daily_goal_pct":     default["daily_goal_pct"],
            "path":               default["path"],
            "directions":         default["directions"],
        }

    # Multi-stop (3–8): force `fastest` flavor; alternative routes are 2-stop only.
    async def _compute_leg(i: int) -> dict:
        olat, olon = resolved[i]
        dlat, dlon = resolved[i + 1]
        if has_routing_prefs:
            path, directions, minutes = await loop.run_in_executor(
                None, compute_route_with_prefs,
                olat, olon, dlat, dlon, DEFAULT_FLAVOR,
                payload.avoid_stairs, payload.prefer_pedestrian,
            )
        else:
            path, directions, minutes = await loop.run_in_executor(
                None, _compute_route, olat, olon, dlat, dlon, DEFAULT_FLAVOR,
            )
        return {
            # Cached tuple-of-tuples; `_stitch_legs` extends the working list
            # with these points directly (same JSON output, no per-point
            # rebuild).
            "path":       path,
            "directions": list(directions),
            "minutes":    minutes,
            "from_label": stops[i],
            "to_label":   stops[i + 1],
        }

    legs_raw = await asyncio.gather(*[_compute_leg(i) for i in range(len(resolved) - 1)])

    full_path, leg_slices = _stitch_legs(legs_raw)

    legs_out = []
    all_directions: list[dict] = []
    total_minutes = 0.0
    total_miles   = 0.0
    for i, leg in enumerate(legs_raw):
        # leg["minutes"] is canonical 3 mph; rescale to user pace.
        leg_minutes = leg["minutes"] * pace_factor
        leg_miles   = leg["minutes"] * WALKING_SPEED_MPH / 60.0  # distance is pace-independent
        leg_steps   = steps_from_miles(leg_miles, step_len)
        leg_cal     = calories_from_minutes(leg_minutes, weight_kg, pace)
        leg_dirs    = _enrich_directions(leg["directions"], leg_index=i)
        all_directions.extend(leg_dirs)
        total_minutes += leg_minutes
        total_miles   += leg_miles
        legs_out.append({
            "from_label":      leg["from_label"],
            "to_label":        leg["to_label"],
            "miles":           round(leg_miles, 2),
            "minutes":         round(leg_minutes, 1),
            "steps":           leg_steps,
            "calories_approx": leg_cal,
            "path_slice":      list(leg_slices[i]),
        })

    # Compute totals from the unrounded sums so multi-stop matches 2-stop's
    # round-of-sum semantics (vs. the prior sum-of-rounded-legs, which drifted
    # by ±N steps where N = leg count).
    total_steps    = steps_from_miles(total_miles, step_len)
    total_calories = calories_from_minutes(total_minutes, weight_kg, pace)
    total_minutes_r = round(total_minutes, 1)

    flavor_label = "custom" if has_routing_prefs else DEFAULT_FLAVOR
    full_route = {
        "flavor":          flavor_label,
        "path":            full_path,
        "directions":      all_directions,
        "total_miles":     round(total_miles, 2),
        "total_minutes":   total_minutes_r,
        "total_steps":     total_steps,
        "calories_approx": total_calories,
        "daily_goal_pct":  daily_goal_pct(total_steps, daily_goal),
        "legs":            legs_out,
    }

    return {
        "stops":              stops_out,
        "stop_coords":        stop_coords_out,
        # Legacy mirrors of stops[0] / stops[-1] so 2-stop clients still work.
        "origin_coords":      origin_out,
        "dest_coords":        dest_out,
        "step_length_inches": step_length_in,
        "personalized":       personalized,
        "personalized_calories": personalized_calories,
        "pace":               pace,
        "default_flavor":     flavor_label,
        "available_flavors":  [flavor_label],   # only one flavor for multi-stop
        "routes":             [full_route],
        "legs":               legs_out,
        "total_miles":        full_route["total_miles"],
        "total_minutes":      full_route["total_minutes"],
        "total_steps":        full_route["total_steps"],
        "calories_approx":    full_route["calories_approx"],
        "daily_goal_pct":     full_route["daily_goal_pct"],
        "path":               full_path,
        "directions":         all_directions,
    }
