# Features Implemented History

A log of features that have been designed and fully implemented. Entries are moved here from `FEATURE_PLANS.md` when complete.

> **Process:** When a feature in `FEATURE_PLANS.md` is finished, **delete its entry from that file** and add a corresponding entry here summarizing what was built. `FEATURE_PLANS.md` should only ever contain features that have not yet been implemented.

---

## Feature Index

**Bolt-On** = self-contained, no dependencies on other planned features.
**Structural** = depends on one or more other features before it can be fully built or realized.

| Feature | Type | Shipped |
|---------|------|---------|
| Alternative Routes | Structural | 2026-05-02 |
| Multi-Day Step Accumulator | Bolt-On | 2026-05-02 |
| Shareable Route Card | Bolt-On | 2026-05-02 |
| Click Map to Set Origin / Destination | Structural | 2026-05-02 |
| Animated Route Drawing | Bolt-On | 2026-05-02 |
| URL-Encoded Route Sharing | Bolt-On | 2026-05-02 |
| Highlighted Turn Points on Map | Bolt-On | 2026-05-02 |
| Swap Origin / Destination Button | Bolt-On | 2026-05-02 |
| Custom Daily Step Goal | Bolt-On | 2026-05-02 |
| Copy Directions as Plain Text | Bolt-On | 2026-05-02 |
| Calorie Equivalents | Bolt-On | 2026-05-02 |
| Recent Searches | Bolt-On | 2026-05-02 |
| Weight Input for Calories | Bolt-On | 2026-05-02 |
| Pace Customization | Bolt-On | 2026-05-02 |
| Waypoints / Multi-Stop Routes | Structural | 2026-05-02 |

---

## Waypoints / Multi-Stop Routes
**Type:** Structural | **Area:** Backend + Frontend | **Shipped:** 2026-05-02

`POST /route` now accepts a `stops` array of 2–8 ordered locations and chains the legs into one rendered route — e.g., Wrigleyville → Lincoln Park → Logan Square. Each consecutive `(stop_i, stop_{i+1})` pair is computed via the existing `_compute_route` LRU and stitched into a single polyline with leg-aware directions. The legacy `{origin, destination}` request body still works and is normalized to a 2-stop request, so older clients are unaffected.

**Backend:**
- `RouteRequest` (in [backend/main.py](backend/main.py)) gained a `stops: list[str] | None` field with `min_length=2, max_length=8`. A `model_validator(mode="after")` normalizes legacy `{origin, destination}` into `stops`, strips whitespace, rejects empty entries, and mirrors `stops[0]`/`stops[-1]` back onto `origin`/`destination` so downstream code reads either shape.
- N-way concurrent geocoding (`asyncio.gather` over `resolve_location` per stop). Unresolvable stops raise HTTP 400 with a structured detail `{message, stop_index}` so the frontend can highlight the offending input. Adjacent-duplicate validation (the per-leg generalization of the legacy `_SAME_LOCATION_DEG2` check) raises 400 with `stop_index = i+1`.
- Sequential leg compute (`_compute_route(..., DEFAULT_FLAVOR)` per leg) — the per-leg cache is the existing 1536-entry quantized LRU, so repeat or shared sub-routes hit the cache for free.
- New `_stitch_legs(legs_raw)` concatenates per-leg paths, dropping the duplicated seam point when leg `N+1`'s first point is within ~1 m of leg `N`'s last point. Returns the stitched path plus per-leg `(start, end)` index ranges; adjacent leg slices share the seam index by design.
- Multi-stop response (`len(stops) > 2`) carries: `stops`, `stop_coords`, top-level `path`/`directions`/totals (sums across legs), and a new `legs[]` array with `{from_label, to_label, miles, minutes, steps, calories_approx, path_slice}`. Each step in `directions` is annotated with `leg_index` so the frontend can insert dividers without tracking offsets. `routes` contains exactly one entry forced to `fastest`; `available_flavors = ["fastest"]`. Per-flavor alternative routes remain available in the 2-stop case unchanged.
- Tests in [backend/tests/test_main.py](backend/tests/test_main.py): `TestMultiStopRoutes` covers the 3-stop happy path (legs, totals, seam-shared path slices, monotonic `leg_index`), legacy 2-stop regression, adjacent-duplicate rejection with `stop_index`, unresolvable-middle-stop with `stop_index`, the 9-stop `422`, and that multi-stop forces a single fastest flavor.

