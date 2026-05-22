# Passage

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions — built to encourage walking over transit. Editorial broadsheet voice via the Wayfarer design system.

**Live app:** https://wayfarer-passage.vercel.app/

## Status

- **Frontend design system** — Wayfarer Phase 1 complete (2026-05-05): foundation tokens, primitives, components, share card, loading/error states, map paint, voice rewrites, Cream/Dusk theme toggle, a11y sweep.
- **Backend** — `/route` (multi-stop, alternative flavors, personalization), `/explore` (Neighborhood Explorer isochrones), `/reverse-geocode`, `/health` all live.
- **Neighborhood Explorer** — fully shipped 2026-05-11. Backend isochrone + curated/OSM places + residential heatmap + Lake Michigan shoreline clip; frontend mode toggle, category panel, clustered place pins, neighborhood chips, geolocation-denied fallback, "no walkable area" notice for degenerate origins. See [`docs/FEATURE_HISTORY.md`](docs/FEATURE_HISTORY.md) for the full build narrative.
- **Mobility profile** — Walking / Wheeled segmented control in `PersonalizeModal` (shipped 2026-05-12). Wheeled is the source of truth for accessibility routing; the rest of the UI reframes to miles + minutes.
- **Chicago Data Portal integration** — libraries, CPS schools, CPD police stations, CFD fire stations, CPD park boundaries ingested via authenticated SODA (shipped 2026-05-12).
- **Local-first geocoding + LocationIQ fallback** — five-tier cascade (regex → neighborhoods → fuzzy → SQLite/FTS5 over 519k OSM addresses + 45k cross-streets + curated POIs → LocationIQ) backing `/route`, `/explore`, `/reverse-geocode`, and `/autocomplete`. Shipped 2026-05-12; live-key behavior pending sign-off as PV-002.
- **Heatmap overlays for the Explorer** — three optional layers alongside the existing residential heatmap: **Tree canopy** (OSM `natural=tree` baked into a 50 m KDE grid; shipped 2026-05-14), **CPD park footprints** (authoritative Chicago Park District polygons with per-park name + acres), and **Other green space** (OSM cemeteries / golf / nature reserves / recreation grounds). Parks + green-space shipped 2026-05-14. All three default OFF; mobile real-device sign-off pending as PV-004 / PV-005.
- **Greenest routing — tree + park edge weights** — the `greenest` flavor's weight function now combines OSM footway/path tags with per-edge tree-canopy density and park-proximity (with park-size weighting), both baked into the street-graph pickle. Shipped 2026-05-14; production-deploy verification pending as PV-006. See [`docs/FEATURE_HISTORY.md`](docs/FEATURE_HISTORY.md).
- **Open plans** — Multi-City Support (Feature 1) remains scoped but unstarted in [`docs/FEATURE_PLANS.md`](docs/FEATURE_PLANS.md).
- **Mobile UI** — map-first composition (full-bleed map + draggable bottom sheet) below 480 px; tablet sidebar variant for 481–1023 px; desktop two-column above.
- **Bugs** — none open. See [`docs/BUGS.md`](docs/BUGS.md) and [`docs/archive/RESOLVED_HISTORY.md`](docs/archive/RESOLVED_HISTORY.md).

## Features

