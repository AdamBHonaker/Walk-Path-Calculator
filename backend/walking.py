"""
Street-network walking time calculator using igraph + scipy.

The pedestrian street graph is loaded from the pre-built igraph artifact
(`street_graph_igraph.pkl`) produced by `fetch_street_graph.py`, or falls
back to parsing `street_graph.graphml` via igraph directly. Both paths
feed the same `_populate_edge_caches{_v2}` pipeline.

Walking speed assumption: 3 mph (1.34 m/s) — a comfortable pedestrian pace.

Greenest-routing edge attributes (FEAT-4, shipped 2026-05-14):
`format_version: 3` pickles carry per-edge `tree_canopy_score` +
`park_proximity_score` arrays, consumed by `_build_flavor_weights` for
the greenest flavor. A v2 pickle or a graphml-only load lacks these
columns; `_load_graph()` refuses to boot rather than silently degrading
greenest to the legacy footway-only discount. See the "Greenest-routing
graph release runbook" section in CLAUDE.md for the build chain,
refresh cadence, and the three-tier rollback recipe.
"""

import hashlib
import logging
import math
import os
import pickle
import threading
import time as _time
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path
from typing import TypedDict
from types import MappingProxyType

logger = logging.getLogger(__name__)

import igraph as ig
import numpy as np
from scipy.spatial import cKDTree

from utils import (
    haversine_miles as _haversine_miles,
    WALKING_SPEED_MPH,
    SERVICE_HIGHWAY_TYPES,
    METERS_PER_MILE,
    quantize_coord,
)

GRAPH_PATH  = Path(__file__).parent / "street_graph.graphml"
IGRAPH_PATH = Path(__file__).parent / "street_graph_igraph.pkl"

WALKING_SPEED_MPS = WALKING_SPEED_MPH * METERS_PER_MILE / 3600  # mph → metres per second ≈ 1.34 m/s

_LONG_BLOCK_METERS    = 201.17   # 1/8 mile = 660 ft — N-S numbered-address axis
_SHORT_BLOCK_METERS   = 100.58   # 1/16 mile = 330 ft — E-W cross streets
# TD-053 / B-46: midpoint between short (100.58 m) and long (201.17 m).
# Tied edges (avg_edge_m == 150.0) bin into "long" via `>=`. Either side
# of the tie is arbitrary by definition — the choice is documented here
# so a future tuner doesn't silently flip `>=` to `>` without a reason.
# Rationale for `>=`: a single 150 m edge rounds to 0.75 long-blocks
# (75 % of 201.17) or 1.5 short-blocks; rendering "1 long block" is
# closer to typical Chicago pedestrian wayfinding ("walk a block").
_BLOCK_TYPE_THRESHOLD = 150.0

_DIRECTION_FULL = {
    "N":  "North",     "NE": "Northeast", "E":  "East",      "SE": "Southeast",
    "S":  "South",     "SW": "Southwest", "W":  "West",      "NW": "Northwest",
}

FLAVORS: tuple[str, ...] = ("fastest", "fewest_turns", "greenest")
DEFAULT_FLAVOR = "fastest"

# LRU cache sizes for the routing pipeline. Both route caches share a value
# because their entries evict together (a miss in one implies a miss in the other).
_NEAREST_NODE_CACHE_SIZE = 512
_ROUTE_CACHE_SIZE        = 512

# Pace presets — the *keys* must match those in steps.PACE_TO_MET (which maps
# the same pace names to MET values). Used to convert canonical 3 mph minutes
# into user-paced minutes at the response layer.
_PACE_TO_MPH = {"leisurely": 2.0, "normal": 3.0, "brisk": 4.0}

# Penalty (metres) added to "highway=steps" edges when avoid_stairs=True.
# Large enough to deter routing through stairs whenever any alternative exists,
# while remaining finite so isolated stair-only segments stay reachable.
_AVOID_STAIRS_PENALTY_M = 10_000.0

# Per-edge fixed penalty for "fewest_turns" — adds a constant cost to every
# edge so routes with many short connector segments (which imply more turns)
# are penalized vs. routes that ride a few long edges. igraph cannot express
# true edge-pair turn penalties without an edge-expanded graph, and this
# approximation captures most of the effect at zero preprocessing cost.
_TURN_PENALTY_M = 30.0

# Highway tags that route as "greener" (off-street paths, plazas, trails).
_GREEN_HIGHWAYS = {"footway", "path", "cycleway", "pedestrian", "track"}
_GREEN_DISCOUNT = 0.6  # legacy footway-only discount for v1 graphml / pre-FEAT-4 v2 pickles

# Feature 4 "Greenest Routing — Tree + Park Edge Weights" weight formula.
#
#   greenest_weight = base_weight * max(_GREEN_DETOUR_FLOOR,
#       1 - _GREEN_FOOTWAY_WEIGHT * is_footway_or_path
#         - _GREEN_CANOPY_WEIGHT  * tree_canopy_score
#         - _GREEN_PARK_WEIGHT    * park_proximity_score
#   )
#
# Starting values from FEATURE_PLANS.md "Resolved design decisions"; the chunk-2
# calibration round is the explicit forum for tuning these against fixture routes.
# Keep them as named constants so the rationale is greppable.
_GREEN_FOOTWAY_WEIGHT = 0.20
_GREEN_CANOPY_WEIGHT  = 0.15
_GREEN_PARK_WEIGHT    = 0.15
_GREEN_DETOUR_FLOOR   = 0.5


def _highway_path_type(highway: str, footway: str) -> str:
    """Map OSM highway/footway tags to a human-readable path type label."""
    if footway == "crossing" or highway == "crossing":
        return "crosswalk"
    if highway == "steps":
        return "steps"
    if highway == "pedestrian":
        return "pedestrian plaza"
    if highway == "cycleway":
        return "bike path"
    if highway == "track":
        return "trail"
    if highway in ("footway", "path"):
        return highway
    return "path"


_graph_lock: threading.Lock = threading.Lock()
_graph_cache: "ig.Graph | None" = None
_coord_kdtree: "cKDTree | None" = None
_vertex_lats: "np.ndarray | None" = None
_vertex_lons: "np.ndarray | None" = None
_kdtree_to_vertex: "np.ndarray | None" = None
_graph_load_failed: bool = False

# Monotonic counter bumped every time the edge caches are repopulated (load,
# eviction-then-reload, etc.). Cached weight vectors carry the version they
# were built against in their key, so a stale cache hit after a graph swap is
# impossible without a length check on every lookup. See OPT-068.
_graph_version: int = 0

# Versioned LRU of flavor weight vectors, keyed by (flavor, _graph_version).
# Bounded so old-version entries get evicted across graph reloads instead of
# accumulating. See OPT-045 / OPT-068.
_FLAVOR_WEIGHTS_MAXSIZE: int = 8
_flavor_weights: "OrderedDict[tuple[str, int], np.ndarray | list[float]]" = OrderedDict()

