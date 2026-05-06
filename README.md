# Passage

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions — built to encourage walking over transit. Editorial broadsheet voice via the Wayfarer design system.

**Live app:** https://wayfarer-passage.vercel.app/

## Status

- **Frontend design system** — Wayfarer Phase 1 complete (2026-05-05): foundation tokens, primitives, components, share card, loading/error states, map paint, voice rewrites, Cream/Dusk theme toggle, a11y sweep.
- **Backend** — `/route` (multi-stop, alternative flavors, personalization), `/explore` (Neighborhood Explorer isochrones), `/reverse-geocode`, `/health` all live.
- **Neighborhood Explorer** — chunks 1–11 of 12 shipped (backend core, community-area centroids, endpoint, perf gates, OSM + curated place ingestion, residential heatmap, mode toggle, category panel, place rendering, neighborhood chips). Edge-case polish (chunk 12) is the only outstanding work.
- **Mobile UI** — map-first composition (full-bleed map + draggable bottom sheet) below 480 px; tablet sidebar variant for 481–1023 px; desktop two-column above.
- **Bugs** — none open. See [`docs/BUGS.md`](docs/BUGS.md) and [`docs/archive/RESOLVED_HISTORY.md`](docs/archive/RESOLVED_HISTORY.md).

## Features

### Routing
- Instant offline routing on a pre-built Chicago street graph (full city limits, 77 community areas)
- Multi-stop routes — 2–8 ordered stops stitched into one continuous walk with per-leg breakdown
- Three route flavors for 2-stop trips: `fastest` (default), `fewest_turns`, `greenest` (favors footways/paths)
- Routing prefs: `avoid_stairs` (penalizes OSM `highway=steps`) and `prefer_pedestrian` (routes via `greenest`)
- Step count personalized by height (`step_length_inches = height_inches × 0.413`); 30-inch default
- Calorie estimate via standard MET formula, scaled by user weight + chosen pace (Strolling 2 mph / Steady 3 mph / Earnest 4 mph)
- Custom daily step goal (1 000–100 000); response includes `daily_goal_pct`

### Map & directions
- MapLibre GL map with route drawn in ink (ember on the share card), animated draw-in (line-trim-offset), and per-turn highlight markers
- Turn-by-turn `DirectionLedger` with per-segment steps, distance, time, and click-to-fly-to-turn
- Pick-on-map: tap any stop's pin button to drop a marker, reverse-geocode it, and confirm
- "Use my current location" floating action (HTTPS / secure-context required for `navigator.geolocation`)
- Shareable PNG route card (rendered off-screen at 480 px design width regardless of viewport)
- Rideshare cost & CO₂ comparison vs. walking
- Plain-text "Copy directions" button
- Recent searches (10 most recent, persisted) and 7-day step log with weekly progress bar

### Neighborhood Explorer
- Walkable-isochrone polygon (concave hull of all reachable street-graph nodes) for a 5–45 minute budget
- Origin = browser geolocation **or** any of Chicago's 77 community areas
- Filterable place pins across 14 top-level categories (groceries, medical, train stations, gyms, coffee/bakery, restaurants, bars, parks, art/museums, theaters, bookstores, schools, places of worship, libraries) with subcategories where tagged
- Residential-area heatmap overlay (toggleable)
- "Within reach" neighborhood chips that hand off back to the routing flow

### UX & PWA
- **Theme toggle** — Cream (default, bone-white paper) and Dusk (lamplit deep ink), persisted to localStorage and applied pre-mount to avoid FOUC
- **Mobile bottom sheet** — three snap points (peek/half/full), velocity-aware flick handoff, drag-from-body with scroll handoff, snap memory, haptic on settle, landscape-orientation re-tune
- **PWA** — installable, service worker via `vite-plugin-pwa`
- **Code-splitting** — initial bundle is ~70 KB gzip (form-only); MapLibre + share card lazy-load on demand

## Project Structure

