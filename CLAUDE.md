# Passage

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions, encouraging users to walk rather than take other transportation. Editorial broadsheet voice via the Wayfarer design system.

> **Note on naming.** Several internal identifiers (localStorage keys prefixed `walkpath:`, the `WPIcon` component, the `walkpath-icons.jsx` filename, MapLibre `walk-path` source IDs) keep the old prefix to avoid orphaning user data and cascading import churn. **User-facing surfaces are fully rebranded:** PWA icons (`frontend/public/passage-icon-*`), the manifest, the page title, and the share-card host all read "Passage."

> **Wayfarer design-system migration: Phase 1 complete as of 2026-05-05.** All checkpoints landed (foundation, primary components extracted, share card, loading/error states, map paint, project rename, voice rewrites, Cream/Dusk theme toggle, a11y sweep, final verification — 142/142 tests passing at the close of Phase 1; the frontend suite has since grown to **296/296** as of 2026-05-14 with Mobility profile, Chicago Data Portal, Tree Canopy, and Parks + Green-Space heatmap additions). See [`frontend/handoff/HANDOFF.md`](frontend/handoff/HANDOFF.md) "Phase 1 Progress" for completed checkpoints, spec departures, and decisions made outside the original spec.

## Project Structure

```
Passage/
├── backend/              # Python FastAPI
│   ├── main.py           # POST /route, POST /explore, GET /health, GET /reverse-geocode,
│   │                     #   GET /autocomplete
│   ├── walking.py        # Street network routing (ported from CTA-Transit-PWA).
│   │                     #   `greenest` flavor combines OSM footway/path tags with
│   │                     #   per-edge `tree_canopy_score` + `park_proximity_score`
│   │                     #   baked into the v3 pickle; v2 pickle / graphml
│   │                     #   load fail-fast — see "Greenest-routing graph release runbook".
│   ├── geocoding.py      # Local-first cascade: NEIGHBORHOOD_COORDS exact → fuzzy →
│   │                     #   local_search.forward (SQLite FTS5) → LocationIQ /v1/search.
│   │                     #   Forward + reverse share a 429 circuit breaker; results
│   │                     #   (positive + negative) cache to chicago_geocode.db's
│   │                     #   cached_forward / cached_reverse tables.
│   ├── explore.py        # Bounded Dijkstra + concave-hull isochrone for /explore
│   ├── community_areas.py# 77-area centroid table + case-insensitive lookup
│   ├── places.py         # STRtree-backed place + residential-heatmap clipper for /explore
│   ├── parks.py          # STRtree-backed CPD-parks-heatmap clipper for /explore
│   │                     #   (loads parks_polygons.json; one Feature per park w/ name+acres)
│   ├── green_space.py    # STRtree-backed non-CPD green-space clipper for /explore
│   │                     #   (loads green_space_polygons.json; one Feature per kind:
│   │                     #   cemetery / golf_course / nature_reserve / recreation_ground)
│   ├── tree_canopy.py    # Sparse NLCD-canopy clipper for /explore — emits 3 density bands
│   ├── steps.py          # Step count + calorie calculation utilities
│   ├── utils.py          # Haversine, WALKING_SPEED_MPH, METERS_PER_MILE, quantize_coord,
│   │                     #   Chicago bounding boxes, SERVICE_HIGHWAY_TYPES
│   ├── fetch_street_graph.py     # Build/refresh the pedestrian graph (osmnx → graphml → igraph pkl).
│   │                             #   `_bake_green_signals` computes per-edge tree_canopy_score
│   │                             #   + park_proximity_score from the canopy KDE + CPD parks
│   │                             #   artifacts at bake time; pickle = format_version 3.
│   ├── geocode_text.py   # Shared address/street normalize helpers (used by both
│   │                     #   ingestion scripts and runtime local_search)
│   ├── local_search.py   # Tier-1/2 lookup: NEIGHBORHOOD_COORDS + places + SQLite FTS5
│   │                     #   addresses + intersections. Backs /autocomplete and the
│   │                     #   geocoding cascade; opens chicago_geocode.db read-only via mmap.
│   ├── data/             # Generated datasets. Checked in: community-area centroids,
│   │                     #   places_osm.json, places_curated.json [CPL libraries + 2013 farmers
│   │                     #   markets + CPS schools + CPD/CFD stations], residential_polygons.json,
│   │                     #   tree_canopy_kde.json [sparse 100 m NLCD canopy-fraction grid],
│   │                     #   parks_polygons.json [CPD park boundaries — name + acres + outer ring],
│   │                     #   green_space_polygons.json [OSM cemeteries/golf/nature_reserve/rec_ground].
│   │                     #   Built locally and shipped as a `street-graph` GitHub release
│   │                     #   asset (gitignored due to size; production curls it at build time
│   │                     #   alongside street_graph_igraph.pkl): chicago_geocode.db [SQLite/FTS5
│   │                     #   ~72 MB — addresses, intersections, cached_forward/cached_reverse;
│   │                     #   built by build_address_points + build_intersections + migrate_geocode_cache].
│   │                     #   Generated locally on demand (gitignored): chicago_boundary.json
│   │                     #   [optional — built by build_chicago_boundary.py when /explore needs
│   │                     #   lakefront clipping].
│   ├── scripts/          # Ingestion scripts:
│   │                     #   build_community_area_centroids, build_places_osm,
│   │                     #   build_libraries / _farmers_markets / _schools_cps /
│   │                     #     _police_stations / _fire_stations / _parks (share _cdp_client),
│   │                     #   build_residential, build_tree_canopy, build_green_space,
│   │                     #   build_chicago_boundary,
│   │                     #   build_address_points, build_intersections (share _geocode_db schema),
│   │                     #   migrate_geocode_cache (one-shot — moves legacy geocode_cache.json
│   │                     #     entries into cached_forward / cached_reverse; the JSON file then
│   │                     #     gets renamed to .deprecated)
│   ├── requirements.txt  # Production deps
│   ├── requirements-dev.txt      # Adds pytest + pytest-asyncio + httpx + osmnx + freezegun + psutil
│   ├── Dockerfile / railway.toml # Railway deployment (fetches the prebuilt street graph at build)
│   ├── .env.example      # Includes LOCATIONIQ_API_KEY + CDP credentials (see Running Locally)
│   └── tests/            # pytest modules + conftest: test_main, test_steps, test_utils,
│                         #   test_geocoding, test_geocode_text, test_community_areas, test_places,
│                         #   test_explore, test_explore_endpoint, test_explore_perf, test_cdp_client,
│                         #   test_local_search, test_autocomplete_endpoint, test_tree_canopy,
│                         #   test_parks, test_green_space, test_walking_greenest
│
├── docs/                 # Living feature/bug/debt logs (BUGS, Technical_Debt,
│                         #   Efficiency_Improvements, FEATURE_PLANS, FEATURE_HISTORY,
│                         #   MOBILE_TESTING, Pending_Verification; archive/RESOLVED_HISTORY)
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
    │   │                          #   RouteErrorBoundary, ExploreForm, ExploreCategoryPanel,
    │   │                          #   AddressAutocomplete (typeahead combobox shared by route
    │   │                          #     stop inputs + the Explorer's community-area picker)
    │   ├── wayfarer/              # Wayfarer design system (tokens, themes, primitives, forms,
    │   │                          #   icons, walkpath-icons, responsive utilities, motion,
    │   │                          #   components.css — WFSheet / WFCheck / WFRadio class rules)
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
    │   │   ├── autocompleteApi.js # GET /autocomplete client (5 s timeout, abort-aware)
    │   │   ├── units.js           # lbToKg / kgToLb conversions
    │   │   ├── urlParams.js       # ?stops= / ?from=&to= parsing + MAX_STOPS
    │   │   ├── personaPrefs.js    # localStorage loaders for height / weight / pace / goal / a11y /
    │   │   │                      #   mobility profile (walking|wheeled) + override-notice dismissal
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
cp .env.example .env   # add LOCATIONIQ_API_KEY only if you want the hosted
                       # fallback for free-text addresses that miss every local
                       # tier (curated landmarks, the 519k OSM addresses, the
                       # 45k intersections, and the curated POIs). Without a
                       # key the cascade still resolves everything in those
                       # tiers — the fallback just returns None on a miss.
                       # Add CHICAGO_DATA_PORTAL_API_KEY_ID + _SECRET + the five
                       # CDP_API_ENDPOINT_* URLs only if you intend to re-run the
                       # curated-data ingestion scripts (build_libraries.py,
                       # build_schools_cps.py, build_police_stations.py,
                       # build_fire_stations.py, build_parks.py). Runtime does
                       # not read these.
                       # Set STREET_GRAPH_SHA256 to the SHA-256 of
                       # street_graph_igraph.pkl to enable the pickle integrity
                       # check (SEC-001). See "Pickle integrity check" under the
                       # Greenest-routing graph release runbook below.
uvicorn main:app --reload
```

