# Efficiency Improvements Roadmap

Implementation plan for the optimization opportunities catalogued in [`Efficiency_Improvements.md`](../Efficiency_Improvements.md). The catalog ranks by ROI within tier (H/M/L); **this file groups those items into PR-sized chunks** sequenced so that compounding effects land together and so that dependencies are honored.

> **Status (2026-05-23):** the 2026-05-22 three-pass audit batch (OPT-022 through OPT-086, 65 items) is fully resolved. The Wave map + Chunk index below preserve the closed audit for traceability; the per-chunk implementation blocks were deleted as each chunk landed (per rule #2 in the doc checklist below). All implementation details + final-state diffs live in the **Efficiency Improvements Implemented** section of [`archive/RESOLVED_HISTORY.md`](RESOLVED_HISTORY.md). [`Efficiency_Improvements.md`](../Efficiency_Improvements.md) is empty pending the next audit batch.

> **Process.** Work one chunk at a time, in roughly the order below. Pause after each chunk for a go / no-go before starting the next — same checkpoint discipline used for chunked features in [`FEATURE_PLANS.md`](../FEATURE_PLANS.md).

> **Per-chunk documentation checklist.** When a chunk lands, walk this checklist before opening the PR (or as part of it). Don't skip — TD-046 catalogued how easily README / CLAUDE.md / code drift apart, and a chunk that ships a behavior change without the doc update is how drift starts.
>
> 1. **Catalog hand-off.** For each OPT entry that the chunk closed, **delete the entry from [`Efficiency_Improvements.md`](../Efficiency_Improvements.md)** and add a corresponding entry to the **Efficiency Improvements Implemented** section of [`archive/RESOLVED_HISTORY.md`](RESOLVED_HISTORY.md). Match the shape of existing entries there (date · short title · files · what changed · how). If the chunk only partially resolved an OPT, leave the remainder in the catalog with a note about what landed.
> 2. **Roadmap update.** Strike the chunk from the **Chunk index** table and the **Wave map** above. If every OPT inside the chunk resolved, delete the chunk block outright. If part of a chunk is deferred, leave the block with a `[PARTIAL]` marker and the remaining OPT IDs.
> 3. **CLAUDE.md.** Update if the chunk changed documented behavior or architecture — most commonly the **Key Design Decisions** section, the **API** section (request/response shape), or one of the runbooks (Greenest-routing graph release, Pickle integrity check). Chunks with a known CLAUDE.md surface flag it inline below; the rest are judgment calls — when in doubt, grep CLAUDE.md for the file path or symbol you changed and read the surrounding paragraph.
> 4. **README.md.** Update if the chunk changed a user-visible surface or a public API enum/field (TD-046 caught a stale `/explore` `source` enum drift; the same risk applies on future audit batches).
> 5. **Pending_Verification.md.** Add a `PV-XXX` entry for any chunk that needs real-device or live-production sign-off the local test suite can't cover. Most chunks don't; the ones that do (gzip+orjson live wire savings, on-demand heatmaps under real toggle traffic, multi-worker under load, raster paint vs CSS filter visual review, mobile font preload FCP delta) flag it inline below.
> 6. **Auto-memory.** If implementing the chunk surfaced something non-obvious — a workaround a future contributor would re-hit, a tuning constant the catalog estimate missed by an order of magnitude, a verification step that turned out to be load-bearing — save it as a `project` or `feedback` memory per the auto-memory rules. Don't memorize the fix itself (it's in the diff) — memorize the surprise.
> 7. **Artifact rotation (any chunk that rebuilds the pickle).** Follow the full Deploy checklist in [`CLAUDE.md`](../../CLAUDE.md) "Greenest-routing graph release runbook" — rebuild `.pkl`, upload to the `street-graph` GitHub release, recompute `STREET_GRAPH_SHA256`, update `backend/.env` locally + Railway service variable, then push. Skipping any step breaks the SEC-001 integrity check and degrades the service to haversine until corrected.

> **Why a separate file.** [`Efficiency_Improvements.md`](../Efficiency_Improvements.md) stays the per-item catalog (the things being changed). This file is the implementation roadmap (the order to change them in). Cross-reference: every OPT-XXX in the catalog appears exactly once below; every chunk below references the OPT-XXX entries it covers.

---

## Wave map (2026-05-22 audit — closed)

