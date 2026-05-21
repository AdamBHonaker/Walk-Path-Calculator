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
| 1 | Multi-City Support | Structural | High (was Very High before cross-city routing was deferred to a follow-on — see plan section) |
| 2 | Ship `chicago_boundary.json` as a release artifact (lakefront `/explore` clipping) | Bolt-On | Low |
| 3 | GCFD Food Banks & Pantries in the Neighborhood Explorer | Bolt-On | Medium |
| 4 | Beaches as a subcategory of Public Parks (Explorer) | Bolt-On | Low |
| 5 | Community Health Centers as a subcategory of Medical (Explorer) | Bolt-On | Low |
| 6 | Refresh Stale Farmers-Market Data (source TBD — investigation pending) | Bolt-On | Low–Medium |

**Unscoped notes** (need a scoping pass before they become chunked plans):

- Learned POI autocomplete — see "Unscoped notes" section at the bottom of this file.

**Earlier bolt-on backend fixes & mobile polish:** see `FEATURE_HISTORY.md`. The Local-First Geocoding + LocationIQ Fallback feature shipped 2026-05-12 (chunks 1–5 code-complete; chunk 6 docs + cleanup landed alongside) and its entry now lives in [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md). Real-device mobile sign-off for the autocomplete component is tracked as the "Address autocomplete — Chunk 5 mobile sign-off checklist" in [`docs/MOBILE_TESTING.md`](docs/MOBILE_TESTING.md). The Tree Canopy Heatmap (formerly Feature 2) shipped 2026-05-14 — entry now in [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md), real-device sign-off tracked as PV-005 in [`Pending_Verification.md`](Pending_Verification.md). The Parks + Green-Space Heatmaps (formerly Feature 3) shipped 2026-05-14 — entry now in [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md), real-device sign-off tracked as PV-004 in [`Pending_Verification.md`](Pending_Verification.md). The Greenest Routing — Tree + Park Edge Weights feature (formerly Feature 4) shipped 2026-05-14 — entry now in [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md), real-deploy verification tracked as PV-006 in [`Pending_Verification.md`](Pending_Verification.md). The Chicago Landmark Designations feature (formerly Feature 6) shipped 2026-05-21 — entry now in [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md).

---

# Chunked Implementation Plans

---

## 1. Multi-City Support
**Type:** Structural | **Effort:** High | **Area:** Backend + Frontend
**Depends on:** the Neighborhood Explorer (shipped 2026-05-11; see [FEATURE_HISTORY.md](FEATURE_HISTORY.md)). Chunk 15 below generalizes the Explorer's area-division dropdown and centroid file, and is cleanest against the settled surface those changes left behind.

**Prerequisites — hard blockers for the whole project, not just chunk 1.** Every open Pending_Verification item touched by recent feature work must be cleared before any chunk of this plan starts, because each one bakes a Chicago-specific signal into a graph or data artifact that multi-city will then duplicate per city. PV-001 (autocomplete mobile sign-off), PV-002 (LocationIQ cascade live behavior), PV-004 (parks + green-space mobile sign-off), PV-005 (tree-canopy mobile sign-off), PV-006 (greenest-routing deploy verification) must all sign off in [docs/Pending_Verification.md](Pending_Verification.md) first. Without this, multi-city forks Chicago bugs across N cities before they're caught.

CLAUDE.md flags this as the long-term goal ("one city per game piece" — meaning **modular swappable units**, not literal gamification). Each city has its own pre-built street graph and its own geocoding/neighborhood data; the user picks a city and all routing runs against that city's graph.

### Launch city set

**v1 ships with two cities only:** Chicago and Evanston, IL. Evanston is the smallest-viable second city: contiguous with Chicago's existing bbox tooling, small graph (fast to build), and validates the cross-city routing case below.

**Future cities (explicitly out of v1 scope, but the registry, schema, and UI must be designed to accept them with no architectural changes):** Madison WI, Milwaukee WI, New York City NY, Portland OR, Seattle WA. Document this list in `backend/cities.py` as a commented `FUTURE_CITIES` constant so the next contributor knows the target set.

### Critical refactor: registry, not singletons

Today, [backend/walking.py](backend/walking.py) loads a single graph lazily on first request and caches it in a module-level `_graph_cache`, and [backend/geocoding.py](backend/geocoding.py) hardcodes Chicago `NEIGHBORHOOD_COORDS`. Both must become per-city. The refactor introduces a `City` registry and threads a `city: str` slug through every public backend function that touches the graph or geocoder.

**Backwards compatibility:** existing API calls without a `city` field continue to work and resolve to `"chicago"` for the entire v1 lifetime. This is a permanent default, not a transition shim — never remove it.

### Area-division model (replaces Chicago-specific "community areas")

Each city defines its own scheme for dividing itself into named parts. Chicago uses its 77 community areas; Evanston uses its 9 wards; future cities will use boroughs (NYC), neighborhoods (Portland/Seattle/Madison), aldermanic districts (Milwaukee), etc. Onboarding a new city requires picking the right scheme for that city.

The `City` dataclass exposes this via:
```
area_division: { scheme_name: str, areas: list[{ name, centroid: (lat, lon), polygon?: GeoJSON }] }
```
`scheme_name` is shown to the user as the dropdown label (e.g., "Community Area," "Ward," "Borough," "Neighborhood"). The Explorer's existing community-area dropdown pulls from `area_division.areas` for the active city instead of hardcoding Chicago's 77 community areas.

### Neighborhood/landmark data per city

Combination of hand-curated and OSM auto-derived per city:

