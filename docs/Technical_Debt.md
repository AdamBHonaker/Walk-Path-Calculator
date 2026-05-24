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

**Audit priorities at a glance** — 12 High items concentrated in: same-node routing (TD-053), PV burn-down (TD-051), artifact pipeline guardrails (TD-050), missing LICENSE (TD-045), backups (TD-070). Most other items are 🟡 Medium or 🟢 Low.

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

### TD-053 · CHUNK-09 · `walking.py` correctness sweep
- **Files**: `backend/walking.py`, `backend/tests/test_walking.py` (or new dedicated test files)
- **Category**: Backend correctness
- **Priority**: 🔴 High
- **Findings**:
  - **B-40** — Same-node origin/destination not short-circuited; igraph returns empty `epath` and the code silently returns an empty directions tuple.
  - **B-41** — dtype mixing in `_get_avoid_stairs_weights:909-915`: float32 source cast to float64 then penalty added; inconsistent with the main `_build_flavor_weights` path which stays in float32.
  - **B-42** — `_build_path_and_directions:1029-1047` reverse + `skip_first` is asymmetric: forward skips index 0, reverse skips index `n-1`, with different geometric meanings.
  - **B-43** — Cardinal-direction binning brittle near 0/180° (`walking.py:1070-1072`); float drift causes jitter between adjacent labels.
  - **B-44** — No defensive guard for empty `epath` when `len(vpath) >= 2`; theoretically impossible per igraph contract, but silent on regression.
  - **B-45** — NaN handling in greenest discount (`walking.py:579-590`) silently degrades a corrupt edge to length-only weight; no operator-visible indicator.
  - **B-46** — `_BLOCK_TYPE_THRESHOLD = 150.0` classifies exactly-150m as "long" — closer to short-block range but `>=` flips it.
  - **B-47** — `_kdtree_to_vertex` int64 dtype assumed by consumers; a future refactor could silently truncate on very large graphs.
- **Description**: Land these tests + fixes before the module-split refactor in TD-054 so the new test surface lives in the new structure from day one.
- **Scope**:
  - Same-node short-circuit (return zero-distance, zero-direction route with a clear marker).
  - Standardize dtype across all flavor weight paths (pick float32 — the dominant native dtype — and convert once at module boundary).
  - Audit reverse + skip_first asymmetry; fix or document the geometric semantics.
  - One-shot WARNING (counter) when `nan_to_num` rescues an edge in greenest.
  - Snap cardinal direction to exact label within a 1° tolerance band.
  - Defensive `if not raw: log + return` for empty epath.
  - Pick `>` or `>=` for the block threshold deliberately and add a docstring comment.
  - Assert `_kdtree_to_vertex` dtype at load.
- **Acceptance**: New unit tests for: same-node route, NaN-poisoned canopy edge, near-cardinal heading (179.5° / 180.5°), reverse + skip_first round-trip. `pytest backend/tests/test_walking*.py -v` green.
- **Sequencing**: **Land before TD-054**.

---

### TD-054 · CHUNK-10 · `walking.py` module split
- **Files**: `backend/walking.py` → split into `backend/walking.py` + `backend/walking_weights.py` + `backend/walking_formula.py`. Update imports in `backend/main.py`, `backend/fetch_street_graph.py`, tests.
- **Category**: Code maintainability
- **Priority**: 🟡 Medium
- **Findings**:
  - **B-01** — `walking.py` is 1,116 LOC + 32 functions mixing graph load, edge caches, flavor weights, shortest-path, and directions.
  - **B-09** — Greenest formula constants split across `walking.py:99-103` (runtime) and `fetch_street_graph.py:250-254` (bake) with no unified reference; a tuning round must touch both.
  - **B-11** — Greenest weight formula partially duplicated between bake (`_bake_green_signals`) and runtime (`_build_flavor_weights`).
  - **B-15** — `_build_path_and_directions:999-1087` is 88 lines with sparse inline docs.
  - **B-38** — `green_mask` is rebuilt on every cache-miss instead of once per graph load.
