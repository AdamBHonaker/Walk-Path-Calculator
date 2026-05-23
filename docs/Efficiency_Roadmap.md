# Efficiency Improvements Roadmap

Implementation plan for the 65 optimization opportunities catalogued in [`Efficiency_Improvements.md`](Efficiency_Improvements.md) (OPT-022 through OPT-086, the 2026-05-22 three-pass audit batch). The catalog ranks by ROI within tier (H/M/L); **this file groups those items into PR-sized chunks** sequenced so that compounding effects (gzip + precision + simplify on the wire, memo + useCallback on App.jsx) land together and so that dependencies (multi-worker after warm-up) are honored.

> **Process.** Work one chunk at a time, in roughly the order below. Pause after each chunk for a go / no-go before starting the next — same checkpoint discipline used for chunked features in [`FEATURE_PLANS.md`](FEATURE_PLANS.md).

> **Per-chunk documentation checklist.** When a chunk lands, walk this checklist before opening the PR (or as part of it). Don't skip — TD-046 catalogued how easily README / CLAUDE.md / code drift apart, and a chunk that ships a behavior change without the doc update is how drift starts.
>
> 1. **Catalog hand-off.** For each OPT entry that the chunk closed, **delete the entry from [`Efficiency_Improvements.md`](Efficiency_Improvements.md)** and add a corresponding entry to the **Efficiency Improvements Implemented** section of [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md). Match the shape of existing entries there (date · short title · files · what changed · how). If the chunk only partially resolved an OPT, leave the remainder in the catalog with a note about what landed.
> 2. **Roadmap update.** Strike the chunk from the **Chunk index** table and the **Wave map** above. If every OPT inside the chunk resolved, delete the chunk block outright. If part of a chunk is deferred, leave the block with a `[PARTIAL]` marker and the remaining OPT IDs.
> 3. **CLAUDE.md.** Update if the chunk changed documented behavior or architecture — most commonly the **Key Design Decisions** section, the **API** section (request/response shape), or one of the runbooks (Greenest-routing graph release, Pickle integrity check). Chunks with a known CLAUDE.md surface flag it inline below; the rest are judgment calls — when in doubt, grep CLAUDE.md for the file path or symbol you changed and read the surrounding paragraph.
> 4. **README.md.** Update if the chunk changed a user-visible surface or a public API enum/field (TD-046 caught a stale `/explore` `source` enum drift; the same risk applies here when CHUNK-11 adds `with_heatmaps`).
> 5. **Pending_Verification.md.** Add a `PV-XXX` entry for any chunk that needs real-device or live-production sign-off the local test suite can't cover. Most chunks don't; the ones that do (gzip+orjson live wire savings, on-demand heatmaps under real toggle traffic, multi-worker under load, raster paint vs CSS filter visual review, mobile font preload FCP delta) flag it inline below.
> 6. **Auto-memory.** If implementing the chunk surfaced something non-obvious — a workaround a future contributor would re-hit, a tuning constant the catalog estimate missed by an order of magnitude, a verification step that turned out to be load-bearing — save it as a `project` or `feedback` memory per the auto-memory rules. Don't memorize the fix itself (it's in the diff) — memorize the surprise.
> 7. **Artifact rotation (CHUNK-10 only, and any future chunk that rebuilds the pickle).** Follow the full Deploy checklist in [`CLAUDE.md`](../CLAUDE.md) "Greenest-routing graph release runbook" — rebuild `.pkl`, upload to the `street-graph` GitHub release, recompute `STREET_GRAPH_SHA256`, update `backend/.env` locally + Railway service variable, then push. Skipping any step breaks the SEC-001 integrity check and degrades the service to haversine until corrected.

> **Why a separate file.** [`Efficiency_Improvements.md`](Efficiency_Improvements.md) stays the per-item catalog (the things being changed). This file is the implementation roadmap (the order to change them in). Cross-reference: every OPT-XXX in the catalog appears exactly once below; every chunk below references the OPT-XXX entries it covers.

---

## Wave map (parallelism cheat-sheet)

