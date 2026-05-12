# Passage

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions, encouraging users to walk rather than take other transportation. Editorial broadsheet voice via the Wayfarer design system.

> **Note on naming.** Several internal identifiers (localStorage keys prefixed `walkpath:`, the `WPIcon` component, the `walkpath-icons.jsx` filename, MapLibre `walk-path` source IDs) keep the old prefix to avoid orphaning user data and cascading import churn. The user-facing brand is **Passage**.

> **Wayfarer design-system migration: Phase 1 complete as of 2026-05-05.** All checkpoints landed (foundation, primary components extracted, share card, loading/error states, map paint, project rename, voice rewrites, Cream/Dusk theme toggle, a11y sweep, final verification — 142/142 tests passing). See [`frontend/handoff/HANDOFF.md`](frontend/handoff/HANDOFF.md) "Phase 1 Progress" for completed checkpoints, spec departures, and decisions made outside the original spec.

## Project Structure

```
Passage/
├── backend/              # Python FastAPI
│   ├── main.py           # POST /route, POST /explore, GET /health, GET /reverse-geocode
│   ├── walking.py        # Street network routing (ported from CTA-Transit-PWA)
│   ├── geocoding.py      # Neighborhood lookup + Google Maps fallback (forward + reverse,
│   │                     #   shared circuit breaker, persisted cache)
│   ├── explore.py        # Bounded Dijkstra + concave-hull isochrone for /explore
│   ├── community_areas.py# 77-area centroid table + case-insensitive lookup
│   ├── places.py         # STRtree-backed place + residential-heatmap clipper for /explore
│   ├── steps.py          # Step count + calorie calculation utilities
│   ├── utils.py          # Haversine, WALKING_SPEED_MPH, METERS_PER_MILE, quantize_coord,
│   │                     #   Chicago bounding boxes, SERVICE_HIGHWAY_TYPES
│   ├── fetch_street_graph.py     # Build/refresh the pedestrian graph (osmnx → graphml → igraph pkl)
│   ├── data/             # Generated, checked-in datasets (community-area centroids,
│   │                     #   places_osm.json, places_curated.json, residential_polygons.json)
│   ├── scripts/          # One-shot ingestion scripts for the data/ files
│   ├── requirements.txt  # Production deps
│   ├── requirements-dev.txt      # Adds pytest + httpx for the test suite
│   ├── .env.example
│   └── tests/            # test_main, test_steps, test_utils, test_geocoding,
│                         #   test_community_areas, test_places, test_explore,
│                         #   test_explore_endpoint, test_explore_perf
│
├── docs/                 # Living feature/bug/debt logs (BUGS, Technical_Debt,
│                         #   Efficiency_Improvements, FEATURE_PLANS, FEATURE_HISTORY,
│                         #   MOBILE_TESTING; archive/RESOLVED_HISTORY)
│
├── scripts/
│   └── dev-tunnel.mjs    # Cross-platform Cloudflare-tunnel orchestrator for mobile dev
│
└── frontend/             # React + Vite + MapLibre GL
    ├── src/
    │   ├── App.jsx                # Main UI orchestration; viewport-aware desktop / mobile branches;
    │   │                          #   route ⇄ explore mode toggle
    │   ├── MapView.jsx            # Slim shell: maplibre.Map instance, unlock + locate buttons.
    │   │                          #   Layer effects live in map/{Route,Explore,Pick}Layer.jsx
    │   ├── map/                   # MapRouteLayer (polyline + draw-in animation + turn highlight),
    │   │                          #   MapExploreLayer (polygon / heatmap / clustered pins / popup),
    │   │                          #   MapPickLayer (pick-on-map preview marker + confirm card)
    │   ├── components/            # Masthead, Footer, DirectionLedger, RouteFlavorTabs,
    │   │                          #   CompareDispatch, ShareDispatch, PersonalizeModal,
    │   │                          #   MobileLayout (map-first bottom-sheet root),
    │   │                          #   PaceSelector, StepHero, RecentSearches,
    │   │                          #   WeeklySummaryPanel, LoadingSkeleton, ErrorDispatch,
    │   │                          #   RouteErrorBoundary, ExploreForm, ExploreCategoryPanel
    │   ├── wayfarer/              # Wayfarer design system (tokens, themes, primitives, forms,
    │   │                          #   icons, walkpath-icons, responsive utilities, motion)
    │   ├── hooks/                 # useTurnCoords (step-distance → [lat,lon] turn points),
    │   │                          #   useShareCard (share-modal lifecycle + PNG capture),
    │   │                          #   usePersonalization (height/weight/pace/goal + persistence),
    │   │                          #   useRouteFetch (route fetch + abort + recents + URL write),
    │   │                          #   useExploreFetch (explore fetch + abort + requestCategories),
    │   │                          #   useFollowLocation (watchPosition lifecycle for live map tracking)
    │   ├── compareEstimates.js    # Ride-share vs. walk cost/CO2 comparison
    │   ├── mapHelpers.js          # Map config, route paint (ink/ember), GeoJSON helpers,
    │   │                          #   renderExplore() for the isochrone layers, gesture lock/unlock
    │   ├── calorieEquiv.js        # Maps calories → food-equivalent strings
    │   ├── lib/
    │   │   ├── storage.js         # Safe local/sessionStorage wrappers (try/catch in one place)
    │   │   ├── recentSearches.js  # Persisted recent-routes list
    │   │   ├── stepLog.js         # 7-day step log persistence
    │   │   ├── directionFormat.js # formatStepLabel / formatBlocks / formatSteps
    │   │   ├── routeFormat.js     # Pace labels, motivation copy, plain-text directions
    │   │   ├── useMediaQuery.js   # React hook over window.matchMedia (SSR-safe)
    │   │   ├── sheetSnap.js       # Persisted bottom-sheet snap preference (mobile)
    │   │   ├── theme.js           # Cream / Dusk theme load + apply (mirrors index.html boot script)
    │   │   ├── geolocation.js     # navigator.geolocation wrapper w/ Chicago-bbox gating
    │   │   ├── backendUrl.js      # Resolves VITE_BACKEND_URL → BACKEND_URL constant
    │   │   ├── fetchWithTimeout.js# Shared fetch helper (route + explore timeouts)
    │   │   ├── units.js           # lbToKg / kgToLb conversions
    │   │   ├── urlParams.js       # ?stops= / ?from=&to= parsing + MAX_STOPS
    │   │   ├── personaPrefs.js    # localStorage loaders for height / weight / pace / goal / a11y
    │   │   ├── exploreApi.js      # POST /explore client w/ timeout + error normalization
    │   │   ├── exploreCategories.js # Catalog of category groups, colors, glyphs, subs
    │   │   ├── explorePrefs.js    # Persisted mode + explorer prefs (origin / minutes / selection)
    │   │   └── communityAreas.js  # 77 area names for the dropdown
    │   ├── App.css / index.css
    │   ├── main.jsx
    │   ├── test-setup.js
    │   └── *.test.{jsx,js}
    └── public/
        └── fonts/                 # Self-hosted Fraunces, Inter, JetBrains Mono
```

