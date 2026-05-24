# Disaster Recovery Runbook

Recovery procedures for the off-machine artifacts the production deploy depends on. Low-probability but high-impact — if GitHub releases vanish or the developer machine dies, an OSM re-fetch yields a drifted snapshot that won't reproduce the current pickle. This document is the recovery playbook.

> **Sibling docs:** [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) covers the **happy path** (rebuilding the pickle on a working machine, rotating the integrity hash). This file covers the **unhappy path** (the source data or developer machine is gone). The two are linked because a successful DR ends by handing control back to the release runbook.

## What lives where

| Artifact | Size | Where it lives today | Reproducible from? |
|---|---|---|---|
| `street_graph_igraph.pkl` | ~28 MB | GitHub `street-graph` release asset | YES — from `street_graph.graphml` via `python fetch_street_graph.py` |
| `street_graph.graphml` | ~314 MB | **Developer machine only** (gitignored) | "Yes" but drifts daily — OSM is mutable |
| `chicago_geocode.db` | ~72 MB | GitHub `street-graph` release asset | YES — from `build_address_points.py` + `build_intersections.py` (also network-dependent) |
| `chicago_boundary.json` | ~50 KB | Built on demand | YES — from `build_chicago_boundary.py` (Overpass) |
| `data/places_osm.json` | ~1 MB | Checked into repo | YES — but ingest re-fetch drifts daily |
| `data/places_curated.json` | ~150 KB | Checked into repo | YES — ingest from Chicago Data Portal |
| `data/tree_canopy_kde.json` | ~2.7 MB | Checked into repo | YES — from MRLC WCS (NLCD 2021 is a fixed-version raster, so this one is reproducible bit-for-bit) |
| `data/residential_polygons.json`, `parks_polygons.json`, `green_space_polygons.json` | ~1.6 MB combined | Checked into repo | YES — ingest from Overpass / Chicago Data Portal |
| `STREET_GRAPH_SHA256` | env var | Railway service config | YES — `sha256sum street_graph_igraph.pkl` |
| `ARTIFACT_REV` | env var | Railway service config | YES — manually set per release |