| Wave | Chunks | Theme | Parallel-safe? |
|------|--------|-------|----------------|
| 0 | ~~CHUNK-01~~ [PARTIAL] | Zero-risk one-shots — 10 of 11 landed 2026-05-23; OPT-074 deferred | Yes — distinct files |
| 1 | ~~CHUNK-02~~ / ~~CHUNK-03~~ / ~~CHUNK-04~~ | Wire payload + serialization — all three landed 2026-05-23 | Sequential: -02 → -03 → -04 so payload-size deltas measure cleanly |
| 2 | ~~CHUNK-05~~ / ~~CHUNK-06~~ / ~~CHUNK-07~~ | Backend hot paths — all three landed 2026-05-23 | -05 and -06 / -07 parallel; -06 and -07 distinct files |
| 3 | ~~CHUNK-08~~ / ~~CHUNK-09~~ / ~~CHUNK-10~~ | Cold-start + concurrency — all three landed 2026-05-23 | Sequential: -08 (warm-up) before -09 (multi-worker); -10 standalone |
| 4 | CHUNK-11 / -12 / -13 / -14 | Build + deploy pipeline | All four parallel — different files |
| 5 | CHUNK-15 / -16 | Frontend render path (App.jsx core) | -15 first (App.jsx memo) — touches files -16 needs stable |
| 6 | CHUNK-17 / -18 / -19 | MapLibre layer churn + canvas paint | -17 and -18 parallel; -19 separate review (visual) |
| 7 | CHUNK-20 / -21 | First paint + assets + CSS paint cost | Parallel — distinct files |
| 8 | CHUNK-22 / -23 | UX safety + storage hygiene + DOM weight | Parallel — distinct files |

**Sequencing notes that matter for scheduling:**

- **CHUNK-03 after CHUNK-02.** GZip lands first so that the precision + simplify wins in CHUNK-03 can be measured post-gzip (the catalog estimates "~15 KB stacked with OPT-022" for OPT-024 — that math only reads if gzip is live).
- **CHUNK-09 after CHUNK-08.** Multi-worker uvicorn (OPT-035) assumes the lifespan warm-up (OPT-034 + OPT-050 + OPT-054) so each worker doesn't pay the full cold-start tax on its first request.
- **CHUNK-15 before CHUNK-16.** `useCallback` stabilization (OPT-037) and `useMemo` of sidebar contents (OPT-036) must be in place before the `ViewportProvider` hoist (OPT-061) lands, otherwise the provider re-broadcasts into components that still re-render on every parent tick.
- **CHUNK-13 has a dependency the others don't.** OPT-025 (on-demand heatmaps) needs the frontend `useExploreFetch` call to pass `with_heatmaps: [...]` derived from active toggles — that's a backend + frontend pair, not a backend-only change. Allow for a follow-up frontend PR if the backend lands first behind a `null` default.
- **Greenest-routing artifact rotation in CHUNK-12.** OPT-030 + OPT-053 change `_bake_green_signals` math; rebuilding the pickle rotates `STREET_GRAPH_SHA256` and triggers the full "Greenest-routing graph release runbook" in [`CLAUDE.md`](../CLAUDE.md). Plan for the deploy choreography (rebuild → upload to GitHub release → rotate `.env` + Railway var → push).

---

## Chunk index

