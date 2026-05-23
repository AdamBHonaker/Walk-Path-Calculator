# Pending Manual Verification

Code that has shipped to `main` but still needs a human in front of real
hardware (or a paid API key / dashboard) before the feature can be
considered fully verified. Items here block "feature complete" status
without blocking the merge itself.

> **Process:** When you complete a verification item, **delete it from
> this file**. If a check fails, paste the failure into a new entry in
> [`BUGS.md`](BUGS.md) and leave this item in place until the bug is
> resolved and the check passes.

---

## PV-001 · Address autocomplete — real-device mobile parity
**Shipped:** 2026-05-12 (Local-First Geocoding + LocationIQ Fallback, chunk 5).
**Why pending:** [`AddressAutocomplete`](../frontend/src/components/AddressAutocomplete.jsx)
portals its listbox into `document.body` with `position: fixed` so the
`WFSheet` (`transform: translateY(...)` + `overflow-y: auto`) can't clip
it. Unit tests prove the wiring (portal placement, `visualViewport`
listener, opt-out via `positioning="absolute"`); the actual mobile UX
on iPhone Safari + Android Chrome — keyboard sizing, sheet drag
following, screen-reader behavior — needs a person to drive a phone.

**Checklist:** the full per-device pass/fail list lives in
[`MOBILE_TESTING.md`](MOBILE_TESTING.md#address-autocomplete--chunk-5-mobile-sign-off-checklist)
("Address autocomplete — Chunk 5 mobile sign-off checklist"). Run via
`npm run dev:tunnel` from `frontend/`.

**Quick summary of what to check:**
- iPhone Safari portrait + landscape: keyboard doesn't hide bottom of
  dropdown; tap selects; sheet-drag follows the listbox; z-index above
  the sheet handle; route stop *and* Explorer combobox both work.
- Android Chrome portrait + landscape: same list + TalkBack reads each
  highlighted row via `aria-activedescendant`.

**When to delete this entry:** when every checkbox in the
MOBILE_TESTING.md checklist passes on at least one iPhone and one
Android. Any failure → paste into BUGS.md, keep this entry.

---

## PV-002 · LocationIQ fallback live behavior
**Shipped:** 2026-05-12 (Local-First Geocoding + LocationIQ Fallback,
chunks 3 + 5).
**Why pending:** the LocationIQ Tier-3 fallback is fully implemented
([`geocode_external`](../backend/geocoding.py), [`_reverse_geocode_external`](../backend/geocoding.py))
and unit-tested with mocked HTTP, but it's never been hit against a
real key. The circuit breaker, viewbox biasing, and SQLite negative-cache
all work in tests; the production behaviors below require a live key
plus a few minutes at the LocationIQ dashboard.

**Quick summary of what to check** (set `LOCATIONIQ_API_KEY` in
`backend/.env`, restart uvicorn, then probe):

- [ ] **Tail query end-to-end.** Hit `/autocomplete` (or `/route`) with
  a Chicago street that is *not* in the OSM address-point set — e.g.,
  a brand-new construction address. Expect: response includes a
  `source: "locationiq"` row with sensible coords inside the Chicago
  bbox.
- [ ] **Cache persists.** Re-issue the same query. Expect: identical
  result, but the LocationIQ dashboard shows **only the first call**,
  not the second (the `cached_forward` row served the repeat). Verify
  by inspecting `backend/data/chicago_geocode.db`:
  `SELECT * FROM cached_forward WHERE source='locationiq';` shows the
  row.
- [ ] **Negative cache works.** Issue an intentionally-bad address
  ("zzzzz nonexistent xyzzy"). Expect: HTTP 200 with empty / fallback
  result; a `cached_forward` row exists with `lat IS NULL AND lon IS NULL`.
  Re-issue — no second LocationIQ call on the dashboard.
- [ ] **Bbox rejection.** Force an out-of-bbox result by querying
  something LocationIQ would resolve outside Chicago — e.g., set the
  viewbox loosely and ask for "Times Square". Expect: the response is
  treated as a miss (out-of-bbox guard in [`geocode_external`](../backend/geocoding.py)),
  not a poisoned cache row.
- [ ] **Budget verification.** After a normal browsing session, the
  LocationIQ dashboard should show usage only on deliberately tail
  queries. If autocomplete keystrokes (`wri`, `wrig`, `wrigl`…) are
  burning quota, the supplement-gate heuristic
  ([`_looks_like_free_text_address`](../backend/main.py)) is letting
  too much through — file a bug.
- [ ] **Reverse-geocode coverage.** Pick-on-map at a random non-curated
  intersection. Expect: response has `source: "address"` (Tier-2
  nearest OSM address) OR `source: "locationiq"` (fallback) with a
  legible label — never a raw `"coordinates"` fallback for points
  inside Chicago.

**When to delete this entry:** when all six probes have passed against
a real key with the LocationIQ dashboard open. Failures → BUGS.md.

---

## PV-003 · Cross-street suggestion → /route round-trip
**Shipped:** 2026-05-12 (chunk 2 — `local_search.parse_cross_street`).
**Why pending:** the `intersections` table stores coords lifted from
geometric crossings of named OSM centerlines. The plan claims those
coords are "guaranteed to land on routable graph nodes (strictly better
than any geocoder for the routing use case — no snap step needed)."
Local tests confirm `parse_cross_street` returns the right canonical
pair and the right coord, but there's no end-to-end integration test
proving the coord routes cleanly via `/route` without the snap-to-nearest
fallback ever firing.