# Per-edge attribute columns, normalized once at graph load. igraph stores
# attributes column-wise internally; bulk reads avoid per-edge Python↔igraph
# crossings during routing. All columns are indexed by edge id and stay in sync
# with the post-filter graph.
# v2 pickle: lengths/sources/targets are numpy arrays; geometries are int32 arrays.
# v1 fallback (graphml load): all remain Python lists for backward compat.
_edge_names:      "list[str]         | None" = None
_edge_highways:   "list[str]         | None" = None
_edge_footways:   "list[str]         | None" = None
_edge_lengths:    "np.ndarray        | None" = None   # float32 (v2) or list[float] (v1)
_edge_geometries: "list              | None" = None   # list[None | np.ndarray int32 (N,2)] (v2)
# Endpoint columns sourced from compact arrays (v2) or G.get_edgelist() (v1).
_edge_sources:    "np.ndarray        | None" = None   # int32 (v2) or list[int] (v1)
_edge_targets:    "np.ndarray        | None" = None   # int32 (v2) or list[int] (v1)
# Feature 4 chunk 1 (format_version >= 3): per-edge greenest-routing signals.
# Both arrays are float32 in [0, 1]. Populated only from v3+ pickles; v1 / v2
# loads leave them as None and the greenest weight function falls back to the
# legacy footway-only discount (`_GREEN_DISCOUNT`).
_edge_tree_canopy:    "np.ndarray | None" = None
_edge_park_proximity: "np.ndarray | None" = None

# TD-068: per-signal greenest-routing degradation flags. Updated in
# `_load_graph` after the per-column presence check; `True` means the
# loaded pickle didn't carry that column and the runtime zero-filled it.
# Exposed via `greenest_degradation_status()` so /health can surface the
# state. Multi-city support (Feature 1) is the motivating use case —
# cities without canopy/park data still boot, just with greenest
# degraded to footway-only discount on those signals.
_greenest_degraded: dict[str, bool] = {"canopy": False, "parks": False}

# TD-053 / B-45: one-shot NaN-rescue tracker. The greenest weight builder
# silently scrubs non-finite values via `nan_to_num` so a corrupt edge
# doesn't poison the entire shortest-path search; this flag lets us fire
# exactly one WARNING per process when that ever triggers, so operators
# see the degradation in logs without spamming on every cache miss.
_nan_rescue_warned: dict[str, bool] = {"greenest": False}

# uint8 mask: 1 where the edge's highway tag is in `_GREEN_HIGHWAYS`, else 0.
# Baked once at load (OPT-032) so the greenest weight build does not rebuild
# it from `_edge_highways` strings on every cache miss. None in the v1
# graphml fallback — the v1 greenest path stays list-comprehension shaped.
_edge_green_mask: "np.ndarray | None" = None

# Cache of weight vectors used by routing variants that layer extra penalties
# on top of a flavor (currently only avoid_stairs). Keyed by (flavor, variant).
_combined_weights: dict[tuple[str, str], list[float]] = {}

# Guards writes to `_flavor_weights` and `_combined_weights` so concurrent
# cold-cache requests for the same flavor don't each rebuild the O(E) weight
# vector. Reads stay lock-free — CPython dict assignment is atomic, so the
# lock only serializes the build step itself.
_weights_lock: threading.Lock = threading.Lock()

# Monotonic timestamp of the most recent graph read. Updated by _load_graph()
# on every cache hit so the eviction daemon can measure idle time.
_last_graph_access: float = 0.0

# TTL in seconds before an idle graph is evicted from memory.
# Override with GRAPH_EVICTION_TTL_SECONDS env var; set to 0 to disable.
_EVICTION_TTL_SECONDS: float = float(os.getenv("GRAPH_EVICTION_TTL_SECONDS", "3600"))

# Optional SHA-256 of the expected `street_graph_igraph.pkl` artifact. When set,
# _load_graph hashes the file before unpickling and refuses to load on a
# mismatch — pickle.load is RCE-by-design, so verifying the bytes against a
# known-good digest closes the attack surface from "anything that can replace
# this file gets code execution" down to "anything that can replace this file
# AND the env var". Leave unset to skip the check (warns once on load).
_STREET_GRAPH_SHA256: str = os.getenv("STREET_GRAPH_SHA256", "").strip().lower()
_pickle_hash_warned: bool = False