At runtime `walking.py` loads `backend/street_graph_igraph.pkl` — the prebuilt pickle that carries the greenest-routing edge attributes (`tree_canopy_score`, `park_proximity_score`) baked from `data/tree_canopy_kde.json` + `data/parks_polygons.json`. Production fetches the `.pkl` (~28 MB) directly from this repo's GitHub `street-graph` release tag — see "Greenest-routing graph release runbook" below for the build chain and the SEC-001 integrity check. For local dev, `fetch_street_graph.py` rebuilds the `.pkl` from `street_graph.graphml`, a ~314 MB OSM snapshot kept off-repo as a local working file (not on the release); re-fetch it via `python fetch_street_graph.py --force` if you don't have a copy. A pickle built before greenest routing will refuse to load.

### Frontend
```bash
cd frontend
npm install
npm run dev             # starts at http://localhost:5173
```

### Mobile testing (HTTPS, real device)
For testing on a real phone — especially for behaviors browsers gate on a secure context (PWA install, `navigator.geolocation` on iOS Safari, Web Share, clipboard) — use the tunnel orchestrator: `npm run dev:tunnel` from `frontend/`. It runs uvicorn + vite behind paired ephemeral Cloudflare tunnels and prints a public HTTPS URL. Setup, the security caveat, and an ngrok fallback live in [`docs/MOBILE_TESTING.md`](docs/MOBILE_TESTING.md).

