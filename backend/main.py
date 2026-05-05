import asyncio
import logging
import os
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
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
    _get_flavor_weights,
    FLAVORS,
    DEFAULT_FLAVOR,
)
from geocoding import resolve_location, reverse_geocode_point, LocationOutsideChicagoError, GeocoderDegradedError
from utils import CHICAGO_SOUTH, CHICAGO_NORTH, CHICAGO_WEST, CHICAGO_EAST
from steps import (
    step_length_from_height,
    steps_from_miles,
    calories_from_minutes,
    daily_goal_pct,
    DEFAULT_STEP_LENGTH_FT,
    DEFAULT_PACE,
    PACE_TO_MET,
)

_METERS_PER_MILE = 1609.34
# Two points within ~0.07 miles of each other are treated as the same location
_SAME_LOCATION_DEG2: float = 0.001 ** 2

# Per-endpoint rate limits. Overridable via env vars so deploys can tune
# without a code change (e.g. to relax limits during load testing).
RATE_LIMIT_HEALTH          = os.getenv("RATE_LIMIT_HEALTH",          "60/minute")
RATE_LIMIT_REVERSE_GEOCODE = os.getenv("RATE_LIMIT_REVERSE_GEOCODE", "30/minute")
RATE_LIMIT_ROUTE           = os.getenv("RATE_LIMIT_ROUTE",           "10/minute")

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Pre-loading street graph ...")
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _load_graph)
    # Pre-warm non-default flavor weights so the first request for these
    # flavors does not pay the ~50k-edge iteration cost.
    for flavor in ("fewest_turns", "greenest"):
        await loop.run_in_executor(None, _get_flavor_weights, flavor)
    logger.info("Ready.")
    yield


app = FastAPI(lifespan=lifespan)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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


@app.get("/health")
@limiter.limit(RATE_LIMIT_HEALTH)
async def health(request: Request):
    return {"status": "ok"}


@app.get("/reverse-geocode")
@limiter.limit(RATE_LIMIT_REVERSE_GEOCODE)
async def reverse_geocode(request: Request, lat: float, lon: float):
    if not (CHICAGO_SOUTH <= lat <= CHICAGO_NORTH and CHICAGO_WEST <= lon <= CHICAGO_EAST):
        raise HTTPException(status_code=422, detail="Location is outside the Chicago coverage area.")
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, reverse_geocode_point, lat, lon)
    return result


@app.options("/route")
async def options_route():
    """Handle CORS preflight requests"""
    return Response(status_code=200)


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
    full_path = [list(pt) for pt in legs_raw[0]["path"]]
    leg_slices: list[tuple[int, int]] = [(0, len(full_path) - 1)]
    for leg in legs_raw[1:]:
        pts = leg["path"]
        if pts and full_path and _approx_eq(full_path[-1], pts[0]):
            start_idx = len(full_path) - 1   # shared seam index
            full_path.extend(list(pt) for pt in pts[1:])
        else:
            start_idx = len(full_path)
            full_path.extend(list(pt) for pt in pts)
        leg_slices.append((start_idx, len(full_path) - 1))
    return full_path, leg_slices


@app.post("/route")
@limiter.limit(RATE_LIMIT_ROUTE)
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
                        "Coverage: Howard St to 50th St, Lakefront to Pulaski Rd."
                    ),
                    "stop_index": i,
                },
            )

    # Adjacent-duplicate validation (per-leg generalization of _SAME_LOCATION_DEG2).
    for i in range(len(resolved) - 1):
        if _dist2(resolved[i], resolved[i + 1]) < _SAME_LOCATION_DEG2:
            if not is_multi:
                raise HTTPException(
                    status_code=400,
                    detail="Your origin and destination appear to be the same location.",
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
            seg_miles   = d["distance_meters"] / _METERS_PER_MILE
            seg_minutes = round(d.get("minutes", 0.0) * pace_factor, 1)
            entry = {
                **d,
                "minutes":        seg_minutes,
                "distance_miles": round(seg_miles, 3),
                "steps":          steps_from_miles(seg_miles, step_len),
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
                "path": [list(pt) for pt in path],
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
            "path":       [list(pt) for pt in path],
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
