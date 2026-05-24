# Greenest-routing graph release runbook

How the production artifacts at the `street-graph` GitHub release tag are produced, what fails if any go wrong, and how to roll back. Two artifacts live on the tag:

- **`street_graph_igraph.pkl`** (~28 MB) — the pedestrian routing graph with greenest-routing edge weights baked in. Loaded by `walking.py` at startup. SEC-001 SHA-256 integrity check enforced via `STREET_GRAPH_SHA256`.
- **`chicago_geocode.db`** (~72 MB) — the SQLite + FTS5 geocoding indexes (~519k OSM addresses, ~45k intersections, curated POIs, LocationIQ response cache). Opened read-only by `local_search.py`. No integrity check — it's data, not pickled code; the threat surface is much smaller.
- **`chicago_boundary.json`** (~85 KB) — the Chicago administrative boundary polygon, used by `explore.py` to clip isochrones against Lake Michigan for lakefront origins. Built by `backend/scripts/build_chicago_boundary.py` from the Overpass API. Optional — missing file means `/explore` skips the clip (graceful, not an outage). No integrity check. Refresh cadence: ~once per decade (Chicago's boundary rarely changes).

The Dockerfile `curl`s all three at build time. The rest of this runbook focuses on the `.pkl` (which has the more complex refresh + integrity story); the `.db` and `.json` show up where their refresh procedures differ.

## Build chain

1. **Local-only.** `street_graph.graphml` is the canonical OSM snapshot, kept off-repo on the developer's dev machine (it is *not* a release asset). `fetch_street_graph.py --force` re-fetches it from OSMnx if you lose your copy — but the result depends on the current state of OSM, so keep an off-machine backup if reproducibility matters.
2. **Local-only.** `python fetch_street_graph.py` builds `street_graph_igraph.pkl` from the `.graphml` and, **as part of the same pass**, bakes per-edge `tree_canopy_score` + `park_proximity_score` from `data/tree_canopy_kde.json` + `data/parks_polygons.json` (both checked into the repo). The pickle is marked `format_version: 3`.
3. **Release artifact.** Upload the rebuilt `.pkl` to the `street-graph` GitHub release tag (overwrite the existing asset). This is the byte-identical artifact production consumes; the SEC-001 hash check makes byte equality a hard integrity requirement, not a convenience. We ship the `.pkl` (not the `.graphml` + an in-container bake) because the bake is not bit-identical across platforms — float drift in the KDE / park-proximity steps diverges between Windows local and the Linux container, and the hash check then refuses to load.
4. **Production.** The Dockerfile `curl`s the `.pkl` directly from the release at build time (no in-container rebuild, no `fetch_street_graph.py` invocation).
5. **Runtime.** `walking.py` loads the `.pkl`, validates that both score columns are present and sized to `ecount()`, and otherwise refuses to boot (`_graph_load_failed = True`, all routes degrade to haversine until the operator intervenes).

## What this means for refreshes

**Whenever you overwrite a release asset, also bump `ARTIFACT_REV` in [backend/Dockerfile](../backend/Dockerfile)** (or set a Railway `ARTIFACT_REV` build variable). The Dockerfile fetches all three artifacts in one `RUN curl` layer, and BuildKit caches that layer on the command string alone — without a changed `ARTIFACT_REV`, a deploy after an in-place asset overwrite re-uses the cached layer and ships stale bytes. As of OPT-027 (2026-05-23) that `RUN curl` sits **before** `COPY . .`, so code changes no longer invalidate the artifact layer at all — `ARTIFACT_REV` is now the only knob that busts the cache for a `.db` or boundary refresh. A `.pkl` refresh also rotates `STREET_GRAPH_SHA256` (interpolated into the same `RUN`, so it busts the cache on its own), but the principle is the same: change one of those two ARGs, or the layer reuses stale bytes.

- **Tree-canopy / parks data refresh** (yearly, per the heatmap ingest scripts): re-run `python fetch_street_graph.py` to rebuild the `.pkl`. **Upload the new `.pkl` to the `street-graph` release** (overwrite). **Rotate `STREET_GRAPH_SHA256`** in both `backend/.env` and the Railway service variable — see "Pickle integrity check" below.
- **OSM street-network refresh**: re-run `fetch_street_graph.py --force` to redownload the `.graphml`, then `python fetch_street_graph.py` (no flag) to rebuild the `.pkl`. Upload the new `.pkl` to the release. **Rotate `STREET_GRAPH_SHA256`** as above.
- **Algorithm change** (formula constants, etc.): code-only, no artifact action, no hash rotation.
- **Geocoding-index refresh** (re-running `build_address_points.py` / `build_intersections.py` / `migrate_geocode_cache.py`): rebuild `backend/data/chicago_geocode.db` locally, upload it to the `street-graph` release (overwrite). No hash rotation needed — there's no integrity check on this artifact.
- **Boundary refresh** (rare — Chicago's boundary changes ~once per decade): re-run `python backend/scripts/build_chicago_boundary.py` locally, upload the new `chicago_boundary.json` to the `street-graph` release (overwrite). No hash rotation needed.

## Pickle integrity check (SEC-001)

`walking.py` calls `pickle.load` on `street_graph_igraph.pkl` to hydrate the pedestrian network. Pickle is RCE-by-design — any process that can replace that file can execute arbitrary Python in the FastAPI worker on the next load. The `STREET_GRAPH_SHA256` env var closes that surface: when set, `_verify_pickle_integrity()` in [backend/walking.py](../backend/walking.py) hashes the file with SHA-256 before unpickling and refuses to load on a mismatch (fails closed — no graphml fallback after a hash failure, so an attacker who swaps the pickle can't induce a downgrade).

**Behavior matrix:**

| `STREET_GRAPH_SHA256` set?     | File on disk matches? | Result                                                                                |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------- |
| no                             | n/a                   | One-time warning logged (`STREET_GRAPH_SHA256 not set — loading … without integrity check`), pickle loads. |
| yes                            | yes                   | `street_graph_igraph.pkl SHA-256 verified`, pickle loads.                            |
| yes                            | no                    | `Refusing to load … — SHA-256 mismatch (expected X…, got Y…). Pickle deserialization is RCE-by-design; failing closed.` `_graph_load_failed=True`, routing degrades to haversine. |

**Computing the hash:**

```powershell
# PowerShell (Windows)
Get-FileHash -Algorithm SHA256 backend\street_graph_igraph.pkl
```

```bash
# Bash (macOS / Linux / WSL / Git Bash on Windows)
shasum -a 256 backend/street_graph_igraph.pkl
# or
sha256sum backend/street_graph_igraph.pkl
```

Case doesn't matter — `walking.py` does `.strip().lower()` on the env var, so the uppercase output from `Get-FileHash` works as-is. Strip any `SHA256` prefix or whitespace before pasting.

**Where to set it:**

- **Local dev.** Add `STREET_GRAPH_SHA256=<hash>` to `backend/.env` (the slot is in `.env.example`). `load_dotenv()` reads it at startup.
- **Production (Railway).** Add a service variable in the Railway dashboard: Project → backend service → **Variables** → **New Variable**, name `STREET_GRAPH_SHA256`, value the hex digest. Save — Railway redeploys automatically.

**Verifying it took effect.** On the next backend startup, look for `street_graph_igraph.pkl SHA-256 verified` in the logs (locally: uvicorn console; Railway: deploy logs). If you instead see `STREET_GRAPH_SHA256 not set …`, the variable didn't reach the process. If you see `Refusing to load …`, the digest doesn't match the file — either the artifact was tampered with (the case the check exists for) or you computed the hash against a different `.pkl` than the one in the deploy. Recompute and update the var.

**Critical: rotate the hash AND upload the new `.pkl` whenever the pickle changes.** The pickle is rebuilt every time `fetch_street_graph.py` runs — yearly heatmap-data refresh, any OSM street-network refresh, any greenest-routing formula bake change. After each rebuild:

1. Recompute the hash on the new `.pkl` (commands above).
2. **Upload the new `.pkl` to the `street-graph` GitHub release tag** (overwrite the existing asset). Production will `curl` this on the next deploy — the hash check requires byte equality.
3. Update `backend/.env` locally.
4. Update the `STREET_GRAPH_SHA256` Railway variable so the next deploy boots cleanly. **Do steps 2–4 before pushing the code change that triggers the Railway rebuild**, or the deploy will fail — either the `curl` 404s on a stale asset, or the hash check refuses to load and the service degrades to haversine until the variable is corrected.

If you ever need to deploy without the check (emergency rollback, debugging a hash dispute), unset `STREET_GRAPH_SHA256` in the deploy env — the backend reverts to "warn and load" behavior. This is the lesser-of-two-evils escape hatch; it should not be the steady state.

## Manual rollback

The risk window is "production fetches an artifact whose attributes don't match what `walking.py` expects." Three scenarios, in increasing severity:

- **A) v3 `.pkl` loads fine but greenest routes look wrong** — revert just the formula constants in `walking.py` (`_GREEN_FOOTWAY_WEIGHT`, `_GREEN_CANOPY_WEIGHT`, `_GREEN_PARK_WEIGHT`, `_GREEN_DETOUR_FLOOR`). The columns are still consumed; only the discounting math changes.
- **B) bake step produces malformed columns** — revert [backend/fetch_street_graph.py](../backend/fetch_street_graph.py) `_bake_green_signals` (or its caller in `_save_igraph_artifact`). The next deploy will rebuild a v2-shaped `.pkl`, **but the fail-fast guard in `walking.py` will then refuse to boot.** Pair this with rollback (C) so the service stays up.
- **C) full feature rollback** — revert the greenest weight branch, the fail-fast guard, and the `_edge_tree_canopy` / `_edge_park_proximity` cache columns in [backend/walking.py](../backend/walking.py). The `_bake_green_signals` step in `fetch_street_graph.py` can stay — unused dict keys in the pickle are harmless to a reverted loader.

