# Feature Plans & Future Enhancements

Chunked plans for upcoming major features, followed by ideas deferred until post-launch. For chunked features, work through each chunk in order, one chunk per session or per commit. Do not start a chunk until all previous chunks are complete.

> **Process:** When a feature here is fully implemented, **delete its entry from this file** and add a corresponding entry to [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md) summarizing what was built. This file should only ever contain features that have not yet been implemented.

---

## Feature Index

**Bolt-On** = self-contained, no dependencies on other planned features.
**Structural** = depends on one or more other features before it can be fully built or realized.

**Chunked Implementation Plans** (in document order):

| # | Feature | Type | Effort |
|---|---------|------|--------|
| 1 | Neighborhood Explorer (Isochrone) | Structural | High |
| 2 | Multi-City Support | Structural | Very High |

**Bolt-On Backend Fixes:** all shipped 2026-05-05 — see `FEATURE_HISTORY.md`.

---

# Chunked Implementation Plans

---

## 1. Neighborhood Explorer (Isochrone)
**Type:** Structural | **Effort:** High | **Area:** Backend + Frontend

Given a start location and a time budget, render the polygon of everywhere reachable on foot within that budget ("isochrone" = equal-time contour) and surface curated places of interest inside it. Answers "what's around me on foot in 20 minutes?" rather than "how do I get to a known destination?"

### Start-point modes

The user picks one of two origins:

1. **Current location** — request the browser's `navigator.geolocation`. If permission is denied or coordinates fall outside the Chicago coverage area, fall back to mode 2.
2. **Community area** — dropdown of Chicago's 77 community areas. Selection uses each area's central point (centroid) as the origin. A new `backend/community_areas.py` constant maps `community_area_name → (lat, lon)`, sourced from the City of Chicago Community Areas open-data shapefile (compute centroids once at build time; check the resulting JSON into the repo).

### Algorithm

Dijkstra's on the existing igraph from the snapped origin node, bounded by a distance budget in meters derived from `max_minutes` and the project's `WALKING_SPEED_MPH` constant in [backend/utils.py](backend/utils.py): `meters = max_minutes / 60 × WALKING_SPEED_MPH × 1609.34`. All nodes within budget form the "reachable set." This is one igraph call (`shortest_paths` or a custom bounded BFS) — fast even for 50k+ nodes.

### Polygon construction

Alpha-shape (concave hull) of reachable node coordinates, **not** convex hull — convex hulls swallow unreachable lakes/parks and look wrong over Lake Michigan. Use `shapely.concave_hull` (Shapely ≥ 2.0) or the `alphashape` package.

### Place categories

Filterable points of interest inside the polygon, organized into five top-level groups. The UI presents the groups as collapsible sections with checkboxes; sub-categories nest under their parent. Default state: all groups collapsed, nothing selected, polygon-only view. Selecting a group toggles all its children; sub-categories can be toggled individually.

**Data sourcing rule:** OSM is the default source. City open-data feeds and other curated sources are used **intentionally per category, not automatically**, where they materially improve quality over OSM. Each category below names its source.

