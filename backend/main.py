import asyncio
import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager


# TD-069: structured logging opt-in. Set STRUCTURED_LOGS=true (or
# anything in {"1", "true", "yes"}) to swap the root logger's handler
# from uvicorn's default text formatter to python-json-logger's JSON
# formatter. Every existing `logger.warning(...)` call works unchanged
# — only the rendered line format flips. JSON lines are parseable by
# `jq` directly and ingestable by every log aggregator that speaks
# JSON-lines (Datadog, Loki, CloudWatch, etc.).
def _configure_structured_logging() -> None:
    if os.getenv("STRUCTURED_LOGS", "").lower() not in ("1", "true", "yes"):
        return
    try:
        from pythonjsonlogger import jsonlogger
    except ImportError:  # pragma: no cover — opt-in dep
        logging.getLogger(__name__).warning(
            "STRUCTURED_LOGS=true but python-json-logger not installed — "
            "falling back to text logs.",
        )
        return
    handler = logging.StreamHandler()
    handler.setFormatter(jsonlogger.JsonFormatter(
        "%(asctime)s %(name)s %(levelname)s %(message)s",
        rename_fields={"asctime": "ts", "levelname": "level", "name": "logger"},
    ))
    root = logging.getLogger()
    # Replace existing handlers — uvicorn installs its own at startup and
    # double-logging is noisy.
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


_configure_structured_logging()

logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from models import (
    AutocompleteResponse,
    ErrorDetail,
    ExploreResponse,
    HealthResponse,
    ReverseGeocodeResponse,
    RouteResponse,
    assert_default_flavor_in_routes,
)

load_dotenv()


def http_error(status: int, message: str, *, stop_index: int | None = None) -> HTTPException:
    """Raise an HTTPException carrying the standardized :class:`ErrorDetail`
    payload nested under ``{detail: ...}``. Replaces the bare-string and
    ad-hoc-dict shapes ``main.py`` previously emitted (C-09).
    """
    detail: dict = {"message": message}
    if stop_index is not None:
        detail["stop_index"] = stop_index
    return HTTPException(status_code=status, detail=detail)

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
    greenest_degradation_status,
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
    haversine_miles, METERS_PER_MILE, quantize_coord, quantize_geojson,
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
import explore
import places
import parks
import green_space
import tree_canopy
from explore import explore as compute_explore, within_reach_landmarks
from community_areas import lookup_centroid
from places import dedupe_osm_parks_against_cpd, places_in_polygon, residential_heatmap
from parks import parks_in_polygon, pins_from_feature_collection as cpd_park_pins_from_fc
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


# Dedicated thread pool for /explore's five heatmap clips (OPT-069). The
# default loop executor (min(32, cpu_count + 4) threads) would otherwise queue
# the five futures behind unrelated work under load; 8 threads gives slack for
# two concurrent /explore requests plus headroom for short bursts. Multi-worker
# uvicorn (OPT-035) gives each process its own pool, so concurrent load scales
# with worker count × 8 heatmap threads.
_heatmap_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="heatmap")


