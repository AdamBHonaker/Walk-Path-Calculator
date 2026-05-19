# Technical Debt

Known technical debt catalogued for future resolution. Priority: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an item in this file is resolved, **delete its entry from this file** and add a corresponding entry to the **Technical Debt Paid Off** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain debt that has not yet been addressed.

---

### TD-035 · Inline `style={{ ... }}` → CSS-class migration (carries SEC-007)
- **File**: [frontend/src/components/ShareDispatch.jsx](frontend/src/components/ShareDispatch.jsx), [frontend/src/components/ErrorDispatch.jsx](frontend/src/components/ErrorDispatch.jsx), [frontend/src/wayfarer/primitives.jsx](frontend/src/wayfarer/primitives.jsx), and others throughout `frontend/src/components/` and `frontend/src/wayfarer/`.
- **Category**: Code Quality / Defense-in-Depth Security
- **Priority**: 🟢 Low
- **Description**: The editorial design system uses inline `style={{ ... }}` attributes pervasively. The production CSP therefore still includes `style-src 'self' 'unsafe-inline'` (see the `passage-csp` plugin in [vite.config.js](../frontend/vite.config.js)). This was originally logged as security finding SEC-007 on 2026-05-13. It was reclassified as tech debt because the practical risk is low: inline-style XSS is limited to CSS-selector data exfiltration and requires an attacker to first land a script-injection foothold, which the SHA-256-hashed `script-src` (SEC-005 fix) now prevents.
- **Resolution path**: Migrate inline `style` objects to CSS classes (Wayfarer tokens already exist in `src/wayfarer/tokens.css`; the migration is mostly moving literal numeric values into named class rules). Once no JSX file declares `style={{` outside of dynamically-computed properties (animation transforms, MapLibre paint hex values), drop `'unsafe-inline'` from `style-src` in the `passage-csp` plugin's `directives` array. Verify by building and confirming `style-src 'self'` appears in `dist/index.html`.
- **Acceptance**: `grep -r "style={{" frontend/src` returns no matches in static-styling contexts, and the production CSP `style-src` reads `'self'` (no `'unsafe-inline'`).
- **Out of scope when this entry was opened**: ShareDispatch's editorial card has ~30 inline-style blocks that drive precise visual layout for PNG export; moving those to CSS classes risks visual regression and needs a tight visual-diff loop. Not blocking; the share card renders fine today.

---