**Check** (no external key needed — pure backend):
- [ ] In the running frontend, type "Clark and Belmont" into the Origin
  field, accept the autocomplete suggestion, type "Logan Square" into
  Destination, submit. Expect: a route renders with no error toast.
- [ ] Repeat for 3–4 different famous Chicago intersections (State &
  Madison, Halsted & Fullerton, Ashland & Division, Damen & Milwaukee).
  All should route cleanly.
- [ ] If any intersection produces a "could not snap" error or a route
  that visibly starts/ends several meters away from the actual corner,
  the cross-street geometric crossing isn't landing on a graph node —
  open a bug. Likely fix is a graph-node snap inside
  `build_intersections.py`.

**When to delete this entry:** after 4+ Chicago intersections route
cleanly through `/route` end-to-end.

---

## PV-004 · Parks + green-space heatmap — real-device mobile parity
**Shipped:** 2026-05-12 (FEAT-3 chunks 1–3 + the green-space extension
chunks 3a–3c). Chunk 4 (mobile parity + tests + docs) shipped 2026-05-14.
**Why pending:** chunk 4 ships the mobile-sheet plumbing and the
persistence tests. The wiring is structurally correct — both toggles
are the same `WFCheck` row used on desktop, rendered inside
`ExploreCategoryPanel` under the **Outdoors** group, and
[`WFSheet`](../frontend/src/wayfarer/primitives.jsx)'s body-drag state
machine has an 8 px deadzone so a tap on the toggle should never
collapse or resnap the sheet. Unit tests prove persistence
(`showParksHeatmap` + `showGreenSpaceHeatmap` round-trip + wrong-type
fallback in [`explorePrefs.test.js`](../frontend/src/lib/explorePrefs.test.js)).
The actual mobile UX — toggle taps not interfering with snap, layers
recoloring on theme swap, performance with all heatmaps on — needs a
person to drive a phone.

