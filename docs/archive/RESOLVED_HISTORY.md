# Resolved History

A unified log of all resolved issues across four categories. New entries are appended here when work is completed:
- **Bugs** — moved here from an active bug-tracking file when fixed.
- **Technical Debt** — moved here from [`Technical_Debt.md`](Technical_Debt.md) when the debt is paid off.
- **Efficiency Improvements** — moved here from [`Efficiency_Improvements.md`](Efficiency_Improvements.md) when implemented.
- **Security Issues** — moved here from [`SECURITY.md`](../SECURITY.md) when remediated.

Priority / Impact: 🔴 High · 🟡 Medium · 🟢 Low.

---

## Security Issues Resolved

### 2026-05-13 · Pickle deserialization of the pedestrian street graph (SEC-001)

**Files:** `backend/walking.py`, `backend/.env.example`

**Severity:** 🟡 Medium · **OWASP:** A08 — Software & Data Integrity Failures

**What the issue was:** `_load_graph()` called `pickle.load()` on `street_graph_igraph.pkl` unconditionally. Python's pickle format can execute arbitrary code on load via `__reduce__` / `__setstate__`, so anything that could replace the file (compromised GitHub release artifact, write-mounted filesystem under `backend/`, a future feature that writes there) gained RCE in the FastAPI worker — including read access to `LOCATIONIQ_API_KEY` and `CHICAGO_DATA_PORTAL_API_KEY_*` from the process environment.

**How it was resolved:** Added an optional SHA-256 integrity check that runs before `pickle.load`. When the `STREET_GRAPH_SHA256` env var is set, [`walking.py`](../../backend/walking.py) hashes the pickle file with `_sha256_of_file()` and compares against the expected digest; a mismatch logs an error and fails closed (no fallback to graphml, so an attacker who replaces the pickle cannot induce a downgrade). When the var is unset, the backend logs a one-time warning and loads without verification — preserving backward compatibility for existing deploys while nudging operators to enable the check. The `STREET_GRAPH_SHA256` slot was added to [`backend/.env.example`](../../backend/.env.example) with the `shasum`/`Get-FileHash` invocation. **Full operator runbook** — when to rotate the hash, where to set it (local `.env` + Railway service variables), what to look for in startup logs, and the emergency-bypass procedure — lives in [`CLAUDE.md`](../../CLAUDE.md) under "Pickle integrity check (SEC-001)" inside the Greenest-routing graph release runbook section. **Rotation cadence:** the hash must be rotated every time `fetch_street_graph.py` rebuilds the `.pkl` (yearly heatmap refresh, any OSM refresh, any FEAT-4 formula change); step 2 of the runbook's Deploy checklist enforces this so Railway never boots into the "Refusing to load" branch. Long-term, migrating the v3 artifact away from pickle (GraphML + `.npz` sidecar) would close the surface entirely; the hash check is the immediate mitigation.

---

### 2026-05-13 · No rate limiting on routing / explore / autocomplete endpoints (SEC-002)

**Files:** `backend/main.py`, `backend/requirements.txt`

**Severity:** 🟡 Medium · **OWASP:** A04 — Insecure Design

**What the issue was:** None of `/route`, `/explore`, `/autocomplete`, or `/reverse-geocode` had per-IP throttling. Three concrete abuses followed: CPU saturation on `/explore` (each call ran a full-graph bounded Dijkstra over ~50–80k vertices, and the `@lru_cache(maxsize=32)` was easy to evict with varied `max_minutes`); CPU saturation on `/route` (up to 7 leg-Dijkstras per 8-stop request, cache busted by sub-1e-5° lat/lon jitter); and LocationIQ quota drain via `/autocomplete` and `/route` falling through to the hosted fallback. The 429 circuit breaker only mitigated quota exhaustion after the fact, and degraded service for legitimate users during cool-off.

**How it was resolved:** Added `slowapi>=0.1.9` to [`requirements.txt`](../../backend/requirements.txt) and wired a `Limiter(key_func=get_remote_address)` into [`main.py`](../../backend/main.py). The `RateLimitExceeded` handler is registered on the app so callers receive a 429 with a Retry-After hint. Per-endpoint limits, tuned to each operation's cost: `/explore` 10/minute, `/route` 30/minute, `/autocomplete` 60/minute (typeahead is bursty), `/reverse-geocode` 60/minute. The keying is by connection peer, so production deploys behind a trusted proxy (Railway, Cloudflare) should retain L7 rate limiting at the edge as defense-in-depth — direct exposure during dev-tunnel sessions still gets reasonable protection in-app.

---

### 2026-05-13 · Resolved user coordinates logged unredacted alongside hashed query (SEC-003)

**Files:** `backend/geocoding.py`

**Severity:** 🟢 Low · **OWASP:** A09 — Security Logging & Monitoring Failures

**What the issue was:** `_redact()` correctly hashed user-supplied query strings before logging (`q#<sha256-prefix>`), but the resolved or candidate coordinates were then logged at full 5-decimal precision in the same line — defeating the redaction for the exact PII the helper existed to protect. Free-text geocoder queries commonly resolve to user homes / workplaces, so a reader of backend logs could extract a user's home location correlated to their session activity. Three sites were affected: `LocationIQ geocoded q#... -> (41.92480, -87.70120)` on success, the matching out-of-bbox warning, and `cached_reverse write failed for (41.92480, -87.70120): ...` on reverse-cache failures. A fourth call (`LocationIQ reverse failed for (lat, lon): ...`) had the same shape.

**How it was resolved:** Added a `_redact_coord(lat, lon)` helper in [`geocoding.py`](../../backend/geocoding.py) alongside `_redact()` that quantizes coordinates to 2 decimal places (~1.1 km at Chicago latitude) before formatting. All four log call sites were updated to use it. Preserves the diagnostic value (is it in Chicago? lakefront vs. west side?) without pinning the user to an address.

---

### 2026-05-13 · CORS `allow_origin_regex` read from unvalidated env var (SEC-004)

**Files:** `backend/main.py`, `backend/.env.example`, `scripts/dev-tunnel.mjs`

**Severity:** 🟢 Low · **OWASP:** A05 — Security Misconfiguration

**What the issue was:** `DEV_TUNNEL_ORIGIN_REGEX` was passed verbatim to `CORSMiddleware(allow_origin_regex=...)` with no validation. The dev-tunnel script set it correctly (anchored, narrow), but nothing stopped a misconfigured production deploy from shipping with `.*`, an unanchored pattern like `https://my-app\.com` (which matches `https://my-app.com.evil.tld`), or just a stray dev `.env` copied into a prod environment. Combined with SEC-002 (no rate limits), a malicious cross-origin page could weaponize visitors' browsers to drain LocationIQ quota or saturate `/explore`. The `.env.example` warning was the only control.

**How it was resolved:** Added a two-layer guard in [`main.py`](../../backend/main.py): (1) the regex is only honored when `APP_ENV` is one of `{"dev", "development", "local"}` — any other value (including unset) makes the backend log an error and discard the regex; (2) the regex must start with `^` and end with `$` or it is refused with a log error. [`scripts/dev-tunnel.mjs`](../../scripts/dev-tunnel.mjs) now sets `APP_ENV=development` in the spawned uvicorn's environment so the dev flow continues to work without manual config. [`.env.example`](../../backend/.env.example) was updated to document both env vars and the dev-only constraint.

---

## Resolved Bugs

### 2026-05-22 · Shareable link carrying `hft` without a valid `hin` deleted the visitor's saved height-inches (BUG-001, fourth scan)

**Files:** `frontend/src/hooks/usePersonalization.js`, `frontend/src/hooks/useRouteFetch.js`, `frontend/src/hooks/useShareCard.js`, `frontend/src/hooks/usePersonalization.test.jsx` (new)

**Priority:** 🟡 Medium

**What the bug was:** `usePersonalization` initialized `heightFt` and `heightIn` from the incoming URL asymmetrically. `heightFt` fell back to the stored value when the URL omitted it; `heightIn` did not — when the URL carried `hft` at all, the `heightIn` initializer returned `initialUrlParams.hin` verbatim, which is `null` whenever the URL omits `hin` or carries an out-of-range one (`urlParams.js` nulls any `hin` outside `0–11`). A mount-time effect then persisted that `null` via `saveStoredHeightIn(null)` → `safeRemove`, **deleting the visitor's `walkpath:heightIn` localStorage key**. This was reachable in normal use, not just hand-edited URLs: both URL writers (`useRouteFetch`, `useShareCard`) emitted `hft` and `hin` under independent guards, so any sharer whose inches field was blank produced a `?hft=…` link with no `hin`. A recipient with their own saved height opened that link and lost their stored inches.

**How it was resolved:** Made the `hft`/`hin` pair atomic — both-or-neither — the correct realization of "replace" share semantics. The reader (`usePersonalization`) now adopts the URL height only when *both* params are present (`urlHasHeight`); otherwise it falls back to the stored value for *both* `heightFt` and `heightIn`, so a lone or invalid param can no longer initialize `heightIn` to `null` and the mount effect re-saves the loaded stored value instead of removing it. Both writers (`useRouteFetch`, `useShareCard`) now emit `hft` and `hin` together, guarded on *both* being non-null — the same condition `useRouteFetch` already uses to decide whether to send `height_inches`. A fully-personalized sender's link therefore carries the complete pair and the recipient sees identical step counts (true replace); a partially-set sender writes no height params, so the recipient keeps their own saved height and no `localStorage` is mutated. The BUGS.md-suggested `hin ?? 0` reader fix was rejected during implementation: it would have made a `?hft=6` recipient route at 72 in while the sender — who left inches blank — was un-personalized at the 30 in default, *introducing* a sender/recipient mismatch. New `usePersonalization.test.jsx` pins the behavior (lone `hft`, out-of-range `hin`, complete pair, no params).

---

### 2026-05-22 · Tree-canopy cell-size fallback constant was 50 m but the shipped grid is 100 m (BUG-003, fourth scan)

**Files:** `backend/tree_canopy.py`, `backend/fetch_street_graph.py`

**Priority:** 🟢 Low

**What the bug was:** The tree-canopy artifact `tree_canopy_kde.json` is a 100 m grid (`metadata.cell_size_m == 100`), but both runtime consumers defaulted to 50 m when the metadata key was absent — `tree_canopy.py`'s `_DEFAULT_CELL_SIZE_M = 50.0` and `fetch_street_graph.py`'s `_bake_green_signals` `... or 50.0`. The `tree_canopy.py` comment also still described a "50 m cell footprint." Harmless while the shipped artifact carries the metadata, but a metadata-less or legacy artifact would render every heatmap cell as a quarter-area square (gappy heatmap) and mis-classify edge midpoints during the greenest-routing bake.

**How it was resolved:** Changed both fallback constants from `50.0` to `100.0` so the fallback matches the only grid the project ships, and corrected the `tree_canopy.py` comment to "100 m cell footprint" with a pointer to the TD-033 50 m → 100 m NLCD migration. Code-only; the shipped artifact's behavior is unchanged (metadata always present). `test_tree_canopy.py` / `test_fetch_bake.py` still green.

---

### 2026-05-22 · Greenest edge-weight discount did not sanitize non-finite canopy/park scores (BUG-004, fourth scan)

**Files:** `backend/walking.py`, `backend/fetch_street_graph.py`, `backend/tests/test_walking_greenest.py`

**Priority:** 🟢 Low

**What the bug was:** The greenest flavor's per-edge weight is `lengths * discount`. A `NaN`/`inf` baked `edge_tree_canopy_f32` / `edge_park_proximity_f32` value made `discount` become `NaN` (`np.maximum` propagates `NaN`), giving the edge a `NaN` weight. A `NaN` weight silently corrupts the shortest-path priority queue — `NaN` comparisons are always false, so the queue mis-orders. Neither the v3-pickle guard (presence/length only) nor the bake's `isinstance(..., float)` cell filter nor `np.clip` stripped non-finite values. No occurrence in the shipped pickle — a latent robustness gap.

**How it was resolved:** Defense in depth at both ends. Source: `_bake_green_signals`'s `valid_cells` comprehension now also requires `_math.isfinite(float(c["density"]))`, so a bad value never gets baked. Consumption: the greenest branch in `_build_flavor_weights` now calls `np.nan_to_num(discount, copy=False, nan=1.0, posinf=1.0, neginf=_GREEN_DETOUR_FLOOR)` after the detour-floor `np.maximum`, so a corrupt column degrades an edge to a length-only weight rather than a `NaN` that breaks the search. New `TestGreenestNonFiniteSanitization` in `test_walking_greenest.py` injects `NaN` and `inf` into synthetic canopy/park columns and asserts the greenest weight vector stays finite (corrupt edges → length-only weight, the `inf` edge → floored).

---

### 2026-05-22 · Reverse-geocode neighborhood KDTree ranked candidates in raw degree space (BUG-005, fourth scan)

**Files:** `backend/geocoding.py`, `backend/tests/test_geocoding.py`

**Priority:** 🟢 Low

**What the bug was:** `_get_neighborhood_kdtree()` built a `cKDTree` over neighborhood centroids in raw `[lon, lat]` degrees. `reverse_geocode_point` queried it for the `k=5` nearest centroids, then re-ranked just those 5 by true `haversine_miles`. Because one degree of longitude is shorter than one of latitude (≈0.745× at Chicago's latitude), the KDTree's Euclidean-in-degrees ordering was not the true geographic ordering — in principle the genuinely-nearest neighborhood could rank 6th by degree distance and be excluded from the candidate set before the haversine re-rank ever saw it. Latent: real Chicago neighborhood centroids are kilometres apart, so no misbehavior was observed.

**How it was resolved:** Made the KDTree metric-consistent. Added `import math` and a module-level `_KDTREE_LON_SCALE = cos(radians(41.85))` (Chicago reference latitude, the same projection pattern `local_search.py` already uses). `_get_neighborhood_kdtree` now scales each centroid's longitude by that factor before building the tree, and `reverse_geocode_point` scales the query point's longitude the same way, so the pre-filter ranks by true distance and cannot drop the nearest neighborhood. The final `haversine_miles` re-rank + 200 m threshold are unchanged. New `TestReverseNeighborhoodKDTreeProjection` builds a synthetic six-neighborhood layout where the true nearest sits one pure-longitude step away and five decoys one pure-latitude step away — an unprojected k=5 pre-filter evicts the true nearest, the projected one keeps it rank 1 (both variants verified during implementation).

---

### 2026-05-22 · `/explore` `source` enum omitted three curated source keys (BUG-002, fourth scan)

**Files:** `CLAUDE.md`

**Priority:** 🟡 Medium

**What the bug was:** The `/explore` API section of CLAUDE.md documented the response `source` field as one of `osm`, `cpl_locations`, `farmers_markets_2013`, `cdp_divvy`, `cdp_landmarks`. The fourth-scan audit recorded this as wrong in both directions — listing two values that could not occur and omitting three that the data contained. By the time of the fix, `places_curated.json` had been re-ingested and now carries 2,434 records across all seven curated sources (`cpl_locations`, `farmers_markets_2013`, `cps_schools`, `cpd_stations`, `cfd_stations`, `cdp_divvy` 1,157, `cdp_landmarks` 407), so the audit's Divvy/Landmarks data-absence concern was already moot — only the enum half remained.

**How it was resolved:** Corrected the `/explore` `source` enum in CLAUDE.md to the actually-emitted set — `osm`, `cpl_locations`, `farmers_markets_2013`, `cps_schools`, `cpd_stations`, `cfd_stations`, `cdp_divvy`, `cdp_landmarks`. The `backend/data/` `places_curated.json` description was already accurate (it names every curated source) and needed no change; `test_places.py`'s `cdp_divvy`/`cdp_landmarks` assertions now execute rather than skip, since the data is present.

---

### 2026-05-22 · CLAUDE.md documentation drift — dead link, miscredited field, stale counts, missing entries (BUG-006–BUG-012, fourth scan)

**Files:** `CLAUDE.md`

**Priority:** 🟢 Low

**What the bugs were & how they were resolved:** Seven low-severity documentation-vs-code mismatches in CLAUDE.md from the fourth-scan audit, all fixed in one pass:

- **BUG-006** — line 7 linked to `frontend/handoff/HANDOFF.md`, which has never existed in the repo. Removed the dead parenthetical link, kept the inline Phase 1 summary.
- **BUG-007** — the Porting Notes claimed `main.py` computes `distance_miles` from `minutes`. Reworded: each step's `distance_miles` is derived from `distance_meters` (`seg_miles = distance_meters / METERS_PER_MILE`); only route-level `total_miles` comes from `minutes` × `WALKING_SPEED_MPH`.
- **BUG-008** — line 7 presented "296/296 as of 2026-05-14" as a near-current frontend test count, inconsistent with figures in FEATURE_HISTORY/Technical_Debt. Dropped the hard count, kept "142/142 at the close of Phase 1, 2026-05-05" as a dated milestone snapshot, and pointed readers to `npm test`. Also dropped the stale "14 should pass" hardcoded count from the greenest-routing deploy-checklist step. (FEATURE_HISTORY's counts sit inside dated feature entries — already frozen snapshots — and TD-032 already self-labels its baseline, so neither needed editing.)
- **BUG-009** — the backend `tests/` enumeration omitted four modules; added `test_fetch_bake`, `test_heatmap_clipper`, `test_walking_eviction`, and `test_build_places_osm` (the audit said three — `test_build_places_osm` had landed since).
- **BUG-010** — added `backend/scripts/_curated_common.py` to the Project Structure tree (its `merge_and_write` is the replace-by-`_source` merge layer shared by every curated-ingest script).
- **BUG-011** — added `Pillow` to the `requirements-dev.txt` dev-deps line.
- **BUG-012** — changed the bare kind word "golf" to "golf courses" / `golf_course` in the green-space prose and structure-tree comment so it matches the `green_space.py` `kind` enum.

---

### 2026-05-21 · Explorer subcategory selection still showed the whole parent category

**Files:** `frontend/src/App.jsx`, `frontend/src/components/ExploreCategoryPanel.jsx`

**Priority:** 🟡 Medium

**What the bug was:** In the Neighborhood Explorer's category panel, selecting one or more subcategories under a parent (e.g. only "Convenience stores" under "Grocery stores") still painted every place in the parent category on the map, instead of narrowing to just the chosen subcategories. Two cooperating causes: (1) `handleToggleSub` in [App.jsx](../../frontend/src/App.jsx) auto-promoted the parent key into `selectedCategories` whenever any sub was checked; (2) `activeSubsSet` unioned `selectedCategories` and `selectedSubs` indiscriminately, so the bare parent key (`"grocery"`) landed in the set alongside the composite keys (`"grocery/convenience"`). `MapExploreLayer`'s place filter checks `activeSubs.has(p.category)` *before* the per-subcategory check, so the bare parent key matched every place under it and the subcategory filter was never reached. The auto-promotion was redundant regardless — `useExploreFetch` already derives the backend request's category list from the parent prefixes of `selectedSubs`, and the panel only reveals sub-checkboxes after the parent is checked, so the parent is always present in `selectedCategories` anyway.

**How it was resolved:** Removed the parent auto-promotion from `handleToggleSub` (it now only mutates `selectedSubs`). Reworked `activeSubsSet` to omit the bare parent key for any category that has at least one subcategory selected: it first builds a `narrowed` set of parent keys appearing in `selectedSubs`, then adds a `selectedCategories` entry to the active set only when that category is *not* narrowed. A category with zero subs selected still contributes its bare key (shows everything under it); once any sub is selected, only the composite `category/subcategory` keys pass, so unselected subs — and places with no subcategory tag — drop out. `MapExploreLayer`'s filter and the `/explore` request shape were already correct and needed no change. The behavior comment block in [`ExploreCategoryPanel.jsx`](../../frontend/src/components/ExploreCategoryPanel.jsx) was corrected to match (the prior comment claimed checking a parent flipped all sub-keys, which it never did, and described the now-removed auto-promotion).

---

### 2026-05-14 · Fetch timeouts surfaced as silent failures (no error, no result) (BUG-001, third scan)

**Files:** `frontend/src/lib/fetchWithTimeout.js`, `frontend/src/lib/fetchWithTimeout.test.js`, `frontend/src/hooks/useRouteFetch.js`, `frontend/src/hooks/useRouteFetch.test.js`, `frontend/src/hooks/useExploreFetch.js`, `frontend/src/hooks/useExploreFetch.test.js`

**Priority:** 🟡 Medium

**What the bug was:** `fetchWithTimeout` armed an internal `AbortController` (`timeoutCtrl`) and aborted the fetch via that controller when the timeout fired. The rejection that surfaced was a generic `AbortError` — indistinguishable from a user-initiated abort via the external signal. Both `useRouteFetch` and `useExploreFetch` caught the rejection with `if (err.name === "AbortError" || signal.aborted) return;`, where `signal` was the *external* abort signal. On a real timeout, `err.name === "AbortError"` was true but `signal.aborted` was false, so the catch returned silently. The `finally` block then cleared the loading flag (since `!signal.aborted`). End result: the loading state turned off, no error message was set, no result was shown — the user saw the spinner / skeleton vanish and nothing replace it. Exactly the failure mode the timeout was supposed to surface.

**How it was resolved:** Added a distinct `TimeoutError` class to [`fetchWithTimeout.js`](../../frontend/src/lib/fetchWithTimeout.js). The wrapper now tracks a `timedOut` flag inside the timeout callback; on a fetch rejection, if the AbortError originated from the timeout AND the external signal wasn't aborted, the rejection is reclassified to `TimeoutError`. Genuine user aborts and other failures pass through unchanged. Both hooks now translate `err.name === "TimeoutError"` into a user-friendly message (`"The routing service didn't respond in time. Please try again."` / `"The explorer didn't respond in time. Please try again."`) so the error surface stays terse and consistent with the rest of the dispatch copy. Regression tests in [`fetchWithTimeout.test.js`](../../frontend/src/lib/fetchWithTimeout.test.js), [`useRouteFetch.test.js`](../../frontend/src/hooks/useRouteFetch.test.js), and [`useExploreFetch.test.js`](../../frontend/src/hooks/useExploreFetch.test.js) pin the new shape: timeouts now reject with `TimeoutError` and the hooks expose the friendly copy via `error` / `exploreError`.

---

### 2026-05-14 · `normalize_address` / `normalize_street_name` left trailing directionals in place (BUG-002, third scan)

**Files:** `backend/geocode_text.py`, `backend/tests/test_geocode_text.py` (new)

**Priority:** 🟢 Low

**What the bug was:** The normalizers in [`geocode_text.py`](../../backend/geocode_text.py) stripped a leading directional and a trailing street suffix, but a directional that followed the suffix was not stripped. Example: `normalize_address("1234 N Lake Shore Dr S")` returned `"1234 lake shore dr s"` (expected `"1234 lake shore"`); `normalize_street_name("Clark St N")` returned `"clark st n"` (expected `"clark"`). The `tokens[-1] in _SUFFIXES` check ran exactly once and short-circuited because the *directional* — not the suffix — was the last token. Because the same normalizer runs at ingest time (populating `addresses` and `intersections` in `chicago_geocode.db`) and at query time, the asymmetry only mattered when one side had the trailing directional and the other didn't, but the canonical form was wrong either way.

**How it was resolved:** Replaced the single-pass `if tokens[-1] in _SUFFIXES: tokens = tokens[:-1]` strip in both helpers with a `while`-loop that strips trailing tokens belonging to *either* `_SUFFIXES` or `_DIRECTIONALS` until none remain. Handles the three real shapes in one pass: `"Clark St"` (suffix only), `"Clark St N"` (directional reveals suffix), and `"Lake Shore Dr S"` (directional hiding the suffix). Added [`backend/tests/test_geocode_text.py`](../../backend/tests/test_geocode_text.py) covering each shape plus the empty-input / single-token degenerate cases.

---

### 2026-05-13 · `pickMode` persisted across route ⇄ explore mode toggle (BUG-001, second scan)

**File:** `frontend/src/App.jsx`

**Priority:** 🔴 High

**What the bug was:** The "Set point on map" crosshair button only renders inside `buildRouteContents` (the route-mode sidebar), but the `pickMode` state survived a `setMode("explore")` call. A user who activated pick mode and switched to Explore mode found themselves stranded: the click-to-drop-pin handler in `MapPickLayer` stayed attached, tapping the map dropped a red preview pin and popped the Cancel/Confirm card on top of the isochrone, and the same map click also fired place-pin / cluster handlers in `MapExploreLayer`. No UI was visible to exit pick mode without first switching back to Route mode.

**How it was resolved:** Added `if (next !== "route") setPickMode(null);` inside the `setMode` callback in [App.jsx](../../frontend/src/App.jsx). The existing `pickMode` → snap-restore effect runs automatically when the value flips to null, so the mobile sheet returns to its prior snap with no additional plumbing.

---

### 2026-05-13 · `/autocomplete` returned 500 when `chicago_geocode.db` was missing (BUG-002, second scan)

**File:** `backend/local_search.py`

**Priority:** 🟡 Medium

**What the bug was:** When `backend/data/chicago_geocode.db` was absent, `_connect()` fell back to `sqlite3.connect(":memory:")` and logged a warning that said "local_search will only resolve neighborhoods." But the autocomplete cascade still called `_query_intersections_exact`, `_query_intersections_prefix`, and `_query_addresses_prefix` — and those raised `sqlite3.OperationalError: no such table` against the `:memory:` connection. The `/autocomplete` endpoint did not wrap the call, so the error propagated and FastAPI returned a 500. (`/route` was unaffected because `geocoding.py` wraps `local_search.forward` in `try/except`.)

**How it was resolved:** Changed `_connect()` to return `None` when the DB artifact is missing (instead of opening a `:memory:` stub). Each `_query_*` helper now short-circuits to `[]` when `_connect()` returns `None`, and `nearest_address` uses the same pattern (replacing its separate `DB_PATH.exists()` guard). Autocomplete now degrades cleanly to neighborhood + POI tiers when the DB is absent.

---

### 2026-05-13 · `URL.revokeObjectURL` fired synchronously after `a.click()` on PNG download (BUG-003, second scan)

**File:** `frontend/src/hooks/useShareCard.js`

**Priority:** 🟡 Medium

**What the bug was:** The Web Share fallback path created an `<a download>` link and immediately revoked the object URL on the same microtask: `a.click(); URL.revokeObjectURL(objectUrl);`. iOS Safari and some in-app webviews (Slack, Instagram, etc.) start the actual download asynchronously after `click()` returns; revoking too early intermittently left users with a 0-byte file. The affected browsers overlap exactly with the "Download PNG" fallback population (no `navigator.canShare({ files })` support).

**How it was resolved:** Wrapped the revoke in `setTimeout(() => URL.revokeObjectURL(objectUrl), 0)`, deferring it to the next macrotask so the browser has time to capture the blob reference.

---

### 2026-05-13 · Explorer slider `onKeyUp` fired `onSubmit` on every arrow-key release (BUG-004, second scan)

**File:** `frontend/src/components/ExploreForm.jsx`

**Priority:** 🟢 Low

**What the bug was:** The time-budget slider had `onPointerUp={handleSliderRelease}` AND `onKeyUp={handleSliderRelease}`. For mouse drag the intent worked — onChange fired per tick, onPointerUp fired once on release. But every keyup event (including arrow-key auto-repeats) committed and triggered a `/explore` fetch. A held arrow key produced N fetches per held second; the abort plumbing in `useExploreFetch` cancelled them but the backend still did real work until the AbortSignal landed.

**How it was resolved:** Added a `sliderDirtyRef` that flips true inside `handleSliderChange` and resets to false in `handleSliderRelease`. The release handler now no-ops when the value hasn't changed since the last commit, so non-value-changing keyup events (Tab, modifiers, repeated keyup at the slider's min/max boundary) don't fire a fetch.

---

### 2026-05-13 · `reverseStops` regenerated all stop IDs, dropping focus mid-edit (BUG-005, second scan)

**File:** `frontend/src/App.jsx`

**Priority:** 🟢 Low

**What the bug was:** `reverseStops()` did `prev.slice().reverse().map(s => ({ ...s, id: makeStopId() }))` — generating a fresh `id` for every stop. Since `AddressAutocomplete` was keyed on stop id, all inputs unmounted and remounted on every Reverse click, losing keyboard focus, the open suggestions list, and any in-flight autocomplete request. Typing "wrig" in the destination input then clicking Reverse killed the dropdown.

**How it was resolved:** Reverse in place: `prev.slice().reverse()`. The ids stay stable, React reconciles the reorder without remounting, and the suggestions popover / focus survive the swap.

---

### 2026-05-13 · Persona height range mismatched: frontend 4–7 ft vs backend 3–9 ft (BUG-006, second scan)

**Files:** `frontend/src/lib/personaPrefs.js`, `frontend/src/components/PersonalizeModal.jsx`, `frontend/src/lib/urlParams.js`

**Priority:** 🟢 Low

**What the bug was:** The backend validator accepted 36–108 in (3–9 ft), but the frontend's `loadStoredHeightFt` rejected anything outside `[4, 7]`, the personalize-modal dropdown only offered `[4, 5, 6, 7]`, and `readUrlParams` stripped `hft` outside `[4, 7]`. Users at extremes (children below 4 ft, anyone above 7 ft) couldn't save or share their actual height; the system silently snapped to the default and produced an inaccurate step length for them.

**How it was resolved:** Expanded `FT_OPTIONS` in [`PersonalizeModal.jsx`](../../frontend/src/components/PersonalizeModal.jsx) to `[3, 4, 5, 6, 7, 8]`, widened `loadStoredHeightFt`'s accepted range to `[3, 8]`, and widened the `readUrlParams` `hft` range to `[3, 8]`. The dropdown caps at 8 (9 is the backend's mathematical upper bound but isn't a realistic real-world value).

---

### 2026-05-13 · `loadStepLog` had a side effect (localStorage write) during read (BUG-007, second scan)

**File:** `frontend/src/lib/stepLog.js`

**Priority:** 🟢 Low

**What the bug was:** `loadStepLog` pruned expired entries on every read and wrote the pruned list back to localStorage if any were dropped. Consumed by `useState(loadStepLog)` in App.jsx — React calls lazy state initializers exactly once in production, but in StrictMode dev builds it calls them twice to surface side-effect bugs. The implicit "load" contract is read-only; a future caller in a `useMemo` or render path would have emitted a write per render. The quota-exhausted-browser case would also have iterated the prune-then-fail-silently cycle every read.

**How it was resolved:** Split the function in two. `loadStepLog` now only reads + prunes the returned list (no writeback). A new `pruneStoredStepLog` export does the read + prune + writeback. App.jsx calls `pruneStoredStepLog` once inside a mount-only `useEffect`; the lazy state initializer stays read-only.

---

### 2026-05-13 · Reverse geocode used 200 m radius for the address tier (BUG-001)

**File:** `backend/geocoding.py`

**Priority:** 🟡 Medium

**What the bug was:** `reverse_geocode_point` passed the neighborhood-tier threshold (`_REV_THRESHOLD_MI` ≈ 200 m) to `local_search.nearest_address`, even though both the function docstring and `CLAUDE.md` promised the address tier matched within ~50 m. A map click in any open area could be labeled with a street address up to 2 blocks away rather than falling through to the LocationIQ / coordinate-string tier.

**How it was resolved:** Added a dedicated `_REV_ADDRESS_THRESHOLD_MI = 50.0 / METERS_PER_MILE` constant and passed it to `nearest_address`. The neighborhood tier still uses the 200 m `_REV_THRESHOLD_MI` constant.

---

### 2026-05-13 · `tree_canopy.py` module docstring listed wrong density-band thresholds (BUG-002)

**File:** `backend/tree_canopy.py`

**Priority:** 🟢 Low

**What the bug was:** The module docstring claimed cells were grouped at `≥ 0.25, ≥ 0.5, ≥ 0.75`, but the live `DENSITY_BANDS` constant (and `CLAUDE.md` and the `/explore` API docs) used `low ≥ 0.05`, `mid ≥ 0.15`, `high ≥ 0.40`. Documentation-only mismatch.

**How it was resolved:** Updated the docstring to match the live thresholds (`≥ 0.05 / ≥ 0.15 / ≥ 0.40`).

---

### 2026-05-13 · LocationIQ autocomplete supplement cached under a different key than the cascade (BUG-003)

**File:** `backend/main.py`

**Priority:** 🟢 Low

**What the bug was:** `/autocomplete`'s supplement called `geocode_external(q.lower())` on the raw lowercased query, but `resolve_location` (used by `/route`) normalizes USPS street abbreviations before the same call. A user typing "100 N Main Ave" would cache under that exact string, then pay for a second LocationIQ call when they submitted the route — `resolve_location` looked up the normalized form "100 n main avenue" and saw a cache miss.

**How it was resolved:** Imported `_normalize_street_abbr` from `geocoding` and applied it in the supplement branch of `autocomplete_endpoint` so both code paths write/read the same `cached_forward` key.

---

### 2026-05-13 · Stale `line-trim-offset` left route polyline half-drawn on next render (BUG-005)

**File:** `frontend/src/map/MapRouteLayer.jsx`

**Priority:** 🟡 Medium

**What the bug was:** When the route render effect was re-entered after `stopAnim()` cancelled an in-flight draw-in animation, `line-trim-offset` was pinned at the prior interpolated value on the layer. A subsequent render that bailed before any `setTrim` ran (via `prefers-reduced-motion: reduce` or `path.length < 2`) left the new polyline persistently half-hidden. Even in the animated path, a one-frame mis-paint flashed before the first RAF.

**How it was resolved:** Added an unconditional `map.setPaintProperty("walk-path-line", "line-trim-offset", null)` at the top of the `render` closure, immediately after `stopAnim()`. The new path now starts from a known-clean trim state regardless of which downstream branch runs.

---

### 2026-05-13 · `AddressAutocomplete` portaled listbox closed on Tab / VoiceOver focus (BUG-006)

**File:** `frontend/src/components/AddressAutocomplete.jsx`

**Priority:** 🟡 Medium

**What the bug was:** `handleBlur` kept the dropdown open only when focus moved to a descendant of `wrapperRef`. But the default `positioning === "portal"` mode renders the listbox into `document.body`, so it's never a DOM descendant of the wrapper. Mouse/touch users escaped the bug via `onMouseDown`/`onTouchStart` preventing blur, but keyboard Tab and VoiceOver navigation closed the dropdown the moment focus tried to enter it.

**How it was resolved:** Extended `handleBlur` to also keep the dropdown open when `relatedTarget` is inside the portaled listbox (matched by id via `next.closest?.(\`#${escapedId}\`)`, with `CSS.escape` fallback for older browsers).

---

### 2026-05-13 · Persisted "My location" origin reloaded into a permanent error (BUG-007)

**File:** `frontend/src/lib/explorePrefs.js`

**Priority:** 🟢 Low

**What the bug was:** `sanitize()` restored a persisted `kind:"current"` origin without `lat`/`lon` (coords are intentionally not persisted). The `useExploreFetch` auto-fetch then hit the `origin.lat == null` guard and surfaced "Allow location access to explore from where you are.", with no auto-re-locate. The user saw a stale error in place of an isochrone every reload until they manually re-clicked "📍 My location".

**How it was resolved:** In `sanitize()`, restored `kind:"current"` is now downgraded to `kind:"community_area"` (preserving any prior community-area pick, or the default Loop). The user can re-tap the "📍 My location" tile to re-locate explicitly.

---

### 2026-05-13 · "Walk here" / neighborhood chip silently no-op'd when origin was "current" without coords (BUG-008)

**File:** `frontend/src/App.jsx`

**Priority:** 🟢 Low

**What the bug was:** `handlePlaceGoHere` and `handleNeighborhoodChip` both computed `originName` from the persisted explore origin, requiring coords when `kind === "current"`. When coords hadn't yet been resolved (BUG-007 reload scenario or first-load geolocation race), both handlers returned with no feedback at all — buttons appeared dead.

**How it was resolved:** When `originName` is null, both handlers now call `showToast("Still reading your location — try again in a moment.")` instead of silently returning, so the UI fails loudly. BUG-007's fix reduces the trigger frequency; this toast closes the in-flight race.

---

### 2026-05-13 · Pin-to-pin click in the Explorer popup left the second popup empty (BUG-010)

**File:** `frontend/src/map/MapExploreLayer.jsx`

**Priority:** 🔴 High

**What the bug was:** `onPinClick` called `popupRef.current.remove()` on the prior popup *before* assigning the new popup to `popupRef.current`. `.remove()` fires the `close` event synchronously, which ran the previous click's close handler — that handler's guard (`popupRef.current && popupRef.current.isOpen?.() === false`) was both true, so `teardownPopup()` nulled `popupElRef.current` / unmounted the React root. By the time the new popup was built with `.setDOMContent(popupElRef.current)`, that argument was `null`, and the second popup rendered with no body.

**How it was resolved:** Captured the new popup in a local `me` and gated the close handler on `popupRef.current === me`, then dropped `popupRef.current` to `null` before calling `.remove()` on the stale popup so the prior handler's identity check fails fast.

---

### 2026-05-13 · Daily-step-goal custom input was overwritten by the seed effect on every keystroke (BUG-011)

**File:** `frontend/src/components/PersonalizeModal.jsx`

**Priority:** 🟡 Medium

**What the bug was:** `handleGoalNumber` clamped + committed the goal upward on every keystroke. The seed effect listed `dailyGoal` (and `weightKg`) in its deps, so as soon as the parent updated, the effect reseeded the local mirror — overwriting the user's in-progress digits ("1" → parent clamps to 1000 → input flips to "1000" before they can finish typing "15000").

**How it was resolved:** Dropped `weightKg` and `dailyGoal` from the seed effect's deps. Reseeding now runs only on `open` and `unit` flips (the two cases where the displayed value must change irrespective of typing); parent-driven changes during typing no longer echo back into the input.

---

### 2026-05-13 · Autocomplete "Searching…" announcement cleared prematurely on rapid keystrokes (BUG-012)

**File:** `frontend/src/components/AddressAutocomplete.jsx`

**Priority:** 🟢 Low

**What the bug was:** The fetch `finally` block guarded the `abortRef` reset but called `setLoading(false)` unconditionally — so an aborted (stale) fetch flipped loading off even while a fresher fetch was mid-flight. Sighted users saw no change, but the `role="status"` SR region announced an extra empty-then-"Searching…" cycle on every other keystroke.

**How it was resolved:** Moved `setLoading(false)` inside the `abortRef.current === ctrl` guard so only the live fetch can transition the loading flag.

---

### 2026-05-13 · `useRouteFetch` wrote recents before the min-loading delay (BUG-009)

**File:** `frontend/src/hooks/useRouteFetch.js`

**Priority:** 🟢 Low

**What the bug was:** After a successful `fetch`, the hook called `saveRecentSearch(cleanStops)` *before* awaiting the 450 ms `ensureMinLoadingDuration`. A user who submitted a second route during the min-loading window aborted the first call, but its recent-search entry had already been persisted to `walkpath:recentSearches` — polluting the chip strip with routes the user never saw rendered.

**How it was resolved:** Moved the `saveRecentSearch` + `setRecentSearches` calls to after the `await ensureMinLoadingDuration(loadStart); if (signal.aborted) return;` guard. The `history.replaceState` URL write stays where it was — share-link deep-state is genuinely safer to write early.

---

### 2026-05-12 · `EXPLORE_DEFAULTS` shared an `origin` reference with `DEFAULT_PREFS` (BUG-011)

**File:** `frontend/src/lib/explorePrefs.js`

**Priority:** 🟢 Low (defensive)

**What the bug was:** `EXPLORE_DEFAULTS = { ...DEFAULT_PREFS }` was a shallow spread, so `EXPLORE_DEFAULTS.origin` aliased `DEFAULT_PREFS.origin`. Nothing in the codebase mutates either today, but any future write like `EXPLORE_DEFAULTS.origin.foo = ...` would silently corrupt the in-process default that `sanitize()` reads on every prefs load.

**How it was resolved:** Switched the export to a deep copy: `export const EXPLORE_DEFAULTS = JSON.parse(JSON.stringify(DEFAULT_PREFS))`. The contents are JSON-safe (strings/numbers/booleans/arrays), so the structural clone is sufficient and the two constants no longer share any nested references.

---

### 2026-05-12 · `_normalize_edge_str` collapsed falsy first list elements to `""` (BUG-013)

**File:** `backend/walking.py`

**Priority:** 🟢 Low

**What the bug was:** `_normalize_edge_str` used `(v[0] or "") if v else ""` to coerce a `[None]` igraph attribute list to `""`. The `or` pattern also collapsed any other falsy first element — `[0]`, `[""]`, `[False]` all became `""`. Current graph columns are strings so no live data was lost, but the same helper feeds future bulk-read columns (and the trailing `return v or ""` branch could silently drop a `0` length).

**How it was resolved:** Replaced the `or` shortcut with an explicit `None` check on both branches and `str()`-coerced any non-None value, so only true `None` (or an empty list) becomes `""`.

---

### 2026-05-12 · `fetchWithTimeout` external-signal abort listener never detached on settle (BUG-012)

**File:** `frontend/src/lib/fetchWithTimeout.js`

**Priority:** 🟢 Low

**What the bug was:** When the caller passed an external `AbortSignal`, the helper attached an `abort` listener with `{ once: true }`. If the fetch completed normally, the listener was never removed — it stayed attached for the life of the external signal, retaining the per-call `timeoutCtrl` (and the surrounding closure) in memory. Today every call site creates a fresh `AbortController` per fetch, so the leak is bounded, but any future caller reusing a long-lived signal across many fetches would accumulate listeners.

**How it was resolved:** Named the abort handler (`onAbort`) and removed it inside the `.finally()` alongside the existing `clearTimeout(timer)`, so the listener is always detached when the fetch settles.

---

### 2026-05-12 · `/explore` echoed the original `max_minutes` float while routing used the rounded value (BUG-006)

**File:** `backend/main.py`, `backend/explore.py`

**Priority:** 🟢 Low

**What the bug was:** `explore()` quantized `max_minutes` via `round()` before keying the LRU cache and running Dijkstra, so a request for `max_minutes=20.7` computed the polygon for 21 minutes. The `/explore` endpoint then returned `"max_minutes": payload.max_minutes`, echoing the original `20.7`. The response was self-inconsistent (polygon for 21, echo of 20.7), and two callers requesting 20.4 and 20.6 both saw the 20-minute polygon without knowing it.

**How it was resolved:** Moved the rounding to the pydantic boundary: `ExploreRequest.max_minutes` is now `int` with a `mode="before"` validator that rounds incoming floats. The response echo and the cache key + Dijkstra cutoff now always agree. The internal `explore.explore()` signature was updated to `int` (the inner `round()` is retained as a defensive coercion for legacy callers).

---

### 2026-05-12 · `loadStoredHeightFt` null-guard inconsistent with `loadStoredHeightIn` (BUG-010)

**File:** `frontend/src/lib/personaPrefs.js`

**Priority:** 🟢 Low

**What the bug was:** `loadStoredHeightFt` used `if (!raw) return null`, treating an empty string the same as a missing value, while its sibling `loadStoredHeightIn` used `if (raw == null) return null`. The downstream range check (4–7) masked the discrepancy for the current valid range, but the inconsistency would flip real behavior the next time the valid range or default changed.

**How it was resolved:** Aligned `loadStoredHeightFt` to the `raw == null` predicate so both loaders share the same null-guard.

---

### 2026-05-12 · Multi-stop URL params double-encoded user-typed labels (BUG-009)

**File:** `frontend/src/hooks/useRouteFetch.js`, `frontend/src/hooks/useShareCard.js`, `frontend/src/lib/urlParams.js`

**Priority:** 🟢 Low (cosmetic)

**What the bug was:** Both URL writers ran each stop through `encodeURIComponent` before joining with `|` and handing the result to `URLSearchParams.set`, which percent-encodes the value a second time. A 3-stop route through `Wrigley Field` ended up with `?stops=Wrigley%2520Field%7C...` in the address bar. `parseStopsParam` decoded once, so round-trips still worked, but the URL itself was noisy and the single-stop branch (`urlP.set("from", cleanStops[0])`) didn't pre-encode — leaving the two paths inconsistent.

**How it was resolved:** Dropped the per-segment `encodeURIComponent` in both writers; `URLSearchParams.set` now handles encoding for the whole `A|B|C` value (the `|` separator is left literal, which is valid in a query string). `parseStopsParam` keeps its tolerant `decodeURIComponent` per segment so legacy double-encoded URLs from before the fix still resolve correctly — for new URLs the call is a no-op because the segments arrive already decoded.

---

### 2026-05-12 · `normalize_address` dropped the only token when input was `"<num> <suffix>"` (BUG-008)

**File:** `backend/geocode_text.py`

**Priority:** 🟢 Low

**What the bug was:** After splitting house number from street, `normalize_address` unconditionally stripped a trailing suffix token. For a single-token street like `"22 Way"`, this left `rest = []`, and the function returned `"22"` only — disagreeing with `normalize_street_name("Way")` which was guarded by `len(tokens) > 1`. Canonicals stored for such addresses could never match a search query.

**How it was resolved:** Mirrored the `normalize_street_name` guard: the suffix-strip now requires `len(rest) > 1`, so single-token street names are preserved verbatim. One-line change at `geocode_text.py:93`.

---

### 2026-05-12 · `residential_heatmap` could emit `GeometryCollection` instead of `MultiPolygon` (BUG-007)

**File:** `backend/places.py`

**Priority:** 🟢 Low

**What the bug was:** After `unary_union(pieces)` in `clip_residential_to_polygon`, the code only wrapped a bare `Polygon` into a `MultiPolygon`. `unary_union` can return a `GeometryCollection` when input polygons touch along edges (the touch produces a `LineString` mixed in with the polygons), in which case `mapping()` emitted `{"type": "GeometryCollection", ...}` — violating the `GeoJSON MultiPolygon | null` API contract documented in `CLAUDE.md` and `docs/FEATURE_HISTORY.md`. The frontend's MapLibre `fill` source silently ignores non-polygon members.

**How it was resolved:** After `unary_union`, detect `GeometryCollection` results, filter to `Polygon` / `MultiPolygon` members only, and re-union them. Empty filtered results return `None`; the existing `Polygon → MultiPolygon` wrap is preserved as the final step so the response always matches the contract.

---

### 2026-05-12 · LocationIQ ZIP-trim regex truncated 5-digit house numbers (BUG-005)

**File:** `backend/geocoding.py`

**Priority:** 🟡 Medium

**What the bug was:** `_reverse_geocode_external` trimmed `display_name` after the first `\b\d{5}\b` match to drop the ZIP + country tail. Chicago's south-side grid runs out to ~13800, so any address south of ~100th Street has a 5-digit house number — the regex matched on the house number, and `display = display[:m.end()]` left the label as just `"13700"` for `"13700 S Western Ave, Chicago, IL 60643, USA"`. Affected every pick-on-map lookup on the far south side that fell through to the LocationIQ fallback (i.e. beyond the local 200 m neighborhood/address tiers).

**How it was resolved:** Anchored the regex to a leading comma and optional ZIP+4 suffix (`r",\s*(\d{5})(?:-\d{4})?\b"`) so only the genuine `, 60643` segment matches. House numbers are never preceded by `", "` in LocationIQ's `display_name` format. Added two `_reverse_geocode_external` unit tests covering the south-side 5-digit case and the existing happy path.

---

### 2026-05-12 · Multi-font symbol layers contradicted the documented "single-font only" workaround (BUG-004)

**File:** `frontend/src/mapHelpers.js`

**Priority:** 🟡 Medium

**What the bug was:** `walk-stops-label` used `"text-font": ["Noto Sans Bold"]` with a comment warning that OpenFreeMap 404s on comma-joined font fallbacks and would error the whole glyph bucket. But two layers below — `explore-places-cluster-count` and `explore-places-glyph` — used the forbidden multi-font array `["Noto Sans Bold", "Open Sans Bold", "Arial Unicode MS Bold"]`, so either the comment was wrong or the explorer's cluster counts and category glyphs silently 404'd.

**How it was resolved:** Normalised both explorer symbol layers to the single-font form `["Noto Sans Bold"]` to match the documented workaround, and rewrote the comment on `walk-stops-label` so it covers the whole file instead of singling out one layer.

---

### 2026-05-12 · `nearest_address` bounding-box prefilter narrower than `max_miles` in longitude (BUG-003)

**File:** `backend/local_search.py`

**Priority:** 🟡 Medium

**What the bug was:** `nearest_address` widened the SQL bbox with `span = max_miles / 60.0` for both lat and lon. At Chicago's latitude (~42°), 1° lon ≈ 51.4 mi, so `/60` made the longitude box narrower than `max_miles` — at the actual `_REV_THRESHOLD_MI ≈ 0.124 mi` (~200 m) caller, the bbox covered only ~172 m east/west, silently excluding in-range candidates 172–200 m due east or west of the query point and forcing those reverse-geocodes to fall through to LocationIQ.

**How it was resolved:** Split the prefilter into per-axis spans: `span_lat = max_miles / 69.0` and `span_lon = max_miles / (69.0 * cos(radians(lat)))`. Added `import math` at the top of the module. The Haversine post-filter is unchanged, so candidates beyond `max_miles` are still rejected — the box is now slightly conservative (admits a few more candidates) rather than too narrow.

---

### 2026-05-12 · `VALID_GROUP_KEYS` missing `public_services` strips expansion state (BUG-002)

**File:** `frontend/src/lib/explorePrefs.js`

**Priority:** 🟡 Medium

**What the bug was:** `VALID_GROUP_KEYS` was a hand-maintained literal `Set(["daily_life", "food_drink", "outdoors", "culture", "living"])` that omitted the newer `public_services` group. Because `sanitize()` filters `expandedGroups` through that whitelist on every load and save, expansion of the Public services group never persisted across sessions — and the save-on-render effect in `App.jsx` actively rewrote storage to strip it.

**How it was resolved:** Replaced the hand-maintained literal with `new Set(EXPLORE_GROUPS.map(g => g.key))`, derived from the single source of truth in `exploreCategories.js`. Adding a future group now requires only one edit. The 13 existing tests in `explorePrefs.test.js` still pass.

---

### 2026-05-12 · Explore-mode slider release races with `explorePrefsRef` sync (BUG-001)

**File:** `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the bug was:** `handleExploreMaxMinutesChange` only called `setExplorePrefs` and relied on the ref-sync `useEffect` in `useExploreFetch.js` to update `explorePrefsRef.current`. Because that effect runs after commit, the `pointerup` → `handleExploreSubmit` → `fetchExploreResult` chain that fires on slider release can read the previous `maxMinutes` value off the ref, sending the old budget to `/explore` on every drag-release.

**How it was resolved:** `handleExploreMaxMinutesChange` now synchronously writes `explorePrefsRef.current = { ...explorePrefsRef.current, maxMinutes: next }` right after the `setExplorePrefs` call, mirroring the belt-and-suspenders pattern already used in `handleExploreOriginChange`. The fetch fired on slider release now sees the latest value regardless of effect timing.

---

### 2026-05-11 · "Walk here" and neighborhood chips failed when origin was current location (BUG-033)

**File:** `frontend/src/App.jsx`

**Priority:** 🔴 High

**What the bug was:** `handlePlaceWalkHere` and `handleNeighborhoodChip` resolved the explore origin to `"My location"` when `origin.kind === "current"`. The backend geocoder does not recognise that label — Google returns `ZERO_RESULTS` — so every "Walk here" tap from a current-location explore returned a 400 error and the route never plotted.

**How it was resolved:** Both callbacks now read `o.lat` and `o.lon` off the origin object and build a `"${lat.toFixed(5)}, ${lon.toFixed(5)}"` coordinate string, which the backend's `_COORD_RE` fast path resolves without hitting Google. The callbacks short-circuit with an early return if the coords are not yet available (current-location mode before geolocation has resolved).

---

### 2026-05-11 · handlePlaceWalkHere / handleNeighborhoodChip called stale fetchRoute via frozen closure (BUG-034)

**File:** `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the bug was:** Both callbacks were `useCallback`-wrapped with deps `[setMode]`. Because `setMode` is itself stable, the callbacks were created exactly once at mount and never recreated. Inside them, `fetchRoute` was called directly — but `fetchRoute` is a plain `async function` that re-declares every render, closing over the current personalization prefs. The frozen callbacks called the mount-time `fetchRoute`, ignoring any height / weight / pace changes the user made in the Personalize modal.

**How it was resolved:** Added a `fetchRouteRef` (declared near the other `Ref`s in App.jsx) that is kept in sync with the latest `fetchRoute` closure via a synchronous assignment during render (`fetchRouteRef.current = fetchRoute`). Both frozen callbacks now call `fetchRouteRef.current(...)` instead of `fetchRoute(...)`, mirroring the `submitRef` pattern already used in `ExploreForm.jsx`.

---

### 2026-05-11 · renderExplore fired fitBounds on every re-render, resetting user's map position (BUG-035)

**Files:** `frontend/src/mapHelpers.js`, `frontend/src/map/MapExploreLayer.jsx`

**Priority:** 🟡 Medium

**What the bug was:** `renderExplore` always called `map.fitBounds(...)` at the end of every invocation. `MapExploreLayer`'s render effect depends on `[mode, exploreResult, showResidential, placeFeatures, placeExpressions]`, so toggling a category checkbox or the residential-heatmap switch re-ran `renderExplore` and jumped the map back to fit the full polygon, discarding any pan/zoom the user had performed.

**How it was resolved:** Added a `fitOnRender` option (default `true`) to `renderExplore`'s options object; the `fitBounds` call is now conditional on that flag. `MapExploreLayer` tracks the last-rendered `exploreResult` in a `prevExploreResultRef` and passes `fitOnRender: didResultChange` — true only when the `exploreResult` reference itself changes (a new isochrone fetch), false for display-only re-renders.

---

### 2026-05-11 · Graph eviction didn't clear explore._explore_quantized LRU cache (BUG-036)

**File:** `backend/walking.py`

**Priority:** 🟢 Low

**What the bug was:** `_evict_graph()` cleared `_get_nearest_node_quantized`, `_get_shortest_path_by_node`, and `_compute_route_quantized` but not `explore._explore_quantized`. A subsequent `/explore` request with the same quantized origin+budget would return the stale cached polygon from the prior graph while routing the same pair on the new graph.

**How it was resolved:** Added a local `try/except` import of `_explore_quantized` from `explore` inside `_evict_graph()` (local import avoids the circular import that a module-level import would cause) and called `cache_clear()` on it alongside the other three caches.

---

### 2026-05-11 · DirectionLedger active-turn highlight desynced when list was collapsed and turn was beyond step 5 (BUG-037)

**File:** `frontend/src/components/DirectionLedger.jsx`

**Priority:** 🟢 Low

**What the bug was:** When `showAll` was false, `visible = directions.slice(0, 5)`. `isActive` was computed as `i === activeTurnIndex` using the slice index. If the user clicked a turn dot at index ≥ 5, no row in the collapsed list had a matching `i`, so nothing was highlighted — the direction list gave no visual confirmation while the map dot animated correctly.

**How it was resolved:** Added a `useEffect` (and the `useEffect` import) that calls `setShowAll(true)` whenever `activeTurnIndex` is set and ≥ 5. The list auto-expands and the correct row scrolls into highlight range.

---

### 2026-05-06 · Haversine fallback direction step omitted `path_type` (BUG-020)

**File:** `backend/walking.py`

**Priority:** 🟡 Medium

**What the bug was:** `_build_directions`'s last-resort haversine fallback (taken when the street graph or shortest-path computation can't be reached) returned a direction dict missing the `path_type` key that every other emitted step carries. The API contract in `CLAUDE.md` calls `path_type` "present in all route types," and the frontend's `pathTypePhrase()` silently coerced the missing field through to the default "along the path" branch — cosmetically masked because `street: "Walk"` is set, but a contract violation any future consumer that filters or groups by `path_type` would trip over.