_WARMERS = (
    ("places.STRtree",        places._ensure_index),
    ("residential.STRtree",   places._ensure_residential_index),
    ("parks.STRtree",         parks._ensure_index),
    ("green_space.STRtree",   green_space._ensure_index),
    ("tree_canopy.STRtree",   tree_canopy._ensure_index),
    ("chicago_boundary",      explore._get_chicago_boundary),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    # OPT-050: await the graph load so the first /route after deploy doesn't
    # race the lifespan-scheduled future for `_graph_lock`. The container's
    # start-up pays this cost once; `/health` then returns immediately.
    logger.info("Preloading street graph ...")
    await loop.run_in_executor(None, _preload_graph)
    # OPT-034 + OPT-054: warm heatmap STRtrees + the boundary clip in parallel
    # so the first /explore lands at warm latency instead of paying 200–500 ms
    # of cold-start STRtree builds and a boundary JSON parse. Failures here
    # are logged but do not block boot — each module's lazy path still
    # handles load-on-demand if its warmer raised.
    logger.info("Street graph ready; warming heatmap indexes + boundary ...")
    results = await asyncio.gather(
        *(loop.run_in_executor(None, fn) for _, fn in _WARMERS),
        return_exceptions=True,
    )
    for (name, _), result in zip(_WARMERS, results):
        if isinstance(result, BaseException):
            logger.warning("warm-up failed for %s: %r", name, result)
    _start_eviction_daemon()
    yield
    # TD-056 / B-17 + B-18 + B-20: shutdown cleanup. Close the LocationIQ
    # session (releases pooled keep-alive connections), close the geocoding
    # SQLite cache (flushes WAL), and shut down the dedicated heatmap pool
    # so its worker threads don't hang the process exit. Order: outbound
    # network first (HTTP session), then storage (sqlite WAL flush), then
    # in-process pools.
    logger.info("Lifespan shutdown: releasing HTTP session, sqlite cache, thread pool ...")
    try:
        from geocoding import close_http_session as _close_geocoder_http
        _close_geocoder_http()
    except Exception as exc:
        logger.warning("HTTP session close failed: %r", exc)
    try:
        from geocoding import _cache_db
        if _cache_db is not None:
            _cache_db.close()
    except Exception as exc:
        logger.warning("geocoding cache db close failed: %r", exc)
    try:
        _heatmap_pool.shutdown(wait=False, cancel_futures=True)
    except Exception as exc:
        logger.warning("heatmap pool shutdown failed: %r", exc)


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

# TD-056 / B-24: one-shot WARN latch for the "X-Forwarded-For shorter than
# TRUSTED_PROXY_HOPS" failure mode. Fires once per process so a
# misconfigured proxy chain shows up in logs without spamming on every
# request. Reset to False makes the next overshoot re-warn.
_xff_overshoot_warned: bool = False


def _client_ip(request: Request) -> str:
    """Rate-limit key: the real client IP rather than the proxy connection peer.

    With TRUSTED_PROXY_HOPS proxies in front of the app, the client IP is the
    X-Forwarded-For entry that many positions from the end. Falls back to the
    connection peer when X-Forwarded-For is absent or shorter than the declared
    hop count, so the limiter always has a usable key.

    TD-056 / B-25: validates each X-Forwarded-For token as an IP via
    `ipaddress.ip_address` before returning it as the rate-limit key. A
    malformed XFF header (some proxies prepend hostnames, others double-
    comma) would otherwise produce a bogus rate-limit bucket key that
    couldn't be reconciled across requests.
    """
    global _xff_overshoot_warned
    import ipaddress

    if _TRUSTED_PROXY_HOPS > 0:
        parts = [
            p.strip()
            for p in request.headers.get("x-forwarded-for", "").split(",")
            if p.strip()
        ]
        if len(parts) >= _TRUSTED_PROXY_HOPS:
            candidate = parts[-_TRUSTED_PROXY_HOPS]
            try:
                ipaddress.ip_address(candidate)
                return candidate
            except ValueError:
                # Malformed XFF token at the trusted-hop position — fall
                # back to connection peer. Don't WARN on every request;
                # a misconfigured upstream proxy would otherwise drown
                # the log. The peer fallback below still produces a
                # consistent (albeit collapsed) rate-limit key.
                pass
        elif not _xff_overshoot_warned:
            _xff_overshoot_warned = True
            logger.warning(
                "X-Forwarded-For has %s entries but TRUSTED_PROXY_HOPS=%s — "
                "falling back to the connection peer for the rate-limit key. "
                "Verify the proxy chain depth; this warning fires once per "
                "process.",
                len(parts), _TRUSTED_PROXY_HOPS,
            )
    return get_remote_address(request)


# OPT-044: rate-limiter key reads the cached IP off `request.state.client_ip`
# (stashed by the middleware below) so the X-Forwarded-For parse only runs
# once per request instead of once per `@limiter.limit(...)` decorator invocation.
# Falls back to the direct parse for callers that bypass the middleware path
# (the rate-limit-exceeded handler, defensive only — the middleware always runs
# for HTTP requests in practice).
def _client_ip_key(request: Request) -> str:
    cached = getattr(request.state, "client_ip", None)
    if cached is not None:
        return cached
    return _client_ip(request)


limiter = Limiter(key_func=_client_ip_key, default_limits=[], enabled=_RATE_LIMIT_ENABLED)

app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ── Middleware registration ─────────────────────────────────────────────────
# Starlette runs registered-last-as-outermost (the last `add_middleware`/
# `@app.middleware` call wraps everything before it). So request flow is:
#
#     CORS (outermost)  →  GZip  →  security headers  →  client-IP stash
#         (responses flow back in reverse)
#
# OPT-043 puts CORS outermost so OPTIONS preflights short-circuit at CORS
# before paying the inner-middleware cost. The IP-stash middleware is
# innermost so `request.state.client_ip` is set just before the route handler
# (and its `@limiter.limit(...)` decorator) reads it.


@app.middleware("http")
async def stash_request_id(request: Request, call_next):
    """TD-069: every request gets a uuid4 `request_id` for log correlation.
    Honors an incoming `X-Request-Id` header so a reverse proxy or upstream
    service can pin its own ID; otherwise we generate one. The ID is
    available to handlers via `request.state.request_id` and echoed in the
    response's `X-Request-Id` header so client logs can correlate too.
    """
    incoming = request.headers.get("x-request-id", "").strip()
    # Cap incoming IDs to avoid log poisoning via gigantic headers. Standard
    # uuid4 hex is 36 chars; allow some slack for prefixed formats.
    request_id = incoming[:128] if 0 < len(incoming) <= 128 else uuid.uuid4().hex
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response


@app.middleware("http")
async def stash_client_ip(request: Request, call_next):
    request.state.client_ip = _client_ip(request)
    return await call_next(request)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # TD-067 / S-01: deny every powerful Web API the app doesn't need.
    # Passage uses geolocation client-side only — the backend never holds
    # it — so a Permissions-Policy header on every response keeps a future
    # XSS (or a compromised dependency) from probing camera/mic/usb from
    # an attacker-controlled iframe embed. Format follows the structured
    # syntax — `geolocation=()` means "no origin can use geolocation
    # through this document's policy context."
    response.headers["Permissions-Policy"] = (
        "accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), "
        "camera=(), display-capture=(), document-domain=(), encrypted-media=(), "
        "fullscreen=(self), gamepad=(), geolocation=(self), gyroscope=(), "
        "hid=(), idle-detection=(), magnetometer=(), microphone=(), midi=(), "
        "payment=(), picture-in-picture=(), publickey-credentials-get=(), "
        "screen-wake-lock=(), serial=(), sync-xhr=(), usb=(), web-share=(self), "
        "xr-spatial-tracking=()"
    )
    if request.url.scheme == "https" or (
        _TRUST_PROXY_HEADERS and request.headers.get("x-forwarded-proto") == "https"
    ):
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


app.add_middleware(GZipMiddleware, minimum_size=500)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=_DEV_TUNNEL_ORIGIN_REGEX,
    allow_credentials=False,
    # TD-067 / S-05: HEAD is implicitly accepted by FastAPI as a GET
    # without a body; declaring it explicitly in the CORS allowlist
    # documents that and prevents a future tightening from silently
    # dropping HEAD support.
    allow_methods=["GET", "HEAD", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)


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
            # TD-067 / S-04: reject NaN + ±inf explicitly. Without this, a
            # NaN-coord request would short-circuit the bbox check below
            # (NaN comparisons always return False, so `NaN <= x <= y` is
            # False — the request rejects, but for the wrong reason). An
            # explicit isfinite() check fails fast with a clear message.
            import math
            if not (math.isfinite(self.lat) and math.isfinite(self.lon)):
                raise ValueError("origin lat/lon must be finite numbers")
            if not (CHICAGO_SOUTH <= self.lat <= CHICAGO_NORTH):
                raise ValueError("origin.lat is outside the Chicago coverage area")
            if not (CHICAGO_WEST <= self.lon <= CHICAGO_EAST):
                raise ValueError("origin.lon is outside the Chicago coverage area")
        return self


_HEATMAP_LAYER_NAMES: frozenset[str] = frozenset(
    {"residential", "parks", "green_space", "tree_canopy"}
)


class ExploreRequest(BaseModel):
    origin: ExploreOrigin
    max_minutes: int = Field(ge=5, le=45)
    categories: list[str] | None = None
    height_inches: float | None = None
    # Subset of {"residential", "parks", "green_space", "tree_canopy"}. When
    # `None` (the default) the backend computes every heatmap; when a list is
    # provided, layers not in the set are skipped and returned as `null`. Used
    # to avoid ~150 ms of shapely clip work for layers the user has toggled off
    # on the frontend (OPT-025).
    with_heatmaps: list[str] | None = None

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
        if not cleaned:
            return None
        # TD-057 / B-04: cross-check against the known top-level category
        # keys. The frontend's dropdown is closed-set, but a deep link or
        # a hand-rolled API call could send a typo or a stale rename; 422
        # at the boundary is much better than silently returning zero
        # places (the prior behavior — no category match, empty list).
        # The "__none__" sentinel is the frontend's "selection is empty"
        # marker — it never matches any real category, but the backend
        # treats it as "filter out everything" by construction; allow it
        # through here so the existing semantics survive.
        known = places.known_categories()
        unknown = [c for c in cleaned if c not in known and c != "__none__"]
        if unknown:
            raise ValueError(
                f"categories contains unknown key(s): {unknown!r}. "
                f"Known top-level keys: {sorted(known)!r}."
            )
        return cleaned

    @field_validator("with_heatmaps")
    @classmethod
    def validate_with_heatmaps(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        unknown = [name for name in v if name not in _HEATMAP_LAYER_NAMES]
        if unknown:
            raise ValueError(
                f"with_heatmaps contains unknown layer(s): {unknown!r}. "
                f"Valid names: {sorted(_HEATMAP_LAYER_NAMES)!r}."
            )
        # Empty list is meaningful — "compute no heatmaps". Preserve as-is.
        return v


@app.get("/health", response_model=HealthResponse, response_model_exclude_none=True)
async def health(request: Request):
    # TD-068: surface greenest-routing degradation flags so an operator
    # can spot a multi-city pickle drift (or a partial v3 pickle) without
    # tailing logs. The flags are populated by `_load_graph` after the
    # per-column presence check; an "all clear" response carries no
    # `feature_degraded` key at all.
    # TD-057 / B-07: also surface autocomplete degradation. The POI half
    # of the index can be transiently unavailable (corrupt places JSON,
    # etc.); a `feature_degraded.autocomplete: true` lets operators
    # notice without tailing logs.
    flags = dict(greenest_degradation_status())
    if local_search.autocomplete_degraded():
        flags["autocomplete"] = True
    payload: dict = {"status": "ok"}
    if any(flags.values()):
        payload["feature_degraded"] = flags
    return payload


@app.post("/explore", response_model=ExploreResponse)
@limiter.limit("30/minute")
async def explore_endpoint(request: Request, payload: ExploreRequest):
    """Return the walkable isochrone polygon for an origin + time budget.

    Response shape:
        {
          "origin_coords": [lat, lon],
          "max_minutes": int,
          "polygon": GeoJSON Polygon,
          "within_reach_landmarks": [ {name, lat, lon}, ... ],
          "stats": { "node_count": int, "area_sq_mi": float },
          "places": [ {category, subcategory, name, lat, lon, address, source}, ... ],
          "residential_heatmap": GeoJSON MultiPolygon | null,
          "tree_canopy_heatmap": GeoJSON FeatureCollection | null,
          "parks_heatmap": GeoJSON FeatureCollection | null,
          "green_space_heatmap": GeoJSON FeatureCollection | null,
        }

    `within_reach_landmarks` is the curated Commission on Chicago Landmarks set
    clipped to the isochrone, ordered ascending by haversine distance from the
    origin (alphabetical tiebreak). Independent of `categories` — the chip rail
    is always populated even when landmarks are toggled off as map pins.

    `categories` filters `places` to the named top-level category keys (omit
    or send null to return every place inside the polygon). `height_inches`
    is currently accepted but unused — reserved for future step-count
    enrichment of the place list.
    """
    origin = payload.origin
    if origin.community_area:
        coords = lookup_centroid(origin.community_area)
        if coords is None:
            # TD-067 / S-06: don't echo the requested community-area name
            # back. The list is fixed (77 entries) and the frontend uses a
            # dropdown of valid values, so a free-form name here is either
            # a stale URL or a probe — echoing it just pads logs and
            # reflected-content surface.
            raise http_error(400, "Unknown community area.")
        origin_lat, origin_lon = coords
    else:
        origin_lat, origin_lon = origin.lat, origin.lon

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None, compute_explore, origin_lat, origin_lon, payload.max_minutes,
    )
    if result is None:
        raise http_error(
            422,
            (
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

    # OPT-025: skip the clip work for heatmaps the frontend toggled off. When
    # `with_heatmaps` is None (omitted) we keep the legacy behavior of
    # computing every layer.
    include_heatmaps = (
        set(payload.with_heatmaps)
        if payload.with_heatmaps is not None
        else _HEATMAP_LAYER_NAMES
    )
    # CPD parks pin injection: we always compute the parks clip when the
    # caller wants `parks` pins (either no category filter, or "parks" is in
    # the filter), even if `with_heatmaps` toggled the parks-fill layer off.
    # The clip's grouped intersections are the source of truth for the pin
    # coordinates; deriving them after the fact guarantees the pin lies
    # inside the visible park ∩ isochrone slice.
    want_park_pins = (
        payload.categories is None or "parks" in payload.categories
    )
    compute_parks = want_park_pins or "parks" in include_heatmaps
    heatmap_specs = (
        ("residential", residential_heatmap),
        ("tree_canopy", tree_canopy_in_polygon),
        ("parks",       parks_in_polygon),
        ("green_space", green_space_in_polygon),
    )
    heatmap_futs = {
        name: loop.run_in_executor(_heatmap_pool, _clip, fn)
        for name, fn in heatmap_specs
        if (name == "parks" and compute_parks) or (name != "parks" and name in include_heatmaps)
    }
    places_fut = loop.run_in_executor(_heatmap_pool, _clip, places_in_polygon, payload.categories)
    landmarks_fut = loop.run_in_executor(
        _heatmap_pool, _clip, within_reach_landmarks, origin_lat, origin_lon,
    )
    gathered = await asyncio.gather(places_fut, landmarks_fut, *heatmap_futs.values())
    places = gathered[0]
    landmarks = gathered[1]
    heatmap_results: dict[str, object] = dict(zip(heatmap_futs.keys(), gathered[2:]))

    # Splice CPD park pins into the places list, deduping any OSM `parks`
    # entry that names the same park within ~75 m. The CPD roster is
    # authoritative for "what is an official Chicago Park District park,"
    # so a collision is resolved in CPD's favor.
    if want_park_pins:
        cpd_pins = cpd_park_pins_from_fc(heatmap_results.get("parks"))
        if cpd_pins:
            places = dedupe_osm_parks_against_cpd(places, cpd_pins) + cpd_pins

    return quantize_geojson({
        "origin_coords": [origin_lat, origin_lon],
        "max_minutes": payload.max_minutes,
        "polygon": result["polygon"],
        "within_reach_landmarks": landmarks,
        "stats": result["stats"],
        "places": places,
        # GeoJSON MultiPolygon (or null if no residential land falls inside
        # the isochrone — happens for tight Loop-area budgets, OR when the
        # caller passed a `with_heatmaps` filter that excluded "residential").
        "residential_heatmap": heatmap_results.get("residential"),
        # GeoJSON FeatureCollection of up to three density bands (low/mid/
        # high), or null when no canopy cells overlap the isochrone.
        "tree_canopy_heatmap": heatmap_results.get("tree_canopy"),
        # GeoJSON FeatureCollection of CPD park footprints clipped to the
        # isochrone (one Feature per park with name + acres properties),
        # or null when no park polygons overlap. When the caller's
        # `with_heatmaps` filter excluded "parks" we still compute the clip
        # internally to derive CPD park pins for `places`, but suppress the
        # footprint payload here so the response respects the toggle.
        "parks_heatmap": heatmap_results.get("parks") if "parks" in include_heatmaps else None,
        # GeoJSON FeatureCollection of non-CPD green space (cemeteries,
        # golf courses, nature reserves / Forest Preserves, recreation
        # grounds) clipped to the isochrone. One Feature per `kind`
        # (kind ∈ {cemetery, golf_course, nature_reserve, recreation_ground}),
        # or null when none overlap.
        "green_space_heatmap": heatmap_results.get("green_space"),
    })


@app.get("/reverse-geocode", response_model=ReverseGeocodeResponse)
@limiter.limit("60/minute")
async def reverse_geocode(request: Request, lat: float, lon: float):
    # TD-067 / S-04: reject NaN + ±inf before the bbox check so a non-finite
    # coord fails with a clear message rather than the bbox's "outside
    # coverage area" (NaN comparisons always evaluate False).
    import math
    if not (math.isfinite(lat) and math.isfinite(lon)):
        raise http_error(422, "lat and lon must be finite numbers.")
    if not (CHICAGO_SOUTH <= lat <= CHICAGO_NORTH and CHICAGO_WEST <= lon <= CHICAGO_EAST):
        raise http_error(422, "Location is outside the Chicago coverage area.")
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
    head = next((c for c in q if not c.isspace()), "")
    return head.isdigit()


@app.get("/autocomplete", response_model=AutocompleteResponse)
@limiter.limit("60/minute")
async def autocomplete_endpoint(
    request: Request,
    # TD-067 / S-03: enforce the 200-char `q` cap at the Pydantic boundary
    # so Starlette rejects oversize requests before the handler body runs.
    # The redundant handler-body check below is kept as a belt-and-braces
    # guard for clients that bypass the query-param binding (e.g. test
    # fixtures that pass `q` directly).
    q: str = Query(..., max_length=200),
    limit: int = Query(8, ge=1, le=20),
):
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
        raise http_error(422, "query too long")
    if not (1 <= limit <= _AUTOCOMPLETE_MAX_LIMIT):
        raise http_error(422, f"limit must be between 1 and {_AUTOCOMPLETE_MAX_LIMIT}")

    loop = asyncio.get_running_loop()
    suggestions = await loop.run_in_executor(None, local_search.autocomplete, q, limit)

    # OPT-085: a stable `id` per suggestion (composed of source + label +
    # quantized coords) lets the frontend use it as the React `<li key=...>`
    # so list reconciliation across filter/reorder keeps the DOM nodes
    # mounted instead of remounting every row. Same suggestion across two
    # backend calls gets the same id; collisions between different
    # suggestions are blocked by source-prefixing.
    out = [
        {
            "label": s.label,
            "lat": s.lat,
            "lon": s.lon,
            "source": s.source,
            "id": f"{s.source}|{s.label}|{s.lat:.6f},{s.lon:.6f}",
        }
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
                "id": f"locationiq|{q}|{coords[0]:.6f},{coords[1]:.6f}",
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


@app.post("/route", response_model=RouteResponse)
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
            # TD-067 / S-02: don't echo `stops[i]` back. The frontend already
            # knows what the user typed (it's in the input field) and an
            # offline attacker probing for log noise has no business pinning
            # arbitrary strings into the response body.
            raise http_error(
                422,
                f"Stop {i + 1} isn't in Chicago. Try a Chicago neighborhood, landmark, or street address.",
                stop_index=i,
            )
        if isinstance(coords, GeocoderDegradedError):
            raise http_error(503, GeocoderDegradedError.DEFAULT_MESSAGE)
        if isinstance(coords, BaseException):
            raise coords  # unexpected — let FastAPI's 500 handler surface it
        if not coords:
            raise http_error(
                400,
                (
                    f"Stop {i + 1} could not be found in Chicago. "
                    "Try a neighborhood name or a street address. "
                    "Coverage: the full Chicago city limits (all 77 community areas)."
                ),
                stop_index=i,
            )

    # Adjacent-duplicate validation: true haversine so the threshold is symmetric
    # in every direction (degrees² shortcuts skew because 1° lon ≠ 1° lat).
    for i in range(len(resolved) - 1):
        a, b = resolved[i], resolved[i + 1]
        if haversine_miles(a[0], a[1], b[0], b[1]) < _SAME_LOCATION_THRESHOLD_MILES:
            if not is_multi:
                raise http_error(
                    400,
                    "Your origin and destination appear to be the same location.",
                    stop_index=1,
                )
            raise http_error(
                400,
                f"Stop {i + 1} and {i + 2} are the same location.",
                stop_index=i + 1,
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

    # Coordinate shapes shared across both response branches. Tuples encode
    # identically to lists in both stdlib json and orjson, so no rewrap.
    stops_out        = stops
    stop_coords_out  = resolved
    origin_out       = resolved[0]
    dest_out         = resolved[-1]
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
                "directions": directions,
                "minutes": minutes,
            }]
        else:
            alternatives = await loop.run_in_executor(
                None, walk_paths_alternatives, *resolved[0], *resolved[1],
            )
        routes = [_summarize_alt(alt) for alt in alternatives]
        default = next((r for r in routes if r["flavor"] == DEFAULT_FLAVOR), routes[0])
        available_flavors = ["custom"] if has_routing_prefs else FLAVORS
        # C-08: defensive assert. The line above picks default by exact match
        # with `routes[0]` fallback, so the invariant holds by construction;
        # this guard documents it so a future refactor can't silently break it.
        assert_default_flavor_in_routes(default["flavor"], routes)
        return quantize_geojson({
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
        })

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
            "directions": directions,
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
            "path_slice":      leg_slices[i],
        })

    # Compute totals from the unrounded sums so multi-stop matches 2-stop's
    # round-of-sum semantics (vs. the prior sum-of-rounded-legs, which drifted
    # by ±N steps where N = leg count).
    total_steps    = steps_from_miles(total_miles, step_len)
    total_calories = calories_from_minutes(total_minutes, weight_kg, pace)
    total_minutes_r = round(total_minutes, 1)

    flavor_label = "custom" if has_routing_prefs else DEFAULT_FLAVOR
    # C-08: same invariant on the multi-stop branch — `routes` is built below
    # as `[full_route]`, and `full_route["flavor"]` is `flavor_label`. Keeping
    # the explicit call so a future refactor that decouples them still trips
    # the guard.
    _multi_routes_flavors_check = [{"flavor": flavor_label}]
    assert_default_flavor_in_routes(flavor_label, _multi_routes_flavors_check)
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

    return quantize_geojson({
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
    })
