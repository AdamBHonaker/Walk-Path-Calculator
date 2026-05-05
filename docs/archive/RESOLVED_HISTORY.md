# Resolved History

A unified log of all resolved issues across three categories. New entries are appended here when work is completed:
- **Bugs** — moved here from an active bug-tracking file when fixed.
- **Technical Debt** — moved here from [`Technical_Debt.md`](Technical_Debt.md) when the debt is paid off.
- **Efficiency Improvements** — moved here from [`Efficiency_Improvements.md`](Efficiency_Improvements.md) when implemented.

Priority / Impact: 🔴 High · 🟡 Medium · 🟢 Low.

---

## Resolved Bugs

### 2026-05-05 · Reverse-geocode coordinate fallback poisoned cache (BUG-RG-FALLBACK)

**File:** `backend/geocoding.py`

**Priority:** 🟡 Medium

**What the bug was:** `reverse_geocode_point` wrote its `result` to `_geocode_cache` for every code path, including the `{"label": "lat, lon", "source": "coordinates"}` fallback that fires when `_reverse_geocode_google` returns `None` (transient network error, missing `GOOGLE_MAPS_API_KEY`, Google 5xx, etc.). Because `_geocode_cache` is also persisted to `geocode_cache.json`, a single transient failure permanently poisoned that lat/lon: every subsequent click returned the raw coordinate string instead of an address even after Google recovered.

**How it was resolved:** Skip the cache write entirely when `result["source"] == "coordinates"`. Authoritative answers (`"neighborhood"` and `"google"`) are still cached and persisted as before; only the fallback is now treated as ephemeral.

---

### 2026-05-05 · Persistent geocode cache lost writes under multi-worker deploys (BUG-CACHE-MULTIPROC)

**File:** `backend/geocoding.py`

**Priority:** 🟢 Low

**What the bug was:** `_geocode_cache` is loaded into each process at import time and serialised via atomic `tmp.replace(...)` — atomic but last-writer-wins. Under any multi-worker config (`uvicorn --workers 2+`, `gunicorn -w N`), each worker held its own dict; whichever flushed last overwrote the cache file with its private subset and silently discarded entries other workers learned. Single-worker deploys (current Railway config) were unaffected, but the project was one config flag away from data loss.

**How it was resolved:** `_save_geocode_cache` now performs merge-on-write: it re-reads the on-disk JSON immediately before serializing and unions it with the in-memory cache (in-memory wins on conflict). Reads happen under `_geocode_write_lock`, so concurrent flushes within a single process remain serialized. Cross-process safety is now eventual-consistent rather than last-writer-wins.

---

### 2026-05-05 · 2-stop `total_miles` drifted ~0.01 mi via double-rounding (BUG-MILES-DRIFT)

**File:** `backend/main.py`

**Priority:** 🟢 Low

**What the bug was:** `_summarize_alt` rounded `total_minutes = round(alt["minutes"] * pace_factor, 1)` and then derived `total_miles = round(total_minutes / pace_factor * WALKING_SPEED_MPH / 60.0, 2)` from that already-quantised value. At brisk pace (`pace_factor = 0.75`) the recovery error pushed rounded mileage by ±0.01 mi and step counts drifted in the same direction. The multi-stop branch already computed leg miles from unrounded canonical minutes.

**How it was resolved:** Compute `total_miles` directly from the unrounded `alt["minutes"] * WALKING_SPEED_MPH / 60.0` and derive `total_minutes` independently. Mirrors the multi-stop logic and removes the pace-dependent drift.

---

### 2026-05-04 · Frontend personalization fields silently dropped by backend

**Files:** `backend/main.py`, `backend/walking.py`, `backend/steps.py`, `backend/tests/test_main.py`, `backend/tests/test_steps.py`

**Priority:** 🔴 High

**What the bug was:** [`frontend/src/App.jsx`](../../frontend/src/App.jsx) sent `weight_kg`, `daily_goal`, `pace`, `avoid_stairs`, and `prefer_pedestrian` in the `/route` POST body, but `RouteRequest` in `backend/main.py` only declared `stops`, `origin`, `destination`, and `height_inches` — Pydantic silently dropped the extras. The UI also read `personalized_calories`, `elevation_gain_ft`, and `pace` from the response, but the backend never produced them. The net effect: every preference the user set in the UI's pace selector, weight input, accessibility prefs, and goal panel went to `/dev/null`, and conditionally rendered "personalized calories" / pace / elevation chips never appeared even when the user *had* configured a weight or pace.