**Frontend:**
- [App.jsx](frontend/src/App.jsx) state moved from two `origin`/`destination` strings to a `stops` array of `{id, value}` rows with stable per-row ids (so React keys survive reordering). Helpers: `setStopValue`, `addStop` (cap at `MAX_STOPS = 8`), `removeStop` (min 2), `moveStop` (up/down), `reverseStops`. Pick-on-map mode is now keyed on stop `id` instead of the literal strings `"origin"`/`"destination"`.
- The form renders a vertical stops list — each row has a label (`From` / `Stop N` / `To`), text input, map-pick button, ↑/↓ reorder buttons, and a × remove button (visible when `stops.length > 2`). Below the list: `+ Add stop` (disabled at 8) and a `↕ Reverse` button (disabled when any stop is empty). Up/down arrows replace the originally-planned `@dnd-kit/core` drag-and-drop for v1 — zero new dependencies, fully accessible, and trivially touch-friendly.
- URL params: `?stops=A|B|C` for 3+ stops (pipe-separated), legacy `?from=&to=` preserved for 2-stop. On load, `?stops=` takes precedence; `parseStopsParam` tolerates whitespace, drops empty segments, and caps at `MAX_STOPS`.
- Recent searches: `saveRecentSearch` accepts either an array of stops or the legacy `(origin, destination)` 2-arg form; entries are persisted as `{stops, origin, destination, timestamp}` so legacy readers (the `origin`/`destination` fields) keep working. `recentEntryStops(entry)` reads either shape, and `formatRecentChip` renders the chip as `A → B → C → D` (≤4) or `A → … → Z (N stops)` (≥5).
- Map: [mapHelpers.js](frontend/src/mapHelpers.js) `renderWalkRoute` now reads `result.stop_coords`; when the route has 3+ stops, intermediate stops render as numbered green circle markers ("1", "2", …) with a white text label, layered above the path but below the start/end pins. The single polyline is unchanged because the backend pre-stitches `path`.
- Directions: `DirectionList` accepts an optional `legs` prop. When present and a step's `leg_index` differs from the previous step's, a `→ Stop {N}: {to_label}` divider row is inserted before the step, giving the user a clear "I'm now heading to my next stop" cue.
- Flavor tabs gating: when `stops.length > 2`, `RouteFlavorTabs` is hidden and a small `.multi-stop-note` explains that alternative routes are 2-stop-only.
- Tests in [App.test.jsx](frontend/src/App.test.jsx): unit tests for `parseStopsParam`, `formatRecentChip`, `recentEntryStops`, plus a recent-searches multi-stop round-trip case. CSS additions in [App.css](frontend/src/App.css) cover `.stops-group`, `.stop-row`, `.stop-move-btn`, `.stop-remove-btn`, `.add-stop-btn`, `.direction-leg-divider`, `.multi-stop-note`, and `.recent-chip-route` truncation, in the existing dark-green palette.

**Out of scope for v1:** drag-and-drop reorder (`@dnd-kit/core`), TSP-style "optimize order" button, per-leg flavor selection, round-trip detection, and per-leg height/step overrides.

---

## Alternative Routes
**Type:** Structural | **Area:** Backend + Frontend | **Shipped:** 2026-05-02

`POST /route` now returns three route alternatives in a `routes` array — `fastest`, `fewest_turns`, and `greenest` — and the result panel renders a tabbed picker above the step hero that swaps the visible route in place without re-fetching. All three flavors are computed from the same OD pair on the server (each with its own LRU cache entry), so switching tabs is instant. Top-level totals (`total_miles`, `total_steps`, `path`, `directions`, …) continue to mirror the default fastest route, so any older client that ignores the new `routes`/`default_flavor`/`available_flavors` fields keeps working unchanged.