- **Hand-curated** entries (the equivalent of Chicago's existing `NEIGHBORHOOD_COORDS`) capture famous landmarks and informally-known names that may not exist as OSM `place=neighbourhood` nodes — e.g., "Wrigleyville," "The Loop," "Times Square," "Pike Place." These are checked into the repo per city.
- **OSM-derived** entries fill in the long tail by pulling `place=neighbourhood` and `place=suburb` nodes from the OSM Overpass API for each city's bbox. Generated by a one-time ingestion script per city (`backend/scripts/build_neighborhood_coords_{slug}.py`); output checked into the repo.
- **Merge rule:** hand-curated entries always win on name conflicts. Result is stored as a single `neighborhood_coords_{slug}.json` per city.

### Per-city data artifacts — availability matrix

Every spatial data artifact in `backend/data/` is potentially per-city, but some sources are Chicago-only (Chicago Data Portal feeds) and others are universal (OSM). Each city's set is **optional based on data availability** — runtime degrades gracefully rather than refusing to boot when a non-essential artifact is missing.

| Artifact | Source | Universal? | Behavior when missing for a city |
| -------- | ------ | ---------- | -------------------------------- |
| `street_graph_igraph_{slug}.pkl` | OSMnx | yes | required — no routing for that city |
| `neighborhood_coords_{slug}.json` | curated + Overpass | yes | required — geocoder degraded |
| `places_osm_{slug}.json` | Overpass | yes | required for `/explore` |
| `places_curated_{slug}.json` | per-city open data (CDP for Chicago) | **no — Chicago-only feeds** | `/explore` falls back to OSM-only |
| `residential_polygons_{slug}.json` | Overpass | yes | residential heatmap unavailable |
| `tree_canopy_kde_{slug}.json` | Overpass `natural=tree` | **dependent on OSM tagging density** | canopy heatmap unavailable; greenest's canopy term collapses to zero |
| `parks_polygons_{slug}.json` | CDP / open-data portal / OSM `leisure=park` fallback | **dependent on local open data** | parks heatmap unavailable; greenest's park-proximity term collapses to zero |
| `green_space_polygons_{slug}.json` | Overpass | yes | green-space heatmap unavailable |
| `{slug}_boundary.json` | open data per city | **dependent on availability** | Explorer skips boundary clip; waterfront origins may bleed |
| `{slug}_geocode.db` | per-city ingestion | yes | required — local-first tiers fall back to LocationIQ |

The bake step in `fetch_street_graph.py` always emits the canopy + parks edge columns (zero-filled when the underlying KDE / parks artifact is unavailable for that city). The pickle stays at `format_version: 3`; the relaxed fail-fast guard in chunk 2 checks for *column presence and correct shape* but no longer requires nonzero distributions. See "Route flavors" below for how greenest degrades per-city based on this matrix.

### Cross-city routing — deferred to a follow-on

**v1 decision (2026-05-15): cross-city routing is out of scope.** A single route does not span two cities in v1. Memory cost (two graphs resident at once on a Railway instance that's tight under Chicago alone — ~150–180 MB just for graphs, before the combined-graph splice doubles structures during routing), engineering complexity (border-joins precomputation, request-time splice, per-pair cache key, an LRU policy that must keep both cities resident during a cross-city request), and use-case thinness (a continuous walking journey across the Chicago/Evanston line — most people take the Red Line; a true walking trip is multi-day) do not pay off for v1. The 409 `point_in_other_city` switch prompt below covers the common case of "I typed an address that turned out to be in the other city" without any of the above.

A user who genuinely wants to walk Chicago↔Evanston as one logical journey plans it as two routes (one ending at the border, one starting). The `adjacent_cities` field stays in the `City` registry for v1, but is consumed only by the 409 prompt's "Switch to {suggested_city}?" UX — not by routing.

**Re-evaluate after v1 ships** with data on (a) how often users hit the 409 prompt with a stop in the adjacent city, (b) instance memory headroom with both city graphs warm under realistic traffic, and (c) whether any user has actually requested cross-city routing as a feature. If those three signals justify it, the design below is preserved as the implementation blueprint.

#### Future cross-city design (preserved, do not implement in v1)

When (and only when) cross-city routing graduates from deferred to in-scope, this is the resolved design. Every decision below is settled — no further scoping needed at that point, only execution.

- **Adjacency declaration.** `City.adjacent_cities: list[str]` in the registry. Manually curated, not computed — do not try to infer adjacency from graph proximity. Initial pair: `chicago.adjacent_cities == ["evanston"]`.
- **Routing rule.** Multi-stop routes may span two adjacent cities only. Non-adjacent spans (e.g., Chicago↔NYC) return HTTP 422 with `{ "error": "stops_span_non_adjacent_cities", "cities": ["chicago", "newyork"] }`.
- **Border joins.** Precomputed once per adjacent pair via `backend/scripts/build_border_joins.py`. Algorithm (resolved 2026-05-15): take the **rectangular bbox intersection** of the two cities' bboxes; find graph nodes from each side within ~30 m of each other across that rectangle; emit join edges to `border_joins_{a}_{b}.json` (one file per pair, checked into the repo). Refresh cadence: regenerate whenever either city's graph is rebuilt. Not OSM admin relations, not hand-drawn polylines.
- **Request-time routing.** New helper in `walking.py`: `route_multi_city(stops_with_cities, ...)` detects when stops span two adjacent cities, loads both graphs, splices in the precomputed border joins, and routes against the combined in-memory graph. `_compute_route`'s LRU cache key includes the sorted tuple of involved city slugs.
- **Per-stop city tagging (resolved 2026-05-15).** Cascade resolve per stop: active-city geocoder first, then iterate over each entry in the active city's `adjacent_cities` in registry order; the first city whose `forward()` resolves wins and tags the stop. No change to the request schema — back-compat with single-city requests preserved.
- **Border-stop disambiguation (resolved 2026-05-15).** A stop whose input coords fall inside the bbox of *both* an adjacent city pair: assign to whichever city contains the *snapped graph node*, not the raw coords.
- **Share-URL encoding (resolved 2026-05-15).** Single `&city={slug}` per shared URL, representing the city containing the *first stop* (same rule as recents bucketing — see chunk 14). Stop strings stay as-is. Recipient opens the link, sets active city to that slug; backend uses the per-stop cascade above to handle stops that fall in the adjacent city. Preserves URL back-compat (links without `city` resolve to `chicago`). Note: in v1 this collapses to "the active city at share time" since no route is cross-city.
- **Recents bucketing (resolved 2026-05-15).** Cross-city entries land in `walkpath:recents_{first_stop_city}` — predictable, keeps the entry visible while the user is in the city they started from, no new "crosscity" bucket needed.
- **Memory implications.** Both city graphs must be resident during a cross-city request. The chunk 2 eviction policy's "always keep the most-recently-active city resident" floor would need to widen to "keep all cities involved in any in-flight request" for the duration of that request. Re-measure Railway memory headroom before committing — this was the dominant reason for v1 deferral.

This design corresponds to chunks 6 + 7 in the chunk list below, which are marked `[DEFERRED]`.

### Out-of-bbox handling — switch prompt

When the user's currently-active city is e.g. Chicago and they enter / click an address that resolves outside Chicago's bbox but inside Evanston's, the backend returns HTTP 409 with `{ "error": "point_in_other_city", "suggested_city": "evanston", "label": "..." }`. The frontend catches this and shows an inline modal: "This address is in Evanston. Switch to Evanston?" with Switch / Cancel. Switch swaps the active city and re-submits the request; Cancel leaves the form unchanged.

If the resolved point isn't in **any** supported city, return HTTP 422 with the existing "outside coverage area" error (no change from today).

### City selection UX

- **City selector button.** Persistent UI element placed in the desktop sidebar header and the mobile bottom-sheet header. Displays the active city's flag-mark glyph + display name + state abbreviation. (Replaces the "📍 Chicago, IL" pill referenced in older drafts of this plan; no such pill exists in the current codebase — the Masthead currently shows only brand + tagline + a `chicago-mark` flag glyph in [walkpath-icons.jsx](frontend/src/wayfarer/walkpath-icons.jsx).) Clicking the button opens the **city picker view**.
- **City picker view.** A modal (full-screen on mobile, centered on desktop) showing a grid of tiles, one per supported city from `GET /cities`. Each tile contains: (a) the city's flag image, (b) the city's display name + state abbreviation, (c) a simplified SVG outline of the city boundary. Tap a tile → swap active city and close the modal. The currently-active tile is visually marked (border highlight + check). A close affordance dismisses without changing the active city. **Per-city tile assets are optional based on data availability:** missing flag or outline falls back to a generic placeholder + a small "outline unavailable" tag so the city still appears in the grid.
- **Per-city assets** live under `frontend/public/cities/{slug}/`: `flag.svg` (sourced manually per city from open-source SVG, typically Wikimedia Commons) and `outline.svg` (built by a new `scripts/build_city_outline_svg.py` that consumes `{slug}_boundary.json` and emits a Douglas-Peucker simplified single-path SVG, ~5–20 KB). Both are checked into the repo per city; cities without an outline file get the placeholder.
- **First load (no `city` in localStorage):** the frontend requests `navigator.geolocation`. If permission granted and coords fall inside one of the supported cities' bboxes, set that city as active and persist to localStorage. If permission denied, geolocation unavailable, or coords don't match any supported city, **open the city picker view automatically with no preselection** — the user must pick a city to continue.
- **Subsequent loads:** read `city` from localStorage; no geolocation prompt, no automatic picker open. The selector button stays available for manual swaps.
- **On city change:** recenter the map to the new city's `default_center` / `default_zoom`, clear the current route, swap the visible recents list (see below), and reset the Explorer's area-division dropdown to that city's first area.

### Recent searches scope

- **Visibility:** the recents list shows only entries belonging to the **currently active city.** Switching cities swaps which list is visible. Recents are stored as `recents_{slug}` keys in localStorage (one list per city) — never one flat list.
- **Lifecycle when a city is dropped from the registry:** delete that city's `recents_{slug}` localStorage entry on the next page load. Do not preserve.

### Geocoding API key

For v1, all cities share the same `LOCATIONIQ_API_KEY` from `backend/.env` (matching today's behavior). The `City` dataclass must expose an optional `geocoding_api_key_env_var: str | None = None` field so a future city can override the env var name it reads from (e.g., `LOCATIONIQ_API_KEY_NYC`). When `None`, fall back to the global `LOCATIONIQ_API_KEY`. **Do not** hardwire `os.getenv("LOCATIONIQ_API_KEY")` anywhere in `geocoding.py` — go through this resolver from day one.

Geocode cache is per-city: each city gets its own SQLite file `backend/data/{slug}_geocode.db` mirroring the schema of `chicago_geocode.db` (addresses + intersections + cached_forward + cached_reverse). The migration helper that today renames `geocode_cache.json` → `.deprecated` is a one-shot and need not be replicated per-city.

### Route flavors

Every v1 city supports all three flavors (`fastest`, `fewest_turns`, `greenest`). Greenest's tree-canopy + park-proximity contributions degrade per city based on data availability (see "Per-city data artifacts — availability matrix" above): a city with no canopy KDE artifact gets footway-only greenest; a city with neither canopy nor parks gets the legacy footway-only `_GREEN_DISCOUNT` discount. The fail-fast guard in [walking.py:420-443](backend/walking.py#L420-L443) (which today refuses to boot a graph missing greenest signals) is relaxed in chunk 2 to require *column presence and correct shape* rather than nonzero distributions, so a city can ship with zero-filled canopy/parks arrays when its source data is unavailable.

**Per-city greenest calibration** is a discovery task, not a code task: the `_GREEN_FOOTWAY_WEIGHT` / `_CANOPY_WEIGHT` / `_PARK_WEIGHT` constants in [walking.py](backend/walking.py) were tuned for Chicago's footway-tagging density and OSM canopy-mapping coverage. Each new city must verify greenest output against a known fixture route before launch and record findings (or "no tuning needed") in the runbook. Tuning the constants per-city is a fallback if the global values don't generalize — prefer leaving them global unless a specific city's output is obviously broken.

If a future smaller city is added and lacks footways entirely, add a `supported_flavors: list[str]` field to `City` at that time.

### Chunks

1. **`City` dataclass + registry.** New `backend/cities.py` defining `City` (`{ slug, display_name, state, graph_path, neighborhood_coords_path, bbox, default_center, default_zoom, area_division, adjacent_cities, geocoding_api_key_env_var }`) and a `CITIES: dict[str, City]` registry with Chicago + Evanston entries plus a commented `FUTURE_CITIES` list (Madison WI, Milwaukee WI, NYC, Portland OR, Seattle WA). Helper `get_city(slug) -> City` raises `UnknownCityError` for unknown slugs.
   - **Bbox migration:** the seven Chicago bbox constants in [backend/utils.py](backend/utils.py) (`CHICAGO_SOUTH/NORTH/WEST/EAST`, `CHICAGO_BBOX_GOOGLE`, `STREET_GRAPH_BBOX_OSMNX`, `STREET_GRAPH_SOUTH/NORTH/WEST/EAST`) are deleted as part of this chunk. Every consumer ([backend/main.py](backend/main.py) explore-origin guard + `/reverse-geocode`, [backend/geocoding.py](backend/geocoding.py), [backend/fetch_street_graph.py](backend/fetch_street_graph.py)) is rewritten to read `get_city(slug).bbox`. No module-level Chicago bbox should survive.
2. **Walking module refactor.** Convert `walking._graph_cache` (the single-graph global) into `walking._graphs: dict[str, ig.Graph]` lazily-loaded per city. Every public function (`route`, `_compute_route`, `_snap_to_node`, etc.) takes `city: str` as the first positional argument. `_compute_route`'s LRU cache key includes the city slug. Update all callers. Per-edge attribute caches (`_edge_names`, `_edge_highways`, `_edge_footways`, `_edge_lengths`, `_edge_geometries`, `_edge_sources`, `_edge_targets`, `_edge_tree_canopy`, `_edge_park_proximity`) and the snap-helper KDTree all become per-slug dicts.
   - **Per-city eviction:** the memory-eviction daemon in [backend/walking.py](backend/walking.py) tracks a single `_last_graph_access`. Convert this to a per-slug `_last_access: dict[str, float]` and apply an LRU-with-floor policy that always keeps the most-recently-active city resident. Without this, loading Evanston for one request would evict Chicago's graph and vice versa — pathological under any real traffic.
   - **Relax the greenest fail-fast guard.** The current guard at [walking.py:420-443](backend/walking.py#L420-L443) refuses to boot when per-edge `tree_canopy_score` + `park_proximity_score` columns are missing. After this chunk, the guard checks *presence and correct shape* per slug but allows zero-filled arrays — so a city without canopy/parks source data ships a graph whose greenest weights collapse to the legacy footway-only discount instead of refusing to boot.
3. **Geocoding module refactor.** `resolve_location(query, city)` accepts a city slug. Per-city `NEIGHBORHOOD_COORDS` loaded from `neighborhood_coords_{slug}.json`. Per-city geocode cache file (per the API-key section above, each city gets its own SQLite `data/{slug}_geocode.db`). LocationIQ key resolution goes through the `City.geocoding_api_key_env_var` indirection from chunk 1. The LocationIQ viewbox (today a Chicago-only constant in `geocoding.py`) and the autocomplete supplement gate in [main.py:398-412](backend/main.py#L398-L412) (`_looks_like_free_text_address`) both take the active city slug so hosted-fallback results bias toward the right bbox. `local_search.py` becomes city-aware: today it opens one `chicago_geocode.db` read-only; this chunk converts the global `_db` into a `dict[str, sqlite3.Connection]` keyed by slug, lazy-built per city.
   - Rename `LocationOutsideChicagoError` → `LocationOutsideCityError`; the error payload carries the slug it failed against so the API surface (chunk 8) can build the 409 `point_in_other_city` response.
   - **DB migration:** none needed. The pre-multi-city file `backend/data/chicago_geocode.db` already matches the post-multi-city naming scheme `data/{slug}_geocode.db` for `slug="chicago"`. New cities (Evanston etc.) ship their own SQLite alongside it.
   - The geocoder's 60→120→240s circuit breaker is **global**, not per-city — the API key is shared, so a 429 from LocationIQ trips all cities at once. Document as an intentional v1 choice; revisit if per-city keys are ever introduced via `geocoding_api_key_env_var`.
4. **Evanston spatial data discovery + ingestion + street graph.** Multi-step setup for the second city's data foundation. Each sub-step's output is optional per the availability matrix above:
   - **a. Audit data availability.** Before building anything, check what source data Evanston has for each artifact in the matrix. Document availability in the Evanston entry in `cities.py` — runtime and bake step both branch on it. **Open question to resolve here:** confirm Evanston's parks source (Cook County GIS / City of Evanston open data portal / OSM `leisure=park` fallback) and tree-canopy adequacy (Overpass `natural=tree` node count for Evanston's bbox); if either is too sparse, mark unavailable and zero-fill at bake time.
   - **b. Run available ingestions** parameterized by `--city evanston`: `build_tree_canopy.py` (only if OSM tree-tag density is adequate), `build_residential.py`, `build_green_space.py`, `build_address_points.py`, `build_intersections.py`. CDP-specific scripts (`build_libraries.py`, `build_schools_cps.py`, `build_police_stations.py`, `build_fire_stations.py`) are Chicago-only and **do not run** for Evanston; the curated feed ships empty (see chunk 9). Build `parks_polygons_evanston.json` from whichever source survived (a). Build `evanston_boundary.json` from open data if available.
   - **c. Build the street graph.** Parameterize [backend/fetch_street_graph.py](backend/fetch_street_graph.py) to take a `--city {slug}` arg (currently hardcodes `BBOX = STREET_GRAPH_BBOX_OSMNX` and writes a single `street_graph.graphml`); output filenames become slug-suffixed. The `_bake_green_signals` step pulls the per-city canopy + parks artifacts from (b); when one is unavailable, the corresponding edge column is zero-filled instead of refusing to bake (matches the relaxed fail-fast guard in chunk 2). Run against Evanston's bbox.
   - **d. Deploy.** Upload the resulting `.pkl` as a release asset under the existing `street-graph` tag, named `street_graph_igraph_evanston.pkl`. Update `Dockerfile` (and the boot fallback in [backend/walking.py](backend/walking.py)) to fetch all graphs declared in `cities.py`. The relaxed greenest fail-fast guard must apply per-city.
   - **e. Calibrate greenest for Evanston.** Pick a known Evanston route (e.g., Northwestern campus → downtown Evanston) and verify greenest output is reasonable. Record findings (or "no per-city tuning needed") in the runbook. Treat as a discovery task before launch, not a release blocker.
5. **Evanston neighborhood data.** Hand-curate ~15–25 well-known Evanston landmarks (Northwestern campus, Dempster Beach, downtown Evanston, etc.) into `neighborhood_coords_evanston_curated.json`. Run `build_neighborhood_coords_evanston.py` to pull OSM `place=neighbourhood`/`place=suburb` for the Evanston bbox. Merge per the rule above into `neighborhood_coords_evanston.json`. Define Evanston's `area_division` as `{ scheme_name: "Ward", areas: [...9 wards with centroids...] }` from City of Evanston open data.
6. **[DEFERRED — not part of v1] Border join precomputation.** Implementation design is preserved verbatim in the "Future cross-city design" subsection above. Do not implement in v1. Chunk number reserved so later chunks keep stable numbering when cross-city graduates from deferred.
7. **[DEFERRED — not part of v1] Cross-city routing.** Implementation design is preserved verbatim in the "Future cross-city design" subsection above. Do not implement in v1. Chunk number reserved so later chunks keep stable numbering when cross-city graduates from deferred.
8. **API surface.** Add optional `city: str = "chicago"` to `RouteRequest`, the `/explore` request schema, and the `/reverse-geocode` query string (defaults preserve current behavior on every endpoint). Add `GET /cities` returning `[{ slug, display_name, state, default_center, default_zoom, area_division: { scheme_name, area_count }, adjacent_cities }]`. Out-of-bbox detection in `/route`, `/explore`, and `/reverse-geocode` returns the new HTTP 409 `point_in_other_city` shape from the "Out-of-bbox handling — switch prompt" section above (point falls inside a different supported city's bbox); HTTP 422 stays for points outside every supported city's bbox. No `stops_span_non_adjacent_cities` 422 in v1 — that error shape belongs to the deferred cross-city design.
9. **Per-city place data + heatmaps for `/explore`.** Today [backend/places.py](backend/places.py), [backend/parks.py](backend/parks.py), [backend/green_space.py](backend/green_space.py), [backend/tree_canopy.py](backend/tree_canopy.py), and [backend/explore.py](backend/explore.py) all hardcode Chicago file paths. Each must take a city slug and load the per-city artifact (or return `null` / skip the layer when the artifact is unavailable per the availability matrix above).
   - Parameterize `backend/scripts/build_places_osm.py` and `build_residential.py` by city slug + bbox; output `places_osm_{slug}.json`, `residential_polygons_{slug}.json`. Run for Evanston (per chunk 4).
   - **Curated feeds for Evanston ship empty.** `places_curated_evanston.json = []` at v1 launch — curated feeds are documented as a per-city opt-in. OSM still covers libraries (`amenity=library`) for Evanston via the parameterized OSM ingestion. The Chicago CPL libraries + 2013 farmers markets stay as-is in `places_curated_chicago.json`.
   - **Heatmap layers and boundary clip are optional per the availability matrix.** `tree_canopy.py`, `parks.py`, `green_space.py` each take a city slug and load the matching per-city artifact (`tree_canopy_kde_{slug}.json`, `parks_polygons_{slug}.json`, `green_space_polygons_{slug}.json`). Missing artifact → the corresponding heatmap key in the `/explore` response is `null` (the frontend toggles handle null gracefully today — verify on Evanston before launch). `explore.py`'s boundary clip takes `{slug}_boundary.json`; missing → skip the clip (acceptable for largely inland cities).
   - Convert `places.py` `_places` / `_strtree` globals into `dict[str, PlaceIndex]` keyed by slug, lazy-built on first request per city. Apply the same per-slug lazy pattern to the STRtrees in `parks.py` / `green_space.py` / `tree_canopy.py`. All public functions take the slug.
10. **Frontend — city selector button + picker view.** Add a persistent city selector button to the desktop sidebar header and the mobile bottom-sheet header. Button content: active city's flag-mark glyph + display name + state abbreviation. Clicking it opens the **city picker modal** sourced from `GET /cities`. Each tile renders the per-city flag image (`frontend/public/cities/{slug}/flag.svg`) + name/state + outline SVG (`frontend/public/cities/{slug}/outline.svg`). Tap a tile → swap active city, modal closes. The active tile is visually marked. **Per-city tile assets are optional based on data availability** — missing flag or outline falls back to a generic placeholder; the city still appears in the grid. (See "City selection UX" above for the full UX spec.) Persist selection to `localStorage` under key `walkpath:active_city` (matches the project's `walkpath:` namespace used everywhere else — theme, mode, explorePrefs, etc.). On change: recenter the map ([MapView.jsx](frontend/src/MapView.jsx)), clear the current route, swap recents visibility, reset the Explorer's area-division dropdown to the new city's first area.
    - **Per-city tile assets.** Each city needs `flag.svg` (sourced manually per city from open-source SVG, typically Wikimedia Commons) and `outline.svg` (built by a new `scripts/build_city_outline_svg.py` that consumes `{slug}_boundary.json` and emits a Douglas-Peucker simplified single-path SVG, ~5–20 KB suitable for tile display). Commit both per city. Cities without an outline file (because `{slug}_boundary.json` is unavailable) render the placeholder.
    - **Map defaults from active city.** [frontend/src/mapHelpers.js](frontend/src/mapHelpers.js) hardcodes `DEFAULT_MAP_CENTER` / `DEFAULT_MAP_ZOOM` to Uptown, Chicago. Wire `MapView` initial center/zoom from the active city's `default_center` / `default_zoom` so Evanston users don't see a Chicago flash on first paint.
11. **Frontend — first-load city detection.** On page load, if `walkpath:active_city` is unset: request `navigator.geolocation`, point-in-bbox-test against `GET /cities` results, set the matching city and persist. On no permission / no match, **open the city picker view automatically with no preselection** (per the "City selection UX" section above) — the user must pick a city to continue. The selector button stays the entry point for later swaps. No "shown once per browser" flag is needed because subsequent visits read `walkpath:active_city` from localStorage; the picker only reopens when explicitly clicked.
    - **Generalize the geolocation gate.** [frontend/src/lib/geolocation.js](frontend/src/lib/geolocation.js) hardcodes Chicago bbox constants in `inChicagoBbox()`. Replace with an "in any supported-city bbox" check that pulls bboxes from `GET /cities` (cached in memory after first fetch). Without this, "📍 My location" in both route and explore forms remains Chicago-only even after the picker lands.
12. **Frontend — out-of-bbox switch prompt.** Catch HTTP 409 `point_in_other_city` from `/route`, `/explore`, and `/reverse-geocode`. Show a modal: "This address is in {suggested_city}. Switch to {suggested_city}?" with Switch / Cancel buttons. Switch swaps the active city and re-submits the original request; Cancel restores the previous form state.
13. **Frontend — shared URL city encoding.** [frontend/src/lib/urlParams.js](frontend/src/lib/urlParams.js) parses `from`/`to`/`stops` with no city field. Once Evanston ships, a Chicago user shares a route, an Evanston-active user opens the link, and the frontend tries to resolve "Wrigleyville" against Evanston's geocoder. Add `&city={slug}` to every shared URL the app emits (Web Share, copy-link, deep-link recipients). **v1 rule (resolved 2026-05-15):** the value is the active city at share time. Since v1 has no cross-city routes, this rule is equivalent to "the city containing the first stop" — when cross-city routing graduates from deferred (see the "Future cross-city design" subsection above), the rule formally becomes "first stop's city" without breaking single-city links. On boot, URL `city` overrides `localStorage.active_city`. Back-compat: links without `city` resolve to `chicago` (same default rule the backend uses). **Must ship in the same release as chunk 10**, otherwise every shared link is a silent failure on the day Evanston goes live.
14. **Frontend — per-city recents.** Refactor the recents list in `App.jsx` to read/write `localStorage.walkpath:recents_{slug}`. On city change, swap the visible list (no merge across cities). On first load after a city has been removed from the `GET /cities` response, delete its `walkpath:recents_{slug}` key.
    - **Cross-city recents rule (preserved for the future cross-city work; moot in v1).** When cross-city routing graduates from deferred, cross-city entries land in `walkpath:recents_{first_stop_city}` — predictable, keeps the entry visible while the user is in the city they started from, no new "crosscity" bucket needed. In v1, since no single route can span cities, every entry is single-city and goes to its own city's bucket by definition; this rule never fires.
    - **Migration from the existing flat key:** on first boot after this chunk ships, if `walkpath:recentSearches` exists and `walkpath:recents_chicago` does not, move every entry over and delete the old key. All pre-multi-city entries are Chicago by definition, so this is loss-free.
15. **Explorer integration.** Update the Explorer's area-division dropdown to source from the active city's `area_division.areas` and label itself with `area_division.scheme_name`. The community-area centroid table built when the Explorer shipped ([backend/community_areas.py](backend/community_areas.py)) must be generalized into per-city centroid files (Chicago: 77 community areas, Evanston: 9 wards).
    - **Explore prefs schema needs a `city` field.** [frontend/src/lib/explorePrefs.js](frontend/src/lib/explorePrefs.js) stores `origin: { kind: "community_area", communityArea: "Loop" }` with no city scoping; default `"Loop"` is meaningless if the active city is Evanston. Add `origin.city` to the persisted shape; on city-change, reset the explorer origin to the new city's `area_division.areas[0]` (or geolocation if available and inside the new city's bbox).
16. **Tests.** Parametrize key backend tests across both cities (`pytest.mark.parametrize("city", ["chicago", "evanston"])`) — `/route`, `/reverse-geocode`, `/explore`, geocoder fuzzy match. Frontend integration tests: city picker swap recenters the map; out-of-bbox 409 triggers the switch modal; recents are per-city.
    - Existing fixtures in [backend/tests/test_explore_endpoint.py](backend/tests/test_explore_endpoint.py) (Chicago bbox assertions) and [backend/tests/test_places.py](backend/tests/test_places.py) (hardcoded `places_osm.json` / `places_curated.json` paths) must be re-pointed at the per-city files from chunk 9.
    - `test_walking_greenest.py` may need Evanston-specific fixture skips if Evanston greenest tuning hasn't been validated yet (`pytest.mark.skip(reason="evanston greenest tuning pending")`) rather than copying Chicago expectations.
    - **No cross-city routing test in v1** — cross-city routing is deferred. When it graduates from the "Future cross-city design" section above, add the Chicago→Evanston multi-stop success test and the non-adjacent 422 test alongside chunks 6 + 7.
17. **Edge cases.**
    - User has Evanston active but their localStorage `recents_evanston` references a landmark that's been removed from Evanston's neighborhood data (e.g., we cleaned up a typo): silently drop unmatched entries on load, do not error.
    - Geolocation returns coords inside the Chicago/Evanston bbox overlap zone (rare): pick whichever city's `default_center` is closer.
    - `GET /cities` is called before any graph has finished loading: respond from the static `cities.py` registry — do not block on graph load.
    - A new city is added between deploys (registry has it, `walkpath:active_city` is still set to an old city the user previously chose): keep the user's existing choice; the new city only appears in the picker. No automatic surfacing.
    - Pick-on-map click lands across the border (e.g. Chicago active, user taps a point in Evanston): `/reverse-geocode` returns 409 `point_in_other_city`, which the frontend already handles via the chunk 12 switch modal — no separate code path needed.
    - Multi-stop request where one stop resolves outside the active city's bbox: the backend returns 409 `point_in_other_city` for the offending stop. Frontend's switch-modal handles the active-city swap; user re-submits. In v1 there is no fallback that routes the request as cross-city (deferred — see "Future cross-city design" above).
    - `useFollowLocation` (live tracking) when the user physically walks across the Chicago/Evanston border: today the geolocation gate would reject; post-chunk 11 it accepts. Acceptable for v1 — the route doesn't re-target, the location dot just keeps moving on the current city's map view. If/when cross-city routing ships, revisit whether the dot should trigger a city-switch prompt.
    - Border-stop disambiguation (an input coord that falls inside both Chicago's and Evanston's bbox): handled by the 409 switch-prompt; the snapped-graph-node tiebreaker described in the "Future cross-city design" section only matters when cross-city routing is in scope.
    - **Doc sweep — wider than the original draft suggested.** [CLAUDE.md](CLAUDE.md) and [README](README.md) both say "Chicago-only for now" — false after this feature ships. Beyond that:
      - CLAUDE.md's "Greenest-routing graph release runbook" section uses Chicago-specific paths (`chicago_geocode.db`, `data/tree_canopy_kde.json`, `data/parks_polygons.json`) and a Chicago-specific verification fixture (Lakeview East → Lincoln Park). Either generalize with `{slug}` placeholders or split into per-city subsections.
      - Module docstrings in [backend/geocoding.py](backend/geocoding.py), [backend/places.py](backend/places.py), [backend/local_search.py](backend/local_search.py), [backend/community_areas.py](backend/community_areas.py), [backend/parks.py](backend/parks.py), [backend/green_space.py](backend/green_space.py), [backend/tree_canopy.py](backend/tree_canopy.py) all say "Chicago" — rewrite active-city-neutral.
      - Coverage-error toasts in [frontend/src/App.jsx](frontend/src/App.jsx) lines 464, 658, 698 ("You're outside the Chicago coverage area") — read the active city's display name.
      - Motivation copy in [frontend/src/lib/routeFormat.js](frontend/src/lib/routeFormat.js) — sweep for Chicago-specific strings.
      - The `chicago-mark` icon name in [frontend/src/wayfarer/walkpath-icons.jsx](frontend/src/wayfarer/walkpath-icons.jsx) — generalize to `{slug}-mark` per city (each city contributes its own flag glyph alongside `flag.svg`).

---

## 2. Ship `chicago_boundary.json` as a release artifact

**Type:** Bolt-On | **Effort:** Low | **Area:** Backend / deploy

**Why.** [backend/explore.py](backend/explore.py) already supports clipping the `/explore` isochrone against `backend/data/chicago_boundary.json` so lakefront origins don't bleed polygons into Lake Michigan. The file is built on demand by [backend/scripts/build_chicago_boundary.py](backend/scripts/build_chicago_boundary.py), gitignored due to size, and currently absent from the Railway image — meaning waterfront isochrones in production render with the unclipped raw hull. Local-dev users who never ran the script see the same behavior. The code is graceful (missing file → skip clipping, no error), so this is a visible-only-on-waterfront quality regression rather than an outage.

The same release-artifact + Dockerfile-curl pattern that landed for `street_graph_igraph.pkl` ([6eb8f5e](https://github.com/AdamBHonaker/Passage/commit/6eb8f5e)) and `chicago_geocode.db` ([397e469](https://github.com/AdamBHonaker/Passage/commit/397e469)) applies here verbatim.

**Chunks.**

1. **Build the artifact locally.** Confirm `backend/data/chicago_boundary.json` exists. If not, run `python backend/scripts/build_chicago_boundary.py` to produce it. Sanity-check the file with a quick GeoJSON viewer or `python -c "import json; print(json.load(open('backend/data/chicago_boundary.json'))['type'])"` — should be a `Polygon` or `MultiPolygon`.

2. **Upload to the `street-graph` GitHub release tag.** Asset name must be exactly `chicago_boundary.json` (the Dockerfile curl in chunk 3 is hardcoded to that filename). Same release the `.pkl` and `.db` live on.

3. **Add a Dockerfile curl step.** In [backend/Dockerfile](backend/Dockerfile), after the existing `chicago_geocode.db` curl block:
   ```dockerfile
   # Download the optional Chicago boundary polygon used by /explore to clip
   # isochrones against Lake Michigan for lakefront origins. explore.py
   # already handles the file being absent (skip clipping); we ship it so
   # waterfront origins render correctly in prod.
   RUN curl -fL -o data/chicago_boundary.json \
       "https://github.com/AdamBHonaker/Passage/releases/download/street-graph/chicago_boundary.json"
   ```
   No integrity check — same reasoning as `chicago_geocode.db`, this is data, not pickled code.

4. **Update docs.** In [CLAUDE.md](../CLAUDE.md):
   - The project-structure comment under `backend/data/` currently lists `chicago_boundary.json` as "Generated locally on demand (gitignored)" — update to flag it as a release artifact matching the surrounding entries.
   - In the "Greenest-routing graph release runbook" intro, add a third artifact row to the bullet list (`chicago_boundary.json`, ~? KB, optional lakefront clipping, no integrity check).

5. **Deploy verification.** After the next Railway rebuild, eyeball a lakefront origin (e.g., Streeterville, Lakeview East, South Shore) in the Neighborhood Explorer. The isochrone should hug the shoreline rather than overshooting into the lake. No new logs to grep — the change is purely visual.

**Definition of done.** Lakefront isochrones in prod are clipped against the Chicago boundary; the project-structure note and the runbook intro both list `chicago_boundary.json` as a release artifact; this entry is deleted from `FEATURE_PLANS.md` and a short note lands in `FEATURE_HISTORY.md`.

---

## 3. GCFD Food Banks & Pantries in the Neighborhood Explorer

**Type:** Bolt-On | **Effort:** Medium | **Area:** Backend + Frontend + Data ingestion
**Depends on:** no other *planned* feature. **Hard-blocked by an external prerequisite** — a Vivery API key (Chunk 0). Every data + UI chunk stays parked until the key is in hand; the schema-only Chunk 1 is the lone exception (no Vivery dependency — it may run in parallel with the Chunk 0 outreach). One **internal** decision is also a blocker — see the "Open decision (BLOCKER)" subsection below — and must be settled before Chunk 2b begins.

**Why.** Passage exists to get people walking to the essentials. Food pantries, soup kitchens, and mobile food distributions are exactly that, and the people who rely on them are often the least able to drive. Adding the food-assistance sites that the **Greater Chicago Food Depository (GCFD)** coordinates — with their **operating hours** — as an Explorer category turns "what's reachable on foot" into a real food-access tool.

### Data source — the Vivery API

GCFD's public [Find Food map](https://www.chicagosfoodbank.org/find-food-2/) is powered by **Vivery**, a nonprofit food-access tech network GCFD helped launch in 2021. Vivery exposes a documented, **read-only** REST API at `https://api.vivery.org/api/public`:

- **Auth.** `GET /token` with an `api_key` header returns a JWT; the JWT goes in the `Authorization` header on every data call. Keys are **not self-service** — see Chunk 0.
- **Endpoints.** `/location` (name, **latitude/longitude**, address) and `/locationservices` (program-level `CategoryName`, recurring `LocationServiceSchedules` — `Day` / `OpenTime` / `CloseTime` / frequency — special/holiday hours, `ContactPhone`, announcements). Joined on `LocationId`.
- **Query model.** OData (`$select`, `$filter`, `$top`/`$skip`). In Vivery's model GCFD is a **Network**; registered pantries are Locations/Programs flagged `ApprovedInd` on that Network and `ActiveInd`. The ingestion filters to exactly those.
- **Rate limit.** 200 requests/min/IP — ample for a periodic bulk pull.

The API is the same pipeline Vivery documents for food banks syncing data into their own systems, so a baked-JSON snapshot refreshed on a cadence is a first-class use of it.

### Why not OpenStreetMap

OSM is the project's existing place source, so a `social_facility=food_bank` filter in [build_places_osm.py](backend/scripts/build_places_osm.py) would be trivial — but a live Overpass query against the Chicago bbox returned only **13** tagged food banks, of which **1** had opening hours. GCFD coordinates hundreds of sites. OSM captures a few percent with almost no hours, which defeats the feature's purpose. OSM is rejected as the source; Vivery is the only viable one.

### Category model — placement and shape

Per the decision to place this in **Public Services**: that group's members (`libraries`, `police_stations`, `fire_stations`) are all *top-level categories with no subcategories*, so there is no parent to nest a subcategory under. This therefore lands as a **new top-level category** in the Public Services group — but one that **carries its own subcategories** for program type, which is where the per-type checkboxes live (this reconciles the original "sub-category" framing: the sub-checkboxes are real, they just hang off a new category rather than an existing one).

- **Category key:** `food_assistance` (backend `places.category`). Matches the compound-key style of `police_stations`, `gyms_fitness`.
- **Label:** "Food banks & pantries" (user-facing; tunable).
- **Subcategories** (`places.subcategory`, mapped from Vivery's *Food Program Category* field):
  - `pantry` — "Food pantries" (Vivery *Food Distribution*)
  - `meal_program` — "Soup kitchens & meal programs" (Vivery *Hot/Cold Meal Program*)
  - `mobile` — "Mobile & pop-up distributions" (Vivery *Pop-Up/Mobile Resource*)
  - Vivery's *Shelter* and *Online Market* program types are **excluded** from v1 — a shelter isn't a food destination and an online market has no walk-to value.
- **Glyph + color** — a small open decision for Chunk 3. `F` already belongs to Fire stations *in the same group*, so pick a distinct single character; color should be a Wayfarer token (e.g. `var(--field)`, echoing the food/grocery green) — confirm against the Public Services palette so pins stay distinguishable.

### Open decision (BLOCKER) — modelling a location with multiple food programs

**Status: unresolved. Must be locked before Chunk 2b (the build) begins** — it sets the shape of every food-assistance place record and is not safe to settle mid-build. Chunk 2a's data-inspection pass can *inform* the choice (it measures how common multi-program sites are in GCFD's data), but the decision itself is a design call, not a data lookup.

Vivery's docs are explicit that one **Location** can host more than one food **Program** — a church running both a pantry and a soup kitchen is stored as two Programs (`AP01-1`, `AP01-2`) at one address. The map cannot ignore this: [places.py](backend/places.py) does not dedup curated-vs-curated, so two programs at one building become two pins at *identical* coordinates; supercluster then merges identical-coordinate points into a cluster that never expands, and [MapExploreLayer.jsx](frontend/src/map/MapExploreLayer.jsx) `onPinClick` reads only `features[0]` — so the second program is unreachable.

The two options:

- **(a) One record per Location** *(recommended lean).* One pin per physical site. `subcategory` is the site's primary program type by precedence (`pantry` > `meal_program` > `mobile`); the popup lists every program type the site offers; `hours` is program-segmented (see "The hours problem" below). Cost: the subcategory checkbox filter is slightly lossy — a pantry-plus-kitchen site appears only under "Food pantries" — but its popup still tells the full story.
- **(b) One record per Program.** Each program is its own record with its own `subcategory` and `hours` — clean, lossless filtering — but the identical-coordinate problem must be solved first: either teach the popup to page through multiple co-located `features`, or jitter co-located pins a few metres apart. Either adds real frontend work to Chunk 4.

Whichever option wins, update the "Category model" and "The hours problem" sections to match before Chunk 2b.

### The hours problem — place-record schema extension

The whole value of this data is **hours**, and the place record has no field for them. Today every place — OSM or curated — is `{ category, subcategory, name, lat, lon, address, source }` (built in [places.py](backend/places.py) `_load_places_file`). This feature adds **`hours`** and **`phone`**.

**This extension is low-risk and almost entirely additive.** Verified end-to-end:

- **[places.py](backend/places.py) `_load_places_file`** — the record is built with explicit keys; adding `"hours": p.get("hours")` + `"phone": p.get("phone")` defaults both to `None` for every existing OSM/curated source. One-line-each change.
- **`/explore` in [main.py](backend/main.py)** — returns `"places": places` as a **plain dict with no Pydantic response model**, so the new keys flow into the JSON response with zero serialization changes. Only the endpoint docstring's place-shape comment needs updating.
- **Tests** — no test asserts an *exact* place-dict shape; `test_every_place_has_required_fields` in [test_places.py](backend/tests/test_places.py) checks a *subset* of keys are present, so a new key cannot break it. New assertions are *added*, never edited.
- **Frontend [MapExploreLayer.jsx](frontend/src/map/MapExploreLayer.jsx)** — `placeFeatures` builds the pin `properties` from an explicit field pick, so unpicked fields are simply ignored; surfacing hours is a two-spot change (add to the pick + render in `renderPopupContent`).

**Intended cross-feature behavior — route-form autocomplete.** [local_search.py](backend/local_search.py) builds its autocomplete POI index from `places.all_places()` — OSM **+ curated** — **unfiltered by category**. So once `build_food_banks.py` writes into `places_curated.json`, food banks also surface as typeahead suggestions in the **route form's** stop inputs (`source: "place"`). **This is intentional and settled (decided 2026-05-20):** food banks are valid walking destinations, so they *should* be routable — a user typing a pantry name into a route stop is using the app as intended, not hitting a leak. No category-exclusion filter is added, and no code is needed beyond what Chunk 2 already does. It is documented here so it reads as a deliberate inclusion rather than an accident.

**Hours shape — baked display string, not structured.** Vivery returns *structured* recurring schedules (per-day open/close, frequency rules) plus special hours. v1 bakes these into a single human-readable **display string** at ingest time (e.g. `"Tue 9:30 AM–11:30 AM · Thu 1–3 PM"`) stored in `hours`. Rationale: the place record stays flat primitives (MapLibre feature properties can't hold nested objects without `JSON.stringify`), `places_curated.json` stays lean, and the popup just prints a line. A structured/machine-readable hours field — enabling an "open now" badge or day filter — is a deferred enhancement, not v1.

Two cases the formatter must handle from day one:

- **No hours.** Vivery schedules are an *optional* field — many programs simply say "Call for assistance." With no schedule the formatter yields `None` (never an empty string, never a fabricated default); the popup then shows "Hours not listed — call ahead" and leans on `phone`. The Chunk 5 test therefore asserts the `hours` *key is present*, not that it is non-empty.
- **Multiple programs at one site.** If the Open decision above resolves to **one record per Location**, that single `hours` string covers 2–3 programs, so it is **program-segmented** rather than merged into one blob — each program's schedule is prefixed with its type, e.g. `"Pantry — Tue & Thu 9:30–11:30 AM; Soup kitchen — daily 12–1 PM"`; a hours-less program reads `"Pantry — call ahead"`. A single-program site gets a plain unprefixed string. If the decision resolves to one record per Program instead, each record carries only its own program's hours and no prefixing is needed — which is why the formatter's exact output shape is downstream of the Open decision.

### Data freshness & attribution

- **Refresh cadence.** A baked snapshot; re-run `build_food_banks.py` **monthly** (pantry hours and rosters drift faster than the annual cadence of the CPL / farmers-market feeds). `places_curated.json` is checked into the repo, so a refresh is a normal commit — no release-artifact step.
- **Staleness caveat.** A baked snapshot cannot reflect *next week's* holiday closure. The popup must frame hours honestly — "Typical hours — call ahead to confirm" — and surface `phone` next to them. v1 deliberately does **not** ingest Vivery's one-off special-hours / announcement fields (they go stale fastest).
- **Attribution & terms.** Confirm in Chunk 0 what Vivery / GCFD require for displaying this data in a third-party app. At minimum the popup's existing `source` line ("via …") should credit GCFD/Vivery; the `_source` key is `gcfd_vivery`.

### Scoping to finalize once API access is granted (Chunk 2a)

Several specifics genuinely cannot be pinned down without inspecting real Vivery responses. These are **deliberately deferred**, not loose ends — they are resolved in **Chunk 2a**, a data-inspection pass that is the first task of Chunk 2 (after Chunk 0 yields a key, before `build_food_banks.py` is written). Chunk 2a pulls a real GCFD response and locks down:

- **Pagination.** Whether `/location` returns the full GCFD network in one call or caps the page size — if capped, `_vivery_client.py` must loop on `$skip`. Silently truncating to page one would drop sites.
- **Hours formatter — real cases.** Which `FrequencyType` values actually occur in GCFD's data (`Every Week` / `Every Other Week` / `Week of Month` / `Day of Month`), how often, and how messy — and therefore exactly how the formatter renders each. "Every Other Week" is unresolvable even by Vivery (it cannot say which weeks — "clients must call"), so its rendering needs a real-data look.
- **`name` field.** Display Vivery's `LocationName` or `OrganizationName`? They coincide for some sites and differ for others — pick what reads correctly against real records.
- **Coordinate + data quality.** Vivery data is user-submitted with no validation; 2a measures how many records have missing/implausible coordinates so `build_food_banks.py` can drop them cleanly.
- **Data volume.** Actual count of GCFD food programs inside the Chicago bbox, and the resulting size delta on `places_curated.json`.
- **`source` display label.** `_source="gcfd_vivery"` renders in the popup today as a raw de-underscored string ("via gcfd vivery"). Decide a friendly label and where it is mapped.
- **Default selection state.** Whether `food_assistance` ships pre-checked in `walkpath:explorePrefs` or off by default like the other categories.

Chunk 2a's deliverable is this list answered, plus the "Open decision (BLOCKER)" above settled — both folded back into the plan before any ingestion code is written.

### Chunks

Chunks are numbered in dependency order, and each chunk states its dependencies explicitly below. **Chunk 0 (the outreach TODO) and Chunk 1 (the schema extension) have no dependency on each other — run them in parallel.** Chunks 2 → 6 are strictly sequential. Every one is transitively gated by the Chunk 0 API key, and **Chunk 2 splits into 2a (data-inspection + scoping) and 2b (build) — 2b additionally cannot start until the "Open decision (BLOCKER)" above is settled.**

**0. [BLOCKER — external] Obtain Vivery API access.** *This is the standing TODO for this feature.* Nothing downstream (Chunks 2–6) can start without an API key. The schema-only Chunk 1 may proceed in parallel.

  *Contacts:*

  | Org | Why | How to reach |
  | --- | --- | --- |
  | **Vivery** — owns the API + issues keys | API key request, access scope, terms of use | `support@vivery.org` · 312-373-9322 · [support.vivery.org](https://support.vivery.org) |
  | **GCFD** — owns the data + the Network relationship | May need to authorize / vouch for access to *their* network's data | (773) 247-3663 · [chicagosfoodbank.org/contact](https://www.chicagosfoodbank.org/contact/) · 4100 W Ann Lurie Pl, Chicago IL 60632 |

  Start with Vivery (they run the API); loop GCFD in if Vivery needs the Network's sign-off. Draft outreach note:

  ```
  Subject: API access for a non-commercial Chicago walking app — GCFD food pantries

  Hi Vivery team,

  I'm the developer of Passage, a free, open-source, non-commercial walking-route
  app for Chicago (github.com/AdamBHonaker/Passage). It shows people what they can
  reach on foot — and I'd like to add Greater Chicago Food Depository food pantries,
  soup kitchens, and mobile distributions, with their locations and hours, as a
  category on the map.

  I understand GCFD's Find Food map runs on Vivery and that your read-only API is
  the supported way to access this data. A few questions to get started:

    1. How does a small civic project request an API key?
    2. Would a key let me read GCFD's network of food programs (locations, hours,
       program type), or is API access scoped to a food bank syncing only its
       own data?
    3. Are there terms of use or attribution requirements for displaying this
       data in a third-party app?

  Passage has no ads and isn't monetized — the goal is purely to help people reach
  food assistance and other essentials on foot. Glad to share more or hop on a call.

  Thank you for the work you do,
  [Your name] · [email] · [phone]
  ```

  **Open questions to resolve here** (carry the answers into Chunks 2–6): the exact `NetworkName` string for GCFD in Vivery; whether the issued key returns the full GCFD network or only a single org's data; attribution / ToS requirements; whether redistributing a baked snapshot (vs. live calls) is permitted. **If access cannot be obtained, this feature is parked** — do not ship the 13-site OSM set as a consolation; it isn't worth it.

  *Dependencies: none — Chunk 0 is the root external blocker. It has no code-chunk prerequisite, and it gates Chunks 2–6.*

**1. Place-record schema extension.** Add `hours: str | None` and `phone: str | None` to the record built in [places.py](backend/places.py) `_load_places_file` (both default `None` via `.get()`). Update the `/explore` place-shape docstring in [main.py](backend/main.py). No behavior change yet — pure groundwork, and **no Vivery dependency**, so it can land while Chunk 0 is in flight. Add a `test_places.py` assertion that every record carries the keys (value may be `None`).

*Dependencies: none — Chunk 1 has no prior-chunk prerequisite and is explicitly **not** gated by the Chunk 0 API key (it touches no Vivery code). Start it immediately, in parallel with the Chunk 0 outreach.*

**2. Vivery API client + `build_food_banks.py` ingestion.** Split into a scoping pass and a build:

  **2a. Data-inspection + scoping.** Before any ingestion code, pull a real GCFD response and resolve every item in "Scoping to finalize once API access is granted" above; settle the "Open decision (BLOCKER)" (multi-program modelling). Fold both back into the plan. Gated on Chunk 0 (the key). Treat the 2a → 2b boundary as a checkpoint.

  **2b. Build the client + ingestion script.** New `backend/scripts/_vivery_client.py` — `api_key` → JWT exchange, bearer-auth GET helper, OData query params, a 200/min rate-limit courtesy throttle, and pagination per the 2a finding. New `backend/scripts/build_food_banks.py` (model it on [build_farmers_markets.py](backend/scripts/build_farmers_markets.py), the closest non-CDP curated precedent): pull from `/location` + `/locationservices` on the call pattern confirmed in 2a; filter to GCFD-network + `ActiveInd` + `ApprovedInd` food programs; drop records with missing/implausible coordinates; **bbox-filter to the Chicago street-graph bounds** (skip Cook County sites outside coverage); log per-subcategory counts and refuse to overwrite on a suspiciously low total (mirrors [build_places_osm.py](backend/scripts/build_places_osm.py)); write into `places_curated.json` via [_curated_common.py](backend/scripts/_curated_common.py) `merge_and_write` under `_source="gcfd_vivery"`, `category="food_assistance"`, subcategory per the Open-decision model. Add `VIVERY_API_KEY` to `backend/.env.example` (ingestion-only — runtime never reads it, mirroring the CDP key pattern). After the first run, spot-check ~5 ingested sites (name, address, hours) against GCFD's public Find Food map before committing the JSON.

  **The schedule→`hours` formatter is the highest-risk code in the feature** — give it its own tested function. It must handle every `FrequencyType`, multiple open/close windows per day, the no-hours case (→ `None`), and program-segmented output under the one-record-per-Location model (see "The hours problem" above).

*Dependencies: Chunk 1 (the ingestion writes the `hours` / `phone` fields the extended schema must carry). **Blocked by the Chunk 0 TODO** (a live API key) for all of Chunk 2, and **2b is additionally blocked by the "Open decision (BLOCKER)"** — the multi-program model must be settled before the record shape is fixed.*

**3. Category catalog wiring.** Add the `food_assistance` category (with the three subcategories) to the **Public Services** group in [exploreCategories.js](frontend/src/lib/exploreCategories.js) — key, label, color, glyph, `subs`. It becomes a pin category and a requestable key automatically (`PIN_CATEGORIES` / `REQUESTABLE_CATEGORY_KEYS` derive from the catalog). The `/explore` category filter and the frontend sub-filter already handle any new `category` + `category/subcategory` pair — no backend code change. Food banks also surfacing in the route-form autocomplete (see "Intended cross-feature behavior — route-form autocomplete" above) is a **settled, intentional inclusion** — no exclusion filter is added; this chunk makes no `local_search.py` change.

*Dependencies: Chunk 2 (the catalog's `category` + `subcategory` keys must match exactly what the ingestion writes, and pins need ingested data to render). Transitively blocked by the Chunk 0 TODO.*

**4. Map popup — surface hours + phone.** In [MapExploreLayer.jsx](frontend/src/map/MapExploreLayer.jsx): carry `hours` + `phone` into the `placeFeatures` GeoJSON `properties`, and render them in `renderPopupContent` — an hours block with the "Typical hours — call ahead to confirm" framing and a tappable `tel:` phone link. Add the popup-card CSS (`.explore-popup-card-hours` etc.) to the Wayfarer `components.css`. **Mobile parity is required, not a follow-up** — the place-pin tap already drops the bottom sheet to peek so the popup isn't clipped; verify the taller card (now with hours) still fits in both Cream/Dusk themes and portrait/landscape.

*Dependencies: Chunk 1 (the `hours` / `phone` fields must be present in the `/explore` payload) and Chunk 3 (the category must be wired before there are food-bank pins to tap). Transitively blocked by the Chunk 0 TODO.*

**5. Tests.** Backend: smoke tests against the checked-in `places_curated.json` — the `gcfd_vivery` source is present in metadata, `food_assistance` places load into the index, and each carries the `hours` key — value may be `None`, since Vivery schedules are optional (mirroring `TestCuratedSources` in [test_places.py](backend/tests/test_places.py)); a `food_assistance` category-filter test in [test_explore_endpoint.py](backend/tests/test_explore_endpoint.py). A unit test for `build_food_banks.py`'s schedule→string formatter and the GCFD / active / approved filter, with the HTTP layer mocked — **no live Vivery calls in the suite**. Frontend: a `MapExploreLayer` test that a place with `hours` renders the hours block in the popup.

*Dependencies: Chunks 1–4 — the suite covers the schema field (Chunk 1), the ingestion (Chunk 2), the category filter (Chunk 3), and the popup (Chunk 4). Transitively blocked by the Chunk 0 TODO.*

**6. Docs, refresh runbook, mobile sign-off.** Update [CLAUDE.md](CLAUDE.md):
  - **Project structure** — add `build_food_banks.py` + `_vivery_client.py` to the `backend/scripts/` list; note the new `gcfd_vivery` source in the `places_curated.json` description.
  - **`POST /explore` API section** — add `hours` + `phone` to the documented place-object example, and add `food_assistance` to the "Place categories (top-level keys…)" list (with `food_assistance/pantry` etc. shown alongside the existing subcategory examples).
  - **Key Design Decisions** — a new entry for the food-assistance category: Vivery as the source, the baked-snapshot + monthly-refresh model, the typical-hours / call-ahead framing.
  - **Running Locally** — note the `VIVERY_API_KEY` slot in `.env.example` is ingestion-only (runtime never reads it).
  - A short **"GCFD food-bank data refresh runbook"** — monthly `build_food_banks.py` re-run, the key in `.env`, commit the regenerated `places_curated.json`.

  Add a real-device mobile sign-off item to [Pending_Verification.md](Pending_Verification.md) (next free `PV-0NN`). Per the process note at the top of this file, **delete this entry** and add a summary to [FEATURE_HISTORY.md](FEATURE_HISTORY.md) when done.

*Dependencies: Chunks 1–5 — Chunk 6 documents and verifies the finished feature. Transitively blocked by the Chunk 0 TODO.*

### Definition of done

A `food_assistance` category sits in the Explorer's Public Services group with `pantry` / `meal_program` / `mobile` sub-checkboxes; selecting it drops pins for GCFD-registered food-assistance sites inside the isochrone; tapping a pin shows the site's name, address, **typical hours** (or "Hours not listed" where Vivery has none), a call-to-confirm phone link, and a GCFD/Vivery credit; the popup is verified on a real mobile device; `places_curated.json` carries the `gcfd_vivery` source and is refreshable via `build_food_banks.py`; tests cover the new source, the schema field, and the popup; CLAUDE.md documents the script + refresh runbook; this entry is moved to `FEATURE_HISTORY.md`.

---

## 4. Beaches as a Subcategory of Public Parks

**Type:** Bolt-On | **Effort:** Low | **Area:** Backend + Frontend + Data ingestion
**Depends on:** none.

**Why.** The Explorer's `parks` category drops a pin for every OSM `leisure=park`, but Chicago's lakefront beaches are the signature outdoor destination the city is known for — and a beach is a meaningfully different "what's reachable on foot" answer than a neighborhood playlot. A `beach` subcategory under `parks` lets a user filter the isochrone to just the beaches in their walkshed. Chicago's ~25 public beaches are all Chicago Park District land, so an authoritative City of Chicago Data Portal (CDP) feed exists; the data is small, static, and free.

### Data source

**Resolved 2026-05-20 — derive beaches from the CPD parks dataset.** The Chicago Park District facility dataset `ejsh-fztr` ("CPD_Parks") carries a per-park `beach` facility column alongside `park` (name), `park_class`, and the `the_geom` polygon geometry. `build_beaches.py` queries `ejsh-fztr` via the existing [`_cdp_client.py`](../backend/scripts/_cdp_client.py) helper, keeps rows whose `beach` column flags a beach, and emits one place point per such park at the polygon's representative point. ~20–30 rows. This is a fresh query against CPD — *not* a reuse of the baked `parks_polygons.json`, which keeps only name/acres/ring and drops the facility columns.

> **Note on the parks dataset ID.** CLAUDE.md describes `parks_polygons.json` as baked from `ejsh-fztr`, but [`build_parks.py`](../backend/scripts/build_parks.py)'s docstring names `ej32-qgdr` ("Parks - Chicago Park District Park Boundaries (current)"). These are two different CPD park datasets. Beaches must source from `ejsh-fztr` specifically — it is the one carrying the `beach` facility column. (The CLAUDE.md vs. `build_parks.py` discrepancy is a pre-existing doc inconsistency, flagged here so the implementer picks `ejsh-fztr` deliberately; reconciling that inconsistency is out of scope for this feature.)

### Category model

No new top-level category — `beach` joins `dog_park` and `playground` as a third entry in the `parks` category's `subs` list in [`exploreCategories.js`](../frontend/src/lib/exploreCategories.js). Ingested records carry `category="parks"`, `subcategory="beach"`. Pins inherit the existing `parks` color (`var(--field)`) and glyph (`P`); subcategories carry no glyph of their own. **No backend code change** — [`places.py`](../backend/places.py) filters by top-level category and the frontend post-filters by subcategory, exactly as every existing sub already works.

### Chunks

1. **Env wiring.** Add `CDP_API_ENDPOINT_BEACHES` to [`backend/.env.example`](../backend/.env.example) pointing at the `ejsh-fztr` **`.geojson`** URL (`ejsh-fztr` is a geospatial asset — `build_parks.py` documents that the classic `.json` SODA endpoint returns empty column maps for these, so the `.geojson` variant is required), and to the endpoint list in `_cdp_client.py`'s docstring.
2. **`build_beaches.py` ingestion.** New `backend/scripts/build_beaches.py` modeled on [`build_parks.py`](../backend/scripts/build_parks.py) (the closest precedent — it already fetches `ejsh-fztr`-shaped GeoJSON and parses geometry) — fetch the FeatureCollection, keep features whose `beach` property flags a beach, compute each kept park's representative point, normalize to the place schema with `category="parks"`, `subcategory="beach"`, `_source="cdp_beaches"`, write via [`_curated_common.merge_and_write`](../backend/scripts/_curated_common.py). Commit the regenerated `places_curated.json`.
3. **Catalog wiring.** Add `{ key: "beach", label: "Beaches" }` to the `parks` category's `subs` array in `exploreCategories.js`.
4. **Tests + docs.** Add a `TestCuratedSources`-style assertion in [`test_places.py`](../backend/tests/test_places.py) that the `cdp_beaches` source loads and its records are `parks/beach`. Update CLAUDE.md: the `places_curated.json` description (new curated source), the `backend/scripts/` list, the `/explore` `source` enum (new `cdp_beaches` value), the Explorer category list. Per the process note at the top of this file, **delete this entry** and add a summary to `FEATURE_HISTORY.md` when done.

### Files likely touched

`backend/scripts/build_beaches.py` (new), `backend/scripts/_cdp_client.py` (docstring), `backend/.env.example`, `backend/data/places_curated.json` (regenerated), `frontend/src/lib/exploreCategories.js`, `backend/tests/test_places.py`, `CLAUDE.md`.

### Open questions

- **Pin placement.** A park flagged with a `beach` is pinned at the *park's* representative point, which for a large lakefront park may sit inland rather than on the sand. This is acceptable for "is a beach reachable in my walkshed"; if precise placement is wanted later, cross-reference the city's beach water-quality sensor dataset (named beaches + true beach coordinates). Out of scope for v1 unless the inland offset proves visibly wrong.
- **`beach` column semantics.** Confirm in chunk 2 whether `ejsh-fztr`'s `beach` column is a count, a boolean, or a name string, and filter accordingly (a park with multiple beaches still yields one pin in v1).
- **Curated-vs-OSM dedupe.** `_load_all_sources` dedupes on `(category, lat_q, lon_q)` at ~1 m precision — a CDP beach point that coincides with an OSM `leisure=park` point in the same cell would collapse. Beaches and parks rarely share a representative point, so this is expected to be a non-issue; confirm after the first ingest.
- **Multi-City Support.** CDP feeds are Chicago-only per that plan's data-availability matrix; if Multi-City Support lands first, the build script writes into `places_curated_chicago.json`.

### Definition of done

The Explorer's Public parks category shows a "Beaches" sub-checkbox; selecting it filters isochrone pins to Chicago beaches; `places_curated.json` carries the beach source; tests + CLAUDE.md updated; this entry is moved to `FEATURE_HISTORY.md`.

---


---

## 5. Community Health Centers as a Subcategory of Medical

**Type:** Bolt-On | **Effort:** Low | **Area:** Backend + Frontend + Data ingestion
**Depends on:** none.

**Why.** The `medical` category's subcategories — `pharmacy`, `urgent_care`, `hospital` — are all OSM-derived and miss the safety-net tier: community health centers, which provide comprehensive primary and preventive care regardless of ability to pay, and matter most to the residents least able to drive. The City of Chicago publishes an authoritative location list, so a `community_health` subcategory turns the Explorer into a real care-access tool — the same equity rationale behind the planned GCFD Food Banks & Pantries feature.

### What counts as a "community health center" — the City's own definition

The request raised a fair concern: "community health center" is a term different people define differently. **Passage does not have to define it — the City of Chicago already has.** The Chicago Department of Public Health publishes the dataset *"Public Health Services - Chicago Primary Care Community Health Centers"* (CDP resource `cjg8-dbka`) and states its working definition plainly: the list comprises **all federally qualified health centers (FQHCs) and similar community health centers that provide primary care and are open to the general community.** Each row is even tagged `FQHC` / `Look-alike` / `neither` in the `fqhc_look_alike_or_neither_special_notes` field. Adopting `cjg8-dbka` as the source means Passage adopts the City's definition wholesale — the subcategory is exactly "the facilities CDPH calls primary-care community health centers," nothing the project has to adjudicate.

This deliberately **excludes** standalone mental-health clinics: the City's "community health center" definition is primary-care-centric, and CDPH's mental-health clinics are a separate concept under a different program. Folding them in would reintroduce the definitional ambiguity the City's dataset otherwise resolves. If mental-health clinics are wanted later, they belong in their own subcategory, not merged here.

### Data source

CDP resource `cjg8-dbka` ("Public Health Services - Chicago Primary Care Community Health Centers"), fetched via `_cdp_client.py`. Columns: `facility` (name), `community_area`, `phone`, `fqhc_look_alike_or_neither_special_notes`, and `location_1` — a SODA location carrying `latitude` / `longitude` plus a `human_address` street address. **Coordinates are present**, so no build-time geocoding is needed.

**Staleness caveat (researched 2026-05-20).** `cjg8-dbka` was last refreshed by the City in **April 2014** — it is a ~12-year-old snapshot, the same pattern as the 2013 farmers-market feed. FQHC rosters drift far slower than farmers markets (federally funded health centers are relatively stable), so a 2014 baseline is materially better than nothing — but it is not current. See Open questions for the fresher alternative (HRSA's national health-center dataset).

### Available metadata — and whether to subdivide (investigated 2026-05-20)

`cjg8-dbka` is a **sparse** dataset: **120 facilities**, five columns only — `facility` (name), `community_area`, `phone`, `fqhc_look_alike_or_neither_special_notes`, and `location_1` (coordinates + street address). No services field, no hours field, no specialty taxonomy. That bounds what any subcategory split could key off:

- **Split by FQHC classification — possible from the data, but not user-meaningful.** The leading token of `fqhc_look_alike_or_neither_special_notes` classifies each row: **~96 FQHC**, **6 FQHC Look-alike**, **~18 "neither"**. It is a clean three-way split — but "FQHC" vs "FQHC Look-alike" is a federal-funding / administrative distinction a walker choosing map filters will not understand. Recommendation: do **not** expose it as Explorer subcategories; at most it is popup metadata, not a filter.
- **Mental-health clinics — NOT in this dataset.** `cjg8-dbka` is primary-care only and contains zero mental-health clinics. The City publishes those separately as `wust-ytyg` ("CDPH Mental Health Resources", last updated 2025-07-03). A `mental_health` subcategory is therefore a **second, separate dataset ingest** — its own build script — not a split of `cjg8-dbka`. A reasonable follow-on, but distinct work.
- **The "special notes" free text** carries real flavor — school-based health centers (~14), refugee-health and homeless-health specializations, county-government clinics (~9), volunteer-based free clinics — but it is an unstructured, human-written string (some rows even embed opening hours mid-sentence). Not reliable as subcategory keys; at most fuzzy popup text.

**No decision yet on subdivision.** The baseline scope below is a single `community_health` sub. Whether to instead (a) keep it single, (b) also ingest `wust-ytyg` as a sibling `mental_health` subcategory, or (c) split some other way is an **open decision for the user** — see Open questions.

### Category model

No new top-level category — in the **baseline scope**, a single `community_health` sub joins `pharmacy` / `urgent_care` / `hospital` in the `medical` category's `subs` list (the subdivision open question above may revise this). Records carry `category="medical"`, `subcategory="community_health"`. Pins inherit `medical`'s color (`var(--ember)`) and glyph (`+`). **No backend code change.**

### Chunks

1. **Env wiring.** Add `CDP_API_ENDPOINT_HEALTH_CENTERS` to `.env.example` (the classic-SODA `cjg8-dbka.json` URL) + the `_cdp_client.py` docstring.
2. **`build_health_centers.py` ingestion.** New script modeled on [`build_libraries.py`](../backend/scripts/build_libraries.py); read `facility` → name, `location_1.latitude`/`longitude` → coords, the `human_address` → address; `category="medical"`, `subcategory="community_health"`, `_source="cdp_health_centers"`; `merge_and_write`; commit the regenerated `places_curated.json`.
3. **Catalog wiring.** Add `{ key: "community_health", label: "Community health centers" }` to the `medical` category's `subs` in `exploreCategories.js`.
4. **Tests + docs.** `test_places` assertion for the `cdp_health_centers` source; CLAUDE.md updates; delete this entry and summarize in `FEATURE_HISTORY.md`.

### Files likely touched

`backend/scripts/build_health_centers.py` (new), `backend/scripts/_cdp_client.py` (docstring), `backend/.env.example`, `backend/data/places_curated.json`, `frontend/src/lib/exploreCategories.js`, `backend/tests/test_places.py`, `CLAUDE.md`.

### Open questions

- **Subcategory structure — open decision.** Per "Available metadata" above: keep a single `community_health` sub, or also ingest the separate `wust-ytyg` mental-health dataset as a sibling `mental_health` sub? The FQHC / Look-alike / neither split is available in the data but is not recommended as user-facing filters. No decision recorded yet — needs the user's call.
- **2014 staleness vs. a current source.** `cjg8-dbka` is authoritative for the *definition* but is a 2014 snapshot. The fresher alternative is **HRSA's Health Center Program data** (data.hrsa.gov) — the federal authoritative FQHC site list, kept current, with coordinates. Trade-off: HRSA is current but national (needs a Chicago-bbox filter) and uses HRSA's FQHC definition rather than CDPH's curated city list. Recommendation: ship v1 on `cjg8-dbka` (it directly answers the definition question and FQHC rosters are stable), and note HRSA as the refresh path if the 2014 data proves visibly wrong.
- **Curated-vs-OSM dedupe.** An FQHC also tagged `amenity=clinic` in OSM (ingested as `medical/urgent_care`) sits under a different subcategory but the same top-level `medical` category — `_load_all_sources` dedupes on `(category, lat_q, lon_q)`, so a co-located OSM clinic would be dropped in favor of the curated entry. This is the intended precedence (curated wins); confirm after the first ingest.
- **Multi-City Support.** Chicago-only CDP feed; the build script targets `places_curated_chicago.json` if Multi-City Support lands first.

### Definition of done

The Explorer's Medical category shows a "Community health centers" sub-checkbox; selecting it filters isochrone pins to the CDPH-listed primary-care community health centers; `places_curated.json` carries the source; tests + CLAUDE.md updated; this entry is moved to `FEATURE_HISTORY.md`.

---

## 6. Refresh Stale Farmers-Market Data

**Type:** Bolt-On | **Effort:** Low–Medium (depends on the source chosen) | **Area:** Backend + Data ingestion
**Depends on:** none.

**Why.** The Explorer's `grocery/farmers_market` subcategory is built from the City's "Farmers Markets - 2013" dataset (`i8y3-ytj4`), surfaced in the `/explore` response under the source key `farmers_markets_2013`. It is a ~13-year-old snapshot and should be refreshed.

### Research recorded (2026-05-20)

A first investigation pass established:

- **There is no current City of Chicago farmers-market dataset.** Every farmers-market feed on the Chicago Data Portal is stale — the newest, "Farmers Markets - 2015" (`x5xx-pszi`), was last updated May 2015; everything else is 2011–2013.
- **The 2015 dataset *does* carry coordinates.** [`build_farmers_markets.py`](../backend/scripts/build_farmers_markets.py)'s docstring claims the 2015 dataset "has no lat/lon" — that is **wrong**; `x5xx-pszi` has populated `latitude` / `longitude` columns (verified against sample rows). A 2013→2015 swap would therefore be trivial and need no geocoding.
- **The live 2025 schedule is not a structured feed.** The current DCASE Chicago Farmers Markets schedule is published only as a chicago.gov web page, with no stable scrapeable structure.
- **A current structured source exists federally.** The USDA National Farmers Market Directory (USDA Local Food Portal) offers a REST API + bulk CSV, geocoded, ~7,800 national listings, refreshed as market managers update entries — but it requires a (free) API key, is self-reported, and mixes city-run and private markets.

### No decision yet — more investigation needed

**The data source for the refresh is NOT yet decided.** More investigation is required before committing. Candidate sources, none chosen:

- **(a) CDP "Farmers Markets - 2015" (`x5xx-pszi`)** — trivial swap, coordinates present, but only a 2-year bump on an 11-year-old dataset; not actually current.
- **(b) USDA National Farmers Market Directory** — genuinely current and structured, but self-reported coverage of unknown completeness for Chicago, and needs an API key + a redistribution-terms check.
- **(c) Hand-curated annual list** — transcribe DCASE's published schedule into a checked-in JSON; most authoritative for city-run markets but needs manual yearly upkeep.
- **(d) Contact DCASE directly** — ask the Department of Cultural Affairs and Special Events whether the current schedule is available in a structured / exportable form not surfaced on the data portal.

### Investigation needed before a source is chosen

1. **USDA directory — coverage audit.** Pull the USDA directory for the Chicago bbox and compare its market list against the known 2013/2015 sets and the live DCASE 2025 schedule. How many real Chicago markets does it actually carry, and how stale are its entries?
2. **USDA directory — access + terms.** Confirm the API-key process and whether redistributing a baked snapshot in an open-source app is permitted.
3. **DCASE structured data.** Check whether DCASE (or ChicagoFarmersMarkets.us, the site DCASE points to) exposes the current schedule in any structured form — CSV, JSON, an embedded map data layer.
4. **Is 2015 worth it at all?** Decide whether a 2-year bump to an 11-year-old dataset is worth doing as an interim step, or whether the feature should wait for a genuinely current source.

### Likely shape once a source is picked

Regardless of source, the mechanical work is small and similar: update / extend [`build_farmers_markets.py`](../backend/scripts/build_farmers_markets.py) (swap `DATASET_URL` + `_extract_*`, or add a USDA client), keep `category="grocery"` / `subcategory="farmers_market"`, rename `SOURCE_KEY` away from `farmers_markets_2013` to a year-neutral `farmers_markets`, regenerate `places_curated.json`. Then update the `TestCuratedSources` assertion in `test_places.py` (line 130 references the literal `farmers_markets_2013`) and CLAUDE.md (the `places_curated.json` description + the `/explore` `source` enum, which documents `farmers_markets_2013`).

### Files likely touched

`backend/scripts/build_farmers_markets.py` (and possibly a new USDA client), `backend/data/places_curated.json` (regenerated), `backend/tests/test_places.py`, `CLAUDE.md`.

### Open questions

- **Source choice — open.** See "Investigation needed" above; no source is chosen yet. Nothing downstream should be built until this is settled.
- **`SOURCE_KEY` rename.** Renaming away from `farmers_markets_2013` is a deliberate change to a documented `/explore` `source` value. A grep confirms no *frontend* code keys off the literal string — it appears only in `test_places.py:130` and CLAUDE.md — but re-confirm before renaming. Year-neutral `farmers_markets` is recommended so a future refresh needs no further rename.
- **Multi-City Support.** If Multi-City Support lands first, the regenerated data lands in `places_curated_chicago.json`.

### Definition of done

A source has been chosen via the investigation above and recorded in this entry; `grocery/farmers_market` pins reflect that source instead of the 2013 snapshot; `build_farmers_markets.py` and its docstring are updated; the `SOURCE_KEY` / `/explore` `source` value is year-neutral; tests + CLAUDE.md updated; this entry is moved to `FEATURE_HISTORY.md`.

---

# Unscoped Notes

Rough ideas captured here so we don't lose them. Each one needs a scoping pass (open questions resolved, chunks defined) before it graduates into the "Chunked Implementation Plans" section above. **Do not start work from these notes directly** — scope first.

---

## Learned POI Autocomplete

**Type:** Bolt-On (probably) | **Effort:** TBD | **Area:** Backend

**Problem.** POI autocomplete is currently a frozen prefix-match against the in-memory index built from [backend/data/places_osm.json](backend/data/places_osm.json) + [backend/data/places_curated.json](backend/data/places_curated.json) at process start (see [backend/local_search.py:144-171](backend/local_search.py#L144-L171) and the prefix-match loop at [local_search.py:262-273](backend/local_search.py#L262-L273)). POIs that aren't in those baked files — new businesses, missing OSM tags, informal names — can never surface in typeahead. The only escape hatch today is to re-bake the data via [backend/scripts/](backend/scripts/), which has no answer for "the user just searched for a real place we don't know about."

**Rough idea.** When LocationIQ resolves a non-address query the local cascade missed, record it as a learned POI and merge it into the autocomplete index on subsequent process starts (and/or query-time). Storage candidate: a new `learned_pois` table in `chicago_geocode.db` alongside the existing `cached_forward` / `cached_reverse`. Sourced from broadening the [main.py:398-412](backend/main.py#L398-L412) autocomplete supplement gate beyond `_looks_like_free_text_address`, **or** from a separate write path on the `POST /route` forward cascade.

**Why this needs scoping before any code:**

- **Trust model.** LocationIQ happily returns *something* for almost any string; teaching the app from that is teaching it from noisy ground truth. Need a confidence threshold, a name-similarity check against the query, or a "seen N times" promotion rule before a learned entry shows up in autocomplete. Otherwise typos and garbage become first-class suggestions.
- **Write trigger.** Should learning fire from `/autocomplete` (broaden the supplement gate), from `/route` (only learn things users actually committed to as a stop), or both? Each has different abuse + noise profiles.
- **Index lifecycle.** The current `_poi_index` is built once per process. Do learned entries get merged at startup only (simple, requires restart to surface), or do we also patch the in-memory list on insert (more complex, threading implications)?
- **Decay / pruning.** Should learned entries expire? Get demoted if never re-queried? How do we keep this from becoming an unbounded junk drawer?
- **Privacy.** `cached_forward` already stores raw queries; this would extend that surface. Worth a quick look at whether any redaction policy applies.
- **Interaction with the existing `cached_forward` cache.** Today LocationIQ supplements *do* write to `cached_forward` ([geocoding.py:229](backend/geocoding.py#L229)) — but that table feeds `forward()`, not `autocomplete()`. Decide whether learned POIs are a new table, a column on `cached_forward`, or a view over it.
- **Multi-city implications.** If [Feature 1 — Multi-City Support](#1-multi-city-support) lands first, learned POIs need to be scoped per city.

**Alternative considered (and not chosen) today:** just re-bake the curated/OSM data on a cadence. That's the right answer when the dataset is stale, not when users want to teach the app. Both can coexist — this feature does not replace re-baking.

**Next step.** A future scoping session should answer the bullets above and produce a chunked plan. Until then, this note is a placeholder, not a green light.