## Key Design Decisions

- **Mobile UI is map-first.** Below 480 px the desktop two-column layout (`.layout` / `.panel-cards` / `.panel-map`) flips to a `MobileLayout` root: the map fills the viewport, a floating compact `Masthead` overlays the top, and form / results / directions live inside a draggable `WFSheet` (Wayfarer primitive) with three snap points — peek (140 px), half (50 dvh), full (88 dvh). A landscape variant retunes those to handle-only / 60 dvh / 100 dvh. The branch is gated by `useMediaQuery("(max-width: 480px)")` in `App.jsx`; a sibling `useMediaQuery("(min-width: 481px) and (max-width: 1023px)")` enables the tablet sidebar variant, and ≥ 1024 px keeps the desktop two-column layout. `MapView` accepts a `mapPadding` prop so `fitBounds` keeps the route polyline in the slice above the sheet.
- **Route ⇄ Explore mode.** Top-level `mode` state (persisted in `walkpath:mode`) flips between the original routing flow and the Neighborhood Explorer. Same `App.jsx` orchestrates both — only the sidebar/sheet content swaps (`routeContents` vs. `exploreContents`) and `MapView` switches paint layers based on the `mode` prop. Explore prefs (origin, time budget, category selection, expanded groups, residential-heatmap toggle) persist in `walkpath:explorePrefs` so the user lands back where they were. Mobile gets two ergonomic touches: the sheet auto-promotes from peek → half on first explore-mode entry, and a place-pin tap drops the sheet to peek so the popup isn't clipped. Explore mode unlocks pan/zoom by default — panning the polygon to look around is the whole point.
- **Theme toggle is user-facing.** Cream (default) and Dusk render as the `.theme-dusk` class on `<html>`. The toggle lives in `PersonalizeModal`'s "Display" section; the boot script in `frontend/index.html` reads `walkpath:theme` from localStorage on every page load to apply the class before React mounts (no FOUC). `frontend/src/lib/theme.js` is the single source of truth for load + apply.
- **Mobility profile.** `PersonalizeModal` exposes a Walking (default) / Wheeled segmented control persisted under `walkpath:mobilityProfile`. Wheeled is the **source of truth** for accessibility-aware routing: `useRouteFetch` forces `avoid_stairs=true` and pins `pace="normal"` in the outgoing payload; the persisted `walkpath:accessPrefs` / `walkpath:walkPace` values are left untouched so flipping back to Walking restores the user's saved choices. Wheeled also swaps `StepHero` / `WeeklySummaryPanel` / `ShareDispatch` to a miles + minutes metric set (calories hidden), hides `PaceSelector` from the route form, and toggles the `routeFormat.js` motivation + plain-text directions header to "rolled" / "Rolling directions". `RouteFlavorTabs` collapses to a "Optimized for accessible routes." explainer when the single-flavor response lands. The avoid_stairs / prefer_pedestrian toggles live inside the Mobility section (the route-form "Considerations" fieldset is removed); the avoid_stairs row is disabled+on when wheeled is active. See `docs/FEATURE_HISTORY.md` "Accessibility Mode (Mobility profile)".
- **Chicago-only for now.** The street graph is pre-built and stored locally; routing is instant. Coverage spans the full Chicago city limits (77 community areas). Multi-city expansion (Chicago + Evanston for v1, with a registry that accepts more) is scoped as a chunked plan in [`docs/FEATURE_PLANS.md`](docs/FEATURE_PLANS.md) "Multi-City Support" — not started.
- **Walking speed:** Routing is computed at 3 mph internally; the API response rescales `total_minutes` and per-direction `minutes` to the user's selected `pace` (`leisurely` 2 mph, `normal` 3 mph, `brisk` 4 mph).
- **Step formula:** `step_length_inches = height_inches × 0.413`. Default (no height): 2.5 ft (30 in). See `steps.py`.
- **Calorie formula:** `kcal = MET × weight_kg × 3.5 / 200 × minutes`. MET varies by pace (2.5/3.5/4.5). Default 70 kg reference body weight when `weight_kg` is unset; the response sets `personalized_calories: true` when the user supplied a weight.
- **Route flavors:** Three alternatives are computed for every 2-stop route — `fastest` (default), `fewest_turns`, and `greenest`. Multi-stop routes always use `fastest`. When `avoid_stairs` or `prefer_pedestrian` is true, the response collapses to a single `custom` flavor.
- **Greenest flavor — combined edge signal.** Shipped 2026-05-14. The `greenest` weight function in [backend/walking.py](backend/walking.py) discounts edges by three independent signals: OSM footway/path/cycleway tags (existing), per-edge **tree-canopy density** (sampled from `data/tree_canopy_kde.json` at the edge midpoint), and per-edge **park proximity** (inverse distance to the nearest CPD park polygon from `data/parks_polygons.json`, capped at 200 m and weighted by log-acreage up to 1.5×). The full formula is `L · max(0.5, 1 − 0.20·footway − 0.15·canopy − 0.15·park)` — the 0.5× floor keeps the greenest path within ~2× of fastest's distance, preventing pathological detours. Both new signals are baked once per edge at graph-build time (`fetch_street_graph.py` `_bake_green_signals`), stored in `street_graph_igraph.pkl` as `edge_tree_canopy_f32` + `edge_park_proximity_f32` (pickle `format_version: 3`); runtime cost during Dijkstra is two extra float32 reads per edge. A pre-greenest-routing pickle (missing the new columns) refuses to boot — see "Greenest-routing graph release runbook" below. Live verification pending as PV-006 in [`docs/Pending_Verification.md`](docs/Pending_Verification.md).
- **Routing prefs:** `avoid_stairs` adds a large per-edge penalty to OSM `highway=steps` edges. `prefer_pedestrian` routes under the `greenest` flavor (which now combines footway + canopy + park signals — see entry above). Both live in `PersonalizeModal`'s Mobility section; the Mobility profile (Walking/Wheeled) is the source of truth — when Wheeled is active, `useRouteFetch` forces `avoid_stairs=true` regardless of the persisted value.
- **Multi-stop routing:** Accepts 2–8 ordered stops. Legs are routed independently and stitched into one continuous path. The `legs` array in the response breaks down per-segment stats.
- **Pick-on-map:** `GET /reverse-geocode?lat=X&lon=Y` resolves a clicked map point to a street address or neighborhood name, used to set origin/destination without typing.
- **No transit data.** This project has zero dependency on GTFS, CTA APIs, or the transit graph. The pedestrian street graph and OSM-tag-derived place data are the only spatial inputs.
- **Geocoding (local-first cascade).** Every forward lookup runs through, in order: coord-pair regex → exact `NEIGHBORHOOD_COORDS` → fuzzy `NEIGHBORHOOD_COORDS` → `local_search.forward` (FTS5 over ~519k Chicago OSM addresses + ~45k cross-streets + curated POIs in `backend/data/chicago_geocode.db`) → LocationIQ `/v1/search`. Reverse mirrors the same shape: cached → KDTree-nearest neighborhood within ~200 m → `local_search.nearest_address` within ~50 m → LocationIQ `/v1/reverse` → coord-string fallback. LocationIQ results — both hits and misses — persist to the SQLite cache (`cached_forward` / `cached_reverse`), so a query that ever resolves once never re-bills the hosted service. A 429 from LocationIQ trips a shared circuit breaker (60 → 120 → 240 s, capped at 300 s); during cool-off the hosted tier is skipped entirely and the local cascade still serves neighborhood + address + intersection queries. The hosted fallback is optional — without `LOCATIONIQ_API_KEY` set, free-text queries that miss every local tier simply return `None`. Shipped 2026-05-12; entry in [`docs/FEATURE_HISTORY.md`](docs/FEATURE_HISTORY.md) "Local-First Geocoding + LocationIQ Fallback". Live-key behavior pending sign-off as PV-002 in [`docs/Pending_Verification.md`](docs/Pending_Verification.md).
- **Tree canopy heatmap.** Per-pixel canopy fractions from the **NLCD Tree Canopy Cover 2021** raster (CONUS, 30 m native, published by USFS as a companion product to NLCD; pulled from the MRLC GeoServer WCS endpoint `mrlc_download__nlcd_tcc_conus_2021_v2021-4`) block-averaged onto a 100 m output grid and emitted as a sparse cell list (`backend/data/tree_canopy_kde.json`, ~2.7 MB / ~56k cells). The ingest (`scripts/build_tree_canopy.py`) fetches the bbox in three longitudinal chunks — requesting the full Chicago bbox in one shot trips a silent truncation that zeroes out everything east of about lon -87.65 on MRLC's server — and accumulates per-cell sums + counts directly into the output grid, so chunk boundaries don't seam. At runtime `tree_canopy.py` returns a GeoJSON FeatureCollection of up to three unioned-square density bands (`low` ≥ 0.05, `mid` ≥ 0.15, `high` ≥ 0.40 — bands now denote true canopy fraction, not the old OSM-relative max-normalized density); the frontend paints them as three moss-toned opacity steps (`--moss-100/300/500` tokens). Toggle defaults OFF in `walkpath:explorePrefs`. Pivoted from an OSM `natural=tree` Overpass + KDE bake on 2026-05-19 (TD-033) — OSM's ~30k Chicago-bbox points clustered around Grant/Millennium where mappers were most active and left dense residential neighborhoods reading sparse; NLCD gives uniform raster coverage. Original ship 2026-05-14; entry in [`docs/FEATURE_HISTORY.md`](docs/FEATURE_HISTORY.md). Real-device mobile sign-off pending as PV-005 in [`docs/Pending_Verification.md`](docs/Pending_Verification.md).
- **Parks + green-space heatmaps.** Two coexisting overlays for the Neighborhood Explorer's isochrone. **CPD parks** (`backend/parks.py` → `parks_polygons.json`, 982 KB / 617 parks baked from Chicago Data Portal `ejsh-fztr.geojson` via `scripts/build_parks.py`) — saturated `--field` green, sharp edges, each Feature carries `name` + `acres`; authoritative for Park District jurisdiction and the source artifact the Greenest Routing feature consumes for park-proximity edge weights. **Non-CPD green space** (`backend/green_space.py` → `green_space_polygons.json`, 303 KB / 533 polygons baked from OSM via `scripts/build_green_space.py`) — softer `--moss-500` wash, one Feature per `kind` ∈ {cemetery, golf_course, nature_reserve, recreation_ground}; covers cemeteries / golf / Cook County Forest Preserves that CPD's dataset excludes. Both toggle independently in the **Outdoors** group; default OFF in `walkpath:explorePrefs`. Z-order: green-space below CPD parks so a polygon tagged as both wins as the authoritative source. Shipped 2026-05-14; entry in [`docs/FEATURE_HISTORY.md`](docs/FEATURE_HISTORY.md). Real-device mobile sign-off pending as PV-004 in [`docs/Pending_Verification.md`](docs/Pending_Verification.md).
- **Address autocomplete.** Route stop inputs and the Explorer's community-area picker share `AddressAutocomplete.jsx` — a generic typeahead combobox with pluggable data source. Route stops point at `GET /autocomplete` via `lib/autocompleteApi.js` (debounced 150 ms, abort-on-keystroke, soft-fail on error); the Explorer's community-area picker passes a local filter over the 77 names. Implements the WAI-ARIA combobox 1.1 inline pattern (`role="combobox"`, `aria-controls`, `aria-expanded`, `aria-activedescendant`). Shipped 2026-05-12 as part of "Local-First Geocoding + LocationIQ Fallback"; real-device mobile sign-off pending as PV-001 in [`docs/Pending_Verification.md`](docs/Pending_Verification.md).

