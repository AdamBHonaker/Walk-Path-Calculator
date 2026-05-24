"""Pydantic response models for the public API.

These models enforce the response contract via FastAPI's ``response_model=``
parameter on every endpoint. They're defined to match the current emitted
shapes exactly — wiring them in does not change any client-visible response.

GeoJSON geometries are typed as ``dict[str, Any]`` rather than fully modelled.
The spec is well-known, the heatmap layers vary in shape across endpoints
(MultiPolygon vs FeatureCollection vs ``null``), and each heatmap clipper
already validates its own geometry at construction. A tighter GeoJSON model
would add brittleness without catching real bugs.

Error responses are standardized on :class:`ErrorDetail` nested under
FastAPI's ``{detail: ...}`` envelope. See :func:`http_error` in
``main.py`` for the helper that constructs HTTPException instances around
this shape.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# Coord aliases — JSON encodes tuples and lists identically, so accepting
# `list[float]` is the cleanest contract for the wire shape. Path entries
# are 2-element [lat, lon] pairs throughout the codebase.
Coord = list[float]


# ---------------------------------------------------------------------------
# Shared error envelope
# ---------------------------------------------------------------------------


class ErrorDetail(BaseModel):
    """Standardized payload nested under FastAPI's ``{detail: ...}`` envelope.

    Frontends should read ``response.detail.message`` for human-readable copy
    and ``response.detail.stop_index`` (present only on /route validation
    errors) to highlight the offending input. Additional context fields may
    appear over time — clients should treat unknown keys as informational
    and not error on them.
    """

    message: str = Field(..., description="Human-readable error copy for the UI to render.")
    stop_index: int | None = Field(
        default=None,
        description="0-based index of the offending stop, when the error is tied to one. /route only.",
    )


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    """Liveness probe payload. Always ``{"status": "ok"}`` when the process
    is up — the endpoint deliberately does not check downstream services,
    so a healthy response means "the FastAPI worker is responsive,"
    nothing more.

    TD-068: optional ``feature_degraded`` map surfaces per-signal greenest
    routing degradation. Keys are signal names (``canopy``, ``parks``);
    a ``True`` value means the loaded pickle didn't carry that column and
    the runtime zero-filled it. Absent / empty dict means greenest is
    operating with all signals. Operators monitor this so a multi-city
    pickle drift doesn't ship silently degraded routing.
    """

    status: Literal["ok"] = "ok"
    feature_degraded: dict[str, bool] | None = Field(
        default=None,
        description=(
            "Optional per-feature degradation map. Currently only "
            "greenest-routing signals — `canopy`, `parks`. `True` means "
            "that signal's column was missing from the loaded pickle."
        ),
    )


# ---------------------------------------------------------------------------
# /reverse-geocode
# ---------------------------------------------------------------------------


ReverseSource = Literal["neighborhood", "address", "locationiq", "coordinates"]


class ReverseGeocodeResponse(BaseModel):
    """Result of reverse-geocoding a (lat, lon) inside Chicago. ``source``
    identifies which tier of the cascade produced the label.
    """

    label: str
    source: ReverseSource


# ---------------------------------------------------------------------------
# /autocomplete
# ---------------------------------------------------------------------------


AutocompleteSource = Literal[
    "neighborhood",
    "intersection",
    "address",
    "place",
    "locationiq",
]


class AutocompleteSuggestion(BaseModel):
    """One row in /autocomplete's response. ``id`` is a stable per-suggestion
    key (source + label + 6-decimal-quantized coords) the frontend uses as
    the React list key — same suggestion across two backend calls carries
    the same ``id``.
    """

    label: str
    lat: float
    lon: float
    source: AutocompleteSource
    id: str


class AutocompleteResponse(BaseModel):
    suggestions: list[AutocompleteSuggestion]


# ---------------------------------------------------------------------------
# /explore
# ---------------------------------------------------------------------------


PlaceSource = Literal[
    "osm",
    "cpl_locations",
    "farmers_markets_2013",
    "cps_schools",
    "cpd_stations",
    "cfd_stations",
    "cdp_divvy",
    "cdp_landmarks",
]


class ExplorePlace(BaseModel):
    """One pin in the /explore response. ``subcategory`` and ``address`` are
    optional — many OSM POIs land without an address tag, and most
    categories don't define subcategories.
    """

    category: str
    subcategory: str | None = None
    name: str
    lat: float
    lon: float
    address: str | None = None
    source: PlaceSource


class ExploreStats(BaseModel):
    node_count: int = Field(..., description="Reachable street-graph vertex count.")
    area_sq_mi: float = Field(..., description="Concave-hull polygon area, square miles.")


class ExploreResponse(BaseModel):
    """Walkable-isochrone response. Heatmap fields are ``null`` when either
    (a) the caller's ``with_heatmaps`` filter excluded the layer or (b) no
    geometry overlapped the isochrone (e.g., tight Loop budgets with no
    residential land in range).
    """

    origin_coords: Coord
    max_minutes: int
    polygon: dict[str, Any] = Field(..., description="GeoJSON Polygon of the isochrone.")
    reachable_neighborhoods: list[str]
    stats: ExploreStats
    places: list[ExplorePlace]
    residential_heatmap: dict[str, Any] | None = Field(
        default=None,
        description="GeoJSON MultiPolygon of `landuse=residential` overlap, or null.",
    )
    tree_canopy_heatmap: dict[str, Any] | None = Field(
        default=None,
        description="GeoJSON FeatureCollection of up to 3 NLCD density bands, or null.",
    )
    parks_heatmap: dict[str, Any] | None = Field(
        default=None,
        description="GeoJSON FeatureCollection of clipped CPD park footprints, or null.",
    )
    green_space_heatmap: dict[str, Any] | None = Field(
        default=None,
        description="GeoJSON FeatureCollection of clipped non-CPD green space, or null.",
    )


# ---------------------------------------------------------------------------
# /route
# ---------------------------------------------------------------------------


# All currently-emitted flavor labels. The backend emits one of:
#   - "fastest" / "fewest_turns" / "greenest" — the three alternatives for
#     a 2-stop route with no custom routing prefs.
#   - "fastest" — multi-stop (3+) routes always use fastest.
#   - "custom" — collapsed flavor for any 2-stop or multi-stop route that
#     sets `avoid_stairs` or `prefer_pedestrian`.
Flavor = Literal["fastest", "fewest_turns", "greenest", "custom"]
PaceLabel = Literal["leisurely", "normal", "brisk"]
BlockType = Literal["short", "medium", "long"]


class DirectionStep(BaseModel):
    """One turn-by-turn instruction. ``leg_index`` appears only on multi-stop
    routes so the frontend can group steps under their leg headers.
    """

    street: str
    path_type: str = Field(..., description="OSM `highway` tag of the segment.")
    direction: str = Field(..., description="Cardinal abbreviation: N/S/E/W/NE/...")
    direction_full: str = Field(..., description="Cardinal spelled out: North/South/...")
    blocks: float
    block_type: BlockType
    minutes: float
    distance_meters: float
    distance_miles: float
    steps: int
    leg_index: int | None = Field(
        default=None,
        description="0-based leg index. Present only on multi-stop routes.",
    )


class LegStats(BaseModel):
    """Per-leg summary for multi-stop routes. ``path_slice`` is a
    ``[start, end]`` index range into the response's stitched ``path``
    such that ``path[start:end+1]`` recovers the leg's geometry. Adjacent
    legs share the seam index by design.
    """

    from_label: str
    to_label: str
    miles: float
    minutes: float
    steps: int
    calories_approx: int
    path_slice: list[int] = Field(..., min_length=2, max_length=2)


class RouteAlternative(BaseModel):
    """One route flavor's payload. For a 2-stop route, the response carries
    one entry per available flavor; for multi-stop, exactly one entry
    (fastest or custom) with ``legs`` populated.
    """

    flavor: Flavor
    path: list[Coord]
    directions: list[DirectionStep]
    total_miles: float
    total_minutes: float
    total_steps: int
    calories_approx: int
    daily_goal_pct: int
    legs: list[LegStats] | None = Field(
        default=None,
        description="Per-leg breakdown. Present only on multi-stop routes.",
    )


class RouteResponse(BaseModel):
    """Full /route response. The top-level ``total_*``, ``path``, and
    ``directions`` mirror the route flagged by ``default_flavor`` — older
    clients that ignore the ``routes`` array keep working.

    Invariant: ``default_flavor`` is always present in
    ``{r.flavor for r in routes}``. The /route handler asserts this before
    returning; if the invariant ever fires in production a fix should
    re-derive ``default_flavor`` from the actual routes list rather than
    weakening the model. See finding C-08 in resolved-history TD-052.
    """

    stops: list[str]
    stop_coords: list[Coord]
    origin_coords: Coord
    dest_coords: Coord
    step_length_inches: float = Field(
        ...,
        description=(
            "Personalized stride length in inches (default 30). "
            "Informational — not currently consumed by the UI."
        ),
    )
    personalized: bool = Field(
        ..., description="True when the caller supplied `height_inches`."
    )
    personalized_calories: bool = Field(
        ...,
        description=(
            "True when the caller supplied `weight_kg`. Informational — "
            "not currently consumed by the UI."
        ),
    )
    pace: PaceLabel
    default_flavor: Flavor
    available_flavors: list[Flavor]
    routes: list[RouteAlternative]

    # Top-level mirrors of the default route (legacy clients ignore `routes`).
    total_miles: float
    total_minutes: float
    total_steps: int
    calories_approx: int
    daily_goal_pct: int
    path: list[Coord]
    directions: list[DirectionStep]

    # Multi-stop only — mirrors `routes[0].legs`. None on 2-stop routes.
    legs: list[LegStats] | None = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def assert_default_flavor_in_routes(default_flavor: str, routes: list[dict]) -> None:
    """Defensive check for the C-08 contract — ``default_flavor`` must
    correspond to an actual entry in ``routes``. The /route handler picks
    ``default`` by filtering ``routes`` for ``DEFAULT_FLAVOR`` with a
    ``routes[0]`` fallback, so the invariant holds by construction; this
    function makes it explicit so a future refactor can't silently break
    it. The frontend's fallback (``routes.find(r => r.flavor === default_flavor) ?? routes[0]``)
    masks the bug if it ever ships.

    Kept here so both the /route handler and any future test of the same
    invariant call the same code path.
    """
    flavors = [r["flavor"] for r in routes]
    if default_flavor not in flavors:
        raise AssertionError(
            f"default_flavor {default_flavor!r} not in routes flavors {flavors!r}"
        )
