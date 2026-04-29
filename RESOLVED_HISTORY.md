# Resolved History

A unified log of all resolved issues across three categories. New entries are appended here when work is completed:
- **Bugs** — moved here from an active bug-tracking file when fixed.
- **Technical Debt** — moved here from [`Technical_Debt.md`](Technical_Debt.md) when the debt is paid off.
- **Efficiency Improvements** — moved here from [`Efficiency_Improvements.md`](Efficiency_Improvements.md) when implemented.

Priority / Impact: 🔴 High · 🟡 Medium · 🟢 Low.

---

## Resolved Bugs

*(No resolved bugs yet.)*

---

## Technical Debt Paid Off

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
