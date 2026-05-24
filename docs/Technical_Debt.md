# Technical Debt

Known technical debt catalogued for future resolution. Priority: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an item in this file is resolved, follow the **[Chunk completion checklist](Technical_Debt_Roadmap.md#chunk-completion-checklist)** in the roadmap. At minimum: delete the entry from this file, add a corresponding entry to the **Technical Debt Paid Off** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how, and prune the roadmap's dependency graph + tables. CLAUDE.md / README.md / Pending_Verification.md updates are conditional — see the checklist. This file should only ever contain debt that has not yet been addressed.
>
> **Sequencing:** Before picking up a new chunk, consult [`Technical_Debt_Roadmap.md`](Technical_Debt_Roadmap.md) for dependencies and parallel-safe lanes across the open items.

---

## Audit batch 2026-05-23 (multi-pass tech-debt sweep)

A three-pass codebase audit (six Explore subagents across backend, frontend, cross-cutting, security, and API-contract surfaces) catalogued **~140 findings**. Each pass ignored items already flagged by earlier passes, then the final pass deep-read the two highest-complexity files (`backend/walking.py`, `frontend/src/App.jsx`) and the security + API-contract surfaces. Findings were grouped into **30 chunks across 7 waves** (TD-045 through TD-072 below; CHUNK-29 and CHUNK-30 are already tracked as TD-032 and TD-044 respectively).

**Finding-ID convention** (audit-scoped): `B-*` backend, `F-*` frontend, `X-*` cross-cutting, `S-*` security, `C-*` cross-stack contract.

**Wave map (parallelism cheat-sheet):**

| Wave | TD entries | Theme | Parallel-safe? |
|------|------------|-------|----------------|
| 0 | TD-045 | Repo basics & docs | Standalone now (TD-046 / -047 resolved) |
| 1 | TD-048 / -049 / -050 / -051 | Operational hardening | Yes; TD-051 (PV burn-down) is human-driven |
| 2 | TD-053 → TD-059 | Backend correctness + API contract | Yes except TD-053 → TD-054 (walking.py) |
| 3 | TD-060 → TD-066 | Frontend correctness + UX | TD-061 + TD-062 both touch App.jsx — keep in lockstep |
| 4 | TD-067 | Security headers + input validation | Standalone |
| 5 | TD-068 → TD-071 | Forward-looking architecture | Yes |
| 6 | TD-072 (+ TD-032, TD-034, TD-044) | Polish / paused | Optional |

**Audit priorities at a glance** — 12 High items concentrated in: PV burn-down (TD-051), artifact pipeline guardrails (TD-050), missing LICENSE (TD-045). Most other items are 🟡 Medium or 🟢 Low.

---

### TD-045 · CHUNK-01 · Repo metadata + license + contributor docs
- **Files (new)**: `LICENSE`, `ATTRIBUTION.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
- **Category**: Project governance / legal
- **Priority**: 🔴 High (LICENSE) / 🟢 Low (the rest)
- **Findings**:
  - **X-25** — No `LICENSE` file at repo root; default copyright = "all rights reserved", which prevents OSS contribution.
  - **X-26** — No `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md`. Commit-prefix convention (`feat:` / `fix:` / `chore:` / `docs:`) and PR-flow are followed but never documented.
- **Description**: The repo carries no explicit license despite being on GitHub, and the contribution conventions live only in commit history. Adding these is zero code-risk.
- **Scope**:
  - Pick a license — MIT recommended unless data-source attribution conflicts (verify OSM, NLCD 2021, Chicago Data Portal, LocationIQ obligations).
  - Move data-source attribution into a separate `ATTRIBUTION.md` so the license file stays clean.
  - Codify the commit-prefix + PR-flow conventions already followed in practice; include "test required before merge" expectation.
- **Acceptance**: GitHub renders the license badge; `CONTRIBUTING.md` is linked from README; `ATTRIBUTION.md` satisfies each upstream data source's license requirements.

---

### TD-048 · CHUNK-04 · `railway.toml` + Railway env-var doc
- **Files (potentially new)**: `railway.toml`, `docs/RAILWAY.md`, `backend/.env.example`
- **Category**: Deployment configuration
- **Priority**: 🟡 Medium
- **Findings**:
  - **X-11** — `backend/railway.toml` is minimal (per CLAUDE.md); Railway-required variables (`ARTIFACT_REV`, `STREET_GRAPH_SHA256`, `TRUSTED_PROXY_HOPS`, `LOCATIONIQ_API_KEY`, CDP creds) live only in the Railway dashboard.
  - **X-24** — Audit pass-2 grep found no `railway.toml` at all; CLAUDE.md:78 documents it as present. Default Railway behavior (infer from Dockerfile, run `CMD`) is being relied upon.
  - **X-12** — `backend/.env.example` documents runtime vars but doesn't mention build-time `STREET_GRAPH_SHA256` / `ARTIFACT_REV`.
- **Description**: A new Railway deploy from a fresh fork can't succeed by reading the docs alone. Codify build/start/port/health-check + every Railway-only var.
- **Scope**:
  - Verify whether `railway.toml` exists; if not, create a minimal one (build cmd / start cmd / port / health check at `/health`).
  - Document every Railway-only var in `docs/RAILWAY.md` with type + meaning.
  - Split `.env.example` into "build-time only" and "runtime" sections.
- **Acceptance**: A fresh fork-and-deploy succeeds by following `docs/RAILWAY.md` without operator out-of-band knowledge.

---

### TD-049 · CHUNK-05 · GitHub Actions CI baseline
- **Files (new)**: `.github/workflows/ci.yml`, optional `.github/dependabot.yml`
- **Category**: CI / DevOps automation
- **Priority**: 🟡 Medium
- **Findings**:
  - **X-07** — No `.github/workflows/` directory exists. Tests are documented (pytest, vitest) but there's no automation to run them on PRs; recent merges show no check-status context.
- **Description**: Tests run locally only. A PR could merge with breaking tests and no one would know until the next manual run.
- **Scope**:
  - Workflow runs `pytest backend/tests/` and `npm test --prefix frontend` on every PR and push to `main`.
  - Add `pip-audit` (or Dependabot) for backend, and a lint step (`ruff` + `eslint`).
  - Pin Python (3.11) and Node (18 LTS) versions explicitly.
- **Acceptance**: Open a throwaway PR; CI runs green; intentionally break a test and confirm CI fails the PR.

---

### TD-050 · CHUNK-06 · Artifact pipeline guard rails
- **Files**: `backend/Dockerfile`, new `docs/Release.md` or CLAUDE.md update
- **Category**: Release operations
- **Priority**: 🔴 High
- **Findings**:
  - **X-08** — Artifact refresh runbook (CLAUDE.md:424-514) is fully manual: rebuild `.pkl`, recompute SHA-256, upload to GitHub release, bump `ARTIFACT_REV`, rotate `STREET_GRAPH_SHA256`. Forgetting `ARTIFACT_REV` ships stale bytes (BuildKit layer cache).
  - **X-23** — `backend/Dockerfile:50` `ARTIFACT_REV=2026-05-20`; recent commits (Divvy + Landmarks ingest on 2026-05-21) modify `places_curated.json`. If assets were re-uploaded without a bump, production has stale data.
- **Description**: The runbook works but has no safety net. A pre-deploy guard + better docs + (optionally) an automation script would close the gap.
- **Scope**:
  - Add a build-time check that fails fast if `STREET_GRAPH_SHA256` is empty when `ARTIFACT_REV` looks recent.
  - Verify whether the 2026-05-21/22 ingest commits required an `ARTIFACT_REV` bump; bump if so.
  - Crisper operator workflow in a dedicated `docs/Release.md` (or expanded CLAUDE.md section).
  - Optional: a GitHub Action that re-bakes `.pkl` and opens a PR with the bumped `ARTIFACT_REV` + new hash.
- **Acceptance**: Manually rotate `ARTIFACT_REV` without rotating the hash → build fails fast with a clear message.

---

### TD-051 · CHUNK-07 · Pending-Verification burn-down (no code)
- **Files**: `docs/Pending_Verification.md`
- **Category**: Verification backlog
- **Priority**: 🔴 High
- **Findings**:
  - **X-15** — Ten open PV items; several shipped code-only. Severity ranking: **PV-006 (greenest routing in prod)** is the highest-risk because it reshapes the pickle format and hasn't been confirmed live. PV-001 / PV-004 / PV-005 / PV-008 need real-device sign-off. PV-002 needs a live LocationIQ key. PV-007 / PV-009 / PV-010 are code-complete but data-pending (CDP / Overpass credentials or network).
- **Description**: Verification work, not code. Multi-City (Feature 1) explicitly requires the PV backlog cleared before chunk 1 starts.
- **Scope**:
  - Sequence: PV-006 in prod first → PV-001 / PV-004 / PV-005 / PV-008 on iPhone + Android via `npm run dev:tunnel` → PV-002 with a live key → PV-007 / PV-009 / PV-010 once API access is available.
  - Update `Pending_Verification.md` checkboxes; move resolved items to `archive/RESOLVED_HISTORY.md` per the file's own process note.
- **Acceptance**: All ten PV items either resolved or formally classified as `post-ship` per the classifier convention in [`Pending_Verification.md`](Pending_Verification.md).

---

### TD-059 · CHUNK-15 · Backend test coverage gaps
- **Files**: `backend/tests/test_geocoding.py` (or new `test_geocoding_cascade.py`), `backend/tests/test_explore_perf.py`, new `backend/tests/test_redaction.py`
- **Category**: Test coverage
- **Priority**: 🟡 Medium
- **Findings**:
  - **B-12** — No integration test for the full geocoding cascade; tiers tested in isolation but order is load-bearing.
  - **B-13** — `test_explore_perf.py` not gated in CI; isochrone regressions invisible.
  - **B-37** — `_redact_coord` coverage not asserted by any test; new log sites can silently bypass redaction.
- **Description**: Three targeted test additions that close coverage gaps without restructuring existing tests.
- **Scope**:
  - Cascade integration test: mock each tier to None/fail, assert advancement order.
  - Add CI threshold to `test_explore_perf.py` (e.g., 45-min budget < 200 ms; fail on +10% regression).
  - Redaction coverage: monkey-patch `logger.warning`/`info`/`error`, fuzz coords through geocoding + walking, assert no `41.x, -87.x` in log lines.
- **Acceptance**: New tests run green; CI (TD-049) gates the perf threshold.

---

### TD-072 · CHUNK-28 · CSS modularization + naming consistency (optional polish)
- **Files**: `frontend/src/App.css` (split), `frontend/src/wayfarer/responsive.css`
- **Category**: Code organization
- **Priority**: 🟢 Low
- **Findings**:
  - **F-11** — `App.css` is 3,146 lines with no subfile split; manageable but on the edge.
  - **F-12** — `!important` saturation in `wayfarer/responsive.css:67-91`; intentional (defeats higher-specificity modal selectors) but a specificity-bumped BEM variant would be cleaner.
  - **F-13** — Component-local layout constants in `ShareDispatch.jsx:15-17` (`CARD_WIDTH`, `MAP_HEIGHT`); move to tokens if ever reused.
  - **F-14** — CSS class naming mixes BEM with flat kebab; document the convention if adopted.
- **Description**: Skip unless `App.css` crosses ~4K lines or editing friction emerges. Polish only.
- **Scope**: Split `App.css` into per-area sheets; introduce a BEM variant (`.wf-modal--fullscreen-mobile`) to retire `!important`; document the convention.
- **Acceptance**: Visual regression check of share-card + main UI; no behavior change.

---

## Items not duplicated as TD entries

The following audit findings are not re-catalogued here because they overlap existing tracked items:

- **F-06** (`forwardRef` deprecated in React 19) — already inside **TD-032** chunk 4 follow-up plan.
- **F-10** / **F-16** (ShareDispatch inline styles + share-card PNG fragility) — already **TD-044**.
- **X-05** (React 18 → 19 paused) — already **TD-032**.
- **X-06** (`eslint.config.js` hardcodes React 18) — handled inside TD-032 chunk 3.

A handful of audit "Confirms / clean" notes were positive findings (lazy-loading, parameterized SQL, no `dangerouslySetInnerHTML`, no `subprocess`/`eval`, BUG-006 fix still in place, 31 frontend tests with no skips) — those are not debt and aren't tracked.

---

### TD-044 · ShareDispatch inline-style migration + CSP `style-src` tightening (final SEC-007 chunk)
- **File**: [frontend/src/components/ShareDispatch.jsx](frontend/src/components/ShareDispatch.jsx), [frontend/vite.config.js](frontend/vite.config.js).
- **Category**: Code Quality / Defense-in-Depth Security
- **Priority**: 🟢 Low
- **Description**: Carries the unfinished chunk of the broader inline-style migration (formerly TD-035; the seven other components + two Wayfarer primitives landed 2026-05-18 — see [RESOLVED_HISTORY.md](archive/RESOLVED_HISTORY.md) "Inline-style → CSS-class migration"). ShareDispatch was held back because its ~30 inline-style blocks drive the precise visual layout the share-card PNG export depends on, and refactoring without a tight visual-diff loop risks regressing a surface the user cannot easily re-verify after the fact. As long as ShareDispatch keeps inline `style={{ ... }}`, the production CSP cannot drop `'unsafe-inline'` from `style-src` (currently the only remaining `'unsafe-inline'` directive — `script-src` was tightened in SEC-005).
- **Resolution path**: (1) Capture a baseline share-card PNG via `useShareCard` in the current build (set wheeled and walking mobility profiles, both with and without a paceLabel; capture at desktop + mobile widths). (2) Migrate each `style={{ ... }}` block in [ShareDispatch.jsx](../frontend/src/components/ShareDispatch.jsx) into a `.share-card-*` class in [frontend/src/App.css](../frontend/src/App.css) (or a new `frontend/src/components/ShareCard.css` if it's cleaner to colocate). Keep dynamic bits inline — the `gridTemplateColumns` for the 2 vs 3 vs 4 stat columns is the obvious one; check for others. (3) Recapture the PNGs after migration and diff against the baseline; only proceed once the pixel deltas are at the antialiasing-noise floor. (4) Drop `'unsafe-inline'` from the `style-src` directive in the [`passage-csp` plugin](../frontend/vite.config.js); update the existing comment that explains why it's there. (5) Build and confirm `style-src 'self'` (no `'unsafe-inline'`) appears in `dist/index.html`. (6) Smoke-test the share modal on a real device — Chrome's CSP enforcement is silent on the meta tag in some failure modes.
- **Acceptance**: `grep -r "style={{" frontend/src` returns matches only for dynamic-styling contexts (per-instance widths, transforms, grid templates — never static fonts/colors/borders). Production CSP `style-src` reads `'self'` with no `'unsafe-inline'`. Share-card PNG export visually identical to baseline.
- **Defer rationale**: Without an automated visual-regression rig, the risk/effort ratio favors batching this with whatever other share-card work comes next.

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