**Checklist:** the full per-device pass/fail list lives in
[`MOBILE_TESTING.md`](MOBILE_TESTING.md#parks--green-space-heatmaps--chunk-4-mobile-sign-off-checklist)
("Parks + Green-Space heatmaps — Chunk 4 mobile sign-off checklist").
Run via `npm run dev:tunnel` from `frontend/`.

**Quick summary of what to check:**
- iPhone Safari portrait + landscape (7 items): each toggle paints /
  unpaints with no map re-fetch, sheet stays at half through both
  toggles, dual-layer visual distinction (parks saturated, green-space
  softer wash), z-order (CPD parks above green-space on overlap),
  toggle states persist across page reload, Cream ↔ Dusk theme
  recolor, fills clip cleanly to the isochrone polygon.
- Android Chrome portrait + landscape: same list + a long-press tap
  test (~600 ms hold) confirming the `WFCheck` `<label>` doesn't
  compete with the body-drag state machine.

**When to delete this entry:** every checkbox in the
MOBILE_TESTING.md checklist passes on at least one iPhone and one
Android. Any failure → paste into BUGS.md, keep this entry.

---

## PV-005 · Tree Canopy heatmap — real-device mobile parity + share-card footer
**Shipped:** 2026-05-14 (FEAT-2 chunks 1–4 — Tree Canopy Heatmap).
**Why pending:** chunk 4 ships the mobile-sheet plumbing and the
share-card `Data: …` attribution mirror. The wiring is structurally
correct — the toggle is the same `WFCheck` row used on desktop, the
[`WFSheet`](../frontend/src/wayfarer/primitives.jsx) body-drag state
machine has an 8 px deadzone before any pointer move is treated as a
sheet drag (so a tap on the toggle should never collapse or resnap the
sheet), and `handleToggleHeatmap` does not re-fetch. Unit tests prove
the persistence wiring (`showTreeCanopyHeatmap` round-trip + wrong-type
fallback in [`explorePrefs.test.js`](../frontend/src/lib/explorePrefs.test.js)).
The actual mobile UX — toggle taps not interfering with snap, layers
recoloring on theme swap, share-card PNG capturing the new attribution
subline cleanly — needs a person to drive a phone.

**Checklist:** the full per-device pass/fail list lives in
[`MOBILE_TESTING.md`](MOBILE_TESTING.md#tree-canopy-heatmap--chunk-4-mobile-sign-off-checklist)
("Tree Canopy heatmap — Chunk 4 mobile sign-off checklist"). Run via
`npm run dev:tunnel` from `frontend/`.

**Quick summary of what to check:**
- iPhone Safari portrait + landscape (6 items): sheet auto-promote,
  toggle on/off without snap interference, no re-fetch on toggle,
  persistence across reload, visual distinction from Parks layer when
  both are on, Cream ↔ Dusk theme recolor.
- Android Chrome portrait + landscape: same list + a long-press tap
  test (~600 ms hold) confirming the WFCheck `<label>` doesn't
  compete with the body-drag state machine.
- Share-card footer: open the share modal, confirm the new
  `Data: City of Chicago Open Data Portal · OpenStreetMap · LocationIQ`
  subline renders below the colophon and survives PNG capture (no
  text clipping, fonts loaded, doesn't push the visit strip off the
  bottom of the card).

**When to delete this entry:** every checkbox in the
MOBILE_TESTING.md checklist passes on at least one iPhone and one
Android. Any failure → paste into BUGS.md, keep this entry.

---

## PV-006 · Greenest routing (FEAT-4) — production deploy verification
**Shipped:** 2026-05-14 (FEAT-4 chunks 1–3 — Greenest Routing edge weights).
**Why pending:** chunks 1–3 land in code: the bake step in
[`fetch_street_graph.py`](../backend/fetch_street_graph.py) computes
`tree_canopy_score` + `park_proximity_score` for every undirected edge,
[`walking.py`](../backend/walking.py)'s `_build_flavor_weights` consumes
both in the greenest weight formula, and a fail-fast guard refuses to
boot on a v2-shaped pickle. The risk window — "Railway rebuilds, the
in-container bake produces a v3 `.pkl`, the new guard does not trip,
and prod traffic gets a meaningfully-different greenest route" — has
only been exercised locally so far. Until a real Railway deploy
confirms it, the feature isn't verified end-to-end.

**Quick summary of what to check** (procedure mirrors the "Deploy
checklist" in [`CLAUDE.md`](../CLAUDE.md) "Greenest-routing graph
release runbook"):

- [ ] **Bake runs in the container.** Tail the Railway build log for
  `[3/9 ...] Baking tree_canopy_score + park_proximity_score per edge...`
  and the histogram block showing non-zero counts for both columns.
  Pickle line should end `format_version: 3, 28.x MB`.
- [ ] **walking.py loads cleanly.** Boot log shows
  `igraph loaded: 208,008 vertices, 232,759 edges` and **no**
  `Refusing to load ... greenest routing requires per-edge ...`
  error. `/route` should succeed end-to-end (not haversine fallback).
- [ ] **Greenest diverges from fastest on the marquee fixture.**
  `POST /route` with origin coords `(41.9405, -87.6420)` and dest
  coords `(41.9210, -87.6500)` — Lakeview East → Lincoln Park. Expect
  `routes[greenest].path` differs from `routes[fastest].path`, with
  greenest's path passing through a footway segment (look for a
  direction step with `path_type: "footway"`) and total miles within
  ~5 % of fastest's.
- [ ] **Fastest is unchanged on a baseline route.** `POST /route` with
  `Wrigleyville` → `Logan Square` and compare `routes[fastest]` mile
  count + step count to a prior-deploy snapshot. They should match
  exactly — fastest's weight vector is unaffected by FEAT-4.
- [ ] **`prefer_pedestrian` custom flavor still routes.**
  `POST /route` with the same Wrigleyville → Logan Square stops and
  `"prefer_pedestrian": true` returns a `routes[0].flavor == "custom"`
  payload. The `custom` flavor inherits the greenest weight function,
  so this implicitly exercises the FEAT-4 formula.

**When to delete this entry:** all five checkboxes pass on a Railway
deploy. Any failure → paste into BUGS.md, keep this entry. The
fail-fast guard's "refuse to boot on stale pickle" path will surface
loudly if it trips, so the most likely failure mode is "deploy never
gets healthy" rather than "deploy succeeds but routes look wrong."

---

## PV-007 · Divvy bike-share stations — data ingest + pin-density check
**Shipped:** 2026-05-21 (FEAT-5 — Divvy Bike-Share Stations in the
Neighborhood Explorer). Code is complete; the data ingest is the
pending step.
**Why pending:** the feature shipped code-only. The new
[`build_divvy.py`](../backend/scripts/build_divvy.py) ingest needs CDP
credentials + network to run, which the build session did not have, so
`backend/data/places_curated.json` does **not** yet carry the
`cdp_divvy` source. Until the ingest runs and the regenerated file is
committed, the "Divvy bike share" category renders in the Explorer's
Daily life group but surfaces zero pins. The two `cdp_divvy` assertions
in [`test_places.py`](../backend/tests/test_places.py) `skipif`-skip
until the source lands, then activate automatically.

**Step 1 — run the ingest** (one-time, needs CDP credentials):
- [ ] Confirm the "Divvy Bicycle Stations" resource ID. The script
  assumes `bbyy-e7gq`; verify at
  `https://data.cityofchicago.org/resource/bbyy-e7gq.json` and that
  rows carry `station_name` + `latitude`/`longitude` (or a nested
  `location` SODA Point).
- [ ] Set `CDP_API_ENDPOINT_DIVVY` (plus the existing
  `CHICAGO_DATA_PORTAL_API_KEY_ID` / `_SECRET`) in `backend/.env`.
- [ ] Run `python backend/scripts/build_divvy.py`. Expect the log to
  report `Wrote ~800 Divvy stations` with low/zero skip counts. A
  high `no-coords` or `no-name` skip count means the dataset's column
  names differ from the script's assumptions — fix `_coords` /
  `station_name` in `build_divvy.py` before committing.
- [ ] Commit the regenerated `backend/data/places_curated.json`.
- [ ] Run `pytest backend/tests/test_places.py -v` — the two
  `cdp_divvy` tests should now run (not skip) and pass.

**Step 2 — pin-density visual check** (FEAT-5 chunk 4):
- [ ] In the running frontend, open the Explorer, expand **Daily life**,
  enable "Divvy bike share". Run a large (45-minute) isochrone from the
  Loop. Confirm the ~hundreds of station pins cluster legibly via
  `MapExploreLayer.jsx`'s existing supercluster — no unreadable pin
  pile-up.
- [ ] Repeat on a real phone (`npm run dev:tunnel`). If clusters are
  too dense to read, a tighter cluster radius for this category is
  needed — file a bug.
- [ ] Open a station pin popup: confirm the name renders and the
  source reads `cdp_divvy`.

**When to delete this entry:** the ingest has run, the regenerated
`places_curated.json` is committed, both `cdp_divvy` tests pass, and
the pin-density check is legible on desktop + one phone. Any failure →
paste into BUGS.md, keep this entry.

---

## PV-008 · Route turn segment differentiation — visual sign-off
**Shipped:** 2026-05-21 (Route Turn Segment Differentiation).
**Why pending:** the three new visual layers (alternating tone wash,
numbered turn circles, ember glow casing) are driven by MapLibre paint
expressions and feature-state updates. Unit tests verify the GeoJSON
structure, layer presence/absence, font constraints, and radius values,
but the actual visual result — opacity alternation, number legibility
at various zoom levels, casing blur radius, animation swap timing — can
only be confirmed in a real browser on a real device.

**Quick summary of what to check** (run `npm run dev` from `frontend/`,
or use `npm run dev:tunnel` for mobile):

- [ ] **Alternating tone.** Route a 4+ step journey (e.g., Wrigleyville
  → Logan Square). After the draw-in animation completes, confirm the
  route line shows alternating opacity — some segments visibly dimmer
  than their neighbours. The effect should be subtle, not jarring.
- [ ] **Numbers on circles.** Turn circles show "1", "2", "3", …
  matching the ledger step rows ("01", "02", "03", …) in numeric value.
  Numbers are white, legible at the default zoom level (~13–14). At low
  zoom (≤ 10), crowded numbers may hide (MapLibre collision default —
  this is expected behaviour).
- [ ] **Animation swap.** The draw-in pen completes → the scrim
  (`walk-path-line`) disappears and the alternating segments appear.
  The swap should be imperceptible at normal animation speeds (no flash
  or visible blank frame).
- [ ] **Ember glow casing.** Click a direction step in the ledger.
  Confirm a soft blurred ember halo appears behind the full segment on
  the map (in addition to the existing turn-circle ember and flyTo).
  Click a different step — previous halo fades, new halo appears.
- [ ] **Reduced-motion.** Enable "Reduce motion" in System Preferences
  / Accessibility settings. Route again. The alternating segments should
  appear immediately (no draw-in) at the correct opacity.
- [ ] **Flavor swap.** On a 2-stop route, switch between Fastest /
  Fewest turns / Greenest. Each flavor swap replays the animation and
  reveals the new flavor's segments with the correct alternation.
- [ ] **Dusk theme.** Toggle Dusk in PersonalizeModal. Alternating
  segments, numbers, and ember casing should all remain legible against
  the darker basemap.
- [ ] **Mobile.** On a phone (portrait + landscape): numbers readable
  at default zoom; tapping a ledger step fires the casing correctly
  through the sheet.

**When to delete this entry:** all eight checkboxes pass on at least
one desktop browser + one mobile device. Any failure → paste into
BUGS.md, keep this entry.

---

## PV-009 · El / Metra station split — Overpass ingest
**Shipped:** 2026-05-22 (El / Metra Station Split — Neighborhood
Explorer). Code is complete; the data ingest is the pending step.
**Why pending:** the feature shipped code-only. Splitting the 228 mixed
`train_stations` records into `el_train_stations` (CTA) + `metra_stations`
needs the OSM `operator` tag, which the checked-in
`backend/data/places_osm.json` does not store — so the dataset must be
regenerated by re-running the Overpass ingest. The build session's
network policy blocked `overpass-api.de` (and every mirror), so
`places_osm.json` still carries the pre-split `train_stations` key.
Until the ingest runs and the regenerated file is committed, both new
categories render in the Explorer's Daily life group but surface zero
pins. `test_all_known_categories_present` in
[`test_places.py`](../backend/tests/test_places.py) `skip`s while the
legacy key is present, then activates automatically.

**Step 1 — run the ingest** (one-time, needs Overpass network access):
- [ ] From a machine that can reach `https://overpass-api.de`, run
  `python backend/scripts/build_places_osm.py`.
- [ ] Check the per-category count log: `el_train_stations` and
  `metra_stations` should both appear with non-zero counts and the
  legacy `train_stations` line should be gone. The two counts should
  roughly sum to the prior ~228 — possibly slightly higher, since a
  co-located CTA+Metra station pair that previously collided in the
  de-dup set now survives as two rows.
- [ ] Commit the regenerated `backend/data/places_osm.json`.
- [ ] Run `pytest backend/tests/test_places.py -v` —
  `test_all_known_categories_present` should now run (not skip) and pass.

**Step 2 — visual check:**
- [ ] In the running frontend, open the Explorer, expand **Daily life**,
  enable "El Train Stations" — confirm `E`-glyph ink pins land on CTA
  "L" stops only. Enable "Metra Stations" — confirm `M`-glyph harbor
  pins land on Metra stops only. A 45-minute isochrone from the Loop is
  a good test (both networks are dense there).
- [ ] Spot-check: a known El stop ("Clark/Lake") classifies as
  `el_train_stations`; a known Metra terminal ("Millennium Station",
  "Ogilvie Transportation Center", "Chicago Union Station") classifies
  as `metra_stations`.
- [ ] Migration: with a pre-existing `walkpath:explorePrefs` whose
  `selectedCategories` includes `"train_stations"`, reload the app and
  confirm "El Train Stations" comes up checked.

**When to delete this entry:** the ingest has run, the regenerated
`places_osm.json` is committed, `test_all_known_categories_present`
passes, and the El/Metra pins are visually correct on desktop. Any
failure → paste into BUGS.md, keep this entry.

---

## PV-010 · Coffee / bakery subcategory split — data ingest + filter check
**Shipped:** 2026-05-22 (Coffee / Bakery Subcategory Split in the
Neighborhood Explorer). Code is complete; the data ingest is the
pending step.
**Why pending:** the feature shipped code-only. The committed
`backend/data/places_osm.json` predates the split, so every
`coffee_bakery` place still has `subcategory: null`. The four
sub-checkboxes (Coffee shops / Chain coffee shops / Cafés / Bakeries)
render in the Explorer, but until the regenerated data lands, selecting
any one of them filters out **every** coffee_bakery pin — a selected
sub drops the bare `coffee_bakery` key from `activeSubs`, and no place
carries a matching `category/subcategory` key yet.

**Step 1 — re-run the OSM ingest** (one-time, needs Overpass network):
- [ ] Run `python backend/scripts/build_places_osm.py`. Confirm the
  build log's per-category counts show four non-zero `coffee_bakery/*`
  rows (`bakery`, `cafe`, `chain_coffee_shop`, `coffee_shop`) and no
  remaining bare `coffee_bakery` (null-subcategory) row.
- [ ] Sanity-check the chain split: `chain_coffee_shop` should be a
  meaningful share (Chicago has many Starbucks / Dunkin' locations). A
  near-zero count means OSM `brand` tags are sparser than expected and
  the `_COFFEE_CHAIN_NAMES` curated list needs more entries.
- [ ] Commit the regenerated `backend/data/places_osm.json` **in the
  same branch as the code** — shipping the code without the data leaves
  the sub-filter broken.

**Step 2 — filter behavior check** (run `npm run dev` from `frontend/`):
- [ ] Open the Explorer, expand **Food & drink**, check "Coffee shops /
  bakeries". Confirm all coffee_bakery pins show and the four
  sub-checkboxes appear.
- [ ] Check a single sub (e.g. "Bakeries"). Confirm the map narrows to
  bakery pins only — coffee shops / chains / cafés drop out.
- [ ] Check two subs (e.g. "Bakeries" + "Cafés"). Confirm both types
  show and the other two drop out — multi-select parity with `grocery`.
- [ ] Open a Starbucks (or other chain) pin popup: confirm the card
  reads "chain coffee shop".

**When to delete this entry:** the ingest has run, the regenerated
`places_osm.json` is committed, and both filter checks pass on desktop.
Any failure → paste into BUGS.md, keep this entry.

---

## PV-011 · Multi-worker uvicorn — production load-test sign-off
**Shipped:** 2026-05-23 (CHUNK-08 of the 2026-05-22 efficiency audit —
OPT-035 / OPT-043 / OPT-044 / OPT-069).
**Why pending:** the Dockerfile now launches uvicorn with
`--workers ${UVICORN_WORKERS:-2}`, the `/explore` heatmap fan-out runs
through a dedicated `ThreadPoolExecutor(max_workers=8)`, CORS is now
outermost, and the rate-limiter key reads `request.state.client_ip` set
by a stash middleware. Local TestClient passes 319/319, but the real
trade-off (memory headroom, p95 stability under concurrent traffic,
proxy-header semantics) only surfaces on Railway with multiple workers
holding their own pickle + STRtree footprint.

**Quick summary of what to check** (after the next deploy on a worker
count that matches the Railway plan):

- [ ] **Memory headroom.** Tail Railway's container memory graph for
  ~15 min of normal traffic. Each worker holds ~200–300 MB of pickle +
  STRtrees after the CHUNK-07 lifespan warm-up. `workers × footprint`
  must stay under the plan ceiling with headroom for transient
  allocations during shapely intersection work. If memory pressure
  climbs into OOM territory, drop `UVICORN_WORKERS` in the Railway
  service variables and redeploy.
- [ ] **Concurrent /route p95.** Run `hey -c 4 -n 100` against
  `/route` for a real 2-stop Chicago path (Wrigleyville → Logan Square
  is a good fixture). p95 of the concurrent run should stay close to
  the single-request p95 — multi-worker uvicorn should absorb the
  load without head-of-line blocking. If p95 spikes, profile which
  worker is queueing.
- [ ] **Concurrent /explore p95.** Same sustained load against
  `/explore` (Logan Square / 20 min). The dedicated heatmap pool
  (8 threads) should keep the five clip futures from queueing behind
  unrelated work — latency should stay even across requests instead of
  alternating fast/slow.
- [ ] **OPTIONS preflight short-circuit.** Hit `/route` with an
  `Origin: https://passage-frontend.up.railway.app` OPTIONS request and
  confirm the response is 200 with CORS headers but *no*
  `X-Content-Type-Options` / `X-Frame-Options` / `Strict-Transport-Security`
  headers. That confirms CORS is wrapping outside the security-headers
  middleware (OPT-043). If those headers leak into the OPTIONS
  response, the registration order regressed.
- [ ] **TRUSTED_PROXY_HOPS smoke.** With the real Railway proxy depth
  set (typically 1; 2 if Cloudflare is in front), forge an
  `X-Forwarded-For: 1.2.3.4` and confirm the rate limiter keys on
  `1.2.3.4` rather than the proxy peer — flood with 31 `/route` calls
  in a minute, confirm the 31st returns 429. Repeat from a different
  forged IP to confirm the bucket is per-client.

**When to delete this entry:** every checkbox passes on a live Railway
deploy with `UVICORN_WORKERS ≥ 2`. Any failure → paste into BUGS.md and
either revert `UVICORN_WORKERS` to 1 (which still benefits from the
heatmap pool + CORS reorder) or roll back the offending OPT.

---

## PV-012 · Greenest-routing pickle rebuild after vectorized bake (CHUNK-10)
**Shipped:** 2026-05-23 (CHUNK-10 of the 2026-05-22 efficiency audit —
OPT-029 / OPT-030 / OPT-052 / OPT-053).
**Why pending:** CHUNK-10 rewrote `_bake_green_signals` in
`backend/fetch_street_graph.py` (OPT-053 flattens edge geometry into a
single vectorized arc-length-midpoint pass; OPT-030 swaps the per-edge
`STRtree.nearest()` loop for shapely 2.x's batched
`STRtree.nearest(point_array)` + `shapely.distance`). The local
apples-to-apples comparison shows the new bake is bit-identical to the
old on `edge_park_proximity_f32` (max diff 3.7e-9) and matches on
`edge_tree_canopy_f32` to within float32 noise mean (max diff 1.6% on
a handful of canopy-cell-boundary edges where a slightly-different
midpoint flips which cell's density wins). The new pickle was rebuilt
locally and its SHA-256 (`3d10cfbf1c9bafe87c53dde365efd05d6854c81f094d4cfe8993990ebadf37f6`)
is in `backend/.env`. Production must still pick it up.

**Operator pre-deploy steps:**

- [ ] Upload `backend/street_graph_igraph.pkl` to the `street-graph`
  GitHub release tag (overwrite the existing asset). Asset filename
  must remain exactly `street_graph_igraph.pkl`.
- [ ] Set the `STREET_GRAPH_SHA256` Railway service variable to
  `3d10cfbf1c9bafe87c53dde365efd05d6854c81f094d4cfe8993990ebadf37f6`.
- [ ] Push CHUNK-10's code changes. Railway rebuilds; tail the build
  log for `street_graph_igraph.pkl SHA-256 verified at build time` and
  the boot for `street_graph_igraph.pkl SHA-256 verified` followed by
  `igraph loaded: 208,008 vertices, 232,759 edges` (no "Refusing to
  load" error).

**Post-deploy spot check on the greenest fixture** (matches the
existing CLAUDE.md "Deploy checklist" step 6):

- [ ] `POST /route` with `origin=Lakeview East`,
  `destination=Lincoln Park` (or coords `41.9405,-87.6420` →
  `41.9210,-87.6500`). Compare `routes[?flavor=='fastest'].path` vs
  `routes[?flavor=='greenest'].path`. Greenest should still diverge to
  a footway-heavy path through Lincoln Park's interior trails — same
  qualitative shape as the pre-CHUNK-10 pickle produced. The 1.6%
  canopy-score diff on a handful of edges should not visibly change
  the routing.

**When to delete this entry:** the new pickle is live on Railway and
the Lakeview East → Lincoln Park greenest route is qualitatively
unchanged from the pre-rebuild behavior. Any unexpected route shape →
paste into BUGS.md, keep this entry, and consider rolling back the
pickle to the prior bytes (the prior SHA-256
`415d8be872887b6e0cfc3456954c26101d420584726aed0ae309d50e948b3eba` is
recoverable from git history of `backend/.env`).
