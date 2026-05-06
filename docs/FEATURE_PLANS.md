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

**Bolt-On Features** (in document order):

_None pending._

**Earlier bolt-on backend fixes & mobile polish:** see `FEATURE_HISTORY.md`.

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

1. **Backend core.** ✅ *Complete (2026-05-05).* `backend/explore.py` exposes `explore(lat, lon, max_minutes)` returning `{ polygon: GeoJSON, reachable_neighborhoods: list[str], stats: { node_count, area_sq_mi } }`. Bounded single-source Dijkstra via igraph against the existing pedestrian graph; concave-hull polygon via `shapely.concave_hull` (ratio 0.4) with convex-hull fallback; neighborhood labels via point-in-polygon over `NEIGHBORHOOD_COORDS`. LRU-cached on quantized inputs. `shapely>=2.0` was already in `requirements.txt`. Tests: `backend/tests/test_explore.py` (5 cases — polygon validity, monotonic growth with budget, neighborhood labels, negative-budget guard, cache behavior).
2. **Community area centroids.** ✅ *Complete (2026-05-06).* `backend/community_areas.py` ships the 77-entry `COMMUNITY_AREA_CENTROIDS` table plus `community_area_names()` and case-insensitive `lookup_centroid()` helpers. Centroids are *representative points* (shapely `.representative_point()`) so they're guaranteed to fall inside each polygon — important for irregular shapes like O'Hare. Generated by `backend/scripts/build_community_area_centroids.py` from the City of Chicago SODA endpoint (`igwz-8jzy`); the resulting JSON is checked in at `backend/data/community_area_centroids.json`. Two name overrides applied (`O'Hare`, `McKinley Park`) since the source data ships uppercased and stripped of punctuation. Tests: `backend/tests/test_community_areas.py` (7 cases — count, bbox containment, punctuation restoration, case-insensitive lookup, JSON↔module parity).
3. **API endpoint.** ✅ *Complete (2026-05-06).* `POST /explore` in [backend/main.py](backend/main.py) accepts `{ origin: { community_area } | { lat, lon }, max_minutes (5–45), categories?, height_inches? }`. `ExploreOrigin` Pydantic model enforces exactly-one-of and bbox containment for the lat/lon mode; lat/lon mode also gets snapped via the existing igraph KD-tree path (origins that can't snap return 422). Polygon caching is via `explore._explore_quantized` (`lru_cache(maxsize=128)` on quantized `(lat, lon, minutes)` — equivalent to `(snapped_node_id, minutes)` since the KD-tree snap is deterministic). `categories` and `height_inches` are accepted but unused for now; `places: []` ships in the response now so the frontend can be wired without a contract change when Chunks 5–7 land. Per-endpoint rate limit: `RATE_LIMIT_EXPLORE` (default `10/minute`). Tests: `backend/tests/test_explore_endpoint.py` (12 cases — validation, both origin modes, case-insensitive area lookup, forward-compat fields).
4. **Performance check.** ✅ *Complete (2026-05-06).* `backend/tests/test_explore_perf.py` enforces 500 ms (30-min) and 1.5 s (45-min) cold-compute budgets, plus a sanity ≤80k node-count guard. Each budget is the median of 3 runs from the Loop origin with the LRU cache cleared between runs; the graph and column caches are pre-warmed via a module-scoped fixture so graph deserialization isn't charged to the per-request budget. Measured on dev hardware (Python 3.14, Windows): 30-min ≈ 114 ms / 2,748 reachable nodes, 45-min ≈ 156 ms / 4,987 reachable nodes — both ~3–10× under budget. The reachable-set count came in much lower than the plan's ≤80k estimate because the bounded Dijkstra prunes aggressively at city scale; igraph's C-level `distances()` over the ~60k giant-component vertices dominates wall time, not the polygon construction.
5. **Place-data ingestion — OSM categories.** ✅ *Complete (2026-05-06).* `backend/scripts/build_places_osm.py` runs a single batched Overpass `nwr` query (27 tag filters, `out center tags`) against `STREET_GRAPH_BBOX` and writes `backend/data/places_osm.json`. Refresh cadence: quarterly. Initial run: 9,157 places across 22 (category, subcategory) pairs — restaurants 3,390, christianity-tagged places-of-worship 910, coffee/bakery 906, bars/nightlife 855, schools 651, parks 577, art/museums 432, gyms/fitness 390, grocery 221, medical 320, train stations 130, bookstores 50, etc. Two post-fetch filters in the script: train stations are restricted to operators containing "cta", "chicago transit", or "metra"; places of worship require a recognized `religion=*` tag (buddhist/christian/hindu/muslim/jewish → buddhism/christianity/hinduism/islam/judaism). Runtime loader `backend/places.py` lazily builds a `shapely.STRtree` on first use and exposes `places_in_polygon(polygon, categories) -> list[dict]`. Index is built once per process and reused; the polygon containment check uses the STRtree's bbox prune followed by an exact `polygon.contains(point)` test. Residential Area heatmap is intentionally NOT in this chunk — it's polygon data not points, and lands alongside its frontend rendering layer (Chunk 7 / 10). Tests: `backend/tests/test_places.py` (11 cases — bbox containment, category filter, unknown category, empty/out-of-bbox polygons, single-build idempotence, JSON metadata + required fields).
6. **Place-data ingestion — curated city feeds.** ✅ *Complete (2026-05-06).* Two independently-runnable scripts share `_curated_common.merge_and_write()`, which loads `backend/data/places_curated.json`, drops every entry tagged with the script's source key, and writes the merged result back — so the scripts can run in any order. `build_libraries.py` pulls 81 CPL branches from `data.cityofchicago.org/resource/x8fc-8rcq.json` (annual refresh; category `libraries`). `build_farmers_markets.py` pulls 24 entries from the 2013 dataset (`i8y3-ytj4`) under category `grocery` / subcategory `farmers_market` — the City stopped publishing yearly feeds with coordinates after 2013, so the script is structured so a future maintainer only has to swap `DATASET_URL` + the two `_extract_*` helpers when a fresher source surfaces. `places.py` now loads both files via `_load_all_sources()`; curated entries take precedence over an OSM entry at the same `(category, ~1m point)`. Tests: extended `tests/test_places.py` with 4 cases covering file presence, metadata sources, libraries-in-index, and farmers-markets-under-grocery — 42 total tests pass across the explorer surface.
7. **Endpoint integration.** ✅ *Complete (2026-05-06).* `/explore` now materializes the GeoJSON polygon back into a shapely geometry once and runs `places_in_polygon(geom, categories)` + `residential_heatmap(geom)` concurrently in the threadpool via `asyncio.gather`. Place records returned as `{category, subcategory, name, lat, lon, address, source}` — `source` is `"osm"` for OSM-derived entries and the curated source key (e.g., `"cpl_locations"`, `"farmers_markets_2013"`) otherwise. Residential heatmap is built by a new `build_residential.py` script that pulls `landuse=residential` ways via Overpass (1,910 polygons, 612 KB JSON checked in at `data/residential_polygons.json`); the request-time clipper intersects each candidate with the isochrone via STRtree bbox prune, then unions survivors into a GeoJSON `MultiPolygon` (`null` when no residential land overlaps the polygon). Schema departure from the original plan: response field is `subcategory` not `sub_category` to stay consistent with how the data is tagged everywhere else in the project. Tests: `test_explore_endpoint.py` extended with 4 new cases (category filter, unknown category empty, no-categories returns-all, residential heatmap present); 45 total explorer tests pass with the 30/45-min perf budgets still green.
8. **Frontend — mode toggle.** ✅ *Complete (2026-05-06).* Two-button segmented control (`Route` ⇄ `Explore`) sits at the top of the side panel on desktop and at the top of the mobile sheet body. Mode persists in `localStorage` via `lib/explorePrefs.js` (key `walkpath:mode`); a shared route URL (`?stops=…` or `?from=…&to=…`) overrides persisted state at boot so link recipients see the route the sender intended. New `ExploreForm` component (`components/ExploreForm.jsx`) renders the origin selector — two big tappable cards toggling between "📍 My location" (uses the existing `resolveCurrentLocation` helper) and "🏘️ Community area" (native `<select>` over the 77 names from `lib/communityAreas.js`) — plus a time-budget slider (5–45 min, native `<input type="range">` restyled with an ink thumb, `touch-action: none` to prevent the bottom-sheet body-drag heuristic from hijacking thumb gestures). Map polygon rendered via new `renderExplore()` in `mapHelpers.js`: `explore-poly-fill` (`#1f6d3b @ 0.18` — Wayfarer's `--field` token, pulling the ink-on-cream voice toward "all clear" rather than the plan's stock green) + `explore-poly-stroke` (`#171310 @ 2 px`). Schema departure from the plan: the green is `--field` not the literal `#2d7a3e` from the spec, since `--field` already exists in tokens.css and reads cleanly in both Cream and Dusk themes.
9. **Frontend — category panel.** ✅ *Complete (2026-05-06).* `components/ExploreCategoryPanel.jsx` renders five collapsible groups (Daily life, Food & drink, Outdoors, Culture, Living) backed by the static catalog in `lib/exploreCategories.js`. Categories with `subs` show a nested list of subcategory checkboxes once the parent is checked; checking a sub auto-checks its parent so the request still includes that category. Group expansion state, parent selections, sub selections, and the residential-heatmap toggle all persist in `walkpath:explorePrefs`. "Select all" / "Clear all" affordances live in the panel header; the count badges next to each group reflect the live selection.
10. **Frontend — place rendering.** ✅ *Complete (2026-05-06).* MapLibre supercluster on the `explore-places` source (cluster radius 40, max-zoom 13) renders large dark cluster discs with point counts at low zoom; at zoom ≥ 14 the cluster pass yields to `explore-places-pin` (a single `circle` layer that paints every category via a `match` expression on `category`, keyed off the catalog's `color` field) plus `explore-places-glyph` (a one-letter symbol over the pin, also expression-driven so the whole feature collection shares one symbol layer). Residential heatmap is a separate `fill` layer (`#9c2a1a @ 0.18` — `--ember`) inserted *before* the polygon stroke so it lays under the outline but above the polygon fill, matching the spec's z-order. Pin click opens a `maplibregl.Popup` whose content is a React-rendered card (name, address, category/source kicker, "Walk here" CTA); the popup is anchored to the pin's `[lon, lat]`, so it stays glued to the pin during pan/zoom. Tapping "Walk here" tears the popup down, flips the app to route mode, sets stops to `[explorerOrigin, place.name]`, and fires a normal route fetch. On mobile, a place-tap also drops the bottom sheet to peek (programmatically, without poisoning the user-moved-sheet flag) so the popup isn't clipped under the sheet.
11. **Frontend — neighborhood chips.** ✅ *Complete (2026-05-06).* `ExploreForm` renders a "Within reach" rail of chips below the slider, populated from `exploreResult.reachable_neighborhoods`. Tapping a chip flips the app back to route mode, sets stops to `[explorerOrigin, neighborhoodName]`, and fires a route fetch — same path as "Walk here" from a place popover, so both interactions feel unified.
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

---

# Bolt-On Features

_No pending bolt-on features. See `FEATURE_HISTORY.md`._