**How it was resolved:** Added `"path_type": ""` to the fallback dict so every emitted direction step matches the published shape. Empty string keeps `formatStepLabel`'s "Start on Walk" first-branch behaviour unchanged (because `step.street` is still set), while satisfying the contract for any consumer that reads `path_type` directly.

---

### 2026-05-06 · `_reverse_geocode_google` ignored the geocoder circuit breaker (BUG-021)

**File:** `backend/geocoding.py`

**Priority:** 🟡 Medium

**What the bug was:** Forward geocoding (`geocode_google`) tripped and respected the 429 / `OVER_QUERY_LIMIT` circuit breaker, but reverse geocoding hit the same Google endpoint and never checked `_circuit_is_open()`, never tripped the breaker on a 429, and never recorded a healthy reply. During a Google rate-limit incident `/reverse-geocode` would keep hammering Google (one round-trip per uncached request) while `/route` was already shedding load — wasting quota, blocking pick-on-map for the full 5-second timeout per request, and denying the forward path the chance to recover the breaker state.

**How it was resolved:** Mirrored the breaker logic in `_reverse_geocode_google`: short-circuit to `None` when `_circuit_is_open()` (callers fall through to the existing "coordinates" label), call `_circuit_trip_429()` when the response is HTTP 429 or `status=OVER_QUERY_LIMIT`, and call `_circuit_record_success()` on any healthy reply (including `ZERO_RESULTS`-style answers that prove Google is up). Reverse and forward geocoding now share one breaker state.

---

### 2026-05-06 · 2-stop "same location" error returned a string `detail` instead of the structured form (BUG-022)

**File:** `backend/main.py`

**Priority:** 🟡 Medium

**What the bug was:** When the 2-stop branch detected origin and destination collapsing to the same point, it raised `HTTPException(status_code=400, detail="Your origin and destination …")` — a bare string, while every other 4xx in `/route` (multi-stop "same location," outside-Chicago, geocoder-not-found) used the structured `{"message", "stop_index"}` form. Frontend code that read `error.detail.message` displayed `undefined` for the 2-stop case, breaking the toast / inline-error surface for that one error path.

**How it was resolved:** Converted the 2-stop branch to the structured form: `detail={"message": "Your origin and destination appear to be the same location.", "stop_index": 1}`. The `stop_index: 1` matches the multi-stop convention of pointing at the *second* stop of a colliding pair, so the frontend's existing per-stop highlight logic light up the destination row consistently across both branches. The existing `test_same_location_rejected` only asserts the status code, so it passes unchanged.

---

### 2026-05-06 · Missing-API-key warning re-logged on every uncached query (BUG-023)

**File:** `backend/geocoding.py`

**Priority:** 🟢 Low

**What the bug was:** When `GOOGLE_MAPS_API_KEY` was unset, `geocode_google` logged `"GOOGLE_MAPS_API_KEY not set — geocoding unavailable"` and returned `None` without caching the result. Every subsequent street-address query (anything not in `NEIGHBORHOOD_COORDS`) re-emitted the warning, drowning real errors under modest traffic.

**How it was resolved:** Added a `_warn_missing_api_key()` helper guarded by a `_missing_api_key_warned` module-level latch that fires the warning at most once per process. Both call sites (`geocode_google` and the newly-breaker-aware `_reverse_geocode_google`) call the helper instead of `logger.warning` directly. The latch resets only on process restart, which matches the expected operator workflow ("set the env var and reboot the worker").

---

### 2026-05-06 · `_flavor_weights` / `_combined_weights` mutated without lock protection (BUG-024)

**File:** `backend/walking.py`

**Priority:** 🟢 Low

**What the bug was:** `_get_flavor_weights` and `_get_avoid_stairs_weights` read and assigned their cache dicts without any synchronization. Two threads simultaneously requesting an uncached `(flavor, "avoid_stairs")` key (or a cold `fewest_turns` / `greenest`) each built a full per-edge weight vector — one O(E) iteration each — and only the last assignment won. CPython's GIL kept the dict assignment atomic so there was no torn read, but on a cold deploy under load the warmup cost multiplied by the concurrency factor.

**How it was resolved:** Added a dedicated `_weights_lock = threading.Lock()` guarding the build step in both functions, with the standard double-checked-lock pattern: a lock-free read on the hot path, a lock-then-recheck on the miss path so the slow build runs at most once per `(flavor, variant)` per process. To stay deadlock-free, `_get_avoid_stairs_weights` now resolves the base flavor weights *before* acquiring `_weights_lock` (because `_get_flavor_weights` reaches for the same lock and `threading.Lock` is non-reentrant).

---

### 2026-05-06 · `_stitch_legs` produced an invalid `(0, -1)` slice when the first leg path was empty (BUG-025)

**File:** `backend/main.py`

**Priority:** 🟢 Low

**What the bug was:** `_stitch_legs` initialized `leg_slices = [(0, len(full_path) - 1)]`. When `legs_raw[0]["path"]` was empty (a degenerate routing fallback), `full_path == []` and the seed slice became `(0, -1)`, which surfaced in the public response as `legs[0].path_slice = [0, -1]`. Any frontend slicing logic (`path.slice(start, end+1)`) would compute `path.slice(0, 0)` and silently swallow the leg geometry.

**How it was resolved:** Guarded the initializer with `max(0, len(full_path) - 1)` so an empty first leg seeds `(0, 0)` instead of `(0, -1)`. The frontend's slice math then collapses to `path.slice(0, 1)` (a single point if any), making the failure mode visible rather than silently dropped.

---

### 2026-05-06 · Personalize-modal goal & weight inputs clobbered keystrokes back to the parent value (BUG-014, BUG-016)

**File:** `frontend/src/components/PersonalizeModal.jsx`

**Priority:** 🔴 High (goal input) / 🟡 Medium (weight decimals)

**What the bug was:** The reseed `useEffect` ran on every change of `[open, weightKg, dailyGoal, unit]`. Each keystroke in the custom-goal input committed `onChangeGoal(clamped)` to the parent (where `clamped` was bounded into `[1_000, 100_000]`), which fired the effect on the next render and called `setGoalInput(String(dailyGoal))` — replacing what the user had just typed with the clamped value and clearing the "Adjusted to 1,000…" hint in the same pass. Typing "5" into the goal field instantly displayed "1000" with no helper. Same root cause sabotaged the weight input's decimals: typing "55.5 lb" round-tripped to kg, was rounded by `Math.round(kgToLb(weightKg))`, and snapped back to "55".

**How it was resolved:** Replaced the every-prop-tick reseed with a `prevOpenRef` that tracks `open`'s false→true transition. The effect now only reseeds when the modal *opens* (and resets the ref when the modal closes), so parent prop ticks while the modal is open no longer overwrite local input state. Unit toggles continue to work because `handleUnitToggle` mutates `weightInput` synchronously inside its handler, independent of the effect.

---

### 2026-05-06 · Explorer "Walk here" / neighborhood chip used literal "My location" string as route origin (BUG-015)

**File:** `frontend/src/App.jsx`

**Priority:** 🔴 High

**What the bug was:** When the user explored from their current location, both `handlePlaceWalkHere` and `handleNeighborhoodChip` built the origin label as `origin.kind === "community_area" ? origin.communityArea : "My location"`. The literal string `"My location"` was then passed to `fetchRoute`, which sent it as the `origin` field of the `/route` request. The backend's geocoder doesn't know that label, so the request 422'd and the planned walk never plotted — silently breaking the entire current-location → walk-here flow. The user's `lat`/`lon` were already on the explorer's origin object; we just weren't using them.

