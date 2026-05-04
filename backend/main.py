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
    WALKING_SPEED_MPH,
    _load_graph,
    _get_flavor_weights,
    FLAVORS,
    DEFAULT_FLAVOR,
)
from geocoding import resolve_location, reverse_geocode_point
from utils import CHICAGO_SOUTH, CHICAGO_NORTH, CHICAGO_WEST, CHICAGO_EAST
from steps import (
    step_length_from_height,
    steps_from_miles,
    calories_from_minutes,
    daily_goal_pct,
    DEFAULT_STEP_LENGTH_FT,
)

_METERS_PER_MILE = 1609.34
# Two points within ~0.07 miles of each other are treated as the same location
_SAME_LOCATION_DEG2: float = 0.001 ** 2

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
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
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

    @field_validator("height_inches")
    @classmethod
    def validate_height(cls, v: float | None) -> float | None:
        if v is not None and not (36 <= v <= 108):  # 3 ft to 9 ft — sanity range
            raise ValueError("height_inches must be between 36 and 108")
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
@limiter.limit("60/minute")
async def health(request: Request):
    return {"status": "ok"}


@app.get("/reverse-geocode")
@limiter.limit("30/minute")
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
@limiter.limit("10/minute")
async def route(request: Request, payload: RouteRequest):
    loop = asyncio.get_running_loop()

    stops = payload.stops
    is_multi = len(stops) > 2

    # Resolve all stops concurrently.
    resolved = await asyncio.gather(*[
        loop.run_in_executor(None, resolve_location, s) for s in stops
    ])
    for i, coords in enumerate(resolved):
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

    def _enrich_directions(directions, leg_index: int | None = None):
        out = []
        for d in directions:
            seg_miles = d["distance_meters"] / _METERS_PER_MILE
            entry = {
                **d,
                "distance_miles": round(seg_miles, 3),
                "steps":          steps_from_miles(seg_miles, step_len),
            }
            if leg_index is not None:
                entry["leg_index"] = leg_index
            out.append(entry)
        return out

    def _summarize_alt(alt: dict) -> dict:
        total_minutes = alt["minutes"]
        total_miles   = total_minutes * WALKING_SPEED_MPH / 60.0
        total_steps   = steps_from_miles(total_miles, step_len)
        return {
            "flavor":          alt["flavor"],
            "path":            alt["path"],
            "directions":      _enrich_directions(alt["directions"]),
            "total_miles":     round(total_miles, 2),
            "total_minutes":   total_minutes,
            "total_steps":     total_steps,
            "calories_approx": calories_from_minutes(total_minutes),
            "daily_goal_pct":  daily_goal_pct(total_steps),
        }

    # Coordinate shapes shared across both response branches.
    stops_out        = list(stops)
    stop_coords_out  = [list(c) for c in resolved]
    origin_out       = list(resolved[0])
    dest_out         = list(resolved[-1])
    step_length_in   = round(step_len * 12, 1)
    personalized     = payload.height_inches is not None

    if not is_multi:
        # 2-stop: keep existing alternative-routes behavior unchanged.
        alternatives = await loop.run_in_executor(
            None, walk_paths_alternatives, *resolved[0], *resolved[1],
        )
        routes = [_summarize_alt(alt) for alt in alternatives]
        default = next((r for r in routes if r["flavor"] == DEFAULT_FLAVOR), routes[0])
        return {
            "stops":              stops_out,
            "stop_coords":        stop_coords_out,
            "origin_coords":      origin_out,
            "dest_coords":        dest_out,
            "step_length_inches": step_length_in,
            "personalized":       personalized,
            "default_flavor":     default["flavor"],
            "available_flavors":  list(FLAVORS),
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

    legs_raw = list(await asyncio.gather(*[_compute_leg(i) for i in range(len(resolved) - 1)]))

    full_path, leg_slices = _stitch_legs(legs_raw)

    legs_out = []
    all_directions: list[dict] = []
    total_minutes = 0.0
    total_miles   = 0.0
    total_steps   = 0
    total_calories = 0
    for i, leg in enumerate(legs_raw):
        leg_minutes = leg["minutes"]
        leg_miles   = leg_minutes * WALKING_SPEED_MPH / 60.0
        leg_steps   = steps_from_miles(leg_miles, step_len)
        leg_cal     = calories_from_minutes(leg_minutes)
        leg_dirs    = _enrich_directions(leg["directions"], leg_index=i)
        all_directions.extend(leg_dirs)
        total_minutes += leg_minutes
        total_miles   += leg_miles
        total_steps   += leg_steps
        total_calories += leg_cal
        legs_out.append({
            "from_label":      leg["from_label"],
            "to_label":        leg["to_label"],
            "miles":           round(leg_miles, 2),
            "minutes":         round(leg_minutes, 1),
            "steps":           leg_steps,
            "calories_approx": leg_cal,
            "path_slice":      list(leg_slices[i]),
        })

    total_minutes_r = round(total_minutes, 1)

    full_route = {
        "flavor":          DEFAULT_FLAVOR,
        "path":            full_path,
        "directions":      all_directions,
        "total_miles":     round(total_miles, 2),
        "total_minutes":   total_minutes_r,
        "total_steps":     total_steps,
        "calories_approx": total_calories,
        "daily_goal_pct":  daily_goal_pct(total_steps),
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
        "default_flavor":     DEFAULT_FLAVOR,
        "available_flavors":  [DEFAULT_FLAVOR],   # only fastest for multi-stop in v1
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
