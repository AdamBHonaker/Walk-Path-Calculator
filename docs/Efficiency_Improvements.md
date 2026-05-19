# Efficiency Improvements

Known efficiency improvements catalogued for future improvement. Impact: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an efficiency in this file is implemented, **delete its entry from this file** and add a corresponding entry to the **Efficiency Improvements Implemented** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain improvements that have not yet been implemented.

---

## Efficiency Scan — 2026-05-13 (backend/)

> Scanned: `backend/main.py`, `backend/explore.py`, `backend/walking.py`, `backend/places.py`, `backend/parks.py`, `backend/green_space.py`, `backend/tree_canopy.py`, `backend/geocoding.py`, `backend/local_search.py`
> Found: 5 opportunities (1 High, 3 Medium, 1 Low) — **all implemented 2026-05-13** (see `archive/RESOLVED_HISTORY.md` for OPT-001 through OPT-005).

---

## Efficiency Scan — 2026-05-13 (frontend/)

> Scanned: `frontend/src/App.jsx`, `frontend/src/MapView.jsx`, `frontend/src/mapHelpers.js`, `frontend/src/map/MapExploreLayer.jsx`, `frontend/src/map/MapPickLayer.jsx`, `frontend/src/hooks/{useExploreFetch,useRouteFetch,useShareCard,usePersonalization}.js`, `frontend/src/components/{AddressAutocomplete,ExploreCategoryPanel,ExploreForm,PersonalizeModal,RecentSearches,ShareDispatch,StepHero,WeeklySummaryPanel}.jsx`, `frontend/src/lib/{exploreApi,exploreCategories,explorePrefs,fetchWithTimeout,geolocation,personaPrefs,routeFormat,stepLog,autocompleteApi}.js`, `frontend/src/wayfarer/forms.jsx`
> Found: 6 opportunities (3 Medium, 3 Low) — **all implemented 2026-05-13** (see `archive/RESOLVED_HISTORY.md` for OPT-006 through OPT-011).

---

## Post-FEAT-4 candidates (2026-05-14)

### Production Dockerfile rebuilds the `.pkl` in-container instead of fetching it prebuilt (OPT-001)

**Files:** [backend/Dockerfile](../backend/Dockerfile), [backend/fetch_street_graph.py](../backend/fetch_street_graph.py), [backend/walking.py](../backend/walking.py)

**Impact:** 🟡 Medium

**Category:** Slow cold-start

**What is inefficient:** The Dockerfile fetches `street_graph.graphml` (~314 MB raw / ~79 MB compressed) from the `street-graph` GitHub release tag and runs `python fetch_street_graph.py` to produce `street_graph_igraph.pkl` in the container. That pipeline does an osmnx graphml load + intersection consolidation + dedup + the new Feature 4 canopy/park bake — roughly **~100 s of cold-start work** on a Railway build (~80 s graphml→igraph + ~20 s bake post-FEAT-4 chunk 1). Every deploy pays this cost, even when neither the graph nor the canopy/parks data has changed.

**Proposed fix:** Upload the prebuilt `street_graph_igraph.pkl` (currently ~28 MB) as an additional asset on the `street-graph` release tag. Change the Dockerfile to `curl -fL -o street_graph_igraph.pkl …/street_graph_igraph.pkl` and skip the in-container `fetch_street_graph.py` invocation entirely. The graphml stays on the tag as the canonical source artifact for local rebuilds + multi-city expansion (Feature 1).

**Tradeoffs / open questions:**
- **Pickle is tied to Python/igraph/numpy versions.** Prior tech-debt note TD-023 in [archive/RESOLVED_HISTORY.md](archive/RESOLVED_HISTORY.md) flagged this concern: "regenerate `street_graph_igraph.pkl` after upgrading to ensure pickle compat with the new major." The Dockerfile pins Python 3.11; the maintainer would need a matching local env to produce a deploy-safe `.pkl`. Mitigation: ship via the same Docker base image (build the `.pkl` in a one-shot CI job that uses the production Dockerfile's Python), or document the version pinning in the release runbook.
- **`pickle.load` is RCE-by-design.** `walking.py` already supports an opt-in `STREET_GRAPH_SHA256` env var that gates loading on a known digest; this would become a hard requirement rather than opt-in, since the runtime bytes would no longer be derived from a graphml source in-container.
- **Canopy / parks data refresh cadence.** With the current pipeline, refreshing `data/tree_canopy_kde.json` or `data/parks_polygons.json` only requires a code push — the next container build re-bakes automatically. With a prebuilt `.pkl` asset, every data refresh would also require a manual re-bake-and-upload step. Worth quantifying: how often does the canopy / parks data actually change? (Yearly per the ingest-script docstrings, but in practice it has been refreshed only once each.)
- **Container image size.** Skipping the graphml fetch saves ~79 MB of layer cache; adding the `.pkl` adds ~28 MB. Net: smaller, but only by ~50 MB.

**Why this was deferred from FEAT-4:** Surfaced during chunk-3 design discussion. Out of FEAT-4 scope: the chunk-3 fail-fast guard means a stale `.pkl` in production is loud, not silent, so the existing in-container rebuild is acceptable. This is purely a deploy-speed optimization, not a correctness issue. Worth its own scoping pass.