```
Passage/
├── backend/                       # Python FastAPI
│   ├── main.py                    # POST /route, POST /explore, GET /health, GET /reverse-geocode
│   ├── walking.py                 # Street network routing (igraph, alternatives, custom prefs)
│   ├── geocoding.py               # Forward + reverse geocoding (neighborhood lookup → fuzzy → Google),
│   │                              #   shared circuit breaker on Google 429/OVER_QUERY_LIMIT
│   ├── explore.py                 # Bounded Dijkstra + concave-hull isochrone (cached)
│   ├── community_areas.py         # 77-area centroid table + case-insensitive lookup
│   ├── places.py                  # STRtree-backed place + residential-heatmap clipper
│   ├── steps.py                   # Step length, step count, MET-based calories
│   ├── utils.py                   # Haversine, WALKING_SPEED_MPH, METERS_PER_MILE, Chicago bboxes
│   ├── fetch_street_graph.py      # Build/refresh the pedestrian graph (osmnx → graphml → igraph pkl)
│   ├── data/                      # Generated, checked-in datasets
│   │   ├── community_area_centroids.json
│   │   ├── places_osm.json        # ~9 000 OSM places (refresh quarterly)
│   │   ├── places_curated.json    # CPL libraries + 2013 farmers markets
│   │   └── residential_polygons.json
│   ├── scripts/                   # One-shot ingestion scripts for data/*
│   │   ├── build_community_area_centroids.py
│   │   ├── build_places_osm.py
│   │   ├── build_libraries.py
│   │   ├── build_farmers_markets.py
│   │   ├── build_residential.py
│   │   └── _curated_common.py
│   ├── tests/                     # 9 pytest modules covering routing, geocoding, explore, places
│   ├── requirements.txt
│   ├── requirements-dev.txt       # adds pytest + httpx
│   ├── Dockerfile / railway.toml
│   └── .env.example
│
├── docs/                          # Living feature/bug/debt logs
│   ├── BUGS.md                    # Open bugs (currently none)
│   ├── Technical_Debt.md          # Open debt
│   ├── Efficiency_Improvements.md # Open perf opportunities
│   ├── FEATURE_PLANS.md           # Chunked plans for upcoming features
│   ├── FEATURE_HISTORY.md         # Shipped feature log
│   ├── MOBILE_TESTING.md          # LAN + tunnel HTTPS setup
│   └── archive/RESOLVED_HISTORY.md
│
├── scripts/
│   └── dev-tunnel.mjs             # Cross-platform Cloudflare-tunnel orchestrator
│
└── frontend/                      # React 18 + Vite 6 + MapLibre GL 4
    ├── src/
    │   ├── App.jsx                # UI orchestration, viewport branches, route ⇄ explore mode
    │   ├── MapView.jsx            # Slim shell: map instance, unlock + locate buttons
    │   ├── map/                   # MapRouteLayer · MapExploreLayer · MapPickLayer
    │   ├── components/            # Masthead · Footer · DirectionLedger · RouteFlavorTabs
    │   │                          # · CompareDispatch · ShareDispatch · PersonalizeModal
    │   │                          # · MobileLayout · PaceSelector · StepHero · RecentSearches
    │   │                          # · WeeklySummaryPanel · LoadingSkeleton · ErrorDispatch
    │   │                          # · RouteErrorBoundary · ExploreForm · ExploreCategoryPanel
    │   ├── wayfarer/              # Design system: tokens · themes · primitives · forms · icons
    │   │                          # · walkpath-icons · responsive · motion (+ WFSheet bottom sheet)
    │   ├── lib/                   # storage · recentSearches · stepLog · directionFormat
    │   │                          # · routeFormat · useMediaQuery · sheetSnap · theme
    │   │                          # · geolocation · backendUrl · fetchWithTimeout · units
    │   │                          # · urlParams · personaPrefs · communityAreas
    │   │                          # · exploreApi · exploreCategories · explorePrefs
    │   ├── hooks/useTurnCoords.js
    │   ├── compareEstimates.js · calorieEquiv.js · mapHelpers.js
    │   ├── App.css / index.css
    │   ├── main.jsx · test-setup.js
    │   └── *.test.{jsx,js}        # vitest + @testing-library/react
    └── public/
        └── fonts/                 # Self-hosted Fraunces · Inter · JetBrains Mono
```

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- The Chicago pedestrian street graph (`street_graph.graphml`, ~79 MB) — not in this repo due to size. Copy it from `CTA-Transit-PWA/backend/`. A faster `street_graph_igraph.pkl` is built automatically from the graphml on first run (and during the Docker image build).

