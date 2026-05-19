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

**Unscoped notes** (need a scoping pass before they become chunked plans):

- Learned POI autocomplete — see "Unscoped notes" section at the bottom of this file.

**Earlier bolt-on backend fixes & mobile polish:** see `FEATURE_HISTORY.md`. The Local-First Geocoding + LocationIQ Fallback feature shipped 2026-05-12 (chunks 1–5 code-complete; chunk 6 docs + cleanup landed alongside) and its entry now lives in [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md). Real-device mobile sign-off for the autocomplete component is tracked as the "Address autocomplete — Chunk 5 mobile sign-off checklist" in [`docs/MOBILE_TESTING.md`](docs/MOBILE_TESTING.md). The Tree Canopy Heatmap (formerly Feature 2) shipped 2026-05-14 — entry now in [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md), real-device sign-off tracked as PV-005 in [`Pending_Verification.md`](Pending_Verification.md). The Parks + Green-Space Heatmaps (formerly Feature 3) shipped 2026-05-14 — entry now in [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md), real-device sign-off tracked as PV-004 in [`Pending_Verification.md`](Pending_Verification.md). The Greenest Routing — Tree + Park Edge Weights feature (formerly Feature 4) shipped 2026-05-14 — entry now in [`FEATURE_HISTORY.md`](FEATURE_HISTORY.md), real-deploy verification tracked as PV-006 in [`Pending_Verification.md`](Pending_Verification.md).

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