Rollbacks (A)/(B)/(C) above are code-only — they don't require touching the release directly. After the code revert, rebuild the `.pkl` locally with `python fetch_street_graph.py`, upload it to the `street-graph` release (overwrite), recompute `STREET_GRAPH_SHA256`, update `backend/.env` and Railway, then push. Same procedure as a normal refresh; the only difference is what code is on disk when the bake runs.

## Deploy checklist

1. Locally: `python fetch_street_graph.py` (pick "1" — rebuild pickle from cached graphml). Confirm the histogram step prints non-zero canopy + parks distributions and the pickle ends `format_version: 3`.
2. **Upload the new `.pkl` to the `street-graph` GitHub release tag** (https://github.com/AdamBHonaker/Passage/releases/tag/street-graph → Edit release → drag-replace `street_graph_igraph.pkl`). Asset name must remain exactly `street_graph_igraph.pkl` — the Dockerfile `curl` is hardcoded to that filename.
3. **Recompute the pickle SHA-256** (`Get-FileHash -Algorithm SHA256 backend\street_graph_igraph.pkl` or `shasum -a 256 backend/street_graph_igraph.pkl`). Update `STREET_GRAPH_SHA256` in `backend/.env` locally **and** in the Railway service variables. Do steps 2–3 *before* pushing — if Railway rebuilds while the release asset is stale or the Railway hash doesn't match the uploaded bytes, the service will degrade to haversine until the gap is closed. Details: "Pickle integrity check (SEC-001)" above.
4. `pytest tests/test_walking_greenest.py -v` — all tests should pass (the suite is artifact-gated; the `requires_artifact` cases run only when `street_graph_igraph.pkl` is present locally).
5. Push to main. Railway rebuilds; tail the build for the `Fetching street-graph release artifacts` log line (plus `street_graph_igraph.pkl SHA-256 verified at build time`, when `STREET_GRAPH_SHA256` reaches the build args) and the boot for both `street_graph_igraph.pkl SHA-256 verified` and `igraph loaded:` (no "Refusing to load" error).
6. Spot-check the Lakeview East → Lincoln Park fixture in prod (`POST /route` with `origin=41.9405,-87.6420`, `destination=41.9210,-87.6500`, compare `routes[fastest]` vs `routes[greenest]` — greenest should diverge to a footway-heavy path).