| Chunk | Items | Theme | Surface | Est. PR size |
|-------|-------|-------|---------|--------------|
| ~~CHUNK-01~~ [PARTIAL] | OPT-074 remaining | Zero-risk one-shots | frontend/public/passage-icon-*.png | XS |
| ~~CHUNK-02~~ | — | GZip + ORJSONResponse (landed 2026-05-23) | — | — |
| ~~CHUNK-03~~ | — | Geometry precision + simplification (landed 2026-05-23; operator must upload new chicago_boundary.json to the `street-graph` release) | — | — |
| ~~CHUNK-04~~ | — | Pre-baked JSON file minification (landed 2026-05-23) | — | — |
| ~~CHUNK-05~~ | — | `walking._flavor_weights` cache shape (landed 2026-05-23) | — | — |
| ~~CHUNK-06~~ | — | numpy + shapely micro-optims (landed 2026-05-23) | — | — |
| ~~CHUNK-07~~ | — | Lifespan warm-up + await graph preload (landed 2026-05-23) | — | — |
| ~~CHUNK-08~~ | — | Multi-worker uvicorn + middleware order + dedicated heatmap pool (landed 2026-05-23; PV-011 pending real-deploy load test) | — | — |
| ~~CHUNK-09~~ | — | Dockerfile artifact `curl` layer reorder (landed 2026-05-23) | — | — |
| ~~CHUNK-10~~ | — | Build-script speedups (landed 2026-05-23; PV-012 pending operator upload of rebuilt pickle + Railway SHA rotation) | — | — |
| CHUNK-11 | OPT-025 | On-demand heatmap fan-out | `backend/main.py`, `frontend/src/hooks/useExploreFetch.js`, `lib/exploreApi.js` | Small backend + small frontend |
| CHUNK-12 | OPT-036, -037, -040, -061 | App.jsx memoization + ViewportProvider | `frontend/src/App.jsx`, new `frontend/src/lib/viewport.jsx` (or similar) | Medium-Large |
| CHUNK-13 | OPT-038, -039, -058, -059, -060 | MapLibre layer effect splits + feature-state hygiene + theme rAF | `frontend/src/map/MapRouteLayer.jsx`, `MapExploreLayer.jsx`, `mapHelpers.js` | Medium |
| CHUNK-14 | OPT-042 | Canvas CSS filter → raster paint properties | `frontend/src/App.css`, `frontend/src/mapHelpers.js` (style JSON) | XS (visual review) |
| CHUNK-15 | OPT-041, -064, -066, -067, -073 | First-paint assets + CSS paint cost | `frontend/index.html`, `vite.config.js`, `wayfarer/fonts.css` + new subset woff2, `App.css` | Small-Medium |
| CHUNK-16 | OPT-055, -056, -057, -062, -065, -076, -084 | localStorage write hygiene + fetch race + UX safety | `frontend/src/App.jsx`, `lib/recentSearches.js`, `lib/stepLog.js`, `lib/autocompleteApi.js`, `hooks/useExploreFetch.js`, `hooks/useShareCard.js`, `hooks/usePersonalization.js` | Medium |
| CHUNK-17 | OPT-063, -078, -085 | DOM weight reductions | `frontend/src/components/DirectionLedger.jsx`, `ExploreCategoryPanel.jsx`, `AddressAutocomplete.jsx`, `backend/local_search.py` (suggestion `id`) | Small |

Coverage: every OPT in [`Efficiency_Improvements.md`](Efficiency_Improvements.md) is assigned to exactly one chunk above. As of 2026-05-23, CHUNK-01 (partial — 10/11 landed; OPT-074 deferred), CHUNK-02 (OPT-022 + OPT-023), CHUNK-03 (OPT-024 + OPT-026 + OPT-083), CHUNK-04 (OPT-028 + OPT-072), CHUNK-05 (OPT-031 + OPT-032 + OPT-045 + OPT-068), CHUNK-06 (OPT-033 + OPT-046 + OPT-048 + OPT-051 + OPT-080), CHUNK-07 (OPT-034 + OPT-050 + OPT-054), CHUNK-08 (OPT-035 + OPT-043 + OPT-044 + OPT-069), CHUNK-09 (OPT-027), and CHUNK-10 (OPT-029 + OPT-030 + OPT-052 + OPT-053) have shipped; 27 of the original 65 items remain in the catalog. The roadmap's Wave 3 (cold-start + concurrency) is fully resolved.

---

# Chunks

---

## CHUNK-01 · Zero-risk one-shots [PARTIAL — landed 2026-05-23]
**Items remaining:** OPT-074
**Items resolved:** OPT-047, OPT-049, OPT-070, OPT-071, OPT-075, OPT-077, OPT-079, OPT-081, OPT-082, OPT-086 — see RESOLVED_HISTORY.md "2026-05-23 · Zero-risk one-shot bundle from CHUNK-01".

