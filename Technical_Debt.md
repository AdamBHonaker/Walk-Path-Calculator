# Technical Debt

Known technical debt catalogued for future resolution. Priority: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an item in this file is resolved, **delete its entry from this file** and add a corresponding entry to the **Technical Debt Paid Off** section of [`RESOLVED_HISTORY.md`](RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain debt that has not yet been addressed.

---

## Tech Debt Scan — 2026-04-28 (backend/)

> Scanned: `backend/main.py`, `backend/walking.py`, `backend/geocoding.py`, `backend/steps.py`, `backend/utils.py`, `backend/fetch_street_graph.py`, `backend/requirements.txt`
> Found: 8 item(s)

---

### TD-001 · No test coverage across the entire backend
- **File**: `backend/`
- **Line(s)**: N/A
- **Category**: Missing Tests
- **Priority**: High
- **Description**: There is not a single test file in the backend. The core business logic — routing, step calculation, calorie estimation, geocoding fallback chain — has zero automated test coverage. A regression in any of these paths would only be caught in production.
- **Suggested Improvement**: Add a `backend/tests/` directory with at minimum: unit tests for `steps.py` (formulas), `utils.py` (haversine), and `geocoding.py` (exact/fuzzy/fallback chain); and integration tests for the `POST /route` endpoint using `httpx` + FastAPI's `TestClient`.

---

### TD-002 · `WALKING_SPEED_MPH` constant duplicated across two modules
- **File**: `backend/walking.py`, `backend/steps.py`
- **Line(s)**: `walking.py:26`, `steps.py:15`
- **Category**: Duplicated Code
- **Priority**: Medium
- **Description**: `WALKING_SPEED_MPH = 3.0` is defined independently in both `walking.py` and `steps.py`. If the speed is ever changed, both files must be updated in sync. `steps.py` defines `WALKING_SPEED_MPH` but never actually uses it in its own calculations, suggesting it was copied.
- **Suggested Improvement**: Define the constant once in `utils.py` (or a dedicated `constants.py`) and import it in both modules. Remove the unused definition in `steps.py`.

---

### TD-003 · Silent bare `except` in walk_directions fallback hides routing errors
- **File**: `backend/walking.py`
- **Line(s)**: 284, 353
- **Category**: Overly Complex Logic
- **Priority**: Medium
- **Description**: Both `_walk_directions_impl` and `_walk_path_impl` catch all exceptions silently and return a stub fallback result without logging the error type or message. This makes it very difficult to diagnose routing failures in production — the caller gets a degraded result with no observable signal.
- **Suggested Improvement**: At minimum, log the exception with `print(f"[walk_directions] routing error: {type(e).__name__}: {e}")` before falling back, consistent with the existing pattern in `_walk_path_impl` (line 354) which does log. The directions fallback does not.

---

### TD-004 · Loose version pins in requirements.txt risk unexpected breaking changes
- **File**: `backend/requirements.txt`
- **Line(s)**: 3–7
- **Category**: Outdated Dependency
- **Priority**: Medium
- **Description**: `igraph>=0.11`, `scipy>=1.7`, `shapely>=2.0`, and `osmnx>=1.9` are all lower-bounded only. `osmnx` in particular has introduced breaking API changes between minor versions (e.g. `graph_from_bbox` signature changed in 1.x → 2.x). A fresh install today could pull a future major version and silently break `fetch_street_graph.py`.
- **Suggested Improvement**: Pin all dependencies to a known-working range (e.g. `igraph>=0.11,<1.0` or an exact `==` pin). Run `pip freeze` in the working environment and pin at least the packages with known breaking-change history (`igraph`, `osmnx`).

---

### TD-005 · `SpatialGrid` class in utils.py is dead code
- **File**: `backend/utils.py`
- **Line(s)**: 24–63
- **Category**: Duplicated Code / TODO-FIXME
- **Priority**: Low
- **Description**: `SpatialGrid` is defined in `utils.py` but is not imported or used anywhere in the backend. The routing layer uses `scipy.spatial.cKDTree` instead. The class is well-written but currently dead weight.
- **Suggested Improvement**: If there is no planned use for `SpatialGrid`, remove it. If it is reserved for future expansion (e.g. city picker), add a comment explaining the intent.

---

### TD-006 · `_GOOGLE_API_KEY` module-level variable is defined but never used
- **File**: `backend/geocoding.py`
- **Line(s)**: 25, 396
- **Category**: Duplicated Code
- **Priority**: Low
- **Description**: `_GOOGLE_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")` is read at module load (line 25) but never referenced. Inside `geocode_google`, the key is re-read via `os.getenv("GOOGLE_MAPS_API_KEY", "")` (line 396). The module-level variable is dead code.
- **Suggested Improvement**: Remove the module-level `_GOOGLE_API_KEY` and use it in `geocode_google` instead of calling `os.getenv` again, so the key is read once at startup.

---

### TD-007 · `import math` inside `_walk_directions_impl` function body
- **File**: `backend/walking.py`
- **Line(s)**: 214
- **Category**: Overly Complex Logic
- **Priority**: Low
- **Description**: `import math` is placed inside the function body of `_walk_directions_impl`. Python caches module imports, so this is not a correctness issue, but it is an unconventional pattern that obscures the module's dependencies and makes the import list at the top of the file misleading.
- **Suggested Improvement**: Move `import math` to the top of `walking.py` with the other imports.

---

### TD-008 · Debug print statement left in main.py
- **File**: `backend/main.py`
- **Line(s)**: 36
- **Category**: TODO-FIXME
- **Priority**: Low
- **Description**: `print("ALLOWED_ORIGINS:", ALLOWED_ORIGINS)` fires on every server startup and will appear in production logs. It was likely added to confirm CORS origins were loading correctly but was never removed.
- **Suggested Improvement**: Remove the print statement or replace it with a proper `logging.debug(...)` call if startup diagnostics are genuinely needed.

---

## Tech Debt Scan — 2026-04-28 (frontend/)

*(All 6 items from this scan resolved on 2026-04-28. See [RESOLVED_HISTORY.md](RESOLVED_HISTORY.md).)*
