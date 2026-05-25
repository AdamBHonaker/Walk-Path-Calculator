# Release runbook — refreshing the pickle + redeploying

Operator-facing day-to-day procedure for the case where you need to re-bake `street_graph_igraph.pkl` (or the geocode DB, or the boundary polygon) and ship the new bytes through Railway. This is the **happy path**.

**Related runbooks:**
- [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) — deeper context on the bake pipeline, the SEC-001 pickle integrity contract, and the architecture-level rollback recipe. Read it once to understand the system; read this file when you actually need to ship a release.
- [`RAILWAY.md`](RAILWAY.md) — the deploy contract (env vars, service config). Sibling doc.
- [`DR.md`](DR.md) — unhappy path (the developer machine is gone, the GitHub release is corrupted).

> **TD-050 acceptance contract.** "Manually rotate `ARTIFACT_REV` without rotating the hash → build fails fast with a clear message." Verified — the Dockerfile guard at `backend/Dockerfile` will refuse to build when `STREET_GRAPH_SHA256` is empty unless `ARTIFACT_REV=local-dev`. See the [Guard rails](#guard-rails) section below for the full set.

## When you need this runbook

- A code change touches the bake pipeline (e.g., a new edge attribute in `fetch_street_graph.py`'s `_bake_green_signals`).
- A data refresh changed `tree_canopy_kde.json`, `parks_polygons.json`, or any other artifact the bake reads.
- A new curated source landed in `places_curated.json` and the existing release no longer matches what runtime code expects.
- Routine quarterly OSM re-fetch.

## The procedure

### 1. Rebuild locally

```bash
cd backend
.venv/Scripts/python.exe fetch_street_graph.py    # PowerShell
# or
.venv/bin/python fetch_street_graph.py            # macOS / Linux
```

Output lands at `backend/street_graph_igraph.pkl`. Build time is ~3-5 min on a modern laptop.

### 2. Capture the new SHA-256

```bash
shasum -a 256 backend/street_graph_igraph.pkl
# PowerShell equivalent:
Get-FileHash -Algorithm SHA256 backend\street_graph_igraph.pkl
```

Save the hex string somewhere persistent — you'll set it in Railway in step 5.

### 3. Sanity-check the new pickle

```bash
cd backend
pytest tests/ -v
```

The full suite (currently ~356 tests, ~20 s) loads the new pickle and exercises routing + greenest weight assembly + integrity check. A pass here means the pickle is internally consistent and the runtime code accepts it.

### 4. Upload the artifact to the GitHub release

```bash
gh release upload street-graph backend/street_graph_igraph.pkl --clobber
# Same procedure if the geocode DB or boundary changed:
gh release upload street-graph backend/data/chicago_geocode.db --clobber
gh release upload street-graph backend/data/chicago_boundary.json --clobber
```

Asset filenames MUST stay exactly `street_graph_igraph.pkl` / `chicago_geocode.db` / `chicago_boundary.json` — the Dockerfile's curl uses these names verbatim.

### 5. Update Railway service variables (atomic pair)

In the Railway dashboard, **Service Settings → Variables**, set BOTH at once:

| Variable | New value |
|---|---|
| `STREET_GRAPH_SHA256` | The hex string from step 2 |
| `ARTIFACT_REV` | A fresh date string in `YYYY-MM-DD` format (today's date is fine) |

Bumping `ARTIFACT_REV` is what busts the Dockerfile's BuildKit layer cache so the new artifact actually gets downloaded. Forgetting it is the most common deploy mistake — the previous run's cached `.pkl` is reused even though the GitHub release has new bytes.

Setting **only** `ARTIFACT_REV` without rotating `STREET_GRAPH_SHA256` now fails the build with a clear message (the TD-050 guard). The Dockerfile won't ship a fresh download paired with an old hash.

### 6. Trigger the deploy

```bash
gh workflow run … # if you wire a deploy workflow
# Or push to main and let Railway's "deploy on push" pick it up:
git commit --allow-empty -m "chore: trigger Railway redeploy"
git push origin main
```

Tail the Railway build log for:

- `Fetching street-graph release artifacts (ARTIFACT_REV=YYYY-MM-DD)` — confirms the cache was busted.
- `street_graph_igraph.pkl SHA-256 verified at build time` — confirms the hash check passed.
- `igraph loaded: 208,008 vertices, 232,759 edges` (or current count) — confirms the runtime accepted the pickle.

### 7. Post-deploy verification

```bash
curl https://<your-railway-url>/health
# Expected: {"status": "ok"}
# Concerning: {"status": "ok", "feature_degraded": {...}} — see TD-068 in archive/RESOLVED_HISTORY.md
```

For greenest-route changes, hit the Lakeview East → Lincoln Park fixture (per `Pending_Verification.md` PV-006) and confirm greenest still diverges from fastest.

## Guard rails

The Dockerfile fails fast on these conditions so a broken release can't reach `/health`:

| Failure mode | Where it's caught | Message you'll see |
|---|---|---|
| `STREET_GRAPH_SHA256` set, downloaded pickle doesn't match | `RUN ... sha256sum ...` in the artifact-fetch layer | `ERROR: street_graph_igraph.pkl SHA-256 mismatch (expected X, got Y)` |
| `ARTIFACT_REV` bumped but `STREET_GRAPH_SHA256` empty | Same `RUN`, TD-050 guard | `ERROR: STREET_GRAPH_SHA256 is empty but ARTIFACT_REV=...` |
| Pre-v3 pickle (missing canopy + park columns) | `walking._load_graph` at boot | `WARNING ... missing edge_tree_canopy_f32 column ...` followed by graceful degradation (TD-068 — boots with `feature_degraded.canopy=true` on /health, no longer refuses to load) |
| Pickle integrity check fails at runtime | `walking._load_graph` SHA-256 verify | `Refusing to load ... SHA-256 mismatch ...` — container fails the health check |

## Rollback

If the new pickle is bad and you need to revert:

1. **Re-upload the previous pickle.** Use `gh release download street-graph --pattern street_graph_igraph.pkl -O /tmp/old.pkl` against an earlier tag if you preserved one, or pull it from your backup destination per [`DR.md`](DR.md).
2. **Restore the previous `STREET_GRAPH_SHA256`.** Git history of `.env` (locally) or the Railway audit log carries the prior hex string.
3. **Bump `ARTIFACT_REV` to a new value.** The cache still keys on the rev — re-uploading the old bytes to GitHub doesn't bust the local Docker layer cache.
4. **Redeploy + verify** per steps 6-7 above.

Rollbacks are cheap as long as you preserved the prior pickle + hash pair. The TD-068 graceful-degradation path also means a partial-revert (e.g., older v2-shaped pickle uploaded by mistake) won't take the service down — it just degrades greenest to footway-only.