OPT-074 (oxipng pass on PWA icons) deferred — oxipng is not installed locally and a system-wide install was not in scope for the bundle. Re-run as a one-shot when the binary is available: `oxipng -o 4 --strip safe frontend/public/passage-icon-*.png`.

---

## CHUNK-02 · GZip middleware + ORJSONResponse [LANDED 2026-05-23]

OPT-022 + OPT-023 resolved. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "2026-05-23 · GZipMiddleware + ORJSONResponse on FastAPI" for the diff details and the FastAPI 0.136 ORJSONResponse-deprecation follow-up note.

---

## CHUNK-03 · Geometry precision + simplification [LANDED 2026-05-23]

OPT-024 + OPT-026 + OPT-083 resolved. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "2026-05-23 · Geometry precision + heatmap simplification + boundary simplify" — `quantize_geojson` helper in `utils.py`, per-clipper Douglas–Peucker via `heatmap_clipper.clip_polygons_to_feature_collection(simplify_tolerance=…)` + inline call in `places.residential_heatmap`, and a rebuilt `chicago_boundary.json` (87 KB → 16 KB) with `ARTIFACT_REV` bumped to `2026-05-23`. **Operator step pending:** upload the new `chicago_boundary.json` to the `street-graph` GitHub release before the next Railway deploy.

---

## CHUNK-04 · Pre-baked JSON file minification [LANDED 2026-05-23]

OPT-028 + OPT-072 resolved. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "2026-05-23 · Pre-baked JSON artifacts minified" — `places_osm.json` 3.35 MB → 2.29 MB (31.8%), `places_curated.json` 562 KB → 379 KB (32.6%), `community_area_centroids.json` 4.3 KB → 2.7 KB (37.6%). Re-emit was a content-preserving round-trip rather than a re-fetch from Overpass / Chicago Data Portal.

---

## CHUNK-05 · `walking._flavor_weights` cache shape [LANDED 2026-05-23]

OPT-031 + OPT-032 + OPT-045 + OPT-068 resolved. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "2026-05-23 · `walking._flavor_weights` cache reshape" — float32 cast moved to load, uint8 `_edge_green_mask` baked at load (232,759-edge graph), versioned `(flavor, _graph_version)` cache key, `OrderedDict` LRU capped at 8 entries. `_combined_weights` (avoid_stairs variant cache) deliberately left on the legacy shape — see the "out of scope" note in the RESOLVED_HISTORY entry.

---

## CHUNK-06 · numpy + shapely micro-optims [LANDED 2026-05-23]

OPT-033 + OPT-046 + OPT-048 + OPT-051 + OPT-080 resolved. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "2026-05-23 · numpy + shapely micro-optims across the explore hot path". OPT-051's recipe was course-corrected: the catalog's "pre-template + affine translate" approach benchmarked ~1.5× *slower* than the original `box()`, but shapely 2.0's vectorized `shapely.box(arrays...)` was 60× faster — that's the path that shipped.

---

## CHUNK-07 · Lifespan warm-up + await graph preload [LANDED 2026-05-23]

OPT-034 + OPT-050 + OPT-054 resolved. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "2026-05-23 · Lifespan warm-up + awaited graph preload" — `lifespan` now `await`s the graph load, then `asyncio.gather`s the six index/boundary warmers in parallel. Measured: first `/explore` after deploy lands at 218 ms (vs ~700–900 ms cold-start catalog estimate); container start-up grows by ~2.5 s (acceptable — `/health` flips ready only once everything is warm).

---

## CHUNK-08 · Multi-worker uvicorn + middleware order + dedicated heatmap pool [LANDED 2026-05-23]

OPT-035 + OPT-043 + OPT-044 + OPT-069 resolved. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "2026-05-23 · Multi-worker uvicorn + dedicated heatmap pool + middleware reorder". Operator follow-up: [`docs/Pending_Verification.md`](Pending_Verification.md) PV-011 covers the Railway load-test sign-off (memory headroom, p95 stability, OPTIONS short-circuit, `TRUSTED_PROXY_HOPS` smoke).

---

## CHUNK-09 · Dockerfile artifact `curl` layer reorder [LANDED 2026-05-23]

