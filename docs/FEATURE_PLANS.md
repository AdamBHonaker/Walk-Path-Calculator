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
| 6 | Neighborhood Explorer (Isochrone) | Structural | High |
| 9 | Multi-City Support | Structural | Very High |

---

# Chunked Implementation Plans

---

## 6. Neighborhood Explorer (Isochrone)
**Type:** Structural | **Effort:** High | **Area:** Backend + Frontend

Given a start location and a time budget, render the polygon of everywhere reachable on foot within that budget ("isochrone" = equal-time contour) and surface curated places of interest inside it. Answers "what's around me on foot in 20 minutes?" rather than "how do I get to a known destination?"

### Start-point modes

The user picks one of two origins:

1. **Current location** — request the browser's `navigator.geolocation`. If permission is denied or coordinates fall outside the Chicago coverage area, fall back to mode 2.
2. **Community area** — dropdown of Chicago's 77 community areas. Selection uses each area's central point (centroid) as the origin. A new `backend/community_areas.py` constant maps `community_area_name → (lat, lon)`, sourced from the City of Chicago Community Areas open-data shapefile (compute centroids once at build time; check the resulting JSON into the repo).

### Algorithm

Dijkstra's on the existing igraph from the snapped origin node, bounded by `max_minutes × WALKING_SPEED_MPS × 60` (in meters). All nodes within budget form the "reachable set." This is one igraph call (`shortest_paths` or a custom bounded BFS) — fast even for 50k+ nodes.

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
| | Train Stations | — | OSM (`railway=station` filtered to CTA + Metra operators) |
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
3. **API endpoint.** `POST /explore` in [backend/main.py](backend/main.py) with request `{ origin: str | { community_area: str } | { lat: float, lon: float }, max_minutes: float (1–60), categories?: list[str], height_inches?: float }`. Cache responses in-memory via `lru_cache(maxsize=128)` keyed on `(snapped_origin_node_id, round(max_minutes))`. The polygon is independent of `categories` — only the place-list portion of the response varies — so cache the polygon separately from the place lookups.
4. **Performance check.** 30-minute isochrone in Chicago should hit ≤ 80k nodes. Add a `pytest` benchmark — must complete under 500 ms on the prod graph (polygon only; place lookups are additive).
5. **Place-data ingestion — OSM categories.** New module `backend/places.py`. Build a one-time ingestion script that pulls the OSM-sourced categories above via Overpass API for the Chicago bbox and writes them to `backend/data/places_osm.json` (checked into the repo; refresh quarterly). At request time, filter by polygon containment using a prebuilt R-tree index.
6. **Place-data ingestion — curated city feeds.** Separate ingestion scripts for each non-OSM source: `build_libraries.py` (Chicago Data Portal CPL dataset), `build_farmers_markets.py` (city seasonal feed). Output to `backend/data/places_curated.json`. Document the source URL and refresh cadence inside each script.
7. **Endpoint integration.** `/explore` resolves the requested `categories` against the merged OSM + curated dataset, returning `{ category, sub_category?, name, lat, lon, address?, source }` records, plus the residential heatmap as a separate GeoJSON `MultiPolygon`.
8. **Frontend — mode toggle.** New "Explore from here" mode. Replaces the To input with: (a) origin selector — radio between "📍 My location" and a "🏘️ Community area" dropdown of all 77 areas; (b) time-budget slider (5–45 min). Polygon rendered as a `fill` layer with `paint: { "fill-color": "#2d7a3e", "fill-opacity": 0.18 }`; stroke matches the path green.
9. **Frontend — category panel.** Collapsible group panels (Daily life, Food & drink, Outdoors, Culture, Living) with nested checkboxes per the table above. Selection state persists in `localStorage` so a returning user keeps their filter set. "Select all" / "Clear all" affordances at the panel level.
10. **Frontend — place rendering.** Symbol layers per category with distinct icons + colors; cluster at zoom < 14, expand at zoom ≥ 14. Residential Area renders as a separate heatmap layer above the polygon fill but below place pins. Clicking a pin opens a popover with name, address, and a "Walk here" button that exits explore mode and triggers a route fetch to that point.
11. **Frontend — neighborhood chips.** Reachable-neighborhood chips below the slider; clicking a chip exits explore mode, populates To, and triggers a normal route fetch.
12. **Edge cases.** Origin not snappable → 422; polygon area < 0.05 sq mi → "no walkable area" message (likely user picked a parking lot or unreachable point); polygon spans Lake Michigan → clip against a Chicago shoreline polygon if available, otherwise accept the visual artifact for v1 and document it; geolocation permission denied → fall back to community-area selector with an inline notice; community area centroid falls in a non-walkable spot (e.g., centroid of an irregular area lands on a highway median) → snap to nearest graph node within 200 m or return 422.

---

## 9. Multi-City Support
**Type:** Structural | **Effort:** Very High | **Area:** Backend + Frontend

The CLAUDE.md explicitly flags this as the stated long-term goal ("one city per game piece"). Each city has its own pre-built street graph; the user picks a city and all routing runs against that graph.

**Critical refactor: graph + geocoder become a registry, not module-level singletons.** Today, [backend/walking.py](backend/walking.py) loads a single graph at import time, and [backend/geocoding.py](backend/geocoding.py) hardcodes Chicago `NEIGHBORHOOD_COORDS`. Both must become per-city.

**Chunks:**
1. Define a `City` dataclass: `{ slug, display_name, graph_path, neighborhood_coords, bbox, default_center, default_zoom }`. Add `backend/cities.py` registering known cities.
2. Convert `walking._GRAPH` into `walking._GRAPHS: dict[str, Graph]` and rewrite all public functions to accept `city: str` as the first argument. Update `_compute_route` cache key to include city slug.
3. Convert `geocoding.NEIGHBORHOOD_COORDS` into a per-city dict; `resolve_location(query, city)`. Geocode cache file per city: `geocode_cache_{slug}.json`.
4. Build a second city graph via the existing `fetch_street_graph.py` pipeline. Smallest-viable target: Evanston (small, contiguous with Chicago bbox tooling). Upload as a release asset under the existing `street-graph` tag with a city-suffixed filename.
5. Update `Dockerfile` to download all city graphs declared in `cities.py`.
6. Add `city: str = "chicago"` to `RouteRequest` and `/explore` request. Default keeps existing API behavior.
7. Frontend: replace the static "📍 Chicago, IL" header pill with a dropdown sourced from a new `GET /cities` endpoint. Persist `city` to `localStorage`. On change: recenter the map to that city's `default_center` / `default_zoom`, clear current route, reset recent-search list scope (recent searches become per-city).
8. Tests: parametrize key backend tests across both cities. Frontend integration test: switching cities swaps map center.

---