**Flavors via edge-weight modifiers** (re-run Dijkstra with modified weights, not Yen's k-shortest-paths):
- **Fastest** — length-only weights (existing behavior).
- **Fewest turns** — every edge weight gets a fixed `+30 m` penalty, which biases Dijkstra toward routes that traverse fewer edges (and therefore fewer junctions). True edge-pair turn penalties would require an edge-expanded graph; this approximation captures most of the effect at zero preprocessing cost.
- **Greenest** — edge length is multiplied by `0.6` when `highway ∈ {footway, path, cycleway, pedestrian, track}`, favoring off-street paths, plazas, and trails. Park-polygon proximity (the OSM `leisure=park` data fetcher proposed in the original plan) is **out of scope for v1** — the highway-tag heuristic is a reasonable first cut without the heavy data dependency.

Per-flavor weight vectors are built lazily on first use and cached as a module-level `dict[str, list[float]]`. The flavor weights survive across requests but are rebuilt if the graph's edge count ever changes (defensive). Walking-time output always uses real `length` (in metres) divided by `WALKING_SPEED_MPS` — the flavor weight is purely a routing preference, never a distance.

**What changed:**
- [backend/walking.py](backend/walking.py): added `FLAVORS = ("fastest", "fewest_turns", "greenest")`, `DEFAULT_FLAVOR`, `_TURN_PENALTY_M = 30.0`, `_GREEN_HIGHWAYS`, `_GREEN_DISCOUNT = 0.6`, and a module-global `_flavor_weights: dict[str, list[float]]` cache; new `_build_flavor_weights(G, flavor)` and `_get_flavor_weights(flavor)` helpers; threaded a `flavor` parameter through `_get_shortest_path_by_node` (LRU now keyed on `(orig, dest, flavor)`), `_get_shortest_path`, `_build_minutes`, `_build_directions`, `_build_path`, and `_compute_route_quantized`/`_compute_route` (default `"fastest"` everywhere preserves current callers); new public `walk_paths_alternatives(o_lat, o_lon, d_lat, d_lon)` returns a list of `{flavor, path, directions, minutes}` for all three flavors, hitting the per-flavor cache; bumped LRU sizes from 512 → 1536 to absorb 3× the entries.
- [backend/main.py](backend/main.py): `/route` calls `walk_paths_alternatives` instead of a single `_compute_route`; new local `_summarize(alt)` builds full per-route payload (totals + enriched directions); response now includes `routes`, `default_flavor`, `available_flavors`, while the legacy top-level `total_miles/total_minutes/total_steps/calories_approx/daily_goal_pct/path/directions` mirror the default fastest route for backward compatibility.
- [backend/tests/test_main.py](backend/tests/test_main.py): added a `TestAlternativeRoutes` class covering (a) the routes array returns three flavors in the documented order, (b) each alternative carries a complete payload, (c) the legacy top-level fields equal the `default_flavor` route's fields, and (d) no flavor undercuts `fastest` in distance.
- [frontend/src/App.jsx](frontend/src/App.jsx): exported `safeFlavorLabel`; added a `RouteFlavorTabs` memo component (3 buttons with icon, label, and inline `mi · min · steps` summary; collapses to a single column under 540px); added `activeFlavor` state (resets to `result.default_flavor` whenever a new result arrives); added a memoized `viewResult` that overlays the active route's per-flavor fields onto the top-level metadata, then swapped every consumer (`<MapView>`, `<StepHero>`, `<ComparePanel>`, `<DirectionList>`, `<RouteCard>`, `useTurnCoords`, `handleLogWalk`, share modal) from `result` → `viewResult` so the rest of the renderers work unchanged regardless of flavor.
- [frontend/src/App.css](frontend/src/App.css): added a `.flavor-tabs` 3-column grid and `.flavor-tab` / `.flavor-tab--active` styles matching the existing dark-green palette (`#1a3a22 → #1e4428` gradient on active, accent border `#2d7a3e`).
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added an `alternative route flavor tabs` describe block with three tests — tabs render after a successful route, switching tabs swaps the visible step total in `<StepHero>` and updates `aria-selected`, and tab switches do **not** trigger a re-fetch.

---

## Multi-Day Step Accumulator
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

After a successful route, users can tap a “＋ Log this walk” button to persist `{ timestamp, date, steps, miles, origin, destination }` to a `walkpath:stepLog` `localStorage` array. A new collapsible "This week" panel below the recent-routes list shows running weekly totals (steps + miles), a progress bar against `7 × dailyGoal` (defaulting to 70,000 if no goal is set), and a per-entry list with each walk's date, route, and step count. Entries older than 7 days are pruned automatically on every `loadStepLog()` call (and the pruned list is persisted back). After logging, the button switches to a disabled "✓ Logged this walk" state until a new route is fetched, preventing accidental duplicates of the same walk.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `STEP_LOG_KEY`, `STEP_LOG_TTL_DAYS = 7`, `pruneExpired`, and exported `loadStepLog`, `logWalk`, and `clearStepLog` helpers; added a `WeeklySummaryPanel` component that renders a collapsible toggle with totals, weekly goal bar, log list, and clear button (returns `null` when log is empty); added `stepLog` and `walkLogged` state in `App`, reset `walkLogged` whenever `result` changes, wired `handleLogWalk` and `handleClearStepLog`; rendered a "＋ Log this walk" button after `ComparePanel` in the result block, and `<WeeklySummaryPanel>` below `<RecentSearches>` in the form panel.
- [frontend/src/App.css](frontend/src/App.css): added `.log-walk-btn` (and `--logged` modifier) and a `.weekly-summary` block (toggle, body, log list, clear button, hint) matching the existing dark-green health palette.
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added a `step log` describe block covering empty/corrupt storage, persistence + retrieval shape, prepend ordering, 7-day expiry (with persisted prune-back), and `clearStepLog`.

---

## Animated Route Drawing
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

When a new route result loads, the green path now animates progressively from origin to destination rather than appearing all at once. A `requestAnimationFrame` loop runs for 1.5 seconds, stepping `line-dasharray` from `[0, 4, 0, 4]` toward a fully-revealed state, then snapping to `[1, 0]` (solid). Origin and destination circle markers are rendered synchronously in `renderWalkRoute` before any RAF callback fires, so they are always visible at frame 0. The animation is cancelled on cleanup when the result changes or the component unmounts. Users who have `prefers-reduced-motion: reduce` set in their OS skip the animation entirely and see the solid path immediately.

**What changed:**
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx): added `ANIM_DURATION_MS = 1500` constant; added `rafRef = useRef(null)` to track the active animation frame; refactored the result `useEffect` to introduce a `stopAnim` helper (cancels the current RAF if any) and, after `renderWalkRoute`, check `window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches` — if reduced motion is off, schedules a `frame` callback that increments `dashStep = (dashStep + 1) % 200` and calls `map.setPaintProperty("walk-path-line", "line-dasharray", [0, 4, dashStep / 50, 4])` each frame until 1.5 s elapses, then snaps to `[1, 0]`; cleanup cancels any running RAF via `stopAnim`.
- [frontend/src/test-setup.js](frontend/src/test-setup.js): added `flyTo`, `getSource`, `getCanvas`, and `setPaintProperty` stubs to the maplibregl `Map` mock; added a global `window.matchMedia` stub (returns `{ matches: false }` by default) so MapView's media query check doesn't throw in jsdom.
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added `animated route drawing` describe block with two Vitest tests — one that stubs `requestAnimationFrame` to never fire and asserts the "Unlock map" button (markers) appears synchronously before any frame callback, and one that sets `window.matchMedia` to return `matches: true` for the prefers-reduced-motion query and asserts RAF is never called.