OPT-027 resolved. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "2026-05-23 · Dockerfile artifact `curl` reordered before `COPY . .`". `RUN curl` now sits before `COPY . .`; `mkdir -p data` added so the curl writes succeed in the new position; `.dockerignore` expanded to exclude release-fetched artifacts (foot-gun defense for local `docker build`); CLAUDE.md runbook paragraph updated to note `ARTIFACT_REV` is now the only knob that busts the artifact layer cache.

---

## CHUNK-10 · Build-script speedups [LANDED 2026-05-23]

OPT-029 + OPT-030 + OPT-052 + OPT-053 resolved. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) "2026-05-23 · Build-script speedups + greenest bake vectorization". Operator follow-up: [`docs/Pending_Verification.md`](Pending_Verification.md) PV-012 covers the post-deploy Lakeview East → Lincoln Park greenest spot-check after the new pickle lands on the GitHub release + the `STREET_GRAPH_SHA256` Railway variable rotates to `3d10cfbf...`. OPT-030's "KDTree(centroids)" catalog recipe was course-corrected to shapely 2.x batched `STRtree.nearest + shapely.distance` to preserve the original "distance to polygon edge" semantics (centroid distance would have broken Lincoln Park's proximity signal for lakefront edges).

---

## CHUNK-11 · On-demand heatmap fan-out
**Items:** OPT-025

**Why standalone:** Only chunk in Wave 4 that needs a frontend pair — the backend can land with backward-compatible `with_heatmaps: None = compute everything` default, but the throughput win only materializes when the frontend's `useExploreFetch` passes the filter derived from active toggles. Lands solo so the backend and frontend halves can review against the same contract.

**Files:**
- Backend — `backend/main.py:415–421` (`/explore` heatmap fan-out), `ExploreRequest` schema.
- Frontend — `frontend/src/hooks/useExploreFetch.js`, `frontend/src/lib/exploreApi.js`.

**Scope:**
- Add optional `with_heatmaps: list[str] | None = None` to `ExploreRequest`. When non-None, skip the matching `loop.run_in_executor` calls.
- `lib/exploreApi.js` passes a filter derived from the active toggle state (`showResidential`, `showParks`, etc.).
- `useExploreFetch` dependency array picks up changes to the filter so toggling causes a fresh fetch.
- Default `None` keeps backward compat — old frontends still get all four heatmaps.

**Verification:**
- With only residential toggled on, `/explore` response carries `parks_heatmap: null`, `green_space_heatmap: null`, `tree_canopy_heatmap: null`.
- Backend p95 drops by ~150 ms in the single-heatmap case.
- Toggling on a previously-off heatmap fires a fresh fetch (verify in network panel).