### TD-033 · Tree canopy data source — OSM → NLCD raster pivot
- **File**: [backend/scripts/build_tree_canopy.py](backend/scripts/build_tree_canopy.py), [backend/tree_canopy.py](backend/tree_canopy.py)
- **Category**: Data Quality / External Source
- **Priority**: 🟢 Low
- **Description**: Feature 2 (Tree Canopy Heatmap) ships against OSM `natural=tree` nodes via Overpass. The original FEATURE_PLANS scope assumed the Chicago Data Portal's "Street Tree Inventory" — which doesn't actually exist on CDP (only 311 trim/debris service requests). The OSM pivot works but produces an uneven signal: ~30k mapped trees citywide cluster heavily in Grant/Millennium Park where mappers are most active; large residential neighborhoods (Lincoln Park, Logan Square, Pullman) read sparse despite having dense canopy in reality. Density bands were retuned to 0.05 / 0.15 / 0.40 (from the originally scoped 0.25 / 0.5 / 0.75) to make the signal visible citywide, but the underlying coverage gap remains.
- **Resolution path**: Pivot the ingest to NLCD Tree Canopy Cover (a national 30 m raster of canopy fraction, published by USGS). Pre-smoothed — no KDE needed; resample onto the existing 50 m grid and emit the same sparse-cells JSON. Runtime (`tree_canopy.py`), response field, and frontend layer stay as-is; only `build_tree_canopy.py` changes substantively. **Post-FEAT-4 consideration**: a canopy-data refresh now also requires rebuilding `street_graph_igraph.pkl` so the per-edge `tree_canopy_score` baked by `_bake_green_signals` reflects the new values — this is automatic via the in-container bake (or `python fetch_street_graph.py` locally). FEAT-4's greenest flavor inherits whatever the canopy signal looks like, so an NLCD pivot lifts both the explorer overlay AND the routing signal in one move. Acceptance: Lincoln Park reads dense, Pullman reads sparse, Grant Park stays dense.
- **Effort**: Medium (~1 chunk of work, no code touched outside the ingest script).
- **Out of scope here**: actually pulling NLCD requires a download flow (USGS doesn't have a SODA-style API). Add when someone wants tree canopy to be the layer's whole point rather than a "where have OSM mappers been" proxy.

---

### TD-032 · React 18 → 19 upgrade
*(Renumbered from TD-009c on 2026-05-11 — the TD-009 ID was reused twice in earlier scans; this preserves uniqueness across history. The two companion items in the same omnibus split landed as TD-030 (maplibre v4 → v5) and TD-031 (html-to-image → modern-screenshot) — see [RESOLVED_HISTORY.md](archive/RESOLVED_HISTORY.md).)*
- **File**: [frontend/package.json:18-19](frontend/package.json#L18-L19)
- **Category**: Outdated Dependency
- **Priority**: 🟡 Medium
- **Description**: `react` / `react-dom` `^18.3.1` — React 19 GA shipped in late 2024 with the new compiler, Actions / `useActionState`, and behavioral changes around `useEffect` timing and refs. Touches every component; PWA + Vite tooling needs to be comfortable with 19 before pulling the trigger.

- **Risk assessment (audited 2026-05-11, no code changed):**

  *Toolchain compatibility — looks clean:*
  - `@vitejs/plugin-react@^4.3.1` (currently installed) is React-version-agnostic and supports Vite 6. No co-bump required. (Avoid `@vitejs/plugin-react@^5` — its `latest` peer is `vite: ^8.0.0`, which would force a Vite major upgrade.)
  - `@testing-library/react@^16.3.2` (currently installed) lists `react: ^18.0.0 || ^19.0.0` as a peer. No co-bump required.
  - `vite-plugin-pwa@^1.2.0` does not pin React. Fine.

  *Legacy-API audit — clean:*
  - No `ReactDOM.render`, `hydrate`, `PropTypes`, `createFactory`, `unstable_*`, `act` from `react-dom/test-utils`, or `useEvent` usage anywhere in `frontend/src`.
  - Only one `forwardRef` call site: [ShareDispatch.jsx:28](frontend/src/components/ShareDispatch.jsx#L28). React 19 still supports `forwardRef` (deprecated, not removed); will likely produce a lint warning. Optional follow-up to migrate to `ref` as a regular prop (~5-line refactor).

  *Effect-timing surfaces to spot-check on device:*
  - Route draw-in animation: [MapRouteLayer.jsx:184-199](frontend/src/map/MapRouteLayer.jsx#L184-L199) — `requestAnimationFrame` driven, refs synced from props. StrictMode double-invocation in dev could re-run the animation; production unchanged.
  - Map layer add/remove effects: [MapView.jsx:92-99](frontend/src/MapView.jsx#L92-L99), [MapExploreLayer.jsx:45](frontend/src/map/MapExploreLayer.jsx#L45), [MapPickLayer.jsx:31-89](frontend/src/map/MapPickLayer.jsx#L31-L89). Heavy use of `useEffect` for source/layer lifecycle. React 19's effect ordering hasn't changed materially but StrictMode double-mount is stricter.
  - `WFSheet` drag handling (bottom-sheet pointermove): not React-event-driven, uses native listeners. Low risk.
  - Render-time ref mirror: [useRouteFetch.js:121](frontend/src/hooks/useRouteFetch.js#L121) (`fetchRouteRef.current = fetchRoute`). Idempotent, survives StrictMode double-render. Low risk.
  - `useShareCard` PNG capture relies on `map.once("render")` + `map.triggerRepaint()` — already lives outside React's render cycle. Low risk.

  *Callback-ref cleanup — clean:*
  - React 19 lets callback refs return cleanup functions. No inline `ref={(node) => { ... }}` patterns in the codebase that could accidentally trigger the new cleanup semantics. All refs are `useRef`-style.

- **Chunked execution plan** (each chunk pauses for go/no-go before the next):

  **Chunk 1 — Pre-flight & branch (no code changes).** Create a worktree or feature branch so main stays clean while TD-030 / TD-031 sit ready to merge. **Re-snapshot the current baseline before starting** — the figures originally captured here (204 tests; maplibre chunk 1,055 KB / 285 KB gz; index chunk 238 KB / 75.74 KB gz) predate the Neighborhood Explorer and Mobility-profile ships and are stale. The most recent published count is 247/247 (per the Mobility-profile entry in [FEATURE_HISTORY.md](FEATURE_HISTORY.md)); confirm against `npm test` at start-of-chunk before locking in the baseline. Re-run `npm view react@19 dist-tags` to confirm the latest `^19` minor.
  *Go signal:* baseline numbers captured **at chunk-1 start**, branch created.

  **Chunk 2 — Bump + green tests.** `npm install react@^19 react-dom@^19`. Run `npm test` (expect the chunk-1 baseline count still passing — the suite is mostly logic + mocked maplibre, not effect-timing-sensitive). Run `npm run build`. Note any new console warnings during test runs.
  *Go signal:* chunk-1 baseline count still passing (247/247 expected as of 2026-05-12 — confirm against the count locked in at chunk-1 start), build succeeds, no new errors. *Rollback:* `git restore frontend/package.json frontend/package-lock.json && npm install`.

  **Chunk 3 — Lint sweep.** Run `npm run lint`. Triage any new React 19 deprecation warnings (the `forwardRef` warning on [ShareDispatch.jsx:28](frontend/src/components/ShareDispatch.jsx#L28) is the expected one). For each warning: fix in place if trivial, or log as a TD-032-followup item if non-trivial.
  *Go signal:* lint passes or every warning is triaged with a decision (fix-now / defer-with-ticket).

  **Chunk 4 — Optional `forwardRef` → ref-as-prop refactor.** Only if Chunk 3 surfaced the deprecation warning *and* you want to clear it in the same session. Convert `ShareDispatch` to take `ref` as a regular prop, drop the `forwardRef` import. Re-run tests + build.
  *Go signal:* ShareDispatch still renders, share-card export still triggers, all tests green. *Skip rule:* if any test breaks or this feels rushed, leave the warning for a separate TD entry — the upgrade itself does not require this refactor.

  **Chunk 5 — Desktop dev smoke.** `npm run dev`. In Chrome desktop: load a route, watch the draw-in animation, toggle flavors, click a turn, switch to explore mode, click a place pin, open the share modal, hit Share. Watch the console for double-effects, double-fetches, or React 19 errors. Pay particular attention to the route draw-in re-running unexpectedly (StrictMode double-mount).
  *Go signal:* every interaction works, no unexpected console output. *Findings to log:* any visual quirk goes into a notes block at the bottom of this entry before proceeding.

  **Chunk 6 — Effect-timing spot-checks (still desktop).** Targeted checks at each surface flagged in the risk assessment above:
    - Route draw-in: animation runs once per result, not twice. Look at `MapRouteLayer.jsx` console.
    - Map layer add/remove: switching modes (route ↔ explore) doesn't leave orphan sources/layers. Inspect `map.getStyle().layers` in devtools after a few switches.
    - PNG capture: open the share modal, hit Share, confirm the map renders in the PNG (not blank).
    - WFSheet drag: open desktop devtools mobile emulation, drag the sheet between snap points — confirms `pointermove` handlers still fire correctly.
  *Go signal:* all four surfaces behave as in 18.x. *Findings to log:* anything unexpected becomes a checklist item for Chunk 7.

  **Chunk 7 — Mobile regression pass (device-required, user-driven).** This is the gate the original entry called out. Run `npm run dev:tunnel`, exercise the same surfaces from Chunk 6 on iOS Safari + Android Chrome. The share-card PNG export is the highest-risk surface — the iOS WebGL-backbuffer workaround in [useShareCard.js:100-121](frontend/src/hooks/useShareCard.js#L100-L121) was originally needed exactly because of effect-timing fragility. If the export regresses, document the failure mode here before rolling back. Also confirm the bottom-sheet drag still feels right (snap thresholds, momentum).
  *Go signal:* both devices clean for all four surfaces.

  **Chunk 8 — Docs + resolve.** Delete this entry from `Technical_Debt.md`, append a "Resolved" block to `RESOLVED_HISTORY.md` describing the upgrade and any departures from this plan (e.g. "skipped Chunk 4, opened TD-XXX for the forwardRef refactor"). Update `CLAUDE.md`'s "Key Design Decisions" only if a React 19 feature is now load-bearing (e.g. you opted into the new compiler). PR title: "Upgrade React 18 → 19".
  *Go signal:* docs match the actual delivered scope.

- **Suggested Improvement**: Run the eight chunks above sequentially, pausing for explicit go/no-go between each. Chunks 1–6 are doable in one session; Chunks 7–8 require user device access and a separate sitting. No need to bump `@vitejs/plugin-react`, `vite`, or `@testing-library/react`.

- **Decisions locked 2026-05-12 (pre-Chunk-2 pause — Chunk 1 ran, work paused before bump):**
  - **Version pin:** `^19.2.0` (latest minor as of 2026-05-12 is `19.2.6`). Mirrors the current `^18.3.1` pinning style. Chunk 2 install command becomes `npm install react@^19.2.0 react-dom@^19.2.0`.
  - **Isolation:** Work straight on `main`, no branch/worktree. Rollback via `git restore frontend/package.json frontend/package-lock.json && npm install` if needed.
  - **`forwardRef` refactor (Chunk 4):** **Skip** in this PR regardless of whether Chunk 3 surfaces the deprecation warning. If the warning lands, open a separate TD entry for the [ShareDispatch.jsx:28](frontend/src/components/ShareDispatch.jsx#L28) refactor rather than bundling here. Keep the upgrade PR focused on the version bump.
  - **React Compiler:** **Defer.** Tracked separately as TD-034 below. Stay opt-out for this upgrade.
  - **StrictMode posture:** If Chunks 5–6 surface noisy double-effects, fix the offending effects to be idempotent — do **not** drop `<StrictMode>` from [main.jsx](frontend/src/main.jsx).
  - **Ownership of remaining chunks:** User drives Chunk 7 (mobile device testing via `npm run dev:tunnel`). Assistant handles Chunk 8 (docs + PR) after Chunk 7 sign-off.
  - **Baseline re-snapshot (locked at Chunk-1 start, 2026-05-12):** `npm test` → **268 / 268** passing across 20 files. `npm run build` → main `index` chunk 251.48 KB (79.85 KB gz); `maplibre` chunk 1,055.26 KB (285.09 KB gz); CSS index 53.05 KB; maplibre CSS 69.94 KB. **Confirm against these figures (not the stale 247) at Chunk 2 go signal; re-baseline if more tests land before work resumes.**

---

### TD-034 · Evaluate React Compiler opt-in
- **File**: [frontend/vite.config.js](frontend/vite.config.js), [frontend/package.json](frontend/package.json)
- **Category**: Forward-looking optimization
- **Priority**: 🟢 Low
- **Description**: React 19 ships the React Compiler (`babel-plugin-react-compiler`) as an opt-in feature that auto-memoizes components and hooks, potentially eliminating most hand-written `useMemo` / `useCallback` / `React.memo` calls. Decision deferred from TD-032 (2026-05-12) — the React 18 → 19 upgrade is staying compiler-opt-out to keep its blast radius small.

  Opt-in requires: install `babel-plugin-react-compiler`, wire it into `@vitejs/plugin-react`'s `babel.plugins`, decide on `compilationMode` (`"infer"` is the default), run the suite, then audit for behavior changes around `useEffect` deps and ref identity. The compiler has known edge cases with non-idiomatic patterns; the audit is not trivial.

- **Verification when resolved**: Compiler enabled in `vite.config.js`, full test suite green, no behavioral regressions in the surfaces listed in TD-032's risk assessment (route draw-in, map layer effects, share PNG export, sheet drag). Note any bundle-size or runtime wins in the resolution entry.

---

