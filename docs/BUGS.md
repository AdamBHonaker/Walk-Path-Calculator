# Bugs To Be Fixed

Known bugs catalogued for future fixing. Severity: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When a bug in this file is fixed, **delete its entry from this file** and add a corresponding entry to the **Resolved Bugs** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain bugs that have not yet been resolved.

---

## Documentation-vs-implementation audit — 2026-05-21 (fourth scan)

The entries below came from a methodical audit comparing the code against
`CLAUDE.md`, the `docs/` logs, code comments, and the API contracts. Each was
verified by reading the cited code. No HIGH-severity defects were found; one
MEDIUM behavior bug, one MEDIUM documentation/feature-state bug, and ten LOW
items (latent-hardening + documentation drift).

| ID | Priority | Summary |
| --- | --- | --- |
| BUG-002 | 🟡 Medium | Docs claim Divvy + Landmarks data that `places_curated.json` does not contain; `source` enum wrong both ways |
| BUG-005 | 🟢 Low | Reverse-geocode neighborhood KDTree ranks candidates in raw degree space (latent, no observed impact) |
| BUG-006 | 🟢 Low | CLAUDE.md links to a non-existent `frontend/handoff/HANDOFF.md` |
| BUG-007 | 🟢 Low | CLAUDE.md misdescribes how per-direction `distance_miles` is computed |
| BUG-008 | 🟢 Low | Test-count claims are stale and inconsistent across CLAUDE.md / FEATURE_HISTORY / TD-032 |
| BUG-009 | 🟢 Low | CLAUDE.md backend test-file list omits 3 modules |
| BUG-010 | 🟢 Low | `backend/scripts/_curated_common.py` absent from the CLAUDE.md structure tree |
| BUG-011 | 🟢 Low | `requirements-dev.txt` ships `Pillow`; CLAUDE.md's dev-deps line omits it |
| BUG-012 | 🟢 Low | CLAUDE.md green-space prose says "golf" where the code/API key is `golf_course` |

---

### BUG-002 (fourth scan) · `/explore` `source` enum and `places_curated.json` description claim Divvy & Landmarks data that is not shipped

**Files:** `CLAUDE.md` (backend `data/` description; `/explore` response `source` enum), `docs/FEATURE_HISTORY.md` (Divvy / Landmarks entries), `backend/data/places_curated.json`, `backend/places.py:55-90`

**Priority:** 🟡 Medium

**What the bug is:** CLAUDE.md describes `backend/data/places_curated.json` as containing "CPL libraries + 2013 farmers markets + CPS schools + CPD/CFD stations + **Divvy bike stations + Commission on Chicago Landmarks** (~400 designations, CDP uct4-hrvh)", and the `/explore` API section states the response `source` field "is one of `osm`, `cpl_locations`, `farmers_markets_2013`, `cdp_divvy`, `cdp_landmarks` (curated source keys)." FEATURE_HISTORY.md lists the Divvy and Landmarks features as shipped.

The shipped `places_curated.json` actually contains **870 records across exactly five sources** — `cpl_locations` (81), `farmers_markets_2013` (24), `cps_schools` (650), `cpd_stations` (23), `cfd_stations` (92). There are **zero `cdp_divvy` and zero `cdp_landmarks` records.** `places.py` emits each record's `source` from its `_source` tag (`places.py:87`), so `/explore` can never return a place with `source: "cdp_divvy"` or `"cdp_landmarks"`. The build scripts `build_divvy.py` / `build_landmarks.py` exist but have not been run into the shipped artifact. (`docs/Pending_Verification.md` PV-007 honestly records the ingest as the outstanding step — but CLAUDE.md and FEATURE_HISTORY do not carry that caveat.)

The documented `source` enum is wrong in **both** directions: it lists two values that cannot occur (`cdp_divvy`, `cdp_landmarks`) **and omits three that the data actually contains and the API actually emits** — `cps_schools`, `cpd_stations`, `cfd_stations`.

**How it manifests:** A `/explore` consumer that filters or branches on `source === "cdp_divvy"` / `"cdp_landmarks"` gets no results and no error. A consumer that exhaustively switch/cases `source` hits unmapped values `cps_schools` / `cpd_stations` / `cfd_stations`. The curated `landmarks` and `bike_share` category coverage is absent (only whatever OSM-tagged places exist). `backend/tests/test_places.py` already encodes the gap: `_DIVVY_DATA_PRESENT` / `_curated_has_source("cdp_landmarks")` gate the Divvy/Landmarks assertions to `@pytest.mark.skipif`, so they silently skip rather than fail.

**Recommended fix — choose one:**