- **Description**: After the correctness sweep lands, split the module along natural boundaries so the formula has a single source of truth.
- **Scope**:
  - Move per-edge caches + flavor weight builder to `walking_weights.py`.
  - Move greenest constants + bake helpers to `walking_formula.py` (consumed by both `walking.py` runtime and `fetch_street_graph.py` bake).
  - Cache `green_mask` at module load alongside `_edge_highways`.
  - Add algorithm-level docstring to `_build_path_and_directions`.
  - Add a "Greenest formula" section to CLAUDE.md listing all constants and where they apply.
- **Acceptance**: All existing tests pass; greenest formula constants exist in exactly one location; CLAUDE.md updated.
- **Sequencing**: **After TD-053.**

---

### TD-055 · CHUNK-11 · `geocoding.py` refactor + shared constants
- **Files**: `backend/geocoding.py`, `backend/utils.py`, `backend/local_search.py`
- **Category**: Code maintainability
- **Priority**: 🟡 Medium
- **Findings**:
  - **B-02** — `geocoding.py` (950 LOC) mixes HTTP, cache, fuzzy match, KDTree, and cascade orchestration with inconsistent per-tier error handling.
  - **B-05** — `_KDTREE_LON_SCALE` baked into the cached kdtree without versioning; a future scale change would silently consume the stale tree.
  - **B-21** — `_http_session` never closed, no User-Agent, no retry adapter.
  - **B-39** — `_KDTREE_LON_SCALE` informally consistent between `geocoding.py` and `local_search.py`; drift would silently diverge rankings.
- **Description**: Decompose the cascade so each tier is a callable with consistent error handling; share the lat-scale constant.
- **Scope**:
  - Extract `_CachedGeocoder` and tier callables (`_NeighborhoodTier`, `_LocalSearchTier`, `_LocationIQTier`); compose them in `resolve_location` as a clean for-loop.
  - Hoist `_KDTREE_LON_SCALE` to `utils.py`; import in both consumers.
  - Include scale value in kdtree cache key (or invalidate on change).
  - Set `requests.Session()` with UA header, retry adapter, and close-on-shutdown.
- **Acceptance**: `pytest backend/tests/test_geocoding.py test_local_search.py` green; cascade unit tests cover the for-loop ordering.

---

### TD-056 · CHUNK-12 · FastAPI lifespan + rate-limiter robustness
- **Files**: `backend/main.py`, `backend/walking.py` (eviction log), `backend/geocoding.py` (close), `backend/tests/conftest.py`, new `backend/tests/test_rate_limit.py`
- **Category**: Backend ops / lifecycle
- **Priority**: 🟡 Medium
- **Findings**:
  - **B-17** — Lifespan yields with no shutdown cleanup; eviction daemon force-killed at exit; preload future fire-and-forget.
  - **B-18** — Preload future's result is discarded — silent failure means next request synchronously blocks on `_load_graph()`.
  - **B-19** — Eviction daemon has a TOCTOU race on `_last_graph_access` (outer unlocked check, inner authoritative recheck).
  - **B-20** — `geocoding._cache_db` close runs via atexit; lifespan-shutdown ordering not guaranteed (WAL flush risk on graceful redeploy).
  - **B-24** — `_client_ip` silently falls back to peer when `TRUSTED_PROXY_HOPS` overshoots header length; no log signal.
  - **B-25** — `_client_ip` doesn't validate XFF token is an IP; malformed headers produce bogus rate-limit keys.
  - **B-35** — `conftest.py:26` disables rate limiting globally — limiter is untested.
  - **B-36** — `_start_eviction_daemon` returns silently when TTL=0 — operator can't confirm the setting.
- **Description**: Tighten the startup / shutdown contract and add the missing rate-limit test surface.
- **Scope**:
  - After-yield cleanup: await preload future, close `_cache_db`, close `_http_session`.
  - Capture preload future's done-callback; log + export a `preload_ready` flag.
  - Document the TOCTOU pattern (advisory outer / authoritative inner) or move check inside the lock.
  - Validate XFF tokens with `ipaddress.ip_address`; latch one-shot WARNING on overshoot.
  - Log "Graph eviction disabled (TTL=0)" instead of silent return.
  - Add `tests/test_rate_limit.py` with `RATE_LIMIT_ENABLED=true` that drives a 429.