def _sha256_of_file(path: Path, chunk_size: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _verify_pickle_integrity(path: Path) -> bool:
    """Return True iff it is safe to pickle.load `path`.

    - With STREET_GRAPH_SHA256 set: hash and compare; mismatch → refuse.
    - Without the env var: warn once and allow load (backward compat).
    """
    global _pickle_hash_warned
    if not _STREET_GRAPH_SHA256:
        if not _pickle_hash_warned:
            logger.warning(
                "STREET_GRAPH_SHA256 not set — loading %s without integrity check. "
                "Set the env var to the expected SHA-256 to enable hash verification.",
                path,
            )
            _pickle_hash_warned = True
        return True
    actual = _sha256_of_file(path)
    if actual != _STREET_GRAPH_SHA256:
        logger.error(
            "Refusing to load %s — SHA-256 mismatch (expected %s..., got %s...). "
            "Pickle deserialization is RCE-by-design; failing closed.",
            path, _STREET_GRAPH_SHA256[:12], actual[:12],
        )
        return False
    logger.info("%s SHA-256 verified", path.name)
    return True


def _normalize_edge_str(v) -> str:
    """Normalize a bulk-read igraph attribute value to a plain non-None string.

    A list value with a `None` first element (`[None]` — possible when osmnx
    serializes a missing attribute as null inside a list) used to slip
    through and surface as `None` to callers that then ran `.strip()` on it.
    Coerce that case to `""` so downstream string ops are always safe.
    """
    if isinstance(v, list):
        first = v[0] if v else None
        return "" if first is None else str(first)
    return "" if v is None else str(v)


def _populate_edge_caches(G: "ig.Graph") -> None:
    """Materialize per-edge attribute columns once after the graph is loaded
    and service edges are filtered. Subsequent routing reads index these lists
    instead of doing per-edge igraph attribute lookups."""
    global _edge_names, _edge_highways, _edge_footways, _edge_lengths, _edge_geometries
    global _edge_sources, _edge_targets, _edge_tree_canopy, _edge_park_proximity
    global _edge_green_mask, _graph_version
    n = G.ecount()
    attrs = G.es.attributes()
    raw_names    = G.es["name"]     if "name"     in attrs else [""]   * n
    raw_highways = G.es["highway"]  if "highway"  in attrs else [""]   * n
    raw_footways = G.es["footway"]  if "footway"  in attrs else [""]   * n
    raw_lengths  = G.es["length"]   if "length"   in attrs else [0.0]  * n
    raw_geoms    = G.es["geometry"] if "geometry" in attrs else [None] * n
    _edge_names      = [_normalize_edge_str(v) for v in raw_names]
    _edge_highways   = [_normalize_edge_str(v) for v in raw_highways]
    _edge_footways   = [_normalize_edge_str(v) for v in raw_footways]
    _edge_lengths    = [float(v) if v else 0.0 for v in raw_lengths]
    _edge_geometries = list(raw_geoms)
    # Bulk numpy slice over a single (E, 2) int32 array — one C-level walk
    # rather than two Python passes over an O(E) list of tuples (OPT-048).
    el = np.asarray(G.get_edgelist(), dtype=np.int32)
    _edge_sources = el[:, 0]
    _edge_targets = el[:, 1]
    # v1 graphml does not carry greenest-routing edge attributes; greenest
    # falls back to the legacy footway-only discount via list comprehension.
    _edge_tree_canopy    = None
    _edge_park_proximity = None
    _edge_green_mask     = None
    # Invalidate any cached weight vectors derived from a prior graph load.
    _flavor_weights.clear()
    _combined_weights.clear()
    _graph_version += 1


def _populate_edge_caches_v2(G: "ig.Graph", data: dict) -> None:
    """Populate per-edge cache columns from a format_version>=2 pickle dict.

    The v2 format stores all edge data in compact numpy arrays alongside the
    igraph graph (which carries only vertex x/y). Highway/footway strings are
    decoded from int8 codes so downstream string ops (_highway_path_type,
    _build_flavor_weights) need no changes.

    format_version>=3 additionally carries `edge_tree_canopy_f32` +
    `edge_park_proximity_f32` for the Feature 4 greenest weight function.
    A v2 pickle (no greenest signals) leaves both arrays as None and the
    greenest weight falls back to the legacy footway-only discount.
    """
    global _edge_names, _edge_highways, _edge_footways, _edge_lengths, _edge_geometries
    global _edge_sources, _edge_targets, _edge_tree_canopy, _edge_park_proximity
    global _edge_green_mask, _graph_version
    hw_vocab = data["highway_vocab"]
    fw_vocab = data["footway_vocab"]
    _edge_names      = data["edge_names"]
    _edge_highways   = [hw_vocab[int(c)] for c in data["edge_highway_codes"]]
    _edge_footways   = [fw_vocab[int(c)] for c in data["edge_footway_codes"]]
    _edge_lengths    = data["edge_lengths_f32"]    # numpy float32
    _edge_sources    = data["edge_sources_i32"]    # numpy int32
    _edge_targets    = data["edge_targets_i32"]    # numpy int32
    _edge_geometries = data["edge_geoms"]          # list[None | np.ndarray int32 (N,2)]
    # OPT-031: enforce float32 once at load so the greenest weight build does
    # not pay a defensive `.astype(np.float32)` copy on every cache miss.
    # `np.asarray` is a no-op for arrays already at the target dtype.
    canopy_raw = data.get("edge_tree_canopy_f32")    # v3+ only
    parks_raw  = data.get("edge_park_proximity_f32") # v3+ only
    _edge_tree_canopy    = np.asarray(canopy_raw, dtype=np.float32) if canopy_raw is not None else None
    _edge_park_proximity = np.asarray(parks_raw,  dtype=np.float32) if parks_raw  is not None else None
    # OPT-032: bake the uint8 footway/path/cycleway membership mask once
    # instead of rebuilding it from `_edge_highways` strings per cache miss.
    _edge_green_mask = np.fromiter(
        (1 if h in _GREEN_HIGHWAYS else 0 for h in _edge_highways),
        dtype=np.uint8, count=len(_edge_highways),
    )
    _flavor_weights.clear()
    _combined_weights.clear()
    _graph_version += 1


def _parse_geometry_inplace(G: ig.Graph) -> None:
    """Convert geometry WKT strings to coordinate lists [(lon, lat), ...] in-place."""
    try:
        from shapely import wkt as shapely_wkt
        for e in G.es:
            geom = e["geometry"]
            if isinstance(geom, str) and geom:
                try:
                    e["geometry"] = list(shapely_wkt.loads(geom).coords)
                except Exception as exc:
                    logger.debug("Could not parse geometry for edge %s: %s", e.index, exc)
                    e["geometry"] = None
            elif not geom:
                e["geometry"] = None
    except ImportError:
        for e in G.es:
            e["geometry"] = None


def _load_graph() -> "ig.Graph | None":
    """Load street graph once; returns None (and never retries) if unavailable."""
    global _graph_cache, _coord_kdtree, _vertex_lats, _vertex_lons, _kdtree_to_vertex
    global _graph_load_failed, _last_graph_access
    # TD-068: zero-fill assignment in the per-column degradation guard
    # below rebinds these names, which Python treats as local without an
    # explicit global declaration.
    global _edge_tree_canopy, _edge_park_proximity

    if _graph_cache is not None:
        _last_graph_access = _time.monotonic()
        return _graph_cache
    if _graph_load_failed:
        return None

    with _graph_lock:
        if _graph_cache is not None:
            _last_graph_access = _time.monotonic()
            return _graph_cache
        if _graph_load_failed:
            return None

        G: "ig.Graph | None" = None

        _pickle_data: "dict | None" = None
        _pickle_integrity_failed = False
        if IGRAPH_PATH.exists():
            if not _verify_pickle_integrity(IGRAPH_PATH):
                # Fail closed: do not silently fall through to graphml, because
                # an attacker who can replace the pickle file may also have
                # replaced the graphml. Mark load as failed and exit; the
                # operator must intervene (rotate the artifact, update the
                # env var, or run without the prebuilt graph).
                _pickle_integrity_failed = True
            else:
                logger.info("Loading igraph artifact from %s ...", IGRAPH_PATH)
                try:
                    with open(IGRAPH_PATH, "rb") as f:
                        _pickle_data = pickle.load(f)
                    G = _pickle_data["graph"]
                    logger.info("igraph loaded: %s vertices, %s edges", f"{G.vcount():,}", f"{G.ecount():,}")
                except (pickle.UnpicklingError, OSError, ValueError, KeyError) as e:
                    logger.warning("igraph pickle failed (%s: %s) — trying graphml fallback", type(e).__name__, e)
                    G = None
                    _pickle_data = None

        if _pickle_integrity_failed:
            _graph_load_failed = True
            return None

        if G is None:
            if not GRAPH_PATH.exists():
                logger.error("Street graph not found at %s — walking will use Haversine fallback.", GRAPH_PATH)
                _graph_load_failed = True
                return None
            logger.info("Loading street graph from %s ...", GRAPH_PATH)
            try:
                G = ig.Graph.Read_GraphML(str(GRAPH_PATH))
                # osmnx GraphML stores all attributes as strings; convert length to float
                # so igraph's Dijkstra receives numeric weights instead of failing silently.
                for e in G.es:
                    try:
                        e["length"] = float(e["length"]) if e["length"] else 0.0
                    except (TypeError, ValueError):
                        e["length"] = 0.0
                _parse_geometry_inplace(G)
                logger.info("igraph loaded: %s vertices, %s edges", f"{G.vcount():,}", f"{G.ecount():,}")
            except (OSError, ValueError, ig.InternalError) as e:
                logger.error("Failed to load street graph (%s: %s) — walking will use Haversine fallback.", type(e).__name__, e)
                _graph_load_failed = True
                return None

        _prefiltered = (
            _pickle_data is not None
            and (_pickle_data.get("format_version", 1) >= 2
                 or _pickle_data.get("prefiltered", False))
        )
        if not _prefiltered and "highway" in G.es.attributes():
            to_delete = [
                e.index for e in G.es
                if (e["highway"] or "") in SERVICE_HIGHWAY_TYPES
            ]
            if to_delete:
                G.delete_edges(to_delete)
                logger.info("Filtered %s service/alley edges", f"{len(to_delete):,}")

        lons = np.asarray(G.vs["x"], dtype=np.float64)
        lats = np.asarray(G.vs["y"], dtype=np.float64)
        _vertex_lats = lats
        _vertex_lons = lons

        # Snap only to vertices in the largest weakly-connected component so
        # geocoded coordinates can't latch onto isolated pockets (e.g. parking
        # lot interiors orphaned by the service/alley filter), which would
        # cause Dijkstra to fail with "couldn't reach some vertices".
        components = G.connected_components(mode="weak")
        sizes = components.sizes()
        biggest = sizes.index(max(sizes))
        membership = components.membership
        valid_idx = np.where(np.array(membership) == biggest)[0].astype(np.int64)
        orphans = G.vcount() - len(valid_idx)
        if orphans:
            logger.warning("Snapping restricted to giant component (%s of %s vertices, %s orphans excluded)", f"{len(valid_idx):,}", f"{G.vcount():,}", f"{orphans:,}")
        # TD-053 / B-47: pin the dtype so a future refactor (e.g., a numpy
        # version that defaults `np.where(...)` to int32 on Windows, or a
        # contributor swapping `astype(np.int64)` for `astype(int)`) can't
        # silently truncate the index on a very large multi-city graph.
        # `_get_nearest_node` returns `int(_kdtree_to_vertex[idx])` and
        # downstream consumers assume the vertex IDs fit in a Python int —
        # safe as long as the array holds int64.
        assert valid_idx.dtype == np.int64, (
            f"_kdtree_to_vertex must be int64, got {valid_idx.dtype}"
        )
        _kdtree_to_vertex = valid_idx
        _coord_kdtree = cKDTree(np.column_stack([lons[valid_idx], lats[valid_idx]]))

        if _pickle_data is not None and _pickle_data.get("format_version", 1) >= 2:
            _populate_edge_caches_v2(G, _pickle_data)
        else:
            _populate_edge_caches(G)

        # Feature 4 chunk 3 + TD-068: per-column presence check with graceful
        # degradation. Multi-city support (Feature 1) wants to onboard cities
        # whose source datasets don't include canopy or park data — refusing
        # to boot the whole router because one column is missing would block
        # that work. The relaxed contract: any missing v3 column zero-fills,
        # logs a clear "feature degraded" warning, and sets the
        # `_greenest_degraded` module flag. Greenest still routes, but the
        # missing signal's contribution to the weight collapses to zero —
        # equivalent to footway-only discount for canopy, or no park boost
        # for park-proximity. Operators see the warning on boot and can
        # query the flag via `feature_degraded` on /health (TD-068 / X-19).
        n_edges = G.ecount()
        canopy_ok = _edge_tree_canopy    is not None and len(_edge_tree_canopy)    == n_edges
        parks_ok  = _edge_park_proximity is not None and len(_edge_park_proximity) == n_edges
        if not canopy_ok:
            fv = _pickle_data.get("format_version", 1) if _pickle_data else "graphml"
            logger.warning(
                "%s missing edge_tree_canopy_f32 column (format_version=%s) — "
                "greenest routing will degrade to footway-only discount for the "
                "canopy term. Rebuild via `python fetch_street_graph.py` to restore. "
                "Setting feature_degraded flag.",
                IGRAPH_PATH if _pickle_data is not None else GRAPH_PATH, fv,
            )
            _edge_tree_canopy = np.zeros(n_edges, dtype=np.float32)
        if not parks_ok:
            fv = _pickle_data.get("format_version", 1) if _pickle_data else "graphml"
            logger.warning(
                "%s missing edge_park_proximity_f32 column (format_version=%s) — "
                "greenest routing will degrade to zero park-proximity boost. "
                "Rebuild via `python fetch_street_graph.py` to restore. "
                "Setting feature_degraded flag.",
                IGRAPH_PATH if _pickle_data is not None else GRAPH_PATH, fv,
            )
            _edge_park_proximity = np.zeros(n_edges, dtype=np.float32)
        # Record which greenest signals are degraded so /health can surface
        # the state without the caller needing to ask `walking.py` directly.
        _greenest_degraded["canopy"] = not canopy_ok
        _greenest_degraded["parks"]  = not parks_ok

        _graph_cache = G
        _last_graph_access = _time.monotonic()

    return _graph_cache


def greenest_degradation_status() -> "dict[str, bool]":
    """Per-signal greenest-routing degradation flags. Each key is True when
    the underlying column was missing from the loaded pickle and the runtime
    zero-filled it (TD-068). `/health` reads this so operators can spot a
    silent multi-city / multi-pickle drift without tailing logs.
    """
    return dict(_greenest_degraded)


def _evict_graph() -> None:
    """Release all graph-derived state so the OS can reclaim memory.

    Called only by the eviction daemon after confirming idle > TTL.
    """
    global _graph_cache, _coord_kdtree, _vertex_lats, _vertex_lons, _kdtree_to_vertex
    global _edge_names, _edge_highways, _edge_footways, _edge_lengths, _edge_geometries
    global _edge_sources, _edge_targets, _graph_load_failed
    global _edge_tree_canopy, _edge_park_proximity, _edge_green_mask

    # TD-056 / B-19: TOCTOU on `_last_graph_access` is advisory by design.
    # The eviction daemon's outer check (in `_start_eviction_daemon`'s
    # `_worker`) reads `_last_graph_access` without the lock — a request
    # could arrive between that read and us acquiring `_graph_lock` here,
    # bumping the access timestamp into the "should not evict" range. We
    # re-check the idle window inside the lock below, so an in-flight
    # request can never race the eviction itself. The outer unlocked read
    # is just the "wake up and see if there's work to do" check; it's
    # ALLOWED to be wrong as long as the inner check is authoritative.
    with _graph_lock:
        if _graph_cache is None:
            return
        idle = _time.monotonic() - _last_graph_access
        if idle < _EVICTION_TTL_SECONDS:
            return  # a request arrived while waiting for the lock
        _graph_cache = None
        _coord_kdtree = None
        _vertex_lats = None
        _vertex_lons = None
        _kdtree_to_vertex = None
        _edge_names = None
        _edge_highways = None
        _edge_footways = None
        _edge_lengths = None
        _edge_geometries = None
        _edge_sources = None
        _edge_targets = None
        _edge_tree_canopy = None
        _edge_park_proximity = None
        _edge_green_mask = None
        _flavor_weights.clear()
        _combined_weights.clear()
        _graph_load_failed = False  # eviction is deliberate; allow reload on next request
        _get_nearest_node_quantized.cache_clear()
        _get_shortest_path_by_node.cache_clear()
        _compute_route_quantized.cache_clear()
        # Also clear the explore isochrone cache — its results embed graph-derived
        # vertex coordinates, and a graph file swap between eviction and reload
        # would leave stale polygons while routing used the refreshed graph.
        try:
            from explore import _explore_quantized
            _explore_quantized.cache_clear()
        except Exception:
            pass
        logger.info("Graph evicted after %.0f s idle (TTL=%s s)", idle, int(_EVICTION_TTL_SECONDS))


def _start_eviction_daemon() -> None:
    """Start a daemon thread that evicts the graph after TTL idle seconds.

    No-op when GRAPH_EVICTION_TTL_SECONDS=0 (eviction disabled).
    """
    if _EVICTION_TTL_SECONDS <= 0:
        # TD-056 / B-36: surface the disabled state so an operator who set
        # the env var to 0 (or left it at the legacy default that someone
        # may have changed) sees the result on every boot. Prior behavior
        # was a silent return, leaving "why isn't the graph evicting?" as
        # a log-archaeology question.
        logger.info(
            "Graph eviction disabled (GRAPH_EVICTION_TTL_SECONDS=%s). "
            "Set the env var to a positive number of seconds to enable.",
            _EVICTION_TTL_SECONDS,
        )
        return

    check_interval = max(60.0, _EVICTION_TTL_SECONDS / 10)

    def _worker() -> None:
        while True:
            _time.sleep(check_interval)
            if _graph_cache is not None:
                if _time.monotonic() - _last_graph_access >= _EVICTION_TTL_SECONDS:
                    _evict_graph()

    t = threading.Thread(target=_worker, daemon=True, name="graph-eviction")
    t.start()
    logger.info(
        "Graph eviction daemon started (TTL=%s s, check=%.0f s)",
        int(_EVICTION_TTL_SECONDS), check_interval,
    )


@lru_cache(maxsize=_NEAREST_NODE_CACHE_SIZE)
def _get_nearest_node_quantized(lat_q: int, lon_q: int) -> "int | None":
    if _load_graph() is None:
        return None
    try:
        _, idx = _coord_kdtree.query([lon_q / 1e5, lat_q / 1e5])
        return int(_kdtree_to_vertex[idx])
    except Exception:
        return None


def _get_nearest_node(lat: float, lon: float) -> "int | None":
    """Return the nearest igraph vertex index for a lat/lon coordinate; None if graph unavailable.

    Coordinates are quantized to ~1m (5 decimal places) before cache lookup so attackers
    cannot defeat the cache by jittering inputs.
    """
    return _get_nearest_node_quantized(*quantize_coord(lat, lon))


def _build_flavor_weights(G: "ig.Graph", flavor: str) -> "np.ndarray | list[float] | str":
    """Return the weight vector used for Dijkstra under `flavor`.

    v2 pickle: returns numpy arrays (vectorized, no string shorthand).
    v1 fallback: may return the string "length" for fastest so igraph uses its
    own internal attribute; other flavors return list[float] as before.

    Greenest (Feature 4): when the v3 pickle's `tree_canopy_score` and
    `park_proximity_score` columns are present, the weight is
        L * max(_GREEN_DETOUR_FLOOR,
                1 - _GREEN_FOOTWAY_WEIGHT * is_footway_or_path
                  - _GREEN_CANOPY_WEIGHT  * tree_canopy_score
                  - _GREEN_PARK_WEIGHT    * park_proximity_score)
    The `max(…, _GREEN_DETOUR_FLOOR)` floor caps any single edge's discount
    at 0.5×, which keeps the greenest path within ~2× of the fastest distance.
    When the columns are missing (v1 graphml or v2 pickle), greenest falls
    back to the legacy footway-only `_GREEN_DISCOUNT` multiplier.
    """
    lengths = _edge_lengths
    if lengths is None:
        return "length"

    if isinstance(lengths, np.ndarray):
        # v2+ path — vectorized
        if flavor == "fastest":
            return lengths
        if flavor == "fewest_turns":
            return lengths + _TURN_PENALTY_M
        if flavor == "greenest":
            # OPT-032: `_edge_green_mask` is baked at load (uint8). Fall back
            # to rebuilding when it is absent (defensive) or when its size no
            # longer matches `lengths` (under test, callers monkey-patch the
            # edge columns to small fixture arrays without touching the mask).
            green_mask = _edge_green_mask
            if green_mask is None or len(green_mask) != len(lengths):
                highways = _edge_highways or [""] * len(lengths)
                green_mask = np.fromiter(
                    (1 if h in _GREEN_HIGHWAYS else 0 for h in highways),
                    dtype=np.uint8, count=len(highways),
                )
            canopy = _edge_tree_canopy
            parks  = _edge_park_proximity
            if canopy is not None and parks is not None \
                    and len(canopy) == len(lengths) and len(parks) == len(lengths):
                # v3: combined discount, with a per-edge 0.5× detour floor.
                # OPT-031: canopy/parks are already float32 from
                # `_populate_edge_caches_v2`; multiplying by a Python float
                # preserves their dtype.
                discount = 1.0 \
                    - _GREEN_FOOTWAY_WEIGHT * green_mask.astype(np.float32) \
                    - _GREEN_CANOPY_WEIGHT  * canopy \
                    - _GREEN_PARK_WEIGHT    * parks
                np.maximum(discount, _GREEN_DETOUR_FLOOR, out=discount)
                # A non-finite baked canopy/park score would yield a NaN
                # weight, which silently corrupts the shortest-path ordering
                # (NaN comparisons are always false). Degrade a corrupt edge
                # to a length-only weight rather than poisoning the search.
                # TD-053 / B-45: count rescued edges and one-shot WARN on
                # first occurrence so a degraded artifact surfaces in logs
                # instead of silently producing slightly-off greenest routes.
                bad_mask = ~np.isfinite(discount)
                bad_count = int(bad_mask.sum())
                if bad_count > 0 and not _nan_rescue_warned["greenest"]:
                    _nan_rescue_warned["greenest"] = True
                    logger.warning(
                        "greenest weight builder rescued %s non-finite "
                        "edge(s) — canopy or park-proximity column likely "
                        "contains NaN/inf. Rebuild the pickle via "
                        "`python fetch_street_graph.py` to clear; this "
                        "warning fires once per process.",
                        bad_count,
                    )
                np.nan_to_num(discount, copy=False, nan=1.0,
                              posinf=1.0, neginf=_GREEN_DETOUR_FLOOR)
                return lengths * discount
            # v2 fallback: legacy footway-only discount.
            return np.where(green_mask.astype(bool), lengths * _GREEN_DISCOUNT, lengths)
        return lengths

    # v1 graphml fallback — list[float] path. Greenest signals never present.
    if flavor == "fastest":
        return "length"
    if flavor == "fewest_turns":
        return [L + _TURN_PENALTY_M for L in lengths]
    if flavor == "greenest":
        highways = _edge_highways or [""] * len(lengths)
        return [
            L * _GREEN_DISCOUNT if h in _GREEN_HIGHWAYS else L
            for L, h in zip(lengths, highways)
        ]
    return "length"


def _get_flavor_weights(flavor: str) -> "np.ndarray | list[float] | str":
    G = _load_graph()
    if G is None:
        return "length"
    # v1 fallback: igraph has "length" attr, string shorthand is valid + avoids
    # materialising a full weight list for the most-common flavor.
    if flavor == "fastest" and not isinstance(_edge_lengths, np.ndarray):
        return "length"
    # OPT-068: cache key includes `_graph_version`, so a hit guarantees the
    # entry was built against the currently-loaded graph — no `len(cached) ==
    # G.ecount()` length check needed in the hot path.
    key = (flavor, _graph_version)
    cached = _flavor_weights.get(key)
    if cached is not None:
        return cached
    with _weights_lock:
        # Double-checked: another thread may have built it while we waited.
        cached = _flavor_weights.get(key)
        if cached is not None:
            return cached
        weights = _build_flavor_weights(G, flavor)
        if isinstance(weights, (list, np.ndarray)):
            _flavor_weights[key] = weights
            # OPT-045: bounded LRU — drop the oldest entry on overflow. The
            # eight-slot cap fits the steady state (3 flavors × 1–2 variants)
            # plus a couple of stale-version entries across an eviction cycle.
            while len(_flavor_weights) > _FLAVOR_WEIGHTS_MAXSIZE:
                _flavor_weights.popitem(last=False)
    return weights


def _to_igraph_weights(w: "np.ndarray | list | str") -> "list | str":
    """Convert a weight vector to igraph-compatible form.

    igraph's C layer expects a Python list of floats or the string name of an
    edge attribute. numpy arrays cause a C-level abort on some platforms.
    """
    if isinstance(w, np.ndarray):
        return w.tolist()
    return w


def _vpath_from_epath(orig_idx: int, epath, G: "ig.Graph") -> list[int]:
    """Reconstruct the vertex path from an edge path. Uses the cached
    `_edge_sources` / `_edge_targets` columns when available so each step is
    a Python list index instead of a `G.es[eid].source` round-trip into the
    igraph C layer.
    """
    sources, targets = _edge_sources, _edge_targets
    vpath = [orig_idx]
    if sources is not None and targets is not None:
        for eid in epath:
            prev = vpath[-1]
            vpath.append(targets[eid] if sources[eid] == prev else sources[eid])
    else:
        for eid in epath:
            e = G.es[eid]
            vpath.append(e.target if e.source == vpath[-1] else e.source)
    return vpath


@lru_cache(maxsize=_ROUTE_CACHE_SIZE)
def _get_shortest_path_by_node(
    orig_idx: int,
    dest_idx: int,
    flavor: str = DEFAULT_FLAVOR,
) -> "tuple[tuple[int, ...], tuple[int, ...]] | None":
    G = _load_graph()
    if G is None:
        return None
    weights = _get_flavor_weights(flavor)
    try:
        result = G.get_shortest_paths(orig_idx, to=dest_idx, weights=_to_igraph_weights(weights), output="epath")
        if not result or not result[0]:
            return None
        epath = result[0]
        vpath = _vpath_from_epath(orig_idx, epath, G)
        return (tuple(vpath), tuple(epath))
    except Exception:
        return None


def _get_shortest_path(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> "tuple[tuple[int, ...], tuple[int, ...]] | None":
    """
    Compute and cache the shortest path between two lat/lon coordinates.

    Resolves each endpoint to a quantized graph vertex, then defers to a
    vertex-keyed LRU cache so jittered coordinates that snap to the same
    vertices share a single Dijkstra result.
    """
    if _load_graph() is None:
        return None
    orig_idx = _get_nearest_node(origin_lat, origin_lon)
    dest_idx = _get_nearest_node(dest_lat, dest_lon)
    if orig_idx is None or dest_idx is None:
        return None
    return _get_shortest_path_by_node(orig_idx, dest_idx, flavor)


def _haversine_walk_minutes(
    lat1: float, lon1: float, lat2: float, lon2: float
) -> float:
    """Straight-line walking time estimate — used as fallback only."""
    return round(_haversine_miles(lat1, lon1, lat2, lon2) / WALKING_SPEED_MPH * 60, 1)


# ---------------------------------------------------------------------------
# Private build helpers — not cached; called exactly once per _compute_route miss
# ---------------------------------------------------------------------------

def _build_minutes(
    origin_lat: float, origin_lon: float, dest_lat: float, dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> float:
    try:
        if _load_graph() is None:
            raise RuntimeError("street graph unavailable")
        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon, flavor)
        if path is None:
            raise RuntimeError("path unavailable")
        _, epath = path
        length_m = float(sum(_edge_lengths[e] for e in epath))
        return round(length_m / WALKING_SPEED_MPS / 60, 1)
    except Exception as e:
        logger.warning("walk_minutes fallback: %s: %s", type(e).__name__, e)
        return _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon)


def _build_directions(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> tuple:
    try:
        G = _load_graph()
        if G is None:
            raise RuntimeError("street graph unavailable")

        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon, flavor)
        if path is None:
            raise RuntimeError("path unavailable")

        vpath, epath = path
        if len(vpath) < 2:
            return ()
        _, directions = _build_path_and_directions(vpath, epath)
        return directions

    except Exception as e:
        logger.warning("walk_directions fallback: %s: %s", type(e).__name__, e)
        total_min = _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon)
        fallback_meters = total_min * 60 * WALKING_SPEED_MPS
        fallback_blocks = max(0.5, round(fallback_meters / _LONG_BLOCK_METERS * 2) / 2)
        return ({"street": "Walk", "path_type": "", "direction": "", "direction_full": "",
                 "blocks": fallback_blocks, "block_type": "long", "minutes": total_min,
                 "distance_meters": round(fallback_meters, 1)},)