The two artifacts at risk are **`street_graph.graphml`** (lives only on the developer machine) and **the GitHub release contents** (lives on GitHub, but that's a single point of failure if a release is corrupted or deleted).

## Scenario A — GitHub release corrupted or deleted

Production Docker builds curl the pickle from `https://github.com/AdamBHonaker/Passage/releases/download/street-graph/street_graph_igraph.pkl` (see `backend/Dockerfile`). If that URL stops returning the expected bytes:

**Symptoms:**
- Railway build fails at the curl step (404 / 5xx).
- Or curl succeeds but the integrity check fails: `Refusing to load … SHA-256 mismatch (expected …, got …)`.
- Or curl succeeds, hash matches a stale value, and `/route` returns plausible-but-stale routes.

**Recovery (developer machine still healthy):**
1. Confirm the developer machine has a current `street_graph_igraph.pkl` matching the env-vared `STREET_GRAPH_SHA256`. If not, re-bake per `RELEASE_RUNBOOK.md` first.
2. Re-upload the asset to the `street-graph` release tag via the GitHub web UI or `gh release upload street-graph street_graph_igraph.pkl --clobber`.
3. Trigger a Railway redeploy. Tail the build log for the curl + integrity check.
4. Post-deploy: verify `/health` returns `{"status": "ok"}` (no `feature_degraded` map — TD-068).

## Scenario B — Developer machine dies (worst case)

The `street_graph.graphml` ~314 MB OSM snapshot lives only on the developer machine. The pickle in the GitHub release can be reconstituted from it deterministically, but the graphml itself is "the source of truth" for the current Chicago graph. **OSM is mutable** — re-fetching today produces a drifted snapshot (new streets, edited tags, changed geometry). For a faithful recovery we need the original bytes.

### Backup procedure (do this when the machine is still healthy)

1. **Pick a private, durable destination.** Options:
   - **Personal cloud storage with versioning** (Google Drive / Dropbox / iCloud) — easy, 314 MB is well under the free tier limits.
   - **Encrypted S3 bucket** — better for periodic automated uploads; requires AWS account.
   - **Backblaze B2** — cheaper than S3 for archive-grade storage.
   - **Git LFS branch** — keeps the file alongside source code, but inflates repo clone size. Acceptable if everyone working on the repo has LFS configured.

2. **Compress before upload.** OSM graphml compresses ~80% — 314 MB → ~55 MB with `gzip -9` or zstd. Worth doing.

3. **Upload with a dated filename:**
   ```bash
   gzip -9 -c backend/street_graph.graphml > "street_graph-$(date +%Y-%m-%d).graphml.gz"
   # Then upload the .graphml.gz to the chosen destination.
   ```

4. **Keep at least the last 3 snapshots.** OSM drift is usually small day-to-day; you want enough history to pick a pre-incident snapshot if a recent ingest corrupted something.

5. **Document the destination** in a private note (not in this repo — the destination is itself sensitive). The repo's role is the *procedure*; the *location* lives in the developer's password manager / runbook.

### Recovery procedure (machine is gone)

1. **Stand up a fresh machine** with Python 3.13, the project cloned, and `backend/.venv` recreated (`pip install -r requirements-dev.txt`).

2. **Download the most-recent `street_graph-YYYY-MM-DD.graphml.gz`** from the backup destination. Decompress to `backend/street_graph.graphml`.

3. **Rebuild the pickle:**
   ```bash
   cd backend
   python fetch_street_graph.py        # graphml → pickle (~3-5 min on a modern machine)
   sha256sum street_graph_igraph.pkl   # capture the new hash
   ```

4. **Validate against the production hash.** If the captured hash matches the current Railway `STREET_GRAPH_SHA256`, the pickle is byte-identical to what's running. If not, follow the **Cutover** section below before changing prod.

5. **Run the full test suite** to confirm the regenerated pickle behaves correctly:
   ```bash
   pytest backend/tests/ -v
   ```

6. **Re-establish backups on the new machine** before touching anything else. (Step 0 of "next time" is "I have a backup again.")

### Cutover (when the regenerated pickle's hash drifts)

If the new hash doesn't match the production env var, you have two options:

- **Re-bake everything from scratch** (acceptable if OSM drift is in scope and the new state is desirable):
  1. Re-fetch OSM via `python fetch_street_graph.py --force`.
  2. Rebuild dependent artifacts (`build_places_osm.py`, `build_residential.py`, etc.) per `RELEASE_RUNBOOK.md`.
  3. Upload the new `.pkl` + `.db` to the GitHub release.
  4. Rotate `STREET_GRAPH_SHA256` and `ARTIFACT_REV` in Railway.
  5. Deploy and verify.

- **Stay on the original prod hash** (if you want bit-identical behavior to pre-incident):
  - Don't update the env var. The downloaded pickle hash mismatching means you don't have a faithful copy — try an older backup snapshot.

## Scenario C — `chicago_geocode.db` lost

The 72 MB SQLite database is reproducible from scratch (`build_address_points.py` + `build_intersections.py`) but the rebuild requires network access to OSM. Process:

1. Run `python backend/scripts/build_address_points.py` (downloads ~519k Chicago OSM address points).
2. Run `python backend/scripts/build_intersections.py` (extracts 45k cross-streets from the street graph).
3. The two scripts share `_geocode_db.py` and write to the same `backend/data/chicago_geocode.db` file. Order doesn't matter — both tables are independent.
4. Re-upload to GitHub release tag; rotate `ARTIFACT_REV`.

LocationIQ-cached forward/reverse lookups are deliberately not included in the backup — they're a runtime cache, and an empty cache just means the first hit of each query pays for a fresh LocationIQ call. The Chicago Data Portal cache will repopulate from real user traffic within hours.

## Test the recovery procedure

Once a year (or before any significant ingest refactor), do a dry run:

1. Pick a backup snapshot.
2. Run the recovery procedure into a scratch directory (do NOT touch the real `backend/` directory).
3. Diff the regenerated pickle's SHA-256 against the one currently in production.
4. If it diverges, investigate — either OSM has drifted (expected after months) or the build environment changed (Python version, library versions). Document the result.

This is the only way to know the runbook still works before you actually need it.

## Backup cadence (recommended)

| Artifact | Cadence | Rationale |
|---|---|---|
| `street_graph.graphml` | After every full re-fetch (~quarterly) | OSM changes slowly; quarterly is enough for residential routing. |
| `chicago_geocode.db` | After every `build_address_points` re-run | Address coverage shifts with city development; ingest cadence drives the snapshot frequency. |
| Other `data/*.json` artifacts | Tracked in git | Already covered by repo history. |

## Inventory checklist (printable)

Keep this somewhere off-machine so a "where do I start?" moment doesn't require booting the dev environment first:

- [ ] GitHub release tag: `street-graph` at https://github.com/AdamBHonaker/Passage/releases/tag/street-graph
- [ ] Railway service env vars I need to rotate: `STREET_GRAPH_SHA256`, `ARTIFACT_REV`
- [ ] Backup location for `street_graph.graphml`: \<documented in personal notes — not in this repo>
- [ ] Production deploy URL for post-recovery verification: https://wayfarer-passage.vercel.app/
- [ ] Health endpoint to confirm restoration: https://\<backend-host>/health (expect `{"status": "ok"}` with no `feature_degraded` map)