---

## URL-Encoded Route Sharing
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

Routes are now bookmarkable and shareable via URL query params. After a successful fetch, `history.replaceState` writes `?from=…&to=…` (and optionally `&hft=…&hin=…` for height) into the browser URL without a page reload. On mount, the app reads these params to pre-populate the origin, destination, and height fields; if both `from` and `to` are present, the form auto-submits so the map populates immediately on page load.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `readUrlParams()` helper (parses `from`, `to`, `hft`, `hin` from `window.location.search` with range validation); updated `origin`, `destination`, `heightFt`, and `heightIn` `useState` initializers to use lazy functions that call `readUrlParams()` so URL params are reflected on first render; after `setResult` in `fetchRoute`, calls `history.replaceState` to write the current `from`/`to` (and height if set) to the URL; added a `useEffect([], [])` mount-only effect that reads URL params and calls `fetchRoute` if both `from` and `to` are present.
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added `URL-Encoded Route Sharing` describe block (6 cases: form pre-populated from params, auto-submit fires on mount, no auto-submit with only one param, URL written after fetch, height params included in URL, height pre-populated from URL); added `window.history.replaceState(null, "", "/")` to `beforeEach`/`afterEach` in all test groups that use `fetch` to prevent URL param bleed-through between tests.

---

## Highlighted Turn Points on Map
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

