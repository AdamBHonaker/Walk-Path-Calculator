# Resolved History

A unified log of all resolved issues across three categories. New entries are appended here when work is completed:
- **Bugs** — moved here from an active bug-tracking file when fixed.
- **Technical Debt** — moved here from [`Technical_Debt.md`](Technical_Debt.md) when the debt is paid off.
- **Efficiency Improvements** — moved here from [`Efficiency_Improvements.md`](Efficiency_Improvements.md) when implemented.

Priority / Impact: 🔴 High · 🟡 Medium · 🟢 Low.

---

## Resolved Bugs

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