**Doc impact:**
- [`CLAUDE.md`](../CLAUDE.md) `POST /explore` request table (line ~260) — add a row for `with_heatmaps: list[str] | None, default None — when provided, limits heatmap computation to the named layers. Layer names: residential, parks, green_space, tree_canopy. Omit (or send null) to compute every heatmap.`
- `README.md` — same addition if the README mirrors the `/explore` request schema (TD-046 caught a prior `source` enum drift here; verify before assuming).
- [`docs/Pending_Verification.md`](Pending_Verification.md) — add a PV entry to confirm the wire-saving holds in production traffic (toggle distributions vary by user; the catalog's ~150 ms estimate assumes the modal user has 1–2 heatmaps on).

**Dependencies:** Best as a synchronized backend+frontend PR. If they must split, ship backend first (no behavior change with default None).

---

## CHUNK-12 · App.jsx memoization + ViewportProvider
**Items:** OPT-036, OPT-037, OPT-040, OPT-061

**Why grouped:** All four are React-render-path changes that touch `App.jsx` or the components it owns. OPT-036 (`useMemo` sidebar contents) and OPT-037 (stable `useCallback` handlers) are explicitly coupled in the catalog — neither works without the other. OPT-040 (stable `getSuggestions`) is a sibling stability fix in the same file. OPT-061 (`ViewportProvider` hoist) belongs in the same chunk because the `useMediaQuery` consumers in App.jsx are about to be memoization-sensitive, and re-broadcasting via context only helps if the consumers are stable too.

**Files:** `frontend/src/App.jsx`, `frontend/src/lib/useMediaQuery.js`, new `frontend/src/lib/viewport.jsx` (or similar).

**Scope:**
- OPT-036 — wrap `buildExploreContents()` and `buildRouteContents()` in `useMemo` keyed on the inputs they read (`mode`, `result`, `exploreResult`, `activeFlavor`, `walkLogged`, etc.) OR extract them as memoized child components.
- OPT-037 — wrap every handler used by the memoized subtrees in `useCallback` with real deps. Extract `modeToggle` JSX into a stable memoized component.
- OPT-040 — stabilize `getSuggestions` with `useCallback([])`; it only closes over module-level helpers.
- OPT-061 — hoist `useMediaQuery` consumers in App.jsx + MobileLayout behind a `ViewportProvider` at the root that registers one `matchMedia` listener per query and broadcasts via context. Update the hook to read from context if available; fall back to per-call listener otherwise.

**Verification:**
- React DevTools profiler: sheet drag, theme toggle, unrelated state changes do NOT re-render the sidebar subtrees.
- `ExploreForm` / `ExploreCategoryPanel` / `RouteFlavorTabs` stay stable across renders that don't change their props.
- Typing "Wrigley Field" fires one `/autocomplete` request, not one per keystroke.
- Resize fires one listener per query (not N × N).
- Mobile-Chrome touch frame budget under 16 ms during sheet drag.

**Dependencies:** Wave 5 anchor — every Wave 6 chunk benefits if this lands first.

---

## CHUNK-13 · MapLibre layer effect splits + feature-state hygiene + theme rAF
**Items:** OPT-038, OPT-039, OPT-058, OPT-059, OPT-060

**Why grouped:** All five are MapLibre + React `useEffect` discipline fixes. OPT-038 + OPT-058 + OPT-059 cluster on `MapRouteLayer` (split the broad effect, clear feature-state before `setData`, memoize `_buildTurnPathInfo`). OPT-039 + OPT-060 cluster on `MapExploreLayer` (split per-source effects, rAF the theme mutation observer). Shipping as one chunk lets profiler verification ("flavor swap repaints only the changed layer") run once across both surfaces.

**Files:** `frontend/src/map/MapRouteLayer.jsx:243–248`, `frontend/src/map/MapExploreLayer.jsx:61–67, 182–225`, `frontend/src/mapHelpers.js:53–77, 219–281`.

**Scope:**
- OPT-038 — split `MapRouteLayer`'s render effect into (a) a data-load effect keyed on `[result?.path, result?.directions, mode]` and (b) a flavor / active-turn effect that only calls `setFeatureState`. Memoize `buildRouteSegments(...)` outside the effect.
- OPT-058 — `removeFeatureState({ source: "walk-turns" })` (no `id`) BEFORE calling `setData` so orphaned high-IDs don't accumulate.
- OPT-059 — memoize `_buildTurnPathInfo` on `(path identity, directions identity)` in `useTurnCoords` or a ref in `MapRouteLayer`.
- OPT-039 — split `MapExploreLayer`'s single broad effect into one effect per layer source (residential, parks, green-space, canopy, polygon, pins). Each effect's deps include only the toggle + GeoJSON it manages.
- OPT-060 — gate the theme `MutationObserver` callback with a `requestAnimationFrame` token so coalesced mutations fire one `setThemeVersion`.

**Verification:**
- React DevTools + MapLibre internal layer inspector: flavor swap on a 50-step route stops re-running the polyline draw-in animation (no GPU buffer reallocation visible).
- Toggling a single heatmap only repaints that layer; other layers untouched.
- After 100 route swaps, the MapLibre feature-state map has at most `newRoute.turnCount` entries (not 100 × turnCount).
- Theme toggle fires exactly one MapLibre paint update.

**Dependencies:** After CHUNK-12 (the App.jsx changes stabilize parent renders so these layer effects see clean dep arrays).

---

## CHUNK-14 · Canvas CSS filter → raster paint properties
**Items:** OPT-042

**Why standalone:** The editorial Cream / Dusk sepia tint is part of the Wayfarer design system (see CLAUDE.md "Theme toggle"). Swapping `filter: sepia(...) saturate(...) brightness(...)` for MapLibre `raster-saturation` + `raster-hue-rotate` requires a visual review pass — the colors must match the current shipped look within design-system tolerance, in both Cream and Dusk. Bundling this with anything else risks the visual review being held hostage to unrelated changes.

**Files:** `frontend/src/App.css:929–935` (remove or scope `.maplibregl-canvas { filter: ... }`), `frontend/src/mapHelpers.js` (MapLibre style JSON raster paint properties), Dusk variant counterpart in `App.css`.

**Scope:**
- Bake the Cream sepia tint into the raster source's paint properties: `raster-saturation: -0.4` + `raster-hue-rotate: 30` (catalog estimate; tune by eye).
- Repeat for Dusk variant.
- If the style-level tuning doesn't quite hit the editorial tone, keep the CSS filter as a fallback but treat that as a known regression (file a follow-up).

**Verification:**
- Side-by-side screenshots of Cream + Dusk before/after — colors match within tolerance.
- Pan/zoom frame rate on a mid-tier Android: stays above 50 fps (catalog target).
- Chrome DevTools rendering profile: no per-frame canvas-filter blit.

**Doc impact:**
- [`docs/Pending_Verification.md`](Pending_Verification.md) — add a PV entry for the visual review pass in both Cream and Dusk on real hardware (this is the kind of subtle color-shift change where a screenshot diff on a single device is not enough; the editorial tone is the design contract, not a number).

**Dependencies:** Independent of CHUNK-13 (different surface).

---

## CHUNK-15 · First-paint assets + CSS paint cost
**Items:** OPT-041, OPT-064, OPT-066, OPT-067, OPT-073

**Why grouped:** All five reduce time-to-first-paint or per-frame paint cost. Bundled so one Lighthouse + DevTools paint-profile run validates all of them. Independent files; no internal sequencing.

**Files:** `frontend/index.html:21–25` (preload), `frontend/src/wayfarer/fonts.css:1–33` + new subset woff2 files in `frontend/public/fonts/`, `frontend/vite.config.js:148–155`, `frontend/src/App.css:2626–2634, 29–37`.

**Scope:**
- OPT-041 — four `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/...">` lines in `<head>` of `index.html`.
- OPT-064 — `fonttools subset` each woff2 to `U+0000-024F`; replace the current files; add `unicode-range: U+0000-024F;` to each `@font-face`.
- OPT-073 — add a React manual chunk rule in `vite.config.js` before the maplibre rule: `if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) return "react-vendor";`.
- OPT-066 — replace `.explore-cat-row-swatch` `box-shadow: 0 0 0 1px var(--ink)` with `border: 1px solid var(--ink)`. Verify swatch sizing still aligns (border participates in box-sizing).
- OPT-067 — drop `.wf-sheet` shadow blur from 24 px to 12 px, or move the shadow to `filter: drop-shadow(...)` on the parent so the sheet promotes to its own layer.

**Verification:**
- Chrome DevTools Network → Priorities: fonts request alongside the HTML.
- FCP drops by 200–400 ms on Fast 3G throttling.
- Total font bytes drop by 2–3× (~300–500 KB saved).
- React vendor chunk separate from app code; subsequent app releases reuse the cached chunk.
- Explore panel scroll FPS improves on mid-tier devices.
- Sheet drag stays at 60 fps on a mid-tier Android.

**Doc impact:**
- [`docs/Pending_Verification.md`](Pending_Verification.md) — add a PV entry for the FCP delta + sheet-drag fps on a real mid-tier Android. The throttled local Lighthouse number is indicative but not a substitute; sheet drag is the canonical mobile-perf surface and mobile parity is treated as a ship requirement on this project, not a retrofit.

---

## CHUNK-16 · localStorage write hygiene + fetch race + UX safety
**Items:** OPT-055, OPT-056, OPT-057, OPT-062, OPT-065, OPT-076, OPT-084

**Why grouped:** All seven are small async / state / storage cleanup fixes. They share the verification shape ("no regression in the fetch / save / share lifecycle") and the same risk profile (touching shared state surfaces). Bundling avoids seven nearly-identical "review the lifecycle around X" reviews.

**Files:** `frontend/src/App.jsx` (explorePrefs save effect), `frontend/src/lib/recentSearches.js:24–44`, `frontend/src/lib/stepLog.js`, `frontend/src/lib/autocompleteApi.js:8–43`, `frontend/src/hooks/useExploreFetch.js:66–73`, `frontend/src/hooks/useShareCard.js:117`, `frontend/src/hooks/usePersonalization.js:36–49`, `frontend/src/hooks/useRouteFetch.js:112`.

**Scope:**
- OPT-055 — debounce the `explorePrefs` save effect with `setTimeout` (300 ms); pair with a `beforeunload` flush.
- OPT-056 — refactor `saveRecentSearch` to load once, stringify the new key once, dedupe with `Set<string>`, serialize-and-write once.
- OPT-076 — coalesce the five separate `usePersonalization` save effects into one effect that depends on all five state values and writes one merged object (or calls all five savers in one batch).
- OPT-084 — on `stepLog` load, drop entries with `timestamp < now - 90d`, or cap at 100 most-recent.
- OPT-057 — replace the `if (exploreLoading) return;` guard in `useExploreFetch` with cancel-and-replace (abort prior AbortController, start fresh).
- OPT-062 — `Promise.race([renderPromise, timeoutPromise])` in `useShareCard`; reject after 5 s so the modal can show its existing error UI.
- OPT-065 — tiny in-memory LRU (`new Map()` + delete-on-get-re-set, max 20 entries) in `autocompleteApi.js` keyed by `(q, limit)`.

**Verification:**
- 10 rapid explore toggles → 1 storage write (not 10).
- Updating height + weight → 1 storage write (not 2).
- Rapid mode-toggles in `/explore` settle on the latest params, not the first.
- Share modal exits after 5 s on simulated render hang.
- Repeat autocomplete queries return <1 ms from cache; 10–20% reduction in `/autocomplete` traffic.
- `stepLog` stays well under quota even after simulated year of daily use.

---

## CHUNK-17 · DOM weight reductions
**Items:** OPT-063, OPT-078, OPT-085

**Why grouped:** All three reduce React commit-phase work. OPT-063 (DirectionLedger collapsed truncation) is the biggest of the three. OPT-078 + OPT-085 are smaller but cohere on "stop doing O(n) work in a per-render path."

**Files:** `frontend/src/components/DirectionLedger.jsx:60–114`, `frontend/src/components/ExploreCategoryPanel.jsx:183`, `frontend/src/components/AddressAutocomplete.jsx`, `backend/local_search.py:238–256` (suggestion `id` field).

**Scope:**
- OPT-063 — when collapsed, render only the first 5 + "show all" footer. When expanded, render all. Optionally add light virtualization for routes > 50 steps.
- OPT-078 — precompute `subsByCategory: Map<categoryKey, true>` in a `useMemo([selectedSubs])`; check `subsByCategory.has(cat.key)` in O(1).
- OPT-085 — backend `local_search.autocomplete` returns a stable `id` per suggestion (small change in source-merge); frontend uses it as the `<li key={...}>`.

**Verification:**
- A 100-step route mounts ~6 nodes collapsed (down from 100+); profiler shows reduced commit phase.
- Toggling one explore sub recomputes only the affected category's subtree.
- Suggestion list updates without DOM remounts on filter/reorder.

---

## Unscoped follow-ups

None at the moment — every OPT-022..-086 entry is assigned to a chunk above. Items that resolve naturally as a side-effect of other work (e.g. OPT-054 covered by CHUNK-07's lifespan warm-up) are still listed in their chunk so the resolution + delete-from-catalog step is explicit.

If new efficiency findings are catalogued (next audit batch), append them to [`Efficiency_Improvements.md`](Efficiency_Improvements.md) as usual; when a batch crosses ~10 items, fold them into this roadmap by adding a new wave or extending an existing chunk.