Small green circle markers are now placed at each turn along the route on the map. Clicking any row in the turn-by-turn directions list highlights the corresponding circle (larger radius + brighter accent color) and smoothly flies the map to that intersection (`zoom: 16, duration: 600 ms`). Keyboard users can activate steps with Enter/Space. Clicking the same step a second time deselects it (returning to plain circles). Turn markers reset when a new route is fetched.

**How turn coordinates are derived:** `directions[i]` carries `distance_meters` but no coordinate. A `useTurnCoords` hook in [frontend/src/App.jsx](frontend/src/App.jsx) walks the raw `path` polyline, accumulating Haversine segment lengths and interpolating within each segment (±10 m tolerance) to find the exact `[lat, lon]` for each turn threshold. Turns that map to within 5 m of each other are deduplicated; any turns left unresolved by rounding are anchored to the final polyline point.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `haversineMeters` helper and `useTurnCoords(path, directions)` hook (memoized); added `activeTurnIndex` state (reset on new result via `useEffect`); `DirectionList` now accepts `activeTurnIndex` and `onStepClick` — clicking a row calls `setActiveTurnIndex`, and keyboard `Enter`/`Space` also fires the handler; added `.direction-item--clickable` and `.direction-item--active` class logic; passed `turnCoords` and `activeTurnIndex` props to `<MapView>`.
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx): added `TURN_COLOR_ACTIVE` constant; added `haversineMeters` helper and `buildTurnsGeoJson(turnCoords, activeTurnIndex)` factory (deduplicates features within 5 m); `renderWalkRoute` adds a `"walk-turns"` GeoJSON source + `"walk-turns-circle"` circle layer (5 px radius, white stroke, data-driven active state for 8 px + accent color); a separate `useEffect` on `activeTurnIndex` calls `map.getSource("walk-turns").setData(...)` to update highlight state and fires `map.flyTo` to center on the active turn, all without re-rendering the full route.
- [frontend/src/App.css](frontend/src/App.css): added `.direction-item--clickable` (pointer cursor + transition) and `.direction-item--active` (bright green border + dark green background) rules.

---

## Pace Customization
**Type:** Bolt-On | **Area:** Frontend + Backend | **Shipped:** 2026-05-02

Users can now choose their walking pace — Leisurely (2 mph), Normal (3 mph), or Brisk (4 mph) — via a three-button radio group in the form. The selection persists to `localStorage` and is sent to the backend on every route request. Because the Dijkstra path is speed-free and cached, only the time-derived fields (total minutes, per-segment minutes, and calories) are recomputed post-hoc from each direction's `distance_meters` at the chosen speed; the polyline and step count are unchanged. The chosen pace and speed appear in the API response and are surfaced as a new 🚶 chip in `StepHero`.

**Calorie coupling:** MET is now pace-aware (leisurely = 2.8, normal = 3.5, brisk = 5.0), matching the values specified in the Feature 5 plan. This coupling applies to both the flat-walking formula and the grade-adjusted formula.

**Critical caching note:** `_compute_route` intentionally remains speed-free. Threading a speed parameter into the cache key would split the LRU cache across paces and balloon memory. All pace scaling happens after the cached call returns, in `POST /route`.

