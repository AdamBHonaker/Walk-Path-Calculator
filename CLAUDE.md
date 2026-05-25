# Passage

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions, encouraging users to walk rather than take other transportation. Editorial broadsheet voice via the Wayfarer design system.

> **Note on naming.** Several internal identifiers (localStorage keys prefixed `walkpath:`, the `WPIcon` component, the `walkpath-icons.jsx` filename, MapLibre `walk-path` source IDs) keep the old prefix to avoid orphaning user data and cascading import churn. **User-facing surfaces are fully rebranded:** PWA icons (`frontend/public/passage-icon-*`), the manifest, the page title, and the share-card host all read "Passage."

> **Wayfarer design-system migration: Phase 1 complete as of 2026-05-05.** All checkpoints landed (foundation, primary components extracted, share card, loading/error states, map paint, project rename, voice rewrites, Cream/Dusk theme toggle, a11y sweep, final verification — 142/142 frontend tests passing at the close of Phase 1, 2026-05-05). The suite has grown well beyond that since with the Mobility profile, Chicago Data Portal, Tree Canopy, and Parks + Green-Space heatmap additions — run `npm test` in `frontend/` for the current count rather than relying on a figure here.

## Project Structure

```
Passage/
├── backend/              # Python FastAPI
│   ├── main.py           # POST /route, POST /explore, GET /health, GET /reverse-geocode,
│   │                     #   GET /autocomplete. `http_error()` helper builds every
│   │                     #   HTTPException around the standardized `{detail: {message, ...}}`
│   │                     #   ErrorDetail shape (TD-052).
│   ├── models.py         # Pydantic response models wired via `response_model=` on every
│   │                     #   endpoint (TD-052). Defines HealthResponse, RouteResponse +
│   │                     #   RouteAlternative + DirectionStep + LegStats, ExploreResponse +
│   │                     #   ExplorePlace + ExploreStats, AutocompleteResponse +
│   │                     #   AutocompleteSuggestion, ReverseGeocodeResponse, ErrorDetail,
│   │                     #   and the `assert_default_flavor_in_routes` invariant guard (C-08).
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
│   │                     #   markets + CPS schools + CPD/CFD stations + Divvy bike stations +
│   │                     #   Commission on Chicago Landmarks (~400 designations, CDP uct4-hrvh)],
│   │                     #   residential_polygons.json,
│   │                     #   tree_canopy_kde.json [sparse 100 m NLCD canopy-fraction grid],
│   │                     #   parks_polygons.json [CPD park boundaries — name + acres + outer ring],
│   │                     #   green_space_polygons.json [OSM cemetery/golf_course/nature_reserve/recreation_ground].
│   │                     #   Built locally and shipped as a `street-graph` GitHub release
│   │                     #   asset (gitignored due to size; production curls it at build time
│   │                     #   alongside street_graph_igraph.pkl): chicago_geocode.db [SQLite/FTS5
│   │                     #   ~72 MB — addresses, intersections, cached_forward/cached_reverse;
│   │                     #   built by build_address_points + build_intersections + migrate_geocode_cache];
│   │                     #   chicago_boundary.json [Chicago admin boundary polygon — built by
│   │                     #   build_chicago_boundary.py from Overpass; optional lakefront clipping
│   │                     #   for /explore; no integrity check; refresh cadence: ~once per decade].
│   ├── scripts/          # Ingestion scripts:
│   │                     #   build_community_area_centroids, build_places_osm,
│   │                     #   build_libraries / _farmers_markets / _schools_cps /
│   │                     #     _police_stations / _fire_stations / _parks / _divvy / _landmarks
│   │                     #     (share _cdp_client + _curated_common — the latter's
│   │                     #     merge_and_write does the replace-by-_source merge into
│   │                     #     places_curated.json),
│   │                     #   build_residential, build_tree_canopy, build_green_space,
│   │                     #   build_chicago_boundary,
│   │                     #   build_address_points, build_intersections (share _geocode_db schema),
│   │                     #   migrate_geocode_cache (one-shot — moves legacy geocode_cache.json
│   │                     #     entries into cached_forward / cached_reverse; the JSON file then
│   │                     #     gets renamed to .deprecated)
│   ├── requirements.txt  # Production deps
│   ├── requirements-dev.txt      # Adds pytest + pytest-asyncio + httpx + osmnx + freezegun + psutil + Pillow
│   ├── Dockerfile / railway.toml # Railway deployment (fetches the prebuilt street graph at build)
│   ├── .env.example      # Includes LOCATIONIQ_API_KEY + CDP credentials (see Running Locally)
│   └── tests/            # pytest modules + conftest: test_main, test_steps, test_utils,
│                         #   test_geocoding, test_geocode_text, test_community_areas, test_places,
│                         #   test_explore, test_explore_endpoint, test_explore_perf, test_cdp_client,
│                         #   test_local_search, test_autocomplete_endpoint, test_tree_canopy,
│                         #   test_parks, test_green_space, test_walking_greenest, test_fetch_bake,
│                         #   test_heatmap_clipper, test_walking_eviction, test_build_places_osm
│
├── docs/                 # Living feature/bug/debt logs (BUGS, Technical_Debt,
│                         #   Technical_Debt_Roadmap [dep graph + chunk-completion
│                         #     checklist governing TD resolutions],
│                         #   Efficiency_Improvements, FEATURE_PLANS, FEATURE_HISTORY,
│                         #   MOBILE_TESTING, Pending_Verification; archive/RESOLVED_HISTORY)
│                         # Operator docs: RAILWAY.md (deploy contract — TD-048),
│                         #   Release.md (artifact rotation runbook — TD-050),
│                         #   DR.md (disaster recovery — TD-070).
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
    │   ├── map/                   # MapRouteLayer (polyline + draw-in animation + turn highlight +
    │   │                          #   per-step segment differentiation: alternating opacity wash,
    │   │                          #   numbered turn circles, ember glow casing on active step),
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
    │   │                          #   renderExplore() for the isochrone layers, gesture lock/unlock.
    │   │                          #   buildRouteSegments() slices path into per-step LineStrings for
    │   │                          #   walk-segment-casing (ember glow) + walk-segments-line (alt. opacity);
    │   │                          #   SEG_ALT_OPACITY_EXPR is the alternating-opacity data expression.
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
                       # Add CHICAGO_DATA_PORTAL_API_KEY_ID + _SECRET + the seven
                       # CDP_API_ENDPOINT_* URLs only if you intend to re-run the
                       # curated-data ingestion scripts (build_libraries.py,
                       # build_schools_cps.py, build_police_stations.py,
                       # build_fire_stations.py, build_parks.py,
                       # build_divvy.py, build_landmarks.py). Runtime does
                       # not read these.
                       # Set STREET_GRAPH_SHA256 to the SHA-256 of
                       # street_graph_igraph.pkl to enable the pickle integrity
                       # check (SEC-001). See "Pickle integrity check" under the
                       # Greenest-routing graph release runbook below.
                       # Set TRUSTED_PROXY_HOPS to the number of trusted reverse
                       # proxies in front of the app so the per-IP rate limiter
                       # keys on the real client IP from X-Forwarded-For rather
                       # than the proxy peer (which would collapse all users into
                       # one bucket). Typical values: 0 (default, direct / local
                       # dev), 1 (Railway), 2 (Cloudflare → Railway). See
                       # .env.example for the full security note.
                       # UVICORN_WORKERS controls the production process count
                       # (CMD in backend/Dockerfile reads it; defaults to 2).
                       # Each worker holds its own pickle + STRtrees (~200–300
                       # MB after lifespan warm-up), so the container plan must
                       # fit `workers × footprint`. Local `uvicorn --reload`
                       # below ignores it.
uvicorn main:app --reload
```

