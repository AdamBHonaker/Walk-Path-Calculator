import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, field_validator
from dotenv import load_dotenv

load_dotenv()

from walking import _compute_route, WALKING_SPEED_MPH, _load_graph
from geocoding import resolve_location
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
    o.strip() for o in _extra_origins.split(",") if o.strip()
]

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[main] Pre-loading street graph ...")
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _load_graph)
    print("[main] Ready.")
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RouteRequest(BaseModel):
    origin: str
    destination: str
    # Optional height for personalized step count. Accepted in inches or
    # as a pre-combined value (frontend sends total inches).
    height_inches: float | None = None

    @field_validator("origin", "destination")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        return v

    @field_validator("height_inches")
    @classmethod
    def validate_height(cls, v: float | None) -> float | None:
        if v is not None and not (36 <= v <= 108):  # 3 ft to 9 ft — sanity range
            raise ValueError("height_inches must be between 36 and 108")
        return v


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.options("/route")
async def options_route():
    """Handle CORS preflight requests"""
    return Response(status_code=200)


@app.post("/route")
async def route(request: RouteRequest, http_request: Request):
    loop = asyncio.get_running_loop()

    # Resolve both locations concurrently
    origin_coords, dest_coords = await asyncio.gather(
        loop.run_in_executor(None, resolve_location, request.origin),
        loop.run_in_executor(None, resolve_location, request.destination),
    )

    if not origin_coords:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Could not find '{request.origin}' in Chicago. "
                "Try a neighborhood name (e.g. 'Wrigleyville', 'Logan Square') "
                "or a street address."
            ),
        )
    if not dest_coords:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Could not find '{request.destination}' in Chicago. "
                "Try a neighborhood name or a street address. "
                "Coverage: Howard St to 50th St, Lakefront to Pulaski Rd."
            ),
        )

    dlat = origin_coords[0] - dest_coords[0]
    dlon = origin_coords[1] - dest_coords[1]
    if (dlat * dlat + dlon * dlon) < _SAME_LOCATION_DEG2:
        raise HTTPException(
            status_code=400,
            detail="Your origin and destination appear to be the same location.",
        )

    # Single cached call — Dijkstra runs at most once per origin/destination pair.
    route         = await loop.run_in_executor(None, _compute_route, *origin_coords, *dest_coords)
    path          = [list(pt) for pt in route[0]]
    directions    = list(route[1])
    total_minutes = route[2]

    # Step calculation — derive total_miles directly from total_minutes so that
    # steps and calories are computed from the same underlying distance value.
    step_len = (
        step_length_from_height(request.height_inches)
        if request.height_inches is not None
        else DEFAULT_STEP_LENGTH_FT
    )
    total_miles = total_minutes * WALKING_SPEED_MPH / 60.0
    total_steps = steps_from_miles(total_miles, step_len)
    calories    = calories_from_minutes(total_minutes)
    goal_pct    = daily_goal_pct(total_steps)

    # Enrich each direction step with distance + step count
    enriched = []
    for d in directions:
        seg_miles = d["minutes"] * WALKING_SPEED_MPH / 60.0
        enriched.append({
            **d,
            "distance_miles": round(seg_miles, 3),
            "steps": steps_from_miles(seg_miles, step_len),
        })

    return {
        "origin_coords":      list(origin_coords),
        "dest_coords":        list(dest_coords),
        "total_miles":        round(total_miles, 2),
        "total_minutes":      total_minutes,
        "total_steps":        total_steps,
        "calories_approx":    calories,
        "daily_goal_pct":     goal_pct,
        "step_length_inches": round(step_len * 12, 1),
        "personalized":       request.height_inches is not None,
        "path":               path,
        "directions":         enriched,
    }