**What changed:**
- [backend/steps.py](backend/steps.py): exported `PACE_TO_MET: dict[str, float]` (`leisurely=2.8`, `normal=3.5`, `brisk=5.0`); extended `calories_from_minutes` signature to `(minutes, weight_kg=None, met=_BASE_MET)` and updated its formula to `met × weight_kg × 0.0175 × minutes` (matches legacy output for the 70 kg / MET-3.5 default); added `base_met=_BASE_MET` parameter to `calories_from_minutes_with_grade` so pace adjusts the MET baseline before grade is added.
- [backend/main.py](backend/main.py): added `from typing import Literal`; added `PACE_TO_MPH` constant (`leisurely=2.0`, `normal=3.0`, `brisk=4.0`); added `pace: Literal["leisurely", "normal", "brisk"] | None = None` to `RouteRequest`; after `_compute_route` returns, derives `total_meters` by summing `direction["distance_meters"]`, recomputes `total_minutes` and each direction's `minutes` from meters at the chosen speed, and passes `pace_met` to both calorie functions; adds `pace` and `walking_speed_mph` to the response.
- [backend/tests/test_steps.py](backend/tests/test_steps.py): added `TestPaceToMet` class (5 cases: normal MET = 3.5, strict ordering, all three paces present, brisk burns more, leisurely burns less).
- [backend/tests/test_main.py](backend/tests/test_main.py): added `TestPaceCustomization` class (7 cases: default is normal, pace echoed in response, invalid pace rejected, brisk ≈ 75% of normal minutes, leisurely longer than normal, distance unchanged by pace, brisk calories > leisurely calories).
- [frontend/src/App.jsx](frontend/src/App.jsx): added `PACE_OPTIONS`, `PACE_LABELS`, and `loadStoredPace()` exports; added `PaceSelector` memo component (three-button radio group with label + speed detail); added `walkPace` state (initialised from `localStorage`) and a `useEffect` to persist it; included `pace: walkPace` in the `fetchRoute` POST body; rendered `<PaceSelector>` below `<StepGoalInput>` in the form; added a 🚶 stat chip in `StepHero` showing the pace label from the response.
- [frontend/src/App.css](frontend/src/App.css): added `.pace-selector`, `.pace-selector-label`, `.pace-options`, `.pace-btn` / `--active`, `.pace-btn-label`, and `.pace-btn-detail` rules matching the existing green dark-theme aesthetic.

---

## Weight Input for Calories
**Type:** Bolt-On | **Area:** Frontend + Backend | **Shipped:** 2026-05-02

Users can now enter their weight to receive personalized calorie estimates. The weight field (lb or kg, with unit toggle) collapses like the height input. The selected unit persists to `localStorage`. When weight is provided the response now carries `personalized_calories: true` and the 🔥 calorie chip in `StepHero` shows a green "personalized" badge.

**What changed:**
- [backend/steps.py](backend/steps.py): added `MET_DEFAULT: float = 3.5` public constant; changed `calories_from_minutes` signature to `(minutes, weight_kg=None, met=MET_DEFAULT)` — uses `weight_kg or 70.0` so omitting the field reproduces legacy output exactly (3.5 MET × 70 kg × 0.0175 × 30 min = 129 cal).
- [backend/main.py](backend/main.py): added `weight_kg: float | None = None` to `RouteRequest` with a Pydantic validator (range 30–300 kg); passes weight through to both `calories_from_minutes` and `calories_from_minutes_with_grade`; added `personalized_calories: bool` field to the response.
- [frontend/src/App.jsx](frontend/src/App.jsx): exported `lbToKg` helper; added `WeightInput` component (collapsible, lb/kg toggle, unit persisted in `localStorage:walkpath:weightUnit`); added `weightKg` state and `handleWeightChange` callback; included `weight_kg` in the `fetchRoute` POST body; updated `StepHero` to destructure `personalized_calories` and render a `.stat-chip-badge` on the calorie chip when true.
- [frontend/src/App.css](frontend/src/App.css): added `.weight-inputs`, `.weight-number-input`, `.weight-unit-toggle`, and `.stat-chip-badge` rules.
- [backend/tests/test_steps.py](backend/tests/test_steps.py): added `TestCaloriesFromMinutesWeight` class (6 cases: legacy match, None default, heavier burns more, linear scaling, combined weight+MET, int return type).
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added `lbToKg` unit tests (3 cases) and `WeightInput sends weight_kg in kg` integration tests (2 UI cases: lbs→kg conversion and null when not entered).

---

## Recent Searches
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

Persists the last 10 successful route searches to `localStorage` and renders them as quick-pick chips below the form. Clicking a chip re-populates origin and destination and immediately fires the route fetch. A "Clear history" link removes all entries.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `RECENT_KEY` / `RECENT_MAX` constants, `loadRecentSearches()` and `saveRecentSearch(origin, destination)` localStorage helpers, a `RecentSearches` component (heading + clear button + chip list), and `recentSearches` state (initialised from `localStorage`). Refactored `handleSubmit` into a `fetchRoute(originVal, destVal)` function so both form submission and chip clicks share one fetch path; `handleRecentSelect` sets form state and calls `fetchRoute` directly to avoid stale-closure issues. `handleClearRecent` removes the localStorage key and clears the state array.
- [frontend/src/App.css](frontend/src/App.css): added `.recent-searches`, `.recent-searches-header`, `.recent-searches-label`, `.recent-clear-btn`, `.recent-chips`, `.recent-chip`, `.recent-chip-from`, `.recent-chip-arrow`, and `.recent-chip-to` rules, matching the existing green dark-theme aesthetic.