The production Docker image launches uvicorn with `--workers ${UVICORN_WORKERS:-2}` so routing + isochrone work scales across vCPUs. Local dev still runs single-process (`--reload` is incompatible with multi-worker). The dev-vs-prod gap matters only under sustained load — single-process p95 is fine for one-at-a-time testing.

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
- **Parks + green-space heatmaps.** Two coexisting overlays for the Neighborhood Explorer's isochrone. **CPD parks** (`backend/parks.py` → `parks_polygons.json`, 982 KB / 617 parks baked from Chicago Data Portal `ejsh-fztr.geojson` via `scripts/build_parks.py`) — saturated `--field` green, sharp edges, each Feature carries `name` + `acres`; authoritative for Park District jurisdiction and the source artifact the Greenest Routing feature consumes for park-proximity edge weights. **Non-CPD green space** (`backend/green_space.py` → `green_space_polygons.json`, 303 KB / 533 polygons baked from OSM via `scripts/build_green_space.py`) — softer `--moss-500` wash, one Feature per `kind` ∈ {cemetery, golf_course, nature_reserve, recreation_ground}; covers cemeteries / golf courses / Cook County Forest Preserves that CPD's dataset excludes. Both toggle independently in the **Outdoors** group; default OFF in `walkpath:explorePrefs`. Z-order: green-space below CPD parks so a polygon tagged as both wins as the authoritative source. Shipped 2026-05-14; entry in [`docs/FEATURE_HISTORY.md`](docs/FEATURE_HISTORY.md). Real-device mobile sign-off pending as PV-004 in [`docs/Pending_Verification.md`](docs/Pending_Verification.md).
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
    {"label": "Wrigleyville",                  "lat": 41.9476, "lon": -87.6553, "source": "neighborhood",  "id": "neighborhood|Wrigleyville|41.947600,-87.655300"},
    {"label": "West Belmont Avenue & North Clark Street",
                                                "lat": 41.9400, "lon": -87.6507, "source": "intersection", "id": "intersection|West Belmont Avenue & North Clark Street|41.940000,-87.650700"},
    {"label": "1060 West Addison Street",      "lat": 41.9477, "lon": -87.6566, "source": "address",      "id": "address|1060 West Addison Street|41.947700,-87.656600"}
  ]
}
```
`source ∈ {"neighborhood", "intersection", "address", "place", "locationiq"}`. `id` is a stable per-suggestion key (composed of `source`, `label`, and 6-decimal-quantized `lat,lon`) the frontend uses as the React list key — same suggestion across two requests carries the same `id`, so list reconciliation across keystrokes doesn't remount rows.

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
| `with_heatmaps`          | list[str], optional | Subset of `{"residential", "parks", "green_space", "tree_canopy"}`. Layers not in the list are skipped (response field is `null`) — saves ~25–57% of `/explore` latency on a 20-min isochrone, with a roughly proportional payload-size drop. Omit (or send `null`) to compute every heatmap (legacy behavior). Unknown layer names → 422. |

Place categories (top-level keys, matched against `places.category`):
`grocery`, `medical`, `el_train_stations`, `metra_stations`, `gyms_fitness`, `bike_share`, `coffee_bakery`, `restaurants`, `bars_nightlife`, `parks`, `art_museums`, `theaters`, `bookstores`, `landmarks`, `schools`, `places_of_worship`, `libraries`, `police_stations`, `fire_stations`. Several have subcategories tagged on individual records (e.g., `medical/pharmacy`, `parks/playground`, `places_of_worship/christianity`, `grocery/farmers_market`, `coffee_bakery/chain_coffee_shop`).

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
      "subcategory": "coffee_shop",
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
`source` is one of `osm`, `cpl_locations`, `farmers_markets_2013`, `cps_schools`, `cpd_stations`, `cfd_stations`, `cdp_divvy`, `cdp_landmarks` (curated source keys). `residential_heatmap` is `null` for isochrones with no `landuse=residential` overlap.

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

## Greenest formula — single-source-of-truth constants

TD-054 documentation pass. The two halves of the greenest pipeline (bake-time score calculation in `fetch_street_graph.py`, runtime weight combiner in `walking.py`) use **disjoint** constant sets — there's no formula duplication, but tuners often need to look at both. This table is the cross-reference so a tuning round touches the right knobs.

### Bake-time (score inputs) — `backend/fetch_street_graph.py`

These constants control how `_bake_green_signals` derives the per-edge `tree_canopy_score` + `park_proximity_score` arrays that get pickled into `street_graph_igraph.pkl` as `edge_tree_canopy_f32` + `edge_park_proximity_f32`.

| Constant | Value | Where it's read | Effect |
|---|---|---|---|
| `_PARK_CUTOFF_M` | `200.0` | `_bake_green_signals` | Linear cap on park-proximity distance (m). Edges further than this from any park score 0. |
| `_PARK_ACRES_LOG_SAT` | `2.0` | `_bake_green_signals` | log₁₀(100) — parks ≥ ~100 acres saturate the size multiplier. |
| `_PARK_MULT_MIN` / `_PARK_MULT_MAX` | `1.0` / `1.5` | `_bake_green_signals` | Range of the log-acreage multiplier on park proximity. |
| `_LAT_REF_DEG` / `_M_PER_DEG_LAT` | `41.85` / `111_320.0` | `_bake_green_signals` | Chicago-centered equirectangular projection — meters per degree at Chicago's reference latitude. |

### Runtime (weight combiner) — `backend/walking.py`

These constants combine the baked scores into per-edge Dijkstra weights. Bumping them re-tunes greenest's behavior **without** re-baking the pickle.

| Constant | Value | Where it's read | Effect |
|---|---|---|---|
| `_GREEN_FOOTWAY_WEIGHT` | `0.20` | `_build_flavor_weights` (v3 path) | Weight contribution of `_GREEN_HIGHWAYS` membership (footway / path / cycleway / pedestrian / track). Higher = more discount for these edges. |
| `_GREEN_CANOPY_WEIGHT` | `0.15` | `_build_flavor_weights` (v3 path) | Weight contribution of the per-edge `tree_canopy_score`. |
| `_GREEN_PARK_WEIGHT` | `0.15` | `_build_flavor_weights` (v3 path) | Weight contribution of the per-edge `park_proximity_score`. |
| `_GREEN_DETOUR_FLOOR` | `0.5` | `_build_flavor_weights` (v3 path) | Lower bound on the combined discount so a single edge can't shrink below ½ length (caps pathological detours). |
| `_GREEN_DISCOUNT` | `0.6` | `_build_flavor_weights` (v2 fallback path) | Legacy footway-only discount applied to pre-FEAT-4 v2 pickles + graphml fallback. |
| `_GREEN_HIGHWAYS` | `{footway, path, cycleway, pedestrian, track}` | both paths | OSM `highway` tag set considered "green by virtue of being walking infrastructure." |

The full v3 weight formula:

```
greenest_weight = L · max(_GREEN_DETOUR_FLOOR,
                          1
                          − _GREEN_FOOTWAY_WEIGHT · is_in_GREEN_HIGHWAYS
                          − _GREEN_CANOPY_WEIGHT  · tree_canopy_score
                          − _GREEN_PARK_WEIGHT    · park_proximity_score)