| Group | Category | Sub-categories | Source |
|-------|----------|----------------|--------|
| **Daily life** | Grocery Stores | Farmers Markets | OSM (`shop=supermarket`, `shop=greengrocer`); Farmers Markets curated from the City of Chicago seasonal Farmers Markets dataset (refresh annually) |
| | Medical | Pharmacies, Urgent Care, Hospitals | OSM (`amenity=pharmacy`, `amenity=clinic`, `amenity=hospital`) |
| | Chicago Public Libraries | — | Curated from the Chicago Data Portal "Libraries - Locations, Hours and Contact Information" dataset; **not** OSM-derived |
| | Train Stations | — | OSM only (`railway=station` filtered by the `operator=*` tag to entries naming CTA or Metra). This is a static OSM tag filter applied at ingestion time — **not** a runtime call to any CTA or Metra API, and introduces no GTFS or transit-graph dependency, consistent with the project's "no transit data" rule in `CLAUDE.md`. |
| | Gyms & Fitness Studios | — | OSM (`leisure=fitness_centre`, `leisure=sports_centre`) |
| **Food & drink** | Coffee Shops / Bakeries | — | OSM (`amenity=cafe`, `shop=bakery`) |
| | Restaurants | — | OSM (`amenity=restaurant`, `amenity=fast_food`) |
| | Bars & Nightlife | — | OSM (`amenity=bar`, `amenity=pub`, `amenity=nightclub`) — framed in the UI as "places to drink within walking distance home" to reinforce the project's walk-instead-of-drive mission |
| **Outdoors** | Public Parks | Dog Parks / Off-leash areas, Playgrounds | OSM (`leisure=park`, `leisure=dog_park`, `leisure=playground`) |
| **Culture** | Public Art / Museums | — | OSM (`tourism=museum`, `tourism=artwork`) |
| | Theaters | Movie Theaters, Live Theater | OSM (`amenity=cinema` for movie; `amenity=theatre` for live) |
| | Bookstores | — | OSM (`shop=books`) |
| **Living** | Residential Area | — | OSM (`landuse=residential`, `building=apartments`, `building=residential`) rendered as a **heatmap-style fill**, not individual pins. *Future enhancement: integrate a real apartment-listings source (e.g., Zillow, Apartments.com, HotPads) to surface actual available units. Requires API access, licensing review, and likely a paid tier — defer until v2.* |
| | Schools / Universities | — | OSM (`amenity=school`, `amenity=university`, `amenity=college`) |
| | Places of Worship | Buddhism, Christianity, Hinduism, Islam, Judaism (alphabetical) | OSM (`amenity=place_of_worship` with `religion=*` tag for sub-category filtering) |

**Sub-category UX:** when a parent has sub-categories, checking the parent selects all children. Children can be unchecked individually. Places of Worship sub-categories must be displayed in alphabetical order.

**Place rendering:** each selected category gets a distinct icon and color; pins clustered at low zoom, expanded at high zoom. Residential Area is the only category rendered as a heatmap fill rather than pins.

### Neighborhood labeling

For each `(name, (lat, lon))` in `NEIGHBORHOOD_COORDS`, point-in-polygon test against the hull; emit names that pass. Display as clickable chips below the slider.

### Chunks