---

## Swap Origin / Destination Button
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

A circular swap button (↕) sits at the vertical midpoint between the From and To inputs. Clicking it swaps the `origin` and `destination` state values in a single update cycle, letting users reverse a route without retyping. The button is disabled when both fields are empty and rotates 180° on hover for affordance.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): wrapped the From/To labels in a new `.from-to-group` container, added a `handleSwap` callback, and rendered a `<button className="swap-btn">` between the inputs.
- [frontend/src/App.css](frontend/src/App.css): new `.from-to-group` (relative-positioned) and `.swap-btn` (absolutely centered, 32 px green pill with hover rotation) rules.

---

## Copy Directions as Plain Text
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

A "Copy" button in the directions heading writes a formatted plain-text summary to the clipboard. The confirmation state briefly shows "Copied!" (green, no underline) for 2 seconds before resetting.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added exported `formatDirectionsText(directions, result)` helper (header line with miles/minutes/steps, then numbered turn-by-turn steps reusing `formatBlocks` and `pathTypePhrase`); updated `DirectionList` to accept a `result` prop, added `copied` state and `handleCopy` async function, wrapped the existing "Show all" toggle and new "Copy" button in a `.directions-actions` div; passed `result` at the `<DirectionList>` call site.
- [frontend/src/App.css](frontend/src/App.css): added `.directions-actions` (flex row, 10 px gap), `.copy-directions-btn` (matches `.directions-toggle-all` styling), and `.copy-directions-btn--copied` (green, bold, no underline).

---

## Custom Daily Step Goal
**Type:** Bolt-On | **Area:** Frontend + Backend | **Shipped:** 2026-05-02

Replaced the hardcoded 10,000-step daily goal with a user-configurable value. The goal is persisted to `localStorage`, sent to the backend on each route request, and reflected in the progress bar label in `StepHero`.

**What changed:**
- [backend/main.py](backend/main.py): added `daily_goal: int | None = None` to `RouteRequest` with a Pydantic validator (range 1,000–100,000); passes the value (defaulting to 10,000) into `daily_goal_pct()`.
- [frontend/src/App.jsx](frontend/src/App.jsx): added `loadDailyGoal()` localStorage helper, `dailyGoal` state, `handleGoalChange` callback, and a new `StepGoalInput` component (collapsed toggle with five preset chips — 5k/7.5k/10k/15k/20k — plus a custom number input and a Reset button). `StepHero` now receives `dailyGoal` as a prop and renders the actual goal number in the bar label. The fetch body includes `daily_goal`.
- [frontend/src/App.css](frontend/src/App.css): added `.goal-body`, `.goal-presets`, `.goal-preset-btn` / `--active`, `.goal-custom`, `.goal-number-input`, and `.goal-clear-btn` rules mirroring the height-section visual pattern.

---

## Calorie Equivalents
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

Below the stat chips in `StepHero`, a small caption line surfaces a friendly food comparison such as "≈ 1 banana" or "≈ half a slice of pizza". No backend changes were needed — the comparison is computed purely from the `calories_approx` value already in the route response.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `CALORIE_FOODS` lookup table (12 items, 55–550 cal) and `NICE_FRACS` table (¼ through 4), exported `calorieEquivalent(calories)` helper that finds the (food, fraction) pair minimising absolute error, formats singular/plural automatically, and returns `null` for zero/null input. `StepHero` computes `calorieEquiv` and renders a `<p className="calorie-equiv">` beneath the stat chips when a result is available.
- [frontend/src/App.css](frontend/src/App.css): added `.calorie-equiv` rule (0.72 rem, muted green, centered, small bottom margin).
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added 7 unit tests for `calorieEquivalent` covering null/zero guard, string prefix, exact matches (banana, can of soda), fractional match (half a banana), and plural output (2 bananas).

---

## Shareable Route Card
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

A "📤 Share route card" button in the step-hero panel opens a modal containing a 360×360 summary card (exported at 3× = 1080×1080 for social media). The card shows the walk brand/city header, a mini map thumbnail with the rendered route, step count, key stats (miles · minutes · calories · pace), origin→destination labels, and a walkpath.app footer. A "Download PNG" button is disabled until the mini map finishes rendering all tiles, then triggers a client-side PNG download via `html-to-image`.