- **Option A — make the docs true:** run `python backend/scripts/build_divvy.py` and `build_landmarks.py` with CDP credentials, rebuild `places_curated.json` (`_curated_common.merge_and_write` replaces by `_source`), and commit the updated artifact. The `cdp_divvy` / `cdp_landmarks` sources then exist and the `test_places.py` skips flip to real assertions. (Resolves PV-007.)
- **Option B — make the docs match current reality:** correct CLAUDE.md — remove "Divvy bike stations + Commission on Chicago Landmarks" from the `places_curated.json` description until ingested, and re-frame the FEATURE_HISTORY Divvy/Landmarks entries as "code shipped; data ingest pending (PV-007)".
- **Regardless of A or B:** fix the `/explore` `source` enum to the actually-emitted set — `osm`, `cpl_locations`, `farmers_markets_2013`, `cps_schools`, `cpd_stations`, `cfd_stations` (add `cdp_divvy` / `cdp_landmarks` when Option A lands).

**Verification:** `python -c "import json; print(sorted(s['name'] for s in json.load(open('backend/data/places_curated.json'))['metadata']['sources']))"` should match the documented enum. Run `pytest backend/tests/test_places.py -v` and confirm whether the Divvy/Landmarks tests execute (Option A) or are expected-skipped (Option B). Grep CLAUDE.md for `cdp_divvy` / `cdp_landmarks` and confirm each occurrence is accurate.

---

### BUG-005 (fourth scan) · `reverse_geocode_point` neighborhood KDTree ranks candidates in raw degree space

**Files:** `backend/geocoding.py:862-915`

**Priority:** 🟢 Low (latent — no observed user-facing impact; see assessment)