1. **Backend core.** New module `backend/explore.py` exposing `explore(lat, lon, max_minutes) → { polygon: GeoJSON, reachable_neighborhoods: list[str], stats: { node_count, area_sq_mi } }`. Add `shapely>=2.0` to `requirements.txt`.
2. **Community area centroids.** Build `backend/community_areas.py` with the 77-entry centroid table from the City of Chicago Community Areas dataset. One-time generation script under `backend/scripts/build_community_area_centroids.py` (checked in but not run at boot).
3. **API endpoint.** `POST /explore` in [backend/main.py](backend/main.py) with request `{ origin: { community_area: str } | { lat: float, lon: float }, max_minutes: float (5–45), categories?: list[str], height_inches?: float }`. The two origin shapes correspond directly to the two start-point modes above. Cache responses in-memory via `lru_cache(maxsize=128)` keyed on `(snapped_origin_node_id, round(max_minutes))`. The polygon is independent of `categories` — only the place-list portion of the response varies — so cache the polygon separately from the place lookups.
4. **Performance check.** A 30-minute isochrone in Chicago should hit ≤ 80k nodes; add a `pytest` benchmark that must complete under 500 ms on the prod graph (polygon only; place lookups are additive). Also benchmark the slider's worst case — a 45-minute isochrone — and budget ≤ 1.5 s for it, since reachable-node count grows roughly with time².
5. **Place-data ingestion — OSM categories.** New module `backend/places.py`. Build a one-time ingestion script that pulls the OSM-sourced categories above via Overpass API for the Chicago bbox and writes them to `backend/data/places_osm.json` (checked into the repo; refresh quarterly). At request time, filter by polygon containment using a prebuilt R-tree index.
6. **Place-data ingestion — curated city feeds.** Separate ingestion scripts for each non-OSM source: `build_libraries.py` (Chicago Data Portal CPL dataset), `build_farmers_markets.py` (city seasonal feed). Output to `backend/data/places_curated.json`. Document the source URL and refresh cadence inside each script.
7. **Endpoint integration.** `/explore` resolves the requested `categories` against the merged OSM + curated dataset, returning `{ category, sub_category?, name, lat, lon, address?, source }` records, plus the residential heatmap as a separate GeoJSON `MultiPolygon`.
8. **Frontend — mode toggle.** New "Explore from here" mode. Replaces the To input with: (a) origin selector — radio between "📍 My location" and a "🏘️ Community area" dropdown of all 77 areas; (b) time-budget slider (5–45 min). Polygon rendered as a `fill` layer with `paint: { "fill-color": "#2d7a3e", "fill-opacity": 0.18 }`; stroke matches the path green.
9. **Frontend — category panel.** Collapsible group panels (Daily life, Food & drink, Outdoors, Culture, Living) with nested checkboxes per the table above. Selection state persists in `localStorage` so a returning user keeps their filter set. "Select all" / "Clear all" affordances at the panel level.
10. **Frontend — place rendering.** Symbol layers per category with distinct icons + colors; cluster at zoom < 14, expand at zoom ≥ 14. Residential Area renders as a separate heatmap layer above the polygon fill but below place pins. Clicking a pin opens a popover with name, address, and a "Walk here" button that exits explore mode and triggers a route fetch to that point.
11. **Frontend — neighborhood chips.** Reachable-neighborhood chips below the slider; clicking a chip exits explore mode, populates To, and triggers a normal route fetch.
12. **Edge cases.** Origin not snappable → 422; polygon area < 0.05 sq mi → "no walkable area" message (likely user picked a parking lot or unreachable point); polygon spans Lake Michigan → clip against a Chicago shoreline polygon if available, otherwise accept the visual artifact for v1 and document it; geolocation permission denied → fall back to community-area selector with an inline notice; community area centroid falls in a non-walkable spot (e.g., centroid of an irregular area lands on a highway median) → snap to nearest graph node within 200 m or return 422.

---

## 2. Multi-City Support
**Type:** Structural | **Effort:** Very High | **Area:** Backend + Frontend
**Depends on:** FEAT #1 (Neighborhood Explorer) should ship first, since this rewrite must adapt the explorer's community-area dropdown into a generic per-city "area division" abstraction (see Area-division model below).

CLAUDE.md flags this as the long-term goal ("one city per game piece" — meaning **modular swappable units**, not literal gamification). Each city has its own pre-built street graph and its own geocoding/neighborhood data; the user picks a city and all routing runs against that city's graph.

### Launch city set

**v1 ships with two cities only:** Chicago and Evanston, IL. Evanston is the smallest-viable second city: contiguous with Chicago's existing bbox tooling, small graph (fast to build), and validates the cross-city routing case below.

**Future cities (explicitly out of v1 scope, but the registry, schema, and UI must be designed to accept them with no architectural changes):** Madison WI, Milwaukee WI, New York City NY, Portland OR, Seattle WA. Document this list in `backend/cities.py` as a commented `FUTURE_CITIES` constant so the next contributor knows the target set.

### Critical refactor: registry, not singletons

Today, [backend/walking.py](backend/walking.py) loads a single graph at import time, and [backend/geocoding.py](backend/geocoding.py) hardcodes Chicago `NEIGHBORHOOD_COORDS`. Both must become per-city. The refactor introduces a `City` registry and threads a `city: str` slug through every public backend function that touches the graph or geocoder.

**Backwards compatibility:** existing API calls without a `city` field continue to work and resolve to `"chicago"` for the entire v1 lifetime. This is a permanent default, not a transition shim — never remove it.