| Wave | Chunks | Theme | OPT items |
|------|--------|-------|-----------|
| 0 | ~~CHUNK-01~~ | Zero-risk one-shots | OPT-047, -049, -070, -071, -074, -075, -077, -079, -081, -082, -086 |
| 1 | ~~CHUNK-02~~ / ~~CHUNK-03~~ / ~~CHUNK-04~~ | Wire payload + serialization | OPT-022, -023; OPT-024, -026, -083; OPT-028, -072 |
| 2 | ~~CHUNK-05~~ / ~~CHUNK-06~~ / ~~CHUNK-07~~ | Backend hot paths | OPT-031, -032, -045, -068; OPT-033, -046, -048, -051, -080; OPT-034, -050, -054 |
| 3 | ~~CHUNK-08~~ / ~~CHUNK-09~~ / ~~CHUNK-10~~ | Cold-start + concurrency | OPT-035, -043, -044, -069; OPT-027; OPT-029, -030, -052, -053 |
| 4 | ~~CHUNK-11~~ / ~~CHUNK-12~~ / ~~CHUNK-13~~ / ~~CHUNK-14~~ | On-demand heatmaps + frontend hygiene + MapLibre layer effects + canvas tint | OPT-025; OPT-036, -037, -040, -061; OPT-038, -039, -058, -059, -060; OPT-042 |
| 5 | ~~CHUNK-15~~ / ~~CHUNK-16~~ | First-paint + storage hygiene | OPT-041, -064, -066, -067, -073; OPT-055, -056, -057, -062, -065, -076, -084 |
| 6 | ~~CHUNK-17~~ | DOM weight reductions | OPT-063 (already met), -078, -085 |

All chunks landed 2026-05-23. Full implementation details + measured deltas in [`archive/RESOLVED_HISTORY.md`](RESOLVED_HISTORY.md). PV-011 (multi-worker load test), PV-012 (greenest pickle rotation), PV-013 (heatmap toggle UX), and PV-014 (Cream/Dusk tint sign-off) remain open — operator follow-ups tracked in [`Pending_Verification.md`](../Pending_Verification.md).

---

## Chunk index (2026-05-22 audit — closed)

| Chunk | Theme | RESOLVED_HISTORY entry |
|-------|-------|------------------------|
| ~~CHUNK-01~~ | Zero-risk one-shots (incl. OPT-074 oxipng final-round) | "Zero-risk one-shot bundle from CHUNK-01" + "Final deferral round" |
| ~~CHUNK-02~~ | GZip + ORJSONResponse | "GZipMiddleware + ORJSONResponse on FastAPI" |
| ~~CHUNK-03~~ | Geometry precision + simplification | "Geometry precision + heatmap simplification + boundary simplify" |
| ~~CHUNK-04~~ | Pre-baked JSON file minification | "Pre-baked JSON artifacts minified" |
| ~~CHUNK-05~~ | `walking._flavor_weights` cache shape | "`walking._flavor_weights` cache reshape" |
| ~~CHUNK-06~~ | numpy + shapely micro-optims | "numpy + shapely micro-optims across the explore hot path" |
| ~~CHUNK-07~~ | Lifespan warm-up + await graph preload | "Lifespan warm-up + awaited graph preload" |
| ~~CHUNK-08~~ | Multi-worker uvicorn + middleware order + dedicated heatmap pool | "Multi-worker uvicorn + dedicated heatmap pool + middleware reorder" |
| ~~CHUNK-09~~ | Dockerfile artifact `curl` layer reorder | "Dockerfile artifact `curl` reordered before `COPY . .`" |
| ~~CHUNK-10~~ | Build-script speedups + greenest bake vectorization | "Build-script speedups + greenest bake vectorization" |
| ~~CHUNK-11~~ | On-demand heatmap fan-out | "On-demand heatmap fan-out" |
| ~~CHUNK-12~~ | App.jsx memoization + shared matchMedia subscriber cache | "App.jsx memoization + shared matchMedia subscriber cache" |
| ~~CHUNK-13~~ | MapLibre layer effect splits + feature-state hygiene + theme rAF | "MapLibre layer effect splits + feature-state hygiene + theme rAF" |
| ~~CHUNK-14~~ | Canvas CSS filter → MapLibre `background` tint layer (incl. OPT-042 final-round) | "Final deferral round — canvas tint layer + font subset + PNG optimization" |
| ~~CHUNK-15~~ | First-paint assets + CSS paint cost (incl. OPT-064 final-round subset) | "First-paint assets + CSS paint cost" + "Final deferral round" |
| ~~CHUNK-16~~ | localStorage write hygiene + fetch race + UX safety | "localStorage write hygiene + fetch race + UX safety" |
| ~~CHUNK-17~~ | DOM weight reductions | "DOM weight reductions — explore category panel + stable autocomplete keys" |

---

## Unscoped follow-ups

The 2026-05-22 audit is fully resolved. If new efficiency findings are catalogued (next audit batch), append them to [`Efficiency_Improvements.md`](../Efficiency_Improvements.md) as usual; when a batch crosses ~10 items, fold them into this roadmap by adding a new Wave map row + Chunk index row + per-chunk implementation block (deleted as each lands per rule #2).