- **Acceptance**: New rate-limit test green; uvicorn logs show graceful-shutdown messages locally.

---

### TD-057 · CHUNK-13 · Local-search + autocomplete hardening
- **Files**: `backend/main.py`, `backend/local_search.py`, `backend/places.py`, `backend/tests/test_local_search.py`
- **Category**: Backend reliability
- **Priority**: 🟡 Medium
- **Findings**:
  - **B-04** — `/explore` accepts unknown category strings silently; `ExploreRequest.validate_categories` cleans the list but never cross-checks against the known set.
  - **B-07** — `local_search.autocomplete():174-184` permanently degrades when `all_places()` raises — `_in_mem_built=True` is set after the warning, so a corrupted places file silently strips POI suggestions for the life of the process.
- **Description**: Two small but high-impact reliability fixes.
- **Scope**:
  - Build a cached `KNOWN_CATEGORIES` set from `places.all_places()`; validate `/explore` `categories` against it and 422 on unknowns.
  - Reset `_in_mem_built=False` when `all_places()` raises so subsequent requests retry; surface an `autocomplete_degraded` flag in `/health`.
- **Acceptance**: `/explore` with `categories=["bogus"]` → 422; symlink-corrupt `places_osm.json`, hit `/autocomplete`, restore, confirm recovery on next request.

---

### TD-058 · CHUNK-14 · Ingest-script standardization
- **Files**: new `backend/scripts/_ingest_runner.py`; edits across `backend/scripts/build_*.py`
- **Category**: Data ingest reliability
- **Priority**: 🟡 Medium
- **Findings**:
  - **B-26** — Ingest scripts overwrite output JSON in-place; interrupt mid-write trashes the artifact.
  - **B-27** — Inconsistent error handling across ingest scripts (retry+backoff in some, raise-on-first in others, no catch in `_cdp_client.py`).
  - **B-28** — Output JSON artifacts inconsistent on metadata envelope (some carry `{metadata, source, fetched_at}`, some are bare arrays).
  - **B-29** — No persistent `requests.Session()` in ingest scripts — each call cold-opens TCP.
  - **B-30** — Inconsistent HTTP timeouts (`60`, `120`, `300`, omitted).
  - **B-31** — `build_address_points.py:169-179` has fixed `--sleep 10` between chunks; doesn't back off on failure streaks.
  - **B-32** — `migrate_geocode_cache.py:117-124` rename is not concurrency-safe.
  - **B-33** — `places._load_places_file` silently treats missing/malformed shape as empty.
  - **B-34** — `residential_heatmap` JSON parse has no size cap (`backend/places.py:235`).
- **Description**: Ingest scripts evolved organically; a shared runner removes ~80% of the per-script boilerplate while making them safer.
- **Scope**:
  - `_ingest_runner.py` provides: persistent `requests.Session()`, unified `_HTTP_TIMEOUT_S`, retry+backoff with adaptive inter-chunk sleep, atomic write via `*.tmp` → `os.replace`, optional `*.bak`, metadata envelope.
  - Add `--check-freshness` mode (warn when artifact older than N days).
  - Concurrency-safe rename in `migrate_geocode_cache.py`.
  - Schema check + size cap on `places._load_places_file`.
- **Acceptance**: Re-run `build_landmarks.py` end-to-end and kill mid-write — output unchanged (atomic).

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

### TD-065 · CHUNK-21 · Frontend performance micro-optimizations
- **Files**: `frontend/src/App.jsx`, `frontend/src/map/MapExploreLayer.jsx`
- **Category**: Performance
- **Priority**: 🟢 Low
- **Findings**:
  - **F-19** — `mapPadding` recomputed on every pointermove during sheet drag (`App.jsx:364-371`); new object per frame.
  - **F-08** — `MapExploreLayer` detects theme flips via MutationObserver on `<html>` class; couples paint layer to a specific DOM side-effect.
- **Description**: Both are latent (not user-visible today); fix when the area is being edited anyway.
- **Scope**:
  - Debounce / rAF the `mapPadding` updates (e.g., schedule via `requestAnimationFrame`, drop duplicates).
  - Pass `themeVersion` (or theme identifier) as a prop down from App; remove the MutationObserver.
