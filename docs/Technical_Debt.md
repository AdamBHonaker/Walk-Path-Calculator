# Technical Debt

Known technical debt catalogued for future resolution. Priority: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an item in this file is resolved, **delete its entry from this file** and add a corresponding entry to the **Technical Debt Paid Off** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain debt that has not yet been addressed.

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

  **Chunk 1 — Pre-flight & branch (no code changes).** Create a worktree or feature branch so main stays clean while TD-030 / TD-031 sit ready to merge. Snapshot the current baseline: test count (204), build output sizes (maplibre chunk 1,055 KB / 285 KB gz; index chunk 238 KB / 75.74 KB gz), eslint warning count. Re-run `npm view react@19 dist-tags` to confirm the latest `^19` minor.
  *Go signal:* baseline numbers captured, branch created.

  **Chunk 2 — Bump + green tests.** `npm install react@^19 react-dom@^19`. Run `npm test` (expect 204/204 still passing — the suite is mostly logic + mocked maplibre, not effect-timing-sensitive). Run `npm run build`. Note any new console warnings during test runs.
  *Go signal:* 204/204 tests pass, build succeeds, no new errors. *Rollback:* `git restore frontend/package.json frontend/package-lock.json && npm install`.

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

---