### Routing
- Instant offline routing on a pre-built Chicago street graph (full city limits, 77 community areas)
- Multi-stop routes — 2–8 ordered stops stitched into one continuous walk with per-leg breakdown
- Three route flavors for 2-stop trips: `fastest` (default), `fewest_turns`, `greenest` (favors footways/paths plus tree-canopy + park-adjacent edges via FEAT-4's combined signal)
- Routing prefs: `avoid_stairs` (penalizes OSM `highway=steps`) and `prefer_pedestrian` (routes via `greenest`)
- **Mobility profile** — Walking (default) / Wheeled in `PersonalizeModal`. Wheeled is the source of truth for accessibility routing: forces `avoid_stairs=true`, pins pace to `normal`, swaps step-count UI to miles + minutes (calories hidden), and toggles user-facing copy from "walked" to "rolled" without overwriting saved walking prefs.
- Step count personalized by height (`step_length_inches = height_inches × 0.413`); 30-inch default
- Calorie estimate via standard MET formula, scaled by user weight + chosen pace (`leisurely` 2 mph / `normal` 3 mph / `brisk` 4 mph — UI labels: Strolling / Steady / Earnest)
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
- Filterable place pins across 16 top-level categories (groceries, medical, train stations, gyms, coffee/bakery, restaurants, bars, parks, art/museums, theaters, bookstores, schools, places of worship, libraries, police stations, fire stations) with subcategories where tagged
- Four toggleable heatmap overlays — **Residential areas** (OSM `landuse=residential`, default ON), **Tree canopy** (3 density bands baked from OSM `natural=tree` via KDE), **CPD park footprints** (saturated `--field` green, name + acres per park), and **Other green space** (softer moss wash — OSM cemeteries / golf / nature reserves / recreation grounds). Layered z-order picks parks above green-space so authoritative CPD wins on overlap.
- "Within reach" neighborhood chips that hand off back to the routing flow

### UX & PWA
- **Theme toggle** — Cream (default, bone-white paper) and Dusk (lamplit deep ink), persisted to localStorage and applied pre-mount to avoid FOUC
- **Mobility profile** — Walking / Wheeled segmented control in `PersonalizeModal` reframes the personal-progress metric and accessibility routing prefs; persisted under `walkpath:mobilityProfile`
- **Mobile bottom sheet** — three snap points (peek/half/full), velocity-aware flick handoff, drag-from-body with scroll handoff, snap memory, haptic on settle, landscape-orientation re-tune
- **PWA** — installable, service worker via `vite-plugin-pwa`
- **Code-splitting** — initial bundle is ~70 KB gzip (form-only); MapLibre + share card lazy-load on demand

## Project Structure

```
Passage/
├── backend/                       # Python FastAPI
│   ├── main.py                    # POST /route, POST /explore, GET /health,
│   │                              #   GET /reverse-geocode, GET /autocomplete
│   ├── walking.py                 # Street network routing (igraph, alternatives, custom prefs).
│   │                              #   `greenest` flavor combines OSM footway tags with per-edge
│   │                              #   tree-canopy + park-proximity signals baked into the v3 pickle.
│   ├── geocoding.py               # Local-first cascade: NEIGHBORHOOD_COORDS exact → fuzzy →
│   │                              #   local_search.forward (SQLite FTS5) → LocationIQ /v1/search;
│   │                              #   shared 429 circuit breaker on LocationIQ
│   ├── explore.py                 # Bounded Dijkstra + concave-hull isochrone (cached)
│   ├── community_areas.py         # 77-area centroid table + case-insensitive lookup
│   ├── places.py                  # STRtree-backed place + residential-heatmap clipper
│   ├── parks.py                   # STRtree-backed CPD park-footprint clipper (name + acres)
│   ├── green_space.py             # STRtree-backed non-CPD green-space clipper
│   │                              #   (cemetery / golf_course / nature_reserve / recreation_ground)
│   ├── tree_canopy.py             # Sparse-KDE canopy clipper — emits 3 density bands
│   ├── heatmap_clipper.py         # Shared polygon-clip helper used by parks/green_space
│   ├── steps.py                   # Step length, step count, MET-based calories
│   ├── utils.py                   # Haversine, WALKING_SPEED_MPH, METERS_PER_MILE, Chicago bboxes
│   ├── fetch_street_graph.py      # Build/refresh the pedestrian graph (osmnx → graphml → igraph pkl).
│   │                              #   `_bake_green_signals` computes per-edge canopy + park scores
│   │                              #   from the tree-canopy + parks artifacts at bake time (FEAT-4).
│   ├── geocode_text.py            # Shared address/street normalize helpers (used by ingestion +
│   │                              #   runtime local_search)
│   ├── local_search.py            # Tier-1/2 lookup: in-memory neighborhoods + POIs + SQLite FTS5
│   │                              #   addresses + intersections. Backs /autocomplete and step 4
│   │                              #   of the geocoding cascade.
│   ├── data/                      # Generated datasets. Checked-in (all small):
│   │   ├── community_area_centroids.json
│   │   ├── places_osm.json        # ~9 000 OSM places (refresh quarterly)
│   │   ├── places_curated.json    # CPL libraries + 2013 farmers markets +
│   │   │                          #   CPS schools + CPD/CFD stations
│   │   ├── residential_polygons.json
│   │   ├── parks_polygons.json    # CPD park boundaries (982 KB, 617 parks w/ name + acres)
│   │   ├── green_space_polygons.json  # OSM cemeteries / golf / nature reserves / rec grounds (303 KB)
│   │   ├── tree_canopy_kde.json   # Sparse 50 m OSM tree-density grid (~500 KB)
│   │   │                          # Generated locally (gitignored — too large or built-on-demand):
│   │   ├── chicago_geocode.db     # ~72 MB SQLite/FTS5: addresses + intersections + cached forward/reverse
│   │   │                          #   Built by build_address_points + build_intersections + migrate_geocode_cache
│   │   └── chicago_boundary.json  # Optional — Lake Michigan clip polygon; built by build_chicago_boundary.py
│   ├── scripts/                   # One-shot ingestion scripts for data/*
│   │   ├── build_community_area_centroids.py
│   │   ├── build_places_osm.py
│   │   ├── build_libraries.py
│   │   ├── build_farmers_markets.py
│   │   ├── build_schools_cps.py
│   │   ├── build_police_stations.py
│   │   ├── build_fire_stations.py
│   │   ├── build_residential.py
│   │   ├── build_parks.py              # CDP `ejsh-fztr.geojson` → parks_polygons.json
│   │   ├── build_green_space.py        # Overpass cemetery/golf/nature_reserve/rec_ground
│   │   ├── build_tree_canopy.py        # Overpass natural=tree → 50 m KDE grid
│   │   ├── build_chicago_boundary.py
│   │   ├── build_address_points.py     # 519k Chicago OSM addresses → addresses + FTS5
│   │   ├── build_intersections.py      # 45k cross-streets from the street graph → FTS5
│   │   ├── migrate_geocode_cache.py    # One-shot: legacy geocode_cache.json → cached_*
│   │   ├── _cdp_client.py         # Shared Chicago Data Portal (SODA) client
│   │   ├── _geocode_db.py         # Shared SQLite schema for chicago_geocode.db
│   │   └── _curated_common.py
│   ├── tests/                     # pytest modules + conftest: routing, geocoding, explore (3),
│   │                              #   places, community_areas, steps, utils, cdp_client,
│   │                              #   local_search, autocomplete_endpoint, parks, green_space,
│   │                              #   tree_canopy, geocode_text, walking_greenest
│   ├── requirements.txt
│   ├── requirements-dev.txt       # pytest + pytest-asyncio + httpx + osmnx + freezegun + psutil
│   ├── Dockerfile / railway.toml
│   └── .env.example               # LOCATIONIQ_API_KEY + CHICAGO_DATA_PORTAL_API_KEY_* +
│                                  #   CDP_API_ENDPOINT_* (LIBRARIES / Schools / POLICE_STATIONS /
│                                  #   FIRE_STATIONS / PARKS — see Setup)
│
├── docs/                          # Living feature/bug/debt logs
│   ├── BUGS.md                    # Open bugs (currently none)
│   ├── Technical_Debt.md          # Open debt
│   ├── Efficiency_Improvements.md # Open perf opportunities
│   ├── SECURITY.md                # Open security findings
│   ├── FEATURE_PLANS.md           # Chunked plans for upcoming features
│   ├── FEATURE_HISTORY.md         # Shipped feature log
│   ├── MOBILE_TESTING.md          # LAN + tunnel HTTPS setup + mobile sign-off checklists
│   ├── Pending_Verification.md    # Shipped code awaiting human-driven verification
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
    │   │                          # · AddressAutocomplete (typeahead combobox — route stops +
    │   │                          #     Explorer's community-area picker)
    │   ├── wayfarer/              # Design system: tokens · themes · primitives · forms · icons
    │   │                          # · walkpath-icons · responsive · motion (+ WFSheet bottom sheet)
    │   ├── lib/                   # storage · recentSearches · stepLog · directionFormat
    │   │                          # · routeFormat · useMediaQuery · sheetSnap · theme
    │   │                          # · geolocation · backendUrl · fetchWithTimeout · units
    │   │                          # · urlParams · personaPrefs · communityAreas
    │   │                          # · exploreApi · exploreCategories · explorePrefs
    │   │                          # · autocompleteApi (GET /autocomplete client)
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
- The Chicago pedestrian street graph as the prebuilt pickle `street_graph_igraph.pkl` (~28 MB) — fetch from this repo's GitHub `street-graph` release tag and place in `backend/`. Production Docker builds `curl` the same asset directly. For local rebuilds (changing the bake formula, refreshing heatmap data, etc.), `python fetch_street_graph.py` regenerates the `.pkl` from `street_graph.graphml` — a ~314 MB OSM snapshot kept off-repo as a local working file (not on the release). Re-fetch the `.graphml` from OSMnx via `python fetch_street_graph.py --force` when needed. A pre-Feature-4 `.pkl` will refuse to load.

### Backend

```bash
cd backend
pip install -r requirements.txt
pip install -r requirements-dev.txt   # local dev: adds pytest, pytest-asyncio, httpx,
                                      #   osmnx, freezegun, psutil
cp .env.example .env                  # see env-var notes below
```

**Environment variables** (in `backend/.env`):

| Var | Required? | Purpose |
| --- | --- | --- |
| `LOCATIONIQ_API_KEY` | Optional | Hosted fallback for free-text street-address queries that miss every local tier. The local cascade (`NEIGHBORHOOD_COORDS` + the 519k OSM addresses + 45k intersections + curated POIs in `chicago_geocode.db`) resolves almost everything in Chicago without it; this key only matters for obscure off-OSM addresses. Free tier is 5k req/day and permits permanent caching. |
| `ALLOWED_ORIGINS` | Production | Comma-separated CORS allowlist for the frontend origin (e.g. `https://wayfarer-passage.vercel.app`). Leave blank for localhost-only dev. |
| `TRUST_PROXY_HEADERS` | Production-behind-proxy | Set to `"true"` only when running behind a trusted reverse proxy (Railway, Cloudflare, nginx) that terminates TLS and sets `X-Forwarded-Proto`. When enabled, the server issues HSTS for proxied-https requests. Leave unset for direct exposure. |
| `APP_ENV` | Dev tunnel only | Deployment-environment marker. `dev` / `development` / `local` enables `DEV_TUNNEL_ORIGIN_REGEX` (below); any other value (including empty) refuses the regex. `npm run dev:tunnel` sets this automatically. **Never** set to a dev value in production. |
| `DEV_TUNNEL_ORIGIN_REGEX` | Dev tunnel only | Regex of CORS origins to accept in addition to `ALLOWED_ORIGINS`. Set automatically by `npm run dev:tunnel` to match per-session `https://*.trycloudflare.com` hostnames. Must be anchored with `^…$`. **Never** set in production — it widens CORS to a third-party-owned domain. |
| `STREET_GRAPH_SHA256` | Recommended in production | Expected SHA-256 of `backend/street_graph_igraph.pkl`. When set, the backend verifies the digest before `pickle.load` and refuses to start on a mismatch (pickle is RCE-by-design, so the hash is the trust boundary). When unset, the backend logs a one-time warning and loads without verification. Rotate whenever the `.pkl` rebuilds. Full runbook in CLAUDE.md ("Pickle integrity check (SEC-001)"). |
| `CHICAGO_DATA_PORTAL_API_KEY_ID` / `_SECRET` | Only for re-running CDP ingestion scripts | HTTP Basic auth pair for the Socrata SODA API. Register at [data.cityofchicago.org](https://data.cityofchicago.org). |
| `CDP_API_ENDPOINT_LIBRARIES` / `CDP_API_ENDPOINT_Schools` / `CDP_API_ENDPOINT_POLICE_STATIONS` / `CDP_API_ENDPOINT_FIRE_STATIONS` / `CDP_API_ENDPOINT_PARKS` | Only for re-running CDP ingestion scripts | Each points at the dataset's classic SODA URL (e.g. `https://data.cityofchicago.org/resource/x8fc-8rcq.json`). The `_PARKS` endpoint is the `.geojson` variant (`https://data.cityofchicago.org/resource/ejsh-fztr.geojson`) — the classic `.json` SODA endpoint returns empty column maps for that geospatial asset. Mixed case on `Schools` is intentional — the scripts grep for that exact spelling. |

Runtime endpoints (`/route`, `/explore`, etc.) do **not** read the `CHICAGO_DATA_PORTAL_*` / `CDP_API_ENDPOINT_*` vars — those are ingestion-only.

Place `street_graph_igraph.pkl` in `backend/` (fetched from the release per Prerequisites), then:

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

### `GET /health`

Returns `{"status": "ok"}`.

### `GET /reverse-geocode?lat=41.95&lon=-87.65`

Returns `{label, source}` for the given coordinates. `source ∈ {"neighborhood", "address", "locationiq", "coordinates"}`. Coordinates must fall within the Chicago coverage area (422 otherwise).

### `GET /autocomplete?q=<query>&limit=<n>`

Typeahead suggestions for the route + explore forms. `limit` is 1–20 (default 8); `q` is trimmed and required (an empty/whitespace query returns `{"suggestions": []}`, anything > 200 chars 422s). Results come from `local_search.autocomplete` (curated neighborhoods, 45k cross-streets, 519k OSM addresses, curated POIs, ranked by source priority). When fewer than 3 local hits land **and** the query's first token is digit-prefixed (heuristic for a hand-typed address), the endpoint adds one LocationIQ forward result. A tripped breaker silently drops the supplement — autocomplete never 503s on a degraded geocoder.

Response:
```json
{
  "suggestions": [
    {"label": "Wrigleyville",                  "lat": 41.9476, "lon": -87.6553, "source": "neighborhood"},
    {"label": "West Belmont Avenue & North Clark Street",
                                                "lat": 41.9400, "lon": -87.6507, "source": "intersection"},
    {"label": "1060 West Addison Street",      "lat": 41.9477, "lon": -87.6566, "source": "address"}
  ]
}
```
`source ∈ {"neighborhood", "intersection", "address", "place", "locationiq"}`.

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

Walkable-isochrone endpoint for the Neighborhood Explorer. Returns the alpha-shape polygon of every street-graph vertex reachable on foot from the origin within `max_minutes`, the Chicago neighborhoods whose centroids fall inside it, the matching places filtered by category, and four heatmap-layer geometries (residential land, CPD park footprints, non-CPD green space, and OSM-derived tree canopy). The polygon is clipped against the Chicago city boundary when `backend/data/chicago_boundary.json` is present so lakefront origins don't bleed into Lake Michigan.

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
`grocery`, `medical`, `train_stations`, `gyms_fitness`, `coffee_bakery`, `restaurants`, `bars_nightlife`, `parks`, `art_museums`, `theaters`, `bookstores`, `schools`, `places_of_worship`, `libraries`, `police_stations`, `fire_stations`. Several have subcategories on individual records (`medical/pharmacy`, `parks/playground`, `places_of_worship/christianity`, `grocery/farmers_market`, `coffee_bakery/chain_coffee_shop`, …).

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
      "subcategory": "coffee_shop",
      "name": "Heritage Outpost",
      "lat": 41.9213,
      "lon": -87.6987,
      "address": "2032 W Armitage Ave",
      "source": "osm"
    }
  ],
  "residential_heatmap": { "type": "MultiPolygon", "coordinates": ["..."] },
  "parks_heatmap": {
    "type": "FeatureCollection",
    "features": [
      { "type": "Feature",
        "properties": { "name": "Lincoln Park", "acres": 1208.0 },
        "geometry": { "type": "MultiPolygon", "coordinates": ["..."] } }
    ]
  },
  "green_space_heatmap": {
    "type": "FeatureCollection",
    "features": [
      { "type": "Feature",
        "properties": { "kind": "cemetery" },
        "geometry": { "type": "MultiPolygon", "coordinates": ["..."] } }
    ]
  },
  "tree_canopy_heatmap": {
    "type": "FeatureCollection",
    "features": [
      { "type": "Feature",
        "properties": { "density_band": "low" },
        "geometry": { "type": "MultiPolygon", "coordinates": ["..."] } }
    ]
  }
}
```

`source` is one of `"osm"`, `"cpl_locations"`, `"farmers_markets_2013"`. `residential_heatmap` is `null` for isochrones with no `landuse=residential` overlap. `parks_heatmap` carries one Feature per CPD park (MultiPolygon parks grouped by name; `properties` carries `name` + `acres`) and is `null` when no park polygons overlap. `green_space_heatmap` carries one Feature per OSM `kind ∈ {cemetery, golf_course, nature_reserve, recreation_ground}` (intra-kind polygons unioned) and is `null` when no green-space polygons overlap. `tree_canopy_heatmap` carries up to three density bands (`low` ≥ 0.05, `mid` ≥ 0.15, `high` ≥ 0.40) baked from OSM `natural=tree` nodes and is `null` when the KDE artifact is missing or no cells overlap.

## Notes

- **Chicago only** — the street graph is built and stored locally. A multi-city refactor (`backend/cities.py` + per-city graphs and adjacency-aware cross-city routing) is scoped in [`docs/FEATURE_PLANS.md`](docs/FEATURE_PLANS.md) but not started; Evanston is the planned second city.
- **Walking speed** — Routing is computed at 3 mph internally; the response rescales `total_minutes` and per-direction `minutes` to the user's chosen pace.
- **Step formula** — `step_length_inches = height_inches × 0.413`. Default: 30 inches (~5'10" male average).
- **Calorie formula** — `kcal = MET × weight_kg × 3.5 / 200 × minutes`. MET varies by pace (2.5 / 3.5 / 4.5). Reference body weight 70 kg when `weight_kg` is unset; the response sets `personalized_calories: true` when the user supplied a weight.
- **Route flavors** — Three alternatives are computed only for 2-stop routes. Multi-stop routes always use `fastest`. Setting `avoid_stairs` or `prefer_pedestrian` collapses the response to a single `custom` flavor.
- **Mobility profile** — Frontend state only (no backend schema change). The Walking / Wheeled segmented control in `PersonalizeModal` is persisted under `walkpath:mobilityProfile`. Wheeled is the source of truth for accessibility-aware routing prefs: `useRouteFetch` forces `avoid_stairs=true` and pins `pace="normal"` in the outgoing payload while leaving `walkpath:accessPrefs` / `walkpath:walkPace` untouched. In wheeled mode the personal-progress UI swaps from step count to miles + minutes (calories hidden), `PaceSelector` is hidden, and user-facing motivation / share-card copy swaps "walked" → "rolled".
- **Geocoding (local-first cascade)** — Forward lookups run through coord-pair regex → exact `NEIGHBORHOOD_COORDS` → fuzzy match → `local_search.forward` (SQLite FTS5 over ~519k Chicago OSM addresses + ~45k cross-streets + curated POIs in `backend/data/chicago_geocode.db`) → LocationIQ `/v1/search`. Reverse mirrors the shape: cached → KDTree neighborhood within ~200 m → nearest OSM address-point within ~50 m → LocationIQ `/v1/reverse` → coord-string fallback. LocationIQ results (positive and negative) persist to `cached_forward` / `cached_reverse`, so the same query never re-bills the hosted service. A 429 from LocationIQ trips a shared circuit breaker (60 → 120 → 240 s, capped at 300 s); during cool-off the hosted tier is skipped entirely and the local cascade still serves every in-Chicago lookup. The hosted fallback is optional — without `LOCATIONIQ_API_KEY` the cascade simply returns `None` on free-text queries that miss every local tier.
- **Address autocomplete** — `AddressAutocomplete` (a generic typeahead combobox) is shared by the route stop inputs and the Explorer's community-area picker. Route stops hit `GET /autocomplete` (debounced 150 ms, abort-on-keystroke); the Explorer's picker passes a local filter over the 77 community-area names. Implements the WAI-ARIA combobox 1.1 inline pattern (`role="combobox"`, `aria-controls`, `aria-expanded`, `aria-activedescendant`). Shipped 2026-05-12; real-device mobile sign-off pending as PV-001 in [`docs/Pending_Verification.md`](docs/Pending_Verification.md).
- **No transit data** — zero dependency on GTFS, CTA APIs, or any transit graph. The pedestrian street graph and OSM-tag-derived place data are the only spatial inputs.
- **Naming** — Several internal identifiers (localStorage keys prefixed `walkpath:`, the `WPIcon` component, `walkpath-icons.jsx`, MapLibre `walk-path` source IDs) keep the old prefix to avoid orphaning user data and cascading import churn. The user-facing brand is **Passage**.