**What the bug is:** `_get_neighborhood_kdtree()` builds a `scipy.spatial.cKDTree` over neighborhood centroids in **raw `[lon, lat]` degrees** (`geocoding.py:874`). `reverse_geocode_point` queries it for the `k = min(5, …)` nearest centroids (`:899-900`), then re-ranks just those 5 by true `haversine_miles` and applies the 200 m threshold (`:904-912`). Because one degree of longitude is shorter than one degree of latitude (at Chicago's ~41.85° latitude, ≈0.745×), the KDTree's Euclidean-in-degrees ordering is not the true geographic ordering. In principle the genuinely-nearest neighborhood could rank 6th by degree distance and be excluded from the top-5 candidate set, so a point within 200 m of a neighborhood centroid could fail the neighborhood tier and fall through to the address / LocationIQ tiers.

**Assessment / why Low:** This has effectively zero real-world impact. Chicago's named neighborhood centroids are kilometres apart, and the longitude distortion is a uniform ~0.745× scale on one axis — far too small to reorder a top-5 nearest set when the candidates are that far apart. The final `haversine_miles` + 200 m threshold (`:907,912`) is correct, so any result that *is* returned is accurate. It is recorded here for completeness and correctness-by-construction, not because misbehavior has been observed. An earlier audit pass over-rated this as HIGH — it is not.

**Recommended fix (optional — the team may reasonably choose to leave this and just annotate it):** make the KDTree metric-consistent so the pre-filter cannot drop a true-nearest candidate. Either:

- Build the tree on *projected* coordinates — multiply each longitude by `cos(radians(reference_lat))` before constructing the tree and apply the same factor to the query point. (`geocoding.py` / `local_search.py` already use this projection pattern elsewhere.) Or
- Simply raise `k` (e.g. `k = min(15, len(_neighborhood_names))`) — cheap, and makes an excluded true-nearest essentially impossible.

If left as-is, add a one-line comment at `geocoding.py:874` noting the tree is unprojected degrees and the `haversine` re-rank is what makes results correct.

**Verification:** `pytest backend/tests/test_geocoding.py -v`. If fixed, add a test that reverse-geocodes a point sitting between two neighborhood centroids whose lon/lat offsets differ and assert the geographically-nearer one is returned.

---

### BUG-006 (fourth scan) · CLAUDE.md links to a non-existent `frontend/handoff/HANDOFF.md`

**Files:** `CLAUDE.md:7`

**Priority:** 🟢 Low

**What the bug is:** CLAUDE.md's Wayfarer-migration note (line 7) says: "See [`frontend/handoff/HANDOFF.md`](frontend/handoff/HANDOFF.md) 'Phase 1 Progress' for completed checkpoints, spec departures, and decisions made outside the original spec." Neither the file nor the `frontend/handoff/` directory exists in the repository (verified: `ls frontend/` → `eslint.config.js`, `generate_icons.py`, `index.html`, `package*.json`, `public`, `src`, `vite.config.js` — no `handoff/`). The link is dead and the referenced "Phase 1 Progress" content is unreachable.

**How it manifests:** Doc-only; no runtime effect. Anyone (human or agent) following CLAUDE.md to find the Wayfarer Phase 1 checkpoint history, spec departures, or out-of-spec decisions dead-ends.

**Recommended fix — choose one:**

- If the handoff content still exists (git history, or folded into another doc), repoint the link to the real location.
- If the handoff doc was intentionally retired now that Phase 1 is complete, remove the parenthetical link from `CLAUDE.md:7` and keep just the inline summary ("All checkpoints landed … 142/142 tests passing at the close of Phase 1"), or relocate any still-relevant Phase 1 history into `docs/archive/RESOLVED_HISTORY.md`.

**Verification:** Grep CLAUDE.md for `HANDOFF` / `handoff/` and confirm every path resolves (`ls` the target). No remaining links to `frontend/handoff/`.

---

### BUG-007 (fourth scan) · CLAUDE.md misdescribes how per-direction `distance_miles` is computed

**Files:** `CLAUDE.md` (Porting Notes section), `backend/main.py:655,671,684`

**Priority:** 🟢 Low

**What the bug is:** CLAUDE.md's Porting Notes state: "`walking.py` adds `distance_meters` to each direction step (passed through to the response; **`main.py` computes `distance_miles` from `minutes` independently**)." The actual code does the opposite for the per-direction value:

- Per-direction `distance_miles` is derived from `distance_meters`, **not** minutes — `main.py:655` `seg_miles = d["distance_meters"] / METERS_PER_MILE`; `main.py:671` `"distance_miles": round(seg_miles, 3)`.
- Only the route-level `total_miles` is derived from minutes — `main.py:684` `total_miles = round(alt["minutes"] * WALKING_SPEED_MPH / 60.0, 2)`.

The documented sentence implies *all* `distance_miles` values come from `minutes`, when the per-step value comes from `distance_meters` (the better design — per-step miles reflect actual edge geometry).

**How it manifests:** Doc-only. Misleads a maintainer reasoning about response-field provenance or rounding behavior.

**Recommended fix:** Reword the Porting Notes sentence, e.g.: "`walking.py` adds `distance_meters` to each direction step; `main.py` derives each step's `distance_miles` from that `distance_meters`, while the route-level `total_miles` is derived from `minutes` × `WALKING_SPEED_MPH`."

**Verification:** Re-read the Porting Notes against `backend/main.py:650-690`. No code change.

---

### BUG-008 (fourth scan) · Test-count claims are stale and mutually inconsistent across the docs

**Files:** `CLAUDE.md:7`, `docs/FEATURE_HISTORY.md`, `docs/Technical_Debt.md` (TD-032)

**Priority:** 🟢 Low

**What the bug is:** `CLAUDE.md:7` states "the frontend suite has since grown to **296/296** as of 2026-05-14." Other docs give different figures for overlapping/adjacent dates: FEATURE_HISTORY.md entries cite 247/247, 292/292, and 296/296; Technical_Debt.md TD-032 locks a "268 / 268" baseline as of 2026-05-12 and explicitly calls an earlier 247 figure "stale." As of this audit (2026-05-21) the actual counts are **~439 frontend test cases across 30 test files** and **~283 backend `def test_`** — so the headline "296/296" is ~143 cases stale, and the docs disagree with one another.

**How it manifests:** Doc-only. The numbers are point-in-time snapshots presented without a clear "as-of, will drift" caveat, so they read as current; TD-032's go/no-go baseline references a count no other doc agrees with, undermining that decision gate.

**Recommended fix:** Either (a) drop hard test counts from CLAUDE.md and FEATURE_HISTORY in favor of "see `npm test` / `pytest` for the current suite size," or (b) if a number is kept, label it unambiguously as a frozen historical snapshot (e.g. "142/142 at Phase 1 close, 2026-05-05") and stop updating it piecemeal. Reconcile TD-032's baseline against a fresh `npm test` run before its next chunk.

**Verification:** `npm test` in `frontend/` and `pytest -q` in `backend/` for current counts; grep CLAUDE.md / FEATURE_HISTORY / Technical_Debt for `\d+/\d+` patterns and confirm each remaining one is labeled as a snapshot.

---

### BUG-009 (fourth scan) · CLAUDE.md backend test-file list is incomplete (3 modules missing)

**Files:** `CLAUDE.md` (backend `tests/` description), `backend/tests/`

**Priority:** 🟢 Low

**What the bug is:** CLAUDE.md's `backend/tests/` description enumerates 17 pytest modules (`test_main`, `test_steps`, `test_utils`, `test_geocoding`, `test_geocode_text`, `test_community_areas`, `test_places`, `test_explore`, `test_explore_endpoint`, `test_explore_perf`, `test_cdp_client`, `test_local_search`, `test_autocomplete_endpoint`, `test_tree_canopy`, `test_parks`, `test_green_space`, `test_walking_greenest`). The directory actually contains **20** `test_*.py` files — the list omits `test_fetch_bake.py`, `test_heatmap_clipper.py`, and `test_walking_eviction.py` (added with the greenest-routing / heatmap work).

**How it manifests:** Doc-only. A reader trusting the list under-counts the suite and may not know coverage exists for the graph bake, the shared heatmap clipper, or graph-eviction cache behavior.

**Recommended fix:** Add the three missing module names to the CLAUDE.md `tests/` enumeration. Consider replacing the hand-maintained list with "see `backend/tests/` (one module per backend unit)" to avoid recurring drift.

**Verification:** `ls backend/tests/test_*.py | wc -l` (`20`) equals the count in CLAUDE.md's list.

---

### BUG-010 (fourth scan) · `backend/scripts/_curated_common.py` is absent from the CLAUDE.md structure tree

**Files:** `CLAUDE.md` (Project Structure → `backend/scripts/`), `backend/scripts/_curated_common.py`

**Priority:** 🟢 Low

**What the bug is:** CLAUDE.md's Project Structure tree lists the `backend/scripts/` helpers `_cdp_client` and `_geocode_db` but not `_curated_common.py`, which exists and is load-bearing — `places.py:14,61` documents that `_curated_common.merge_and_write` is what writes the `_source`-tagged records into `places_curated.json`, and the per-source `build_*.py` curated-ingest scripts depend on it.

**How it manifests:** Doc-only. The structure tree implies `_cdp_client` is the only shared scripts helper; a maintainer touching the curated-ingest pipeline won't know `_curated_common.py` is the merge layer.

**Recommended fix:** Add `_curated_common.py` to the `backend/scripts/` section of the CLAUDE.md tree with a one-line description, e.g. "`_curated_common` — `merge_and_write`: replace-by-`_source` merge into `places_curated.json`, shared by every `build_*` curated-ingest script."

**Verification:** `ls backend/scripts/_*.py` — every `_`-prefixed helper appears in the CLAUDE.md tree.

---

### BUG-011 (fourth scan) · `requirements-dev.txt` ships `Pillow` but the CLAUDE.md dev-deps line omits it

**Files:** `CLAUDE.md` (backend `requirements-dev.txt` description), `backend/requirements-dev.txt`

**Priority:** 🟢 Low

**What the bug is:** CLAUDE.md describes `requirements-dev.txt` as "Adds pytest + pytest-asyncio + httpx + osmnx + freezegun + psutil" on top of `requirements.txt`. The file also pins `Pillow>=10.0,<12`, which the description omits. (All six named packages are present; only `Pillow` is undocumented.)

**How it manifests:** Doc-only, minor. A reader auditing the dev toolchain misses an image-handling dependency (used by share-card / icon-related test fixtures).

**Recommended fix:** Add `Pillow` to the CLAUDE.md dev-deps enumeration: "Adds pytest + pytest-asyncio + httpx + osmnx + freezegun + psutil + Pillow."

**Verification:** Diff the package names in `backend/requirements-dev.txt` against the CLAUDE.md line — they match.

---

### BUG-012 (fourth scan) · CLAUDE.md green-space prose says "golf" where the code/API key is `golf_course`

**Files:** `CLAUDE.md` (Parks + green-space heatmaps design note), `backend/green_space.py`

**Priority:** 🟢 Low (cosmetic)

**What the bug is:** In the "Parks + green-space heatmaps" design-decision paragraph, CLAUDE.md prose lists the non-CPD green-space kinds informally as "cemeteries / **golf** / Cook County Forest Preserves…". The actual `kind` value used by `green_space.py` (`VALID_KINDS`) and stated in the `/explore` API section is `golf_course`, not `golf`. The four valid kinds are `cemetery`, `golf_course`, `nature_reserve`, `recreation_ground`.

**How it manifests:** Doc-only, cosmetic. The same paragraph and the `/explore` API section elsewhere use `golf_course` correctly, so the inconsistency is purely internal to CLAUDE.md prose. Negligible risk, but it is a documentation-vs-code mismatch and is recorded so the audit list is complete.

**Recommended fix:** Change "golf" to "golf courses" (or `golf_course`) in the green-space prose so it agrees with the `kind` enum.

**Verification:** Grep CLAUDE.md for `golf` — every occurrence reads `golf_course` or "golf courses," none bare "golf" as a kind key.

---