```

where each `_score` value is float32 in [0, 1] (baked at graph-build time, scrubbed for NaN at runtime — see TD-053 / B-45 for the one-shot WARN behavior on rescue).

### Per-signal degradation

If the pickle is missing the canopy or park column (e.g., a v2 pickle, or a multi-city onboard for a city without that data — TD-068), the runtime zero-fills the missing column and surfaces the degradation via `greenest_degradation_status()` exposed on `/health.feature_degraded`. Greenest still routes; the missing signal's contribution to the weight collapses to zero.

## Greenest-routing graph release runbook

Build chain, artifact refresh procedures, pickle integrity check (SEC-001), manual rollback scenarios, and deploy checklist live in [`docs/RELEASE_RUNBOOK.md`](docs/RELEASE_RUNBOOK.md).

## Porting Notes

`walking.py` and `utils.py` are direct ports from `CTA-Transit-PWA/backend/` with minor additions:
- `walking.py` adds `distance_meters` to each direction step; `main.py` derives each step's `distance_miles` from that `distance_meters` (`main.py` `seg_miles = distance_meters / METERS_PER_MILE`), while the route-level `total_miles` is derived independently from `minutes` × `WALKING_SPEED_MPH`
- `utils.py` defines `WALKING_SPEED_MPH`; `walking.py` imports it from there (single source of truth)
- `utils.py` removes the CTA-specific `TRANSFER_PENALTY_MINUTES` constant

`geocoding.py` was originally extracted from `CTA-Transit-PWA/backend/gtfs_loader.py` (NEIGHBORHOOD_COORDS + fuzzy matching). None of the GTFS/stop-loading code was carried over, and the original Google Maps fallback has since been replaced — see the "Geocoding (local-first cascade)" entry in Key Design Decisions for the current shape.
