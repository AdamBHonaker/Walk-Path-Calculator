# Bugs To Be Fixed

Known bugs catalogued for future fixing. Severity: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When a bug in this file is fixed, **delete its entry from this file** and add a corresponding entry to the **Resolved Bugs** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain bugs that have not yet been resolved.

---

### 2026-05-25 · `build_address_points.py` silently overwrites the address table on a partial Overpass fetch (BUG-001, fifth scan)

**Files:** `backend/scripts/build_address_points.py`

**Severity:** 🔴

**What the bug is:** The bbox loop in `main()` (lines 163–170) iterates the 16 grid chunks, calling `_fetch_chunk(bbox)` for each. `_fetch_chunk` already does its own bounded retry with exponential backoff and re-raises after `max_retries` exhausts; the caller wraps the call in `try / except Exception as exc: logger.error("  chunk failed: %s", exc)` and continues. After the loop, lines 189–190 unconditionally run `cur.execute("DELETE FROM addresses")` and `cur.execute("DELETE FROM addresses_fts")`, then re-populate from `all_elements`. So a single transient Overpass failure on one chunk (the public instance returns intermittent 504s under load) nukes the 519k-row address table and replaces it with whatever survived — the script then returns exit code 0. CI / cron / a human operator sees a successful build.

Contrast with `build_landmarks.py:114–118`, which explicitly aborts with exit code 1 when `not fresh`, precisely "to avoid overwriting with empty set." `build_address_points.py` has no equivalent guard, even though its blast radius is the largest curated artifact in the build chain.

**Impact:** The geocoder freshness runs (CLAUDE.md says quarterly cadence) silently corrupt `backend/data/chicago_geocode.db`. Addresses in the missing chunks fall out of `local_search.forward` and fall through to LocationIQ — increasing hosted-tier spend and breaking the local-first invariant the cascade is designed around. If LocationIQ is also degraded (circuit breaker tripped), addresses for entire neighborhoods stop resolving. The corruption is durable until the next successful rebuild, which itself is exposed to the same failure mode.

**Suggested fix:** Track a `failed_chunks` count in `main()`. If `> 0`, abort before the `DELETE` with a clear error message (or require an explicit `--allow-partial` flag for the operator to opt in to overwriting with a known-incomplete dataset). The retry logic inside `_fetch_chunk` is already correct; only the caller's response to a re-raised exception needs to change.

---

### 2026-05-25 · `_cdp_client.fetch_rows` docstring promises pagination it does not implement (BUG-002, fifth scan)

**Files:** `backend/scripts/_cdp_client.py`

**Severity:** 🟡

**What the bug is:** `fetch_rows` (lines 69–90) is documented at line 76 as *"Fetch every row from the dataset behind `endpoint_env`."* The implementation sends a single GET with `params={"$limit": limit}` and returns `resp.json()` — no `$offset` loop, no short-page sentinel, no truncation warning. A dataset larger than the caller's `limit` is silently truncated to exactly `limit` rows and the consuming build script writes the partial artifact as if it were complete.

The current call sites are safe by coincidence — the actual dataset sizes sit well under the limits passed in:

- `build_schools_cps.py:62` — `limit=5000`, CPS dataset is ~700 schools.
- `build_divvy.py:67` — `limit=2000`, ~800 stations.
- `build_libraries.py:56` — `limit=500`, ~80 branches.
- `build_police_stations.py:63` — `limit=500`, ~22 districts.
- `build_fire_stations.py:79` — `limit=500`, ~100 stations.

But none of these grow without bound while the docstring promises something the code does not deliver. The fragility is one new caller (or one unexpected dataset growth — e.g., CPS school count, the largest of the lot) away from a silent truncation that no test would catch.

**Impact:** Future-proofing only — no currently-shipped artifact is truncated. The bug is in the gap between the function's contract and its behavior, and in the absence of any signal when truncation does occur.

**Suggested fix:** Either (a) implement real pagination via `$offset` until a short page returns (the Socrata-recommended pattern, matching the docstring), or (b) tighten the docstring to *"Fetch the first `limit` rows"* and add a callsite assertion that logs a WARNING whenever `len(rows) == limit` (a likely-truncated signal). Option (a) matches what callers already assume; option (b) is the cheaper change.

---

### 2026-05-25 · `personalized_calories` field description is stale about UI consumption (BUG-003, fifth scan)

**Files:** `backend/models.py`

**Severity:** 🟢

**What the bug is:** Line 298–303 declares the field with description *"True when the caller supplied `weight_kg`. Informational — not currently consumed by the UI."* But `frontend/src/components/StepHero.jsx:53` reads it: `{personalized_calories && (...)}`. The flag drives a UI branch (the calorie-display personalized badge); the docstring claim that it is unused is stale documentation.

**Impact:** Documentation drift only — runtime behavior is correct. The risk is that a future contributor reading the model docs could (incorrectly but safely-seeming) remove the field believing the UI doesn't consume it, then ship a frontend regression. Picked up during the fifth-scan sweep.

**Suggested fix:** Edit the description to match reality, e.g. *"True when the caller supplied `weight_kg`. Drives the calorie-badge personalized-state in `StepHero.jsx`."*