## API

### `GET /health`
Returns `{"status": "ok"}`.

### `GET /reverse-geocode?lat=41.95&lon=-87.65`
Returns `{label, source}` for the given coordinates. `source ∈ {"neighborhood", "address", "locationiq", "coordinates"}`. Coordinates must fall within the Chicago coverage area (422 otherwise).

### `GET /autocomplete?q=<query>&limit=<n>`

Typeahead suggestions for the route + explore forms. `limit` is 1–20 (default 8); `q` is trimmed and required (`""` returns `{"suggestions": []}`, anything > 200 chars 422s). Local-first: results come from `local_search.autocomplete` (curated neighborhoods, the 45k cross-streets, the 519k addresses, and the curated POIs, ranked by source priority). When fewer than 3 local hits land **and** the query's first token is digit-prefixed (heuristic for a hand-typed address), the endpoint adds one LocationIQ forward result. A degraded breaker silently drops the supplement — autocomplete never 503s on a tripped breaker.

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

### `POST /explore`

Walkable-isochrone endpoint for the Neighborhood Explorer (shipped 2026-05-11; see [`docs/FEATURE_HISTORY.md`](docs/FEATURE_HISTORY.md)). Returns the alpha-shape polygon of every street-graph vertex reachable on foot from the origin within `max_minutes`, the Chicago neighborhoods whose centroids fall inside it, the matching places filtered by category, and four optional heatmap layers (residential land, tree canopy, CPD park footprints, non-CPD green space). The hull is clipped against the Chicago city boundary when `backend/data/chicago_boundary.json` is present so lakefront origins don't render polygons that bleed into Lake Michigan.

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
`grocery`, `medical`, `train_stations`, `gyms_fitness`, `coffee_bakery`, `restaurants`, `bars_nightlife`, `parks`, `art_museums`, `theaters`, `bookstores`, `schools`, `places_of_worship`, `libraries`, `police_stations`, `fire_stations`. Several have subcategories tagged on individual records (e.g., `medical/pharmacy`, `parks/playground`, `places_of_worship/christianity`, `grocery/farmers_market`).

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

