# Efficiency Improvements

Known efficiency improvements catalogued for future improvement. Impact: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an efficiency in this file is implemented, **delete its entry from this file** and add a corresponding entry to the **Efficiency Improvements Implemented** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain improvements that have not yet been implemented.

---

## URL-param auto-fetch fires twice in StrictMode dev

**Impact:** 🟢 Low (dev-only — no production cost)

**Where:** [frontend/src/App.jsx](frontend/src/App.jsx) — the `useEffect(() => { ... }, [])` block at ~line 627 that auto-submits when the page loads with `?from=...&to=...` URL params.

**What's inefficient:** React 18's `<StrictMode>` (in [frontend/src/main.jsx](frontend/src/main.jsx)) intentionally runs every effect twice in dev — mount, cleanup, mount again — to surface effect cleanup bugs. The auto-fetch effect therefore calls `fetchRoute()` twice on every page load that has URL params. The first fetch is correctly aborted by the second (via `abortRef.current?.abort()` in `fetchRoute`'s opening lines), so no duplicate network response actually completes — but the request *is* sent and aborted, and the dev console shows two `fetchRoute START` logs back-to-back. Confirmed 2026-05-04 in DevTools console.

This does **not** affect production builds: `<StrictMode>` is a no-op in production, the effect runs once, one fetch fires.

**Fix:** Add a `useRef` guard so the effect body executes at most once even when StrictMode invokes the effect twice. Standard React pattern for opting a side-effect out of StrictMode's intentional double-fire when the side effect has been independently verified to have correct cleanup (which `fetchRoute`'s abort handling provides).

