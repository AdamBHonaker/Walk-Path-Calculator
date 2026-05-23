# Efficiency Improvements

Known efficiency improvements catalogued for future improvement. Impact: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an efficiency in this file is implemented, **delete its entry from this file** and add a corresponding entry to the **Efficiency Improvements Implemented** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain improvements that have not yet been implemented.

> **Note:** OPT-022 through OPT-086 were catalogued together on 2026-05-22 during a three-pass codebase audit. Findings deduped across passes and ranked by ROI. Tier-H entries (OPT-022 to OPT-042) are the user-visible wins; Tier-M (OPT-043 to OPT-069) are profilable but not user-perceptible; Tier-L (OPT-070 to OPT-086) are nits / consistency.

---

## Tier H — wire / payload

### OPT-022 · No GZip middleware on FastAPI responses
- **File**: [backend/main.py:189–216](../backend/main.py#L189-L216)
- **Category**: Network payload / Compression
- **Impact**: 🔴 High
- **Description**: `/explore` responses with all four heatmap GeoJSON FeatureCollections reach 500 KB – 2 MB uncompressed. No `GZipMiddleware` is registered, so the wire payload is the full uncompressed JSON. Gzip on JSON of this shape typically gives 5–10× reduction.
- **Resolution path**: `from fastapi.middleware.gzip import GZipMiddleware` and `app.add_middleware(GZipMiddleware, minimum_size=500)` registered before the security-headers middleware. Verify on a real `/explore` response that `Content-Encoding: gzip` is present and the body is smaller.
- **Acceptance**: A typical 15-minute isochrone `/explore` response drops from ~1 MB to ~150–200 KB on the wire. No regressions in the 247-test backend suite.

### OPT-023 · FastAPI uses stdlib `json.dumps` instead of `ORJSONResponse`
- **File**: [backend/main.py:189](../backend/main.py#L189)
- **Category**: Response serialization
- **Impact**: 🔴 High
- **Description**: `app = FastAPI(lifespan=lifespan)` defaults to `JSONResponse`, which uses stdlib `json.dumps` — ~3× slower than orjson on large GeoJSON. A typical `/route` response pays 5–15 ms; orjson cuts to 1–3 ms. orjson is already pulled in transitively via FastAPI. Pass-3 verification: no stdlib-JSON quirks anywhere in responses (no custom `JSONEncoder`, no `NaN`/`Infinity`, all tuples/sets encode identically).
- **Resolution path**: `from fastapi.responses import ORJSONResponse` and `app = FastAPI(lifespan=lifespan, default_response_class=ORJSONResponse)`. Add `orjson` to `requirements.txt` if not already pinned.
- **Acceptance**: `/route` p95 latency drops by 5–10 ms on large multi-stop routes; all tests still green.

### OPT-024 · GeoJSON coordinates serialized at full float64 precision
- **File**: [backend/main.py:689–750](../backend/main.py#L689-L750), [backend/explore.py:266](../backend/explore.py#L266), [backend/places.py:312](../backend/places.py#L312), [backend/parks.py](../backend/parks.py), [backend/green_space.py](../backend/green_space.py), [backend/tree_canopy.py](../backend/tree_canopy.py)
- **Category**: Network payload / Wire format
- **Impact**: 🔴 High
- **Description**: Every coordinate emitted in `/route` and `/explore` responses is full float64 — `41.94762234234234` (15+ digits per number). Truncating to 5 decimals is ~1.1 m precision, well below what the UI ever renders, and halves the numeric bytes. Pass-3 measurement: ~10k floats per typical `/explore` response → ~90 KB saved per response **before** gzip (~15 KB stacked with OPT-022).
- **Resolution path**: Add one recursive helper `quantize_geojson(obj, decimals=5)` and apply at the response-build boundary — once in `main.py` `/route` response and once in `main.py` `/explore` response — so it covers `path`, `polygon`, all `*_heatmap` features, and `places[].lat/lon`. Tests should still pass since they round before comparing.
- **Acceptance**: `/explore` payload (post-gzip) drops by another ~15 KB beyond OPT-022; visual fidelity at zoom 12–18 unchanged.

### OPT-025 · Heatmap features computed even when frontend toggle is OFF
- **File**: [backend/main.py:415–421](../backend/main.py#L415-L421)
- **Category**: Wasted backend compute + payload
- **Impact**: 🔴 High
- **Description**: `/explore` unconditionally fans out all five heatmap clips (residential, parks, green-space, canopy, places) regardless of the user's toggle state. Response carries `null` for unrequested layers but the shapely clip + STRtree query already ran. Each heatmap is ~50–200 ms of shapely intersection work.
- **Resolution path**: Add optional `with_heatmaps: list[str] | None = None` to `ExploreRequest`. In `/explore`, skip the matching `loop.run_in_executor` calls when the layer isn't requested. Default `None` keeps backward compatibility (compute everything). Frontend `lib/exploreApi.js` passes a filter derived from the active toggle state; the `useExploreFetch` dependency array picks up changes.
- **Acceptance**: When user has only residential on, the response carries `parks_heatmap: null`, `green_space_heatmap: null`, `tree_canopy_heatmap: null`, and the backend p95 drops by ~150 ms.

### OPT-026 · Heatmap polygons emitted at full ring detail (no simplification)
- **File**: [backend/places.py:312](../backend/places.py#L312) (residential), [backend/parks.py](../backend/parks.py), [backend/green_space.py](../backend/green_space.py)
- **Category**: Network payload / Geometry detail
- **Impact**: 🔴 High
- **Description**: Heatmap rings are emitted at full OSM/CPD ring detail (often hundreds of vertices per polygon at sub-meter precision). At the zoom range the UI renders (12–15), Douglas-Peucker with ~0.0005° (~5 m at Chicago latitude) tolerance cuts vertex count 60–80% with no visible difference. Compounds with OPT-024 on the wire.
- **Resolution path**: In each clipper, after the intersection union but before `shapely.geometry.mapping(...)`, call `merged = merged.simplify(0.0005, preserve_topology=True)`. Add a `simplify_tolerance` constant per file so the value can be tuned.
- **Acceptance**: Heatmap-bearing `/explore` responses drop another ~30–50 KB after gzip; visual inspection at zoom 13 shows no perceptible difference.

---

## Tier H — build / deploy

### OPT-027 · Dockerfile artifact `curl` is layered after `COPY . .`
- **File**: [backend/Dockerfile:69–71](../backend/Dockerfile#L69-L71) (curl block) vs. line 24 (`COPY . .`)
- **Category**: Docker layer caching
- **Impact**: 🔴 High
- **Description**: BuildKit caches the curl layer on the command string + preceding layers. Any code change re-runs `COPY . .` and invalidates the next layer, forcing a re-download of ~100 MB of artifacts on every deploy. Moving the curl block to before the code copy means code-only deploys reuse the cached artifacts; only an `ARTIFACT_REV` or `STREET_GRAPH_SHA256` rotation triggers a re-download.
- **Resolution path**: Move the `ARG ARTIFACT_REV` + `ARG STREET_GRAPH_SHA256` + the curl `RUN` block to immediately after `pip install` (line 21), before the code `COPY` at line 24. Verify the build-time SEC-001 hash check still fires (it interpolates `STREET_GRAPH_SHA256` into the same `RUN`).
- **Acceptance**: A code-only Railway deploy completes ~2–5 min faster; first deploy after an artifact refresh still pulls the new bytes.

### OPT-028 · `places_osm.json` and `places_curated.json` written with `indent=2`
- **File**: [backend/scripts/build_places_osm.py:356](../backend/scripts/build_places_osm.py#L356), [backend/scripts/_curated_common.py:64](../backend/scripts/_curated_common.py#L64)
- **Category**: Artifact size
- **Impact**: 🔴 High
- **Description**: `places_osm.json` is ~10 MB; `indent=2` adds ~40–50% of pure whitespace (~4–5 MB bloat) + ~50–100 ms startup parse penalty in `places.py`. `places_curated.json` has the same pattern (~200–300 KB nominal but proportionally similar). Every other build script in `scripts/` already minifies — these two are inconsistent.
- **Resolution path**: Change `json.dumps(..., indent=2, ...)` to `json.dumps(..., separators=(",", ":"), ...)` in both scripts. Re-run both build scripts locally, commit the regenerated files.
- **Acceptance**: `places_osm.json` drops below 6 MB on disk; backend startup `places.py` parse measurably faster.

### OPT-029 · SQLite FTS5 ingest without explicit transaction wrapping
- **File**: [backend/scripts/build_address_points.py:182–190](../backend/scripts/build_address_points.py#L182-L190) (519k rows), [backend/scripts/build_intersections.py:210–219](../backend/scripts/build_intersections.py#L210-L219) (45k rows)
- **Category**: Build time
- **Impact**: 🔴 High
- **Description**: Both scripts do `executemany` against FTS5-mirroring triggers without wrapping the inserts in a single `BEGIN…COMMIT`, so SQLite commits per implicit batch and journals every step. Together this is ~4–7 min off each quarterly refresh.
- **Resolution path**: Wrap the inserts: `conn.execute("BEGIN")` ... `conn.execute("COMMIT")`. Set `PRAGMA journal_mode=OFF`, `PRAGMA synchronous=OFF`, `PRAGMA temp_store=MEMORY` for the duration of the build; restore (or just close + reopen for read-only use) after. Keep the FTS5 `INSERT INTO ... (rowid, content)` shape; the savings are purely from removing per-row commits.
- **Acceptance**: `chicago_geocode.db` rebuild time drops from baseline to ~4–7 min less; the resulting DB byte-identical to the current artifact (modulo build-order tiebreaks).

### OPT-030 · `fetch_street_graph._bake_green_signals` per-edge `strtree.nearest` call
- **File**: [backend/fetch_street_graph.py:386–403](../backend/fetch_street_graph.py#L386-L403)
- **Category**: Build time / Vectorization
- **Impact**: 🔴 High
- **Description**: The park-proximity bake calls `strtree.nearest(midpoint)` once per edge — ~24k edges × Python-level overhead. A batched approach (build a `KDTree` of park centroids, query all edge midpoints in one numpy call) drops this to a single vectorized pass.
- **Resolution path**: Replace the `for eid in range(G.ecount()):` loop with a precomputed midpoint array (output of OPT-053 if it lands first), build `scipy.spatial.KDTree(park_centroids)`, call `tree.query(midpoints)`, then map distances to the existing log-acreage / 200 m-cap formula in vectorized form. Keep the formula constants unchanged. Confirm `_GREEN_PARK_WEIGHT` math matches by spot-checking a few edges against the old implementation.
- **Acceptance**: Yearly graph bake drops by ~2–5 min; the resulting pickle has identical `edge_park_proximity_f32` values within float32 precision.

---

## Tier H — backend hot paths

### OPT-031 · Greenest weight rebuild re-casts canopy/park columns to float32 per Dijkstra
- **File**: [backend/walking.py:580–582](../backend/walking.py#L580-L582)
- **Category**: Hot-path compute
- **Impact**: 🔴 High
- **Description**: `_build_flavor_weights` for the greenest flavor calls `np.asarray(_edge_tree_canopy, dtype=np.float32)` (and similar for park proximity) inside the per-cache-miss weight build. Cast happens every time the weight cache is invalidated — once per graph eviction × 3 flavor variants.
- **Resolution path**: Move the float32 cast into `_populate_edge_caches_v2` at load time. The hot path then becomes a `np.where(green_mask, …)` against pre-cast arrays.
- **Acceptance**: Cold-cache greenest weight build drops by ~3 ms; memory cost is +200 KB float32 per process, already in float32 in the pickle.

### OPT-032 · `green_mask` rebuilt from `_edge_highways` strings on every cache miss
- **File**: [backend/walking.py:572–573](../backend/walking.py#L572-L573)
- **Category**: Hot-path compute
- **Impact**: 🔴 High
- **Description**: `green_mask = np.array([h in _GREEN_HIGHWAYS for h in highways], dtype=bool)` rebuilds the boolean from a Python list comprehension over ~24k highway tag strings on every greenest weight cache miss.
- **Resolution path**: Bake `_edge_green_mask` (uint8) alongside `_edge_highways` in `_populate_edge_caches_v2`. Reuse on cache misses.
- **Acceptance**: Cache-miss greenest weight build drops by ~5–10 ms; +24 KB uint8 array per process.

### OPT-033 · `G.distances()` returns Python `list[list[float]]` then copies into numpy
- **File**: [backend/explore.py:55–75](../backend/explore.py#L55-L75)
- **Category**: Hot-path compute / Memory allocation
- **Impact**: 🔴 High
- **Description**: `G.distances(source=orig_idx, weights=weights)` returns a list-of-list (~50k entries × Python float = ~200 KB Python overhead) that's immediately copied into a numpy array. Each /explore pays a Python-list allocation + copy that's redundant.
- **Resolution path**: Check whether the installed igraph version supports a numpy output mode (igraph-python 0.11+ has `output="numpy"` in some methods). If not, pre-allocate a numpy array and fill via `np.fromiter`. Worst case: time-budget the alternative against the existing implementation; only adopt if measurably faster.
- **Acceptance**: `/explore` p95 drops by ~3–8 ms.

### OPT-034 · Heatmap STRtrees + Chicago boundary lazy-loaded on first `/explore`
- **File**: [backend/places.py](../backend/places.py), [backend/parks.py](../backend/parks.py), [backend/green_space.py](../backend/green_space.py), [backend/tree_canopy.py](../backend/tree_canopy.py), [backend/explore.py:175–180](../backend/explore.py#L175-L180)
- **Category**: Cold-start latency
- **Impact**: 🔴 High
- **Description**: STRtree builds + JSON parses for residential, parks, green-space, canopy, and the boundary polygon happen on demand inside the first `/explore` call. Cold-start request pays ~200–500 ms of work that future requests reuse from module-level caches.
- **Resolution path**: In `main.py` lifespan, after `_preload_graph` schedules, fire `loop.run_in_executor(None, places._ensure_index)`, `parks._ensure_index`, `green_space._ensure_index`, `tree_canopy._ensure_index`, `explore._get_chicago_boundary` in parallel. The `/health` endpoint stays trivial — the warm-up runs in the background so the container reports healthy promptly.
- **Acceptance**: First `/explore` after deploy responds within the normal budget (~300–400 ms) instead of ~700–900 ms.

### OPT-035 · uvicorn launched as single-worker
- **File**: [backend/Dockerfile:89](../backend/Dockerfile#L89)
- **Category**: Throughput
- **Impact**: 🔴 High
- **Description**: The container `CMD` runs uvicorn without `--workers N`, leaving Railway's available cores idle. Routing + isochrone work is CPU-bound, so multiple workers give close to linear throughput.
- **Resolution path**: Add `--workers ${UVICORN_WORKERS:-2}` to the `CMD` (Railway's smallest plan typically has 2 vCPUs). Verify memory headroom — each worker holds its own pickle + STRtrees (~200–300 MB), so the container plan needs to fit `workers × footprint`. Couple with OPT-034 so each worker warms eagerly.
- **Acceptance**: Under synthetic load (`hey -c 4 -n 100`) the p95 of concurrent `/route` requests stays close to single-request p95 instead of queueing.

---

## Tier H — frontend

### OPT-036 · `App.jsx` `buildExploreContents()` / `buildRouteContents()` rebuild on every render
- **File**: [frontend/src/App.jsx:782–1076](../frontend/src/App.jsx#L782-L1076)
- **Category**: React render perf
- **Impact**: 🔴 High
- **Description**: Both factories are invoked unconditionally inside the render body, allocating full JSX subtrees (1000+ nodes between them) on every render — sheet drag, theme toggle, any unrelated state change. Only the active branch lands in the DOM, but both pay the allocation cost.
- **Resolution path**: Wrap each in `useMemo` keyed on the real inputs they read (mode, result, exploreResult, activeFlavor, walkLogged, etc.), or extract them as memoized child components (`<RouteSidebarContents …/>`, `<ExploreSidebarContents …/>`) and let React handle reconciliation. Couple with OPT-037 — stable callback refs are required for memoization to actually take.
- **Acceptance**: React DevTools profiler shows no full sidebar re-render on sheet drag; mobile-Chrome touch frame budget stays under 16 ms during drag.

### OPT-037 · Inline arrow handlers throughout `App.jsx` defeat downstream memo
- **File**: [frontend/src/App.jsx:782–1076](../frontend/src/App.jsx#L782-L1076)
- **Category**: React render perf
- **Impact**: 🔴 High
- **Description**: Builder fns and `modeToggle` JSX use inline `onClick={() => …}` arrows that allocate fresh refs every render. Even if `ExploreForm`, `ExploreCategoryPanel`, `RouteFlavorTabs` are wrapped in `React.memo`, prop comparison fails on the handler and they re-render.
- **Resolution path**: Wrap each handler in `useCallback` with its real deps. Extract `modeToggle` JSX to a stable memoized component. Pairs with OPT-036.
- **Acceptance**: Profiler shows `ExploreForm` / `ExploreCategoryPanel` stable across renders that don't change their props.

### OPT-038 · `MapRouteLayer` re-uploads identical sources on flavor swap
- **File**: [frontend/src/map/MapRouteLayer.jsx:243–248](../frontend/src/map/MapRouteLayer.jsx#L243-L248), [frontend/src/mapHelpers.js:219–281](../frontend/src/mapHelpers.js#L219-L281)
- **Category**: MapLibre layer churn
- **Impact**: 🔴 High
- **Description**: The render effect's dep array is `[result, turnCoords, mode]`, so flipping `activeFlavor` (which lives elsewhere on `result`) re-calls `renderWalkRoute(...)` and re-`setData`s the segment / casing / turn sources with identical GeoJSON — re-kicks the draw-in animation and reallocates GPU buffers.
- **Resolution path**: Split the effect into (a) a data-load effect keyed on `[result?.path, result?.directions, mode]` that calls the source upsert + animation kick, and (b) a flavor / active-turn effect that only calls `setFeatureState`. Memoize `buildRouteSegments(result?.path, result?.directions)` outside the effect.
- **Acceptance**: Flavor swap on a 50+ step route stops re-running the polyline draw-in; profiler shows no GPU buffer reallocation.

### OPT-039 · `MapExploreLayer` single broad effect re-fires per heatmap toggle
- **File**: [frontend/src/map/MapExploreLayer.jsx:182–225](../frontend/src/map/MapExploreLayer.jsx#L182-L225)
- **Category**: MapLibre layer churn
- **Impact**: 🔴 High
- **Description**: A single effect with a broad dep array (`[mode, exploreResult, showResidential, showParks, showTreeCanopy, showGreenSpace, canopyBandColors, placeFeatures, placeExpressions]`) re-runs `renderExplore` end-to-end on every heatmap toggle. Unchecking residential repaints canopy + parks + green-space + pins.
- **Resolution path**: Split into one effect per layer source (residential, parks, green-space, canopy, polygon, pins). Each effect's deps include only the toggle + GeoJSON it manages.
- **Acceptance**: Toggling a single heatmap only paints that layer; other layers untouched in profiler.

### OPT-040 · `AddressAutocomplete` debounce defeated by parent re-renders
- **File**: [frontend/src/components/AddressAutocomplete.jsx:125–136](../frontend/src/components/AddressAutocomplete.jsx#L125-L136)
- **Category**: React effects / Debounce
- **Impact**: 🔴 High
- **Description**: The debounce effect's dep array includes `fetchFor`, which is rebuilt every time the parent's `getSuggestions` prop closure changes. Any parent re-render mid-debounce clears the 150 ms timer and restarts it. Net effect: when the parent re-renders frequently (e.g. on every keystroke updating `stops` state), the autocomplete fetches per keystroke, not per pause.
- **Resolution path**: Stabilize `getSuggestions` upstream in `App.jsx` with `useCallback` keyed on `[]` (the function only closes over module-level helpers). Verify with React DevTools that the `getSuggestions` prop into `AddressAutocomplete` keeps the same ref across renders.
- **Acceptance**: Typing "Wrigley Field" fires one `/autocomplete` request (or two, if the user pauses mid-word), not one per keystroke.

### OPT-041 · Self-hosted fonts not preloaded
- **File**: [frontend/index.html:21–25](../frontend/index.html#L21-L25)
- **Category**: First paint / Critical rendering path
- **Impact**: 🔴 High
- **Description**: Fraunces, Inter, JetBrains Mono (~878 KB combined as variable woff2) are linked via `@font-face` in `fonts.css` but not preloaded. First paint is delayed until the CSS parses → font is requested → font downloads.
- **Resolution path**: Add four `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/…">` lines in `<head>` of `index.html`, one per font file. Verify with Chrome DevTools Network → Priorities that the fonts now request alongside the HTML.
- **Acceptance**: FCP drops by 200–400 ms on 3G/Fast 3G throttling.

### OPT-042 · CSS `filter` applied to the MapLibre canvas
- **File**: [frontend/src/App.css:929–935](../frontend/src/App.css#L929-L935)
- **Category**: GPU compositing
- **Impact**: 🔴 High
- **Description**: `.maplibregl-canvas { filter: sepia(0.18) saturate(0.7) brightness(0.98); }` (and the Dusk variant) forces the browser to render the canvas to a backing surface, apply the filter, and blit on every frame — including during pan/zoom. ~10–15% GPU cost per frame.
- **Resolution path**: Bake the equivalent color shift into the MapLibre style JSON's raster paint properties (`raster-saturation`, `raster-brightness-min/max`, `raster-hue-rotate` — sepia is best approximated with `raster-saturation: -0.4` + `raster-hue-rotate: 30`). Keep the CSS `filter` as a fallback only if the style-level tuning doesn't quite hit the editorial tone, but treat that as a regression.
- **Acceptance**: Pan/zoom frame rate on a mid-tier Android device stays above 50 fps; profiler shows no per-frame canvas-filter blit.

---

## Tier M — measurable, profilable wins (backend)

### OPT-043 · CORS middleware not registered last (so runs first)
- **File**: [backend/main.py:195–202](../backend/main.py#L195-L202)
- **Category**: Middleware ordering
- **Impact**: 🟡 Medium
- **Description**: FastAPI middleware runs LIFO; CORS currently runs after security headers, so preflight OPTIONS pays the security-headers cost before short-circuiting at CORS.
- **Resolution path**: Move `app.add_middleware(CORSMiddleware, …)` to be the LAST `add_middleware` call so it executes first.
- **Acceptance**: OPTIONS preflight p50 drops by a few ms; no functional change.

### OPT-044 · Rate-limiter X-Forwarded-For parsed per request
- **File**: [backend/main.py:169–184](../backend/main.py#L169-L184)
- **Category**: Per-request CPU
- **Impact**: 🟡 Medium
- **Description**: The limiter key function runs `split(",")`, `strip`, list-comprehension on every request to extract the client IP. Under sustained load, this is real work — and the same parse runs again for `/health` polling traffic.
- **Resolution path**: Add a thin middleware (registered before the limiter) that parses once and stashes the IP on `request.state.client_ip`. The limiter key function becomes `lambda r: r.state.client_ip`.
- **Acceptance**: Profiler shows the key function as <1 µs; no behavioral change in `TRUSTED_PROXY_HOPS` semantics.

### OPT-045 · `_flavor_weights` cache unbounded
- **File**: [backend/walking.py](../backend/walking.py) (`_flavor_weights` dict)
- **Category**: Memory / eviction
- **Impact**: 🟡 Medium
- **Description**: The cache is keyed on `(flavor, …variant…)` and grows monotonically. In practice it caps at ~4–8 entries (3 flavors × 1–2 prefs), but there's no upper bound — and each entry is ~200 KB.
- **Resolution path**: Cap with a simple LRU (e.g. `functools.lru_cache` won't fit because the value is array; use an explicit `OrderedDict` with `move_to_end` and a `maxsize=8`).
- **Acceptance**: Memory stable across long-running process; no eviction-related correctness regressions.

### OPT-046 · `prepared.intersects` redundant pre-filter in residential heatmap
- **File**: [backend/places.py:281–300](../backend/places.py#L281-L300)
- **Category**: Wasted shapely work
- **Impact**: 🟡 Medium
- **Description**: Each candidate polygon runs `prepared.intersects(poly)` and *then* `.intersection(polygon)`. The intersection call already short-circuits on disjoint geometries internally; the prepared pre-filter is double work.
- **Resolution path**: Drop the `.intersects()` call; iterate candidates and filter out empty intersection results.
- **Acceptance**: Residential heatmap clip time drops by ~5–10 ms per `/explore`.

### OPT-047 · `fuzzy_match_neighborhood` walks all entries on empty `q_words`
- **File**: [backend/geocoding.py:614–624](../backend/geocoding.py#L614-L624)
- **Category**: Worst-case input handling
- **Impact**: 🟡 Medium
- **Description**: When the query reduces to zero non-stop-word tokens, `candidate_keys` is empty and the function falls into a full ~150-entry `SequenceMatcher.ratio()` walk. Single-char or stop-word-only queries can pay 20–50 ms.
- **Resolution path**: Early-return `(None, None)` when `q_words` is empty after stop-word removal.
- **Acceptance**: Empty-content queries return immediately; no behavioral change on real queries.

### OPT-048 · Edge source/target list-comps at graph load
- **File**: [backend/walking.py:250, 253–254](../backend/walking.py#L250-L254)
- **Category**: Startup time
- **Impact**: 🟡 Medium
- **Description**: `_edge_sources = [u for u, _ in edgelist]` and the parallel `_edge_targets` line do two full Python passes over `G.edgelist`.
- **Resolution path**: `el = np.array(G.get_edgelist(), dtype=np.int32); _edge_sources = el[:, 0]; _edge_targets = el[:, 1]`.
- **Acceptance**: Startup time drops by ~20–30 ms.

### OPT-049 · Tuple → list rewraps in `/route` response builder
- **File**: [backend/main.py:699–701, 720–723, 780](../backend/main.py#L699-L780)
- **Category**: Allocation waste
- **Impact**: 🟡 Medium
- **Description**: `[list(c) for c in resolved]` and similar list-wraps fire on every `/route`. FastAPI + orjson encode tuples and lists identically; the wraps are pure waste.
- **Resolution path**: Remove the `list(...)` wraps; pass tuples directly to the response dict.
- **Acceptance**: `/route` builder allocates 8–16 fewer small lists per request.

### OPT-050 · Background graph preload fire-and-forget
- **File**: [backend/main.py:129](../backend/main.py#L129)
- **Category**: First-request latency
- **Impact**: 🟡 Medium
- **Description**: `asyncio.ensure_future(loop.run_in_executor(None, _preload_graph))` schedules but doesn't await; the first `/route` arriving during load contends with the loader on the graph lock.
- **Resolution path**: `await loop.run_in_executor(None, _preload_graph)` inside the `lifespan` async context manager. Couple with OPT-034 so heatmap warm-up still goes in parallel after the graph is ready.
- **Acceptance**: First `/route` response time matches subsequent responses; no warm-up jitter.

### OPT-051 · `unary_union` per band on every `/explore`
- **File**: [backend/tree_canopy.py:216](../backend/tree_canopy.py#L216)
- **Category**: Hot-path shapely work
- **Impact**: 🟡 Medium
- **Description**: For each density band the code calls `unary_union(squares)` after building a list of fresh `box(...)` polygons per cell. The unit-square shape is identical; only translation differs.
- **Resolution path**: Pre-template a unit square at `(-0.5, -0.5, 0.5, 0.5)`; translate/scale per cell using shapely affine ops. Or skip `unary_union` and emit per-cell polygons (the frontend's render is already MultiPolygon-aware).
- **Acceptance**: Tree-canopy clip time drops by ~10–20 ms per `/explore`.

### OPT-052 · MRLC 3-chunk fetch in `build_tree_canopy.py` is serial
- **File**: [backend/scripts/build_tree_canopy.py:207–222](../backend/scripts/build_tree_canopy.py#L207-L222)
- **Category**: Build I/O
- **Impact**: 🟡 Medium
- **Description**: The three longitudinal MRLC chunks (the workaround for MRLC's silent east-side truncation) are fetched sequentially.
- **Resolution path**: `concurrent.futures.ThreadPoolExecutor(max_workers=3)` → submit all three `_fetch_chunk` calls in parallel, then accumulate into the shared `sum_flat` / `cnt_flat` numpy arrays (numpy ops are GIL-released and thread-safe for the accumulation pattern used).
- **Acceptance**: Yearly tree-canopy ingest drops by ~2–3 min.

### OPT-053 · Edge-midpoint arc-length loop in pure Python during bake
- **File**: [backend/fetch_street_graph.py:298–321](../backend/fetch_street_graph.py#L298-L321)
- **Category**: Build vectorization
- **Impact**: 🟡 Medium
- **Description**: Per-edge midpoint computation iterates segment-by-segment in a Python loop. Vectorize with numpy broadcasting over the full edge-geometry array.
- **Resolution path**: Stack all edge segments into a single `(N, 2)` coord array with per-edge segment-count offsets; cumulative arc length via `np.linalg.norm + np.cumsum`; midpoint via `np.searchsorted`.
- **Acceptance**: Yearly graph bake drops by ~1–2 min. Pairs with OPT-030.

### OPT-054 · Boundary JSON re-parsed lazily on first `/explore`
- **File**: [backend/explore.py:175–180](../backend/explore.py#L175-L180)
- **Category**: Startup vs. first-request
- **Impact**: 🟡 Medium
- **Description**: `_get_chicago_boundary` parses `chicago_boundary.json` lazily inside the first `/explore`. Negligible work (~20–50 ms) but rolls into the first-explore cold-start tax. Covered indirectly by OPT-034 if that lands.
- **Resolution path**: Cache the shapely geometry at module load (top-level `_BOUNDARY = _load_boundary()` with a try/except for the optional-file case).
- **Acceptance**: Boundary clip available on first `/explore` without first-call parse.

---

## Tier M — measurable, profilable wins (frontend)

### OPT-055 · `explorePrefs` localStorage write per category/sub toggle
- **File**: [frontend/src/App.jsx](../frontend/src/App.jsx) (`explorePrefs` save effect)
- **Category**: Synchronous storage / Quota pressure
- **Impact**: 🟡 Medium
- **Description**: Each category or sub checkbox toggle fires synchronous `localStorage.setItem(...)`. Rapid toggling (the explore mode invites it) can fire 5–10 writes in a second.
- **Resolution path**: Debounce the save effect with a `setTimeout` cleared on each change (300 ms is typical for this pattern). Pair with a `beforeunload` flush so prefs always persist before navigation.
- **Acceptance**: 10 rapid toggles result in 1 storage write, not 10.

### OPT-056 · `saveRecentSearch` does load + multiple stringify + write per fetch completion
- **File**: [frontend/src/hooks/useRouteFetch.js:112](../frontend/src/hooks/useRouteFetch.js#L112), [frontend/src/lib/recentSearches.js:24–44](../frontend/src/lib/recentSearches.js#L24-L44)
- **Category**: Synchronous storage / Allocation waste
- **Impact**: 🟡 Medium
- **Description**: The save path runs `loadRecentSearches` → `JSON.parse` → `JSON.stringify(stops)` for dedup key → another `JSON.stringify(recentEntryStops(r))` per existing entry in the filter loop → `JSON.stringify` again on save. 3+ JSON ops per save.
- **Resolution path**: Refactor `saveRecentSearch` to load once, stringify the new key once, dedupe with a `Set<string>` keyed on the same stringified shape, then serialize-and-write once.
- **Acceptance**: Profiler shows one JSON.parse + one JSON.stringify per save.

### OPT-057 · `useExploreFetch` in-flight guard silently drops new fetch
- **File**: [frontend/src/hooks/useExploreFetch.js:66–73](../frontend/src/hooks/useExploreFetch.js#L66-L73)
- **Category**: Stale UI / Wasted server work
- **Impact**: 🟡 Medium
- **Description**: The guard `if (exploreLoading) return;` skips the new fetch when one is in-flight. If the user toggles mode or changes origin mid-fetch, the stale prior result stays on screen; the new params are silently ignored.
- **Resolution path**: Replace the in-flight guard with a cancel-and-replace pattern: abort the previous AbortController and start a fresh fetch.
- **Acceptance**: Rapid mode-toggles eventually settle on the result matching the latest params, not the first.

### OPT-058 · `MapRouteLayer.removeFeatureState` runs after `setData`
- **File**: [frontend/src/map/MapRouteLayer.jsx:246](../frontend/src/map/MapRouteLayer.jsx#L246)
- **Category**: MapLibre internal state growth
- **Impact**: 🟡 Medium
- **Description**: `removeFeatureState` runs after the new GeoJSON has been set. If the old route had more turns than the new one, the high-IDs' feature state is orphaned in MapLibre's internal map. Over many flavor / route swaps, this dict grows monotonically.
- **Resolution path**: Track `prevMaxTurnId`; on swap, clear feature state for IDs > new max BEFORE calling `setData`. Or call `removeFeatureState({ source: "walk-turns" })` (no `id`) before set to clear the whole source.
- **Acceptance**: After 100 route swaps, the MapLibre feature-state map has at most `newRoute.turnCount` entries.

### OPT-059 · `mapHelpers._buildTurnPathInfo` recomputes cum-distance every call
- **File**: [frontend/src/mapHelpers.js:53–77](../frontend/src/mapHelpers.js#L53-L77)
- **Category**: Repeated work
- **Impact**: 🟡 Medium
- **Description**: `_buildTurnPathInfo` walks the full path once per direction to build cumulative distances. For a 500-point path × 50 directions, that's ~25k ops every `buildRouteSegments` call. Flavor swaps re-run it for unchanged paths.
- **Resolution path**: Memoize on `(path identity, directions identity)` in `useTurnCoords` or in a ref in `MapRouteLayer`.
- **Acceptance**: Flavor swap on a multi-stop route stops re-computing path-info.

### OPT-060 · `MapExploreLayer` MutationObserver theme thrash
- **File**: [frontend/src/map/MapExploreLayer.jsx:61–67](../frontend/src/map/MapExploreLayer.jsx#L61-L67)
- **Category**: Theme toggle UX
- **Impact**: 🟡 Medium
- **Description**: The observer fires `setThemeVersion(v => v + 1)` per class mutation. A theme toggle can fan to 2+ paint-property updates if React batches the mutation in two layout flushes.
- **Resolution path**: Gate the callback with a `requestAnimationFrame` token — only schedule one rAF, and inside it call `setThemeVersion`. Coalesce rapid mutations to one update.
- **Acceptance**: Theme toggle fires exactly one MapLibre paint update.

### OPT-061 · `useMediaQuery` duplicated listeners per call site
- **File**: [frontend/src/lib/useMediaQuery.js](../frontend/src/lib/useMediaQuery.js)
- **Category**: Listener proliferation
- **Impact**: 🟡 Medium
- **Description**: Each component that calls `useMediaQuery(q)` registers its own `matchMedia` listener. App.jsx and MobileLayout (and others) both subscribe to the same `(max-width: 480px)` query, so a single viewport change fires N listeners.
- **Resolution path**: Hoist to a `ViewportProvider` at the root that registers one listener per query and broadcasts via context. Or maintain a module-level cache of `matchMedia` instances + a shared subscriber set.
- **Acceptance**: Three queries × one listener each on resize, not N × N.

### OPT-062 · `useShareCard` map render await with no timeout
- **File**: [frontend/src/hooks/useShareCard.js:117](../frontend/src/hooks/useShareCard.js#L117)
- **Category**: UX failure mode
- **Impact**: 🟡 Medium
- **Description**: `map.once("render", resolve)` + `triggerRepaint()` can hang if the render event doesn't fire (rare but possible on iOS WebGL context loss). The share-card modal hangs forever.
- **Resolution path**: `Promise.race([renderPromise, new Promise((_, rej) => setTimeout(() => rej(new Error("map render timeout")), 5000))])`. Caller already has error UI for share-card failures.
- **Acceptance**: Worst-case share modal exits after 5 s with a retry affordance instead of hanging.

### OPT-063 · `DirectionLedger` renders full direction list collapsed
- **File**: [frontend/src/components/DirectionLedger.jsx:60–114](../frontend/src/components/DirectionLedger.jsx#L60-L114)
- **Category**: DOM weight
- **Impact**: 🟡 Medium
- **Description**: A 100+ step multi-stop route mounts 95+ off-screen DOM nodes even when the directions panel is collapsed. Each node has handlers and aria attributes.
- **Resolution path**: Render only the visible rows when collapsed (the first 5 + a "show all" footer). When expanded, render all. Optionally add light virtualization for routes > 50 steps.
- **Acceptance**: A 100-step route mounts ~6 nodes collapsed; profiler shows reduced commit phase.

### OPT-064 · Self-hosted fonts not Unicode-range subset
- **File**: [frontend/src/wayfarer/fonts.css:1–33](../frontend/src/wayfarer/fonts.css#L1-L33)
- **Category**: Font bytes
- **Impact**: 🟡 Medium
- **Description**: All four font files ship the full character set. Chicago place names use Latin + Latin Extended only.
- **Resolution path**: Subset each woff2 to `U+0000-024F` (Latin + Latin Extended-A) using `fonttools subset`. Add `unicode-range: U+0000-024F;` to each `@font-face`. Replace the current woff2 files with the subsets.
- **Acceptance**: Total font bytes drop by 2–3× (~300–500 KB saved); no visible glyph changes.

### OPT-065 · No client-side autocomplete result cache
- **File**: [frontend/src/lib/autocompleteApi.js:8–43](../frontend/src/lib/autocompleteApi.js#L8-L43)
- **Category**: Redundant network
- **Impact**: 🟡 Medium
- **Description**: Identical autocomplete queries (user types, deletes, retypes; same prefix across two stop inputs) hit the backend twice.
- **Resolution path**: Tiny in-memory LRU (`new Map()` + delete-on-get-re-set, max 20 entries) keyed by `(q, limit)`. Bypass on `Cache-Control: no-store` style needs (not applicable here).
- **Acceptance**: Repeat queries return in <1 ms from cache; 10–20% reduction in `/autocomplete` traffic.

### OPT-066 · `box-shadow` on every category swatch
- **File**: [frontend/src/App.css:2626–2634](../frontend/src/App.css#L2626-L2634)
- **Category**: Paint cost
- **Impact**: 🟡 Medium
- **Description**: `.explore-cat-row-swatch` carries `box-shadow: 0 0 0 1px var(--ink)` × 50+ swatches. Box-shadow is a paint-heavy primitive that forces rasterization on every composite.
- **Resolution path**: Replace with `border: 1px solid var(--ink)` (visually equivalent at 1 px, much cheaper to paint). Verify the swatch sizing still aligns (border participates in box-sizing).
- **Acceptance**: Explore panel scroll FPS improves on mid-tier devices; rendering profile shows fewer paint nodes.

### OPT-067 · `box-shadow` on `.wf-sheet` recomposites during drag
- **File**: [frontend/src/App.css:29–37](../frontend/src/App.css#L29-L37)
- **Category**: Paint cost
- **Impact**: 🟡 Medium
- **Description**: 24 px blur radius on the sheet's shadow causes the browser to re-rasterize the shadow region on every drag frame.
- **Resolution path**: Use `filter: drop-shadow(0 -8px 12px ...)` on the sheet's parent so the sheet itself promotes to its own layer; or just cut blur to 12 px.
- **Acceptance**: Sheet drag stays at 60 fps on a mid-tier Android.

### OPT-068 · `_get_flavor_weights` length check on every double-check
- **File**: [backend/walking.py:609–628](../backend/walking.py#L609-L628)
- **Category**: Hot-path lock contention
- **Impact**: 🟡 Medium
- **Description**: The DCL re-checks `len(cached) == G.ecount()` inside the lock. `len()` on a numpy array is cheap but the comparison is part of the lock path on every concurrent request.
- **Resolution path**: Store `_graph_ecount_at_load` as a module var updated alongside the graph load; the cache key becomes `(flavor, ecount_version)` and the inner check is `cached.version == current_version` — pure int compare.
- **Acceptance**: Under concurrent load the lock spin time drops; no behavioral change.

### OPT-069 · `/explore` thread pool starvation under load
- **File**: [backend/main.py:386–421](../backend/main.py#L386-L421)
- **Category**: Concurrency / Thread pool sizing
- **Impact**: 🟡 Medium
- **Description**: Five parallel heatmap futures share the default `ThreadPoolExecutor` (`min(32, cpu_count + 4)` threads). Under high load these five queue behind unrelated work.
- **Resolution path**: Create a dedicated `ThreadPoolExecutor(max_workers=8, thread_name_prefix="heatmap")` at module load and submit heatmap futures to it. Couple with OPT-035 (multiple workers each get their own pool).
- **Acceptance**: Concurrent `/explore` load shows even latency across requests rather than head-of-line blocking.

---

## Tier L — nits / consistency / future-proofing

### OPT-070 · `osmnx` in `requirements.txt` is build-time only
- **File**: [backend/requirements.txt](../backend/requirements.txt)
- **Category**: Image size
- **Impact**: 🟢 Low
- **Description**: `osmnx==2.1.0` is only imported by `fetch_street_graph.py` (a developer build script). It pulls ~100–200 MB of transitive deps (networkx, geopandas, fiona, rtree) into the prod Docker image.
- **Resolution path**: Move `osmnx==2.1.0` to `requirements-dev.txt`. Verify `pip install -r requirements.txt` in a clean venv still satisfies all runtime imports.
- **Acceptance**: Prod image is ~100–200 MB smaller; `fetch_street_graph.py` still runs in dev.

### OPT-071 · Dockerfile base image floats patch version
- **File**: [backend/Dockerfile:2](../backend/Dockerfile#L2)
- **Category**: Reproducibility
- **Impact**: 🟢 Low
- **Description**: `FROM python:3.11-slim` floats the patch version, so layer caches and behavioral guarantees drift between builds.
- **Resolution path**: Pin to `python:3.11.9-slim` (or the latest stable 3.11 patch); review quarterly.
- **Acceptance**: Image SHA stable across rebuilds without code changes.

### OPT-072 · `build_community_area_centroids.py` writes with `indent=2`
- **File**: [backend/scripts/build_community_area_centroids.py:77](../backend/scripts/build_community_area_centroids.py#L77)
- **Category**: Artifact size consistency
- **Impact**: 🟢 Low
- **Description**: Tiny file (~2 KB) so the bytes don't matter, but inconsistent with every other build script. Lands incidentally with OPT-028.
- **Resolution path**: Change to `separators=(",", ":")`.
- **Acceptance**: Output file minified.

### OPT-073 · No React vendor chunk in Vite build
- **File**: [frontend/vite.config.js:148–155](../frontend/vite.config.js#L148-L155)
- **Category**: Bundle caching
- **Impact**: 🟢 Low
- **Description**: Only `maplibre-gl` is manually chunked. React / react-dom bundle with the app, so every app-code hash change re-downloads React.
- **Resolution path**: Add a `react` manual chunk rule: `if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) return "react-vendor";`. Order it before the `maplibre` rule.
- **Acceptance**: Subsequent app releases reuse the cached React chunk; ~40 KB saved on warm loads.

### OPT-074 · PWA icons not run through pngcrush / oxipng
- **File**: `frontend/public/passage-icon-*.png`
- **Category**: PWA install size
- **Impact**: 🟢 Low
- **Description**: ~16 KB combined; modern PNG optimizers typically save 10–30% on this type of asset.
- **Resolution path**: One-shot `oxipng -o 4 --strip safe frontend/public/passage-icon-*.png`; commit. Add to a build step if recurring.
- **Acceptance**: 2–4 KB total saved; visual identical.

### OPT-075 · `explorePrefs.EXPLORE_DEFAULTS` deep-cloned via JSON round-trip at module load
- **File**: [frontend/src/lib/explorePrefs.js:157](../frontend/src/lib/explorePrefs.js#L157)
- **Category**: Allocation
- **Impact**: 🟢 Low
- **Description**: `JSON.parse(JSON.stringify(DEFAULT_PREFS))` is a deep-clone anti-pattern firing at import time.
- **Resolution path**: Replace with `Object.freeze(DEFAULT_PREFS)` if mutation prevention is the goal, or `structuredClone(DEFAULT_PREFS)` if a fresh copy is needed.
- **Acceptance**: Module-import cost drops marginally; no behavioral change.

### OPT-076 · `usePersonalization` writes per pref instead of coalesced
- **File**: [frontend/src/hooks/usePersonalization.js:36–49](../frontend/src/hooks/usePersonalization.js#L36-L49)
- **Category**: Storage roundtrips
- **Impact**: 🟢 Low
- **Description**: Five separate `useEffect`s each call their own `saveXxx()` on state change.
- **Resolution path**: Coalesce into one effect that depends on all five state values and writes one merged object (or calls all five savers in one batch).
- **Acceptance**: Updating height + weight writes once, not twice.

### OPT-077 · `MapView` gesture lock effect toggles without target-state guard
- **File**: [frontend/src/map/MapView.jsx:122–127](../frontend/src/map/MapView.jsx#L122-L127)
- **Category**: Redundant MapLibre API calls
- **Impact**: 🟢 Low
- **Description**: The effect calls `lockMapGestures` / `unlockMapGestures` on every dep change without checking if the map is already in the target state.
- **Resolution path**: Cache prev state in a ref; only call the lock/unlock helper when state actually changes.
- **Acceptance**: No-op state changes don't trigger redundant API calls.

### OPT-078 · `ExploreCategoryPanel` `.some()` over subs per parent render
- **File**: [frontend/src/components/ExploreCategoryPanel.jsx:183](../frontend/src/components/ExploreCategoryPanel.jsx#L183)
- **Category**: Repeated linear scans
- **Impact**: 🟢 Low
- **Description**: `cat.subs.some(s => selectedSubSet.has(...))` runs per parent render to decide sublist visibility.
- **Resolution path**: Precompute `subsByCategory` (a `Map<categoryKey, true>`) in a `useMemo([selectedSubs])` and check `subsByCategory.has(cat.key)` in O(1).
- **Acceptance**: Toggling one sub recomputes only the affected category's subtree, not all five groups.

### OPT-079 · `local_search.autocomplete` post-merge dedup walks full list
- **File**: [backend/local_search.py:238–256](../backend/local_search.py#L238-L256)
- **Category**: Worst-case allocation
- **Impact**: 🟢 Low
- **Description**: All sources are concatenated, then a final loop dedups. For short queries that match thousands of addresses, the intermediate list grows large before dedup.
- **Resolution path**: Dedupe at source-merge time: maintain a `seen: set[tuple]` and skip duplicates before appending.
- **Acceptance**: Short-query autocomplete uses less peak memory.

### OPT-080 · `places.STRtree` built with Python list of Point objects
- **File**: [backend/places.py:145](../backend/places.py#L145)
- **Category**: Memory / Build time
- **Impact**: 🟢 Low
- **Description**: `geoms = [Point(p["lon"], p["lat"]) for p in places]` allocates a fresh `Point` (PyObject, ~32 B + GEOS overhead) per place. STRtree accepts a coord array directly.
- **Resolution path**: Pass coords as a `(N, 2)` numpy array to `STRtree(...)` if the version supports it; otherwise build the Point list lazily.
- **Acceptance**: STRtree build drops by ~1–2 MB memory + a few ms.

### OPT-081 · `local_search` SQLite read-only conn missing `PRAGMA query_only`
- **File**: [backend/local_search.py:80–84](../backend/local_search.py#L80-L84)
- **Category**: SQLite planner hint
- **Impact**: 🟢 Low
- **Description**: The connection opens with `mode=ro` (file-level read-only) but doesn't set `PRAGMA query_only=1`, which lets the planner skip write-related validations.
- **Resolution path**: Add `conn.execute("PRAGMA query_only=1")` after opening.
- **Acceptance**: Marginal query-plan improvement; no behavioral change.

### OPT-082 · `geocoding._cache_db` WAL checkpoint never explicit
- **File**: [backend/geocoding.py](../backend/geocoding.py) `_cache_connect` / atexit hook
- **Category**: Disk growth resilience
- **Impact**: 🟢 Low
- **Description**: The cache DB opens in WAL mode (good for concurrent reads + writes). If the process crashes repeatedly, the `.wal` file can grow large between clean shutdowns.
- **Resolution path**: In the atexit hook, run `PRAGMA wal_checkpoint(TRUNCATE)` before closing. Cheap, idempotent.
- **Acceptance**: WAL file stays small across normal shutdowns.

### OPT-083 · `build_chicago_boundary.py` writes full-precision polygon
- **File**: [backend/scripts/build_chicago_boundary.py](../backend/scripts/build_chicago_boundary.py)
- **Category**: Artifact size (rare refresh)
- **Impact**: 🟢 Low
- **Description**: The boundary polygon is used to clip lakefront isochrones — sub-meter ring detail is wasted at the resolution this clip operates at. Boundary refresh runs ~once per decade.
- **Resolution path**: Add `.simplify(0.0001, preserve_topology=True)` (~10 m) before writing. Verify the clip behavior at lakefront origins (Lakeview East, Streeterville) is visually identical.
- **Acceptance**: `chicago_boundary.json` smaller; lakefront clips visually unchanged.

### OPT-084 · `stepLog` accumulation unbounded
- **File**: [frontend/src/lib/stepLog.js](../frontend/src/lib/stepLog.js)
- **Category**: Future storage bloat
- **Impact**: 🟢 Low
- **Description**: The 7-day step log API exists but the underlying array doesn't appear to trim old entries on boot. A user logging steps daily for a year would accumulate large state.
- **Resolution path**: On load, drop entries with `timestamp < now - 90d`. Or cap at 100 most-recent entries.
- **Acceptance**: localStorage stays well under quota even after a year of use.

### OPT-085 · `AddressAutocomplete` suggestion list keys fragile for duplicates
- **File**: [frontend/src/components/AddressAutocomplete.jsx](../frontend/src/components/AddressAutocomplete.jsx) (`<li key={...}>`)
- **Category**: React reconciliation
- **Impact**: 🟢 Low
- **Description**: `${s.source}-${s.label}-${s.lat ?? "x"}-${i}` includes the index as a fallback, which makes filtering/reordering cause unnecessary remounts.
- **Resolution path**: Once the backend returns a stable `id` per suggestion (small change in `local_search.autocomplete`), use it as the key.
- **Acceptance**: Suggestion list updates without DOM remounts.

### OPT-086 · `_looks_like_free_text_address` builds a split list on every autocomplete
- **File**: [backend/main.py:474–524](../backend/main.py#L474-L524)
- **Category**: Per-request allocation
- **Impact**: 🟢 Low
- **Description**: The heuristic that decides whether to supplement local results with LocationIQ does `q.lstrip().split(None, 1)[0]` — a list allocation per call.
- **Resolution path**: Test the first non-whitespace character directly: `head = next((c for c in q.lstrip() if c), ""); return head.isdigit()`.
- **Acceptance**: One fewer list allocation per `/autocomplete`.