## Running Locally

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # add GOOGLE_MAPS_API_KEY if needed
uvicorn main:app --reload
```

The street graph (`street_graph.graphml` or `street_graph_igraph.pkl`) must be present in `backend/`. Copy it from `CTA-Transit-PWA/backend/` — it is the same graph.

### Frontend
```bash
cd frontend
npm install
npm run dev             # starts at http://localhost:5173
```

### Mobile testing (HTTPS, real device)
For testing on a real phone — especially for behaviors browsers gate on a secure context (PWA install, `navigator.geolocation` on iOS Safari, Web Share, clipboard) — use the tunnel orchestrator: `npm run dev:tunnel` from `frontend/`. It runs uvicorn + vite behind paired ephemeral Cloudflare tunnels and prints a public HTTPS URL. Setup, the security caveat, and an ngrok fallback live in [`docs/MOBILE_TESTING.md`](docs/MOBILE_TESTING.md).

## Key Design Decisions

- **Mobile UI is map-first.** Below 768 px the desktop two-column layout (`.layout` / `.panel-cards` / `.panel-map`) flips to a `MobileLayout` root: the map fills the viewport, a floating compact `Masthead` overlays the top, and form / results / directions live inside a draggable `WFSheet` (Wayfarer primitive) with three snap points — peek (140 px), half (50 dvh), full (88 dvh). A landscape variant retunes those to handle-only / 60 dvh / 100 dvh. The branch is gated by `useMediaQuery("(max-width: 768px)")` in `App.jsx`; above 768 px the desktop layout is unchanged. `MapView` accepts a `mapPadding` prop so `fitBounds` keeps the route polyline in the slice above the sheet.
- **Route ⇄ Explore mode.** Top-level `mode` state (persisted in `walkpath:mode`) flips between the original routing flow and the Neighborhood Explorer. Same `App.jsx` orchestrates both — only the sidebar/sheet content swaps (`routeContents` vs. `exploreContents`) and `MapView` switches paint layers based on the `mode` prop. Explore prefs (origin, time budget, category selection, expanded groups, residential-heatmap toggle) persist in `walkpath:explorePrefs` so the user lands back where they were. Mobile gets two ergonomic touches: the sheet auto-promotes from peek → half on first explore-mode entry, and a place-pin tap drops the sheet to peek so the popup isn't clipped. Explore mode unlocks pan/zoom by default — panning the polygon to look around is the whole point.
- **Theme toggle is user-facing.** Cream (default) and Dusk render as the `.theme-dusk` class on `<html>`. The toggle lives in `PersonalizeModal`'s "Display" section; the boot script in `frontend/index.html` reads `walkpath:theme` from localStorage on every page load to apply the class before React mounts (no FOUC). `frontend/src/lib/theme.js` is the single source of truth for load + apply.
- **Chicago-only for now.** The street graph is pre-built and stored locally; routing is instant. Coverage spans the full Chicago city limits (77 community areas). Future expansion: add new city graphs and a city picker UI (one city per "game piece").
- **Walking speed:** Routing is computed at 3 mph internally; the API response rescales `total_minutes` and per-direction `minutes` to the user's selected `pace` (`leisurely` 2 mph, `normal` 3 mph, `brisk` 4 mph).
- **Step formula:** `step_length_inches = height_inches × 0.413`. Default (no height): 2.5 ft (30 in). See `steps.py`.
- **Calorie formula:** `kcal = MET × weight_kg × 3.5 / 200 × minutes`. MET varies by pace (2.5/3.5/4.5). Default 70 kg reference body weight when `weight_kg` is unset; the response sets `personalized_calories: true` when the user supplied a weight.
- **Route flavors:** Three alternatives are computed for every 2-stop route — `fastest` (default), `fewest_turns`, and `greenest` (prefers footways/paths). Multi-stop routes always use `fastest`. When `avoid_stairs` or `prefer_pedestrian` is true, the response collapses to a single `custom` flavor.
- **Routing prefs:** `avoid_stairs` adds a large per-edge penalty to OSM `highway=steps` edges. `prefer_pedestrian` routes under the existing `greenest` flavor (footway/path/cycleway discount).
- **Multi-stop routing:** Accepts 2–8 ordered stops. Legs are routed independently and stitched into one continuous path. The `legs` array in the response breaks down per-segment stats.
- **Pick-on-map:** `GET /reverse-geocode?lat=X&lon=Y` resolves a clicked map point to a street address or neighborhood name, used to set origin/destination without typing.
- **No transit data.** This project has zero dependency on GTFS, CTA APIs, or the transit graph. The pedestrian street graph and OSM-tag-derived place data are the only spatial inputs.
- **Geocoding:** Neighborhood/landmark name lookup is instant and offline. Street addresses fall back to Google Maps Geocoding API (requires key in `.env`). The geocode cache is written to `backend/geocode_cache.json`.

## API

### `GET /health`
Returns `{"status": "ok"}`.

### `GET /reverse-geocode?lat=41.95&lon=-87.65`
Returns a street address or neighborhood name for the given coordinates (must be within the Chicago coverage area).

### `POST /explore`

Walkable-isochrone endpoint for the Neighborhood Explorer (chunks 1–11 of 12 landed; only edge-case polish remains). Returns the alpha-shape polygon of every street-graph vertex reachable on foot from the origin within `max_minutes`, the Chicago neighborhoods whose centroids fall inside it, the matching places filtered by category, and a residential-area heatmap geometry.

Request — exactly one of the two origin modes:
```json
{ "origin": { "community_area": "Logan Square" }, "max_minutes": 20 }
```
```json
{ "origin": { "lat": 41.9088, "lon": -87.6796 }, "max_minutes": 20 }
```

| Field                    | Type                | Notes                                    |
| ------------------------ | ------------------- | ---------------------------------------- |
| `origin.community_area`  | string              | Case-insensitive; must match one of the 77 names in `community_areas.COMMUNITY_AREA_CENTROIDS`. |
| `origin.lat` / `lon`     | number              | Must be inside the Chicago bbox; snapped to the pedestrian graph or 422. |
| `max_minutes`            | number, 5–45        | Time budget. Routing uses the canonical 3 mph constant (`WALKING_SPEED_MPH`). |
| `categories`             | list[str], optional | Filters `places` to the named top-level categories. Omit (or send `null`) to get every place inside the polygon — useful for debugging, not the frontend's default. Subcategory keys are *not* accepted at this layer; the frontend post-filters. |
| `height_inches`          | number, 36–108, optional | Accepted but unused (reserved for future step-count enrichment). |

Place categories (top-level keys, matched against `places.category`):
`grocery`, `medical`, `train_stations`, `gyms_fitness`, `coffee_bakery`, `restaurants`, `bars_nightlife`, `parks`, `art_museums`, `theaters`, `bookstores`, `schools`, `places_of_worship`, `libraries`. Several have subcategories tagged on individual records (e.g., `medical/pharmacy`, `parks/playground`, `places_of_worship/christianity`, `grocery/farmers_market`).

Response:
```json
{
  "origin_coords": [41.9248, -87.7012],
  "max_minutes": 20,
  "polygon": { "type": "Polygon", "coordinates": [[[lon, lat], ...]] },
  "reachable_neighborhoods": ["Logan Square", "Avondale", "Bucktown", ...],
  "stats": { "node_count": 12407, "area_sq_mi": 1.84 },
  "places": [
    {
      "category": "coffee_bakery",
      "subcategory": null,
      "name": "Heritage Outpost",
      "lat": 41.9213,
      "lon": -87.6987,
      "address": "2032 W Armitage Ave",
      "source": "osm"
    }
  ],
  "residential_heatmap": { "type": "MultiPolygon", "coordinates": [...] }
}
```
`source` is one of `osm`, `cpl_locations`, `farmers_markets_2013` (curated source key). `residential_heatmap` is `null` for isochrones with no `landuse=residential` overlap.

### `POST /route`

Request — use either `stops` (primary, 2–8 entries) or the `origin`/`destination` shorthand. Personalization fields are all optional:
```json
{
  "stops": ["Wrigleyville", "Bucktown", "Logan Square"],
  "height_inches": 69,
  "weight_kg": 70,
  "pace": "brisk",
  "daily_goal": 12000,
  "avoid_stairs": false,
  "prefer_pedestrian": false
}
```
```json
{
  "origin": "Wrigleyville",
  "destination": "Logan Square",
  "height_inches": 69
}
```

| Field               | Type                          | Default       | Notes                                            |
| ------------------- | ----------------------------- | ------------- | ------------------------------------------------ |
| `height_inches`     | number, 36–108                | unset         | Drives personalized stride length.               |
| `weight_kg`         | number, 30–300                | 70 (default)  | Sets `personalized_calories: true` when present. |
| `pace`              | `"leisurely"`/`"normal"`/`"brisk"` | `"normal"` | Rescales `total_minutes` + per-direction `minutes`; affects MET-based calories. |
| `daily_goal`        | int, 1 000–100 000            | 10 000        | Drives `daily_goal_pct`.                         |
| `avoid_stairs`      | bool                          | `false`       | Penalizes `highway=steps` edges; collapses to a `custom` flavor. |
| `prefer_pedestrian` | bool                          | `false`       | Routes under `greenest` flavor; collapses to a `custom` flavor. |

Response (2-stop — `routes` array contains one entry per flavor):
```json
{
  "stops": ["Wrigleyville", "Logan Square"],
  "stop_coords": [[41.9476, -87.6553], [41.9290, -87.7000]],
  "origin_coords": [41.9476, -87.6553],
  "dest_coords": [41.9290, -87.7000],
  "step_length_inches": 28.5,
  "personalized": true,
  "personalized_calories": true,
  "pace": "normal",
  "default_flavor": "fastest",
  "available_flavors": ["fastest", "fewest_turns", "greenest"],
  "routes": [
    {
      "flavor": "fastest",
      "path": [[lat, lon], ...],
      "directions": [...],
      "total_miles": 2.8,
      "total_minutes": 56.0,
      "total_steps": 5880,
      "calories_approx": 241,
      "daily_goal_pct": 59
    }
  ],
  "total_miles": 2.8,
  "total_minutes": 56.0,
  "total_steps": 5880,
  "calories_approx": 241,
  "daily_goal_pct": 59,
  "path": [[lat, lon], ...],
  "directions": [...]
}
```

Response (multi-stop — `routes` has exactly one entry; adds `legs`):
```json
{
  "stops": ["A", "B", "C"],
  "stop_coords": [...],
  "default_flavor": "fastest",
  "available_flavors": ["fastest"],
  "routes": [{ "flavor": "fastest", "legs": [...], ... }],
  "legs": [
    { "from_label": "A", "to_label": "B", "miles": 1.2, "minutes": 24.0,
      "steps": 2520, "calories_approx": 103, "path_slice": [0, 47] }
  ],
  ...
}
```

Direction step object (present in all route types):
```json
{ "street": "Clark St", "path_type": "path", "direction": "S",
  "direction_full": "South", "blocks": 2.0, "block_type": "long",
  "minutes": 3.1, "distance_meters": 249.0,
  "distance_miles": 0.155, "steps": 325 }
```
Multi-stop direction steps additionally include `"leg_index": 0`.

## Porting Notes

`walking.py` and `utils.py` are direct ports from `CTA-Transit-PWA/backend/` with minor additions:
- `walking.py` adds `distance_meters` to each direction step (passed through to the response; `main.py` computes `distance_miles` from `minutes` independently)
- `utils.py` defines `WALKING_SPEED_MPH`; `walking.py` imports it from there (single source of truth)
- `utils.py` removes the CTA-specific `TRANSFER_PENALTY_MINUTES` constant

`geocoding.py` extracts only the geocoding logic from `CTA-Transit-PWA/backend/gtfs_loader.py` (NEIGHBORHOOD_COORDS, fuzzy matching, Google Maps geocoding). None of the GTFS/stop-loading code is included.