The response also carries `tree_canopy_heatmap`: a GeoJSON FeatureCollection of up to three density bands (`low` ≥ 0.05, `mid` ≥ 0.15, `high` ≥ 0.40 — true canopy fraction) baked from the NLCD Tree Canopy Cover 2021 raster (MRLC GeoServer WCS, 30 m native → 100 m output grid; see TD-033 in RESOLVED_HISTORY.md). Each band is a unioned MultiPolygon of 100 m cell squares clipped to the isochrone. `null` when the canopy artifact (`backend/data/tree_canopy_kde.json`) is missing or no cells overlap the isochrone. Shape:
```json
"tree_canopy_heatmap": {
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature",
      "properties": { "density_band": "low" },
      "geometry": { "type": "MultiPolygon", "coordinates": [...] } }
  ]
}
```

The response also carries `parks_heatmap`: a GeoJSON FeatureCollection of Chicago Park District park footprints clipped to the isochrone. One Feature per park (MultiPolygon-shaped parks are unioned back into a single Feature), with `properties.name` and `properties.acres` for popups and greenest-routing edge weights. `null` when the artifact (`backend/data/parks_polygons.json`, baked from CDP `ejsh-fztr` via `scripts/build_parks.py`) is missing or no park polygons overlap the isochrone. Shape:
```json
"parks_heatmap": {
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature",
      "properties": { "name": "Lincoln Park", "acres": 1208.0 },
      "geometry": { "type": "MultiPolygon", "coordinates": [...] } }
  ]
}
```