### Backend

```bash
cd backend
pip install -r requirements.txt
pip install -r requirements-dev.txt   # local dev: adds pytest + httpx
cp .env.example .env                  # add GOOGLE_MAPS_API_KEY for street-address geocoding
```

Place `street_graph.graphml` in `backend/`, then:

```bash
uvicorn main:app --reload
```

API at `http://localhost:8000`. Run the tests with `pytest` from `backend/`.

### Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
npm test                  # vitest run
npm run build             # production bundle
```

### Mobile testing (HTTPS, real device)

For testing on a real phone — especially behaviors browsers gate on a secure context (PWA install, `navigator.geolocation` on iOS Safari, Web Share, clipboard) — use the tunnel orchestrator:

```bash
cd frontend
npm run dev:tunnel
```

This runs uvicorn + vite behind paired ephemeral Cloudflare tunnels and prints a public HTTPS URL. Setup, the security caveat, and an ngrok fallback are in [`docs/MOBILE_TESTING.md`](docs/MOBILE_TESTING.md).

## API

Rate limits (per IP, env-tunable): `/health` 60/min · `/reverse-geocode` 30/min · `/route` 10/min · `/explore` 10/min.

### `GET /health`

Returns `{"status": "ok"}`.

### `GET /reverse-geocode?lat=41.95&lon=-87.65`

Returns `{label, source}` for the given coordinates. `source ∈ {"neighborhood", "google", "coordinates"}`. Coordinates must fall within the Chicago coverage area (422 otherwise).

### `POST /route`

Use either `stops` (primary, 2–8 entries) or the `origin`/`destination` shorthand. All personalization fields are optional.

**Request:**
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

| Field               | Type                               | Default   | Notes                                            |
| ------------------- | ---------------------------------- | --------- | ------------------------------------------------ |
| `stops`             | list[str], 2–8                     | —         | Each ≤ 200 chars; trimmed; duplicates rejected.  |
| `origin`/`destination` | str                             | —         | Legacy 2-stop shorthand; normalized into `stops`.|
| `height_inches`     | number, 36–108                     | unset     | Drives personalized stride length.               |
| `weight_kg`         | number, 30–300                     | 70        | Sets `personalized_calories: true` when present. |
| `pace`              | `"leisurely"` / `"normal"` / `"brisk"` | `"normal"` | Rescales `total_minutes` + per-direction `minutes`; affects MET-based calories. |
| `daily_goal`        | int, 1 000–100 000                 | 10 000    | Drives `daily_goal_pct`.                         |
| `avoid_stairs`      | bool                               | `false`   | Penalizes `highway=steps` edges; collapses `available_flavors` to `["custom"]`. |
| `prefer_pedestrian` | bool                               | `false`   | Routes under `greenest`; collapses to a `custom` flavor. |

**Response (2-stop — `routes` has one entry per available flavor):**
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
      "path": [[41.9476, -87.6553], "..."],
      "directions": ["..."],
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
  "path": [[41.9476, -87.6553], "..."],
  "directions": ["..."]
}
```

The top-level `total_*`, `path`, and `directions` mirror the `default_flavor` route — older clients that ignore `routes` keep working.

**Response (multi-stop — `routes` has exactly one entry forced to `fastest`; adds `legs`):**
```json
{
  "stops": ["A", "B", "C"],
  "stop_coords": ["..."],
  "default_flavor": "fastest",
  "available_flavors": ["fastest"],
  "routes": [{ "flavor": "fastest", "legs": ["..."], "...": "..." }],
  "legs": [
    {
      "from_label": "A", "to_label": "B",
      "miles": 1.2, "minutes": 24.0,
      "steps": 2520, "calories_approx": 103,
      "path_slice": [0, 47]
    }
  ]
}
```

**Direction step object:**
```json
{
  "street": "Clark St",
  "path_type": "path",
  "direction": "S",
  "direction_full": "South",
  "blocks": 2.0,
  "block_type": "long",
  "minutes": 3.1,
  "distance_meters": 249.0,
  "distance_miles": 0.155,
  "steps": 325
}
```
Multi-stop direction steps additionally include `"leg_index": 0`.

