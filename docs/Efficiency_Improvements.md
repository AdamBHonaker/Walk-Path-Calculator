# Efficiency Improvements

Known efficiency improvements catalogued for future improvement. Impact: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an efficiency in this file is implemented, **delete its entry from this file** and add a corresponding entry to the **Efficiency Improvements Implemented** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain improvements that have not yet been implemented.

> **Note:** OPT-022 through OPT-086 were catalogued together on 2026-05-22 during a three-pass codebase audit. Findings deduped across passes and ranked by ROI. Tier-H entries (OPT-022 to OPT-042) are the user-visible wins; Tier-M (OPT-043 to OPT-069) are profilable but not user-perceptible; Tier-L (OPT-070 to OPT-086) are nits / consistency.

---

## Tier H — wire / payload

### OPT-025 · Heatmap features computed even when frontend toggle is OFF
- **File**: [backend/main.py:415–421](../backend/main.py#L415-L421)
- **Category**: Wasted backend compute + payload
- **Impact**: 🔴 High
- **Description**: `/explore` unconditionally fans out all five heatmap clips (residential, parks, green-space, canopy, places) regardless of the user's toggle state. Response carries `null` for unrequested layers but the shapely clip + STRtree query already ran. Each heatmap is ~50–200 ms of shapely intersection work.
- **Resolution path**: Add optional `with_heatmaps: list[str] | None = None` to `ExploreRequest`. In `/explore`, skip the matching `loop.run_in_executor` calls when the layer isn't requested. Default `None` keeps backward compatibility (compute everything). Frontend `lib/exploreApi.js` passes a filter derived from the active toggle state; the `useExploreFetch` dependency array picks up changes.
- **Acceptance**: When user has only residential on, the response carries `parks_heatmap: null`, `green_space_heatmap: null`, `tree_canopy_heatmap: null`, and the backend p95 drops by ~150 ms.

---

## Tier H — build / deploy


---

## Tier H — backend hot paths




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


---

## Tier L — nits / consistency / future-proofing

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

### OPT-076 · `usePersonalization` writes per pref instead of coalesced
- **File**: [frontend/src/hooks/usePersonalization.js:36–49](../frontend/src/hooks/usePersonalization.js#L36-L49)
- **Category**: Storage roundtrips
- **Impact**: 🟢 Low
- **Description**: Five separate `useEffect`s each call their own `saveXxx()` on state change.
- **Resolution path**: Coalesce into one effect that depends on all five state values and writes one merged object (or calls all five savers in one batch).
- **Acceptance**: Updating height + weight writes once, not twice.

### OPT-078 · `ExploreCategoryPanel` `.some()` over subs per parent render
- **File**: [frontend/src/components/ExploreCategoryPanel.jsx:183](../frontend/src/components/ExploreCategoryPanel.jsx#L183)
- **Category**: Repeated linear scans
- **Impact**: 🟢 Low
- **Description**: `cat.subs.some(s => selectedSubSet.has(...))` runs per parent render to decide sublist visibility.
- **Resolution path**: Precompute `subsByCategory` (a `Map<categoryKey, true>`) in a `useMemo([selectedSubs])` and check `subsByCategory.has(cat.key)` in O(1).
- **Acceptance**: Toggling one sub recomputes only the affected category's subtree, not all five groups.


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