The response also carries `green_space_heatmap`: a GeoJSON FeatureCollection of non-CPD open space — OSM polygons tagged `landuse=cemetery`, `leisure=golf_course`, `leisure=nature_reserve`, or `landuse=recreation_ground` (Cook County Forest Preserves, Graceland / Rosehill / Mt. Olive cemeteries, golf courses, school athletic fields, etc.). One Feature per `kind`; all polygons of a kind are unioned into a single MultiPolygon. `null` when the artifact (`backend/data/green_space_polygons.json`, baked from Overpass via `scripts/build_green_space.py`) is missing or no polygons overlap the isochrone. Distinct from `parks_heatmap` deliberately — CPD is authoritative for Park District land, this layer covers everything else. Shape:
```json
"green_space_heatmap": {
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature",
      "properties": { "kind": "cemetery" },
      "geometry": { "type": "MultiPolygon", "coordinates": [...] } }
  ]
}
```
`kind ∈ {"cemetery", "golf_course", "nature_reserve", "recreation_ground"}`.

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

## Greenest-routing graph release runbook

How the production artifacts at the `street-graph` GitHub release tag are produced, what fails if any go wrong, and how to roll back. Two artifacts live on the tag:

- **`street_graph_igraph.pkl`** (~28 MB) — the pedestrian routing graph with greenest-routing edge weights baked in. Loaded by `walking.py` at startup. SEC-001 SHA-256 integrity check enforced via `STREET_GRAPH_SHA256`.
- **`chicago_geocode.db`** (~72 MB) — the SQLite + FTS5 geocoding indexes (~519k OSM addresses, ~45k intersections, curated POIs, LocationIQ response cache). Opened read-only by `local_search.py`. No integrity check — it's data, not pickled code; the threat surface is much smaller.

The Dockerfile `curl`s both at build time. The rest of this runbook focuses on the `.pkl` (which has the more complex refresh + integrity story); the `.db` shows up where its refresh procedure differs.

### Build chain

1. **Local-only.** `street_graph.graphml` is the canonical OSM snapshot, kept off-repo on the developer's dev machine (it is *not* a release asset). `fetch_street_graph.py --force` re-fetches it from OSMnx if you lose your copy — but the result depends on the current state of OSM, so keep an off-machine backup if reproducibility matters.
2. **Local-only.** `python fetch_street_graph.py` builds `street_graph_igraph.pkl` from the `.graphml` and, **as part of the same pass**, bakes per-edge `tree_canopy_score` + `park_proximity_score` from `data/tree_canopy_kde.json` + `data/parks_polygons.json` (both checked into the repo). The pickle is marked `format_version: 3`.
3. **Release artifact.** Upload the rebuilt `.pkl` to the `street-graph` GitHub release tag (overwrite the existing asset). This is the byte-identical artifact production consumes; the SEC-001 hash check makes byte equality a hard integrity requirement, not a convenience. We ship the `.pkl` (not the `.graphml` + an in-container bake) because the bake is not bit-identical across platforms — float drift in the KDE / park-proximity steps diverges between Windows local and the Linux container, and the hash check then refuses to load.
4. **Production.** The Dockerfile `curl`s the `.pkl` directly from the release at build time (no in-container rebuild, no `fetch_street_graph.py` invocation).
5. **Runtime.** `walking.py` loads the `.pkl`, validates that both score columns are present and sized to `ecount()`, and otherwise refuses to boot (`_graph_load_failed = True`, all routes degrade to haversine until the operator intervenes).