- **Acceptance**: Drag the mobile sheet — confirm < 60 mapPadding updates / sec in profiler; theme flip — confirm MutationObserver no longer registered.

---

### TD-066 · CHUNK-22 · PWA / service worker / screenshot resilience
- **Files**: `frontend/vite.config.js`, optionally `frontend/public/manifest.webmanifest`, `frontend/src/hooks/useShareCard.js`, `frontend/src/App.jsx`
- **Category**: PWA / resilience
- **Priority**: 🟢 Low
- **Findings**:
  - **F-21** — PWA manifest generated inline in `vite.config.js:106-136`; not a static file, can't be overridden per env or served with custom headers.
  - **F-22** — No telemetry on SW update lifecycle (`App.jsx:414-431`); can't tell whether the swap succeeded or whether the prompt was accepted.
  - **F-26** — `useShareCard` dynamic-imports `modern-screenshot` with no timeout fallback (`useShareCard.js:102`).
  - **F-27** — Three different fetch timeouts (5s / 10s / 12s) with no documented rationale.
  - **S-07** — Service-worker runtime caching whitelist is incomplete (`vite.config.js:137-144`); `/explore`, `/autocomplete`, `/reverse-geocode` fall back to the default strategy.
- **Description**: PWA polish; not user-blocking but improves observability and resilience on slow networks.
- **Scope**:
  - Optionally externalize the manifest to `frontend/public/manifest.webmanifest`.
  - Console checkpoints in the SW update lifecycle (`onNeedRefresh`, `fn(true)` callback).
  - Race `modern-screenshot` import against a 5s timeout; surface download-fallback UI on timeout.
  - Document the three timeout values inline with their rationale.
  - Explicit `NetworkOnly` rules for `/explore`, `/autocomplete`, `/reverse-geocode`.
- **Acceptance**: Throttle to slow-3G; share-card export shows fallback toast after 5s rather than hanging.

---

### TD-067 · CHUNK-23 · Security headers + input validation hardening
- **Files**: `backend/main.py`, frontend attribution components
- **Category**: Defense-in-depth security
- **Priority**: 🟡 Medium
- **Findings**:
  - **S-01** — No `Permissions-Policy` header set; middleware sets XFO, XCTO, Referrer-Policy, HSTS but not Permissions-Policy.
  - **S-02** — Error responses echo user-supplied stop strings (`backend/main.py:594, 610`); minor info leak / log noise.
  - **S-03** — `/autocomplete` `q` length not enforced at the Pydantic boundary; 200-char limit checked in handler body after the request lands.
  - **S-04** — Coord validation relies on NaN-comparison semantics; explicit `math.isfinite` is more robust.
  - **S-05** — Implicit HEAD method handling; CORS `allow_methods` doesn't mention HEAD.
  - **S-06** — Community-area echo in 404-style error (very minor info disclosure).
  - **S-09** — External attribution links don't carry `rel="noreferrer noopener"`.
- **Description**: All defense-in-depth. None of these are exploitable today but each closes a recon / future-refactor footgun.
- **Scope**:
  - Add `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()` (and any other unused APIs) to the security-headers middleware.
  - Replace echo of `stops[i]` in error messages with `"Stop {i+1} could not be found"`.
  - Add `Field(..., max_length=200)` to `/autocomplete` `q` so Starlette rejects oversize requests at the boundary.
  - Add explicit `math.isfinite(lat) and math.isfinite(lon)` precheck in `ExploreOrigin` validator.
  - Decide on HEAD (allow explicitly or document the implicit allow).
  - Genericize the community-area echo.
  - Add `rel="noreferrer noopener"` to all `target="_blank"` anchors (attribution links).
- **Acceptance**: `curl -I /health` shows Permissions-Policy; send a 1 MB `/autocomplete` query — 422 at boundary before handler runs.

---