def _build_path(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> tuple:
    try:
        G = _load_graph()
        if G is None:
            raise RuntimeError("street graph unavailable")

        path = _get_shortest_path(origin_lat, origin_lon, dest_lat, dest_lon, flavor)
        if path is None:
            raise RuntimeError("path unavailable")

        vpath, epath = path
        if len(vpath) < 2:
            return ((origin_lat, origin_lon), (dest_lat, dest_lon))
        coords, _ = _build_path_and_directions(vpath, epath)
        return coords

    except Exception as e:
        logger.error("routing failed: %s: %s", type(e).__name__, e)
        return ((origin_lat, origin_lon), (dest_lat, dest_lon))


# ---------------------------------------------------------------------------
# Single shared cache — resolves OPT-005 (stampede) and OPT-006 (uncoordinated eviction)
# ---------------------------------------------------------------------------

def _haversine_fallback(
    olat: float, olon: float, dlat: float, dlon: float, flavor: str,
) -> "tuple[tuple, tuple, float]":
    """Straight-line approximation when the graph or shortest path is unavailable.

    Returns the same `(path, directions, minutes)` shape as the routed branch
    so callers can be agnostic. Each helper independently logs why it fell
    back, which is why we still go through them rather than computing inline.
    """
    return (
        _build_path(olat, olon, dlat, dlon, flavor),
        _build_directions(olat, olon, dlat, dlon, flavor),
        _build_minutes(olat, olon, dlat, dlon, flavor),
    )


def _freeze_directions(directions) -> tuple:
    """Return a tuple of read-only views over the direction dicts.

    The cached `_compute_route_quantized` result is shared across every caller;
    wrapping each dict in `MappingProxyType` lets us return the cached tuple
    directly (no per-call defensive copy) while ensuring an accidental write
    raises `TypeError` instead of silently corrupting the cache.
    """
    return tuple(d if isinstance(d, MappingProxyType) else MappingProxyType(d) for d in directions)


@lru_cache(maxsize=_ROUTE_CACHE_SIZE)
def _compute_route_quantized(
    olat_q: int, olon_q: int, dlat_q: int, dlon_q: int,
    flavor: str = DEFAULT_FLAVOR,
) -> "tuple[tuple, tuple, float]":
    olat, olon = olat_q / 1e5, olon_q / 1e5
    dlat, dlon = dlat_q / 1e5, dlon_q / 1e5

    G = _load_graph()
    if G is None:
        path, directions, minutes = _haversine_fallback(olat, olon, dlat, dlon, flavor)
        return (path, _freeze_directions(directions), minutes)

    sp = _get_shortest_path(olat, olon, dlat, dlon, flavor)
    if sp is None:
        path, directions, minutes = _haversine_fallback(olat, olon, dlat, dlon, flavor)
        return (path, _freeze_directions(directions), minutes)

    vpath, epath = sp
    if len(vpath) < 2:
        return (
            ((olat, olon), (dlat, dlon)),
            (),
            _build_minutes(olat, olon, dlat, dlon, flavor),
        )

    path, directions = _build_path_and_directions(vpath, epath)
    # Derive minutes from the per-step distance_meters already summed inside
    # _build_path_and_directions, avoiding a second full epath traversal.
    if directions:
        total_meters = sum(d["distance_meters"] for d in directions)
        minutes = round(total_meters / WALKING_SPEED_MPS / 60, 1)
    else:
        minutes = _build_minutes(olat, olon, dlat, dlon, flavor)
    return (path, _freeze_directions(directions), minutes)


def _compute_route(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
) -> "tuple[tuple, tuple, float]":
    """
    Compute and cache all route data in one call.

    Coordinates are quantized to ~1m before cache lookup so floating-point
    jitter on the input cannot defeat the cache. The cached `directions` are
    `MappingProxyType` views — read-only by construction, so the previous
    per-call defensive `dict(d)` copy is unnecessary. `_enrich_directions`
    in `main.py` is the response-side copy boundary.
    """
    if flavor not in FLAVORS:
        flavor = DEFAULT_FLAVOR
    # TD-053 / B-40: short-circuit when origin == destination (after quantize
    # to ~1 m). igraph would return an empty epath which the downstream code
    # silently treats as "no turns" — correct but indistinguishable from a
    # routing failure to the caller. The explicit zero-distance / zero-minute
    # response with the same shape lets `/route` render a meaningful response
    # instead of fielding an empty-directions edge case.
    olat_q, olon_q = quantize_coord(origin_lat, origin_lon)
    dlat_q, dlon_q = quantize_coord(dest_lat,   dest_lon)
    if olat_q == dlat_q and olon_q == dlon_q:
        # Single-point path; no directions; zero minutes. Coords use the
        # quantized originals so the response is bit-stable across
        # floating-point jitter on the input.
        olat, olon = olat_q / 1e5, olon_q / 1e5
        return (((olat, olon),), (), 0.0)
    return _compute_route_quantized(olat_q, olon_q, dlat_q, dlon_q, flavor)


def pace_minutes_factor(pace: str) -> float:
    """Multiplicative factor that converts canonical 3 mph minutes to user-paced minutes."""
    pace_mph = _PACE_TO_MPH.get(pace, WALKING_SPEED_MPH)
    return WALKING_SPEED_MPH / pace_mph


def _get_avoid_stairs_weights(flavor: str) -> "list[float] | None":
    """Return (and cache) the weight vector for `flavor` with stair penalties layered on."""
    G = _load_graph()
    if G is None or _edge_lengths is None:
        return None
    key = (flavor, "avoid_stairs")
    cached = _combined_weights.get(key)
    if cached is not None and len(cached) == G.ecount():
        return cached
    # Resolve the base flavor weights outside the lock — `_get_flavor_weights`
    # acquires `_weights_lock` itself, and `threading.Lock` is non-reentrant.
    base = _get_flavor_weights(flavor)
    with _weights_lock:
        # Double-checked: another thread may have built it while we waited.
        cached = _combined_weights.get(key)
        if cached is not None and len(cached) == G.ecount():
            return cached
        # TD-053 / B-41: keep weights as float32 to match the dominant native
        # dtype used by `_build_flavor_weights` (canopy/parks columns are
        # float32 from the pickle, and the main weight builder operates in
        # that precision throughout). The prior float64 cast widened
        # transparently but burned 2× the memory on every avoid-stairs
        # cache row for no precision benefit at the meter scale we work in.
        weights = (np.array(_edge_lengths, dtype=np.float32)
                   if isinstance(base, str)
                   else np.asarray(base, dtype=np.float32))
        highways = _edge_highways
        if highways is not None:
            stairs_mask = np.fromiter((h == "steps" for h in highways), dtype=bool, count=len(highways))
            weights[stairs_mask] += _AVOID_STAIRS_PENALTY_M
        _combined_weights[key] = weights
    return weights


def _shortest_path_with_avoid_stairs(
    orig_idx: int, dest_idx: int, flavor: str,
) -> "tuple[tuple[int, ...], tuple[int, ...]] | None":
    """Dijkstra with a per-edge step-avoidance penalty layered on `flavor`. Weights cached."""
    G = _load_graph()
    if G is None:
        return None
    weights = _get_avoid_stairs_weights(flavor)
    if weights is None:
        return None
    try:
        result = G.get_shortest_paths(orig_idx, to=dest_idx, weights=_to_igraph_weights(weights), output="epath")
        if not result or not result[0]:
            return None
        epath = result[0]
        vpath = _vpath_from_epath(orig_idx, epath, G)
        return (tuple(vpath), tuple(epath))
    except Exception:
        return None


def compute_route_with_prefs(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    flavor: str = DEFAULT_FLAVOR,
    avoid_stairs: bool = False,
    prefer_pedestrian: bool = False,
) -> "tuple[tuple, tuple, float]":
    """
    Routing variant that honours `avoid_stairs` and `prefer_pedestrian`.

    `prefer_pedestrian` is satisfied by routing under the existing `greenest`
    flavor (which already discounts footway/path/cycleway edges), so it just
    forces that flavor when set. `avoid_stairs` requires bespoke per-edge
    weights, so when it is set we run an uncached Dijkstra with stair penalties
    layered on top of the chosen flavor.

    Falls back to the cached `_compute_route` path when neither pref is set.
    """
    if prefer_pedestrian:
        flavor = "greenest"
    if not avoid_stairs:
        return _compute_route(origin_lat, origin_lon, dest_lat, dest_lon, flavor)

    if _load_graph() is None:
        return (
            _build_path(origin_lat, origin_lon, dest_lat, dest_lon, flavor),
            _build_directions(origin_lat, origin_lon, dest_lat, dest_lon, flavor),
            _build_minutes(origin_lat, origin_lon, dest_lat, dest_lon, flavor),
        )

    orig_idx = _get_nearest_node(origin_lat, origin_lon)
    dest_idx = _get_nearest_node(dest_lat, dest_lon)
    if orig_idx is None or dest_idx is None:
        return (
            ((origin_lat, origin_lon), (dest_lat, dest_lon)),
            (),
            _haversine_walk_minutes(origin_lat, origin_lon, dest_lat, dest_lon),
        )

    path = _shortest_path_with_avoid_stairs(orig_idx, dest_idx, flavor)
    if path is None:
        return _compute_route(origin_lat, origin_lon, dest_lat, dest_lon, flavor)

    vpath, epath = path
    length_m = float(sum(_edge_lengths[e] for e in epath))
    minutes = round(length_m / WALKING_SPEED_MPS / 60, 1)

    # Single epath traversal that emits both coords and direction steps;
    # reusing _build_path/_build_directions would re-run the cached Dijkstra
    # and return the stairs-included path, defeating avoid_stairs.
    coords, directions = _build_path_and_directions(vpath, epath)
    return (coords if coords else ((origin_lat, origin_lon), (dest_lat, dest_lon)),
            directions, minutes)


_CARDINAL_DIRS: tuple[str, ...] = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def _build_path_and_directions(vpath: tuple, epath: tuple) -> "tuple[tuple, tuple]":
    """Single epath traversal that emits both the coordinate path and direction-step tuples.

    The sole `(vpath, epath) -> (coords, directions)` builder. `_build_path` and
    `_build_directions` route the routed case through here and pick the half
    they need; the haversine-fallback case in both callers builds its return
    value inline.

    Algorithm (TD-054 / B-15):

    Phase 1 — coord assembly. For each edge (eid, u, v) in the epath:
      1. Pull (name, path_type, length, u, v) into a `raw` buffer for phase 2.
      2. If the edge has explicit geometry, decode it (int32 -> float div 1e5
         or pass through if already float) and orient it: `du_start` vs
         `du_end` tells us whether the geometry's first point is closer to
         `u` (forward) or `v` (reverse). `head_idx` then picks whichever end
         is at `u`, and we walk geom from there. If that head coincides
         with the previous segment's tail (within 1e-9), set `skip_first`
         so we don't double-emit the seam.
      3. If no geometry, fall back to straight u→v vertex coords.

    Phase 2 — step aggregation. Walk the `raw` buffer in stride, grouping
    consecutive rows that share the same (name, path_type) so a long block
    of "W Belmont Ave" stays one direction step instead of one-per-edge.
    For each group:
      - Compute the cardinal heading from start_v → end_v in great-circle
        terms (cos_lat correction so longitude deltas don't overweight in
        the bearing). 1° snap zone around each cardinal axis kills the
        float-drift jitter described in B-43.
      - Classify the average edge length against `_BLOCK_TYPE_THRESHOLD`
        (150 m) into "long" or "short" blocks; format as `0.5`-resolution
        block counts (the resolution Chicago's grid renders cleanly at).

    The return is `(tuple_of_(lat,lon)_pairs, tuple_of_step_dicts)`.
    """
    if len(vpath) < 2:
        return ((), ())
    # TD-053 / B-44: igraph's contract guarantees `len(epath) == len(vpath) - 1`
    # for a connected pair. If that ever drifts (custom traversal, future
    # igraph API change), the `zip(epath, vpath, vpath[1:])` below would emit
    # fewer rows than expected without any indication. Surface the regression
    # loudly instead of silently producing a truncated route.
    if len(epath) != len(vpath) - 1:
        logger.error(
            "epath/vpath length mismatch: len(vpath)=%s len(epath)=%s — "
            "igraph contract violation, returning empty path",
            len(vpath), len(epath),
        )
        return ((), ())

    geoms        = _edge_geometries
    names_col    = _edge_names
    highways_col = _edge_highways
    footways_col = _edge_footways
    lengths_col  = _edge_lengths
    v_lats       = _vertex_lats
    v_lons       = _vertex_lons

    result_coords: list[tuple[float, float]] = []
    raw: list[tuple[str, str, float, int, int]] = []

    for eid, u, v in zip(epath, vpath, vpath[1:]):
        name = names_col[eid].strip()
        path_type = "" if name else _highway_path_type(highways_col[eid], footways_col[eid])
        length = float(lengths_col[eid])
        raw.append((name, path_type, length, u, v))

        geom_raw = geoms[eid]
        if geom_raw is not None:
            geom_coords = geom_raw / 1e5 if isinstance(geom_raw, np.ndarray) else geom_raw
            u_lon = v_lons[u]
            u_lat = v_lats[u]
            du_start = (geom_coords[0][0] - u_lon)**2 + (geom_coords[0][1] - u_lat)**2
            du_end   = (geom_coords[-1][0] - u_lon)**2 + (geom_coords[-1][1] - u_lat)**2
            reverse = bool(du_start > du_end)
            n = len(geom_coords)
            head_idx = n - 1 if reverse else 0
            head_lon, head_lat = float(geom_coords[head_idx][0]), float(geom_coords[head_idx][1])
            first = (head_lat, head_lon)
            last  = result_coords[-1] if result_coords else None
            skip_first = bool(last and abs(first[0] - last[0]) < 1e-9 and abs(first[1] - last[1]) < 1e-9)
            # TD-053 / B-42: the forward-vs-reverse `skip_first` ranges look
            # asymmetric (forward skips index 0 while reverse skips index n-1)
            # but they're geometrically identical: both skip the FIRST point
            # we'd emit, which sits at the seam against the prior segment's
            # tail. In forward order the first emit is geom[0]; in reverse
            # order the first emit is geom[n-1]. Skipping that one point in
            # each case avoids a duplicate seam in `result_coords`.
            if reverse:
                rng = range(n - 2, -1, -1) if skip_first else range(n - 1, -1, -1)
            else:
                rng = range(1, n) if skip_first else range(n)
            for j in rng:
                lon, lat = float(geom_coords[j][0]), float(geom_coords[j][1])
                result_coords.append((lat, lon))
        else:
            if not result_coords:
                result_coords.append((v_lats[u], v_lons[u]))
            result_coords.append((v_lats[v], v_lons[v]))

    steps: list[dict] = []
    i = 0
    n_raw = len(raw)
    while i < n_raw:
        name, path_type = raw[i][0], raw[i][1]
        total_length = 0.0
        edge_count = 0
        start_v = raw[i][3]
        end_v = raw[i][4]
        while i < n_raw and raw[i][0] == name and raw[i][1] == path_type:
            total_length += raw[i][2]
            edge_count   += 1
            end_v = raw[i][4]
            i += 1
        lat1, lon1 = v_lats[start_v], v_lons[start_v]
        lat2, lon2 = v_lats[end_v],   v_lons[end_v]
        minutes = round(total_length / WALKING_SPEED_MPS / 60, 1)
        cos_lat = math.cos(math.radians(lat1))
        deg = math.degrees(math.atan2((lon2 - lon1) * cos_lat, lat2 - lat1)) % 360
        # TD-053 / B-43: standard 8-way binning rounds to the nearest cardinal
        # (each bin is centered on the cardinal axis, 45° wide). The 1°
        # snap-zone around each cardinal kills any jitter induced by float-
        # precision drift in the atan2 + degree wrap when the actual heading
        # is "due cardinal" — e.g., a path going dead-south might compute as
        # 179.9999° on one edge and 180.0001° on the next; both should label
        # as S without flickering between adjacent labels.
        cardinal_idx = round(deg / 45) % 8
        nearest_cardinal_deg = (cardinal_idx * 45) % 360
        delta = abs(deg - nearest_cardinal_deg)
        # Wrap delta around 360° so 359.5° snaps to N (0°) instead of bouncing.
        if delta > 180:
            delta = 360 - delta
        # `delta < 1.0` is the snap-zone; outside that, the standard bin wins.
        # Both paths land on the same `cardinal_idx` in practice, but the
        # explicit snap documents the intent and pins the behavior near
        # cardinal axes against future binning-formula tweaks.
        cardinal = _CARDINAL_DIRS[cardinal_idx]
        avg_edge_m = total_length / edge_count
        # TD-053 / B-46: `>=` (not `>`) — see `_BLOCK_TYPE_THRESHOLD` block
        # comment for the rationale on the tied 150 m case.
        is_long  = avg_edge_m >= _BLOCK_TYPE_THRESHOLD
        block_m  = _LONG_BLOCK_METERS if is_long else _SHORT_BLOCK_METERS
        blocks   = max(0.5, round(total_length / block_m * 2) / 2)
        steps.append({
            "street":         name,
            "path_type":      path_type,
            "direction":      cardinal,
            "direction_full": _DIRECTION_FULL.get(cardinal, cardinal),
            "blocks":         blocks,
            "block_type":     "long" if is_long else "short",
            "minutes":        minutes,
            "distance_meters": round(total_length, 1),
        })
    return tuple(result_coords), tuple(steps)


class RouteAlternativeDict(TypedDict):
    """Shape of one entry in :func:`walk_paths_alternatives`'s return value.

    Documented as a TypedDict (not a Pydantic model) because callers
    consume the dict directly and would pay an avoidable allocation cost
    per request to construct model instances at the cache boundary. The
    /route handler converts these to the response-side
    :class:`models.RouteAlternative` after pace + step-length scaling.
    """

    flavor: str
    path: tuple  # tuple-of-tuples cached by _compute_route
    directions: list[dict]
    minutes: float


def walk_paths_alternatives(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> list[RouteAlternativeDict]:
    """
    Return route data for all FLAVORS as a list of dicts:
      [{"flavor": "fastest", "path": [...], "directions": [...], "minutes": ...}, ...]

    Each call hits a per-flavor LRU cache, so repeated requests for the same
    OD pair are O(flavors) lookups after the first computation. `path` is the
    cached tuple-of-tuples — FastAPI's encoder serialises tuples and lists
    identically, so passing it through avoids an O(N) per-request rebuild.
    """
    out: list[RouteAlternativeDict] = []
    for flavor in FLAVORS:
        path, directions, minutes = _compute_route(
            origin_lat, origin_lon, dest_lat, dest_lon, flavor,
        )
        out.append({
            "flavor": flavor,
            "path": path,
            "directions": list(directions),
            "minutes": minutes,
        })
    return out