### Area-division model (replaces Chicago-specific "community areas")

Each city defines its own scheme for dividing itself into named parts. Chicago uses its 77 community areas; Evanston uses its 9 wards; future cities will use boroughs (NYC), neighborhoods (Portland/Seattle/Madison), aldermanic districts (Milwaukee), etc. Onboarding a new city requires picking the right scheme for that city.

The `City` dataclass exposes this via:
```
area_division: { scheme_name: str, areas: list[{ name, centroid: (lat, lon), polygon?: GeoJSON }] }
```
`scheme_name` is shown to the user as the dropdown label (e.g., "Community Area," "Ward," "Borough," "Neighborhood"). The dropdown in FEAT #1's explorer pulls from `area_division.areas` for the active city instead of hardcoding Chicago's 77 community areas.

### Neighborhood/landmark data per city

Combination of hand-curated and OSM auto-derived per city:

- **Hand-curated** entries (the equivalent of Chicago's existing `NEIGHBORHOOD_COORDS`) capture famous landmarks and informally-known names that may not exist as OSM `place=neighbourhood` nodes — e.g., "Wrigleyville," "The Loop," "Times Square," "Pike Place." These are checked into the repo per city.
- **OSM-derived** entries fill in the long tail by pulling `place=neighbourhood` and `place=suburb` nodes from the OSM Overpass API for each city's bbox. Generated by a one-time ingestion script per city (`backend/scripts/build_neighborhood_coords_{slug}.py`); output checked into the repo.
- **Merge rule:** hand-curated entries always win on name conflicts. Result is stored as a single `neighborhood_coords_{slug}.json` per city.

### Cross-city routing (adjacent cities only)

Multi-stop routes **may** span cities, but only when both cities share a contiguous street graph at their shared border. v1 supports exactly one such pair: Chicago ↔ Evanston (their street networks connect at Howard St / the city line). Chicago ↔ NYC is invalid; Chicago ↔ Madison would also be invalid.

The `City` registry declares adjacency explicitly:
```
adjacent_cities: list[str]   # e.g., chicago.adjacent_cities == ["evanston"]
```
This is **manually curated**, not computed — do not try to infer adjacency from graph proximity.

**Routing implementation for cross-city legs:** at request time, if the stops in a multi-stop route span two adjacent cities, the backend loads both city graphs, joins them in-memory at their shared border nodes (precomputed once per adjacent pair and cached as `border_joins_{a}_{b}.json`), and routes against the combined graph. If the stops span two **non-adjacent** cities, return HTTP 422 with `{ "error": "stops_span_non_adjacent_cities", "cities": ["chicago", "newyork"] }`.

### Out-of-bbox handling — switch prompt

When the user's currently-active city is e.g. Chicago and they enter / click an address that resolves outside Chicago's bbox but inside Evanston's, the backend returns HTTP 409 with `{ "error": "point_in_other_city", "suggested_city": "evanston", "label": "..." }`. The frontend catches this and shows an inline modal: "This address is in Evanston. Switch to Evanston?" with Switch / Cancel. Switch swaps the active city and re-submits the request; Cancel leaves the form unchanged.

If the resolved point isn't in **any** supported city, return HTTP 422 with the existing "outside coverage area" error (no change from today).

### City selection UX

- **First load (no `city` in localStorage):** the frontend requests `navigator.geolocation`. If permission granted and coords fall inside one of the supported cities' bboxes, set that city as active and persist to localStorage. If permission denied, geolocation unavailable, or coords don't match any supported city, show a one-time "Pick your city" modal with the manual dropdown.
- **Subsequent loads:** read `city` from localStorage; no geolocation prompt.
- **Header pill:** the static "📍 Chicago, IL" pill in [frontend/src/App.jsx](frontend/src/App.jsx) becomes a clickable dropdown sourced from `GET /cities`. Each entry shows display name and a small icon. Selecting a different city: recenters the map to that city's `default_center` / `default_zoom`, clears the current route, swaps the visible recents list (see below), and resets any FEAT #1 area-division dropdown.

### Recent searches scope

- **Visibility:** the recents list shows only entries belonging to the **currently active city.** Switching cities swaps which list is visible. Recents are stored as `recents_{slug}` keys in localStorage (one list per city) — never one flat list.
- **Lifecycle when a city is dropped from the registry:** delete that city's `recents_{slug}` localStorage entry on the next page load. Do not preserve.

### Geocoding API key

For v1, all cities share the same `GOOGLE_MAPS_API_KEY` from `backend/.env` (matching today's behavior). The `City` dataclass must expose an optional `geocoding_api_key_env_var: str | None = None` field so a future city can override the env var name it reads from (e.g., `GOOGLE_MAPS_API_KEY_NYC`). When `None`, fall back to the global `GOOGLE_MAPS_API_KEY`. **Do not** hardwire `os.getenv("GOOGLE_MAPS_API_KEY")` anywhere in `geocoding.py` — go through this resolver from day one.

Geocode cache file is per-city: `backend/geocode_cache_{slug}.json`.

### Route flavors

Every v1 city supports all three flavors (`fastest`, `fewest_turns`, `greenest`). The launch and future-target cities are all large enough that footway data exists; no per-city flavor capability flag needed yet. If a future smaller city is added and lacks footways, add a `supported_flavors: list[str]` field to `City` at that time.

### Chunks

1. **`City` dataclass + registry.** New `backend/cities.py` defining `City` (`{ slug, display_name, state, graph_path, neighborhood_coords_path, bbox, default_center, default_zoom, area_division, adjacent_cities, geocoding_api_key_env_var }`) and a `CITIES: dict[str, City]` registry with Chicago + Evanston entries plus a commented `FUTURE_CITIES` list (Madison WI, Milwaukee WI, NYC, Portland OR, Seattle WA). Helper `get_city(slug) -> City` raises `UnknownCityError` for unknown slugs.
2. **Walking module refactor.** Convert `walking._GRAPH` into `walking._GRAPHS: dict[str, Graph]` lazily-loaded per city. Every public function (`route`, `_compute_route`, `_snap_to_node`, etc.) takes `city: str` as the first positional argument. `_compute_route`'s LRU cache key includes the city slug. Update all callers.
3. **Geocoding module refactor.** `resolve_location(query, city)` accepts a city slug. Per-city `NEIGHBORHOOD_COORDS` loaded from `neighborhood_coords_{slug}.json`. Per-city geocode cache file. Google Maps key resolution goes through the `City.geocoding_api_key_env_var` indirection from chunk 1.
4. **Evanston street graph.** Run the existing `fetch_street_graph.py` (or equivalent) pipeline against Evanston's bbox. Upload the resulting `.pkl` as a release asset under the existing `street-graph` tag, named `street_graph_igraph_evanston.pkl`. Update `Dockerfile` (and the boot fallback in [backend/walking.py](backend/walking.py)) to fetch all graphs declared in `cities.py`, not just Chicago. Fail-fast logic from commit `b47ab45` must apply to every city's graph.
5. **Evanston neighborhood data.** Hand-curate ~15–25 well-known Evanston landmarks (Northwestern campus, Dempster Beach, downtown Evanston, etc.) into `neighborhood_coords_evanston_curated.json`. Run `build_neighborhood_coords_evanston.py` to pull OSM `place=neighbourhood`/`place=suburb` for the Evanston bbox. Merge per the rule above into `neighborhood_coords_evanston.json`. Define Evanston's `area_division` as `{ scheme_name: "Ward", areas: [...9 wards with centroids...] }` from City of Evanston open data.
6. **Border join precomputation.** New script `backend/scripts/build_border_joins.py` that, for each adjacent-city pair declared in the registry, finds graph nodes on either side within ~30 m of each other along the shared border and emits the join edges to `border_joins_chicago_evanston.json` (and one file per future pair). Checked into the repo. Document refresh cadence: regenerate whenever either city's graph is rebuilt.
7. **Cross-city routing.** New helper in `walking.py`: `route_multi_city(stops_with_cities, ...)` that detects when stops span two adjacent cities, loads both graphs, splices in the precomputed border joins, and routes against the combined graph. Non-adjacent spans → 422 as specified above. Update `_compute_route`'s cache key to include the sorted tuple of involved city slugs.
8. **API surface.** Add optional `city: str = "chicago"` to `RouteRequest` and the `/explore` request schema (defaults preserve current behavior). Add `GET /cities` returning `[{ slug, display_name, state, default_center, default_zoom, area_division: { scheme_name, area_count }, adjacent_cities }]`. Out-of-bbox detection in `/route` and `/reverse-geocode` returns the new HTTP 409 `point_in_other_city` shape described above.
9. **Frontend — city dropdown header.** Replace the static "📍 Chicago, IL" pill in [frontend/src/App.jsx](frontend/src/App.jsx) with a dropdown sourced from `GET /cities`. Persist selection to `localStorage` under key `active_city`. On change: recenter the map (`MapView.jsx`), clear the current route, swap recents visibility (next chunk), reset the FEAT #1 area-division dropdown.
10. **Frontend — first-load city detection.** On page load, if `localStorage.active_city` is unset: request `navigator.geolocation`, point-in-bbox-test against `GET /cities` results, set the matching city. On no permission / no match, show a "Pick your city" modal with the same dropdown from chunk 9. Modal is dismissible and only shown once per browser (track with a `city_picker_shown` localStorage flag).
11. **Frontend — out-of-bbox switch prompt.** Catch HTTP 409 `point_in_other_city` from `/route` and `/reverse-geocode`. Show a modal: "This address is in {suggested_city}. Switch to {suggested_city}?" with Switch / Cancel buttons. Switch swaps the active city and re-submits the original request; Cancel restores the previous form state.
12. **Frontend — per-city recents.** Refactor the recents list in `App.jsx` to read/write `localStorage.recents_{slug}`. On city change, swap the visible list (no merge across cities). On first load after a city has been removed from the `GET /cities` response, delete its `recents_{slug}` key.
13. **FEAT #1 integration.** Update the explorer's area-division dropdown to source from the active city's `area_division.areas` and label itself with `area_division.scheme_name`. The community-area centroid file built in FEAT #1 chunk 2 must be generalized into per-city centroid files (Chicago: 77 community areas, Evanston: 9 wards).
14. **Tests.** Parametrize key backend tests across both cities (`pytest.mark.parametrize("city", ["chicago", "evanston"])`) — `/route`, `/reverse-geocode`, `/explore`, geocoder fuzzy match. Add a dedicated test for the cross-city routing case (Chicago→Evanston multi-stop succeeds; Chicago→NYC-equivalent simulated city pair returns 422). Frontend integration tests: city dropdown swap recenters the map; out-of-bbox 409 triggers the switch modal; recents are per-city.
15. **Edge cases.**
    - Cross-city route where one stop is within the bbox of *both* an adjacent city pair (border addresses): assign to whichever city's bbox contains the *snapped graph node*, not the input coords.
    - User has Evanston active but their localStorage `recents_evanston` references a landmark that's been removed from Evanston's neighborhood data (e.g., we cleaned up a typo): silently drop unmatched entries on load, do not error.
    - Geolocation returns coords inside an adjacent-city pair's overlap zone (rare — Chicago/Evanston border): pick whichever city's `default_center` is closer.
    - `GET /cities` is called before any graph has finished loading: respond from the static `cities.py` registry — do not block on graph load.
    - A new city is added between deploys (registry has it, `localStorage.active_city` is still set to an old city the user previously chose): keep the user's existing choice; the new city only appears in the dropdown.