### What this means for refreshes

- **Tree-canopy / parks data refresh** (yearly, per the heatmap ingest scripts): re-run `python fetch_street_graph.py` to rebuild the `.pkl`. **Upload the new `.pkl` to the `street-graph` release** (overwrite). **Rotate `STREET_GRAPH_SHA256`** in both `backend/.env` and the Railway service variable — see "Pickle integrity check" below.
- **OSM street-network refresh**: re-run `fetch_street_graph.py --force` to redownload the `.graphml`, then `python fetch_street_graph.py` (no flag) to rebuild the `.pkl`. Upload the new `.pkl` to the release. **Rotate `STREET_GRAPH_SHA256`** as above.
- **Algorithm change** (formula constants, etc.): code-only, no artifact action, no hash rotation.
- **Geocoding-index refresh** (re-running `build_address_points.py` / `build_intersections.py` / `migrate_geocode_cache.py`): rebuild `backend/data/chicago_geocode.db` locally, upload it to the `street-graph` release (overwrite). No hash rotation needed — there's no integrity check on this artifact.

### Pickle integrity check (SEC-001)

`walking.py` calls `pickle.load` on `street_graph_igraph.pkl` to hydrate the pedestrian network. Pickle is RCE-by-design — any process that can replace that file can execute arbitrary Python in the FastAPI worker on the next load. The `STREET_GRAPH_SHA256` env var closes that surface: when set, `_verify_pickle_integrity()` in [backend/walking.py](backend/walking.py) hashes the file with SHA-256 before unpickling and refuses to load on a mismatch (fails closed — no graphml fallback after a hash failure, so an attacker who swaps the pickle can't induce a downgrade).

**Behavior matrix:**

| `STREET_GRAPH_SHA256` set?     | File on disk matches? | Result                                                                                |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------- |
| no                             | n/a                   | One-time warning logged (`STREET_GRAPH_SHA256 not set — loading … without integrity check`), pickle loads. |
| yes                            | yes                   | `street_graph_igraph.pkl SHA-256 verified`, pickle loads.                            |
| yes                            | no                    | `Refusing to load … — SHA-256 mismatch (expected X…, got Y…). Pickle deserialization is RCE-by-design; failing closed.` `_graph_load_failed=True`, routing degrades to haversine. |

**Computing the hash:**

```powershell
# PowerShell (Windows)
Get-FileHash -Algorithm SHA256 backend\street_graph_igraph.pkl
```

```bash
# Bash (macOS / Linux / WSL / Git Bash on Windows)
shasum -a 256 backend/street_graph_igraph.pkl
# or
sha256sum backend/street_graph_igraph.pkl
```

Case doesn't matter — `walking.py` does `.strip().lower()` on the env var, so the uppercase output from `Get-FileHash` works as-is. Strip any `SHA256` prefix or whitespace before pasting.

**Where to set it:**

- **Local dev.** Add `STREET_GRAPH_SHA256=<hash>` to `backend/.env` (the slot is in `.env.example`). `load_dotenv()` reads it at startup.
- **Production (Railway).** Add a service variable in the Railway dashboard: Project → backend service → **Variables** → **New Variable**, name `STREET_GRAPH_SHA256`, value the hex digest. Save — Railway redeploys automatically.

**Verifying it took effect.** On the next backend startup, look for `street_graph_igraph.pkl SHA-256 verified` in the logs (locally: uvicorn console; Railway: deploy logs). If you instead see `STREET_GRAPH_SHA256 not set …`, the variable didn't reach the process. If you see `Refusing to load …`, the digest doesn't match the file — either the artifact was tampered with (the case the check exists for) or you computed the hash against a different `.pkl` than the one in the deploy. Recompute and update the var.

**⚠️ Critical: rotate the hash AND upload the new `.pkl` whenever the pickle changes.** The pickle is rebuilt every time `fetch_street_graph.py` runs — yearly heatmap-data refresh, any OSM street-network refresh, any greenest-routing formula bake change. After each rebuild:

1. Recompute the hash on the new `.pkl` (commands above).
2. **Upload the new `.pkl` to the `street-graph` GitHub release tag** (overwrite the existing asset). Production will `curl` this on the next deploy — the hash check requires byte equality.
3. Update `backend/.env` locally.
4. Update the `STREET_GRAPH_SHA256` Railway variable so the next deploy boots cleanly. **Do steps 2–4 before pushing the code change that triggers the Railway rebuild**, or the deploy will fail — either the `curl` 404s on a stale asset, or the hash check refuses to load and the service degrades to haversine until the variable is corrected.

If you ever need to deploy without the check (emergency rollback, debugging a hash dispute), unset `STREET_GRAPH_SHA256` in the deploy env — the backend reverts to "warn and load" behavior. This is the lesser-of-two-evils escape hatch; it should not be the steady state.

### Manual rollback

The risk window is "production fetches an artifact whose attributes don't match what `walking.py` expects." Three scenarios, in increasing severity:

- **A) v3 `.pkl` loads fine but greenest routes look wrong** — revert just the formula constants in `walking.py` (`_GREEN_FOOTWAY_WEIGHT`, `_GREEN_CANOPY_WEIGHT`, `_GREEN_PARK_WEIGHT`, `_GREEN_DETOUR_FLOOR`). The columns are still consumed; only the discounting math changes.
- **B) bake step produces malformed columns** — revert [backend/fetch_street_graph.py](backend/fetch_street_graph.py) `_bake_green_signals` (or its caller in `_save_igraph_artifact`). The next deploy will rebuild a v2-shaped `.pkl`, **but the fail-fast guard in `walking.py` will then refuse to boot.** Pair this with rollback (C) so the service stays up.
- **C) full feature rollback** — revert the greenest weight branch, the fail-fast guard, and the `_edge_tree_canopy` / `_edge_park_proximity` cache columns in [backend/walking.py](backend/walking.py). The `_bake_green_signals` step in `fetch_street_graph.py` can stay — unused dict keys in the pickle are harmless to a reverted loader.