```jsx
const didAutoFetch = useRef(false);
useEffect(() => {
  if (didAutoFetch.current) return;
  didAutoFetch.current = true;
  const p = readUrlParams();
  if (p.stops?.length) {
    fetchRoute(p.stops);
  } else if (p.from && p.to) {
    fetchRoute([p.from, p.to]);
  }
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

**Why this is safe here:** the effect's only side effect is a network request that is already idempotent (the second one aborts the first). StrictMode's purpose is to catch missing cleanup, and `fetchRoute`'s abort handling is the cleanup. There's no cleanup bug for StrictMode to find, so opting out hides nothing.

**Trade-off to understand before applying:** the ref-guard pattern means **all** future side effects added inside this effect block bypass StrictMode's verification. If somebody later adds e.g. an event listener registration here without proper cleanup, StrictMode won't warn. The fix should therefore be paired with a comment in the effect explaining the guard's purpose, and any future side effects added here should be reviewed for cleanup correctness.

---

## Efficiency Scan — 2026-05-05 (backend)

> Scanned: `backend/main.py`, `backend/walking.py`, `backend/geocoding.py`, `backend/utils.py`, `backend/steps.py`
> Found: 6 opportunities (1 High, 3 Medium, 2 Low)

---

### OPT-002 · Avoid-stairs Dijkstra rebuilds full ~50k-edge weight vector on every request
- **File**: [backend/walking.py](backend/walking.py)
- **Line(s)**: 536–564 (`_shortest_path_with_avoid_stairs`)
- **Category**: Redundant Computation
- **Impact**: 🔴 High
- **Description**: When `avoid_stairs=True`, every route call rebuilds the entire per-edge weight list from scratch — either `[float(e["length"] or 0.0) for e in G.es]` (when the base flavor is `"length"`) or `list(base)` (when greenest/fewest_turns) — and then iterates `G.es` *again* to layer on the stairs penalty. With ~50k edges and per-edge attribute lookups via igraph's `e["..."]` interface, this is an order-of-magnitude slower than the cached `fastest`/`greenest` paths and is uncached, so two identical avoid-stairs requests both pay the full cost. Multi-stop routes with avoid_stairs multiply the cost by leg count.
- **Suggested Improvement**: Cache the base+stairs weight vector per `(flavor, avoid_stairs)` pair in a module-level dict (analogous to `_flavor_weights`). Build once on first use; reuse across requests. Use `G.es["length"]` and `G.es["highway"]` (bulk attribute reads) rather than per-edge `e["..."]` access. The cache invalidates trivially because the graph itself is loaded once and never mutated.

---

### OPT-003 · Per-edge `edge.attributes()` allocates a full attribute dict for two-key reads
- **File**: [backend/walking.py](backend/walking.py)
- **Line(s)**: 374–379 (`_build_directions`), 650–658 (`_directions_from_path`)
- **Category**: Redundant Computation
- **Impact**: 🟡 Medium
- **Description**: Both functions call `attrs = edge.attributes()` for every edge in the route, which materializes a fresh dict containing *every* edge attribute (length, geometry, highway, footway, name, oneway, lanes, …). They then read only `name`, `highway`, and `footway` from it. For a typical route with 200–600 edges, this allocates and discards 200–600 dicts of ~10 keys per direction-build, on every cache miss.
- **Suggested Improvement**: Replace `attrs = edge.attributes(); _edge_attr(attrs, "name")` with direct attribute reads (`edge["name"]`, `edge["highway"]`, `edge["footway"]`). Even better: hoist the loop's data fetch with bulk reads — `names = G.es[epath]["name"]`, `highways = G.es[epath]["highway"]`, etc. — once per call, then index by position. The `_edge_attr` helper's list-handling path can be inlined where it's actually triggered.

---

### OPT-004 · `_build_flavor_weights` does per-edge attribute access for a one-time vector build
- **File**: [backend/walking.py](backend/walking.py)
- **Line(s)**: 227–245
- **Category**: Inefficient Data Access
- **Impact**: 🟡 Medium
- **Description**: Building the `fewest_turns` and `greenest` weight vectors iterates `G.es` and reads `e["length"]` (and for greenest, `e.attributes()` → `_edge_attr(...)`) once per edge. Because igraph stores attributes column-wise internally, individual `e["length"]` reads cross the Python↔igraph boundary 50k times when one bulk read returns the whole column. This runs at startup pre-warm (per `lifespan`) and once if pre-warm is skipped, so it inflates cold-start time.
- **Suggested Improvement**: Use bulk reads — `lengths = G.es["length"]`, and for greenest also `highways = G.es["highway"]` — then build the weight list with a list comprehension over the parallel arrays. Same correctness, ~5–10× faster vector build.

---

### OPT-005 · `_compute_route_quantized` runs `_build_path` and `_build_directions` as separate epath traversals
- **File**: [backend/walking.py](backend/walking.py)
- **Line(s)**: 488–505
- **Category**: Redundant Computation
- **Impact**: 🟡 Medium
- **Description**: On a cache miss, `_build_path` and `_build_directions` each iterate the same epath/vpath, each fetching edge attributes (geometry for path, name/highway/footway/length for directions). They're independent helpers that both touch the same edges with overlapping data needs. The `_get_shortest_path` lookup is shared via lru_cache, but the per-edge igraph reads are duplicated. For a 600-edge route this is two full passes over the same edges where one merged pass would suffice.
- **Suggested Improvement**: Merge into a single function that walks epath once and emits both `(coords_tuple, directions_tuple)`. Bulk-fetch attribute columns sliced by `epath` (`G.es[epath]["name"]`, `["highway"]`, `["footway"]`, `["length"]`, `["geometry"]`) once, then walk in pure Python. The cache then holds one combined result rather than two re-derived from the cached vpath/epath. Pairs naturally with OPT-003.

---

### OPT-006 · Geocode cache rewritten in full every 50 entries
- **File**: [backend/geocoding.py](backend/geocoding.py)
- **Line(s)**: 142–166 (`_save_geocode_cache`, `_flush_geocode_if_needed`)
- **Category**: Inefficient I/O
- **Impact**: 🟢 Low
- **Description**: Each flush serialises the *entire* cache to JSON, writes a tmp file, and atomically renames over the canonical file. As the cache grows over the lifetime of a deployment (forward + reverse entries combined), each flush gets steadily more expensive, even though only ~50 entries actually changed. For a cache of a few thousand entries this is still fast, but the cost grows unboundedly and the `tmp.write_text` blocks the calling request thread.
- **Suggested Improvement**: Either (a) keep the current scheme but offload the write to a background thread (`threading.Thread(target=_save_geocode_cache, args=(snapshot,), daemon=True).start()`) so request latency isn't dominated by JSON serialisation when the cache is large; or (b) switch to an append-only log of `{key: value}` JSON lines and reconcile/compact on startup or once per N flushes. Option (a) is the smaller change and adequate at expected cache sizes.

---

### OPT-007 · `import math as _m` inside `_cardinal` closure on every directions build
- **File**: [backend/walking.py](backend/walking.py)
- **Line(s)**: 660–664 (`_directions_from_path`'s nested `_cardinal`)
- **Category**: Redundant Computation
- **Impact**: 🟢 Low
- **Description**: `_directions_from_path._cardinal` does `import math as _m` inside the nested function body. The module already imports `math` at the top of the file, and `_build_directions` (the sibling function) uses the module-level binding. The `import` itself is cheap (cached in `sys.modules`) but the redundant local import adds an unnecessary attribute lookup per direction segment and is dead code visually.
- **Suggested Improvement**: Drop the nested import; reference the module-level `math.degrees` / `math.atan2` directly, matching `_build_directions`'s pattern. Trivial change.


---