**How it was resolved:**
- `RouteRequest` now declares all five fields with full validation (`weight_kg` 30–300 kg, `daily_goal` 1k–100k, `pace ∈ {leisurely, normal, brisk}`, two booleans). Invalid values now return 422 instead of being ignored.
- `backend/steps.py` extends `calories_from_minutes(minutes, weight_kg=None, pace="normal")` to apply the standard MET-based formula `kcal = MET × weight_kg × 3.5 / 200 × minutes` (MET 2.5 / 3.5 / 4.5 for the three paces). Defaults preserve the prior 4.3 kcal/min coefficient to round-trip the existing `test_thirty_minutes` assertion.
- `backend/walking.py` adds `pace_minutes_factor(pace)` (used by `main.py` to rescale canonical-3 mph minutes to the user's pace) and `compute_route_with_prefs(...)`. The latter routes under `greenest` when `prefer_pedestrian=True` and runs an uncached Dijkstra with `_AVOID_STAIRS_PENALTY_M = 10 000 m` layered onto step edges when `avoid_stairs=True`.
- The `/route` handler threads all five inputs through both the 2-stop and multi-stop branches. The response now includes `pace` and `personalized_calories: bool`, and collapses `available_flavors` to `["custom"]` when either routing pref is set.
- 15 new backend tests cover: pace rescaling, weight-driven calorie scaling, invalid-pace and invalid-weight rejection (422), `daily_goal` propagating into `daily_goal_pct`, `avoid_stairs` returning the `custom` flavor, plus four `/reverse-geocode` cases (in-bounds, neighborhood-source resolution, north/west out-of-bounds rejection).
- `elevation_gain_ft` is intentionally not added — the street graph has no elevation data. The frontend already conditionally hides the chip (`elevation_gain_ft > 10`), so omitting the field keeps the chip hidden, which is correct for v1.

Total backend test count after changes: **71 tests, all passing** (up from 56).

---

### 2026-05-03 · HSTS header set on attacker-controlled `X-Forwarded-Proto` (BUG-005)

**File:** `backend/main.py`, `backend/.env.example`

**Priority:** 🟢 Low

**What the bug was:** The `add_security_headers` middleware emitted `Strict-Transport-Security` whenever the request scheme was `https` *or* the `X-Forwarded-Proto` header was `https`. On a directly-exposed instance (no trusted reverse proxy), a malicious client could send `X-Forwarded-Proto: https` over plain HTTP to coax the server into issuing a one-year HSTS directive, downgrading future plaintext access for that browser. Behind Railway / Cloudflare the header is trustworthy; outside that context it isn't.

**How it was resolved:** Added a `TRUST_PROXY_HEADERS` env var (default `false`). The forwarded-proto branch is only consulted when the operator opts in. `backend/.env.example` documents the new variable with deployment guidance.

---

### 2026-05-03 · Multi-stop totals drift from 2-stop (BUG-004)

**File:** `backend/main.py`

**Priority:** 🟢 Low

**What the bug was:** 2-stop responses derived `total_steps` and `calories_approx` once at the end (`steps_from_miles(total_miles, ...)`), but the multi-stop branch summed per-leg already-rounded values. The two strategies drifted by ±N (leg-count) steps and ≤1 calorie for the same physical path, so an `A→C` walk and an `A→B→C` walk that traced the identical route reported slightly different totals.

**How it was resolved:** After the per-leg loop in the multi-stop branch, recompute `total_steps = steps_from_miles(total_miles, step_len)` and `total_calories = calories_from_minutes(total_minutes, weight_kg, pace)` from the unrounded sums. Per-leg numbers in `legs_out` are unchanged; only the route-level totals were affected.

---

### 2026-05-03 · Google geocoder retried persistent failures forever (BUG-003)

**File:** `backend/geocoding.py`

**Priority:** 🟢 Low

**What the bug was:** `geocode_google` only wrote a negative cache entry for `status == "ZERO_RESULTS"`. For `REQUEST_DENIED`, `INVALID_REQUEST`, network errors, etc., nothing was cached, so a misconfigured key or a single bad query would hammer Google on every retry — risky given the pending daily-quota cap on the active project.

**How it was resolved:** Replaced the single `zero_results` flag with a `_PERSISTENT_FAILURE_STATUSES = {"ZERO_RESULTS", "REQUEST_DENIED", "INVALID_REQUEST"}` set; any of those now writes `None` to the cache, short-circuiting future calls for the same query. Transient statuses (`OVER_QUERY_LIMIT`, network timeouts) intentionally remain uncached so they can recover once the upstream issue clears.

---

### 2026-05-03 · `logWalk` recorded UTC date, mislabeling late-evening walks (BUG-002)

**File:** `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the bug was:** `logWalk` stored `new Date(now).toISOString().slice(0, 10)`, which formats the **UTC** date. For Chicago (UTC-5/-6), a walk logged after ~7 PM local time was tagged with the next calendar day in the Weekly Summary panel. The 7-day TTL prune was unaffected (it uses raw timestamps), but the visible per-row label was wrong every night.

**How it was resolved:** Build the date string from local components (`d.getFullYear()`/`getMonth()`/`getDate()` zero-padded) so the recorded date matches the user's wall clock regardless of timezone.

---

### 2026-05-03 · MapView error handler crashed on errors with no `message` (BUG-001)

**File:** `frontend/src/MapView.jsx`

**Priority:** 🟡 Medium

**What the bug was:** The expression `e?.error?.message?.toLowerCase().includes("style")` in the maplibre `error` listener stopped its optional chain at `toLowerCase()`. When a maplibre error fired without an `error.message` property (some tile-fetch and image-load errors are emitted as plain objects), the chain produced `undefined`, then `.includes("style")` threw `TypeError: Cannot read properties of undefined (reading 'includes')`. The handler aborted before `setStyleError(true)` could fire, so the user never saw the friendly "Map tiles unavailable" notice for that class of failures.

**How it was resolved:** Added the missing optional chain: `e?.error?.message?.toLowerCase()?.includes("style")`. The expression now safely yields `undefined` (falsy) when any link in the chain is absent, and the `isStyleSource` check falls through to the next branch.

---

### 2026-05-02 · RouteCard crashes when result prop is null (BUG-001)

**File:** `frontend/src/RouteCard.jsx`

**Priority:** 🔴 High

**What the bug was:** The component destructured `result` at the top of its render body without a null guard. If `result` was null — whether from a race condition, the modal opening before data arrived, or a future caller omitting the prop — React would throw `TypeError: Cannot destructure property 'total_steps' of null`.

**How it was resolved:** Added `if (!result) return null;` on line 57, immediately before the destructuring. The component now safely returns nothing when result is absent.

---

### 2026-05-02 · Missing test coverage for frontend edge cases (BUG-002)

**Files:** `frontend/src/compareEstimates.test.js`, `frontend/src/mapHelpers.test.js`, `frontend/src/RouteCard.test.jsx` (new)

**Priority:** 🟡 Medium

**What the bug was:** Three coverage gaps left real code paths untested:
1. `rideShareCost` and `co2AvoidedKg` were never tested with negative-mile inputs, despite `drivingMinutes` having that coverage — inconsistency that could mask guard regressions.
2. `transitMinutes` was not tested with negative walk-minute inputs.
3. The entire `turnCoords`/turn-marker code path in `renderWalkRoute` (mapHelpers.js lines 84–98) was never exercised; all existing tests passed `null`.
4. `RouteCard` had no test file at all, so BUG-001 above went undetected.

**How it was resolved:**
- Added negative-value assertions to `rideShareCost`, `co2AvoidedKg`, and `transitMinutes` tests.
- Added six new `renderWalkRoute` tests covering: turn-marker source/layer added when `turnCoords` provided, omitted when `null`, `activeTurnIndex` propagated into GeoJSON, and intermediate stop markers added/omitted based on `stop_coords` length.
- Created `frontend/src/RouteCard.test.jsx` with a null-result smoke test (directly verifying BUG-001 fix) and three render tests for step count, stats, and route labels.

Total test count after changes: **115 tests, all passing**.

---

### 2026-05-03 · Maplibre marker / popup / control DOM rendered invisibly (BUG-003)

**File:** `frontend/src/main.jsx`

**Priority:** 🟡 Medium

**What the bug was:** The project never imported `maplibre-gl/dist/maplibre-gl.css`. Without that stylesheet, the `.maplibregl-marker` container (and `.maplibregl-popup`, `.maplibregl-ctrl*`, etc.) has no positioning rules, so anything maplibre adds to the DOM as a marker or control element renders at zero size / wrong position and is effectively invisible. The bug was latent because the existing route polyline and turn-circle markers are drawn on the WebGL canvas — those don't depend on the stylesheet — so the map *looked* fine. It only surfaced when the new pin-confirm flow added the first real `maplibregl.Marker` and the pin failed to appear despite being present in the DOM.

**How it was resolved:** Added `import "maplibre-gl/dist/maplibre-gl.css";` at the top of [`frontend/src/main.jsx`](frontend/src/main.jsx). This single import covers every maplibre DOM element going forward (markers, popups, navigation/scale/geolocate controls, attribution, etc.), not just the new pick-pin marker.

---

## Technical Debt Paid Off

### 2026-05-04 · Unused `wayfarer/` design system (~1,381 lines of dead code) (2026-05-03 TD-001)

**File:** `frontend/src/wayfarer/` (deleted), `CLAUDE.md`

**Priority:** 🔴 High

**What the debt was:** The `wayfarer/` subdirectory contained an internal design system (primitives, forms, icons, tokens, themes — 1,381 lines of `.jsx` and `.css` total) that was never imported by any application file. `CLAUDE.md` documented it as "Internal design system", which made it look load-bearing while in practice none of `App.jsx`, `MapView.jsx`, `RouteCard.jsx`, `index.css`, `App.css`, or `main.jsx` referenced it.

**How it was resolved:** Deleted the entire `frontend/src/wayfarer/` directory. Updated the project-tree section of `CLAUDE.md` to remove the wayfarer mention and replace it with the new `lib/` layout (storage, recentSearches, stepLog) and the freshly extracted `calorieEquiv.js`.

> **Note (2026-05-05):** The `frontend/src/wayfarer/` directory was re-introduced the following day as the foundation of Wayfarer Phase 1 and is now load-bearing again (imported by every component in `src/components/` and by `main.jsx`). See [`frontend/handoff/HANDOFF.md`](../../frontend/handoff/HANDOFF.md). This entry is preserved for historical accuracy.

---

### 2026-05-04 · `App.jsx` was a 1,666-line monolith (2026-05-03 TD-002)

**Files:** `frontend/src/App.jsx`, `frontend/src/calorieEquiv.js` (new), `frontend/src/lib/storage.js` (new), `frontend/src/lib/recentSearches.js` (new), `frontend/src/lib/stepLog.js` (new)

**Priority:** 🟡 Medium

**What the debt was:** `App.jsx` mixed top-level state, URL param parsing, fetch-with-timeout, four `memo`'d input cards, the StepHero / ComparePanel / LoadingSkeleton / ErrorBoundary components, recent-searches persistence, the multi-day step log, the calorie-equivalent food table, and the share modal — all in one file. The file exported nine named symbols solely so `App.test.jsx` could reach internal helpers, which is a strong "this should be split" signal.

**How it was resolved:** Extracted four standalone modules:
- [`calorieEquiv.js`](../../frontend/src/calorieEquiv.js) — `CALORIE_FOODS`, `NICE_FRACS`, `calorieEquivalent()`. Tested in [`calorieEquiv.test.js`](../../frontend/src/calorieEquiv.test.js).
- [`lib/storage.js`](../../frontend/src/lib/storage.js) — `safeGet`, `safeSet`, `safeRemove`, `loadJSON`, `saveJSON`. Replaces ten try/catch sites in App.jsx with one-liner calls.
- [`lib/recentSearches.js`](../../frontend/src/lib/recentSearches.js) — `loadRecentSearches`, `saveRecentSearch`, `clearRecentSearches`, `recentEntryStops`, `formatRecentChip`, `RECENT_KEY`, `RECENT_MAX`.
- [`lib/stepLog.js`](../../frontend/src/lib/stepLog.js) — `loadStepLog`, `logWalk`, `clearStepLog`, `STEP_LOG_TTL_DAYS`. Includes the prior BUG-002 fix (local-date YYYY-MM-DD instead of UTC ISO).

`App.jsx` re-exports the symbols `App.test.jsx` imports, so the existing 122-test suite passes unchanged. Line count: 1,666 → 1,518 (further splitting of the React components themselves was deferred — the persistence/data layer is fully extracted, which captures the bulk of the testability and duplication wins).

---

### 2026-05-04 · Six separate `try/catch` localStorage helpers in `App.jsx` (2026-05-03 TD-003)

**Files:** `frontend/src/lib/storage.js` (new), `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the debt was:** Every persisted preference (`walkpath:dailyGoal`, `walkpath:weightUnit`, `walkpath:walkPace`, `walkpath:accessPrefs`, `walkpath:recentSearches`, `walkpath:stepLog`) reimplemented the same `try { localStorage.getItem / parseInt / JSON.parse / setItem } catch { /* ignore */ }` boilerplate. The "ignore quota / privacy mode" comment appeared verbatim three times.

**How it was resolved:** Added [`lib/storage.js`](../../frontend/src/lib/storage.js) exporting `safeGet`, `safeSet`, `safeRemove`, `loadJSON`, `saveJSON`. Replaced all ten call sites in `App.jsx` plus the new `recentSearches.js` / `stepLog.js` modules with single-line calls. No remaining raw `localStorage.*` in `App.jsx`.

---

### 2026-05-04 · Map style URL, center, zoom duplicated between MapView and RouteCard (2026-05-03 TD-004)

**Files:** `frontend/src/mapHelpers.js`, `frontend/src/MapView.jsx`, `frontend/src/RouteCard.jsx`

**Priority:** 🟡 Medium

**What the debt was:** Both `MapView.jsx` and `RouteCard.jsx` independently read `VITE_MAP_STYLE_URL` with the same fallback URL (`https://tiles.openfreemap.org/styles/liberty`) and hardcoded `center: [-87.654, 41.966]` (Uptown, Chicago). A future tile-provider switch would have silently desynced the two map renderings.

**How it was resolved:** [`mapHelpers.js`](../../frontend/src/mapHelpers.js) now exports `MAP_STYLE_URL`, `DEFAULT_MAP_CENTER`, `DEFAULT_MAP_ZOOM`. `MapView.jsx` and `RouteCard.jsx` both import them; the in-component constants are gone.

---

### 2026-05-04 · Map gesture-enable code duplicated in `MapView.jsx` (2026-05-03 TD-005)

**Files:** `frontend/src/mapHelpers.js`, `frontend/src/MapView.jsx`

**Priority:** 🟢 Low

**What the debt was:** The pickMode `useEffect` and `handleUnlock` both open-coded the same six `.enable()` calls (`scrollZoom`, `dragPan`, `dragRotate`, `doubleClickZoom`, `touchZoomRotate`, `keyboard`). The lock counterpart was already a shared helper.

**How it was resolved:** Added `unlockMapGestures(map)` to `mapHelpers.js` next to the existing `lockMapGestures`. Replaced both inline blocks in `MapView.jsx` with `unlockMapGestures(map)` calls.

---

### 2026-05-04 · `_SERVICE_TYPES` set redefined three times across the backend (2026-05-03 TD-006)

**Files:** `backend/utils.py`, `backend/walking.py`, `backend/fetch_street_graph.py`

**Priority:** 🟡 Medium

**What the debt was:** The set `{"service", "alley"}` was defined as `_SERVICE_HIGHWAY_TYPES` in `walking.py` and re-declared twice (locally) inside `fetch_street_graph.py` as `_SERVICE_TYPES`. Three copies that could drift if accessibility routing ever needed to treat alleys differently.

**How it was resolved:** Added `SERVICE_HIGHWAY_TYPES: frozenset[str]` to [`backend/utils.py`](../../backend/utils.py) as the single source of truth. `walking.py` and `fetch_street_graph.py` both import it; the local definitions are gone.

---

### 2026-05-04 · `_needs_download()` was dead code in `fetch_street_graph.py` (2026-05-03 TD-007)

**Files:** `backend/fetch_street_graph.py`

**Priority:** 🟢 Low

**What the debt was:** `_needs_download()` was defined but never called — its predicate had been inlined into the `__main__` block as `graphml_usable = ...`, leaving two copies of the same check that could drift.

**How it was resolved:** Deleted the unused function. The `__main__` block remains the single decision site for whether the graph needs download or rebuild.

---

### 2026-05-04 · Hardcoded rate-limit values in `main.py` (2026-05-03 TD-008)

**Files:** `backend/main.py`

**Priority:** 🟢 Low

**What the debt was:** Three different rate limits (`60/minute`, `30/minute`, `10/minute`) were embedded as string literals on `@limiter.limit(...)` decorators. No central place to inspect or override them per environment.

**How it was resolved:** Added `RATE_LIMIT_HEALTH`, `RATE_LIMIT_REVERSE_GEOCODE`, `RATE_LIMIT_ROUTE` near the top of `main.py`. Each is seeded from an env var with the previous string as default, so production behavior is unchanged but a deploy can now tune limits via env without a code change.

---

### 2026-05-04 · Magic LRU cache sizes scattered across `walking.py` (2026-05-03 TD-009)

**Files:** `backend/walking.py`

**Priority:** 🟢 Low

**What the debt was:** Three hand-tuned `@lru_cache(maxsize=...)` decorators (`2048`, `1536`, `1536`) sat naked on different functions. The two `1536` values were meant to evict together but nothing enforced that.

**How it was resolved:** Defined `_NEAREST_NODE_CACHE_SIZE = 2048` and `_ROUTE_CACHE_SIZE = 1536` near the top of `walking.py` with a comment noting why the route caches are coupled. Both LRU decorators now reference the constants.

---

### 2026-05-04 · Calorie-equivalent food table embedded mid-file in `App.jsx` (2026-05-03 TD-010)

**Files:** `frontend/src/calorieEquiv.js` (new), `frontend/src/calorieEquiv.test.js` (new), `frontend/src/App.jsx`

**Priority:** 🟢 Low

**What the debt was:** `CALORIE_FOODS` (12 entries with raw calorie counts) and `NICE_FRACS` (10 fractional buckets) were hardcoded data sitting alongside JSX in the App component file, with no source citation and no isolated tests.

**How it was resolved:** Moved both arrays plus `calorieEquivalent()` into [`frontend/src/calorieEquiv.js`](../../frontend/src/calorieEquiv.js) with a header comment noting the calorie figures are USDA / nutrition-label averages. Added [`calorieEquiv.test.js`](../../frontend/src/calorieEquiv.test.js) with 8 focused tests (zero / null / negative inputs, exact and fractional matches, pluralization). `App.jsx` imports and re-exports `calorieEquivalent` so `App.test.jsx` continues to pass unchanged.

---

### 2026-05-04 · No tests for `/reverse-geocode` endpoint (2026-05-03 TD-011)

**Files:** `backend/tests/test_main.py`

**Priority:** 🟡 Medium

**What the debt was:** `GET /reverse-geocode` had bbox validation, rate limiting, and a Google fallback — none of which were exercised by `test_main.py`. A regression that broke the bbox check or response shape would only surface via manual testing.

**How it was resolved:** Added a `TestReverseGeocode` class with five offline-safe tests:
1. In-bounds Wrigleyville coordinates return a `{label, source}` dict with `source ∈ {neighborhood, google, coordinates}`.
2. Logan Square coordinates resolve to `source: "neighborhood"` with `"logan"` in the label (deterministic without Google).
3. Out-of-bounds north (lat > CHICAGO_NORTH) returns 422.
4. Out-of-bounds west (lon < CHICAGO_WEST) returns 422.
5. Missing `lat`/`lon` query params return 422.

---

### 2026-04-28 · No test coverage across the entire backend (TD-001)

**File:** `backend/tests/` (new), `backend/requirements-test.txt` (new)

**Priority:** 🔴 High

**What the debt was:** The entire backend had zero automated test coverage. Core business logic — step calculation, haversine distance, geocoding fallback chain, and the `/route` endpoint — could regress silently.

**How it was resolved:** Created `backend/tests/` with four test modules:
- `test_steps.py` — unit tests for all four functions in `steps.py` (step length formula, steps-from-miles, calories, daily goal %)
- `test_utils.py` — unit tests for `haversine_miles` and the `WALKING_SPEED_MPH` constant
- `test_geocoding.py` — tests for exact match, case-insensitive match, fuzzy match, and API key fallback behaviour
- `test_main.py` — integration tests for `GET /health`, `POST /route` validation (empty input, unknown location, same-location, out-of-range height), and `POST /route` success (step counts, personalization, direction fields, coordinate bounds)

Also added `backend/requirements-test.txt` (`pytest>=8.0,<9.0`, `httpx>=0.27,<1.0`) so test dependencies are separate from production dependencies.

---

### 2026-04-28 · `WALKING_SPEED_MPH` constant duplicated across two modules (TD-002)

**File:** `backend/utils.py`, `backend/walking.py`, `backend/steps.py`

**Priority:** 🟡 Medium

**What the debt was:** `WALKING_SPEED_MPH = 3.0` was defined independently in both `walking.py` and `steps.py`. The definition in `steps.py` was also completely unused within that module.

**How it was resolved:** Moved the single definition to `utils.py` as `WALKING_SPEED_MPH: float = 3.0`. Updated `walking.py` to import it (`from utils import haversine_miles as _haversine_miles, WALKING_SPEED_MPH`) and derived `WALKING_SPEED_MPS` from it rather than from a hardcoded `3.0`. Removed the unused definition from `steps.py`. `main.py` continues to import `WALKING_SPEED_MPH` from `walking` (which re-exports the imported name) — no change needed there.

---

### 2026-04-28 · Silent bare `except` in `_walk_directions_impl` hides routing errors (TD-003)

**File:** `backend/walking.py`

**Priority:** 🟡 Medium

**What the debt was:** The fallback `except` block in `_walk_directions_impl` caught all exceptions silently with no log output. Routing failures fell back to a haversine stub with no observable signal, making production diagnosis very difficult.

**How it was resolved:** Changed `except Exception:` to `except Exception as e:` and added `print(f"[walk_directions] routing error: {type(e).__name__}: {e}")` before the fallback, consistent with the existing pattern in `_walk_path_impl`.

---

### 2026-04-28 · Loose version pins in `requirements.txt` risk unexpected breaking changes (TD-004)

**File:** `backend/requirements.txt`

**Priority:** 🟡 Medium

**What the debt was:** `igraph>=0.11`, `scipy>=1.7`, `shapely>=2.0`, and `osmnx>=1.9` were lower-bounded only. `osmnx` in particular has introduced breaking API changes between minor versions (e.g. the `graph_from_bbox` signature changed in 1.x → 2.x). A fresh install could pull a future major version and silently break graph fetching.

**How it was resolved:** Added upper bounds to all four loose pins: `igraph>=0.11,<0.12`, `scipy>=1.7,<2.0`, `shapely>=2.0,<3.0`, `osmnx>=1.9,<2.0`. The existing exact-pinned packages (`fastapi`, `uvicorn`, `python-dotenv`, `requests`) were left unchanged.

---

### 2026-04-28 · `SpatialGrid` class in `utils.py` is dead code (TD-005)

**File:** `backend/utils.py`

**Priority:** 🟢 Low

**What the debt was:** `SpatialGrid` (a cell-based spatial bucket index) was defined in `utils.py` but imported nowhere. The routing layer uses `scipy.spatial.cKDTree` instead.

**How it was resolved:** Removed the class and its associated `from typing import Any` import entirely from `utils.py`.

---

### 2026-04-28 · `_GOOGLE_API_KEY` module-level variable defined but never used (TD-006)

**File:** `backend/geocoding.py`

**Priority:** 🟢 Low

**What the debt was:** `_GOOGLE_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")` was read at module load but never referenced. Inside `geocode_google`, the key was re-read via a second `os.getenv` call, making the module-level variable dead code.

**How it was resolved:** Replaced the second `os.getenv` call inside `geocode_google` with a reference to `_GOOGLE_API_KEY`. The key is now read once at module load and reused consistently.

---

### 2026-04-28 · `import math` inside `_walk_directions_impl` function body (TD-007)

**File:** `backend/walking.py`

**Priority:** 🟢 Low

**What the debt was:** `import math` was placed inside the body of `_walk_directions_impl` rather than at the top of the module, obscuring the module's dependencies.

**How it was resolved:** Moved `import math` to the top-level imports of `walking.py` and removed it from the function body.

---

### 2026-04-28 · Debug print statement left in `main.py` (TD-008)

**File:** `backend/main.py`

**Priority:** 🟢 Low

**What the debt was:** `print("ALLOWED_ORIGINS:", ALLOWED_ORIGINS)` fired on every server startup, leaking deployment configuration into production logs.

**How it was resolved:** Removed the line entirely.

---

### 2026-04-28 · No test coverage in the frontend (TD-009)

**File:** `frontend/src/App.test.jsx` (new), `frontend/src/test-setup.js` (new), `frontend/vite.config.js`, `frontend/package.json`

**Priority:** 🔴 High

**What the debt was:** No test runner was configured and no test files existed. The form submission flow, height-to-inches conversion, `motivationMessage` thresholds, and `formatBlocks` display logic had zero automated coverage.

**How it was resolved:** Added `vitest` + `@testing-library/react` + `@testing-library/user-event` + `jsdom` as dev dependencies. Configured a `test` block in `vite.config.js` (environment: jsdom, setupFiles: `src/test-setup.js`). Added `npm test` / `npm run test:watch` scripts using the explicit node path (`node ./node_modules/vitest/vitest.mjs`) to work around the space in the project directory. Created `test-setup.js` with `@testing-library/jest-dom` and a full maplibre-gl stub so WebGL errors do not pollute test output. Created `App.test.jsx` with 13 tests covering: `formatBlocks` (4 cases), `motivationMessage` (5 threshold cases), height-to-inches conversion via rendered component (2 cases), and `handleSubmit` error handling (2 cases). Exported `formatBlocks` and `motivationMessage` from `App.jsx` to make them directly testable.

---

### 2026-04-28 · `eslint-disable-line` suppression comments in MapView.jsx (TD-010)

**File:** `frontend/src/MapView.jsx`

**Priority:** 🟡 Medium

**What the debt was:** Both `useEffect` hooks in `MapView.jsx` suppressed the `react-hooks/exhaustive-deps` lint rule with inline `// eslint-disable-line` comments. Future readers could not tell whether the missing deps were intentional or forgotten.

**How it was resolved:** Replaced both suppression comments with explanatory intent comments: `// intentional: map init runs once; style/center/zoom are treated as stable init props` and `// intentional: only re-render route when result changes; mapRef is a stable ref`.

---

### 2026-04-28 · No React ErrorBoundary around the result display block (TD-011)

**File:** `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the debt was:** `StepHero`, `DirectionList`, and `MapView` were rendered with no error boundary. Any thrown render error — e.g. an unexpected API response shape — would unmount the entire app, leaving the user with a blank screen and no recovery path.

**How it was resolved:** Added a minimal `ErrorBoundary` class component to `App.jsx` using `getDerivedStateFromError`. It renders a `"Something went wrong displaying your route — try a new search."` alert in place of the crashed subtree. The result display block is now wrapped in `<ErrorBoundary>`.

---

### 2026-04-28 · Debug `console.log` in App.jsx frontend code (TD-012)

**File:** `frontend/src/App.jsx`

**Priority:** 🟢 Low

**What the debt was:** A `console.log('BACKEND_URL:', BACKEND_URL)` statement (gated on `import.meta.env.DEV`) was left in from environment variable verification.

**How it was resolved:** Removed the statement entirely.

---

### 2026-04-28 · PWA manifest icon combined `"any maskable"` purpose in one entry (TD-013)

**File:** `frontend/vite.config.js`

**Priority:** 🟢 Low

**What the debt was:** The manifest icon entry used `purpose: "any maskable"` combined in one object. The Web App Manifest spec recommends separate entries because maskable icons require a safe zone, and combining purposes causes some platforms to apply that safe zone incorrectly to the `any` display context.

**How it was resolved:** Split into two separate icon entries, each with a single purpose value (`"any"` and `"maskable"`), both pointing to `favicon.svg`. A dedicated maskable asset with built-in padding is a further improvement deferred until icon assets are expanded.

---

### 2026-04-28 · Hardcoded third-party tile URL in MapView.jsx (TD-014)

**File:** `frontend/src/MapView.jsx`, `frontend/.env.production`

**Priority:** 🟢 Low

**What the debt was:** `DEFAULT_STYLE = "https://tiles.openfreemap.org/styles/liberty"` was hardcoded in `MapView.jsx`. Swapping tile providers required a source code change.

**How it was resolved:** Changed `DEFAULT_STYLE` to read from `import.meta.env.VITE_MAP_STYLE_URL` with the OpenFreeMap URL as the `??` fallback. Added `VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty` to `frontend/.env.production` with a comment so operators can swap providers via environment configuration.

---

## Efficiency Improvements Implemented

### 2026-05-05 · `readUrlParams()` parsed `window.location.search` four times on mount (OPT-008)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `readUrlParams()` was invoked four separate times during `App`'s initial render — once each in the `stops`, `heightFt`, and `heightIn` `useState` initializers, and again inside the auto-fetch `useEffect`. Each call constructed a fresh `URLSearchParams`, re-ran `parseStopsParam`, and re-validated `hft`/`hin`.

**Implemented:** Captured the parsed params once via a `useRef` (`initialUrlParamsRef`) populated lazily on first render. The three `useState` initializers and the auto-fetch effect now read from the cached object. One parse instead of four.

---

### 2026-05-05 · `loadAccessPrefs()` ran twice on mount (OPT-009)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** Two separate `useState` initializers (`avoidStairs`, `preferPedestrian`) each called `loadAccessPrefs()`, performing two `localStorage.getItem` reads + two `JSON.parse` calls for what is fundamentally one stored object.

**Implemented:** Cached the parsed prefs in a `useRef` (`initialAccessRef`) on first render and used the same object to seed both `useState`s. One read + one parse per cold load.

---

### 2026-05-05 · Map sources/layers torn down and rebuilt on every route swap (OPT-010)

**Files:** [frontend/src/mapHelpers.js](frontend/src/mapHelpers.js), [frontend/src/MapView.jsx](frontend/src/MapView.jsx)

**Impact:** 🟡 Medium

**Category:** Rendering / Inefficient Data Structure

**What was inefficient:** Each route render in `MapView` ran `clearLayers(...)` then `renderWalkRoute(...)`, removing every source (`walk-path`, `walk-turns`, `walk-stops`, `walk-origin`, `walk-dest`) and re-adding it. MapLibre re-uploaded GPU buffers on every flavor swap. Endpoint markers were similarly torn down and re-mounted (full `createRoot` per `WFFromMark`/`WFToMark`) on each swap.

**Implemented:**
- Added `upsertGeoSource`, `ensureLayer`, and `dropTracked` helpers in `mapHelpers.js`. `renderWalkRoute` now detects existing sources via `map.getSource(...)` and calls `setData` instead of `addSource` when present, and only adds layers when not already present (`map.getLayer`). Sources whose category disappears between renders (e.g. `walk-stops` going from multi-stop to 2-stop) are explicitly removed via `dropTracked`.
- `MapView.render` no longer calls `clearLayers`. Endpoint markers are stored as `{from, to}` slots and repositioned in place via `marker.setLngLat`; they're only created on first appearance.
- Marker disposal moved to a dedicated unmount-only effect so React roots are released exactly once when the component unmounts, rather than on every render cleanup.

---

### 2026-05-05 · `WPIcon` shipped three never-used icons (OPT-011)

**File:** [frontend/src/wayfarer/walkpath-icons.jsx](frontend/src/wayfarer/walkpath-icons.jsx)

**Impact:** 🟢 Low

**Category:** Bundle Size

**What was inefficient:** `WPIcon` shipped 17 inline SVG bodies as branches of one `switch`, three of which (`purse`, `leaf`, `chicago-grid`) had no callsites in the project. Tree-shaking can't help across switch branches, so every page bundle paid for them.

**Implemented:** Removed the unused `purse`, `leaf`, and `chicago-grid` cases from the switch and from the exported `WP_ICON_NAMES` list. The full named-export refactor for further code-splitting was deferred — most remaining icons (14 of 14) are used somewhere, so the additional churn risk outweighs the marginal bundle savings.

---

### 2026-05-05 · `ShareDispatch` imported helpers from `App.jsx` (OPT-012)

**Files:** [frontend/src/components/ShareDispatch.jsx](frontend/src/components/ShareDispatch.jsx), [frontend/src/lib/routeFormat.js](frontend/src/lib/routeFormat.js) (new), [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Unnecessary Import

**What was inefficient:** `ShareDispatch` imported `safePaceLabel` and `motivationMessage` from `App.jsx`, dragging the entire App module — including its `BACKEND_URL = resolveBackendUrl()` top-level side effect — into any path that loaded the share card. This blocked future code-splitting that could lazy-load the share modal.

**Implemented:** Created `frontend/src/lib/routeFormat.js` containing `PACE_LABELS`, `safePaceLabel`, `motivationMessage`, and `formatDirectionsText`. Both `App.jsx` and `ShareDispatch.jsx` now import from there. `App.jsx` re-exports the symbols so `App.test.jsx`'s existing imports keep working.

---

### 2026-04-28 · Array literals allocated on every render in `HeightInput` (OPT-001)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `[4, 5, 6, 7]` and `Array.from({ length: 12 }, ...)` were defined inline inside the `HeightInput` component body, allocating new array objects on every render — including every keystroke in the origin/destination inputs.

**Implemented:** Hoisted both to module-level constants `FT_OPTIONS` and `IN_OPTIONS` outside the component. JSX maps over these stable references; the inline `Array.from` in the inches `<select>` was replaced with `IN_OPTIONS.map(...)`.

---

### 2026-04-28 · `handleHeightChange` recreated on every `App` render (OPT-002)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Rendering

**What was inefficient:** `handleHeightChange` was defined as a plain inline function inside `App`, producing a new function reference on every render and preventing React from bailing out of `HeightInput` re-renders even when height state hadn't changed.

**Implemented:** Wrapped in `useCallback` with `[]` deps. `HeightInput` is also wrapped in `React.memo`. Both changes are required together — `useCallback` alone does nothing without `memo` on the receiving component.

---

### 2026-04-28 · Dual traversal of path coordinates in `MapView` (OPT-003)

**File:** [frontend/src/MapView.jsx](frontend/src/MapView.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `renderWalkRoute` called `path.map(toGeo)` to build `geoPath`, then immediately ran a second `geoPath.reduce(...)` to compute bounding box extents — walking the path array twice.

**Implemented:** Combined into a single `reduce` that accumulates both the converted coordinate array and the min/max bounds in one pass.

---

### 2026-04-28 · Debug `console.log` shipped in production bundle (OPT-004)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Unnecessary Asset Size / Other

**What was inefficient:** `console.log('BACKEND_URL:', BACKEND_URL)` ran on every page load in production, leaking deployment configuration into browser DevTools.

**Implemented:** Guarded with `if (import.meta.env.DEV)`. Vite's production build sets `import.meta.env.DEV` to `false` and tree-shakes the branch entirely, so the log statement is absent from the production bundle.

---

### 2026-04-28 · Concurrent Dijkstra cache stampede + three uncoordinated lru_caches (OPT-005 + OPT-006)

**Files:** `backend/walking.py`, `backend/main.py`

**Impact:** 🔴 High / 🟡 Medium

**Category:** Redundant Computation · Memory Footprint

**What was inefficient:** `walk_path`, `walk_directions`, and `walk_minutes` each had their own `@lru_cache(maxsize=512)`. `main.py` dispatched all three concurrently via `asyncio.gather`. Because Python's `lru_cache` only holds its internal lock while updating the dict — not while the wrapped function runs — all three threads could simultaneously see a cache miss on a new origin/destination pair and each run a full Dijkstra computation (3× the work). Additionally, the three independent caches meant up to 1,536 cached route results in memory simultaneously with no coordinated eviction — an LRU eviction of one cache left the corresponding entries in the other two caches stranded.

**Implemented:** Introduced `_compute_route(origin_lat, origin_lon, dest_lat, dest_lon)` in `walking.py` with a single `@lru_cache(maxsize=512)`, returning `(path_coords_tuple, directions_tuple, minutes_float)`. The three private build helpers (`_build_path`, `_build_directions`, `_build_minutes`) are non-cached and called exactly once per cache miss inside `_compute_route`. `walk_path`, `walk_directions`, and `walk_minutes` are now thin wrappers that index into the cached tuple. `main.py` was updated to call `_compute_route` directly in a single `run_in_executor` call, eliminating the concurrent three-way dispatch entirely. Peak cache memory dropped from ~3 × 512 entries to 512 entries, and Dijkstra now runs at most once per unique route per process lifetime.

---

### 2026-04-28 · `GOOGLE_MAPS_API_KEY` re-read from `os.getenv` on every geocode miss (OPT-007)

**File:** `backend/geocoding.py`

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `geocode_google` called `os.getenv("GOOGLE_MAPS_API_KEY", "")` inside the mutex-protected block on every cache miss, despite the same value being read at module load time into `_GOOGLE_API_KEY`. The module-level constant was never referenced inside the function.

**Implemented:** The linter had already applied this fix before implementation — `geocode_google` now uses `_GOOGLE_API_KEY` throughout (both the availability check and the params dict). No further change needed.

---

### 2026-04-28 · Full geocode cache serialized to disk on every new geocode hit (OPT-008)

**File:** `backend/geocoding.py`

**Impact:** 🟢 Low

**Category:** Inefficient I/O

**What was inefficient:** Every successful Google geocode result (and every `ZERO_RESULTS` response) triggered `_save_geocode_cache(_geocode_cache)`, which serialized the entire cache dict, wrote it to a temp file, and replaced the on-disk file. As the cache grew, this O(n) write fired on every new entry.

**Implemented:** Added `_geocode_unsaved` counter and `_GEOCODE_SAVE_EVERY = 5` threshold. `_flush_geocode_if_needed()` increments the counter and only calls `_save_geocode_cache` when the threshold is reached, then resets the counter. An `atexit` handler (`_flush_geocode_on_exit`) flushes any remaining unsaved entries on graceful shutdown. At most 4 entries can be lost on an ungraceful crash, which is an acceptable trade-off for a stable geocode cache.

---

### 2026-05-03 · `loadAccessPrefs()` runs every render (localStorage + JSON.parse) (OPT-009)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🔴 High

**Category:** Redundant Computation

**What was inefficient:** `const initialPrefs = loadAccessPrefs();` was called at the top of the `App()` function body on every render. The function does `localStorage.getItem("walkpath:accessPrefs")` + `JSON.parse` synchronously. The two `useState` calls only consumed the result on first render, so every subsequent render paid the localStorage + JSON.parse cost for nothing — including every keystroke in the form inputs. Sibling preferences (`loadDailyGoal`, `loadStoredPace`) were already using the lazy `useState(() => ...)` pattern; `loadAccessPrefs` had been missed.

**Implemented:** Replaced the two `useState(initialPrefs.X)` calls with lazy initializers: `useState(() => loadAccessPrefs().avoidStairs)` and `useState(() => loadAccessPrefs().preferPedestrian)`. Removed the per-render `const initialPrefs` line. Localstorage and JSON.parse now run only on mount.

---

### 2026-05-03 · `renderWalkRoute` reduce allocates a new object + 2 nested arrays per path point (OPT-010)

**File:** [frontend/src/mapHelpers.js](frontend/src/mapHelpers.js)

**Impact:** 🔴 High

**Category:** Redundant Computation / Memory Bloat

**What was inefficient:** The `path.reduce(...)` returned a fresh `{ geoPath, bounds: [[...], [...]] }` literal on every iteration — one object plus two array literals per path point. Long Chicago routes routinely have hundreds of polyline points, so a ~500-point path generated ~500 wasted object allocations and ~1000 wasted array allocations per route render, plus the GC pressure that follows. `geoPath` was already mutably pushed; only the bounds tuple needed accumulator semantics.

**Implemented:** Replaced the reduce with a plain `for` loop that pushes onto a single `geoPath` array and updates four scalar locals (`minLon`, `minLat`, `maxLon`, `maxLat`). The bounds tuple is constructed once at the end of the loop. No per-iteration allocation; same end state.

---

### 2026-05-03 · MapView draw-in animation rebuilds the coords array on every frame (OPT-011)

**File:** [frontend/src/MapView.jsx](frontend/src/MapView.jsx)

**Impact:** 🔴 High

**Category:** Memory Bloat / Rendering

**What was inefficient:** `setProgress` ran at ~60 fps for up to 8 seconds (`ANIM_MAX_DURATION_MS`). On each frame it allocated a fresh `coords` array and walked `fullPath[0..i]` calling `toGeo(...)` — which itself allocates a 2-element array per call. For a 500-point path animating for 4 seconds at 60 fps, that's ~240 frames × ~500 `toGeo` allocations ≈ 120,000 short-lived arrays per route render, all during the most visually sensitive moment of the UX.

**Implemented:** Pre-converted `fullPath` to its `[lon, lat]` form once (`const geoFullPath = fullPath.map(toGeo);`) before the animation loop starts. Each frame now uses `geoFullPath.slice(0, i)` plus the interpolated tip, eliminating the inner `toGeo` allocations entirely. The final-state restore was also updated to reuse `geoFullPath` instead of calling `fullPath.map(toGeo)` again.

---

### 2026-05-03 · `fuzzy_match_neighborhood` rebuilds SequenceMatcher's `b2j` index per candidate (OPT-012)

**File:** [backend/geocoding.py](backend/geocoding.py)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** The fuzzy-match loop created `SequenceMatcher(None, query, key)` for every candidate key. `SequenceMatcher` builds an internal `b2j` index on its second-argument string the first time `.ratio()` runs; constructing a fresh matcher per candidate forced that index to be rebuilt every iteration. With ~330 neighborhood keys and (after the inverted-word-index pre-filter) often dozens of candidates, this added measurable per-request CPU cost on any query that missed the exact-match path.

**Implemented:** Construct `matcher = SequenceMatcher(None, "", query)` once outside the loop, with the constant query held in `seq2`. Inside the loop, call `matcher.set_seq1(key)` then `matcher.ratio()`. `set_seq1` is cheap and does not rebuild `b2j`; the index for the constant query is built once and reused across all candidates.

---

### 2026-05-03 · Geocode cache disk format wastes space and rewrites too aggressively (OPT-013)

**File:** [backend/geocoding.py](backend/geocoding.py)

**Impact:** 🟡 Medium

**Category:** Inefficient I/O Pattern

**What was inefficient:** `_save_geocode_cache` re-serialised the entire cache with `indent=2` (roughly doubling on-disk size for what is a machine-only cache) and the flush threshold was `_GEOCODE_SAVE_EVERY = 5`, so a busy week of new lookups triggered a full cache rewrite every 5 entries. As the cache grows, each rewrite is O(N) — hundreds of KB of JSON serialised, written to a temp file, and renamed.

**Implemented:** Removed `indent=2` and added `separators=(",", ":")` so the on-disk format is compact (smaller writes, faster serialisation). Bumped `_GEOCODE_SAVE_EVERY` from 5 to 50 — the existing `atexit` flush ensures unsaved entries are persisted on clean shutdown, so the only risk is losing up to 49 entries on a crash, which is acceptable for a regenerable cache.

---

### 2026-05-03 · `_load_graph` builds vertex coord arrays via per-vertex attribute access (OPT-014)

**File:** [backend/walking.py](backend/walking.py)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** `lons = np.array([v["x"] for v in G.vs], dtype=np.float64)` iterated ~50k vertices and performed a per-vertex attribute lookup. igraph exposes `G.vs["x"]` as a single bulk attribute fetch returning a list — substantially faster than the comprehension. This runs at server startup and added avoidable wall-clock time to lifespan boot, delaying the first request after a cold deploy on Railway.

**Implemented:** Replaced both lines with `np.asarray(G.vs["x"], dtype=np.float64)` and `np.asarray(G.vs["y"], dtype=np.float64)`. Single bulk fetch per axis, identical end state.

---

### 2026-05-03 · `_build_minutes` re-iterates the epath to sum lengths already summed by `_build_directions` (OPT-015)

**File:** [backend/walking.py](backend/walking.py)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** Inside `_compute_route_quantized`, the three builders ran in sequence (`_build_path` → `_build_directions` → `_build_minutes`). Both `_build_directions` and `_build_minutes` iterated the full epath summing `e["length"]`, so every cache miss did the per-edge attribute lookup twice — for a 200-edge route, ~200 redundant igraph index calls per miss.

**Implemented:** Restructured `_compute_route_quantized` to derive total minutes from the per-step `distance_meters` already produced by `_build_directions` (`total_meters = sum(d["distance_meters"] for d in directions)` then `round(total_meters / WALKING_SPEED_MPS / 60, 1)`). `_build_minutes` is only called as a fallback when directions are empty (degenerate path). Eliminates the second epath traversal on every cache miss.

---

### 2026-05-03 · `_build_path` reverses geometry coords with full slice copy (OPT-016)

**File:** [backend/walking.py](backend/walking.py)

**Impact:** 🟢 Low

**Category:** Memory Bloat

**What was inefficient:** When edge geometry was oriented opposite the traversal direction, `geom_coords = geom_coords[::-1]` allocated a fresh list of every coord pair. Long curved streets (Milwaukee Ave, lakefront paths) can have 50+ points per edge; the reversal copied them all when iteration order was the only thing that mattered.

**Implemented:** Replaced the slice-copy with a `range` that walks the geometry list forward or backward in-place (`range(n - 1, -1, -1)` for reverse, with a `skip_first` adjustment to preserve the existing seam-dedup logic). No copy is allocated; the inner loop reads `geom_coords[j][0/1]` directly.

---

### 2026-05-03 · `list(await asyncio.gather(...))` wraps an already-list result (OPT-017)

**File:** [backend/main.py](backend/main.py)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `legs_raw = list(await asyncio.gather(*[...]))` wrapped `gather`'s already-returned list in another `list(...)` call, allocating and copying a second list with the same contents.

**Implemented:** Removed the redundant `list(...)` wrap. `legs_raw` now binds directly to the gather result.