Rollbacks (A)/(B)/(C) above are code-only — they don't require touching the release directly. After the code revert, rebuild the `.pkl` locally with `python fetch_street_graph.py`, upload it to the `street-graph` release (overwrite), recompute `STREET_GRAPH_SHA256`, update `backend/.env` and Railway, then push. Same procedure as a normal refresh; the only difference is what code is on disk when the bake runs.

### Deploy checklist

1. Locally: `python fetch_street_graph.py` (pick "1" — rebuild pickle from cached graphml). Confirm the histogram step prints non-zero canopy + parks distributions and the pickle ends `format_version: 3`.
2. **Upload the new `.pkl` to the `street-graph` GitHub release tag** (https://github.com/AdamBHonaker/Passage/releases/tag/street-graph → Edit release → drag-replace `street_graph_igraph.pkl`). Asset name must remain exactly `street_graph_igraph.pkl` — the Dockerfile `curl` is hardcoded to that filename.
3. **Recompute the pickle SHA-256** (`Get-FileHash -Algorithm SHA256 backend\street_graph_igraph.pkl` or `shasum -a 256 backend/street_graph_igraph.pkl`). Update `STREET_GRAPH_SHA256` in `backend/.env` locally **and** in the Railway service variables. Do steps 2–3 *before* pushing — if Railway rebuilds while the release asset is stale or the Railway hash doesn't match the uploaded bytes, the service will degrade to haversine until the gap is closed. Details: "Pickle integrity check (SEC-001)" above.
4. `pytest tests/test_walking_greenest.py -v` — 14 should pass.
5. Push to main. Railway rebuilds; tail the build for the `curl … street_graph_igraph.pkl` step and the boot for both `street_graph_igraph.pkl SHA-256 verified` and `igraph loaded:` (no "Refusing to load" error).
6. Spot-check the Lakeview East → Lincoln Park fixture in prod (`POST /route` with `origin=41.9405,-87.6420`, `destination=41.9210,-87.6500`, compare `routes[fastest]` vs `routes[greenest]` — greenest should diverge to a footway-heavy path).

## Porting Notes

`walking.py` and `utils.py` are direct ports from `CTA-Transit-PWA/backend/` with minor additions:
- `walking.py` adds `distance_meters` to each direction step (passed through to the response; `main.py` computes `distance_miles` from `minutes` independently)
- `utils.py` defines `WALKING_SPEED_MPH`; `walking.py` imports it from there (single source of truth)
- `utils.py` removes the CTA-specific `TRANSFER_PENALTY_MINUTES` constant

`geocoding.py` was originally extracted from `CTA-Transit-PWA/backend/gtfs_loader.py` (NEIGHBORHOOD_COORDS + fuzzy matching). None of the GTFS/stop-loading code was carried over, and the original Google Maps fallback has since been replaced — see the "Geocoding (local-first cascade)" entry in Key Design Decisions for the current shape.