**What changed:**
- [frontend/src/mapHelpers.js](frontend/src/mapHelpers.js): new shared module extracting all MapLibre path-rendering logic from `MapView.jsx` — exports `renderWalkRoute`, `clearLayers`, `buildTurnsGeoJson`, `toGeo`, and `WALK_PATH_COLOR`. Both `MapView` and `RouteCard` import from here.
- [frontend/src/RouteCard.jsx](frontend/src/RouteCard.jsx): new `forwardRef` component that creates a mini MapLibre instance with `preserveDrawingBuffer: true` and all gestures disabled. Calls `renderWalkRoute` with a tighter `fitPadding=20`. Fires `onMapReady()` callback on `map.once("idle")` guarded by a `mountedRef`. Defines `_PACE_LABELS` locally.
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx): refactored to import rendering helpers from `mapHelpers.js` instead of implementing them inline.
- [frontend/src/App.jsx](frontend/src/App.jsx): `StepHero` gains an `onShare` prop rendering the share button. App state adds `showShareModal`, `cardMapReady`, `cardRef`. `handleDownloadCard` dynamically imports `html-to-image` and calls `toPng(cardRef.current, { pixelRatio: 3 })`.
- [frontend/src/App.css](frontend/src/App.css): added `.share-card-btn`, `.share-modal-overlay`, `.share-modal`, `.share-modal-header`, `.share-modal-title`, `.share-modal-close`, `.share-modal-card-wrap`, `.share-modal-actions`, `.share-download-btn`, and all `.route-card*` rules.
- `frontend/package.json`: added `html-to-image` dependency.

---

## Click Map to Set Origin / Destination
**Type:** Structural | **Area:** Frontend + Backend | **Shipped:** 2026-05-02

Each From/To input now has a 📍 pin icon button. Clicking it enters a `pickMode` state where the map cursor changes to a crosshair and a floating hint banner appears. A single click on the map captures the coordinates, clears pick mode, immediately writes `lat, lon` into the field (optimistic), then calls `GET /reverse-geocode` to replace it with a human-readable label. A non-blocking toast appears on network failure, leaving the coordinate string in place as a valid fallback (the geocoder has a coordinate-pair short-circuit so routing still works). The click handler fires regardless of the map's gesture lock — no unlock required to drop a pin.

**What changed:**
- [backend/geocoding.py](backend/geocoding.py): updated `_load_geocode_cache` / `_save_geocode_cache` to handle both forward-geocode tuples and reverse-geocode dicts in the same cache file. Added `_COORD_RE` regex and a coordinate-pair short-circuit at the top of `resolve_location`. Added `_reverse_geocode_google(lat, lon)` and `reverse_geocode_point(lat, lon)` — the latter checks the nearest `NEIGHBORHOOD_COORDS` entry within 200 m before calling Google, and caches results under `rev:{lat:.5f},{lon:.5f}` keys. Added import of `haversine_miles` and Chicago bbox constants from `utils`.
- [backend/main.py](backend/main.py): added `GET /reverse-geocode?lat=…&lon=…` endpoint with Chicago bbox validation; calls `reverse_geocode_point` in an executor and returns `{"label": str, "source": str}`.
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx): added `pickMode` and `onPickPoint` props. When `pickMode` is non-null, attaches a one-shot `map.once("click", …)` handler that calls `onPickPoint(lat, lng)` without touching gesture locks. Cursor effect sets `canvas.style.cursor = pickMode ? "crosshair" : ""`. The `.map-pick-hint` banner and the Unlock button are both conditionally hidden while pick is active.
- [frontend/src/App.jsx](frontend/src/App.jsx): From/To inputs wrapped in `.input-with-pick` divs with `.pick-map-btn` toggle buttons. `pickMode` state (`"origin" | "destination" | null`), `handlePickToggle`, and `handleMapPick` (useCallback, captures `field = pickMode` before clearing). `toastMsg` state and `toastTimerRef` drive a 3.5-second dismissable toast.
- [frontend/src/App.css](frontend/src/App.css): added `.input-with-pick`, `.pick-map-btn`, `.pick-map-btn--active`, `.map-pick-hint`, `.toast`, and `@keyframes toast-in`.