### `POST /explore`

Walkable-isochrone endpoint for the Neighborhood Explorer. Returns the alpha-shape polygon of every street-graph vertex reachable on foot from the origin within `max_minutes`, the Chicago neighborhoods whose centroids fall inside it, the matching places filtered by category, and a residential-area heatmap geometry.

**Request — exactly one of the two origin modes:**
```json
{ "origin": { "community_area": "Logan Square" }, "max_minutes": 20 }
```
```json
{ "origin": { "lat": 41.9088, "lon": -87.6796 }, "max_minutes": 20, "categories": ["coffee_bakery", "parks"] }
```

| Field                   | Type                     | Notes                                           |
| ----------------------- | ------------------------ | ----------------------------------------------- |
| `origin.community_area` | string                   | Case-insensitive; one of the 77 area names.     |
| `origin.lat` / `lon`    | number                   | Must be inside the Chicago bbox; snapped to the pedestrian graph or 422. |
| `max_minutes`           | number, 5–45             | Time budget. Routing uses the canonical 3 mph.  |
| `categories`            | list[str], optional      | Filters `places` to the named top-level categories. Omit/null returns every place inside the polygon. Subcategory keys are not accepted at this layer. |
| `height_inches`         | number, 36–108, optional | Reserved for future step-count enrichment.      |

Top-level place categories (matched against `places.category`):
`grocery`, `medical`, `train_stations`, `gyms_fitness`, `coffee_bakery`, `restaurants`, `bars_nightlife`, `parks`, `art_museums`, `theaters`, `bookstores`, `schools`, `places_of_worship`, `libraries`. Several have subcategories on individual records (`medical/pharmacy`, `parks/playground`, `places_of_worship/christianity`, `grocery/farmers_market`, …).

**Response:**
```json
{
  "origin_coords": [41.9248, -87.7012],
  "max_minutes": 20,
  "polygon": { "type": "Polygon", "coordinates": [[[-87.7012, 41.9248], "..."]] },
  "reachable_neighborhoods": ["Logan Square", "Avondale", "Bucktown"],
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
  "residential_heatmap": { "type": "MultiPolygon", "coordinates": ["..."] }
}
```

`source` is one of `"osm"`, `"cpl_locations"`, `"farmers_markets_2013"`. `residential_heatmap` is `null` for isochrones with no `landuse=residential` overlap.

## Notes

- **Chicago only** — the street graph is built and stored locally. A multi-city refactor (`backend/cities.py` + per-city graphs and adjacency-aware cross-city routing) is scoped in [`docs/FEATURE_PLANS.md`](docs/FEATURE_PLANS.md) but not started; Evanston is the planned second city.
- **Walking speed** — Routing is computed at 3 mph internally; the response rescales `total_minutes` and per-direction `minutes` to the user's chosen pace.
- **Step formula** — `step_length_inches = height_inches × 0.413`. Default: 30 inches (~5'10" male average).
- **Calorie formula** — `kcal = MET × weight_kg × 3.5 / 200 × minutes`. MET varies by pace (2.5 / 3.5 / 4.5). Reference body weight 70 kg when `weight_kg` is unset; the response sets `personalized_calories: true` when the user supplied a weight.
- **Route flavors** — Three alternatives are computed only for 2-stop routes. Multi-stop routes always use `fastest`. Setting `avoid_stairs` or `prefer_pedestrian` collapses the response to a single `custom` flavor.
- **Geocoding** — Neighborhood/landmark name lookup is instant and offline. Street addresses fall back to Google Maps Geocoding (key required). Forward and reverse calls share a circuit breaker that opens on HTTP 429 / `OVER_QUERY_LIMIT` (60 → 120 → 240 s, capped at 300 s). Resolved entries are cached to `backend/geocode_cache.json` (gitignored).
- **No transit data** — zero dependency on GTFS, CTA APIs, or any transit graph. The pedestrian street graph and OSM-tag-derived place data are the only spatial inputs.
- **Naming** — Several internal identifiers (localStorage keys prefixed `walkpath:`, the `WPIcon` component, `walkpath-icons.jsx`, MapLibre `walk-path` source IDs) keep the old prefix to avoid orphaning user data and cascading import churn. The user-facing brand is **Passage**.