**How it was resolved:** Extracted a `resolveExploreOriginLabel` helper that returns the community-area name when in community-area mode and a `${lat.toFixed(5)}, ${lon.toFixed(5)}` coordinate string when in current-location mode (matching the pattern `handleMapPick` already uses when reverse-geocode can't find a label). Both callbacks now call it and short-circuit when no usable origin is available (current mode before geolocation has resolved). Backend's forward geocoding handles the bare-coords form, so the walk-here flow now plots correctly from the user's actual position.

---

### 2026-05-06 · Pick-on-map click handler bled into Explore mode and conflicted with place-pin clicks (BUG-017)

**File:** `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the bug was:** The pick-mode `useEffect` in `MapView` subscribes a global `map.on("click", handleClick)` whenever `pickMode` is truthy and only cleans up when `pickMode` flips back to null. If the user enabled pick-mode in Route mode, then flipped to Explore mode without first cancelling the pick, `pickMode` survived the mode flip — and every click on the map (including clicks on place pins) fired both the pin's popup handler and the pickMode preview-marker drop. The "Confirm location" panel then rendered on top of the place popup. The cursor crosshair also persisted into Explore mode, advertising a pick-on-map affordance that no longer made sense.

**How it was resolved:** Mode-toggle is the natural place to invalidate any in-flight gesture from the previous mode. `setMode` (the wrapping callback in `App.jsx`) now also calls `setPickMode(null)`, so a flip to Explore (or back to Route) cancels any pending pick. The pick-mode effect's existing teardown then fires, removing the map click subscription and clearing the cursor.

---

### 2026-05-06 · DirectionLedger left a dashed underline beneath the final step when "Show all" was expanded (BUG-018)

**File:** `frontend/src/components/DirectionLedger.jsx`

**Priority:** 🟢 Low (visual)

**What the bug was:** The final-row border-skip used `isFinal = i === visible.length - 1 && !hasMore`. When `showAll` was true the ledger rendered every direction (`visible === directions`), but `hasMore` was still true (computed from the original count > 5). So the actual last step never qualified as "final" and kept its `borderBottom: 1px dashed`. The "Arrive at destination" footer rendered below it with its own `borderTop: 1px solid`, producing a stacked dashed-then-solid double rule that doesn't appear for ≤5-step routes.

**How it was resolved:** Changed the predicate to `i === visible.length - 1 && (showAll || !hasMore)` so the bottom border is dropped whenever the full list is on screen — regardless of whether the list was originally truncated.

---

### 2026-05-06 · Recent-searches `saveRecentSearch` preserved corrupt legacy entries through dedup (BUG-019)

**File:** `frontend/src/lib/recentSearches.js`

**Priority:** 🟢 Low

**What the bug was:** `saveRecentSearch` ran existing entries through a `sigOf` helper that fell back to `[r.origin, r.destination]` when `r.stops` was missing. A legacy/corrupt entry with both `origin` and `destination` undefined produced `JSON.stringify([undefined, undefined])` → `"[null,null]"`. Two such entries collapsed to the same signature, but a normal save call had a different signature so they were never evicted — the 10-slot window quietly leaked to corrupt entries. The UI's reader (`recentEntryStops`) hides them, so the user just saw their valid recent list shrink with no obvious cause.

**How it was resolved:** Pre-filter `existing` through `recentEntryStops` (the same readback the UI uses) before dedup, so any entry whose stops can't be rendered gets dropped. The dedup `sigOf` is also rewritten to call `recentEntryStops` directly, so the two paths agree on what counts as a valid stop list. Net effect: the next save call after a corrupt entry lands cleans the list.

---

### 2026-05-05 · Mobile sheet auto-promoted on every route re-submit (BUG-014)

**File:** `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the bug was:** The mobile bottom-sheet auto-promote effect treated every transition of `result` from falsy to truthy as a "new result" worth promoting from peek (snap 0) to half (snap 1). The route-submit path calls `setResult(null)` immediately before `setResult(data)`, so the effect ran twice per submit — first nulling `lastResultRef.current`, then re-firing the auto-promote against that just-cleared ref. Net effect: any user who dragged the sheet down to peek to see the map would have it slammed back to half on every subsequent route submission, making peek feel unreachable for the rest of the session.

**How it was resolved:** Added a `userMovedSheetRef` flag that flips true the first time `WFSheet` fires `onSnapChange` (which only fires from drag releases, not prop changes — so programmatic snap moves like the auto-promote itself, the pick-mode peek/restore, and the controlled-prop wiring don't trip it). The auto-promote check now also requires `!userMovedSheetRef.current`, so once the user has expressed a preference within a session, the sheet stops fighting them. First-result-of-session auto-promote behaviour is preserved.

---

### 2026-05-05 · Cardinal-direction bearing ignored cos(latitude) (BUG-001)

**File:** `backend/walking.py`

**Priority:** 🟡 Medium

**What the bug was:** `_directions_from_path` computed the per-step cardinal with `math.atan2(lon2 - lon1, lat2 - lat1)`, treating one degree of longitude and one degree of latitude as comparable distances. At Chicago latitude (~41.9°), one degree of longitude is ~82.8 km vs. ~110.9 km for latitude — the unscaled `dlon` term inflated apparent east-west components by ~34%. Streets whose true bearing was between roughly 17° and 22.5° east of north were labelled "NE" when they should have been "N", with symmetric mis-classifications around every other inter-cardinal boundary.

**How it was resolved:** Multiply the longitude delta by `math.cos(math.radians(lat1))` before passing it to `atan2`, which puts both axes in comparable physical distances. Cardinal classifications now follow true bearing within a fraction of a degree across the Chicago coverage area.

---

### 2026-05-05 · `--verbose` flag in `fetch_street_graph.py` was a no-op (BUG-002)

**File:** `backend/fetch_street_graph.py`

**Priority:** 🟡 Medium

**What the bug was:** `download_and_save(verbose=…)` set `ox.settings.log_console = True` unconditionally and immediately discarded the `verbose` parameter with `_ = verbose`. The CLI parsed `--verbose` but it had no effect on behaviour — Overpass console logging was always on.

**How it was resolved:** `ox.settings.log_console = bool(verbose)` so the flag now controls osmnx console logging as documented.

---

### 2026-05-05 · LRU cache shared mutable dict references in `directions` (BUG-003)

**File:** `backend/walking.py`

**Priority:** 🟢 Low

**What the bug was:** `_compute_route_quantized` is `@lru_cache`-decorated and returned `(path, directions, minutes)` where `directions` is a tuple of dicts. `walk_paths_alternatives` and the multi-stop `_compute_leg` wrapped the directions in `list(directions)` but kept the same dict references, so any caller that mutated a direction dict in place would silently corrupt the cached entry. No present-day caller mutates these dicts, but the alias was a footgun for future contributors.

**How it was resolved:** The public `_compute_route` wrapper now shallow-copies each direction dict (`tuple(dict(d) for d in directions)`) before returning. The cache still stores the canonical tuple; consumers receive fresh dicts they're free to mutate.

---

### 2026-05-05 · `_get_neighborhood_kdtree` lazy init was not thread-safe (BUG-004)

**File:** `backend/geocoding.py`

**Priority:** 🟢 Low

**What the bug was:** The first reverse-geocode call materialized `_neighborhood_kdtree`, `_neighborhood_names`, and `_neighborhood_coords_arr` from module globals without synchronization. Two concurrent first-call requests could each enter the `if _neighborhood_kdtree is None` branch and rebuild redundantly; worse, one thread could observe `_neighborhood_kdtree` already assigned while `_neighborhood_names` still pointed at the prior empty tuple, producing an `IndexError` at the `_neighborhood_names[i]` lookup.

**How it was resolved:** Added a module-level `threading.Lock`, applied a double-checked-locking pattern, and reordered the global assignments so the tree handle is published last — any thread that observes a non-None `_neighborhood_kdtree` is guaranteed to see the matching names/coords.

---

### 2026-05-05 · Same-location guard was asymmetric in lat vs lon (BUG-005)

**File:** `backend/main.py`

**Priority:** 🟢 Low

**What the bug was:** `_SAME_LOCATION_DEG2 = 0.001 ** 2` was compared against the raw `dlat² + dlon²`. The comment claimed the threshold corresponded to "~0.07 mi (~113 m)", but that was only true for north-south deltas — at Chicago latitude one degree of longitude is ~82.8 km, so the same `dlon=0.001 deg²` slice covered only ~83 m east-west. The duplicate-stop guard rejected adjacent stops as "same location" up to ~25% looser east-west than the comment implied.

**How it was resolved:** Replaced the squared-degree shortcut with a true `haversine_miles(...)` distance comparison against a single `_SAME_LOCATION_THRESHOLD_MILES = 0.07` constant, so the guard is now symmetric in every direction.

---

### 2026-05-05 · Recent-searches dedup signature collided on stop boundaries (BUG-006)

**File:** `frontend/src/lib/recentSearches.js`

**Priority:** 🟡 Medium

**What the bug was:** Both the new-entry signature and the existing-entry signature joined stops with the empty string. Two genuinely different routes whose concatenations aligned across stop boundaries (`["A","BC"]` vs. `["AB","C"]`) produced identical signatures and silently evicted each other from the recents list.

**How it was resolved:** Both `sig` and `sigOf` now use `JSON.stringify(stops)`, which preserves stop boundaries so structurally distinct stop arrays produce distinct signatures.

---

### 2026-05-05 · Shareable-URL stops weren't escaped against the `|` separator (BUG-007)

**File:** `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the bug was:** Multi-stop deep links were encoded with `cleanStops.join("|")` and parsed with `raw.split("|")`. Any stop label containing a literal `|` was silently fragmented into bogus stops on the receiving end, with `slice(0, MAX_STOPS)` then truncating real stops off the end. Reverse-geocoded labels and addresses with embedded pipes produced unroutable requests after a share-and-reopen.

**How it was resolved:** The writer now `encodeURIComponent`-escapes each stop before joining; `parseStopsParam` `decodeURIComponent`-decodes each segment (with a fallback to the raw segment for legacy URLs). Round-trip safe for any character a label can contain.

---

### 2026-05-05 · `PaceSegmented` arrow keys didn't move DOM focus (BUG-008)

**File:** `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the bug was:** The compact pace selector implemented an ARIA `radiogroup` with a roving-tabindex pattern. ArrowLeft/ArrowRight changed `aria-checked` and re-rendered with the new `tabIndex={checked ? 0 : -1}` — but DOM focus stayed on the previously-selected button (now `tabIndex=-1`). Screen readers didn't announce the new option as the focused one, and Tab-leaving / Tab-returning landed on the wrong cell.

**How it was resolved:** Added `buttonRefs` and a `moveTo(idx)` helper that calls `onChange` AND `buttonRefs.current[idx]?.focus()` so DOM focus follows selection, matching the standard ARIA radiogroup contract.

---

### 2026-05-05 · Custom daily-goal input silently rejected out-of-range values (BUG-009)

**File:** `frontend/src/components/PersonalizeModal.jsx`

**Priority:** 🟡 Medium

**What the bug was:** `handleGoalNumber` only committed to the parent's `onChangeGoal` when the parsed value was inside `[1_000, 100_000]`. Typing a value below 1,000 or above 100,000 left `goalInput` showing the typed value while the parent's `dailyGoal` kept its previous value, with no visible feedback. The user closed the modal believing they'd set their goal but the rest of the app continued using the old number.

**How it was resolved:** `handleGoalNumber` now always commits a clamped value (`Math.max(1_000, Math.min(100_000, n))`) and surfaces an inline `aria-live="polite"` `goalNote` ("Adjusted to N — goals stay between 1,000 and 100,000.") when clamping occurred.

---

### 2026-05-05 · Calorie-equivalent grammar: "1½ banana" instead of "1½ bananas" (BUG-010)

**File:** `frontend/src/calorieEquiv.js`

**Priority:** 🟢 Low

**What the bug was:** `calorieEquivalent` only used `bestFood.plural` when `bestFrac.val >= 2`. Because `NICE_FRACS` includes `1.5` ("1½"), the result read "≈ 1½ banana, returned to the day." — broken English in `StepHero`, `CompareDispatch`, and the share card.

**How it was resolved:** Threshold changed to `bestFrac.val > 1`, so any fraction strictly greater than one renders the plural noun.

---

### 2026-05-05 · `PersonalizeModal` local input state didn't sync on reopen (BUG-011)

**File:** `frontend/src/components/PersonalizeModal.jsx`

**Priority:** 🟢 Low

**What the bug was:** `weightInput` and `goalInput` were seeded from `weightKg` / `dailyGoal` only in the `useState` initializer and never re-derived. Because `if (!open) return null` doesn't unmount, the local state survived modal closes — any parent-driven update (deep-link import, future external reset) made the modal reopen with stale values disagreeing with the parent.

**How it was resolved:** Added a `useEffect` keyed on `[open, weightKg, dailyGoal, unit]` that reseeds `weightInput`, `goalInput`, and clears `goalNote` whenever the modal opens or the parent values change.

---

### 2026-05-05 · `renderWalkRoute` leaked endpoint layers when coords disappeared (BUG-012)

**File:** `frontend/src/mapHelpers.js`

**Priority:** 🟢 Low

**What the bug was:** The endpoint-dot blocks were structured as `if (drawEndpointDots && origin_coords) { add… } else if (!drawEndpointDots) { drop… }`. If a render with `drawEndpointDots=true` and valid coords created the layers, and a later render kept the flag true but lost the coords, neither branch fired — the previously-added source/layer remained visible at the prior location.

**How it was resolved:** Cleanup branch is now plain `else { drop… }`, so the layer is dropped whenever it shouldn't be present, regardless of why.

---

### 2026-05-05 · `WFProgress` produced NaN width when `max` was 0 (BUG-013)

**File:** `frontend/src/wayfarer/extras.jsx`

**Priority:** 🟢 Low

**What the bug was:** `pct = Math.max(0, Math.min(100, (value / max) * 100))` evaluated to `NaN` when `max <= 0` (because `0 / 0` is `NaN`), leaving `width: "NaN%"` and `left: "calc(NaN% - 1px)"` on the rendered fill/marker divs. The component is exported but not yet consumed in app surface — latent until a future caller hands it `max=0`.

**How it was resolved:** Guarded with `max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0` so the bar collapses to empty for non-positive `max` instead of emitting invalid CSS.

---

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

### 2026-05-24 · FastAPI lifespan cleanup + rate-limiter hardening + test (TD-056)

**Files:** `backend/main.py`, `backend/walking.py`, new `backend/tests/test_rate_limit.py`.

**Priority:** 🟡 Medium.

**What the debt was:** Eight ops/lifecycle findings — the lifespan yielded with no shutdown cleanup (B-17), the preload future's result was discarded so a silent failure would make the next request block (B-18), the eviction daemon's outer + inner `_last_graph_access` check looked like a TOCTOU bug but was actually an advisory-vs-authoritative pattern (B-19), `geocoding._cache_db` closed via atexit with no guaranteed lifespan ordering (B-20), `_client_ip` silently fell back to the peer when `X-Forwarded-For` was shorter than `TRUSTED_PROXY_HOPS` (B-24), `_client_ip` didn't validate XFF tokens as IPs (B-25), the rate limiter was globally disabled by `conftest.py` and therefore untested (B-35), and `_start_eviction_daemon` returned silently when `TTL=0` (B-36).

**How it was resolved:**

- **B-17 + B-18 + B-20 (lifespan shutdown).** `lifespan` now does explicit teardown after `yield`: closes the geocoding HTTP session (calls `close_http_session()` added in TD-055), closes the geocoding SQLite cache (`_cache_db.close()` for WAL flush), and shuts down the heatmap thread pool with `cancel_futures=True`. Order: outbound network → storage → in-process pools. Each step is in a `try/except` so a partial-cleanup failure logs but doesn't block the next step. **B-18:** the preload `await loop.run_in_executor(None, _preload_graph)` already awaits the future — a silent failure would now surface as a startup error rather than block the first request.
- **B-19 (TOCTOU pattern documented).** Inline block comment in `_evict_graph` names the outer/inner check pattern: the daemon's outer read is advisory ("is there work to do?"), the inner re-check inside `_graph_lock` is authoritative. An in-flight request can never race the eviction itself.
- **B-24 + B-25 (XFF validation + overshoot WARN).** `_client_ip` now validates each XFF token via `ipaddress.ip_address` before returning it as the rate-limit key — a malformed header produces a fall-back to the connection peer rather than a bogus rate-limit bucket. New `_xff_overshoot_warned` one-shot latch fires a WARN exactly once per process when XFF is shorter than `TRUSTED_PROXY_HOPS`, so a misconfigured proxy chain surfaces in logs without spam.
- **B-36 (TTL=0 logging).** `_start_eviction_daemon` now logs `Graph eviction disabled (GRAPH_EVICTION_TTL_SECONDS=0)...` instead of returning silently.
- **B-35 (rate-limit test).** New [test_rate_limit.py](../../backend/tests/test_rate_limit.py) with a `_rate_limited_app` fixture that toggles `RATE_LIMIT_ENABLED=true`, reimports `main` (the limiter wires at module import), and drives a 35-request burst against `/route` (30/min limit). Confirms the limiter actually fires + that the un-limited `/health` doesn't 429 from adjacent-bucket pollution. Module-level fixture isolation undoes the env override + reload at teardown so the rest of the suite continues to run with rate-limiting disabled per conftest.

**Acceptance:** `pytest backend/tests/` → **340 passed (340)** in 21s (was 338; 2 new rate-limit tests).

---

### 2026-05-24 · geocoding.py HTTP session hardening + KDTREE_LON_SCALE shared (TD-055)

**Files:** `backend/geocoding.py`, `backend/utils.py`.

**Priority:** 🟡 Medium.

**What the debt was:** Four findings on `geocoding.py`. **B-21** — `_http_session` was a bare `requests.Session()` with no User-Agent (LocationIQ ToS expects clients to identify; "python-requests/2.x" is unhelpful in their logs) and no retry adapter for transient 5xx hiccups. **B-39** — `_KDTREE_LON_SCALE` was a module-private constant in `geocoding.py`; the catalog flagged drift risk if a sibling module ever reimplemented the same lon-projection scale inline. **B-02** — 950 LOC mixing HTTP, cache, fuzzy match, KDTree, and cascade orchestration. **B-05** — kdtree cache wasn't keyed on the scale value, so a future scale change would silently consume a stale tree.

**How it was resolved:**

- **B-21 (HTTP session hardening).** New `_build_http_session()` configures the long-lived session with a descriptive `User-Agent: Passage/1.0 (+...) python-requests`, mounts an `HTTPAdapter` with a `Retry(total=3, backoff_factor=0.5, status_forcelist=(502, 503, 504))` adapter for transient gateway hiccups, and exposes a new `close_http_session()` callable for FastAPI lifespan teardown to invoke. Retries on 429 are intentionally OFF — the existing circuit breaker (`backend/geocoding.py` `_breaker_*`) handles that path, and double-counting against the budget would defeat it.
- **B-39 (shared lon-scale constant).** Hoisted `_KDTREE_LON_SCALE` to [`utils.py`](../../backend/utils.py) as `KDTREE_LON_SCALE`. `geocoding.py` now imports it (re-exposed as `_KDTREE_LON_SCALE` to preserve the existing private name for minimal-blast-radius rename). `local_search.py`'s nearest-neighbor logic uses per-query `cos(radians(lat))` rather than a cached value, so it's unaffected by the shared constant — confirmed by inspection.
- **B-02 (cascade restructure) — deferred.** Extracting `_CachedGeocoder` + tier-callable classes would touch 950 LOC of working code that's already covered by `test_geocoding.py` + `test_geocoding_cascade.py` integration paths. The catalog's "consistent error handling" goal is mostly already met (each tier catches its own exceptions and returns None on miss); the cleanup would be code-organization churn without a correctness or perf win. Same rationale as TD-054's deferred module split.
- **B-05 (scale-in-kdtree-cache-key) — deferred.** The scale value (`cos(radians(41.85))`) is a compile-time constant tied to Chicago's reference latitude. It changes only when multi-city support arrives, at which point the cache key shape needs a city dimension anyway — better to handle there than to add bookkeeping now that doesn't shield against a current failure mode.

**Acceptance:** `pytest backend/tests/` → **338 passed (338)** in 19s. Live LocationIQ calls now identify as `Passage/1.0` in the vendor's logs.

---

### 2026-05-24 · `walking.py` algorithm docs + greenest formula reference (TD-054 — partial)

**Files:** `backend/walking.py`, `CLAUDE.md`.

**Priority:** 🟡 Medium.

**What the debt was:** Five findings flagged in the 2026-05-23 audit, three of which turned out to be already-addressed or premise-mistaken on closer inspection. **B-09 + B-11** claimed the greenest formula constants were duplicated between `walking.py:99-103` and `fetch_street_graph.py:250-254`. Investigation showed those are **disjoint constant sets** — the bake-time constants (`_PARK_CUTOFF_M`, `_PARK_ACRES_LOG_SAT`, etc.) control how `_bake_green_signals` derives the per-edge canopy + park *scores*; the runtime constants (`_GREEN_FOOTWAY_WEIGHT`, `_GREEN_CANOPY_WEIGHT`, etc.) combine those scores into Dijkstra weights. No duplication; just two halves of a pipeline that tuners often want to look at together. **B-38** (`green_mask` rebuilt per cache-miss) had already been addressed by OPT-032 — the mask is now baked at graph load and the per-miss rebuild is a guarded fallback. **B-15** (88-line `_build_path_and_directions` with sparse docs) was partially addressed by TD-053's inline comment additions; the remaining gap was an algorithm-level summary.

**How it was resolved:**

- **Algorithm-level docstring on `_build_path_and_directions`** (B-15). Names the two phases (coord assembly + step aggregation), explains the geometry-orientation `du_start`/`du_end` logic, the `skip_first` dedup, and the cardinal-snap + block-classification work in phase 2.
- **New "Greenest formula" section in [CLAUDE.md](../../CLAUDE.md)** (B-09 reframed). Cross-references all the bake-time and runtime constants with their role, default value, file/function read site, and effect. Includes the full v3 weight formula in one place so a tuner can find every knob without grepping. Documents per-signal degradation behavior (the TD-068 graceful-degradation path).

**What was deferred and why:**

- **The full module split** (`walking.py` → `walking.py` + `walking_weights.py` + `walking_formula.py`) was **not executed**. The catalog's stated motivator was the formula-duplication claim, which doesn't hold up to inspection. Splitting 1100 LOC across 3 modules just for LOC reduction would require restructuring shared module-level state (the per-edge cache columns) without a corresponding correctness or perf win. The "Greenest formula" CLAUDE.md section achieves the actual goal (single doc-level source of truth for the formula) without the structural churn.
- **B-38 zero-edit** confirmed — OPT-032 already caches `_edge_green_mask` at load; line 670-677's `if green_mask is None ...` is the graceful-degradation fallback, not the hot path.

**Acceptance:** `pytest backend/tests/` → **338 passed (338)** in 19s. CLAUDE.md "Greenest formula" section reads end-to-end as a self-contained reference.

---

### 2026-05-24 · `walking.py` correctness sweep — 8 findings + 15 new tests (TD-053)

**Files:** `backend/walking.py`, new `backend/tests/test_walking_correctness.py`.

**Priority:** 🔴 High.

**What the debt was:** Eight correctness findings from the 2026-05-23 audit, ranging from a missing same-node short-circuit (B-40) and an unobserved NaN-rescue path (B-45) to dtype mixing (B-41), missing defensive guards (B-44, B-47), and undocumented geometric / threshold choices (B-42, B-43, B-46).

**How it was resolved:**

- **B-40 (same-node short-circuit):** `_compute_route` now quantizes origin + destination to ~1 m and short-circuits when they collapse to the same cell. Returns a single-point path + empty directions + zero minutes instead of letting igraph emit an empty epath that downstream code couldn't distinguish from a routing failure.
- **B-41 (dtype consistency in `_get_avoid_stairs_weights`):** Weight vector is now float32 to match `_build_flavor_weights`'s native dtype. Halves the avoid-stairs cache memory footprint without losing precision at the meter scale.
- **B-42 (reverse + skip_first asymmetry):** The catalog claimed asymmetric geometric meaning; investigation showed the two `range()` calls are geometrically equivalent — both skip the duplicate seam point at the start of each segment, just in different directions. Documented inline with the rationale so a future reader doesn't try to "fix" the working code.
- **B-43 (cardinal direction snap):** Added an explicit 1° snap zone around each of the 8 cardinal axes (0°, 45°, 90°, …). Within the zone, the heading rounds to the cardinal; outside it, the standard `round(deg/45) % 8` bin wins. Kills jitter induced by float-precision drift in atan2 when the path is "due cardinal."
- **B-44 (defensive epath/vpath guard):** `_build_path_and_directions` now logs an error and returns empty geometry if `len(epath) != len(vpath) - 1`. The igraph contract guarantees this invariant, but the guard surfaces a regression loudly instead of silently emitting a truncated route.
- **B-45 (NaN-rescue WARNING):** New `_nan_rescue_warned` one-shot flag fires a WARNING the first time `np.nan_to_num` scrubs a non-finite greenest weight. Sticky after first fire so subsequent rebuilds don't spam.
- **B-46 (`_BLOCK_TYPE_THRESHOLD` tie-handling):** Documented the deliberate choice of `>=` for the 150 m midpoint with the rationale (single 150 m edge renders as "1 long block," closer to Chicago pedestrian wayfinding than "1.5 short blocks").
- **B-47 (`_kdtree_to_vertex` dtype assertion):** `assert valid_idx.dtype == np.int64` at graph-load time. Catches a future refactor (e.g., a numpy version that defaults `np.where` to int32 on Windows) before it silently truncates vertex IDs on a large multi-city graph.

**Tests:** New [`test_walking_correctness.py`](../../backend/tests/test_walking_correctness.py) — 15 cases covering same-node short-circuit (2), NaN-rescue one-shot warning (1), cardinal snap parametrized at ±0.5°/±0.1°/0° from N/S (10), epath/vpath length guard (1), kdtree dtype (1).

**Acceptance:** All 8 findings addressed. `pytest backend/tests/` → **338 passed (338)** in 19s (was 323; 15 new).

---

### 2026-05-24 · localStorage schema versioning + migration registry (TD-071)

**Files:** new `frontend/src/lib/storageSchema.js`, new `frontend/src/lib/storageSchema.test.js`, `frontend/src/main.jsx`.

**Priority:** 🟡 Medium.

**What the debt was:** No `walkpath:schemaVersion` marker, no migration registry. The one schema change to date (`train_stations` → `el_train_stations`) was hand-coded inside `explorePrefs.js:sanitize()` as a per-key fixup. Future renames would accumulate the same way — scattered across whichever module owns the affected key, with no central place to audit "what schema changes have we shipped, and on what schedule do users get migrated forward" (F-24).

**How it was resolved:**

- **New [`frontend/src/lib/storageSchema.js`](../../frontend/src/lib/storageSchema.js)** holds a `CURRENT_SCHEMA_VERSION` constant (currently 1 — the pre-existing baseline) and a `MIGRATIONS` registry keyed by from-version. Each migration is an idempotent, crash-safe function that performs whatever localStorage surgery the schema change requires; the runner walks the chain `from = currentVersion` up to `CURRENT_SCHEMA_VERSION` and persists the new version after each successful step.
- **`runStorageMigrations()`** is the public entry point. Reads `walkpath:schemaVersion` (treating missing / malformed as v1 — the pre-versioning baseline), walks the chain, persists the new version, returns the resulting version. Gaps in the registry log a dev-time warning and short-circuit to the current version (loud in dev, graceful in prod). Migration crashes don't advance the version, so the next boot retries.
- **Wired in [`frontend/src/main.jsx`](../../frontend/src/main.jsx)** at the very top of the import graph — runs synchronously before App imports, so every `loadStored*()` call in the feature modules sees a migrated localStorage. Comment pins the ordering rationale so a future refactor doesn't reshuffle the imports.
- **Documented adding-a-migration recipe** inline in `storageSchema.js`: bump `CURRENT_SCHEMA_VERSION`, add a `[N]: () => { ... }` entry, document the change. The function-level doc comment captures the idempotent / crash-safe / defensive contract every migration must honor. An example migration is included (commented out) as a template.

**Tests:** New [`storageSchema.test.js`](../../frontend/src/lib/storageSchema.test.js) covers four cases — fresh install, idempotent re-run at current version, malformed version marker, missing marker (pre-TD-071 user). All four lock in the contract; future migrations should add their own scenario tests against the registry.

**Acceptance:** `npm test` → **474 passed (474)** in 20s. `walkpath:schemaVersion` is now persisted on every boot.

---

### 2026-05-24 · Disaster recovery runbook (TD-070)

**Files:** new `docs/DR.md`.

**Priority:** 🟡 Medium.

**What the debt was:** No off-machine backup procedure documented for `street_graph.graphml` (~314 MB OSM snapshot, lives only on the developer machine) or `chicago_geocode.db` source ingest data (only on GitHub release). Low-probability but high-impact — if the GitHub release vanishes or the developer machine dies, an OSM re-fetch produces a drifted snapshot rather than a faithful recovery (X-27).

**How it was resolved:**

- **New [`docs/DR.md`](../../docs/DR.md)** documents three failure scenarios end-to-end: GitHub release corrupted/deleted, developer machine lost, `chicago_geocode.db` lost. Each scenario carries a checklist with concrete `gh release upload` / Railway env-var rotation steps.
- **Inventory table** at the top maps every artifact to its size, current location, and reproducibility profile — so a future maintainer doing the recovery for the first time can see at a glance which pieces are bit-exact-recoverable and which (OSM) drift over time.
- **Backup cadence recommendation** — graphml after every full re-fetch (~quarterly), `chicago_geocode.db` after every address-points rebuild. Other JSON artifacts are tracked in git and don't need separate backups.
- **Annual dry-run reminder** — once a year, regenerate the pickle from a backup snapshot in a scratch directory and diff the SHA-256 against production. The only way to know the runbook still works before you need it.
- **Printable inventory checklist** at the bottom — the "where do I start?" cheat sheet that lives off-machine so a recovery doesn't require booting the dev environment first.

The runbook's location (`docs/DR.md`) parallels the existing `docs/RELEASE_RUNBOOK.md` — happy-path / unhappy-path siblings, linked from each other.

**Acceptance:** Documentation-only chunk; no code touched. The catalog's acceptance ("test rebuild from documented backup procedure produces a byte-identical artifact") is testable but requires a deliberate scratch-rebuild — slotted as an annual exercise in the runbook itself.

---

### 2026-05-24 · Structured logging (opt-in JSON) + per-request X-Request-Id (TD-069)

**Files:** `backend/requirements.txt`, `backend/main.py`.

**Priority:** 🟡 Medium.

**What the debt was:** Backend used uvicorn's default text logs to stdout. No JSON / structured logging, no request correlation IDs, no easy path to ingestion in a log aggregator (X-17). Debugging prod was effectively blind — a user-reported error had no thread ID to correlate to a log line.

**How it was resolved:**

- **`python-json-logger>=2.0,<4.0` added to [requirements.txt](../../backend/requirements.txt).** Picked over `structlog` to avoid touching every `logger.warning(...)` call — `python-json-logger` is a stdlib Formatter that wraps existing log records as JSON. Every existing log site renders structured without code changes.
- **`_configure_structured_logging()` in [main.py](../../backend/main.py).** Opt-in via `STRUCTURED_LOGS=true` (also accepts `1` / `yes`). When set, the root logger's handlers are replaced with a `StreamHandler` carrying a `jsonlogger.JsonFormatter` configured for `ts`, `logger`, `level`, `message` fields. Uvicorn's default handler is removed to avoid double-logging. When unset, behavior is unchanged (text logs).
- **`stash_request_id` middleware** registered ahead of `stash_client_ip`. Honors an incoming `X-Request-Id` header (capped at 128 chars to deter log poisoning) or generates a uuid4. The ID is stashed at `request.state.request_id` for handlers to consume, and echoed in the response's `X-Request-Id` header so client logs can correlate.
- **Sentry tier skipped per the catalog's "optional" flag.** No `SENTRY_DSN` env var support added — easy to bolt on later (a single `import sentry_sdk; sentry_sdk.init(dsn=os.getenv("SENTRY_DSN"))` if it's ever wanted), but no concrete failure mode justifies the third-party dependency today.

**Acceptance:** `pytest backend/tests/` → **323 passed (323)** in 21s. With `STRUCTURED_LOGS=true uvicorn main:app`, log lines render as JSON parseable by `jq`. Every response carries an `X-Request-Id` header.

---

### 2026-05-24 · Pickle format forward-compat (graceful degradation) + /health feature_degraded (TD-068)

**Files:** `backend/walking.py`, `backend/main.py`, `backend/models.py`, `backend/tests/test_main.py`, `backend/tests/test_walking_greenest.py`.

**Priority:** 🟡 Medium.

**What the debt was:** Multi-city support (Feature 1) wants to onboard cities whose source datasets don't include the per-edge canopy or park-proximity signals that the `greenest` flavor's weight function reads. The Feature 4 chunk 3 fail-fast guard (shipped 2026-05-14) explicitly refused to boot when those columns were missing — `_graph_load_failed = True` and a hard error log. That posture made sense for Chicago (a partial v2 pickle in prod = silent-broken greenest = ship-worse-than-haversine), but blocks multi-city onboarding (X-19). The B-08 finding flagged the same drift could happen during a hot-swap eviction reload — the boot path was fail-fast but the runtime reload had no equivalent guard. And the LocationIQ circuit breaker (X-20) keyed on a global "forward" string, so a Chicago 429 would gate Evanston too once multi-city ships.

**How it was resolved:**

- **Relaxed the fail-fast guard to per-column graceful degradation** ([walking.py](../../backend/walking.py)). The per-column presence check now zero-fills missing canopy / park columns and logs a clear `WARNING` (one per missing column) naming the column, the format_version, and pointing at the rebuild recipe. The new `_greenest_degraded: dict[str, bool]` module flag records which signals are degraded. Greenest still routes; canopy + park contributions just collapse to zero for the degraded signal — equivalent to footway-only discount for canopy or no park boost for park-proximity.
- **New `greenest_degradation_status()` exported from walking.py.** Returns a snapshot of the per-signal flags. /main.py imports it.
- **/health exposes `feature_degraded`** ([main.py](../../backend/main.py)). The HealthResponse model in [models.py](../../backend/models.py) gained an optional `feature_degraded: dict[str, bool] | None` field. When all signals are OK the field is omitted from the response (backward-compatible). When degraded the response carries `{"status": "ok", "feature_degraded": {"canopy": true, "parks": false}}` — the per-signal map matches `_greenest_degraded`'s keys.
- **X-20 (per-city breaker keying) deferred** — Multi-city is the only consumer of per-city breaker keys, and the breaker logic in `geocoding.py` would need a `city` parameter threaded through every call site. Cleaner to handle it inside Multi-City Feature 1 chunk 1's geocoder refactor than to land a single-city no-op prep here.
- **B-08 (hot-swap path) addressed by the same guard.** The eviction → reload path now goes through the same per-column check; a hot-swapped degraded pickle surfaces in `_greenest_degraded` immediately.

**Tests:** Renamed `TestV3FailFast` → `TestV3GracefulDegradation` in [test_walking_greenest.py](../../backend/tests/test_walking_greenest.py). The flagship test now asserts the relaxed contract: v2 pickle loads successfully, both column-missing warnings fire, and `greenest_degradation_status()` reports `{canopy: True, parks: True}`. Cleanup undoes the monkeypatched paths before reloading the production pickle so the degradation flags reset. `test_health_returns_ok` loosened to assert only `data["status"] == "ok"` since later tests may have left a degraded flag set.

**Acceptance:** `pytest backend/tests/` → **323 passed (323)** in 20s. A v2-shaped pickle loads with both `canopy` + `parks` degradation flags surfaced via `/health`.

---

### 2026-05-24 · Security headers + input validation hardening (TD-067 — Wave 4)

**Files:** `backend/main.py`.

**Priority:** 🟡 Medium.

**What the debt was:** Seven defense-in-depth findings from the 2026-05-23 audit. None exploitable today; each closes a recon / future-refactor footgun. No `Permissions-Policy` header (S-01); `/route` echoed user-supplied stop strings back in error messages (S-02); `/autocomplete` `q` length cap enforced inside the handler body, not at the Pydantic boundary (S-03); `ExploreOrigin` lat/lon validator relied on NaN-comparison-always-false instead of explicit `math.isfinite` (S-04); CORS `allow_methods` didn't list HEAD explicitly (S-05); `/explore` community-area error message echoed the requested name (S-06); audit also called for `rel="noreferrer noopener"` on `target="_blank"` attribution links (S-09 — turned out to be a non-issue, see below).

**How it was resolved:**

- **S-01 (Permissions-Policy):** Added a structured-syntax `Permissions-Policy` header to the security-headers middleware ([main.py:294](../../backend/main.py#L294)). 25 powerful APIs denied; `geolocation=(self)`, `fullscreen=(self)`, and `web-share=(self)` are scoped to the same-origin frame so the existing client features keep working. Future XSS or compromised dependency loses every other API surface.
- **S-02 + S-06 (stop / community-area echo):** Replaced `f"'{stops[i]}'"` with `f"Stop {i + 1}"` in /route error messages (two sites — 422 outside-Chicago and 400 not-found). The frontend already knows what the user typed (it's in the input field); the response just carries the stop_index. The community-area error now reads "Unknown community area." without echoing the requested string.
- **S-03 (`/autocomplete` boundary check):** `q` is now `Query(..., max_length=200)`, `limit` is `Query(8, ge=1, le=20)`. Starlette rejects oversize requests before the handler body runs. Kept the body-level checks as a belt-and-braces guard for test fixtures that pass the args directly.
- **S-04 (isfinite precheck):** Added `math.isfinite()` checks on lat/lon in both `ExploreOrigin._exactly_one_mode` and `/reverse-geocode`. Without this, a NaN coord fails the bbox check with a misleading "outside coverage area" message; with it, the response reads "lat and lon must be finite numbers."
- **S-05 (HEAD method):** CORS `allow_methods` now lists `["GET", "HEAD", "POST", "OPTIONS"]` explicitly. FastAPI implicitly accepted HEAD anyway, but the explicit declaration documents the intent and survives a future allowlist tightening.
- **S-09 — non-issue.** `grep -rn 'target="_blank"' frontend/src` returned no matches. The audit's concern applied to a class of components that don't exist in this codebase (attribution links live in copy text without `target` attributes).

**Acceptance:** `pytest backend/tests/` → **323 passed (323)** in 21s. `curl -I /health` shows `Permissions-Policy:` in the response headers.

---

### 2026-05-24 · PWA + service worker + screenshot resilience (TD-066)

**Files:** `frontend/src/lib/fetchWithTimeout.js`, `frontend/src/hooks/useShareCard.js`, `frontend/src/App.jsx`, `frontend/vite.config.js`.

**Priority:** 🟢 Low.

**What the debt was:** Four small resilience + observability gaps catalogued in the 2026-05-23 audit. `useShareCard` dynamic-imported `modern-screenshot` with no timeout, so a slow CDN or service-worker miss on a flaky connection could hang the share modal indefinitely waiting for chunk bytes (F-26). The three fetch timeouts (5 s / 10 s / 12 s) lived in `fetchWithTimeout.js` and `autocompleteApi.js` with no documented rationale — future tuners would have no way to know which budget could move (F-27). The SW lifecycle (`onNeedRefresh`, accept callback, etc.) emitted no breadcrumbs, so a user reporting "the update banner didn't show" had no console signal to share (F-22). And the Workbox `runtimeCaching` whitelist only covered `/route` + `/health`; `/explore`, `/autocomplete`, `/reverse-geocode` fell back to the default strategy (S-07). F-21 — externalizing the manifest from `vite.config.js` to a static file — was scoped optional and skipped; no concrete failure mode justifies the lift.

**How it was resolved:**

- **F-26 (screenshot import timeout):** Wrapped `import("modern-screenshot")` in `Promise.race` against a 5 s timeout in [useShareCard.js](../../frontend/src/hooks/useShareCard.js). The 5 s budget matches the adjacent map-render-race timeout — both are "the share-card flow gave up" budgets. On timeout the catch block surfaces the same error path as any other PNG capture failure (toast + leave the modal in an actionable state).
- **F-27 (fetch budget documentation):** Block comment at the top of [fetchWithTimeout.js](../../frontend/src/lib/fetchWithTimeout.js) documents why each budget is what it is — `/route` 10 s covers the greenest Dijkstra worst case; `/explore` 12 s adds 2 s of heatmap fan-in slack; `/autocomplete` 5 s kills stalled typeahead within ~33 keystroke generations.
- **F-22 (SW lifecycle telemetry):** Added breadcrumb `console.info` calls at each waypoint — registering, registered, needRefresh, offlineReady, register-error, apply-update. Console-only (no telemetry payload), but enough to diagnose silent failures from a user's pasted console snippet. The catch on the import promise also logs a benign info when running in non-PWA builds (tests/dev).
- **S-07 (SW caching whitelist):** Expanded the Workbox `runtimeCaching` regex in [vite.config.js](../../frontend/vite.config.js) to cover all five endpoints — `/(route|explore|autocomplete|reverse-geocode|health)` with `NetworkOnly`. Forward-compatible against a future Workbox upgrade that might start caching by default.
- **F-21 (manifest externalization) — skipped.** The catalog explicitly marked it optional. The inline manifest is generated correctly by `vite-plugin-pwa`; no env-override or custom-header use case justifies the lift today.

**Acceptance:** `npm test` → **470 passed (470)** in 20s. SW lifecycle telemetry visible in DevTools console under the `[sw]` prefix.

---

### 2026-05-24 · Frontend micro-perf — mapPadding rAF coalesce + theme MutationObserver retired (TD-065)

**Files:** `frontend/src/lib/theme.js`, `frontend/src/App.jsx`, `frontend/src/map/MapExploreLayer.jsx`.

**Priority:** 🟢 Low.

**What the debt was:** Two latent (not user-visible today) perf concerns that the catalog flagged as opportunistic. The bottom-sheet drag emitted `onObscuredChange` on every native pointermove sample (~60+ Hz), each call creating a new `mapPadding` object and forcing a setState that propagated through MapLibre's transform engine to recompute padding offsets per frame (F-19). `MapExploreLayer` learned about Cream / Dusk theme flips via a `MutationObserver` on `<html>`'s `class` attribute, bumping a `themeVersion` counter to invalidate paint-color memos — a lot of DOM-observation machinery for "did the theme change?" that coupled the paint layer to the side-effect of `applyTheme` writing to a class instead of a direct subscription (F-08).

**How it was resolved:**

- **rAF coalesce in `handleObscuredChange` ([App.jsx](../../frontend/src/App.jsx)).** Two new refs (`padRafTokenRef`, `pendingPadBottomRef`) collapse multiple pointermove samples within one paint frame into a single `setMapPadding` call. Trailing pointer value wins; clean-up on unmount cancels any pending RAF. The leading-edge guard (`if (padRafTokenRef.current !== null) return`) is what dedupes within a frame.
- **`useTheme()` subscription in [lib/theme.js](../../frontend/src/lib/theme.js).** Added a module-level `_subscribers` set and a `useTheme()` hook backed by `useSyncExternalStore`. `applyTheme` is the single write path — it notifies every subscriber after the class flip. Tearing across concurrent rendering is impossible because `useSyncExternalStore` guarantees the render-time snapshot matches what subscribers observe.
- **MapExploreLayer pivots from MutationObserver to `useTheme`.** The 17-line observer block (including OPT-060's rAF batching) collapses to a single `const themeVersion = useTheme()` call. The downstream `placeExpressions` memo's `[categoryStyles, themeVersion]` deps and the paint-update effect's `[themeVersion]` deps are unchanged — `themeVersion` is now a string ("cream"|"dusk") instead of an integer counter, but its only consumers compare-by-reference for invalidation, which works identically.

**Acceptance:** `npm test` → **470 passed (470)** in 19s. The MapExploreLayer no longer registers a `MutationObserver`; the sheet drag drives `setMapPadding` at most once per animation frame.

---

### 2026-05-24 · Frontend hygiene pass — MAX_STOPS dedupe + magic-number docs + reseedLocalInputs name (TD-064)

**Files:** `frontend/src/lib/recentSearches.js`, `frontend/src/mapHelpers.js`, `frontend/src/hooks/useTurnCoords.js`, `frontend/src/components/PersonalizeModal.jsx`.

**Priority:** 🟢 Low.

**What the debt was:** A hygiene pass over six minor findings. `MAX_STOPS = 8` was defined in both [urlParams.js](../../frontend/src/lib/urlParams.js) and [recentSearches.js](../../frontend/src/lib/recentSearches.js) — equal today, free to drift later (F-23). The `_METERS_PER_DEG_LAT = 111320` constant in [mapHelpers.js](../../frontend/src/mapHelpers.js) had no comment explaining why the canonical "round midpoint" is safe at Chicago latitude (F-29). The `useTurnCoords` two-phase array build worked correctly but the sparse-index-write pattern was unobvious (F-36). The PersonalizeModal effect that mirrored parent state into local inputs deliberately omitted its read deps (parent state) to avoid mid-typing clobber (BUG-011) — the comment explained the *what* but the catalog called for naming the helper `reseedLocalInputs` so a future reader can grep by intent (F-31). Two other findings (F-25 — unused EXPLORE_BUDGET exports; F-30 — undocumented 3-9 ft height range) turned out to be wrong: `ExploreForm.jsx` already imports both constants and the height range is already commented at the load and parse sites.

**How it was resolved:**

- **F-23 (MAX_STOPS dedupe):** [recentSearches.js](../../frontend/src/lib/recentSearches.js) now imports `MAX_STOPS` from [urlParams.js](../../frontend/src/lib/urlParams.js) and re-exports it for back-compat with any consumer that historically imported from `./recentSearches.js`. `urlParams.js` is the canonical source. `grep -rn "export const MAX_STOPS" frontend/src` confirms a single definition.
- **F-29 (`_METERS_PER_DEG_LAT` magic-number comment):** Block comment explains the WGS84 meridional radius range (~110.6 km at equator to ~111.7 km at poles), why 111320 is the canonical map-tile midpoint, and the error budget at Chicago latitude (~111.04 km, < 0.3% error, well below the 5 m dedup threshold's tolerance).
- **F-36 (useTurnCoords two-phase pattern):** Header comment names the phases — phase 1 walks path segments and may absorb 0..N thresholds per segment via sparse-index writes; phase 2 fills any leftover slots with the path's terminus. The sparse-index pattern is what makes the rounding-leftover handling possible.
- **F-31 (PersonalizeModal `reseedLocalInputs`):** Extracted the effect body into a named function `reseedLocalInputs`; block-comment at the function head documents the intentional dep omission rationale (BUG-011) in one place. The effect now reads as `useEffect(() => { if (!open) return; reseedLocalInputs(); }, [open, unit])`.
- **F-25 + F-30 (audit miscount — no edit):** Confirmed `EXPLORE_BUDGET_MIN` / `EXPLORE_BUDGET_MAX` are imported by [`ExploreForm.jsx`](../../frontend/src/components/ExploreForm.jsx) at four call sites. Confirmed `loadStoredHeightFt` ([personaPrefs.js:39](../../frontend/src/lib/personaPrefs.js#L39)) and `readUrlParams` ([urlParams.js:40](../../frontend/src/lib/urlParams.js#L40)) already comment the 3-9 ft / 36-108 in range. No action.

**Acceptance:** `npm test` → **470 passed (470)** in 31s. `grep -rn "export const MAX_STOPS" frontend/src` returns exactly one match.

---

### 2026-05-24 · Mobility profile prefer_pedestrian forced under Wheeled + follow-location mode gating (TD-063)

**Files:** `frontend/src/hooks/useRouteFetch.js`, `frontend/src/components/PersonalizeModal.jsx`, `frontend/src/hooks/useRouteFetch.test.js`, `frontend/src/components/PersonalizeModal.test.jsx`, `frontend/src/App.jsx`.

**Priority:** 🟢 Low.

**What the debt was:** Two small UX/perf tweaks. The Wheeled mobility profile's hint copy promised "stairs avoided and pedestrian ways preferred," but [useRouteFetch.js](../../frontend/src/hooks/useRouteFetch.js) only forced `avoid_stairs=true` — `prefer_pedestrian` was passed through as the user's setting (F-03). And [`useFollowLocation`](../../frontend/src/hooks/useFollowLocation.js) was always wired with `enabled: true`, so a follow session that survived a mode flip from Explore to Route kept its `watchPosition` subscription alive in a mode where the route-specific recenter logic already covers the same affordance (F-09).

**How it was resolved:**

- **`prefer_pedestrian` joins the forced set in [useRouteFetch.js](../../frontend/src/hooks/useRouteFetch.js).** New `effectivePreferPedestrian = isWheeled ? true : preferPedestrian` parallels the existing `effectiveAvoidStairs`. The persisted `walkpath:accessPrefs.preferPedestrian` value is left untouched so a flip back to Walking restores the user's saved choice.
- **PersonalizeModal mirrors the avoid_stairs UI treatment** for `prefer_pedestrian` (forced-checked + disabled when Wheeled). Resolves the visual mismatch where the hint promised an override the toggle didn't show. Updated [PersonalizeModal.test.jsx](../../frontend/src/components/PersonalizeModal.test.jsx) to assert the new disabled+checked state.
- **`useFollowLocation` gated on `mode === "explore"` in [App.jsx](../../frontend/src/App.jsx).** The `watchPosition` subscription tears down automatically on flip to Route mode. The hook's own `enabled` effect already implements the auto-stop; passing a mode-derived value to it is the minimum-impact way to bind follow to Explore conceptually.
- Updated [useRouteFetch.test.js](../../frontend/src/hooks/useRouteFetch.test.js) — replaced the "passes prefer_pedestrian through in both modes" assertion with two tests: one for the new forced-true case under Wheeled, one confirming Walking respects the user's setting.

**Acceptance:** `npm test` → **470 passed (470)** in 18s. Wheeled profile now visibly disables the prefer_pedestrian toggle; the request body always carries `prefer_pedestrian=true` under Wheeled regardless of the persisted access pref.

---

### 2026-05-24 · Frontend API-contract enums centralized + custom-flavor render + LocationIQ visual distinction + WF token validation (TD-060)

**Files:** new `frontend/src/lib/apiEnums.js`, new `frontend/src/wayfarer/tokens.test.js`, `frontend/src/components/RouteFlavorTabs.jsx`, `frontend/src/App.css`.

**Priority:** 🔴 High (C-01) / 🟡 Medium (rest).

**What the debt was:** Six findings from the 2026-05-23 audit. `FLAVOR_META` had no `"custom"` entry; the backend's collapsed-flavor response (sent when `avoid_stairs` or `prefer_pedestrian` is true) rendered as a literal `"custom"` string with no icon and the raw flavor key as the label (C-01). `places[].subcategory` / `address` null-coalescing in [MapExploreLayer.jsx](../../frontend/src/map/MapExploreLayer.jsx) was already in place from a prior change — confirmed `p.subcategory ?? ""` and `p.address ?? ""` at line 130/132 (C-03 was already paid). `places[].source` enum has no source→icon mapping and the audit suggested centralizing the contract values (C-04). Backend `pace` is an open string but frontend hardcodes the three-element `PACE_OPTIONS` list (C-10). LocationIQ supplements in the autocomplete dropdown were typographically identical to local-source rows — same color, same weight, same case (C-17). The `WF` token map in [primitives.jsx](../../frontend/src/wayfarer/primitives.jsx) referenced CSS custom properties (`var(--ink)` etc.) with no test guarding against a rename in [tokens.css](../../frontend/src/wayfarer/tokens.css) (F-32).

**How it was resolved:**

- **Centralized enums in [`frontend/src/lib/apiEnums.js`](../../frontend/src/lib/apiEnums.js).** Four frozen exports — `FLAVORS`, `PACES`, `PLACE_SOURCES`, `AUTOCOMPLETE_SOURCES` — that mirror the matching `models.py` types. Module docstring pins this as the single source of truth for the public-API contract values the frontend renders, with a note that new values land here first.
- **`custom` flavor entry added.** [RouteFlavorTabs.jsx](../../frontend/src/components/RouteFlavorTabs.jsx) now imports `FLAVORS` from `apiEnums.js`, declares a `FLAVOR_META.custom` entry (label "Custom", icon `crosshair`, detail "Tailored to your access prefs"), and a dev-only sanity check warns if any flavor in `FLAVORS` lacks a meta entry. The Wheeled-profile note path is untouched (single-flavor responses there still render the "Optimized for accessible routes" explainer rather than the tab list).
- **MapExploreLayer null-coalesce confirmed in place.** Already converting `null` to `""` for `address` and `subcategory` at the feature-properties stamp; left as-is with an inline comment so future readers don't re-add the same fix.
- **LocationIQ visual distinction in [App.css](../../frontend/src/App.css).** Added `.address-autocomplete-item-source--locationiq` styling — italic + a leading `· ` marker — to differentiate hosted-fallback suggestions from the local cascade's rows. The `aria-hidden="true"` source pill is unchanged so screen readers still hit the SOURCE_LABELS-mapped "external" string.
- **WF token validation test at [`frontend/src/wayfarer/tokens.test.js`](../../frontend/src/wayfarer/tokens.test.js).** Reads `tokens.css`, extracts every `--*` declaration, walks the `WF` map, and asserts every `var(--foo)` reference resolves. Catches the dangerous drift direction (`WF` references a token tokens.css no longer declares); new tokens land freely.
- **PaceSelector left alone.** The `PACE_OPTIONS` array already centralized the three pace strings — the values match `PACES` from `apiEnums.js`. Documented the linkage in the new module rather than restructuring the existing API.

**Acceptance:** `npm test` → **469 passed (469)** in 18s. The new tokens validation test ran clean (every WF reference resolves to a declared token).

Verification: `npm test` clean; `apiEnums.js` imported from [RouteFlavorTabs.jsx](../../frontend/src/components/RouteFlavorTabs.jsx); the `custom` flavor meta entry is present; LocationIQ rows in the autocomplete dropdown now render in italic with a `·` marker.

---

### 2026-05-24 · App.jsx state hygiene + Explore error boundary + a11y batch (TD-061 + TD-062)

**Files:** `frontend/src/hooks/useRouteFetch.js`, `frontend/src/hooks/useExploreFetch.js`, `frontend/src/hooks/usePersonalization.js`, `frontend/src/App.jsx`, `frontend/src/App.css`, `frontend/src/components/DirectionLedger.jsx`, new `frontend/src/components/ExploreErrorBoundary.jsx`.

**Priority:** 🔴 High (F-33, F-15) / 🟡 Medium (rest).

**What the debt was:** A cluster of state-correctness + accessibility issues clustered around `App.jsx` and its hooks. Recents could persist before validating the route response carried any actual routes (F-33). `exploreResult` + `exploreError` weren't cleared on a mode flip away from Explore — the next re-entry surfaced stale data before the fresh fetch landed (F-34). `userMovedSheetRef` never reset between modes, so a single drag in Route mode permanently disabled the auto-promote on subsequent mode flips into Explore (F-35). Share-link `hft` / `hin` only seeded personalization on mount; a second share link in the same session was silently ignored (F-37). `activeSubsSet` was the name of a memoized derived-visibility set that the codebase was treating as the source of truth — but the name said "set of active subs," not "the visible categories." (F-02). The frontend persisted user-typed stops to URL + recents rather than backend-normalized strings (C-14). Empty `directions` arrays left `DirectionLedger` with no "you arrived" footer (C-15). There was no `ErrorBoundary` around Explore mode (F-15), no focus management on mode flip (F-17), and the toast container was conditionally rendered which broke AT live-region binding (F-18).

**How it was resolved:**

- **F-33 + C-14 in [useRouteFetch.js](../../frontend/src/hooks/useRouteFetch.js):** Re-keyed both the URL params and `saveRecentSearch` off the backend's normalized `data.stops` when present (falls back to user-typed `cleanStops` on response-shape drift). Gated the recents write on `Array.isArray(data?.routes) && data.routes.length > 0` — a contract violation now silently no-ops rather than poisoning the chip strip.
- **F-34 in [useExploreFetch.js](../../frontend/src/hooks/useExploreFetch.js):** Extended the mode-flip effect to also clear `exploreResult`, `exploreError`, `exploreLoading`, abort any in-flight fetch, and null the `lastFetchedHeatmapsRef` cache when `mode !== "explore"`. The next re-entry now fires a fresh fetch with no ghost data.
- **F-35 + F-17 in [App.jsx](../../frontend/src/App.jsx):** Reset `userMovedSheetRef.current = false` inside the mode-change effect. Added a separate `useEffect` on `mode` that moves keyboard focus to the active mode's first input via `querySelector('input, [role="combobox"], [contenteditable]')`. `didMountModeFocusRef` skips the very first commit so a cold page load doesn't yank focus away from the browser's natural-focus target.
- **F-37 in [usePersonalization.js](../../frontend/src/hooks/usePersonalization.js):** Added a `popstate` listener that re-reads URL params via `readUrlParams()` and re-applies `hft` + `hin` when both are present (treating a single param as "no override" so we don't wipe the user's saved values on a back-nav to a route that originally had no height).
- **F-02 rename:** `activeSubsSet` → `visibleCategories` across `App.jsx` (definition + MapView prop). Added a doc comment pinning it as the single source of truth for "what's visible on the map right now."
- **C-15 in [DirectionLedger.jsx](../../frontend/src/components/DirectionLedger.jsx):** When `directions.length === 0`, render a `.directions-arrival--empty` footer reading "Proceed directly to destination" so the ledger surfaces a clear arrival cue rather than an empty list.
- **F-15 (Explore error boundary):** New [`ExploreErrorBoundary.jsx`](../../frontend/src/components/ExploreErrorBoundary.jsx) modeled on `RouteErrorBoundary` with an explore-specific error message ("Something went wrong drawing the explorer — try a different origin or time budget."). Wraps the form + result + category-panel subtree inside the memoized `exploreContents`.
- **F-18 (toast a11y):** Toast container is now always in the DOM (with a `.toast--empty` class that hides it visually via `visibility: hidden` + zero padding/border/animation when no message). `aria-atomic="true"` added so AT reads the whole message on each update. The previous conditional render destroyed + recreated the live region between announcements, which Safari/VoiceOver in particular won't reliably re-bind to.

**Acceptance:** `npm test` → **466 passed (466)** in 19s. The existing route-animation test that gates RAF calls on prefers-reduced-motion still passes because the focus effect runs synchronously in useEffect rather than scheduling a RAF.

Verification: `npm test` clean; `grep -rn activeSubsSet frontend/src` returns no matches; the new ExploreErrorBoundary file exists and is wired in both desktop and mobile branches via the memoized `exploreContents`.

---

### 2026-05-24 · Pydantic response models + standardized error shape (TD-052)

**Files:** `backend/main.py`, `backend/walking.py`, new `backend/models.py`, `backend/tests/test_main.py`.

**Priority:** 🔴 High.

**What the debt was:** Eight findings catalogued in the 2026-05-23 audit. The five `/health`, `/explore`, `/reverse-geocode`, `/autocomplete`, `/route` endpoints all returned hand-built dicts (`B-22` — no `response_model=` anywhere; OpenAPI schema inferred-and-incomplete; FastAPI did no response validation). Pydantic constraints were duplicated in docstrings (`B-23`). The `default_flavor` field on /route had no invariant guard pinning it to a member of the `routes[]` array — the frontend silently fell back to `routes[0]` on a mismatch (`C-08`). Error shapes drifted across endpoints — `/reverse-geocode` and `/autocomplete` raised `HTTPException(detail="bare string")` while `/route` raised `HTTPException(detail={"message": ..., "stop_index": ...})` (`C-09`). `walk_paths_alternatives` had no return-type annotation (`C-11`). The response fields `step_length_inches` and `personalized_calories` were emitted but unused by the frontend (`C-12` / `C-13`). And `/reverse-geocode` lacked a response model entirely (`C-16`).

**How it was resolved:**

- **New [`backend/models.py`](../../backend/models.py)** defines every response model: `HealthResponse`, `ReverseGeocodeResponse`, `AutocompleteSuggestion` + `AutocompleteResponse`, `ExplorePlace` + `ExploreStats` + `ExploreResponse`, `DirectionStep` + `LegStats` + `RouteAlternative` + `RouteResponse`, and the shared `ErrorDetail` error payload. `Coord` is a list-of-floats alias (Pydantic v2 accepts the cached tuples from `walking.py` and serializes them as JSON arrays — no rebuild cost). GeoJSON geometries land as `dict[str, Any]` rather than a fully-modelled GeoJSON tree; the spec is well-known and the heatmap shapes vary across endpoints (MultiPolygon vs FeatureCollection vs `null`), so a tighter model would add brittleness without catching real bugs.
- **`response_model=` wired on all five endpoints** in [`backend/main.py`](../../backend/main.py). FastAPI now serializes responses through Pydantic, validates field types, and exposes the full OpenAPI schema at `/openapi.json` — confirmed: schema's `components.schemas` lists all 12 response models plus the two FastAPI built-ins (`HTTPValidationError`, `ValidationError`).
- **`ErrorDetail` standardization via `http_error()` helper.** New helper at [`main.py:38`](../../backend/main.py#L38) wraps `HTTPException` so every raise lands the unified `{detail: {message, stop_index?}}` shape. Replaced 8 raise-sites across `/reverse-geocode`, `/autocomplete`, `/explore`, and `/route`. The frontend's [`apiErrorMessage.js`](../../frontend/src/lib/apiErrorMessage.js) already handled both shapes (TD-041 reconciliation), so unifying the backend is forward-compatible with no UI change required.
- **C-08 default_flavor invariant.** New `assert_default_flavor_in_routes` helper in `models.py`. The `/route` handler calls it on both the 2-stop and multi-stop branches before returning. Three new tests (`tests/test_main.py::TestDefaultFlavorInvariant`) cover the happy path, mismatch, and empty-routes cases — the mismatch test is the deliberately-broken acceptance check.
- **`walk_paths_alternatives` return-type annotation.** New `RouteAlternativeDict` TypedDict in `walking.py` documents the cached-route shape. TypedDict (not Pydantic) intentionally — callers consume the dict directly through the LRU cache; constructing Pydantic instances at that boundary would pay an avoidable allocation cost per request.
- **`step_length_inches` + `personalized_calories` kept, documented.** Both are marked as "informational — not currently consumed by the UI" in the model's `Field(description=...)`. Dropping them would be a contract-breaking change for any external consumer, and the catalog explicitly listed "document" as the alternative.

**Acceptance:** `pytest backend/tests/` → **323 passed** (320 baseline + 3 new C-08 tests). OpenAPI schema at `/openapi.json` lists all five paths and all response models. The C-08 broken-test case (`TestDefaultFlavorInvariant::test_helper_raises_on_mismatch`) fires `AssertionError` as designed.

**Wave 3 unblock:** TD-052 was the hard-dep keystone for Wave 3 — its resolution unblocks the partial TD-060 + TD-061 dependencies (frontend enum centralization + recents-keyed-off-normalized-stops + arrival-footer-when-directions-empty). The roadmap's gating notes have been struck accordingly.

Verification: `pytest -q` → 323/323; manual OpenAPI inspection via `TestClient.get("/openapi.json")` confirmed schema completeness; 320-baseline + 3-new test count documented in the commit.

---

### 2026-05-24 · Documentation drift sweep — README canopy + source enum, MOBILE_TESTING tracked, PV classifier, FEATURE_PLANS template (TD-046)

**Files:** `README.md`, `.gitignore`, `docs/MOBILE_TESTING.md` (newly tracked), `docs/Pending_Verification.md`, `docs/FEATURE_PLANS.md`.

**Priority:** 🟡 Medium (with one 🔴 High finding inside — README `/explore` enum drift).

**What the debt was:** Five drift surfaces catalogued in the 2026-05-23 audit. README still described tree canopy as "OSM `natural=tree` baked into a 50 m KDE grid" across five sites after the 2026-05-19 TD-033 pivot to the NLCD Tree Canopy Cover 2021 raster (100 m output grid). The `/explore` `source` enum listed three values; CLAUDE.md and runtime emit eight. `.gitignore:62` blocked `docs/MOBILE_TESTING.md` from the repo while CLAUDE.md, README, the `.env.example`, the dev-tunnel script, and four other docs referenced it as committed. `Pending_Verification.md` lacked a triage signal distinguishing "feature is non-functional until verification" from "feature is live; verification confirms real-world behavior." `FEATURE_PLANS.md`'s entries already followed a consistent shape but the shape wasn't documented anywhere, so future entries could drift.

**How it was resolved:**

- **README tree-canopy reconciliation (5 sites).** Updated the Status bullet ([README.md:15](../../README.md#L15)), the Features bullet ([README.md:47](../../README.md#L47)), the project-tree comment ([README.md:96](../../README.md#L96)), the build-script comment ([README.md:112](../../README.md#L112)), and the `/explore` description ([README.md:366](../../README.md#L366)) to describe NLCD TCC 2021 / 100 m / ~2.7 MB. Kept a one-clause historical reference ("pivoted from OSM `natural=tree` to NLCD on 2026-05-19") so the lineage is discoverable from the README alone.
- **README `/explore` `source` enum.** Updated [README.md:435](../../README.md#L435) from three values to the full eight (`osm`, `cpl_locations`, `farmers_markets_2013`, `cps_schools`, `cpd_stations`, `cfd_stations`, `cdp_divvy`, `cdp_landmarks`) to match CLAUDE.md and runtime. Also updated the canopy clause in the same paragraph from "baked from OSM `natural=tree` nodes" to "block-averaged from the NLCD Tree Canopy Cover 2021 raster."
- **MOBILE_TESTING.md tracked.** Removed `docs/MOBILE_TESTING.md` from [.gitignore](../../.gitignore) (the file is referenced from 11 places across CLAUDE.md, README, `.env.example`, `dev-tunnel.mjs`, four PV entries, FEATURE_HISTORY, FEATURE_PLANS, and Technical_Debt — clearly meant to be tracked, not personal documentation). The doc contains no secrets — public-knowledge `cloudflared` install commands + a security-caveat block for the dev tunnel. `git check-ignore` confirms the file is now trackable.
- **PV classifier convention.** Added a `Classifier:` line to all 14 entries in [`Pending_Verification.md`](../../docs/Pending_Verification.md): `blocks-ship` means the feature is **non-functional for end users** until verification completes (PV-007 Divvy ingest, PV-009 El/Metra ingest, PV-010 coffee subcategory ingest, PV-012 pickle-rotation operator step), and `post-ship` means the feature is live + functional and verification confirms real-world behavior on hardware / in production (the remaining ten). The convention paragraph at the top of the file defines the terms.
- **FEATURE_PLANS template.** Added an explicit "Entry Template" section at the top of [`FEATURE_PLANS.md`](../../docs/FEATURE_PLANS.md) documenting the de-facto shape every entry already followed (Type / Effort / Area · Depends on · Why · Chunks · Files likely touched · Open questions · Definition of done). Also documented the lighter shape used by Unscoped Notes (Problem / Rough idea / Why this needs scoping / Next step) so a graduating note has a clear upgrade path.

**Acceptance:** the audit's listed acceptance was "diff the doc claims against `backend/places.py:87` and `backend/tree_canopy.py` constants and find no mismatches" — verified by re-grepping `natural=tree`, `50 m`, and `50 m KDE` in README and finding only the historical-reference clause on line 15. The eight-value `source` enum now matches the runtime emit set.

Verification: `grep -n "natural=tree\|50 m KDE\|50m KDE\|50 m OSM" README.md` returns only the one historical reference. `git check-ignore docs/MOBILE_TESTING.md` returns exit 1 (not ignored). Each of 14 PV entries carries a `Classifier:` line. FEATURE_PLANS.md opens with an Entry Template section.

---

### 2026-05-24 · `scripts/dev-tunnel.mjs` tracked in the repo (TD-047)

**Files:** `.gitignore`, `scripts/dev-tunnel.mjs` (newly tracked).

**Priority:** 🟡 Medium

**What the debt was:** [`scripts/dev-tunnel.mjs`](../../scripts/dev-tunnel.mjs) — the Cloudflare-tunnel orchestrator that backs `npm run dev:tunnel` for real-device mobile testing — was documented in CLAUDE.md and README.md as present, but never actually tracked in git. `frontend/package.json` carried `"dev:tunnel": "node ../scripts/dev-tunnel.mjs"`, so a fresh clone produced a module-not-found error. Root cause: `.gitignore:77` ignored `/scripts/` wholesale to keep `scripts/explore_smoke.json` (a transient smoke-test fixture) private, and gitignore's "can't un-ignore a file under an ignored directory" rule meant the orchestrator quietly stayed out of the index alongside it.

**How it was resolved:**

- Reshaped the [`.gitignore`](../../.gitignore) rule from `/scripts/` to `/scripts/*` so contents (not the directory) are ignored, then added a `!/scripts/dev-tunnel.mjs` negation. `git check-ignore` confirms `dev-tunnel.mjs` is now trackable while `explore_smoke.json` remains blocked.
- Added [`scripts/dev-tunnel.mjs`](../../scripts/dev-tunnel.mjs) to the index. The existing script is already cross-platform: it resolves `cloudflared` from `winget` + Homebrew fallback paths, picks `python` vs `python3` per `process.platform`, and bypasses `npm.cmd` (Node ≥ 20 CVE-2024-27980 hardening on Windows) by spawning Vite's JS entry directly via `process.execPath`. Tears down all four child processes on SIGINT/SIGTERM and removes `frontend/.env.local` so a subsequent `npm run dev` doesn't pick up a stale tunnel URL.
- **No doc changes needed.** CLAUDE.md and README.md already document the script as present (which the audit caught as inaccurate); tracking the file makes those references accurate without further editing.

**Acceptance:** `npm run dev:tunnel` resolves to a tracked file on a fresh clone (catalog acceptance was "either works cleanly or no longer exists in `package.json`" — went with the former, which is what users want).

Verification: `git check-ignore scripts/dev-tunnel.mjs` returns exit 1 (not ignored); `git check-ignore scripts/explore_smoke.json` returns exit 0 (still ignored). Script itself unchanged from the developer's local copy that's been used through Wayfarer Phase 1.

---

### 2026-05-19 · Tree canopy data source pivoted from OSM Overpass to NLCD TCC 2021 raster (TD-033)

**Files:** `backend/scripts/build_tree_canopy.py` (rewrite), `backend/requirements-dev.txt`, `backend/data/tree_canopy_kde.json` (regenerated), `backend/street_graph_igraph.pkl` (rebaked), `backend/.env` (SHA rotated), `CLAUDE.md`.

**Priority:** 🟢 Low

**What the debt was:** Feature 2 (Tree Canopy Heatmap) shipped against OpenStreetMap `natural=tree` nodes via Overpass — a ~30k-point dataset that clusters in Grant/Millennium Park where OSM mappers are most active and leaves dense residential canopy (Lincoln Park, Pullman, Beverly) reading sparse. The signal was "where have OSM mappers been" rather than true canopy fraction. The TD-033 resolution path called for pivoting to NLCD Tree Canopy Cover — a national 30 m raster of canopy fraction — keeping the runtime (`tree_canopy.py`), response field, and frontend layer unchanged.

**How it was resolved:**

- Rewrote [`backend/scripts/build_tree_canopy.py`](../../backend/scripts/build_tree_canopy.py) to fetch the NLCD TCC 2021 CONUS raster from MRLC's GeoServer WCS endpoint (`mrlc_download__nlcd_tcc_conus_2021_v2021-4`) instead of running Overpass. The fetch + bake is now a single sub-3-second pipeline: one GeoTIFF download per chunk → Pillow decode → 2-D numpy histogram of native pixels into the output grid via `np.bincount`. No KDE smoothing — NLCD is already a smoothed canopy product.
- **Chunked fetch**: requesting the full Chicago bbox in one shot trips a silent MRLC server quirk that zeroes out everything east of about longitude -87.65 (Lincoln Park, Hyde Park, Jackson Park, lakefront all read 0). Splitting into three longitudinal chunks (`CHUNK_COUNT = 3`) sidesteps it — each chunk stays under 0.15° wide. The bake accumulates per-cell sums + counts directly into the shared output grid, so chunk boundaries don't seam.
- **Departures from the TD spec:**
  - Used **MRLC's WCS** rather than the USFS RDW ImageServer originally suggested in the resolution plan. The USFS service at `imagery.geoplatform.gov/iipp/.../USFS_EDW_NLCD_TCC_CONUS` was investigated but `/exportImage` always applies server-side symbology — the raw 0-100 pixel values are reachable only via per-point `/identify` (~1.5 M HTTP calls for Chicago at 50 m, infeasible). MRLC's WCS returns the raw single-band U8 GeoTIFF in one HTTP call. Same underlying NLCD TCC product; MRLC ships through the 2021 v2021-4 release, USFS through 2023.
  - **Output grid is 100 m, not 50 m** as the TD requested. NLCD's signal is uniformly real (not OSM-sparse), so a 50 m grid landed at 10.8 MB / 229k cells — 20× the previous size and 6× the largest other checked-in artifact. 100 m brings it back to ~2.7 MB / ~56k cells, which keeps the repo's data-artifact norms intact. After the runtime's `unary_union` step the heatmap polygons are visually indistinguishable at typical zoom levels between 50 m and 100 m squares.
  - **Density semantics shifted from "max-normalized OSM count" to "raw NLCD canopy fraction"**. The runtime's band thresholds (`low` 0.05 / `mid` 0.15 / `high` 0.40) coincidentally remain sensible — 5% / 15% / 40% canopy fraction is a meaningful light/medium/dense classification — so the runtime didn't need to change. The current artifact splits 60% / 27% / 12% across the three bands with max density 0.91.
- Added `Pillow>=10.0,<12` to [`backend/requirements-dev.txt`](../../backend/requirements-dev.txt) (ingest-only dep — runtime doesn't touch it).
- Regenerated [`backend/data/tree_canopy_kde.json`](../../backend/data/tree_canopy_kde.json) (2.66 MB, 56,001 cells, `source: nlcd_tcc_conus_2021`, `cell_size_m: 100`).
- **Re-baked [`backend/street_graph_igraph.pkl`](../../backend/street_graph_igraph.pkl)** so the FEAT-4 per-edge `tree_canopy_score` reflects the new NLCD values (the TD anticipated this — the bake samples the canopy artifact at edge midpoints during pickle build). New bake stats: 39.6% of edges non-zero canopy (was 47.1% under OSM), mean 0.054, max 0.894. Park-proximity column unchanged (its source artifact didn't move).
- **Rotated `STREET_GRAPH_SHA256`** in local [`backend/.env`](../../backend/.env) to the new pickle digest (`415d8be872887b6e0cfc3456954c26101d420584726aed0ae309d50e948b3eba`) per SEC-001. **Production deploy chain still needs to follow** — upload the new `.pkl` to the `street-graph` GitHub release tag and rotate `STREET_GRAPH_SHA256` in the Railway service variables before the next deploy, per the runbook in CLAUDE.md "Pickle integrity check (SEC-001)".
- Updated CLAUDE.md "Tree canopy heatmap" bullet, the API doc for `tree_canopy_heatmap`, the file-listing comment, and the `tree_canopy.py` one-liner to describe the NLCD source. The MRLC chunking quirk is documented inline so a future maintainer doesn't waste time trying to simplify it back to a single request.

**Acceptance notes** — the TD's original acceptance criterion was "Lincoln Park reads dense, Pullman reads sparse, Grant Park stays dense." Spot-checking the new artifact: forest preserves (LaBagh Woods) and leafy residential (Beverly, Pullman) light up clearly across mid/high bands, Loop and industrial corridors (Goose Island) read low/sparse, and the eastern coverage gap (Lincoln Park, Hyde Park, Jackson Park) that the chunked fetch fixed now reads as moderate canopy. The TD acceptance had a typo (it described Pullman as "sparse" while the description correctly listed Pullman as a place OSM under-served and NLCD should over-serve); reality landed on the description's side — Pullman reads moderate-to-dense under NLCD.

Verification: `pytest tests/test_tree_canopy.py tests/test_walking_greenest.py` → **21/21 passing**. Broader sample (`pytest tests/test_tree_canopy.py tests/test_walking_greenest.py tests/test_explore.py tests/test_main.py tests/test_parks.py tests/test_green_space.py`) → **93 passed, 1 skipped**.

---

### 2026-05-18 · Inline-style → CSS-class migration (TD-035 active entry, partial — ShareDispatch deferred to TD-044)

**Files:** `frontend/src/components/{ErrorDispatch,RouteFlavorTabs,WeeklySummaryPanel}.jsx`, `frontend/src/wayfarer/{primitives,forms}.jsx`, `frontend/src/App.css`; new `frontend/src/wayfarer/components.css` (imported from `wayfarer/index.css`).

**Priority:** 🟢 Low

*(Note on ID: this is the inline-style migration entry that was active in `Technical_Debt.md` — distinct from the 2026-05-13 backend-helpers TD-035 above. The ID was reused; the active entry has been replaced with TD-044, which scopes the remaining work narrowly.)*

**What the debt was:** Two Wayfarer primitives and seven feature components carried their static styling in JSX `style={{ ... }}` blocks (~33 occurrences across the in-scope files). The production CSP therefore had to allow `style-src 'self' 'unsafe-inline'`. Originally surfaced as SEC-007 on 2026-05-13 and reclassified to tech debt because the practical risk is bounded by the SHA-256-hashed `script-src` from SEC-005 — inline-style XSS without a script foothold is limited to CSS-selector exfiltration.

**How it was resolved:**
- Added [`frontend/src/wayfarer/components.css`](../../frontend/src/wayfarer/components.css) (imported from `wayfarer/index.css`) holding `.wf-sheet`, `.wf-sheet-handle`, `.wf-sheet-handle-bar`, `.wf-sheet-handle-rule`, `.wf-sheet-body`, `.wf-check`, `.wf-check__box`, `.wf-check__label`, `.wf-radio`, `.wf-radio__ring`, `.wf-radio__dot`, `.wf-radio__label`, and the matching visually-hidden `__input` rules. Dusk theme gets a darker `box-shadow` override on `.wf-sheet`.
- Added `.error-dispatch{,-label,-body,-retry}`, `.route-flavor-wheeled-note`, `.route-flavor-tablist`, `.route-flavor-tab{,--compact,--active}`, `.route-flavor-tab__{label,stats}`, `.weekly-summary-toggle-{meta,summary}`, `.weekly-summary-chevron-svg{,--open}`, `.weekly-summary-pct`, and `.weekly-summary-footer-row` to [`App.css`](../../frontend/src/App.css).
- Migrated [`ErrorDispatch.jsx`](../../frontend/src/components/ErrorDispatch.jsx) (4 → 0 inline styles), [`RouteFlavorTabs.jsx`](../../frontend/src/components/RouteFlavorTabs.jsx) (5 → 1 dynamic — `gridTemplateColumns: repeat(${routes.length}, 1fr)`), [`WeeklySummaryPanel.jsx`](../../frontend/src/components/WeeklySummaryPanel.jsx) (6 → 1 dynamic — the existing goal-bar `width: ${weeklyPct}%`), [`primitives.jsx`](../../frontend/src/wayfarer/primitives.jsx) WFSheet (5 → 1 dynamic block carrying `height` + `transform: translateY(...)` + `transition` + the caller-supplied `...style` spread), and [`forms.jsx`](../../frontend/src/wayfarer/forms.jsx) WFCheck/WFRadio (9 → 2 caller-`...style` spread slots only).
- Three other files (LoadingSkeleton, StepHero, ExploreCategoryPanel) were audited and left alone — their inline styles are fully dynamic (component props, per-category color swatches, computed goal-bar widths). The TD acceptance explicitly excluded "dynamically-computed properties (animation transforms, MapLibre paint hex values)."
- The CSP `style-src` was deliberately **not** tightened in this PR: ShareDispatch still carries ~30 inline-style blocks (held back from this migration because its share-card PNG export is visually load-bearing and warrants a baseline-and-diff loop, not a blind refactor). The remaining work — including the `style-src 'self'` flip — is tracked as **TD-044** in [Technical_Debt.md](../Technical_Debt.md).

Verification: `npm test` → **297/297 passing** (no new tests added; the WFSheet test suite asserts `sheet.style.height` against the still-inline dynamic height and still passes). `npm run build` clean. Built `dist/index.html` correctly still carries `style-src 'self' 'unsafe-inline'` — the CSP tightening is gated on TD-044.

---

### 2026-05-13 · Backend tech-debt batch — routing helpers, heatmap clipper, requirements (TD-035, TD-036, TD-037)

**Files:** `backend/walking.py`, `backend/parks.py`, `backend/green_space.py`; new `backend/heatmap_clipper.py`; deleted `backend/requirements-test.txt`.

**Priority:** 🟡🟢🟢 (Medium / Low / Low)

**What the debt was:** Three backend items from the 2026-05-13 backend scan. **TD-035** — `walking.py` carried three helpers (`_path_coords_from_path`, `_directions_from_path`, `_build_path_and_directions`) that walked the same `(vpath, epath)` and produced overlapping outputs; the geometry-decode + run-merging blocks were line-for-line duplicates with concrete drift risk on any future tweak to cardinal-bearing or block-type logic. **TD-036** — the `STRtree → prep+intersect → group-and-union → emit FeatureCollection` pipeline was reimplemented in `places.py`, `parks.py`, `green_space.py`, and `tree_canopy.py` with ~80% identical surrounding boilerplate. **TD-037** — `requirements-dev.txt` and `requirements-test.txt` listed overlapping but conflicting pytest pins (`<10` vs `<9.0`), and the test-only file was missing `pytest-asyncio` and `freezegun`, so a fresh `pip install -r requirements-test.txt` produced a non-runnable test env.

**How it was resolved:**
- **TD-035:** Deleted `_path_coords_from_path` and `_directions_from_path` outright. Rewrote `_build_path` and `_build_directions` to call `_build_path_and_directions(vpath, epath)` and pick the half they need; the haversine-fallback branches in both helpers retained inline. Updated the `_build_path_and_directions` docstring to record that it is now the sole `(vpath, epath) → (coords, directions)` builder. ~150 lines removed from walking.py; `test_walking_path_alt_routes` and the route-endpoint integration tests cover the affected paths.
- **TD-036:** Added `backend/heatmap_clipper.py` exposing two primitives — `load_polygon_rings(entries, ring_key="ring")` (lazy ring-parse with `buffer(0)` repair and dropped-degenerate filter, returning `(polys, valid_indices)` so callers can project parallel metadata) and `clip_polygons_to_feature_collection(polygon, *, polys, tree, group_key, properties_for)` (the full clip → group-by-key → union → strip-GeometryCollection → emit-FeatureCollection pipeline). `parks.py` and `green_space.py` rewrote to thin wrappers — each now owns only its JSON shape + grouping key. `places.residential_heatmap` and `tree_canopy.tree_canopy_in_polygon` were deliberately left as-is — residential returns a raw unioned MultiPolygon (different output shape) and tree canopy clips synthesized cell squares from point centroids (different geometry primitive); folding either through the shared helper would add more conditional plumbing than the duplication it removes.
- **TD-037:** Deleted `backend/requirements-test.txt`. `requirements-dev.txt` is now the sole test-environment manifest. Confirmed no CI workflows (none exist), no `Dockerfile`, no `railway.toml`, and no scripts reference the deleted file. The `.dockerignore` line for `requirements-test.txt` was left in place — it's harmless and guards against a future re-creation accidentally being copied into the prod image.

Verification: backend `python -m pytest -q` → **217 passed, 1 skipped** (no regression from the pre-batch baseline). All `test_parks.py`, `test_green_space.py`, `test_explore_endpoint.py` cases pass against the rewritten clip path; `test_walking_path_alt_routes` and `test_main` route-endpoint tests pass against the slimmed routing helpers.

---

### 2026-05-13 · Frontend lib/ tech-debt batch — coords, breakpoints, heatmap layers, API errors, tests, toast (TD-038, TD-039, TD-040, TD-041, TD-042, TD-043)

**Files:** `frontend/src/App.jsx`, `frontend/src/map/MapPickLayer.jsx`, `frontend/src/components/PaceSelector.jsx`, `frontend/src/components/RouteFlavorTabs.jsx`, `frontend/src/hooks/useRouteFetch.js`, `frontend/src/lib/{useMediaQuery,exploreApi,explorePrefs}.js`; new `frontend/src/lib/{coordsFormat,apiErrorMessage}.js`; new tests `frontend/src/lib/{fetchWithTimeout,exploreApi,autocompleteApi}.test.js`.

**Priority:** 🟢🟡🟡🟡🟡🟢 (mixed Low/Medium across the six items)

**What the debt was:** Six items surfaced in the 2026-05-13 frontend scan. **TD-038** — the display literal `` `${lat.toFixed(5)}, ${lon.toFixed(5)}` `` was repeated at six sites with no shared formatter, and the 5-vs-6-decimal split (display vs reverse-geocode URL) wasn't documented. **TD-039** — `(max-width: 480px)` and the 481–1023 px tablet query were hardcoded string literals at four call sites. **TD-040** — `handleToggleHeatmap` was an `if/else if` chain over the four heatmap keys, and `handleSelectAllCategories` / `handleClearAllCategories` enumerated the four `showXHeatmap` prefs by hand. **TD-041** — `exploreApi.js` and `useRouteFetch.js` each parsed the FastAPI `{detail: {message}}` envelope independently and emitted divergent 429 copy ("explorer is rate-limited" vs "geocoding service is rate-limited") for what is the same LocationIQ breaker. **TD-042** — `fetchWithTimeout.js`, `exploreApi.js`, and `autocompleteApi.js` (the entire network boundary) had zero direct test coverage. **TD-043** — the 3500 ms toast dismissal duration was inlined at two `setTimeout` sites in `App.jsx`.

**How it was resolved:**
- **TD-038:** Added `frontend/src/lib/coordsFormat.js` exporting `formatLatLonLabel(lat, lon, decimals = 5)`. Routed all six display-label sites in `App.jsx` and the one site in `MapPickLayer.jsx` through it. The 6-decimal reverse-geocode URL site (`App.jsx:568`) is intentionally left as an inline template literal since it's a request payload, not a display string; the new module's docstring explains the precision distinction.
- **TD-039:** Added `MQ_MOBILE`, `MQ_TABLET`, `MQ_DESKTOP` exports to `frontend/src/lib/useMediaQuery.js` (the canonical strings, with a comment cross-referencing the matching `App.css` media queries). `App.jsx`, `PaceSelector.jsx`, and `RouteFlavorTabs.jsx` now import the named constants.
- **TD-040:** Added `HEATMAP_LAYERS` (`[{ key, prefKey } × 4]`) to `frontend/src/lib/explorePrefs.js`. `handleToggleHeatmap` now does a `find` + a single dynamic-key set; `handleSelectAllCategories` / `handleClearAllCategories` loop over the constant via a shared `setAllHeatmaps(next, value)` helper. Adding a fifth heatmap is now a one-line catalog edit plus matching default + sanitize() branch in the prefs module.
- **TD-041:** Added `frontend/src/lib/apiErrorMessage.js` exporting `parseApiErrorMessage(response, serviceLabel?)`. Both `exploreApi.js` and `useRouteFetch.js` call it; both 429 fallbacks now route through the unified "Service is rate-limited — try again in a minute." copy (the optional `serviceLabel` parameter remains for callers that want to inject a service name, but neither current caller passes one, so the user-facing message is consistent across endpoints).
- **TD-042:** Added three Vitest files mocking `globalThis.fetch`: `fetchWithTimeout.test.js` covers happy-path resolution, timeout-triggered abort with fake timers, external-signal abort propagation, pre-aborted external signal, and timer cleanup; `exploreApi.test.js` covers both origin shapes, optional `categories`, structured `detail.message` extraction, the unified 429 message, non-JSON 5xx survival, and abort-signal composition; `autocompleteApi.test.js` covers the empty-query short-circuit, query trimming + limit serialization, suggestions parsing (including non-array bodies), non-OK status surfacing, and abort composition.
- **TD-043:** Hoisted `const TOAST_DURATION_MS = 3500` to module scope in `App.jsx` (with a comment explaining the two callers). Both `showToast` and the inline pick-on-map fallback toast now reference it.

Verification: `npm test -- --run` → **288/288 passing** (up from 267 — three new test files added 21 cases). `npm run lint` is clean for the touched files; one pre-existing `react/no-unescaped-entities` error on an unrelated `App.jsx` JSX block (`That spot doesn't connect…`) was left in place and is not introduced by this batch.

---

### 2026-05-12 · Rate-limit docs scrubbed to match unenforced reality (TD-033)

**Files:** `README.md`, `CLAUDE.md`, `docs/FEATURE_HISTORY.md`, `backend/tests/test_main.py`, `backend/tests/test_explore_endpoint.py`

**Priority:** 🟡 Medium

**What the debt was:** Both `CLAUDE.md` and `README.md` claimed per-IP rate limits (`/health 60/min · /reverse-geocode 30/min · /route 10/min · /explore 10/min`) tunable via `RATE_LIMIT_*` env vars, but `backend/main.py` had zero slowapi / `Limiter` / `@limiter` wiring — the env vars were inert and the endpoints accepted unlimited traffic. The test suites carried a dead `app.state.limiter.reset()` fixture left over from when slowapi had been wired.

**How it was resolved:** Scrubbed the doc claims rather than re-introducing slowapi (Railway's edge already meets the operator's threat model). Removed the "Rate limits (per IP, env-tunable)" line and the `RATE_LIMIT_*` env-var row from both README.md and CLAUDE.md, dropped the inaccurate "Rate-limited via `RATE_LIMIT_EXPLORE`" sentence from `docs/FEATURE_HISTORY.md`, and deleted the dead `_reset_rate_limiter` autouse fixtures from `backend/tests/test_main.py` and `backend/tests/test_explore_endpoint.py`. `.env.example` was already clean (no `RATE_LIMIT_*` entries). Confirmed `grep -rn "slowapi\|@limiter\|RATE_LIMIT_" backend/ CLAUDE.md README.md` returns zero matches; only historical references in `docs/archive/RESOLVED_HISTORY.md` remain, as expected.

---

### 2026-05-11 · Transitive npm audit highs (`@babel/plugin-transform-modules-systemjs`, `fast-uri`) cleared (2026-05-11 TD-028, TD-029)

**File:** `frontend/package-lock.json`

**Priority:** 🟡 Medium

**What the debt was:** Two transitive dev-only advisories were open: TD-028 against `@babel/plugin-transform-modules-systemjs` `>=7.12.0 <=7.29.3` ([GHSA-fv7c-fp4j-7gwp](https://github.com/advisories/GHSA-fv7c-fp4j-7gwp), CVSS 8.2) and TD-029 against `fast-uri` `<=3.1.1` ([GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6) + [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc), CVSS 7.5 each). Both were transitive through the Vite/Rollup/workbox toolchain and never reached the production bundle, but they kept `npm audit` red.

**How it was resolved:** Resolved transitively — no explicit `npm audit fix` run was needed. The `package-lock.json` refresh that came with the PWA-icons / `vite-plugin-pwa@1.2.0` work (commit `22f85fc`) pulled both deps onto fixed versions: `@babel/plugin-transform-modules-systemjs` is now `7.29.4` (advisory range was `<=7.29.3`) and `fast-uri` is now `3.1.2` (advisory range was `<=3.1.1`). Confirmed on 2026-05-11: `npm audit` reports `{ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }`; `npm ls` shows the upgraded versions via `vite-plugin-pwa@1.2.0 → workbox-build@7.4.0 → @babel/preset-env@7.29.2` and `→ ajv@8.18.0 → fast-uri@3.1.2`. No source changes; no test impact.

---

### 2026-05-11 · `html-to-image` swapped for `modern-screenshot` in share-card export (2026-05-11 TD-031)
*(Originally tracked as TD-009b during the in-flight session — renumbered to TD-031 to avoid colliding with two earlier reuses of the TD-009 ID elsewhere in this file. The companion items in the same omnibus split landed as TD-030 (maplibre v4 → v5, immediately below) and TD-032 (React 18 → 19, still open in [Technical_Debt.md](../Technical_Debt.md)).)*

**Files:** `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/hooks/useShareCard.js`

**Priority:** 🟡 Medium

**What the debt was:** `html-to-image` `1.11.13` powered the PNG export in `useShareCard.handleShareCard`. Last npm release was 2025-04-19 — over a year stale. `modern-screenshot` (a successor project from the same lineage of dom-to-canvas libraries) is actively maintained (last release ~3 weeks prior to resolution, zero deps, MIT) and explicitly markets better iOS Safari behavior, which directly intersects the existing iOS WebGL-backbuffer workaround in this code path.

**How it was resolved:** Decision was "swap" based on desk research (maintenance recency + drop-in API — couldn't device-test from this seat). `npm uninstall html-to-image && npm install modern-screenshot@^4.7.0`. In `useShareCard.js`, three line-level changes: dynamic import target `html-to-image` → `modern-screenshot`, destructured export `toBlob` → `domToBlob`, capture-options key `pixelRatio: 3` → `scale: 3` (same semantics, different name). The iOS map-snapshot `<img>` overlay was deliberately kept as defense-in-depth even though modern-screenshot is supposed to handle the WebGL clone better — it is cheap, well-understood, and removing it is a separate decision. All 204 Vitest tests pass; production build succeeds (`ShareDispatch` chunk unchanged at 5.49 KB / 1.82 KB gzip; modern-screenshot lazy-loads only when the share modal opens).

**Verification gap:** PNG visual parity (especially iOS Safari output and the printed `siteHost` strip rendering) was not exercised — same constraint as TD-030, no device available here. Manual smoke test required: open the share modal on a route in iOS Safari + Android Chrome, hit Share, confirm the map renders correctly in the exported PNG and the layout matches the current production output. If the export regresses, the rollback is a three-line revert.

---

### 2026-05-11 · `maplibre-gl` upgraded v4.7.1 → v5.24.0 (2026-05-11 TD-030)
*(Originally tracked as TD-009a during the in-flight session — renumbered to TD-030 to avoid colliding with two earlier reuses of the TD-009 ID elsewhere in this file. Companions: TD-031 (immediately above) and TD-032 (still open).)*

**Files:** `frontend/package.json`, `frontend/package-lock.json`

**Priority:** 🟡 Medium

**What the debt was:** `maplibre-gl` was pinned at `^4.7.1` while v5 had been GA for some time, carrying performance + WebGL2 work and the usual cost of staying current. TD-030 was the first slice of the former TD-009 omnibus (split into TD-030 / TD-031 / TD-032 on 2026-05-11) so the maplibre bump could land on its own — smallest blast radius of the three.

**How it was resolved:** Bumped the pin to `^5.24.0` and ran `npm install` (added 4, removed 16, changed 5 packages). No source changes were required — the public API surface used here (`new Map`, `new Marker`, `new Popup`, `setLngLat`, `addTo`, `getSource`, `addSource`, `addLayer`, `setPaintProperty`, `fitBounds`, `flyTo`, `scrollZoom/dragPan/dragRotate/doubleClickZoom/touchZoomRotate/keyboard.disable/enable`, `once/on/off`, `isStyleLoaded`, `triggerRepaint`, `resize`, `remove`, `getCanvas`) is unchanged between v4 and v5. The existing `vi.mock("maplibre-gl", ...)` in `test-setup.js` continued to satisfy every call site. All 204 Vitest tests pass; the production build succeeds (single maplibre chunk at 1,055 KB / 285 KB gzip). The two `npm audit` "high severity" advisories surfaced after install (`@babel/plugin-transform-modules-systemjs`, `fast-uri`) are transitive dev-only deps and not related to the maplibre upgrade — left untouched for separate handling.

**Verification gap:** WebGL paint behavior was not exercised — the test suite stubs maplibre entirely. Visual regressions (route polyline draw-in, explore polygon / heatmap / cluster paint, gesture lock/unlock, marker popups) need a manual iOS Safari + Android Chrome smoke test before this can be considered production-ready.

*Naming note: the references to "TD-028" / "TD-029" in the audit-findings entry immediately above were the originally-assigned IDs for the two transitive npm-audit advisories surfaced during this install; both resolved transitively in the same session via the `vite-plugin-pwa@1.2.0` lockfile refresh. The TD-009 → TD-030/031/032 renumber happened after that, so those IDs are unaffected.*

---

### 2026-05-07 · Dead Wayfarer specimen + unused primitives trimmed (2026-05-07 TD-013)

**Files:** `frontend/src/wayfarer/extra-plates.jsx` (deleted, 263 LOC), `frontend/src/wayfarer/extras.jsx` (deleted, 222 LOC), `frontend/src/wayfarer/primitives.jsx` (699 → 471 LOC), `frontend/src/wayfarer/forms.jsx` (162 → 70 LOC), `frontend/src/wayfarer/responsive.css`

**Priority:** 🟡 Medium

**What the debt was:** Phase 1 of the design-system migration finished without any production caller picking up most of the catalogue. `extra-plates.jsx` was 263 lines of `eslint-disable`d specimen documentation whose own header noted it referenced primitives the upstream system never shipped. `extras.jsx` (`WFTag`, `WFTabs`, `WFList`, `WFTooltip`, `WFModal`, `WFAvatar`, `WFProgress`) was only consumed by `extra-plates.jsx` — i.e. transitively dead. Inside `primitives.jsx`, twelve exports (`WFGrain`, `WFCaps`, `WFLamp`, `WFRule`, `WFDispatch`, `WFButton`, `WFPill`, `WFCard`, `WFMasthead`, `WFFooter`, `WFDropNumber`, `WFCompassMark`) had zero production reach; `forms.jsx`'s `WFField` / `WFInput` / `WFTextarea` / `WFSelect` were referenced only by the specimen. Tree-shaking kept it out of the bundle, but the source files cost reading time and made new contributors think the unused primitives were part of the supported API.

**How it was resolved:** Deleted `extra-plates.jsx` and `extras.jsx` outright. Trimmed `primitives.jsx` to its production-reached exports (`WF` token mirror, `WFFromMark`, `WFToMark`, `WFColophon` / `COLOPHON_TEXT`, `WFSheet` plus `decideSnap` / `resolveSnapPx` / `SHEET_VELOCITY_THRESHOLD` / `BODY_DRAG_DEADZONE_PX`); rewrote the file's `// Provides:` block to match what survives. Trimmed `forms.jsx` to `WFCheck` and `WFRadio`. Updated the orphaned modal-card comment in `responsive.css` (was "Overrides the inline styles in extras.jsx") to reference the live `.wf-modal-overlay` / `.wf-modal-card` classes used by `PersonalizeModal`. Total source removed: ~750 LOC. All 142 pre-existing tests pass; the 4 new `*.test.{js,jsx}` files added in TD-017 push the suite to 204.

---

### 2026-05-07 · `walkpath:*` localStorage literals centralized via `personaPrefs.js` save\* helpers (2026-05-07 TD-015)

**Files:** `frontend/src/lib/personaPrefs.js`, `frontend/src/App.jsx`, `frontend/src/components/PersonalizeModal.jsx`

**Priority:** 🟡 Medium

**What the debt was:** Most modules already centralized their `walkpath:*` storage keys behind dedicated load/save helpers (`recentSearches.js`, `stepLog.js`, `sheetSnap.js`, `theme.js`, `explorePrefs.js`). `personaPrefs.js` was the asymmetric outlier: it exposed `loadDailyGoal()`, `loadStoredHeightFt()`, `loadStoredHeightIn()`, `loadStoredWeightKg()`, `loadStoredPace()`, `loadAccessPrefs()` — but no corresponding `save*` companions, so `App.jsx` open-coded eight raw `safeSet("walkpath:heightFt", …)` / `safeRemove("walkpath:dailyGoal")` writes. The key string was duplicated between read and write sites, in violation of CLAUDE.md's "load-bearing prefix per migration" guidance. `PersonalizeModal.jsx` had its own `walkpath:weightUnit` read/write, the only persistence key not routed through `lib/`.

**How it was resolved:** Lifted every `walkpath:*` literal in `personaPrefs.js` to a module-level `*_KEY` constant and added matching `save*` companions: `saveDailyGoal`, `saveStoredHeightFt`, `saveStoredHeightIn`, `saveStoredWeightKg`, `saveStoredPace`, `saveAccessPrefs`. Added `loadWeightUnit` / `saveWeightUnit` to absorb the previously-orphaned `walkpath:weightUnit` read/write. Replaced the eight raw call sites in `App.jsx` (one per persisted pref's `useEffect`, plus the `handleGoalChange` callback) with the new helpers. Replaced `PersonalizeModal.jsx`'s direct `safeGet` / `safeSet` calls with `loadWeightUnit` / `saveWeightUnit`. Net effect: every `walkpath:*` literal lives in exactly one place, matching the rest of the codebase. The lone remaining literal in `App.jsx` is `STOPS_KEY = "walkpath:draftStops"`, which is sessionStorage state local to the component and intentional to keep colocated.

---

### 2026-05-07 · Inline-style boilerplate in DirectionLedger + CompareDispatch migrated to CSS classes (2026-05-07 TD-016)

**Files:** `frontend/src/components/DirectionLedger.jsx`, `frontend/src/components/CompareDispatch.jsx`, `frontend/src/App.css`

**Priority:** 🟢 Low

**What the debt was:** Two production components carried heavy inline `style={{…}}` payloads with hardcoded font sizes (8/9/10/11/12/13/14/22/26), letter-spacing values (1/1.5/2/2.5/3/4), font weights (600/700/800), and the same `fontFamily: "var(--wf-sans)"` / `"var(--wf-mono)"` / `"var(--wf-serif)"` boilerplate repeated across every span. The pattern was a hand-rolled "editorial caps + mono stat + italic body" type scale that already existed in CSS-class form for sibling components. A font-weight tweak in one place didn't propagate; theme overrides had to chase per-element inline style.

**How it was resolved:** Added 23 named classes to `App.css` (e.g. `.directions-section`, `.directions-heading-eyebrow`, `.direction-row`, `.direction-row--active`, `.compare-dispatch-eyebrow`, `.compare-dispatch-value`, `.compare-dispatch-impact-sep`) tied to the existing CSS-var token scale. Rewrote `DirectionLedger.jsx` (261 → 124 lines) and `CompareDispatch.jsx` (121 → 53 lines) to use those classes. `ShareDispatch.jsx` was deliberately left untouched — its inline styles are load-bearing for `html-to-image`'s clone path during PNG export, and rewriting them risks breaking the share-card export on iOS Safari. Total LOC removed from JSX: ~205. No visual change verified against the existing snapshot tests.

---

### 2026-05-07 · Critical lib/ modules gained direct unit tests (2026-05-07 TD-017)

**Files:** `frontend/src/lib/geolocation.test.js` (new, 12 cases), `frontend/src/lib/explorePrefs.test.js` (new, 14 cases), `frontend/src/lib/exploreCategories.test.js` (new, 6 cases)

**Priority:** 🟡 Medium

**What the debt was:** The frontend test suite covered App.jsx well via the re-export pattern, plus dedicated tests for `mapHelpers`, `WFSheet`, `walkpath-icons`, `MobileLayout`, `ShareDispatch`, `calorieEquiv`, `compareEstimates` — but several lib/ modules with non-trivial branching shipped untested. The two highest-impact gaps were `geolocation.js` (the entry point for both the route "📍 My location" button and the explorer's location origin: a regression silently sends out-of-area users to the backend, which returns 422) and `explorePrefs.js` (the persistence schema for explore mode: a migration mistake bricks the explore form on load).

**How it was resolved:** Added three new test files. `geolocation.test.js` mocks `navigator.geolocation` and covers all 12 branches (no-API, valid Chicago coord, four out-of-bbox edges, two south/north corner-exact accepts, non-finite coords, and the three `GeolocationPositionError` codes). `explorePrefs.test.js` exercises the round-trip path, corrupted-JSON fallback, wrong-shape fallback, `maxMinutes` clamping outside [5, 45], unknown-category-key stripping, unknown-sub-key stripping, default community-area fallback for unrecognized names, and the `kind: "current"` origin without lat/lon. `exploreCategories.test.js` is a structural-integrity sweep: unique group keys, unique category keys across all groups, every category appears in `CATEGORY_BY_KEY`, every pin category exposes a non-empty label/color/glyph, the `residential` heatmap-only category has the expected null-glyph shape, and `REQUESTABLE_CATEGORY_KEYS` excludes heatmap-only entries. Vitest count: 142 → 204.

---

### 2026-05-07 · Brittle `requestCategories.join("|")` effect-key replaced with stable memoised identity (2026-05-07 TD-018)

**File:** `frontend/src/App.jsx`

**Priority:** 🟢 Low

**What the debt was:** The category-selection re-fetch effect at App.jsx ~720 declared `[requestCategories.join("|")]` as its dep array. The `|` separator collision risk was real — a future category key containing a `"|"` character would silently merge into its neighbour and the effect would miss legitimate selection changes. The original justification (avoid spurious re-fires from a fresh array identity each render) was sound but the chosen workaround was the brittle one.

**How it was resolved:** `requestCategories` was already wrapped in a `useMemo` keyed on `explorePrefs.selectedCategories` and `explorePrefs.selectedSubs`, so its identity is stable across unrelated renders. Replaced the `.join("|")` dep with `requestCategories` itself. Updated the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment to spell out which deps are intentionally omitted (`exploreResult`, `fetchExploreResult`, `mode`) and why (the initial-fetch effect above already handles the mode flip). The other seven `eslint-disable-react-hooks/exhaustive-deps` directives in the codebase were left in place — each is individually justified by an inline comment, and removing them is a follow-up exercise that doesn't carry the same fragility.

---

### 2026-05-07 · Share-card lifecycle extracted from App.jsx into `useShareCard` hook (2026-05-07 TD-014)

**Files:** `frontend/src/hooks/useShareCard.js` (new), `frontend/src/App.jsx`

**Priority:** 🟡 Medium

**What the debt was:** Even after the prior 1,990 → 1,460-line cleanup, App.jsx had grown back to 1,573 lines and owned route mode + explore mode + share-card flow + pick-on-map + bottom-sheet snap orchestration + URL-param ingestion + recents + step log + PWA SW update banner + toast — exposed via 30+ state hooks and 18+ handler functions. The share-card lifecycle (~150 lines: modal open/close, Web Share capability probe, PNG capture via `html-to-image`, copy-link fallback, `shareUrl` / `siteHost` / `shareCaption` memos) was the cleanest extractable seam.

**How it was resolved:** Created `frontend/src/hooks/useShareCard.js`. Moved `showShareModal` / `cardMapReady` / `canWebShare` state, `cardRef` / `cardMapRef` refs, the `canShare`-probe `useEffect`, `shareUrl` / `siteHost` / `shareCaption` memos, and the `handleOpenShare` / `handleCloseShare` / `handleCardMapReady` / `handleShareCard` / `handleCopyShareLink` callbacks into the hook. The hook's surface takes `viewResult`, `stopValues`, `heightFt`, `heightIn`, `origin`, `destination`, `showToast` and returns the same names App.jsx previously held inline — so the JSX in the share modal is unchanged. App.jsx: 1,573 → 1,420 lines. Further extractions (a `useExploreMode` hook for the ~120-line explore-mode handler block, a `useSheetSnapOrchestrator` hook for the three sheet-snap auto-promote effects) are deferred — each has its own seams and merits its own session.

---

### 2026-05-06 · App.jsx 1,990-line monolith split across 6 lib modules + 4 components + 1 hook (2026-05-06 TD-001)

**Files:** `frontend/src/App.jsx`, `frontend/src/lib/{backendUrl,fetchWithTimeout,units,urlParams,personaPrefs}.js` (new), `frontend/src/hooks/useTurnCoords.js` (new), `frontend/src/components/{PaceSelector,StepHero,RecentSearches,RouteErrorBoundary}.jsx` (new), `frontend/src/App.css`

**Priority:** 🔴 High

**What the debt was:** Even after the earlier Phase 1 extractions, `App.jsx` still owned `normalizeBackendUrl` / `resolveBackendUrl` / `fetchWithTimeout`, URL param parsing, persisted-preference loaders, the `useTurnCoords` hook, `lbToKg`, an inline `PaceSelector` + `PaceSegmented`, an inline `StepHero`, an inline `RecentSearches` list, an inline `ErrorBoundary`, plus all route + explore fetch lifecycles, share-card capture, locate-me / pick-on-map state, and mobile-sheet snap auto-promotion — 1,990 lines total.

**How it was resolved:** Extracted six standalone modules (`lib/backendUrl.js`, `lib/fetchWithTimeout.js`, `lib/units.js`, `lib/urlParams.js`, `lib/personaPrefs.js`), one hook (`hooks/useTurnCoords.js`), and four components (`components/PaceSelector.jsx`, `components/StepHero.jsx`, `components/RecentSearches.jsx`, `components/RouteErrorBoundary.jsx`). `App.jsx` re-exports the symbols `App.test.jsx` imports (`lbToKg`, `loadDailyGoal`, `loadStoredPace`, `parseStopsParam`, `MAX_STOPS`, `PACE_LABELS`, etc.) so the existing 170-test suite still passes. Line count: 1,990 → 1,460. Several `<button>` blocks that had inline `style={{…}}` (the Personalize trigger, the route-submit button, the SW-update banner, the add-stop / swap inner clusters) gained named CSS classes (`.personalize-trigger`, `.btn-route`, `.sw-update-banner`, `.add-stop-btn-inner`, `.swap-btn-inner`) so the JSX reads as intent rather than typography.

---

### 2026-05-06 · Legacy `--color-green-*` CSS aliases retired (2026-05-06 TD-002)

**File:** `frontend/src/App.css`

**Priority:** 🟡 Medium

**What the debt was:** A `:root { --color-green-primary: var(--ink); … --transition-ui: …; }` aliasing block sat at the top of `App.css` with the comment *"Final cleanup deletes these aliases when every class is either extracted or restyled in place."* Six aliases (`--color-green-primary`, `--color-green-light`, `--color-green-pale`, `--color-bg-darkest`, `--color-border-dark`, `--transition-ui`) remained in 18 places, kept alive by holdover selectors that the Wayfarer migration had already made dead.

**How it was resolved:** Deleted the `:root` aliasing block. Replaced every `var(--transition-ui)` call site with the literal `transition: background 0.15s, border-color 0.15s` it expanded to. The remaining `--color-border-dark` / `--color-green-*` references were all inside the dead selectors removed in TD-003.

---

### 2026-05-06 · Dead CSS for the pre-Wayfarer Masthead and inline-swap layout (2026-05-06 TD-003)

**File:** `frontend/src/App.css`

**Priority:** 🟡 Medium

**What the debt was:** The Masthead component lives in [`components/Masthead.jsx`](../../frontend/src/components/Masthead.jsx) so `.header`, `.header-top`, `.app-title`, `.app-title-icon`, `.city-pill`, `.tagline` had zero JSX consumers. The `.swap-btn` rule at lines 251–281 was `position: absolute; top: 50%; right: 4px;`, but the only swap-btn JSX usage sits inside `.stops-controls`, whose override at line 388 forced `position: static` and reset every dimension — the absolute variant was unreachable. `.height-section` had its content extracted into PersonalizeModal and was no longer applied. `.weekly-summary-toggle` was defined twice; the first was orphaned.

**How it was resolved:** Deleted all of the above. Consolidated the working swap-btn rules under a single `.swap-btn` selector (the original absolute rule is gone; `.stops-controls .swap-btn` is no longer needed because there's no other context to override). Verified the surviving `.weekly-summary-toggle` block is the one actually used by the WeeklySummaryPanel component.

---

### 2026-05-06 · `fetchWithTimeout` duplicated between App.jsx and lib/exploreApi.js (2026-05-06 TD-004)

**Files:** `frontend/src/lib/fetchWithTimeout.js` (new), `frontend/src/App.jsx`, `frontend/src/lib/exploreApi.js`

**Priority:** 🟡 Medium

**What the debt was:** Two byte-identical implementations of `fetchWithTimeout(input, init, timeoutMs)`, including the same external-signal forwarding logic, lived in `App.jsx` and `lib/exploreApi.js`. They differed only in the default timeout constant (10 000 ms vs 12 000 ms).

**How it was resolved:** Created [`lib/fetchWithTimeout.js`](../../frontend/src/lib/fetchWithTimeout.js) exporting `fetchWithTimeout`, `ROUTE_FETCH_TIMEOUT_MS` (10 s), and `EXPLORE_FETCH_TIMEOUT_MS` (12 s). Both call sites now import from it; the per-caller default is passed explicitly so a future change to abort-signal handling lives in one place.

---

### 2026-05-06 · `lbToKg` imported from App.jsx into PersonalizeModal (2026-05-06 TD-005)

**Files:** `frontend/src/lib/units.js` (new), `frontend/src/components/PersonalizeModal.jsx`, `frontend/src/App.jsx`

**Priority:** 🟢 Low

**What the debt was:** `PersonalizeModal` (a leaf component) imported `lbToKg` from `../App.jsx`, inverting the dependency direction (`components → App` instead of `components → lib`). A future bundle splitter that lazy-loaded `PersonalizeModal` would still drag the entire `App` module along with it. `PersonalizeModal` also defined its own local `kgToLb` — same idea, opposite direction, no shared home.

**How it was resolved:** Created [`lib/units.js`](../../frontend/src/lib/units.js) with `lbToKg` and `kgToLb`. PersonalizeModal now imports both from `lib/units.js`; `App.jsx` re-exports `lbToKg` for `App.test.jsx`'s named-import contract.

---

### 2026-05-06 · Inline-style cleanup across PersonalizeModal, LoadingSkeleton, Masthead, MobileLayout, Footer (2026-05-06 TD-006)

**Files:** `frontend/src/components/{PersonalizeModal,LoadingSkeleton,Masthead,MobileLayout,Footer}.jsx`, `frontend/src/wayfarer/primitives.jsx`, `frontend/src/App.css`

**Priority:** 🟡 Medium

**What the debt was:** Phase 1 introduced the Wayfarer design system, but most newer components expressed layout, typography, and color through 30–60-line inline `style={{ … }}` blocks. The same "small caps signpost" recipe appeared in five components; tokens were hand-typed and slightly drifted (e.g. `fontWeight: 800` vs `WFCaps`'s 700); hover/focus/responsive states were unreachable from inline styles.

**How it was resolved:** Added ~30 named CSS classes to `App.css` covering modal chrome (`.wf-modal-overlay`, `.wf-modal-card`), the Personalize modal sections (`.personalize-header`, `.personalize-section`, `.personalize-section-label`, `.personalize-input`, `.personalize-select`, `.personalize-preset`, `.personalize-theme-btn`, etc.), the Masthead variants (`.masthead--full`, `.masthead--compact`, `.masthead-eyebrow`, `.masthead-rule`), the loading-skeleton chrome (`.loading-skel`, `.loading-skel-eyebrow`, `.loading-skel-lamp`, `.loading-skel-bar`), and the mobile shell (`.mobile-shell`, `.mobile-shell-map`, `.mobile-shell-header`). Components rewritten to use them: `PersonalizeModal.jsx` 519 → 305 lines (and the inline `kgToLb` / unused `useRef` import removed); `Masthead.jsx` 124 → 50 lines; `LoadingSkeleton.jsx` simplified to use a single `.loading-skel-bar` class; `MobileLayout.jsx` lost its three duplicated style objects; `Footer.jsx` is now a single-line `<WFColophon as="footer" className="page-footer-colophon" />` (TD-011 also pulls in here). Other components (ShareDispatch, WeeklySummaryPanel, the wayfarer primitives themselves) keep their inline styles since each is shaped by per-instance props (the share-card design width, the goal-bar percentage, the SVG mark sizing) — those aren't "small-caps signpost" recipes and class-extracting them would just shuffle the location of the values.

---

### 2026-05-06 · "walkpath.app" brand string left over on the share card (2026-05-06 TD-007)

**File:** `frontend/src/components/ShareDispatch.jsx`

**Priority:** 🟢 Low

**What the debt was:** The share-card footer literal read `walkpath.app` — a stale brand. The project rebranded to **Passage** months ago (per `CLAUDE.md`, the manifest in `vite.config.js`, the Masthead component, and user-facing copy). Anyone who downloaded a route PNG sent out an artifact tagged with the old brand.

**How it was resolved:** Replaced the `walkpath.app` italic with a small-caps `Passage` mark, matching the style of the colophon on the right. Kept the `walkpath:` localStorage key prefixes and `walk-path` MapLibre source IDs untouched (those are load-bearing per `CLAUDE.md` — they protect against orphaning user data and cascading import churn).

---

### 2026-05-06 · Vestigial `import React` lines under the new JSX runtime (2026-05-06 TD-008)

**Files:** 14 files across `frontend/src/components/` and `frontend/src/wayfarer/`

**Priority:** 🟢 Low

**What the debt was:** Vite's plugin-react enables the automatic JSX runtime, and ESLint had `react/react-in-jsx-scope: "off"`, so default-importing `React` for JSX support was never necessary. Roughly 14 files still did so, with the binding usually unused (e.g. `WeeklySummaryPanel.jsx` imported `React, { useMemo, useState }` and only referenced the named hooks).

**How it was resolved:** Stripped the default `React` import from `components/{WeeklySummaryPanel,CompareDispatch,Footer,ErrorDispatch,LoadingSkeleton,DirectionLedger,RouteFlavorTabs,Masthead,MobileLayout.test,PersonalizeModal}.jsx` and `wayfarer/{walkpath-icons,walkpath-icons.test,WFSheet.test,extras}.jsx`. One file (`wayfarer/extras.jsx`) actually used `React.useState` inside `WFTooltip`; converted that to the named import and verified with ESLint. While auditing the lint output, also fixed a pre-existing `react-hooks/rules-of-hooks` violation in `CompareDispatch.jsx` where `useMemo` was called after an early return (now hoisted above the guard).

---

### 2026-05-06 · MapView.jsx 693-line file mixing route, explore, popup, and pick-mode lifecycles (2026-05-06 TD-010)

**Files:** `frontend/src/MapView.jsx`, `frontend/src/map/{MapRouteLayer,MapExploreLayer,MapPickLayer}.jsx` (new)

**Priority:** 🟡 Medium

**What the debt was:** `MapView.jsx` was a 693-line file with nine `useEffect` blocks owning map init, gesture lock/unlock against three orthogonal modes, route polyline render with `line-trim-offset` draw-in animation, endpoint marker `createRoot` portals, the explore polygon + heatmap + clustered place pins, click handlers for cluster zoom and pin popups (each popup a `createRoot`-rendered React tree inside a `maplibregl.Popup`), pick-mode click-to-place + confirm dialog, locate-me cursor handling, plus turn-marker highlight + flyTo. Each effect carried its own `react-hooks/exhaustive-deps` suppression.

**How it was resolved:** Split into a slim shell + three sibling layer components under `frontend/src/map/`:
- [`MapRouteLayer.jsx`](../../frontend/src/map/MapRouteLayer.jsx) (263 lines) — route polyline, endpoint markers, draw-in animation, turn-highlight + flyTo. Owns `layerIds` / `sourceIds` / `endpointMarkersRef` / animation `rafRef`.
- [`MapExploreLayer.jsx`](../../frontend/src/map/MapExploreLayer.jsx) (221 lines) — polygon + residential heatmap + clustered place pins. Owns the popup React-root lifecycle (the `popupRef` / `popupRootRef` / `popupElRef` triplet).
- [`MapPickLayer.jsx`](../../frontend/src/map/MapPickLayer.jsx) (134 lines) — pick-mode pointer handler + preview marker + the in-map Cancel/Confirm card.

[`MapView.jsx`](../../frontend/src/MapView.jsx) is now 185 lines and only owns the `maplibregl.Map` instance, the unlock-button surface, and the locate-button. The three layers receive the shared `mapRef` and each owns its own rendering lifecycle. Total line count is similar to before (broken across four files instead of one), but each file is one-screen testable.

---

### 2026-05-06 · "Printed in Chicago, on foot" colophon duplicated (2026-05-06 TD-011)

**Files:** `frontend/src/wayfarer/primitives.jsx`, `frontend/src/components/Footer.jsx`, `frontend/src/components/ShareDispatch.jsx`

**Priority:** 🟢 Low

**What the debt was:** The string `⟡ Printed in Chicago, on foot ⟡` appeared as a literal in `Footer.jsx` and `ShareDispatch.jsx`. Cosmetic today but invited drift the moment a copy edit only landed in one of them.

**How it was resolved:** Added `COLOPHON_TEXT` and a `WFColophon` primitive to [`wayfarer/primitives.jsx`](../../frontend/src/wayfarer/primitives.jsx). `Footer.jsx` now renders `<WFColophon as="footer" className="page-footer-colophon" />`; `ShareDispatch.jsx` imports `COLOPHON_TEXT` and uses it inline (the share card needs its own typography styling, so it consumes the constant rather than the rendered primitive).

---

### 2026-05-06 · Duplicated `_METERS_PER_MILE` constant (2026-05-06 TD-001)

**Files:** `backend/utils.py`, `backend/main.py`, `backend/explore.py`, `backend/walking.py`, `backend/geocoding.py`

**Priority:** 🟡 Medium

**What the debt was:** The same magic number `1609.34` (meters per mile) was hardcoded in four places — twice as a named module constant (`main.py`, `explore.py`) and twice as a literal (`walking.py`'s `WALKING_SPEED_MPS` definition, `geocoding.py`'s `_REV_THRESHOLD_MI`). `utils.py` already houses cross-module geographic constants (`WALKING_SPEED_MPH`, `CHICAGO_BBOX_GOOGLE`, `SERVICE_HIGHWAY_TYPES`), so the duplication was actively against the file's stated purpose.

**How it was resolved:** Added `METERS_PER_MILE: float = 1609.34` to `utils.py` and routed every site through it. Kept the prior `1609.34` value (vs. the more precise `1609.344`) so distance/area outputs stay byte-for-byte unchanged. Five sites now share one source of truth.

---

### 2026-05-06 · Stale `/explore` endpoint docstring (2026-05-06 TD-002)

**File:** `backend/main.py`

**Priority:** 🟡 Medium

**What the debt was:** The `/explore` endpoint docstring claimed `"places": []  # populated once Chunks 5–7 land; empty for now.` and that `categories` was "accepted but currently unused". In reality, the endpoint had long since materialized the polygon, called `places_in_polygon` with `payload.categories`, and returned a populated `places` list and a `residential_heatmap` field that the docstring didn't mention at all. Anyone reading the docstring to learn the contract got a wrong picture of what the endpoint returned.

**How it was resolved:** Rewrote the docstring to match the live response shape — added `residential_heatmap`, documented the place schema fields, and corrected the `categories` description to say it filters places (only `height_inches` remains genuinely reserved-for-future).

---

### 2026-05-06 · Unused `SOURCE_NAME_FOR_HUMANS` constants in two ingestion scripts (2026-05-06 TD-003)

**Files:** `backend/scripts/build_libraries.py`, `backend/scripts/build_farmers_markets.py`

**Priority:** 🟢 Low

**What the debt was:** Both curated-data ingestion scripts defined a module-level `SOURCE_NAME_FOR_HUMANS` string but never used it — it wasn't passed to `merge_and_write`, wasn't logged, and had zero readers anywhere in the repo. A half-finished plan to surface a friendlier source attribution in the generated `places_curated.json` metadata.

**How it was resolved:** Deleted both unused constants. `merge_and_write` already records the script-supplied `source` key and `source_url` in the metadata block, which is sufficient attribution; if a future change wants the human-readable name in the JSON, the addition is a one-liner there.

---

### 2026-05-06 · Duplicated lat/lon ~1 m quantization pattern across 8 sites (2026-05-06 TD-004)

**Files:** `backend/utils.py`, `backend/main.py`, `backend/walking.py`, `backend/explore.py`, `backend/places.py`, `backend/scripts/build_places_osm.py`, `backend/scripts/build_farmers_markets.py`

**Priority:** 🟢 Low

**What the debt was:** The pattern `(round(lat * 1e5), round(lon * 1e5))` (or its tuple-keying variants) was written out in eight places to quantize a coordinate to ~1 m for cache keys / dedupe keys. The "1e5" magic number and the rounding convention were a single conceptual decision spread across the codebase, and several adjacent comments had already drifted ("~1 m precision", "~1 m dedupe granularity").

**How it was resolved:** Added `quantize_coord(lat: float, lon: float) -> tuple[int, int]` to `utils.py` and routed every call site through it (route cache, KDTree-snap cache, isochrone cache, places dedupe in `places.py`, dedupe keys in the OSM and farmers-market build scripts). The build-scripts directory now also imports from `backend/utils` directly (the `sys.path.insert(parent.parent)` was already in place for `STREET_GRAPH_*`).

---

### 2026-05-06 · Three near-identical fallback branches in `_compute_route_quantized` (2026-05-06 TD-005)

**File:** `backend/walking.py`

**Priority:** 🟢 Low

**What the debt was:** `_compute_route_quantized` had two separate degenerate-input branches (no-graph and no-shortest-path) that each called `_build_path` / `_build_directions` / `_build_minutes` with the same five arguments. Each helper independently re-acquired the graph, re-tried the routing, logged its own warning, and fell back to haversine — three log lines, three redundant checks, identical output shape, but handled by two copies of the same construction.

**How it was resolved:** Extracted `_haversine_fallback(olat, olon, dlat, dlon, flavor) -> tuple[tuple, tuple, float]`. Both fallback branches now collapse to a single call.

---

### 2026-05-06 · Dead `_edge_attr` and `if not have_cache` fallback branches in walking.py (2026-05-06 TD-006)

**File:** `backend/walking.py`

**Priority:** 🟢 Low

**What the debt was:** `_populate_edge_caches` is called unconditionally inside `_load_graph`, so the `_edge_*` columns are guaranteed to be non-None for any caller that has a working graph. The `if not have_cache` / `if geoms is None` branches in `_directions_from_path` and `_path_coords_from_path` (and the `_edge_attr` helper they fell back to) were unreachable in practice — a relic from when the cache was lazily populated. ~30 lines of "what if" code that no test exercised and that obscured the fast path.

**How it was resolved:** Deleted the `_edge_attr` helper and the cache-miss branches. `_build_minutes`, `_path_coords_from_path`, and `_directions_from_path` now read the per-edge columns directly with no defensive fallback. Updated the docstrings to record the cache-population invariant. `_normalize_edge_str` (which existed only to mirror `_edge_attr`'s semantics) keeps its bulk-attribute role; its docstring is updated to no longer reference the deleted helper.

---

### 2026-05-06 · Manual `@app.options("/route")` redundant with CORSMiddleware (2026-05-06 TD-007)

**File:** `backend/main.py`

**Priority:** 🟢 Low

**What the debt was:** `CORSMiddleware` was configured with `allow_methods=["GET", "POST", "OPTIONS"]` and a populated origin list, so it already handled CORS preflight responses for `/route` with the appropriate Access-Control-* headers. The hand-rolled `@app.options("/route")` returned a bare 200 with no CORS headers — dead in practice (CORSMiddleware intercepts first), but a latent bug if it had ever been hit. None of `/health`, `/explore`, `/reverse-geocode` had a similar handler, confirming it was a debugging vestige.

**How it was resolved:** Deleted the handler and dropped the now-unused `from fastapi.responses import Response` import. CORSMiddleware retains responsibility for preflight responses.

---

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

### 2026-05-23 · Final deferral round — canvas tint layer + font subset + PNG optimization (OPT-042, OPT-064, OPT-074 — last three items from 2026-05-22 audit)

**Files:** [frontend/src/MapView.jsx](../../frontend/src/MapView.jsx), [frontend/src/mapHelpers.js](../../frontend/src/mapHelpers.js), [frontend/src/components/ShareDispatch.jsx](../../frontend/src/components/ShareDispatch.jsx), [frontend/src/App.css](../../frontend/src/App.css), [frontend/src/wayfarer/fonts.css](../../frontend/src/wayfarer/fonts.css), [frontend/public/fonts/*.woff2](../../frontend/public/fonts/), [frontend/public/passage-icon-*.png](../../frontend/public/), [frontend/src/test-setup.js](../../frontend/src/test-setup.js), [docs/Pending_Verification.md](../Pending_Verification.md)

**Impact:** 🔴 High (OPT-042) + 🟡 Medium (OPT-064) + 🟢 Low (OPT-074)

**Category:** GPU compositing / Font bytes / PWA install size

**What was inefficient:**
- **OPT-042**: `.maplibregl-canvas { filter: sepia(0.18) saturate(0.7) brightness(0.98) }` (and the Dusk variant) forced the browser to allocate a backing surface for the WebGL canvas and re-apply the filter matrix on every composite. Pan/zoom drove the filter through the GPU on every frame.
- **OPT-064**: Four self-hosted variable woff2 files (Fraunces regular + italic, Inter, JetBrains Mono) shipped their full glyph set (~878 KB combined). The app uses Latin + a small set of general-punctuation glyphs (em dash, arrows, ellipsis, vulgar fractions).
- **OPT-074**: Five PWA icons (passage-icon-16/32/180/192/512.png) had not been run through a modern PNG optimizer. Original combined ~16.3 KB.

**Implemented:**

*OPT-042 — MapLibre `background` tint layer in [mapHelpers.js](../../frontend/src/mapHelpers.js) + [MapView.jsx](../../frontend/src/MapView.jsx) + [ShareDispatch.jsx](../../frontend/src/components/ShareDispatch.jsx).* `MAP_TINT_LAYER_ID` + `MAP_TINT = { cream: { color: "#8B6F47", opacity: 0.12 }, dusk: { color: "#0a0807", opacity: 0.45 } }` exported from mapHelpers. MapView installs the layer in a `useEffect(.., [mapReady])` after `map.once("load")`; the same `MutationObserver` rAF-gate pattern from CHUNK-13's OPT-060 catches theme flips and calls `setPaintProperty` to update color + opacity without rebuilding the layer. ShareDispatch installs the same layer before its route render so the exported PNG carries the tint baked in. The `.maplibregl-canvas { filter: ... }` rule in App.css is replaced with a comment block explaining the swap.

The catalog's specific `raster-saturation` + `raster-hue-rotate` recipe didn't apply because OpenFreeMap Liberty is a vector tile style, not raster (the catalog assumed otherwise). The background-layer alternative produces a slight visual departure — the layer sits **above** the Liberty base layers but **below** the route + explore overlays added later, so route polylines and explore polygons now render in their true Wayfarer colors (route un-tinted, more pop against the tinted base). PV-014 in [Pending_Verification.md](../Pending_Verification.md) covers the Cream/Dusk visual sign-off + tint constant tuning.

*OPT-064 — woff2 subset to `U+0000-024F, U+2000-22FF` in [frontend/public/fonts/](../../frontend/public/fonts/).* Each variable woff2 file regenerated via `pyftsubset --unicodes='U+0000-024F,U+2000-22FF' --layout-features='*' --name-IDs='*' --notdef-outline --recalc-bounds --recalc-timestamp`. The codepoint range is broader than the catalog's stricter `U+0000-024F` because the editorial copy uses glyphs from General Punctuation (em dash `—`, ellipsis `…`), Number Forms (`⅓`, `⅔`), Arrows (`→`), and Mathematical (`≈`) — all outside the Latin block. Each `@font-face` in [wayfarer/fonts.css](../../frontend/src/wayfarer/fonts.css) gets a matching `unicode-range: U+0000-024F, U+2000-22FF;` so the browser doesn't request the font for codepoints it claims not to cover. Results:

| Font | Before | After | Saved |
|------|--------|-------|-------|
| Fraunces regular  | 195,068 | 174,896 | 10.3% |
| Fraunces italic   | 235,736 | 212,568 | 9.8% |
| Inter             | 352,240 | 174,216 | 50.5% |
| JetBrains Mono    | 113,672 | 64,444  | 43.3% |
| **Total**         | **896,716** | **626,124** | **30.2% (~264 KB)** |

Fraunces savings are modest because Fraunces is mostly Latin to begin with; Inter and JetBrains Mono carry CJK + extensive symbol coverage that the subset drops. The full re-subset command (including required pip installs) is documented as a multi-line CSS comment in `fonts.css` so future contributors can re-run after a font upgrade.

*OPT-074 — `oxipng -o 4 --strip safe frontend/public/passage-icon-*.png`.* Single batch invocation, oxipng v10.1.1 (downloaded as a portable .zip to /c/tmp to avoid a global install). Results:

| Icon | Before | After | Saved |
|------|--------|-------|-------|
| passage-icon-16.png   | 411   | 245   | 40% |
| passage-icon-32.png   | 537   | 261   | 51% |
| passage-icon-180.png  | 2,492 | 714   | 71% |
| passage-icon-192.png  | 2,734 | 825   | 70% |
| passage-icon-512.png  | 10,518| 2,373 | 77% |
| **Total**             | **16,692** | **4,418** | **73.5% (~12 KB)** |

Far exceeds the catalog's 10-30% estimate. Visual identity confirmed by reading the optimized 192 + 512 px PNGs via the IDE's image preview — editorial Passage glyph (cream lines on ember red) is preserved.

**Test-setup mock additions:** The MapView tint install effect calls `map.getLayer` and `map.setPaintProperty`, which the global maplibre mock in [test-setup.js](../../frontend/src/test-setup.js) didn't provide. Added stubs for `getLayer`, `setLayoutProperty`, `setFeatureState`, `removeFeatureState`, `easeTo` (rounding out the mock against what production code now calls).

**Combined cumulative perf delta:**
- PWA precache size: 2,343 KB → 2,080 KB (263 KB / 11% saved across CHUNK-15 + this round).
- One fewer per-frame GPU operation during pan/zoom (the canvas-filter blit is gone).

**Verification:** Frontend 466 tests green across 31 files; production Vite build clean; dev server boots without runtime errors (CSP / preload links / font requests all confirmed in the served HTML head).

**Docs landed in the same round:**
- [`docs/Pending_Verification.md`](../Pending_Verification.md) PV-014 — Cream/Dusk visual sign-off for the tint layer values.
- [`docs/Efficiency_Improvements.md`](../Efficiency_Improvements.md) — emptied; the 2026-05-22 audit batch is fully resolved.
- [`docs/Efficiency_Roadmap.md`](../Efficiency_Roadmap.md) — wave map fully struck through; "Unscoped follow-ups" updated to reflect that the catalog is now empty.

---

### 2026-05-23 · DOM weight reductions — explore category panel + stable autocomplete keys (OPT-078, OPT-085 from CHUNK-17 of 2026-05-22 audit; OPT-063 already met)

**Files:** [frontend/src/components/ExploreCategoryPanel.jsx](../../frontend/src/components/ExploreCategoryPanel.jsx), [frontend/src/components/AddressAutocomplete.jsx](../../frontend/src/components/AddressAutocomplete.jsx), [backend/main.py](../../backend/main.py), [backend/tests/test_autocomplete_endpoint.py](../../backend/tests/test_autocomplete_endpoint.py)

**Impact:** 🟢 Low (OPT-078, OPT-085)

**Category:** React reconciliation / Repeated linear scans

**What was inefficient:**
- `ExploreCategoryPanel` decided whether to reveal a category's sublist via `cat.subs.some(s => selectedSubSet.has(\`${cat.key}/${s.key}\`))` — an O(subs) scan per category, executed in the render body. Toggling a single sub re-ran every group's scans.
- `AddressAutocomplete` keyed each list row by `${s.source}-${s.label}-${s.lat ?? "x"}-${i}`. The trailing `${i}` made every keystroke that filtered or reordered the list look like a fresh key set to React, forcing remount + re-attach of all the `mousedown`/`touchstart` listeners on every row.

**Implemented:**

*OPT-078 — `categoriesWithSelectedSubs` memo in [ExploreCategoryPanel.jsx](../../frontend/src/components/ExploreCategoryPanel.jsx).* A single `useMemo([selectedSubs])` walks the flat `selectedSubs` array once, splits each `"category/sub"` entry on the first `/`, and seeds a `Set<categoryKey>`. The per-row sublist-visibility check collapses to `categoriesWithSelectedSubs.has(cat.key)` — O(1) — and the memo only recomputes when `selectedSubs` actually changes.

*OPT-085 — backend stable `id` in [main.py](../../backend/main.py) `/autocomplete`.* Each suggestion now carries `id: f"{s.source}|{s.label}|{s.lat:.6f},{s.lon:.6f}"` (and `"locationiq|{q}|{coords[0]:.6f},{coords[1]:.6f}"` for the supplement). Same suggestion across two requests gets the same id; the source prefix prevents collisions between `neighborhood`/`intersection`/`place` rows that share coords. Frontend [AddressAutocomplete.jsx](../../frontend/src/components/AddressAutocomplete.jsx) reads `s.id` as the React key with the prior composite as a fallback (the local community-area picker has no `id` field — it filters in-memory, no backend round-trip).

*OPT-063 — already met.* The catalog claimed `DirectionLedger` mounts 95+ off-screen nodes when collapsed. Inspection showed [DirectionLedger.jsx](../../frontend/src/components/DirectionLedger.jsx) line 23 already does `const visible = showAll ? directions : directions.slice(0, 5);` and maps only `visible`, so a 100-step collapsed route mounts at most 5 rows. Catalog entry pre-dated the slice optimization. No code change needed; entry kept in the resolved log so the audit is traceable.

**Tests:** Backend autocomplete test (`test_response_fields_are_complete`) updated to assert `id` is present + string; a new `test_id_is_stable_across_requests` proves the key contract (same query → identical `id` list). Backend: 320 passing; frontend: 466 passing.

**Docs landed in the same chunk:**
- [`CLAUDE.md`](../../CLAUDE.md) `GET /autocomplete` shape + response sample updated.
- [`README.md`](../../README.md) `/autocomplete` mirror updated.

---

### 2026-05-23 · localStorage write hygiene + fetch race + UX safety (OPT-055, OPT-056, OPT-057, OPT-062, OPT-065, OPT-076, OPT-084 from CHUNK-16 of 2026-05-22 audit)

**Files:** [frontend/src/App.jsx](../../frontend/src/App.jsx), [frontend/src/lib/recentSearches.js](../../frontend/src/lib/recentSearches.js), [frontend/src/lib/stepLog.js](../../frontend/src/lib/stepLog.js), [frontend/src/lib/autocompleteApi.js](../../frontend/src/lib/autocompleteApi.js), [frontend/src/lib/autocompleteApi.test.js](../../frontend/src/lib/autocompleteApi.test.js), [frontend/src/hooks/useExploreFetch.js](../../frontend/src/hooks/useExploreFetch.js), [frontend/src/hooks/useShareCard.js](../../frontend/src/hooks/useShareCard.js), [frontend/src/hooks/usePersonalization.js](../../frontend/src/hooks/usePersonalization.js)

**Impact:** 🟡 Medium (OPT-055, OPT-056, OPT-057, OPT-062, OPT-065) + 🟢 Low (OPT-076, OPT-084)

**Category:** Synchronous storage / UX failure mode / Redundant network / Stale UI

**What was inefficient:**
- `explorePrefs` saved synchronously on every category / sub / heatmap toggle — 5–10 `localStorage.setItem` round-trips per second of rapid panel interaction.
- `saveRecentSearch` did 3+ JSON ops per save: a parse on load, a stringify for the new entry's dedup key, another stringify *per existing entry* inside the filter loop, and a final stringify on write. Effectively `O(existing)` JSON.stringify calls per save.
- `useExploreFetch`'s initial-fetch effect carried an `if (exploreLoading) return;` guard that silently dropped new fetches when one was in-flight. A rapid mode toggle (explore → route → explore) skipped the new fetch and left the stale prior result on screen.
- `useShareCard` awaited `map.once("render", resolve)` + `triggerRepaint()` with no timeout. A failed/lost WebGL context on iOS would hang the share modal indefinitely.
- `fetchAutocomplete` had no client-side cache; typing → deleting → re-typing the same query, or the same prefix entered into both stop inputs, hit the backend twice.
- `usePersonalization` ran five separate save effects, each touching its own localStorage key. Updating height + weight in the same Personalize-modal commit fired two effects → two synchronous `JSON.stringify` + `setItem` round-trips.
- `stepLog` pruned expired entries on app boot via `pruneStoredStepLog`, but within a long-running session new entries piled onto an in-memory list that was never re-pruned. `logWalk` wrote the full grown list on every save.

**Implemented:**

*OPT-055 — debounced `explorePrefs` save in [App.jsx](../../frontend/src/App.jsx).* The save effect now schedules a 300 ms `setTimeout`, cleared on each subsequent change. A second effect registers a `beforeunload` handler that flushes the latest prefs (read from a ref so the listener doesn't capture stale state) before navigation.

*OPT-056 — single-pass `saveRecentSearch` in [recentSearches.js](../../frontend/src/lib/recentSearches.js).* Single load, single stringify of the new entry's signature, single loop that combines "drop corrupt legacy" + "dedupe by stops shape" into one pass using a `Set<string>`, single write. Profiler shows `1 JSON.parse + 1 JSON.stringify + 1 setItem` per save (was `1 + N + 1` where N = existing length).

*OPT-057 — removed `if (exploreLoading) return;` guard in [useExploreFetch.js](../../frontend/src/hooks/useExploreFetch.js).* `fetchExploreResult` already calls `exploreAbortRef.current?.abort()` before starting a fresh request, so the guard was redundant with the internal abort. Removing it lets a rapid mode toggle abort the stale fetch and start fresh with the current params.

*OPT-062 — 5 s timeout race in [useShareCard.js](../../frontend/src/hooks/useShareCard.js).* The `map.once("render", ...)` promise now races against a `setTimeout(reject, 5000)`. A `settled` flag prevents double-resolve; both branches clear the other's listener / timer on completion. The caller's existing catch routes a thrown error to the toast UI + leaves the modal actionable.

*OPT-065 — in-memory LRU in [autocompleteApi.js](../../frontend/src/lib/autocompleteApi.js).* Module-level `Map<string, suggestions[]>` with delete-on-get-then-re-set to promote MRU. Max 20 entries; oldest evicted on overflow via `_acCache.keys().next().value`. Cached on successful response only — aborted/errored requests never populate. Two new tests in autocompleteApi.test.js prove (1) a repeat (q, limit) hit serves from cache without re-fetching, (2) different `limit` values are separate cache slots.

*OPT-076 — coalesced save effect in [usePersonalization.js](../../frontend/src/hooks/usePersonalization.js).* The five separate `useEffect`s (pace, heightFt, heightIn, weightKg, accessPrefs) collapse into one effect that depends on all five state values and calls each saver in sequence. React batches setState within the same event loop tick, so a multi-field commit now fires one round of writes.

*OPT-084 — `logWalk` prunes on save in [stepLog.js](../../frontend/src/lib/stepLog.js).* Each save now runs `pruneExpired(existing, now)` on the existing list before prepending the new entry. Bounds the persisted file under the existing 7-day TTL even in long-running sessions where the boot-time `pruneStoredStepLog` never re-fires.

**Verification:** Frontend 466 tests, 31 files (+2 from the new LRU assertions in autocompleteApi.test.js). The autocomplete test setup needed `_clearAutocompleteCache()` in `beforeEach` because the module-level cache persists across tests — `_clearAutocompleteCache` is exported just for that purpose.

---

### 2026-05-23 · First-paint assets + CSS paint cost (OPT-041, OPT-066, OPT-067, OPT-073 from CHUNK-15 of 2026-05-22 audit; OPT-064 deferred — no `fonttools`)

**Files:** [frontend/index.html](../../frontend/index.html), [frontend/src/App.css](../../frontend/src/App.css), [frontend/src/wayfarer/components.css](../../frontend/src/wayfarer/components.css), [frontend/vite.config.js](../../frontend/vite.config.js)

**Impact:** 🔴 High (OPT-041) + 🟡 Medium (OPT-066, OPT-067) + 🟢 Low (OPT-073)

**Category:** First paint / Paint cost / Bundle caching

**What was inefficient:**
- Fraunces (regular + italic), Inter, JetBrains Mono (~878 KB combined) were linked only via `@font-face` in `wayfarer/fonts.css`. First paint waited for CSS to parse → font request to fire → font download. All four are on the critical-path masthead / italic UI strings.
- `.explore-cat-row-swatch` (one per explore category × ~50 categories) carried a `box-shadow: 0 0 0 1px var(--ink)`. Box-shadow routes through the rasterizer even with zero blur; with the explore panel mounted, this added a meaningful paint-node count per scroll/composite.
- `.wf-sheet`'s shadow had `0 -8px 24px rgba(...)` — 24 px blur radius. Browsers re-rasterize the shadow region on every drag frame, and the cost scales with blur-radius squared, so sheet drag was the worst-case paint surface on mid-tier Android.
- The Vite manual-chunks rule pinned `maplibre-gl` into its own chunk but bundled `react` + `react-dom` (~143 KB) into the app code. Every app-code hash bump re-downloaded React.

**Implemented:**

*OPT-041 — four `<link rel="preload" as="font" type="font/woff2" crossorigin>` in [index.html](../../frontend/index.html)* one per font file. `crossorigin` is required by the spec even on same-origin font preloads; without it the browser fetches the font again when the `@font-face` rule runs. All four preloaded — italic is heavily used on the critical-path masthead + route-flavor tabs.

*OPT-066 — `outline: 1px solid var(--ink)` replaces the swatch `box-shadow` in [App.css](../../frontend/src/App.css).* `outline-offset: 0` keeps it positioned exactly where the prior box-shadow sat, preserving the two-tone "pin with cream halo" look. The `.explore-cat-row-swatch--fill` variant gets `outline: none` to match its prior `box-shadow: none` override.

*OPT-067 — `.wf-sheet` shadow blur cut from 24 px → 12 px in [components.css](../../frontend/src/wayfarer/components.css).* The 8 px y-offset + alpha still read as a tactile floating sheet; halving the blur quarters the rasterized area without meaningfully changing the editorial "page lifted off the page below" feel.

*OPT-073 — React vendor chunk rule added in [vite.config.js](../../frontend/vite.config.js).* Ordered before the maplibre rule so React paths match first. Production build verified: `react-vendor-DwsPBBoM.js  142.91 kB │ gzip: 45.77 kB` emits as a separate chunk.

*OPT-064 — deferred.* `fonttools` / `pyftsubset` is not installed locally, and a system-wide install was out of scope for this bundle (same precedent as OPT-074 oxipng — the catalog one-shot tooling work is best done in a focused session with explicit visual verification across all four fonts).

**Verification:** Frontend 464 tests green across 31 files. Production Vite build emits the React vendor chunk + confirms preloads/CSS changes don't break the build.

---

### 2026-05-23 · MapLibre layer effect splits + feature-state hygiene + theme rAF (OPT-038, OPT-039, OPT-058, OPT-059, OPT-060 from CHUNK-13 of 2026-05-22 audit)

**Files:** [frontend/src/map/MapRouteLayer.jsx](../../frontend/src/map/MapRouteLayer.jsx), [frontend/src/map/MapExploreLayer.jsx](../../frontend/src/map/MapExploreLayer.jsx), [frontend/src/mapHelpers.js](../../frontend/src/mapHelpers.js)

**Impact:** 🔴 High (OPT-038, OPT-039) + 🟡 Medium (OPT-058, OPT-059, OPT-060)

**Category:** MapLibre layer churn / React effect discipline / Internal state growth

**What was inefficient:**
- `MapRouteLayer`'s render effect declared `[result, turnCoords, mode]`, so a flavor swap (`viewResult` overlay churns the result identity even when the active route's `path` stayed identical) re-ran `renderWalkRoute` end-to-end. `buildRouteSegments` recomputed the cum-distance walk inside `_buildTurnPathInfo` every call (~25k ops on a 500-point × 50-direction route), and the segment / casing / turn-points GeoJSON was re-uploaded via `setData` against unchanged buffers — re-kicking the draw-in animation.
- `MapRouteLayer`'s feature-state cleanup ran AFTER `setData`. The non-id form (`removeFeatureState({ source })`) clears the whole map, but ordering it after the new data was uploaded meant a window during which orphaned state for ids past the new feature count could land in the MapLibre internal map between renders. Per-id state leaked across long flavor-swap sequences.
- `MapExploreLayer`'s single render effect listed `[mode, exploreResult, showResidential, showParks, showTreeCanopy, showGreenSpace, canopyBandColors, placeFeatures, placeExpressions]`. Toggling residential ran `renderExplore` end-to-end — including `ensureExploreSource` on `explore-places` with the same supercluster `clusterOptions` (`setData` on a clustered source re-tiles the entire pin set).
- The theme `MutationObserver` fired `setThemeVersion(v => v + 1)` per class mutation. A theme toggle that co-occurred with another setState could fan out into multiple paint-property updates as React flushed the class write in separate layout passes.

**Implemented:**

*OPT-058 — clear feature-state BEFORE `setData` in [frontend/src/mapHelpers.js](../../frontend/src/mapHelpers.js).* Both `walk-segments` and `walk-turns` source upserts now invert the order: `if (map.getSource?.(...)) removeFeatureState({ source: ... })` runs first, then `upsertGeoSource` calls `setData`. Acceptance: after 100 route swaps the MapLibre feature-state dict holds at most `newRoute.turnCount` entries (was unbounded growth).

*OPT-059 + OPT-038 (memoization) — `buildRouteSegments` extracted to `useMemo` in [frontend/src/map/MapRouteLayer.jsx](../../frontend/src/map/MapRouteLayer.jsx).* `const routeSegments = useMemo(() => buildRouteSegments(result.path, result.directions), [result?.path, result?.directions])` memoizes the per-step FeatureCollection on `(path, directions)` identity. `renderWalkRoute` accepts an optional `precomputedSegments` 10th param; when supplied (production path), it skips its own `buildRouteSegments` call. ShareDispatch's 8-arg call site is unchanged (the new parameter is optional, defaults to `null`).

*OPT-038 (dep array) — narrowed `MapRouteLayer`'s render effect from `[result, turnCoords, mode]` to `[result?.path, result?.directions, routeSegments, turnCoords, mode]`.* A flavor swap that produces an identical `(path, directions)` pair now skips the effect entirely. Endpoint markers (`origin_coords` / `dest_coords` / `stops`) only change when the underlying fetch result changes — which always changes path identity too — so the markers stay in sync.

*OPT-039 — split `renderExplore` into per-layer helpers + split the broad effect in [frontend/src/map/MapExploreLayer.jsx](../../frontend/src/map/MapExploreLayer.jsx).* mapHelpers now exports `renderExplorePolygon`, `renderExploreResidential`, `renderExploreCanopy`, `renderExploreParks`, `renderExploreGreenSpace`, `renderExplorePlaces`; `renderExplore` is kept as a façade that delegates to them (for ShareDispatch + the existing mapHelpers.test.js asserts). `MapExploreLayer` replaces the single broad effect with six per-source effects, each keyed on `[mode, <its toggle>, exploreResult?.<its slice>]`. The polygon effect additionally owns the "leaving explore" full-clear so heatmap / pin layers don't leak on mode flip. Layer ordering (`beforeId: "explore-poly-stroke"` for heatmaps; `"explore-parks-fill"` for green-space when parks are live) is preserved inside the helpers with try/catch around `addLayer` so a transient ordering mismatch surfaces as a silent skip rather than a runtime throw.

*OPT-060 — rAF-gated `MutationObserver` in [frontend/src/map/MapExploreLayer.jsx](../../frontend/src/map/MapExploreLayer.jsx).* The observer callback now schedules a single `requestAnimationFrame` token: if one is already scheduled, subsequent mutations within the same frame are dropped. Inside the rAF callback, the token is cleared and `setThemeVersion(v => v + 1)` fires once. Cleanup cancels the pending rAF on `obs.disconnect()`.

**Verification:** Frontend suite — 464 tests, 31 files green. mapHelpers.test.js exercises the façade `renderExplore` (which still works because it delegates to the per-layer helpers), so the existing assertions covering polygon / pin / cluster-count text-font + GeoJSON shaping continue to hold. MapRouteLayer.test.jsx + MapExploreLayer.test.jsx smoke tests cover the per-source effect lifecycle (mode flip clears, residential toggle ON/OFF, polygon clear on mode→route).

**Real-device verification deferred to runtime profiling** — the unit suite covers correctness, not the GPU-buffer-allocation count or paint-update count that the catalog's acceptance criteria target. The visible UX outcomes (flavor swap stops re-running the draw-in animation, theme toggle is one paint update, heatmap toggles don't repaint unrelated layers) are observable in DevTools Performance + the MapLibre layer inspector; calling them out in a PV entry is overkill for behavior that has unit tests guarding the React-side wiring.

---

### 2026-05-23 · App.jsx memoization + shared matchMedia subscriber cache (OPT-036, OPT-037, OPT-040, OPT-061 from CHUNK-12 of 2026-05-22 audit)

**Files:** [frontend/src/App.jsx](../../frontend/src/App.jsx), [frontend/src/lib/useMediaQuery.js](../../frontend/src/lib/useMediaQuery.js)

**Impact:** 🔴 High (OPT-036, OPT-037, OPT-040) + 🟡 Medium (OPT-061)

**Category:** React render perf / Listener proliferation

**What was inefficient:** `App.jsx` rebuilt the entire active-mode sidebar JSX subtree (1000+ nodes) on every render — sheet drags, theme toggles, toast timers, followLocation updates, even setState calls that only affected the map. Plain `function handle*` declarations got fresh refs every render, defeating any downstream `React.memo` on `ExploreForm`/`ExploreCategoryPanel`/`RouteFlavorTabs`. The `modeToggle` JSX was constructed inline every render. And `useMediaQuery` registered a fresh `matchMedia` change listener per call site, so a single viewport resize evaluated each query once per subscriber.

**Implemented:**

*OPT-061 — shared subscriber cache in [frontend/src/lib/useMediaQuery.js](../../frontend/src/lib/useMediaQuery.js).* A module-level `_queryCache: Map<string, {mql, listeners, onChange}>` holds one `MediaQueryList` per distinct query string. The single DOM `change` listener fans out to all React setters that subscribed via `useMediaQuery(q)`. Added a `_cacheMatchMedia` identity check so test fixtures that reassign `window.matchMedia` between cases (App.tablet.test.jsx, MobileLayout.test.jsx) invalidate the cache cleanly — production-side this is a no-op since `window.matchMedia` never changes identity.

*OPT-040 — `getSuggestions` stability (already met).* The catalog called out a debounce-defeat where `AddressAutocomplete`'s `fetchFor` rebuilt on every parent re-render. Inspection showed both call sites already pass a stable `getSuggestions` reference: `App.jsx` uses the module-level `fetchAutocomplete` import (stable across renders by definition), and `ExploreForm` uses `useCallback([], …)` for `fetchAreaSuggestions`. No code change needed; entry kept in the resolved log so the audit is traceable.

*OPT-037 — handler stabilization in [frontend/src/App.jsx](../../frontend/src/App.jsx).* Converted 16 plain `function handle*(…)` declarations to `useCallback(…, deps)`: stop mutators (`setStopValue`, `addStop`, `removeStop`, `moveStop`), route-form helpers (`handleSwap`, `handleSubmit`, `handlePickToggle`, `handleApplySwUpdate`), step-log handlers (`handleLogWalk`, `handleClearStepLog`), explore handlers (`handleExploreOriginChange`, `handleExploreMaxMinutesChange`, `handleExploreSubmit`, `handleToggleGroup`, `handleToggleCategory`, `handleToggleSub`, `handleToggleHeatmap`, `handleSelectAllCategories`, `handleClearAllCategories`), and recent / share helpers (`handleRecentSelect`, `handleClearRecent`). Two new hoisted callbacks replace inline arrows inside the memoized sidebar: `handleRetryRoute` (the ErrorDispatch retry) and `formatDirectionsForView` (the DirectionLedger `formatDirectionsText` adapter that closes over `mobilityProfile`). `modeToggle` is now `useMemo` keyed on `[mode, handleSelectRoute, handleSelectExplore]`, both setMode wrappers being `useCallback([])`. The dead `reverseStops` and `setAllHeatmaps` helpers were folded into their sole callers.

*OPT-036 — sidebar contents memoization.* `const buildExploreContents = () => (…)` and `const buildRouteContents = () => (…)` became `useMemo(() => (…), [deps])` (`exploreContents` / `routeContents`). Dep arrays are explicit and complete — the explore branch lists 16 references, the route branch 26 — but every entry is either a useState-stable setter, a useCallback-stable handler, or a real state slice. Renders that touch unrelated state (`mapPadding`, `sheetSnap`, `toastMsg`, follow-location pos, `cardMapReady`, etc.) now hit the useMemo cache instead of rebuilding the sidebar JSX tree.

**Verification:** Full frontend suite (464 tests, 31 files) green. The OPT-061 cache-invalidation check made the App.tablet + MobileLayout tests pass without modification — they reassign `window.matchMedia` between cases and my first pass leaked stale entries; the `_cacheMatchMedia` identity guard fixed the leak.

---

### 2026-05-23 · On-demand heatmap fan-out (OPT-025 from CHUNK-11 of 2026-05-22 audit)

**Files:** [backend/main.py](../../backend/main.py), [frontend/src/lib/exploreApi.js](../../frontend/src/lib/exploreApi.js), [frontend/src/hooks/useExploreFetch.js](../../frontend/src/hooks/useExploreFetch.js), [frontend/src/hooks/useExploreFetch.test.js](../../frontend/src/hooks/useExploreFetch.test.js), [CLAUDE.md](../../CLAUDE.md), [README.md](../../README.md), [docs/Pending_Verification.md](../Pending_Verification.md)

**Impact:** 🔴 High

**Category:** Wasted backend compute + payload

**What was inefficient:** `/explore` unconditionally fanned out all four heatmap clips (residential, parks, green-space, tree-canopy) plus the place pin list on every request, regardless of the frontend's per-layer toggles. The response carried `null` for layers the user had off, but the shapely clip + STRtree query had already run. Each heatmap is ~30–150 ms of shapely intersection work depending on isochrone size; cumulative cost was ~25–57% of `/explore` latency on a 20-min Logan Square isochrone in local measurement.

**Implemented:**

*Backend (`backend/main.py`):*
- Added `_HEATMAP_LAYER_NAMES = {"residential", "parks", "green_space", "tree_canopy"}` and a new optional `with_heatmaps: list[str] | None = None` field on `ExploreRequest` with a `field_validator` that 422s on unknown layer names. Empty list (`[]`) is preserved as meaningful — "compute no heatmaps".
- `/explore` handler now builds the fan-out from a `heatmap_specs` tuple, only submitting the futures for layers in `include_heatmaps` (defaults to all 4 when `with_heatmaps` is `None`). The places-pin clip still runs unconditionally. Response field for any skipped layer is `null` via `heatmap_results.get(name)`.

*Frontend (`exploreApi.js`, `useExploreFetch.js`):*
- `fetchExplore({withHeatmaps})` passes the filter through as `with_heatmaps` in the POST body when an array is provided.
- `useExploreFetch` derives `requestHeatmaps` from the four `show*Heatmap` toggle prefs and passes it through `fetchExploreResult`.
- A `lastFetchedHeatmapsRef` tracks the set the last successful fetch was built against. A new `useEffect` watches `requestHeatmaps` and only fires a fresh fetch when the current set **expands** beyond the last fetch's set — toggling a heatmap OFF is silent (the layer hides client-side via the existing show* prefs), and toggling ON a heatmap whose geojson is already in `exploreResult` is silent too.

*Tests (`useExploreFetch.test.js`):* Added 4 new tests covering (1) initial fetch passes `withHeatmaps` derived from prefs, (2) toggle-ON expansion triggers a refetch with the new layer list, (3) toggle-OFF does **not** trigger a refetch, (4) toggle-OFF-then-ON of a still-cached layer does **not** trigger a refetch.

**Local measurement (TestClient, 20-min Logan Square isochrone):**

| `with_heatmaps`           | Latency | Decoded payload |
|---------------------------|---------|-----------------|
| omitted (all 4 layers)    | 51.7 ms | 81,124 B        |
| `["residential"]` only    | 39.3 ms | 66,466 B (-18%) |
| `[]` (no heatmaps)        | 22.4 ms | 61,154 B (-25%) |

The savings scale with isochrone size + heatmap density; production traffic with bigger time budgets and lakefront origins should see larger absolute deltas (catalog target: ~150 ms p95 drop).

**Verification:** Backend 319 tests green; frontend 464 tests green (4 new). PV-013 in [docs/Pending_Verification.md](../Pending_Verification.md) covers the production-traffic toggle-UX sign-off.

**Docs landed in the same chunk:**
- [`CLAUDE.md`](../../CLAUDE.md) `POST /explore` request table — added the `with_heatmaps` row with the catalog's intended behavior.
- [`README.md`](../../README.md) `POST /explore` request table — same addition (the README's `/explore` schema mirrors CLAUDE.md's; TD-046 caught a prior drift here, so updating both is the rule).
- [`docs/Pending_Verification.md`](../Pending_Verification.md) — PV-013 covers the real-device + production-traffic toggle-UX check.

---

### 2026-05-23 · Build-script speedups + greenest bake vectorization (OPT-029, OPT-030, OPT-052, OPT-053 from CHUNK-10 of 2026-05-22 audit)

**Files:** [backend/scripts/build_address_points.py](../../backend/scripts/build_address_points.py), [backend/scripts/build_intersections.py](../../backend/scripts/build_intersections.py), [backend/scripts/build_tree_canopy.py](../../backend/scripts/build_tree_canopy.py), [backend/fetch_street_graph.py](../../backend/fetch_street_graph.py), [backend/street_graph_igraph.pkl](../../backend/street_graph_igraph.pkl) (regenerated), [backend/.env](../../backend/.env) (`STREET_GRAPH_SHA256` rotated)

**Impact:** 🔴 High (OPT-029, OPT-030) + 🟡 Medium (OPT-052, OPT-053)

**Category:** Build time / Vectorization

**What was inefficient:** None of the four touch runtime behavior — they all live in scripts that run periodically (FTS5 geocode-index refresh, yearly tree-canopy ingest, yearly graph bake). The two SQLite FTS5 builds journaled every page write and fsync'd after each one (OPT-029). The MRLC tree-canopy bake fetched its three longitudinal chunks sequentially despite each one being I/O-bound (OPT-052). The greenest-routing bake walked ~233k edges through a pure-Python arc-length midpoint loop (OPT-053), then walked them again calling `STRtree.nearest()` once per edge with the per-call Python overhead (OPT-030).

**Implemented:**
- **OPT-029** — Both `build_address_points.py` and `build_intersections.py` now set `PRAGMA journal_mode=OFF`, `PRAGMA synchronous=OFF`, `PRAGMA temp_store=MEMORY` immediately after `connect()` and before the FTS5 bulk inserts. The runtime cache connection in `geocoding._cache_connect` reopens with WAL + `synchronous=NORMAL`, so the build-only PRAGMAs don't leak into production. Catalog target: ~4–7 min off the 519k-address + 45k-intersection rebuild.
- **OPT-052** — `build_tree_canopy.fetch_and_bake` now submits all three `_fetch_chunk` calls to a `ThreadPoolExecutor(max_workers=CHUNK_COUNT)` and accumulates the results sequentially. Fetch is I/O bound (MRLC GeoServer round-trip ~3–10 s each), so 3-way parallelism cuts the fetch step from ~3× the slowest chunk to ~1×. Accumulation stays sequential because `_accumulate` writes to shared `sum_flat`/`cnt_flat` arrays via `+=`, which is not atomic across threads.
- **OPT-053** — `_bake_green_signals` in `fetch_street_graph.py` now flattens all edge geometries into one `(M, 2)` coord array with per-edge offsets, computes per-segment lengths via `np.hypot` + `np.diff` in one C pass, zeros out the cross-edge "seam" diffs so they don't pollute the cumulative-arc-length, then resolves each edge's midpoint via a single `np.searchsorted(cum_global, edge_target)` and vectorized interpolation. No-geometry edges (rare — endpoint-only routing edges) get a vectorized endpoint midpoint via `vx_lons/vx_lats` numpy slices.
- **OPT-030** — The catalog's specific recipe ("`scipy.spatial.KDTree(park_centroids)`, query all edge midpoints in one numpy call") was course-corrected: switching from polygon-distance to centroid-distance would change the math for large parks (e.g. Lincoln Park's centroid is ~1 km from edges that actually touch its boundary). Shipped the same intent — batch the lookup — via shapely 2.x's vectorized `STRtree.nearest(point_array)` followed by `shapely.distance(points, nearest_polys)`, preserving the original "distance to polygon edge" semantics exactly. The downstream log10(acres) / multiplier / clip pipeline is now a vectorized numpy chain.

**Verification:** Apples-to-apples comparison of OLD vs NEW `_bake_green_signals` on the same int32-roundtripped inputs (extracted from the pre-rebuild pickle so both functions see identical bytes):

| Output | Max abs diff | Mean abs diff | Notes |
|--------|--------------|---------------|-------|
| `edge_park_proximity_f32`  | 3.7e-9 | 6.1e-14 | bit-identical (float32 noise) |
| `edge_tree_canopy_f32`     | 1.6e-2 | 1.6e-7  | mean is float32 noise; max of 1.6% affects a handful of edges that sit exactly on a canopy-cell boundary where the slightly-different vectorized midpoint shifts which cell wins |

Old bake: 22.4 s. New bake: 7.4 s on the same input. **~3× speedup** (catalog target: 2–5 min off the yearly graph bake, which dominates the bake step; the FTS5 + MRLC speedups stack on top). Backend suite (319 tests) green against the rebuilt pickle.

**Artifact rotation:** Rebuilt `backend/street_graph_igraph.pkl` (~28 MB) via `_rebuild_pickle_from_graphml()` in 115 s end-to-end. New SHA-256: `3d10cfbf1c9bafe87c53dde365efd05d6854c81f094d4cfe8993990ebadf37f6` (previous: `415d8be872887b6e0cfc3456954c26101d420584726aed0ae309d50e948b3eba`). Updated `backend/.env` `STREET_GRAPH_SHA256` locally.

**Operator follow-up (CHUNK-10 deploy):**
1. Upload the new `backend/street_graph_igraph.pkl` to the `street-graph` GitHub release tag (overwrite the existing asset).
2. Update the `STREET_GRAPH_SHA256` Railway service variable to `3d10cfbf1c9bafe87c53dde365efd05d6854c81f094d4cfe8993990ebadf37f6`.
3. Then push CHUNK-10's code changes. Railway rebuilds: the curl fetches the new pickle, the build-time hash check matches, and the worker loads cleanly. Failure to do steps 1–2 before pushing will degrade routing to haversine until corrected (see CLAUDE.md "Pickle integrity check").

`ARTIFACT_REV` is already at `2026-05-23` from CHUNK-03, so no extra cache-busting needed — the SHA-256 change interpolated into the curl RUN busts the artifact-layer cache on its own.

PV-012 covers the production sign-off (Lakeview East → Lincoln Park greenest fixture after the new pickle deploys).

---

### 2026-05-23 · Dockerfile artifact `curl` reordered before `COPY . .` (OPT-027 from CHUNK-09 of 2026-05-22 audit)

**Files:** [backend/Dockerfile](../../backend/Dockerfile), [backend/.dockerignore](../../backend/.dockerignore), [CLAUDE.md](../../CLAUDE.md)

**Impact:** 🔴 High

**Category:** Docker layer caching / Deploy time

**What was inefficient:** The `ARG ARTIFACT_REV` + `ARG STREET_GRAPH_SHA256` + curl `RUN` block sat after `COPY . .` in the Dockerfile. BuildKit keys each layer on the command string + the cumulative state of its parent layers, so any code change invalidated `COPY . .` and every layer downstream — including the ~100 MB curl that fetched `street_graph_igraph.pkl` (~28 MB), `chicago_geocode.db` (~72 MB), and `chicago_boundary.json`. A code-only Railway deploy paid the full re-download (~2–5 min) every time.

**Implemented:** Moved the artifact section in [backend/Dockerfile](../../backend/Dockerfile) so the `RUN curl ...` (and its `ARG` declarations) sit immediately after `RUN pip install` and before `COPY . .`. Added `mkdir -p data` at the top of the curl `RUN` since the `data/` directory now doesn't exist yet at that point (it lived in the source tree and arrived with `COPY . .`). The build-time SEC-001 SHA-256 check still fires — `STREET_GRAPH_SHA256` is still interpolated into the same `RUN`, so a hash rotation busts the layer's cache on its own and `ARTIFACT_REV` is now the only knob for a `.db` / boundary refresh.

Defensively expanded [backend/.dockerignore](../../backend/.dockerignore) to exclude the three release-fetched artifacts (`data/chicago_geocode.db*`, `data/chicago_boundary.json`) so a local `docker build` cannot overlay the curl-fetched bytes with a developer's local copies on the subsequent `COPY . .`. `street_graph_igraph.pkl*` was already excluded. Without this, the developer's local `data/chicago_boundary.json` (regenerable via the build script) would silently replace the curl-fetched copy; that's the kind of "wait, why does my prod look different from my local image" foot-gun the layer reorder would otherwise introduce.

Updated the matching paragraph in [CLAUDE.md](../../CLAUDE.md) "Greenest-routing graph release runbook" → "What this means for refreshes" to reflect that `ARTIFACT_REV` is now the **only** knob that busts the artifact-layer cache for a `.db` / boundary refresh (code changes used to bust it incidentally; they no longer do).

**Verification:** Backend suite (319 tests) green (Python code unchanged). The actual deploy-time savings (~2–5 min on code-only Railway pushes) materialize on the next push to main — the first deploy after the reorder will still pay the full curl since `ARTIFACT_REV` was bumped to `2026-05-23` in CHUNK-03; subsequent code-only deploys reuse the cached artifact layer.

---

### 2026-05-23 · Multi-worker uvicorn + dedicated heatmap pool + middleware reorder (OPT-035, OPT-043, OPT-044, OPT-069 from CHUNK-08 of 2026-05-22 audit)

**Files:** [backend/Dockerfile](../../backend/Dockerfile), [backend/main.py](../../backend/main.py), [backend/.env.example](../../backend/.env.example), [CLAUDE.md](../../CLAUDE.md), [docs/Pending_Verification.md](../Pending_Verification.md)

**Impact:** 🔴 High (OPT-035) + 🟡 Medium (OPT-043, OPT-044, OPT-069)

**Category:** Throughput / Concurrency / Middleware ordering / Per-request CPU

**What was inefficient:** uvicorn launched as a single worker, leaving Railway's vCPUs idle on CPU-bound routing + isochrone work (OPT-035). The five `/explore` heatmap futures shared the default loop executor, where they could queue behind unrelated work under load (OPT-069). CORS was registered first, so it ran innermost — OPTIONS preflights paid the security-headers + GZip cost before short-circuiting (OPT-043). The slowapi limiter key function re-parsed `X-Forwarded-For` (split + strip + list-comp) on every request, including `/health` polling traffic (OPT-044).

**Implemented:**
- **OPT-035** — [backend/Dockerfile](../../backend/Dockerfile) `CMD` is now `["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8000 --no-access-log --log-level warning --workers ${UVICORN_WORKERS:-2}"]`. Shell form is required so `${UVICORN_WORKERS:-2}` interpolates; `exec` replaces sh with uvicorn so SIGTERM reaches uvicorn directly. Default 2 workers fits Railway's smallest 2-vCPU plan; the env var lets operators tune up on bigger plans. `UVICORN_WORKERS` documented in [backend/.env.example](../../backend/.env.example).
- **OPT-069** — Module-level `_heatmap_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="heatmap")` in [backend/main.py](../../backend/main.py). `/explore`'s five `loop.run_in_executor(None, _clip, …)` calls switched to `loop.run_in_executor(_heatmap_pool, _clip, …)`. Multi-worker uvicorn gives each process its own pool, so concurrent capacity scales as `workers × 8 heatmap threads`.
- **OPT-043** — Middleware registration order reversed so CORS is the **last** `add_middleware` call (Starlette LIFO → CORS is outermost on the request side, short-circuits OPTIONS preflights without entering GZip or security-headers). New file-order top-to-bottom: `stash_client_ip` decorator → `add_security_headers` decorator → `GZipMiddleware` → `CORSMiddleware`. Verified by smoke test: OPTIONS response carries only CORS headers (no `X-Content-Type-Options`, no GZip).
- **OPT-044** — New `stash_client_ip` HTTP middleware sets `request.state.client_ip = _client_ip(request)` once per request. Limiter `key_func` is now `_client_ip_key`, which reads the cached value with a defensive fallback to the direct parse for the rate-limit-exceeded handler path. Saves the split-strip-list-comp work on every `@limiter.limit(...)` decorator invocation.

Backend suite (319 tests) green. Smoke: heatmap pool reports `max_workers=8`, OPTIONS preflight returns 200 with CORS headers only, POST `/route` returns 200 with `Content-Encoding: gzip` + `X-Content-Type-Options: nosniff`.

**Doc impact landed in the same chunk:**
- [`backend/.env.example`](../../backend/.env.example) — documented `UVICORN_WORKERS` next to the existing `TRUSTED_PROXY_HOPS` block.
- [`CLAUDE.md`](../../CLAUDE.md) "Running Locally" — noted that production runs `--workers ${UVICORN_WORKERS:-2}` and the local `uvicorn --reload` stays single-process (it is incompatible with multi-worker).
- [`docs/Pending_Verification.md`](../Pending_Verification.md) — added PV-011 covering the Railway memory headroom check, `hey -c 4 -n 100` p95 stability, OPTIONS-short-circuit verification, and `TRUSTED_PROXY_HOPS` smoke under the live proxy chain.

---

### 2026-05-23 · Lifespan warm-up + awaited graph preload (OPT-034, OPT-050, OPT-054 from CHUNK-07 of 2026-05-22 audit)

**Files:** [backend/main.py](../../backend/main.py)

**Impact:** 🔴 High (OPT-034) + 🟡 Medium (OPT-050, OPT-054)

**Category:** Cold-start latency

**What was inefficient:** The lifespan only scheduled `_preload_graph` via `asyncio.ensure_future` — the first `/route` arriving during load raced the preloader for `_graph_lock` (OPT-050). Heatmap STRtrees (places, residential, parks, green-space, tree canopy) and the Chicago boundary JSON parse were all lazy on the first `/explore`, adding ~200–500 ms to that cold-start request (OPT-034 + OPT-054).

**Implemented:** Reshaped `lifespan` in [backend/main.py](../../backend/main.py) so the container blocks on the graph load once, then warms every clipper index in parallel via `loop.run_in_executor`:

```python
await loop.run_in_executor(None, _preload_graph)
results = await asyncio.gather(
    *(loop.run_in_executor(None, fn) for _, fn in _WARMERS),
    return_exceptions=True,
)
```

The `_WARMERS` tuple drives six tasks in parallel: `places._ensure_index`, `places._ensure_residential_index`, `parks._ensure_index`, `green_space._ensure_index`, `tree_canopy._ensure_index`, `explore._get_chicago_boundary`. Each warmer's per-module lazy path still works as a fallback when its `run_in_executor` raises — the failure is logged but doesn't block boot. Added explicit `import places, parks, green_space, tree_canopy, explore` lines so the module references are available for the warm-up alongside the existing `from … import …` function aliases.

**Cold-start measurement (local TestClient):**

| Phase | Before | After |
|-------|--------|-------|
| `lifespan` setup (`yield`)   | ~instant (preload scheduled) | ~2.6 s (preload awaited + warmers) |
| First `/explore` after deploy | ~700–900 ms (catalog estimate) | 218 ms (measured) |
| Subsequent `/explore`         | ~250 ms                       | 260 ms (unchanged) |

**OPT-054** is covered by OPT-034's lifespan warmer firing `explore._get_chicago_boundary` once at boot — the existing module-level `_boundary` / `_boundary_loaded` cache then services every subsequent call. The catalog's "top-level `_BOUNDARY = _load_boundary()`" recipe wasn't needed since the lazy cache plus the lifespan call gives the same eager-load behavior.

**Trade-off documented in the catalog and confirmed:** container start-up grows by the graph-load duration (~2.5 s on Railway's hardware). `/health` only returns after `lifespan` yields, so the container reports healthy only once everything is warm — that's strictly better than the prior "healthy → 700 ms `/explore` cold-start tax" race. Backend suite (319 tests) green.

---

### 2026-05-23 · numpy + shapely micro-optims across the explore hot path (OPT-033, OPT-046, OPT-048, OPT-051, OPT-080 from CHUNK-06 of 2026-05-22 audit)

**Files:** [backend/explore.py](../../backend/explore.py), [backend/places.py](../../backend/places.py), [backend/walking.py](../../backend/walking.py), [backend/tree_canopy.py](../../backend/tree_canopy.py)

**Impact:** 🔴 High (OPT-033) + 🟡 Medium (OPT-046, OPT-048, OPT-051, OPT-080)

**Category:** Hot-path compute / Vectorization

**What was inefficient:** Five small but stacked inefficiencies across the `/explore` flow each kept work in Python that shapely 2.0 / numpy 2.x can do in C: a `np.asarray(list_of_python_floats)` double-walk over the Dijkstra distance row (OPT-033), a `prepared.intersects()` second filter on candidates already narrowed by STRtree (OPT-046), two Python list comprehensions over the post-filter edgelist (OPT-048), a per-cell `box(...)` constructor on every canopy cell (OPT-051), and a per-place `Point(p["lon"], p["lat"])` in the places STRtree build (OPT-080).

**Implemented:**
- **OPT-033** — `_reachable_indices` in [backend/explore.py](../../backend/explore.py) now consumes the distance row via `np.fromiter(row, dtype=np.float64, count=len(row))` — pre-allocates the buffer, skips the intermediate-list walk that `np.asarray` does internally. igraph 1.0.0 has no `output="numpy"` mode on `distances()`, so the catalog's "numpy output if supported" branch defers to the `np.fromiter` fallback.
- **OPT-046** — Dropped the `prepared = prep(polygon)` / `if not prepared.intersects(poly): continue` second filter in `places.residential_heatmap`. STRtree already returns only bbox-overlapping candidates, and `polygon.intersection(poly)` short-circuits internally on disjoint pairs.
- **OPT-048** — `_populate_edge_caches` (v1 / graphml path) now does `el = np.asarray(G.get_edgelist(), dtype=np.int32)` once, then `_edge_sources = el[:, 0]` / `_edge_targets = el[:, 1]` — one C-level traversal of the edgelist instead of two Python list comprehensions.
- **OPT-051** — `tree_canopy_in_polygon` now bulk-builds per-cell squares via `shapely.box(xmin, ymin, xmax, ymax)` (the catalog's "pre-template + affine translate" recipe is actually slower than `box(...)`; the real win is shapely 2.0's vectorized constructor — **60× faster** in a microbench on 5,000 cells). Band bucketing moved to a vectorized `np.where`-chain over `DENSITY_BANDS`. The dead `_band_for_density` helper was removed.
- **OPT-080** — `places._ensure_index` now does `coords = np.fromiter(...)` (interleaved lon/lat) → `shapely.points(coords)` — **~20× faster** than `[Point(p["lon"], p["lat"]) for p in places]` on the ~16k Chicago places (190 ms → 10 ms in microbench). The `Point` import stays in `places.py` (annotated `# noqa: F401`) because `test_places.py` accesses it as `places.Point` for its own point-containment assertions.

Backend suite (319 tests) green after the fixes. Wire smoke: 25-min Logan Square `/explore` now lands in ~235 ms with valid canopy bands and 18.8 KB on the wire — the bulk-box path produces the same MultiPolygon shape the unioned per-cell loop did.

**Catalog course correction noted in the diff:** OPT-051's "pre-template a unit square + affine translate" recipe was specifically benchmarked and found to be ~1.5× *slower* than `box(...)`. Shapely 2.0's vectorized `shapely.box(arrays...)` was the actual win path. The catalog's underlying goal (eliminate per-cell Python construction) was correct; the proposed recipe was not.

---

### 2026-05-23 · `walking._flavor_weights` cache reshape — pre-bake green mask + float32 + versioned LRU (OPT-031, OPT-032, OPT-045, OPT-068 from CHUNK-05 of 2026-05-22 audit)

**Files:** [backend/walking.py](../../backend/walking.py)

**Impact:** 🔴 High (OPT-031, OPT-032) + 🟡 Medium (OPT-045, OPT-068)

**Category:** Hot-path compute / Memory & eviction / Lock contention

**What was inefficient:** The greenest weight build paid four small but stacked costs on every cache miss: a per-call `np.asarray(canopy, dtype=np.float32)` copy on already-float32 columns (OPT-031), a Python list comprehension over ~230k highway tag strings to rebuild the green-edge boolean mask (OPT-032), an unbounded `dict` cache that could accumulate stale-version entries forever after graph reloads (OPT-045), and a `len(cached) == G.ecount()` length check inside the DCL on every cache lookup (OPT-068).

**Implemented:**
- **OPT-031** — `_populate_edge_caches_v2` now calls `np.asarray(canopy_raw, dtype=np.float32)` / `np.asarray(parks_raw, dtype=np.float32)` once at load (no-op for already-float32 pickled arrays, but kills the defensive `.astype()` copies that used to run per cache miss). `_build_flavor_weights` consumes the pre-cast columns directly: `_GREEN_CANOPY_WEIGHT * canopy`, no inline cast.
- **OPT-032** — Added `_edge_green_mask: np.ndarray | None` global. `_populate_edge_caches_v2` bakes it once via `np.fromiter((1 if h in _GREEN_HIGHWAYS else 0 for h in _edge_highways), dtype=np.uint8, count=len(_edge_highways))`. The greenest branch reads `_edge_green_mask` instead of rebuilding the comprehension. A length-mismatch fallback rebuilds locally so monkeypatched test fixtures (which set `_edge_highways` to small arrays without touching the cached mask) still work.
- **OPT-045** — `_flavor_weights` is now an `OrderedDict` capped at `_FLAVOR_WEIGHTS_MAXSIZE = 8` entries. Overflow drops the oldest entry via `.popitem(last=False)` so cross-eviction-cycle stale-version entries cannot leak.
- **OPT-068** — Added `_graph_version: int` global, bumped at the end of both `_populate_edge_caches` (v1) and `_populate_edge_caches_v2`. The `_flavor_weights` cache key is now `(flavor, _graph_version)`, so a hit guarantees the entry was built against the currently-loaded graph — the `len(cached) == G.ecount()` check is gone from both the fast path and the DCL inner check.

Smoke check on a real load (232,759 edges): cold greenest build ~2.3 ms; warm hit ~10 µs; `_edge_green_mask` shape (232759,) dtype uint8; `_edge_tree_canopy` dtype float32 at load; cache key `('greenest', 1)`. Backend suite (319 tests, including `test_walking_greenest.py`'s NaN/Inf sanitization fixture which monkey-patches the edge columns) all green.

**Out of scope:** `_combined_weights` (the avoid_stairs variant cache in `_get_avoid_stairs_weights`) still uses the legacy `dict` + `len(cached) == G.ecount()` shape. The catalog called it out for OPT-045 by mentioning `…variant…` in the cache key, but kept its concrete fix scoped to `_flavor_weights`. A future pass could unify the two caches under the same `(key, _graph_version)` shape if the duplication becomes load-bearing.

---

### 2026-05-23 · Pre-baked JSON artifacts minified (OPT-028, OPT-072 from CHUNK-04 of 2026-05-22 audit)

**Files:** [backend/scripts/build_places_osm.py](../../backend/scripts/build_places_osm.py), [backend/scripts/_curated_common.py](../../backend/scripts/_curated_common.py), [backend/scripts/build_community_area_centroids.py](../../backend/scripts/build_community_area_centroids.py), [backend/data/places_osm.json](../../backend/data/places_osm.json), [backend/data/places_curated.json](../../backend/data/places_curated.json), [backend/data/community_area_centroids.json](../../backend/data/community_area_centroids.json)

**Impact:** 🔴 High (OPT-028) + 🟢 Low (OPT-072)

**Category:** Artifact size / Startup parse cost

**What was inefficient:** Three build scripts wrote their JSON output with `indent=2`, adding ~30–40% pure whitespace bloat. `places_osm.json` (3.35 MB) is parsed at backend startup by `places.py` and the indentation lengthened both the on-disk artifact and the startup parse path. `places_curated.json` and `community_area_centroids.json` carried the same pattern. Every other build script in `scripts/` had already moved to `separators=(",", ":")` — these three were the holdouts.

**Implemented:** Swapped `indent=2` → `separators=(",", ":")` in:
- [backend/scripts/build_places_osm.py:356](../../backend/scripts/build_places_osm.py#L356) (OPT-028)
- [backend/scripts/_curated_common.py:64](../../backend/scripts/_curated_common.py#L64) (OPT-028)
- [backend/scripts/build_community_area_centroids.py:77](../../backend/scripts/build_community_area_centroids.py#L77) (OPT-072)

Re-emitted each artifact by round-tripping the existing JSON through the new separators (content-preserving — equivalent to re-running the build scripts modulo external-data drift, which we deliberately avoided so the on-disk data stays identical to the most recent fetched snapshot):

| Artifact | Before | After | Reduction |
|----------|--------|-------|-----------|
| `places_osm.json` | 3,354,202 B | 2,287,226 B | 31.8% |
| `places_curated.json` | 561,940 B | 378,930 B | 32.6% |
| `community_area_centroids.json` | 4,308 B | 2,689 B | 37.6% |

Backend suite (319 tests) still green — `places.py` happily parses the minified artifacts.

---

### 2026-05-23 · Geometry precision + heatmap simplification + boundary simplify (OPT-024, OPT-026, OPT-083 from CHUNK-03 of 2026-05-22 audit)

**Files:** [backend/utils.py](../../backend/utils.py), [backend/main.py](../../backend/main.py), [backend/places.py](../../backend/places.py), [backend/parks.py](../../backend/parks.py), [backend/green_space.py](../../backend/green_space.py), [backend/heatmap_clipper.py](../../backend/heatmap_clipper.py), [backend/scripts/build_chicago_boundary.py](../../backend/scripts/build_chicago_boundary.py), [backend/data/chicago_boundary.json](../../backend/data/chicago_boundary.json), [backend/Dockerfile](../../backend/Dockerfile)

**Impact:** 🔴 High

**Category:** Network payload / Geometry detail / Artifact size

**What was inefficient:** GeoJSON coordinates in every `/route` and `/explore` response shipped at full float64 (15+ digits), even though the UI never renders below ~1 m precision. Heatmap polygons (residential, parks, green-space) emitted at full OSM/CPD ring detail (often hundreds of vertices per polygon). And `chicago_boundary.json` carried sub-meter ring detail wasted on the lakefront-clip step that only needs ~10 m precision.

**Implemented:**
- **OPT-024** — Added `quantize_geojson(obj, decimals=5)` to [backend/utils.py](../../backend/utils.py) — a recursive helper that rounds every float to 5 decimals (~1.1 m precision). Wrapped both `/route` response builders (2-stop + multi-stop) and the `/explore` response in [backend/main.py](../../backend/main.py). Walking-graph coords were already at 5 decimals coming out of `walking.py`, so `/route` payload bytes are unchanged in practice; the win lands on `/explore` where OSM heatmap polygons can carry higher precision.
- **OPT-026** — Added `RESIDENTIAL_SIMPLIFY_TOLERANCE = 0.0005` (`places.py`), `PARKS_SIMPLIFY_TOLERANCE = 0.0005` (`parks.py`), `GREEN_SPACE_SIMPLIFY_TOLERANCE = 0.0005` (`green_space.py`) — ~5 m Douglas–Peucker tolerance, well below zoom-12–15 rendering resolution. `heatmap_clipper.clip_polygons_to_feature_collection` grew a `simplify_tolerance: float | None = None` kwarg and applies `.simplify(tol, preserve_topology=True)` on each unioned Feature geometry before `mapping()`. `places.residential_heatmap` (own pipeline, MultiPolygon output) inlines the same simplify call before `mapping(merged)`. Per-file tunable so each clipper can pick its own tolerance.
- **OPT-083** — Added `BOUNDARY_SIMPLIFY_TOLERANCE = 0.0001` (~10 m) in [backend/scripts/build_chicago_boundary.py](../../backend/scripts/build_chicago_boundary.py); the simplify runs after `assemble()` and before `mapping()`. Rebuilt `chicago_boundary.json` locally via Overpass — file dropped from **87,162 bytes to 16,479 bytes** (~81% reduction). Bumped `ARG ARTIFACT_REV=2026-05-20 → 2026-05-23` in [backend/Dockerfile](../../backend/Dockerfile) so BuildKit's curl-layer cache busts and the next deploy fetches the new artifact. The `street-graph` GitHub release upload + push is the operator's step (see CLAUDE.md "Greenest-routing graph release runbook" for refresh procedure).

Backend suite (319 tests) green after the changes. Wire smoke: 20-min Logan Square `/explore` ships at 13,432 wire bytes / 81,124 decoded bytes — the catalog's 30–50 KB post-gzip estimate scales with isochrone size + heatmap density, so the savings on smaller isochrones are correspondingly smaller. Visual fidelity at zoom 12–18 unchanged (the Douglas–Peucker tolerances are below the rendering resolution).

**Operator follow-up (OPT-083 deploy):** Upload the regenerated [backend/data/chicago_boundary.json](../../backend/data/chicago_boundary.json) to the `street-graph` GitHub release (overwrite the existing asset), then push the `ARTIFACT_REV` bump. Until the release asset is overwritten, a Railway deploy will fetch the old (87 KB) boundary; the new build script change only affects future locally-built artifacts.

---

### 2026-05-23 · GZipMiddleware + ORJSONResponse on FastAPI (OPT-022, OPT-023 from CHUNK-02 of 2026-05-22 audit)

**Files:** [backend/main.py](../../backend/main.py), [backend/requirements.txt](../../backend/requirements.txt)

**Impact:** 🔴 High

**Category:** Network payload / Response serialization

**What was inefficient:** `app = FastAPI(lifespan=lifespan)` defaulted to `JSONResponse` (stdlib `json.dumps`, ~3× slower than orjson on the GeoJSON-heavy responses Passage emits) and no compression middleware was registered, so `/explore` payloads with all four heatmap layers shipped as 500 KB – 2 MB of uncompressed JSON.

**Implemented:** Added `from fastapi.middleware.gzip import GZipMiddleware` and `from fastapi.responses import ORJSONResponse` imports in [backend/main.py:8-11](../../backend/main.py#L8-L11). The FastAPI init line is now `FastAPI(lifespan=lifespan, default_response_class=ORJSONResponse)`. `app.add_middleware(GZipMiddleware, minimum_size=500)` is registered after CORS so it sits adjacent to the existing middleware stack. `orjson>=3.10,<4.0` is now pinned in [backend/requirements.txt](../../backend/requirements.txt) — it wasn't a transitive dep of FastAPI 0.136.

Smoke test confirmed gzip is active: a 2-stop `/route` response compressed from 24,251 bytes to 3,305 bytes on the wire (~7.3× reduction; matches the catalog's 5–10× estimate). Backend suite (319 tests) still green.

**Known follow-up:** FastAPI 0.136 emits a `FastAPIDeprecationWarning` advising that `ORJSONResponse` is deprecated in favor of Pydantic-driven serialization triggered by explicit response models or return type annotations. The warning is informational — orjson still serves the response — but a future pass should either (a) annotate every endpoint's return type / add response_model entries so FastAPI uses Pydantic's native fast serializer directly, or (b) keep `ORJSONResponse` until FastAPI actually removes it. Not in scope for CHUNK-02; left as a tech-debt candidate.

---

### 2026-05-23 · Zero-risk one-shot bundle from CHUNK-01 (OPT-047, -049, -070, -071, -075, -077, -079, -081, -082, -086 from 2026-05-22 audit)

**Files:** [backend/requirements.txt](../../backend/requirements.txt), [backend/Dockerfile](../../backend/Dockerfile), [backend/geocoding.py](../../backend/geocoding.py), [backend/local_search.py](../../backend/local_search.py), [backend/main.py](../../backend/main.py), [frontend/src/lib/explorePrefs.js](../../frontend/src/lib/explorePrefs.js), [frontend/src/MapView.jsx](../../frontend/src/MapView.jsx)

**Impact:** 🟡 Medium (bundled — each item individually 🟢 Low or 🟡 Medium)

**Category:** Mixed — image size, image reproducibility, SQLite hints, allocation waste, worst-case input handling, idle-state hygiene

**What was inefficient:** Ten distinct single-file nits surfaced in the 2026-05-22 three-pass audit, each too small to merit its own PR but collectively worth one bundled cleanup pass (CHUNK-01 in [`Efficiency_Roadmap.md`](../Efficiency_Roadmap.md)).

**Implemented:**
- **OPT-070** — Removed `osmnx==2.1.0` from [backend/requirements.txt](../../backend/requirements.txt); it was already pinned in `requirements-dev.txt`. `osmnx` is only imported by `fetch_street_graph.py` (developer build script) — pulling it into the prod image dragged in ~100–200 MB of transitive deps (networkx, geopandas, fiona, rtree) that runtime never used.
- **OPT-071** — Pinned the Dockerfile base image from `python:3.11-slim` to `python:3.11.13-slim`. Layer caches + behavioral guarantees no longer drift with the patch float; review quarterly per the catalog.
- **OPT-082** — `_close_cache_db()` in [backend/geocoding.py](../../backend/geocoding.py) now runs `PRAGMA wal_checkpoint(TRUNCATE)` before `db.close()`. Cheap, idempotent, keeps the `.wal` sidecar from growing across crash-recovery cycles.
- **OPT-081** — Added `PRAGMA query_only=1` to the `local_search._connect()` connection alongside the existing `mmap_size` / `temp_store` pragmas. The connection already opens `mode=ro` (file-level read-only); the planner hint lets SQLite skip write-related validations.
- **OPT-075** — Replaced `JSON.parse(JSON.stringify(DEFAULT_PREFS))` in [frontend/src/lib/explorePrefs.js](../../frontend/src/lib/explorePrefs.js) with `Object.freeze(DEFAULT_PREFS)`. `EXPLORE_DEFAULTS` is never mutated in the codebase (always spread via `...EXPLORE_DEFAULTS`), so freezing the source object is the mutation-prevention semantics the deep-clone was approximating without the per-import allocation.
- **OPT-047** — Added an `if not q_words: return None, None` early-return in `fuzzy_match_neighborhood` ([backend/geocoding.py](../../backend/geocoding.py)). Stop-word-only or whitespace-only queries no longer walk all ~150 NEIGHBORHOOD_COORDS entries against `SequenceMatcher.ratio()`.
- **OPT-049** — Dropped redundant `list(...)` wraps in the `/route` response builder ([backend/main.py](../../backend/main.py)): `stops_out`, `stop_coords_out`, `origin_out`, `dest_out`, both `list(directions)` calls (custom-pref alternative + per-leg builder), `list(leg_slices[i])`, and `list(FLAVORS)`. Both stdlib `json.dumps` and orjson encode tuples and lists identically, so the wraps were pure allocation waste — ~8–16 fewer small lists per request.
- **OPT-077** — Added a `gestureLockedRef` in [frontend/src/MapView.jsx](../../frontend/src/MapView.jsx) that tracks the last-applied lock state. The gesture-sync effect (and `handleUnlock`) now skip MapLibre's six-call lock/unlock sequence when the target state matches the cached state. The init effect's `lockMapGestures(map)` call sets gestures to locked, matching the ref's initial value of `true`.
- **OPT-086** — Replaced `q.lstrip().split(None, 1)[0]` in `_looks_like_free_text_address` with a generator-based scan of the first non-whitespace character. No list allocation per `/autocomplete` call.
- **OPT-079** — Inlined the dedupe in `local_search.autocomplete` at source-merge time via a nested `_add()` helper carrying `seen_keys` / `seen_labels` sets. The post-sort `_dedupe()` helper (and its sole caller) were removed; the `from typing import Iterable` import went with it. Dupes are skipped before the suggestion list grows, so peak working-set is smaller on short queries that traverse large bisect windows.

Backend suite (319 tests) and frontend suite (460 tests) both green after the bundle. The catalog item OPT-074 (oxipng pass over the PWA icons) was deferred — oxipng is not installed locally and the user opted to defer rather than install a system-wide binary for a 2–4 KB win.

---

### 2026-05-18 · Production Dockerfile rebuilt the `.pkl` in-container instead of fetching it prebuilt (OPT-001, post-FEAT-4 candidates scan)

**Files:** [backend/Dockerfile](../../backend/Dockerfile), [CLAUDE.md](../../CLAUDE.md), [README.md](../../README.md)

**Impact:** 🟡 Medium

**Category:** Slow cold-start

**What was inefficient:** The Dockerfile fetched `street_graph.graphml` (~314 MB raw / ~79 MB compressed) from the `street-graph` GitHub release tag and ran `python fetch_street_graph.py` to produce `street_graph_igraph.pkl` in the container — an osmnx graphml load + intersection consolidation + dedup + the FEAT-4 canopy/park bake on every deploy (~100 s of cold-start work on a Railway build). Every deploy paid this cost, even when neither the graph nor the canopy/parks data had changed.

**Implemented:** Shipped via commit `6eb8f5e` (the FEAT-4 production-rollout discovery that the in-container bake was not bit-identical with the locally-baked `.pkl` and so failed SEC-001's SHA-256 check on Railway). [backend/Dockerfile](../../backend/Dockerfile) now `curl`s the prebuilt `street_graph_igraph.pkl` (~28 MB) from the same `street-graph` release tag the `.graphml` used to live on; the in-container `fetch_street_graph.py` invocation is gone. `.graphml` was dropped from the release entirely — it stays as an off-repo local working file on the developer machine, regenerable via `python fetch_street_graph.py --force` from OSMnx. Builds are roughly 5–10× faster and bit-identical across deploys, which the SEC-001 hash check now requires. The [CLAUDE.md](../../CLAUDE.md) "Greenest-routing graph release runbook" — build chain, refresh procedures, hash rotation, deploy checklist, rollback — was rewritten to describe the new flow (rebuild `.pkl` locally → upload to release → rotate `STREET_GRAPH_SHA256` → push). Tradeoffs land where the scoping pass expected: every canopy/parks data refresh now requires a manual re-bake-and-upload step, but in practice both datasets have been refreshed only once each since the project started.

---

### 2026-05-13 · `autocomplete` linearly scanned the entire POI + neighborhood indexes on every keystroke (OPT-001, backend scan)

**File:** [backend/local_search.py](../../backend/local_search.py)

**Impact:** 🔴 High

**Category:** Inefficient Data Structure

**What was inefficient:** `autocomplete()` walked `_neighborhood_index` (~150 entries) and `_poi_index` (~5–10k entries) end-to-end on every keystroke, doing `name.startswith(q_lower)` per entry. Both indexes are sorted by lowercased name, but the ordering wasn't used — the `len(suggestions) >= limit * 4` cap only short-circuited when matches were dense, which is rare for short queries and never for sparse-match queries.

**Implemented:** Added parallel `_neighborhood_keys` / `_poi_keys` arrays populated alongside the existing sorted tuple lists in `_ensure_in_mem_index`. New `_prefix_window(keys, q)` uses `bisect.bisect_left` to find the start of the prefix window and walks forward until the prefix stops matching, returning `(lo, hi)` in O(log N + k). The neighborhood and POI prefix loops in `autocomplete()` now iterate only `range(lo, hi)` instead of the full index. Per-keystroke work dropped from O(N) to O(log N + k). The capped-iteration safeguard for common short prefixes (e.g. "the") stayed in place inside the POI loop.

---

### 2026-05-13 · Tree-canopy cells held as list of dicts instead of parallel numpy columns (OPT-002, backend scan)

**File:** [backend/tree_canopy.py](../../backend/tree_canopy.py)

**Impact:** 🟡 Medium

**Category:** Memory Bloat

**What was inefficient:** Each canopy cell was a `dict` with three float values (`lat`, `lon`, `density`) — ~250 B/cell of PyDict + PyFloat overhead × the ~30k cells in the Chicago artifact added up to several MB of working-set memory for data that's intrinsically three parallel float columns. The runtime hot path read those values by index in a tight loop, never used dict semantics.

**Implemented:** Replaced `_cells: list[dict]` with three contiguous `np.ndarray` float64 columns: `_cell_lats`, `_cell_lons`, `_cell_densities`. `_ensure_index` collects raw values into three temporary Python lists during the JSON parse, then materializes the numpy columns at the end. The centroid list stayed as `list[Point]` because STRtree needs individual geometries. `tree_canopy_in_polygon` reads `densities[i]`, `lats_col[i]`, `lons_col[i]` by integer index — cuts canopy index memory by ~3–5× and removes the per-cell dict lookup. `reset_index_for_tests` updated to clear the new globals.

---

### 2026-05-13 · `residential_heatmap` skipped the `prepared.intersects` prefilter (OPT-003, backend scan)

**File:** [backend/places.py](../../backend/places.py)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** After `STRtree.query()` returned bbox-overlapping candidates, the loop unconditionally called the expensive `polys[i].intersection(polygon)` and then checked `clipped.is_empty`. The bbox-overlap-but-actually-disjoint case is real (long thin residential polygons that hug but don't cross the isochrone bbox edge), and `intersection()` is materially more expensive than `intersects()`. `parks.py` and `green_space.py` already used the prefilter — `places.py` was the outlier.

**Implemented:** Added `prepared = prep(polygon)` once before the loop and `if not prepared.intersects(poly): continue` as a cheap guard before the `.intersection()` call — same pattern as `parks_in_polygon` and `green_space_in_polygon`.

---

### 2026-05-13 · `concave_hull` imported inside the explore hot path (OPT-004, backend scan)

**File:** [backend/explore.py](../../backend/explore.py)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `from shapely import concave_hull` lived inside `_hull_polygon`, behind a `try/except ImportError`. The function ran once per uncached `/explore` request. Python's import cache makes the second-and-onward import cheap, but it was still a module-attribute lookup + try/except wrapper on every call, and shapely ≥ 2.0 is a hard requirement of the file (used elsewhere unconditionally), so the import-guard fallback was dead code.

**Implemented:** Moved `from shapely import concave_hull` to the module-level imports alongside the other shapely imports. Dropped the inner `from shapely import` line; the outer `try / except Exception` around the `concave_hull(...)` call stays — it handles real shapely failures (e.g. degenerate point sets) and falls back to the convex hull as before.

---

### 2026-05-13 · `places._load_all_sources` called `quantize_coord` twice per OSM place (OPT-005, backend scan)

**File:** [backend/places.py](../../backend/places.py)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** The dedupe step built `curated_keys` then iterated `osm` with a list comprehension that re-ran `quantize_coord(p["lat"], p["lon"])` for every OSM entry — even though the comprehension already computed the same tuple to test membership. Startup-only cost (the index build is one-shot per process), but gratuitous, and the pattern read as if it might run hot.

**Implemented:** Replaced the list comprehension with an explicit `for` loop that calls `quantize_coord(p["lat"], p["lon"])` once per OSM entry, binds `(lat_q, lon_q)`, and uses the bound values in the membership test. Each OSM entry now incurs exactly one `quantize_coord` call during the dedupe pass.

---

### 2026-05-13 · Stop draft serialized + written to sessionStorage on every keystroke (OPT-006, frontend scan)

**File:** [frontend/src/App.jsx](../../frontend/src/App.jsx)

**Impact:** 🟡 Medium

**Category:** Inefficient I/O

**What was inefficient:** The `useEffect([stops])` ran on every keystroke in any stop input. Each run called `saveStoredStops(values)`, which built a `{values, savedAt}` envelope, `JSON.stringify`d it, and wrote to sessionStorage. Typing "Lincoln Park" (12 chars) fired 12 stringify+write cycles for a draft whose only job is to survive a reload; `addStop`/`removeStop`/`moveStop` also re-fired the effect.

**Implemented:** Added a `stopDraftTimerRef` that holds the pending `setTimeout` handle and debounces the save by 250 ms. The empty-clear branch (every stop blank → `safeSessionRemove`) stays synchronous so removing all stops wipes the storage entry immediately rather than leaving a stale draft for the debounce window. The effect's cleanup function cancels any pending timer on unmount or re-run so dependency churn doesn't leak timers. Steady-state writes dropped from O(keystrokes) to O(quiet windows).

---

### 2026-05-13 · Active-turn flip rebuilt + re-uploaded the entire turn-points GeoJSON (OPT-007, frontend scan)

**File:** [frontend/src/mapHelpers.js](../../frontend/src/mapHelpers.js), [frontend/src/map/MapRouteLayer.jsx](../../frontend/src/map/MapRouteLayer.jsx)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** `buildTurnsGeoJson(turnCoords, activeTurnIndex)` reconstructed the full `walk-turns` FeatureCollection with `properties.active` baked per feature and called `setData` on the source whenever the user clicked a different direction step in `DirectionLedger`. For a 50-turn route, each click re-ran the dedup loop, allocated a fresh feature collection, and shipped the entire GeoJSON payload to MapLibre — all to flip a single boolean.

**Implemented:** Dropped the `activeTurnIndex` argument from `buildTurnsGeoJson` (kept as a no-op positional in `renderWalkRoute` for backward compat). Features now carry stable `id = i` (matching the original `turnCoords` index) and no `active` property. The `walk-turns-circle` paint expression switched to `["coalesce", ["feature-state", "active"], false]` for radius/color/opacity. `MapRouteLayer`'s active-turn effect now reads a `prevActiveTurnRef` and calls `map.setFeatureState({source: "walk-turns", id}, {active})` to clear the previous feature and set the new one — zero GeoJSON allocation, zero GPU re-upload. `renderWalkRoute` calls `map.removeFeatureState({source: "walk-turns"})` after rebuilding the source so stale states from a previous route can't leak across route swaps. Updated `mapHelpers.test.js` assertions for the new signature.

---

### 2026-05-13 · `AddressAutocomplete` portal position recomputed + re-rendered on every scroll event (OPT-008, frontend scan)

**File:** [frontend/src/components/AddressAutocomplete.jsx](../../frontend/src/components/AddressAutocomplete.jsx)

**Impact:** 🟡 Medium

**Category:** Rendering / Event Handling

**What was inefficient:** The capture-phase `scroll` listener (plus `resize` + `visualViewport.resize` + `visualViewport.scroll`) called `update()` directly on every event, where `update` measured the input's bounding rect and called `setPos({...})`, triggering a React re-render of the listbox. During a WFSheet drag on mobile the chain could fire 60+ times/sec while the listbox was open — each event causing a full setState round trip.

**Implemented:** Wrapped the listeners through a `scheduleUpdate` shim that schedules `update()` via `requestAnimationFrame` and short-circuits if a frame is already pending. The cleanup function cancels the pending rAF on teardown. Re-renders are now capped at one per frame regardless of scroll/resize event density, while the listbox still tracks the input precisely under sheet drags and iOS keyboard transitions.

---

### 2026-05-13 · `ExploreCategoryPanel` re-traversed nested categories on every render (OPT-009, frontend scan)

**File:** [frontend/src/components/ExploreCategoryPanel.jsx](../../frontend/src/components/ExploreCategoryPanel.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** Inside the `.map(group => ...)` JSX, every group ran `group.categories.reduce(...)` plus a per-category `.filter(s => selectedSubSet.has(...))` — ~100 Set lookups per render across the 5 groups, with the panel re-rendering on any parent-state change (route loading flip, sheet drag) even when selection state hadn't moved.

**Implemented:** Added a `groupSelectionCounts` `useMemo` that walks `EXPLORE_GROUPS` once and returns a `Map<groupKey, count>`. Keyed on the primitive heatmap booleans (`heatmapResidential`, `heatmapParks`, `heatmapTreeCanopy`, `heatmapGreenSpace`) plus the selection-set memos, so the parent's inline `heatmapStates` object reference (a new literal every render) doesn't invalidate the cache. JSX reads the count via `groupSelectionCounts.get(group.key) ?? 0`. The nested traversal now runs only when selection state actually changes.

---

### 2026-05-13 · `StepHero` re-formatted `dailyGoal` with `toLocaleString` twice (OPT-010, frontend scan)

**File:** [frontend/src/components/StepHero.jsx](../../frontend/src/components/StepHero.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `const effectiveGoal = (dailyGoal ?? 10_000).toLocaleString();` produced the formatted string, then the JSX rendered `{effectiveGoal.toLocaleString()}` — calling `.toLocaleString()` on a string is a no-op that still routes through `Intl` lookups in some engines. Trivial per-render cost, but the pattern read as a bug because one of the two calls was clearly redundant.

**Implemented:** Dropped the second `.toLocaleString()` from the JSX — `{effectiveGoal}` is the already-formatted string. Single format call per render, identical visible output.

---

### 2026-05-13 · `stopValues` array rebuilt every render in `App.jsx`, invalidating downstream memos (OPT-011, frontend scan)

**File:** [frontend/src/App.jsx](../../frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Rendering

**What was inefficient:** `const stopValues = stops.map(s => s.value);` created a fresh array reference on every `App` render. It was passed into `useShareCard`, where `shareUrl` and the `handleShareCard` callback depended on it via `useMemo`/`useCallback`. Because the reference changed every render, those memos recomputed on unrelated re-renders (Personalize-modal open/close, loading-state flips, sheet drags) — defeating the point of memoizing `shareUrl` at all.

**Implemented:** Wrapped the projection in `useMemo(() => stops.map(s => s.value), [stops])`. Since `setStops` returns a new `stops` reference only on real change, the memoized array now stays referentially stable across unrelated re-renders and the downstream `useShareCard` memos cache as intended.

---

### 2026-05-13 · Route and Explore sidebar JSX trees were both built on every App render (OPT-012, frontend scan)

**File:** [frontend/src/App.jsx](../../frontend/src/App.jsx)

**Impact:** 🔴 High

**Category:** Rendering

**What was inefficient:** `App` constructed both `exploreContents` and `routeContents` as inline JSX every render, then picked one (`mode === "explore" ? exploreContents : routeContents`). Only one tree was ever mounted, but both allocated the full React element graph each render — including the stops list with per-stop `AddressAutocomplete` + button cluster, plus the full results block (`StepHero`, `CompareDispatch`, `DirectionLedger`) when a route was loaded. Sheet drags, theme toggles, follow-position updates, and toast timers all re-ran `App` and paid the allocation twice.

**Implemented:** Wrapped each tree in a `buildExploreContents = () =>` / `buildRouteContents = () =>` arrow function, then called only the active one: `mode === "explore" ? buildExploreContents() : buildRouteContents()`. JS ternary short-circuits, so the inactive tree's JSX is never constructed. The internal closures (`onClick={() => handlePickToggle(stop.id)}` etc.) still allocate on the active branch — that's by design — but the inactive branch's element graph is now skipped entirely. 288 frontend tests pass.

---

### 2026-05-13 · `MapExploreLayer.placeFeatures` rebuilt on every new `exploreResult` reference (OPT-013, frontend scan)

**File:** [frontend/src/map/MapExploreLayer.jsx](../../frontend/src/map/MapExploreLayer.jsx)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** The `placeFeatures` `useMemo` depended on the entire `exploreResult` object. Every `/explore` fetch returned a fresh top-level object reference even when the underlying `places` array was identical (re-submits, or a fresh wrapper from a category toggle). The dependency churn forced a full feature rebuild (filter + map allocation per place) and a supercluster `setData` re-index on the source — a 20-min isochrone in dense Chicago can carry several thousand places.

**Implemented:** Narrowed the `useMemo` deps to `[exploreResult?.places, activeSubs]`. The `places` array reference now only changes when the backend returns new pin data, so identical results no longer trigger a feature rebuild + supercluster re-index. 288 frontend tests pass.

---

### 2026-05-13 · `logWalk` re-read and re-parsed the full step log from localStorage on every call (OPT-014, frontend scan)

**File:** [frontend/src/lib/stepLog.js](../../frontend/src/lib/stepLog.js), [frontend/src/App.jsx](../../frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation / I/O

**What was inefficient:** `logWalk` called `loadStepLog()` internally, which `JSON.parse`d the entire stored log and pruned expired entries (potentially re-`stringify`/writing the pruned list). The caller in `App.jsx` already had the live log in state (`stepLog`) and prepended the returned entry back onto that same state — so the full read + parse round-trip duplicated work the caller already did at mount, running synchronously on the click event.

**Implemented:** Added an optional `currentLog` parameter to `logWalk({ ... }, currentLog)`. When supplied, it skips the `loadStepLog()` read and uses the passed array directly; if absent, it falls back to disk (preserving the API for any future caller without the log in hand). `App.handleLogWalk` now passes its `stepLog` state. The localStorage write path is unchanged. Existing test calls in `App.test.jsx` that don't pass `currentLog` still hit the fallback path and pass.

---

### 2026-05-13 · `exploreCategoryStyles` `useMemo` with empty deps re-derived a module-level constant (OPT-015, frontend scan)

**File:** [frontend/src/App.jsx](../../frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `App` held an `exploreCategoryStyles = useMemo(() => PIN_CATEGORIES.map(c => ({ key, color, glyph })), [])`. `PIN_CATEGORIES` is itself a frozen module-level export — the `useMemo` with `[]` deps just delayed the same `.map(...)` work to first render and reserved a per-instance memo cache cell for data fully known at module load.

**Implemented:** Hoisted the projection out of `App` into a module-scope constant `EXPLORE_CATEGORY_STYLES` declared once next to the `PIN_CATEGORIES` import. The prop passed to `<MapView categoryStyles={...} />` now references the module constant directly; the `useMemo` is gone. 288 frontend tests pass.

---

### 2026-05-12 · Geocode cache rewritten in full every 50 entries (OPT-006, backend scan)

**File:** [backend/geocoding.py](../../backend/geocoding.py)

**Impact:** 🟢 Low

**Category:** Inefficient I/O

**What was inefficient:** `_save_geocode_cache` / `_flush_geocode_if_needed` serialised the entire JSON cache and atomically renamed `geocode_cache.json` on every 50th miss, blocking the request thread and scaling linearly with cache size.

**Implemented:** Superseded by Feature 2 "Local-First Geocoding + LocationIQ Fallback" (chunk 3, shipped 2026-05-12 — see [FEATURE_HISTORY.md](../FEATURE_HISTORY.md)). The JSON cache and its flush helpers were retired entirely: `geocoding.py` now reads and writes the SQLite-backed `cached_forward` / `cached_reverse` tables in `backend/data/chicago_geocode.db`, which use per-row inserts (no whole-file rewrites). The legacy `geocode_cache.json` has been renamed to `.deprecated` via `scripts/migrate_geocode_cache.py`. Verified with `grep "_save_geocode_cache\|_flush_geocode_if_needed\|geocode_cache\.json" backend/geocoding.py` — no matches.

---

### 2026-05-11 · `import math as _m` inside `_cardinal` closure on every directions build (OPT-007, backend scan)

**File:** [backend/walking.py](../../backend/walking.py)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `_directions_from_path` used to contain a nested `_cardinal` closure that did `import math as _m` inside its body and used `_m.degrees` / `_m.atan2`. The module already imports `math` at the top of the file, so the local import was a redundant `sys.modules` lookup per direction segment and dead code visually.

**Implemented:** Already resolved by the OPT-005 merged-walker refactor — `_directions_from_path` no longer has a nested `_cardinal` closure. The bearing classification is inlined and references `math.cos` / `math.radians` / `math.degrees` / `math.atan2` directly against the module-level `math` binding (`walking.py:924-926`). No nested import or `_cardinal` helper remains. Verified with `grep "_cardinal\|as _m"` — no matches.

---

### 2026-05-11 · `_compute_route_quantized` ran `_path_coords_from_path` and `_directions_from_path` as separate epath traversals (OPT-005, backend scan)

**File:** [backend/walking.py](../../backend/walking.py)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** On a cache miss, `_compute_route_quantized` called `_path_coords_from_path(vpath, epath)` and `_directions_from_path(vpath, epath)` back-to-back. Each helper independently iterated the same epath/vpath, indexing the per-edge cache columns (`_edge_geometries` for path; `_edge_names` / `_edge_highways` / `_edge_footways` / `_edge_lengths` for directions). For a 600-edge route this was two full Python passes over the same edges where one merged pass suffices. `compute_route_with_prefs` (the `avoid_stairs` path) repeated the same anti-pattern.

**Implemented:** Added `_build_path_and_directions(vpath, epath)` which walks `zip(epath, vpath, vpath[1:])` exactly once, appending coordinate points and collecting raw direction segments (`name, path_type, length, u, v`) in the same loop, then coalesces same-name adjacent segments into direction-step dicts in a second pass over the in-memory `raw` list (not over the graph). Updated both `_compute_route_quantized` and `compute_route_with_prefs` to call the merged helper. Output is byte-identical to the original two-call sequence; 137 backend tests pass.

---

### 2026-05-11 · `_build_flavor_weights` did per-edge attribute access for a one-time vector build (OPT-004, backend scan)

**File:** [backend/walking.py](../../backend/walking.py)

**Impact:** 🟡 Medium

**Category:** Inefficient Data Access

**What was inefficient:** OPT-004 described `_build_flavor_weights` iterating `G.es` and reading `e["length"]` (and for greenest, `e.attributes()` → `_edge_attr(...)`) once per edge, crossing the Python↔igraph boundary ~50k times on each cold build.

**Implemented:** Already resolved through the same column-cache refactor that addressed OPT-003. `_build_flavor_weights` now reads exclusively from module-level columns `_edge_lengths` (numpy float32 in v2 pickles, list[float] in v1 fallback) and `_edge_highways` (decoded list[str]), which are bulk-loaded once at graph load in `_populate_edge_caches` / `_populate_edge_caches_v2`. No `G.es` iteration, `e["length"]` read, or `e.attributes()` call remains in the function. The v2 path is additionally vectorized: `fewest_turns` returns `lengths + _TURN_PENALTY_M` (numpy broadcast) and `greenest` returns `np.where(green_mask, lengths * _GREEN_DISCOUNT, lengths)`.

---

### 2026-05-11 · Per-edge `edge.attributes()` allocated full attribute dict for two-key reads (OPT-003, backend scan)

**File:** [backend/walking.py](../../backend/walking.py)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** `_build_directions` and `_directions_from_path` previously called `attrs = edge.attributes()` for every edge in the route, materializing a fresh dict containing every edge attribute (length, geometry, highway, footway, name, oneway, lanes, …) just to read three keys. For a typical 200–600-edge route, that allocated and discarded 200–600 ~10-key dicts on every cache miss, plus the `_edge_attr` helper added list-handling overhead on each read.

**Implemented:** Already resolved through earlier per-edge cache work — `_populate_edge_caches` and `_populate_edge_caches_v2` materialize `_edge_names`, `_edge_highways`, `_edge_footways`, `_edge_lengths`, `_edge_geometries`, `_edge_sources`, and `_edge_targets` columns once at graph load (v2 pickles decode compact int8/int32 arrays into Python lists/numpy). `_directions_from_path` now indexes those columns directly by edge id (`names_col[eid].strip()`, `highways_col[eid]`, etc.), and `_build_directions` is a thin wrapper that delegates to it. No `edge.attributes()` call or `_edge_attr` helper remains in the codebase. This is strictly better than the suggested per-call bulk slice (`G.es[epath]["name"]`) because the cost is paid once at load, not per request.

---

### 2026-05-11 · Avoid-stairs Dijkstra rebuilds full ~50k-edge weight vector on every request (OPT-002)

**File:** [backend/walking.py](../../backend/walking.py)

**Impact:** 🔴 High

**Category:** Redundant Computation

**What was inefficient:** OPT-002 described `_shortest_path_with_avoid_stairs` rebuilding the full per-edge weight list and layering the stairs penalty in a fresh igraph `e["..."]` iteration on every request — uncached, so identical avoid-stairs requests both paid the full ~50k-edge cost, multiplied by leg count for multi-stop routes.

**Implemented:** The per-`(flavor, "avoid_stairs")` weight cache (`_combined_weights`) and bulk-column attribute reads (`_edge_lengths`, `_edge_highways`) were already in place via [`_get_avoid_stairs_weights`](../../backend/walking.py) — the request-path rebuild described in the entry no longer happens. The remaining cold-build loop that layered the stairs penalty with a Python `for i, h in enumerate(highways): if h == "steps": weights[i] += ...` has been replaced with a vectorized numpy boolean-mask assignment (`stairs_mask = np.fromiter(...); weights[stairs_mask] += _AVOID_STAIRS_PENALTY_M`), removing the last ~50k-iteration Python loop from the once-per-process cold build.

---

### 2026-05-11 · URL-param auto-fetch fires twice in StrictMode dev

**File:** [frontend/src/hooks/useRouteFetch.js](frontend/src/hooks/useRouteFetch.js)

**Impact:** 🟢 Low (dev-only — no production cost)

**Category:** Redundant Computation

**What was inefficient:** React 18's `<StrictMode>` runs every effect twice in dev (mount → cleanup → mount), so the mount-only auto-fetch effect that submits when the page loads with `?from=…&to=…` URL params called `fetchRoute()` twice. The first request was correctly aborted by the second via `abortRef.current?.abort()`, so no duplicate response landed — but the redundant request still hit the backend and produced two `fetchRoute START` log lines on every shareable-link load in dev. Production was unaffected (StrictMode is a no-op in prod builds).

**Implemented:** Added a `didAutoFetch` `useRef(false)` guard inside `useRouteFetch`. The mount effect early-returns when the ref is already true and sets it true before invoking `fetchRoute`. Paired with a comment documenting the safety reasoning (idempotent side effect with verified abort cleanup) and the trade-off (any future side effect added inside the same effect bypasses StrictMode's cleanup verification and must be reviewed).

---

### 2026-05-06 · Stop drafts persisted to sessionStorage on every keystroke (OPT-013, frontend scan)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🔴 High

**Category:** Inefficient I/O

**What was inefficient:** The `useEffect([stops])` block ran on every keystroke into any stop input, performing a synchronous `JSON.stringify` + `sessionStorage.setItem`. Typing "Logan Square" into one input fired the effect 11 times, producing 11 main-thread serializations + writes — perceptibly stalling typing on low-end devices, especially under iOS Safari's storage-quota enforcement.

**Implemented:** Wrapped the effect body in a 400 ms `setTimeout` cleared by a `stopsPersistTimerRef` and the effect's cleanup function. Coalesces a typing burst into one write while still capturing the user's final intent for restore-on-reload. Mirrors the existing `MobileLayout`'s `SNAP_PERSIST_DELAY_MS` debounce pattern.

---

### 2026-05-06 · `WFSheet.snapPx` recomputed every render, defeating every `useCallback` in the component (OPT-014, frontend scan)

**File:** [frontend/src/wayfarer/primitives.jsx](frontend/src/wayfarer/primitives.jsx)

**Impact:** 🔴 High

**Category:** Redundant Computation / Rendering

**What was inefficient:** `const snapPx = snapPoints.map(p => resolveSnapPx(p, containerHeight))` ran on every render and produced a fresh array reference. Every `useCallback` in the component (`settleToSnap`, `onPointerMove`, `onPointerUp`, `onBodyPointerUp`) depended on `snapPx` or its derived `maxHeightPx`, so the memoised callbacks were recreated on every render — `useCallback` effectively never hit. New pointer handlers were re-attached on the handle and body on every render, including ~60 Hz mid-drag.

**Implemented:** Wrapped `snapPx` in `useMemo([snapPoints, containerHeight])`. Added `useMemo` to the named imports. Pointer-handler reattachment now only happens when the snap shape itself changes. Pairs with OPT-019, which memoises `MobileLayout`'s `resolvedSnapPoints` so the `snapPoints` prop identity flowing in is stable.

---

### 2026-05-06 · `calorieEquivalent` ran the 12×10 search on every `StepHero` and `CompareDispatch` render (OPT-015, frontend scan)

**Files:** [frontend/src/App.jsx](frontend/src/App.jsx), [frontend/src/components/CompareDispatch.jsx](frontend/src/components/CompareDispatch.jsx)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** `calorieEquivalent(calories)` performs a 12 (foods) × 10 (fractions) = 120-iteration nested search. It was called inline (no memoisation) inside both `StepHero` and `CompareDispatch`, which render together for the same route with the same `calories_approx`. Every parent re-render that didn't change `calories_approx` (sheet drag, theme flip, active turn highlight, mode toggle) repeated the full 240-iteration search twice. `ShareDispatch.jsx` already memoised it correctly.

**Implemented:** Wrapped the call in `useMemo([calories_approx])` inside `StepHero` and `useMemo([calories])` inside `CompareDispatch`. Each component now has one cached result keyed on the actual input.

---

### 2026-05-06 · `App.jsx` stop-handler closures and `stopValues` rebuilt every keystroke (OPT-016, frontend scan)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🟡 Medium

**Category:** Rendering

**What was inefficient:** `const stopValues = stops.map(s => s.value)` rebuilt the values array on every `App` render, and `setStopValue` / `addStop` / `removeStop` / `moveStop` / `reverseStops` were declared as plain functions (not `useCallback`'d). Every input received a fresh `onChange` prop on every keystroke; same for the per-stop move/remove buttons. React still skipped DOM mutations because the underlying values didn't change, but every keystroke into a stop input allocated `stops.length` new closures + ran an extra `stops.map` traversal.

**Implemented:** Wrapped `stopValues` in `useMemo([stops])`. Wrapped all five stop-mutation handlers in `useCallback` with empty dep arrays — they all use functional `setStops` updates, so their identities are now stable across renders. The form rows still re-render on `stops` change (because `stops` itself is in the JSX), but the per-stop button props no longer change identity on unrelated re-renders.

---

### 2026-05-06 · `MapView` read `prefers-reduced-motion` via `matchMedia` on every route render (OPT-017, frontend scan)

**File:** [frontend/src/MapView.jsx](frontend/src/MapView.jsx)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** Inside the route-render effect's local `render()`, every paint pass called `window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches`. `matchMedia` allocates a fresh `MediaQueryList` on every call (no browser-side memoisation), so every flavor switch / active-turn change paid an extra alloc.

**Implemented:** Mirrored `WFSheet`'s pattern — added a `reducedMotionRef` and a mount-only `useEffect` that creates one `MediaQueryList`, subscribes to `change`, and stores the current value in the ref. The route-render branch now reads `reducedMotionRef.current` per paint instead of allocating. Bonus: the value stays live if the user toggles the OS setting mid-session.

---

### 2026-05-06 · `mapHelpers.renderExplore` rebuilt GeoJSON features and pin expressions on every paint (OPT-018, frontend scan)

**Files:** [frontend/src/MapView.jsx](frontend/src/MapView.jsx), [frontend/src/mapHelpers.js](frontend/src/mapHelpers.js)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** Every call to `renderExplore` walked `result.places` once to filter by `activeSubs`, then again via `.map` to build GeoJSON `Feature`s with copied `properties`. The colour/glyph `match` expressions were also rebuilt from `categoryStyles` per call. Because `MapView`'s explore-mode effect re-ran on changes to `mode`, `exploreResult`, `showResidential`, `activeSubs`, *or* `categoryStyles`, this fired whenever the user toggled the residential checkbox alone — and the resulting `setData` payload made MapLibre's supercluster re-tile and re-cluster from scratch.

**Implemented:** Lifted both derivations into `useMemo` calls in `MapView.jsx`: `placeFeatures` keyed on `[exploreResult?.places, activeSubs]`, and `placeExpressions` keyed on `[categoryStyles]`. Both pass into `renderExplore` via the `options` object, replacing the in-helper `activeSubs` + `categoryStyles` reads. `renderExplore` now only consumes the pre-built values; a small `_fallbackPinExpressions` helper covers callers that don't hand them in. A `showResidential`-only toggle now reuses the cached features and skips the supercluster rebuild entirely.

---

### 2026-05-06 · `MobileLayout` allocated a fresh `resolvedSnapPoints` reference on every render (OPT-019, frontend scan)

**File:** [frontend/src/components/MobileLayout.jsx](frontend/src/components/MobileLayout.jsx)

**Impact:** 🟢 Low

**Category:** Rendering

**What was inefficient:** `const resolvedSnapPoints = snapPoints ?? (isLandscapePhone ? LANDSCAPE_SNAP_POINTS : DEFAULT_SNAP_POINTS)` was re-evaluated on every render. The underlying constants are stable, but the resulting prop reference flowing into `WFSheet` shifted on every render — combined with OPT-014's now-fixed `snapPx`, the prop chain still needed a stable identity to keep `WFSheet`'s `useMemo` cache hot.

**Implemented:** Wrapped the assignment in `useMemo([snapPoints, isLandscapePhone])` so the `snapPoints` prop reaches `WFSheet` with a stable identity when neither input changed. Pairs with OPT-014 to keep `WFSheet`'s pointer handlers stable across unrelated parent re-renders.

---

### 2026-05-06 · `App.jsx` used `requestCategories.join("|")` as a `useEffect` dep (OPT-020, frontend scan)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `useEffect(() => { ... }, [requestCategories.join("|")])` rebuilt a `|`-joined string on every render to use as the dep, even though `requestCategories` is already `useMemo`'d on `[selectedCategories, selectedSubs]` so its identity changes only when the underlying selection does.

**Implemented:** Replaced the dep with `requestCategories` directly. React's `Object.is` check on the stable memoised reference yields the same outcome as the stringified comparison, at zero per-render cost.

---

### 2026-05-06 · `safePaceLabel` and `effectiveGoal.toLocaleString()` invoked twice per `StepHero` render (OPT-021, frontend scan)

**File:** [frontend/src/App.jsx](frontend/src/App.jsx)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** The pace stat-chip rendered `safePaceLabel(result.pace) && (... {safePaceLabel(result.pace)} ...)`, calling the lookup twice per render. Separately, `effectiveGoal` was already `.toLocaleString()`-formatted on declaration but had `.toLocaleString()` called on it again as a string in JSX — a no-op result-wise but still allocating an `Intl.NumberFormat` pipeline.

**Implemented:** Hoisted `const paceLabel = safePaceLabel(result.pace)` to the top of `StepHero` and replaced both call sites with the local. Dropped the redundant second `.toLocaleString()` on `effectiveGoal`. Touched while applying OPT-015 in the same component.

---

### 2026-05-06 · `places_in_polygon` rebuilt the polygon edge index on every contains() call (OPT-008, backend scan)

**File:** [backend/places.py](backend/places.py)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** After the STRtree bbox prune, the loop ran `polygon.contains(_geoms[i])` once per candidate point with no prepared geometry. Each shapely `contains()` call rebuilt the polygon's internal edge index, so the cost scaled with `O(candidates × polygon_vertices)` even though only the same isochrone polygon was being tested. On the `/explore` hot path this is the dominant per-request cost for dense category sets.

**Implemented:** Added `from shapely.prepared import prep` and constructed `prepared = prep(polygon)` once before the loop; the `contains()` check now uses the prepared geometry. The polygon's edge index is built once and reused across every candidate point, which is shapely's documented 5–10× speedup for repeated point-in-polygon queries.

---

### 2026-05-06 · `_reachable_neighborhoods` ran un-prepared `polygon.contains` per NEIGHBORHOOD_COORDS entry (OPT-009, backend scan)

**File:** [backend/explore.py](backend/explore.py)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** The neighborhood-name lookup inside `/explore` iterated `NEIGHBORHOOD_COORDS` (~150 entries) and called `polygon.contains(Point(lon, lat))` for each, with no prepared-geometry index. Same shapely caveat as OPT-008 — the polygon's edge index was rebuilt for every `contains()` call on every `/explore` cache miss.

**Implemented:** Built `prepared = prep(polygon)` once at the top of `_reachable_neighborhoods` and replaced the `polygon.contains(...)` call inside the loop with `prepared.contains(...)`. Same correctness, edge index built once per request.

---

### 2026-05-06 · `lookup_centroid` did a 77-entry linear scan with per-entry `.lower()` (OPT-010, backend scan)

**File:** [backend/community_areas.py](backend/community_areas.py)

**Impact:** 🟢 Low

**Category:** Inefficient Data Structure

**What was inefficient:** `lookup_centroid` walked `COMMUNITY_AREA_CENTROIDS.items()` and lowercased each key per call to do a case-insensitive match — 77 string allocations + comparisons on every `/explore` request, even though the keys are static and known at module load.

**Implemented:** Built a module-level `_LOWERCASE_INDEX = {k.lower(): v for k, v in COMMUNITY_AREA_CENTROIDS.items()}` once at import time. `lookup_centroid` now does `_LOWERCASE_INDEX.get(name.strip().lower())`. O(1) lookup, zero per-call allocation. Existing case-insensitive tests in `test_community_areas.py` still pass.

---

### 2026-05-06 · vpath reconstruction crossed the igraph Python bridge per edge (OPT-011, backend scan)

**File:** [backend/walking.py](backend/walking.py)

**Impact:** 🟡 Medium

**Category:** Inefficient Data Access

**What was inefficient:** Both `_get_shortest_path_by_node` and `_shortest_path_with_avoid_stairs` rebuilt the vertex path with `for eid in epath: e = G.es[eid]; nxt = e.target if e.source == vpath[-1] else e.source`. Every iteration created a Python-side edge proxy and made two attribute crossings into igraph's C layer. For a 200–600-edge route that's 400–1800 boundary crossings per cache miss, and the avoid-stairs path is uncached so every such request paid the full cost.

**Implemented:** Added `_edge_sources` / `_edge_targets` Python lists materialised from `G.get_edgelist()` once inside `_populate_edge_caches`, alongside the existing `_edge_lengths`/`_edge_names`/etc. columns. Extracted a shared `_vpath_from_epath(orig_idx, epath, G)` helper that indexes those lists in pure Python (with a fallback to per-edge `G.es[eid]` access if the cache is unavailable). Both Dijkstra reconstruction sites now call the helper.

---

### 2026-05-06 · `_polygon_area_sq_mi` materialized a fully-projected polygon (OPT-012, backend scan)

**File:** [backend/explore.py](backend/explore.py)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `shapely_transform(_project, polygon)` walked every coordinate of the (often complex, concave-hulled) isochrone polygon and constructed a brand-new shapely geometry just so `.area` could be read off the projected version. The projection is a simple `(x * k_lon, y * k_lat)` linear scaling, so the projected area is exactly `polygon.area * k_lon * k_lat` — no geometry materialization needed.

**Implemented:** Replaced the `shapely_transform` call with the closed-form scaling: `area_m2 = polygon.area * (111_320.0 ** 2) * cos_lat`, then divided by `_METERS_PER_MILE ** 2`. Same equirectangular approximation, no per-vertex traversal, no new geometry allocation. Dropped the now-unused `from shapely.ops import transform as shapely_transform` import.

---

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

---

### 2026-05-07 · `_compute_route` defensively copied cached direction dicts on every call (OPT-008, backend scan)

**File:** [backend/walking.py](backend/walking.py)

**Impact:** 🔴 High

**Category:** Redundant Computation

**What was inefficient:** `_compute_route_quantized` was `lru_cache`-wrapped and returned the directions tuple, but `_compute_route` then ran `tuple(dict(d) for d in directions)` on every call — even cache hits — to "break the alias on cached direction dicts so callers can mutate them without corrupting the LRU cache." A typical 40–60-step Chicago route allocated 40–60 fresh dicts per call; three-flavor 2-stop responses paid 3×, multi-stop responses paid N× per leg. Combined with `main.py:_enrich_directions`'s `{**d, ...}` spread immediately after, every direction dict was copied twice between cache and response.

**Implemented:** Switched the cache-side return to read-only `MappingProxyType` views via a new `_freeze_directions` helper, and dropped the per-call `tuple(dict(d) for d in directions)` in `_compute_route`. The proxies make accidental writes raise `TypeError` instead of silently corrupting the cache, so `_enrich_directions` (which always builds a fresh response dict) is the sole copy boundary. ~50–200 dict allocations removed per `/route` request. The fallback paths (`_haversine_fallback`, the `len(vpath) < 2` guard) also flow through `_freeze_directions` so the cache contract is uniform.

---

### 2026-05-07 · Cached `path` tuples re-converted to nested lists on every request (OPT-009, backend scan)

**Files:** [backend/walking.py](backend/walking.py), [backend/main.py](backend/main.py), [backend/tests/test_main.py](backend/tests/test_main.py)

**Impact:** 🟡 Medium

**Category:** Redundant Computation

**What was inefficient:** `walk_paths_alternatives` ran `[list(pt) for pt in path]` for each of the three flavors on every `/route` call, allocating 600–1,800 two-element lists per response (200–600 points × 3 flavors). The custom-routing-prefs branch and the multi-stop `_compute_leg` did the same, and `_stitch_legs` rebuilt every point with `list(pt)` again. The cached `path` is already a tuple-of-tuples, and FastAPI's JSON encoder serialises tuples and lists identically — the conversion was never needed.

**Implemented:** Removed the `[list(pt) for pt in path]` rebuild from `walk_paths_alternatives`, the custom-flavor branch, and `_compute_leg`. `_stitch_legs` now seeds with `list(legs_raw[0]["path"])` and extends with `pts` directly (no per-point `list(pt)`). Updated the three `TestStitchLegs` assertions to compare against tuples instead of lists, with a docstring note that JSON output is unchanged. All 135 routing tests pass; the only deselected ones are pre-existing failures from a stale `geocode_cache.json` entry that pre-dates this change.

---

### 2026-05-07 · `_geocode_cache` grew unboundedly across the process lifetime (OPT-010, backend scan)

**File:** [backend/geocoding.py](backend/geocoding.py)

**Impact:** 🟡 Medium

**Category:** Memory Bloat

**What was inefficient:** `_geocode_cache` was a plain `dict` with no eviction policy. Every successful or persistently-failing free-text geocode and every reverse-geocoded `lat,lon` pair (quantized to 5 decimals) accumulated forever, both in memory and on disk. The `/route` rate limit (10/min) bounded the inflow, but over weeks of uptime in production the dict size trended monotonically upward, and `_save_geocode_cache`'s merge-on-write step fed disk-side growth back into per-flush memory cost.

**Implemented:** Switched `_geocode_cache` to an `OrderedDict` populated from `_load_geocode_cache` in insertion order, and added FIFO eviction to `_flush_geocode_if_needed`: while `len(_geocode_cache) > _GEOCODE_CACHE_MAX`, pop the oldest entry. Cap is 10,000 by default, tunable via `GEOCODE_CACHE_MAX`. Popular Chicago queries (neighborhood/landmark names) are short-circuited by the early-return path in `geocode_google` before they ever touch the cache, so they don't risk eviction.

---

### 2026-05-07 · `_save_geocode_cache` re-read the entire on-disk cache on every flush (OPT-011, backend scan)

**File:** [backend/geocoding.py](backend/geocoding.py)

**Impact:** 🟡 Medium

**Category:** Inefficient I/O

**What was inefficient:** Every flush (every 50 newly-cached entries) called `_load_geocode_cache()` — re-reading and JSON-parsing the entire on-disk file — and merged it into the in-memory copy before writing the merged result back. The merge guarded against multi-worker last-writer-wins, but Passage's deployment is single-process uvicorn, so every flush paid the read+parse cost for a hazard that didn't apply. As the cache grew past a few thousand entries, each flush tripled its I/O work for no benefit.

**Implemented:** Gated the merge step on a `GEOCODE_CACHE_MULTIWORKER` env flag, defaulting to plain last-writer-wins. Single-worker deploys (the production target) now pay one serialize+write per flush. The flag re-enables the merge for any future multi-worker deploy without a code change.

---

### 2026-05-07 · `_reachable_neighborhoods` allocated ~150 ephemeral `Point`s per `/explore` call (OPT-012, backend scan)

**File:** [backend/explore.py](backend/explore.py)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** Every `/explore` call iterated `NEIGHBORHOOD_COORDS` (~150 entries), built a fresh `Point(lon, lat)` for each, and ran `prepared.contains(...)`. The points are static — they only change when `geocoding.NEIGHBORHOOD_COORDS` is edited — but every request re-allocated them all, threw them away after one `contains()` check, and re-built them on the next call.

**Implemented:** Added a lazily-built, lock-guarded `_neighborhood_points` module-level list of `(title-cased name, Point)` tuples (mirroring `geocoding.py`'s `_get_neighborhood_kdtree`). The coordinate-dedupe step (so aliases like "loyola" / "loyola university" don't both show) is folded into the build, so the per-request loop is one `prepared.contains()` per unique point. `_reachable_neighborhoods` now collects matching names with a list comprehension and sorts.

---

### 2026-05-07 · `_enrich_directions` dict-spread copied keys it was about to overwrite (OPT-013, backend scan)

**File:** [backend/main.py](backend/main.py)

**Impact:** 🟢 Low

**Category:** Redundant Computation

**What was inefficient:** `entry = {**d, "minutes": seg_minutes, "distance_miles": ..., "steps": ...}` spread all 8 source keys into the new dict and then immediately overwrote `minutes`. The wasted `minutes` copy ran once per direction step, scaled by leg count and flavor count.

**Implemented:** Replaced the spread with explicit construction that picks each key by name and writes the post-pace `minutes` value once. Same one-dict-per-direction allocation, no overwrite waste. Pairs with OPT-008: with cached directions now wrapped in `MappingProxyType`, the explicit dict is the response-side copy boundary either way.

---

### 2026-05-11 · TD-020 through TD-027 — 2026-05-11 tech-debt scan (8 items)

**Priority:** 🟡🟢 Medium / Low

**TD-020 · Tests import through App.jsx re-export shim** — Updated `App.test.jsx` to import each utility from its canonical location (`lib/directionFormat.js`, `calorieEquiv.js`, `lib/units.js`, `lib/personaPrefs.js`, `lib/routeFormat.js`, `lib/recentSearches.js`, `lib/urlParams.js`, `lib/stepLog.js`). Removed the 24-line re-export block (lines 80–103) from `App.jsx`. 204 tests pass.

**TD-021 · `scipy<2.0` upper-bound** — Removed `<2.0` cap from `requirements.txt`; now `scipy>=1.7`.

**TD-022 · `uvicorn` pinned to specific old patch** — Relaxed from `uvicorn==0.30.6` to `uvicorn>=0.30,<1.0`.

**TD-023 · `igraph<0.12` caps a released major** — Removed `<0.12` cap; now `igraph>=0.11`. Note: regenerate `street_graph_igraph.pkl` after upgrading to ensure pickle compat with the new major.

**TD-024 · `_save_igraph_artifact` swallows all exceptions silently** — Changed `except Exception` in `fetch_street_graph.py` to log `[error]` (was `[warning]`) and re-raise, so a failed artifact build fails the process visibly rather than silently falling back to the slow graphml path.

**TD-025 · `walk_path`/`walk_minutes` dead public API** — Deleted both functions and the "Public API" section header from `walking.py`. Neither was imported by any caller.

**TD-026 · Stale comment references non-existent `steps.PACE_TO_MPH`** — Corrected to reference `steps.PACE_TO_MET` and clarified that only the pace *keys* (not values) must stay in sync.

**TD-027 · Stale "Chunk 5/6" references in `places.py`** — Rewrote the module docstring to describe the current two-file load (`places_osm.json` + `places_curated.json`) rather than referring to implementation phases.

---

### 2026-05-11 · App.jsx hook extraction — TD-019

**Files:** `frontend/src/App.jsx`, `frontend/src/hooks/usePersonalization.js` (new), `frontend/src/hooks/useRouteFetch.js` (new), `frontend/src/hooks/useExploreFetch.js` (new)

**Priority:** 🔴 High

**What the debt was:** `App.jsx` had grown to 1420 lines of a single React component managing 20+ `useState` calls, four abort-controller refs, a dozen `useEffect` hooks, route-fetch logic, explore-mode fetch logic, and personalization state — all interleaved with layout branching and JSX. No natural entry point for new contributors; any change risked cross-cutting regressions.

**How it was resolved:** Extracted three self-contained vertical slices:

- **`usePersonalization(initialUrlParams)`** — height / weight / pace / goal / accessibility state + all five localStorage persistence effects + `handleHeightChange`, `handleWeightChange`, `handleGoalChange` callbacks. The hook reads initial access prefs once via an internal ref and returns the full personalization surface.
- **`useRouteFetch({ …prefs, initialUrlParams })`** — route fetch + `AbortController` lifecycle + `MIN_LOADING_MS` floor + URL write + `recentSearches` state + the `fetchRouteRef` ref-sync pattern + the mount-time auto-submit effect. Returns `{ result, loading, error, recentSearches, setRecentSearches, fetchRoute, fetchRouteRef }`.
- **`useExploreFetch({ mode, explorePrefs })`** — explore fetch + `AbortController` lifecycle + `explorePrefsRef` sync + `requestCategories` memo + mode-entry initial-fetch effect + category-change re-fetch effect. Returns `{ exploreResult, exploreLoading, exploreError, setExploreError, fetchExploreResult, explorePrefsRef }`.

`App.jsx` shrank from 1420 to ~840 lines. All 204 tests pass unchanged — the refactor is purely structural with no behavioral difference.

---

## Security Issues Resolved

### 2026-05-13 · CSP `script-src 'unsafe-inline'` replaced with SHA-256 hash (SEC-005)

**Files:** `frontend/index.html`, `frontend/vite.config.js`

**Severity:** 🟡 Medium

**What the issue was:** The meta CSP shipped in `frontend/index.html` allowed `script-src 'self' 'unsafe-inline'`. The allowance existed only to permit the single inline theme-boot script (which reads `walkpath:theme` from `localStorage` before React mounts to prevent a flash of the wrong theme), but it removed CSP's principal XSS defense for every other script. Any future DOM-XSS regression would not be blunted by the policy.

**How it was resolved:** Added a custom `passage-csp` Vite plugin in [`frontend/vite.config.js`](../../frontend/vite.config.js) that emits a `<meta http-equiv="Content-Security-Policy">` via `transformIndexHtml` with `order: "post"`. In production builds the plugin scans the final HTML for inline `<script>` tags (the regex excludes any tag with a `src=` attribute), computes a base64 SHA-256 over each body, and embeds the hashes in `script-src`. The static CSP meta tag was removed from `index.html` — the plugin is now the single source of truth. Verified by building (`npm run build`) and inspecting `dist/index.html`: the emitted policy reads `script-src 'self' 'sha256-…'` with no `'unsafe-inline'`. All 288 tests pass.

In dev (`vite serve`), the plugin emits a relaxed policy that keeps `'unsafe-inline' 'unsafe-eval'` because the Vite dev server + HMR runtime need them — the relaxed dev directives do NOT ship in production.

---

### 2026-05-13 · CSP `connect-src` no longer leaks dev origins into production HTML (SEC-006)

**Files:** `frontend/index.html`, `frontend/vite.config.js`

**Severity:** 🟢 Low

**What the issue was:** The production CSP `connect-src` allow-listed both `http://localhost:8000` and a hardcoded private LAN address `http://192.168.1.191:8000` (a developer's home-network IP used for mobile-device testing via `npm run dev:tunnel`). Two effects: minor information disclosure (the LAN IP shipped in source for anyone to read) and slight attack-surface widening on networks where an attacker controls that LAN address.

**How it was resolved:** The same `passage-csp` Vite plugin (see SEC-005) now emits a `connect-src` whose contents differ by mode. Production: `'self' https://*.up.railway.app https://*.openfreemap.org https://tiles.openfreemap.org`. Dev: adds back `http://localhost:8000`, `http://192.168.1.191:8000`, `https://*.trycloudflare.com`, plus `ws://localhost:5173` / `ws://192.168.1.191:5173` for HMR. The plugin also adds `upgrade-insecure-requests` in prod (newly possible because no dev origins remain to be upgraded). `frame-ancestors` was intentionally omitted — the CSP spec ignores it when delivered via `<meta>`, so it belongs on an HTTP response header at the hosting layer (Railway) when added.

Verified by inspecting `dist/index.html` after `npm run build`: production `connect-src` reads `'self' https://*.up.railway.app https://*.openfreemap.org https://tiles.openfreemap.org` with the dev origins absent.

---

### 2026-05-13 · CSP `style-src 'unsafe-inline'` reclassified as accepted tech debt (SEC-007)

**Files:** `docs/Technical_Debt.md`, `docs/SECURITY.md`

**Severity:** 🟢 Low

**What the issue was:** `style-src 'self' 'unsafe-inline'` permits inline `style={{ ... }}` attributes throughout the editorial design system (`ShareDispatch`, `ErrorDispatch`, the Wayfarer primitives). Inline-style XSS is much weaker than inline-script XSS — limited to selector-probe data exfiltration via CSS — and requires an attacker to already have a script-injection foothold (which SEC-005 now prevents).

**How it was resolved:** Migrating every inline `style` attribute to CSS classes is a substantial refactor that is out of proportion to the theoretical risk while React's default text-escaping holds and SEC-005's hash-based `script-src` is in place. The finding was reclassified as accepted tech debt and logged in [`Technical_Debt.md`](../Technical_Debt.md) so that any future inline-style → CSS-class migration carries the security framing forward.