### TD-068 · CHUNK-24 · Pickle format forward-compat + per-city circuit-breaker prep
- **Files**: `backend/walking.py`, `backend/fetch_street_graph.py`, `backend/geocoding.py`, CLAUDE.md
- **Category**: Architecture / multi-city readiness
- **Priority**: 🟡 Medium
- **Findings**:
  - **X-19** — Pickle `format_version: 3` is all-or-nothing; multi-city needs to support cities without canopy or parks data.
  - **X-20** — LocationIQ circuit breaker is global; post-multi-city, a Chicago 429 will gate Evanston too.
  - **B-08** — Greenest can silently downgrade to footway-only on missing v3 columns mid-uptime (boot is fail-fast but hot-swap path isn't).
- **Description**: Front-load the multi-city refactor groundwork so Feature 1 chunk 1 doesn't have to take it on.
- **Scope**:
  - Relax the fail-fast guard: check column presence per-column; zero-fill missing canopy/park columns with a clear "feature degraded" log instead of refusing to boot.
  - Add a per-column schema version separate from `format_version`.
  - Key the LocationIQ circuit breaker on `("forward", city)` instead of `"forward"` (no-op for single-city, ready for multi-city).
  - Expose a `feature_degraded` flag on `/health`.
- **Acceptance**: Build a synthetic v2-shaped pickle (no canopy/parks columns); confirm boot succeeds with greenest disabled but routing intact; `/health` shows the degraded flag.

---

### TD-069 · CHUNK-25 · Structured logging + observability
- **Files**: `backend/requirements.txt`, `backend/main.py`, `backend/walking.py`, `backend/geocoding.py`
- **Category**: Observability
- **Priority**: 🟡 Medium
- **Findings**:
  - **X-17** — Backend uses default uvicorn text logs to stdout; no JSON / structured logging, no APM, no request correlation IDs, no custom metrics (route compute time, cache hit rate, LocationIQ call count).
- **Description**: Debugging prod is currently blind. Structured logging unblocks log aggregation and alerting; an optional Sentry tier handles error tracking.
- **Scope**:
  - Add `structlog` (or `python-json-logger`) to `requirements.txt`.
  - Emit JSON logs with `request_id`, `endpoint`, `latency_ms`, `flavor`, `cache_hit`.
  - Wire FastAPI's logging config to route through the new structured logger.
  - Optional: Sentry SDK behind a `SENTRY_DSN` env var.
- **Acceptance**: uvicorn logs are valid JSON parseable by `jq`; a synthetic error reaches Sentry (if configured).

---

### TD-070 · CHUNK-26 · Backup / disaster-recovery runbook
- **Files**: `CLAUDE.md`, optional new `docs/DR.md`
- **Category**: Disaster recovery
- **Priority**: 🟡 Medium
- **Findings**:
  - **X-27** — No off-machine backup of `street_graph.graphml` (~314 MB, lives only on the developer machine) or `chicago_geocode.db` source ingest data (only on GitHub release). If GitHub releases are corrupted or the dev machine dies, an OSM re-fetch yields a drifted snapshot.
- **Description**: Low-probability but high-impact. Document the recovery procedure even if automation is deferred.
- **Scope**:
  - Document an off-site backup procedure (encrypted bucket, archive branch with Git LFS, periodic upload to private storage) for the `.graphml` and the SQLite DB sources.
  - Keep dated snapshots in cloud storage; rotate retention.
  - Add a step-by-step "Disaster recovery" section to CLAUDE.md.
- **Acceptance**: Test rebuild from documented backup procedure produces a byte-identical (or formally-equivalent) artifact.

---

### TD-071 · CHUNK-27 · localStorage schema versioning
- **Files**: `frontend/src/lib/storage.js`, all `walkpath:*` consumers
- **Category**: Frontend data migration
- **Priority**: 🟡 Medium
- **Findings**:
  - **F-24** — No `walkpath:schemaVersion` marker, no migration registry. The one schema change to date (`train_stations` → `el_train_stations`) is hand-coded in `explorePrefs.js:sanitize()`. Future renames will accumulate ad-hoc.
- **Description**: Set up a tiny migration pipeline now so future schema changes have a clear place to live.
- **Scope**:
  - Introduce `walkpath:schemaVersion` (defaults to 1).
  - One-time migration runner that reads the current version and applies a registered migration chain (`v1 → v2 → …`).
  - Document the pattern in CLAUDE.md or a new `docs/Persistence.md`.
- **Acceptance**: Simulate an old schema in localStorage; reload; migration runs; data intact.

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

