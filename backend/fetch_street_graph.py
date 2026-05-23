"""
Downloads the Chicago pedestrian street network from OpenStreetMap
and saves it as backend/street_graph.graphml + a fast igraph artifact.

Run once on initial setup, or with --force to re-download a fresh copy.

Usage:
  python fetch_street_graph.py           # download if missing
  python fetch_street_graph.py --force   # always re-download

Geographic scope: full Chicago city limits — covers all 77 community areas
(Howard St on the north, the southern city edge near 138th St, the lakefront,
and the western city edge at Pulaski Rd / Harlem Ave). Defined in
utils.STREET_GRAPH_BBOX_OSMNX — edit there to adjust coverage.

The igraph artifact (street_graph_igraph.pkl) is also built automatically.
The server loads from the .pkl on startup (fast); the .graphml is the source of truth.

Bake step (FEAT-4 "Greenest Routing — Tree + Park Edge Weights", shipped
2026-05-14): two per-edge attributes are computed during artifact
construction and baked into the pickle:

  - tree_canopy_score    (float32 in [0,1]): sparse KDE density sampled at
                          each edge's arc-length midpoint, from
                          `data/tree_canopy_kde.json`.
  - park_proximity_score (float32 in [0,1]): inverse distance from the edge
                          midpoint to the nearest CPD park polygon (from
                          `data/parks_polygons.json`), capped at 200 m,
                          scaled by a log-acreage multiplier (1.0–1.5×).

`walking.py`'s greenest weight function consumes both columns. Whenever
`tree_canopy_kde.json` or `parks_polygons.json` is refreshed (yearly per
the tree-canopy / parks ingest scripts), the street graph must be rebuilt
so the baked edge attributes stay in sync with the source artifacts. See
the "Greenest-routing graph release runbook" section in CLAUDE.md.
"""

import os
import pickle
import sys
import time
from pathlib import Path

from utils import STREET_GRAPH_BBOX_OSMNX, SERVICE_HIGHWAY_TYPES

GRAPH_PATH  = Path(__file__).parent / "street_graph.graphml"
IGRAPH_PATH = Path(__file__).parent / "street_graph_igraph.pkl"

BBOX = STREET_GRAPH_BBOX_OSMNX


# ---------------------------------------------------------------------------
# Progress reporting helpers
#
# Each major phase of the build is wrapped in _step_begin / _step_end so the
# user can see which step is running, how long it has taken, and (if psutil is
# installed) the current and peak resident-set-size of this process.
# ---------------------------------------------------------------------------
try:
    import psutil
    _PROC = psutil.Process()
    def _rss_mb() -> float | None:
        return _PROC.memory_info().rss / (1024 * 1024)
except ImportError:
    def _rss_mb() -> float | None:
        return None

_step_state = {"step": 0, "total": 0, "t0": None, "step_t0": None, "peak_rss": 0.0}


def _fmt_elapsed(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


def _set_step_total(total: int) -> None:
    _step_state["total"] = total
    _step_state["step"] = 0
    _step_state["t0"] = time.monotonic()
    _step_state["peak_rss"] = 0.0


def _step_begin(label: str) -> None:
    if _step_state["t0"] is None:
        _step_state["t0"] = time.monotonic()
    _step_state["step"] += 1
    _step_state["step_t0"] = time.monotonic()
    elapsed = time.monotonic() - _step_state["t0"]
    rss = _rss_mb()
    if rss is not None:
        _step_state["peak_rss"] = max(_step_state["peak_rss"], rss)
    rss_str = f" RSS={rss:.0f}MB peak={_step_state['peak_rss']:.0f}MB" if rss is not None else ""
    total = _step_state["total"] or "?"
    print(f"[{_step_state['step']}/{total} t+{_fmt_elapsed(elapsed)}{rss_str}] {label}...")


def _step_end(detail: str = "") -> None:
    step_elapsed = time.monotonic() - (_step_state["step_t0"] or time.monotonic())
    rss = _rss_mb()
    if rss is not None:
        _step_state["peak_rss"] = max(_step_state["peak_rss"], rss)
    rss_str = f" peak={_step_state['peak_rss']:.0f}MB" if rss is not None else ""
    suffix = f" -- {detail}" if detail else ""
    print(f"  done in {_fmt_elapsed(step_elapsed)}{rss_str}{suffix}")


def _is_lfs_pointer(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            first_line = f.readline(200)
        return first_line.startswith(b"version https://git-lfs.github.com")
    except Exception:
        return False


OVERPASS_MIRRORS: dict[str, str] = {
    "default": "https://overpass-api.de/api/interpreter",
    "kumi":    "https://overpass.kumi.systems/api/interpreter",
    "france":  "https://overpass.openstreetmap.fr/api/interpreter",
    "russia":  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
}


def _parse_mirror_arg(argv: list[str]) -> str | None:
    """Return the chosen Overpass URL (or None for the OSMnx default).

    Accepts --mirror=NAME, --mirror NAME, or a full https URL in place of NAME.
    """
    for i, arg in enumerate(argv):
        value: str | None = None
        if arg.startswith("--mirror="):
            value = arg.split("=", 1)[1]
        elif arg == "--mirror" and i + 1 < len(argv):
            value = argv[i + 1]
        if value is None:
            continue
        if value.startswith("http://") or value.startswith("https://"):
            return value
        if value in OVERPASS_MIRRORS:
            return OVERPASS_MIRRORS[value]
        print(f"Unknown --mirror value: {value!r}")
        print(f"  Choose one of: {', '.join(OVERPASS_MIRRORS)}  (or pass a full URL)")
        sys.exit(2)
    return None


def _file_report(path: Path) -> str:
    """One-line human description of a file's status."""
    if not path.exists():
        return "missing"
    if _is_lfs_pointer(path):
        return "Git LFS pointer stub (no real data)"
    size_mb = path.stat().st_size / (1024 * 1024)
    if path.stat().st_size < 1024:
        return f"present but only {path.stat().st_size} bytes (corrupt)"
    return f"present ({size_mb:.1f} MB)"


def _rebuild_pickle_from_graphml() -> None:
    """Skip the download + consolidation; just rebuild the pickle from the cached graphml."""
    try:
        import osmnx as ox
    except ImportError:
        print("osmnx is not installed. Run: pip install osmnx")
        sys.exit(1)
    _set_step_total(4)
    _step_begin(f"Loading cached graphml from {GRAPH_PATH.name}")
    G = ox.load_graphml(GRAPH_PATH)
    _step_end(f"{G.number_of_nodes():,} nodes, {G.number_of_edges():,} edges")
    _save_igraph_artifact(G)


def download_and_save(verbose: bool = False) -> None:
    try:
        import osmnx as ox
    except ImportError:
        print("osmnx is not installed. Run: pip install osmnx")
        sys.exit(1)

    ox.settings.log_console = bool(verbose)

    _set_step_total(9)

    _step_begin("Querying OpenStreetMap for the full Chicago walk network")
    print(f"  Bounding box: west={BBOX[0]}, south={BBOX[1]}, east={BBOX[2]}, north={BBOX[3]}")
    G = ox.graph_from_bbox(bbox=BBOX, network_type="walk")
    raw_nodes = G.number_of_nodes()
    raw_edges = G.number_of_edges()
    _step_end(f"{raw_nodes:,} nodes, {raw_edges:,} edges")

    _step_begin("Filtering service/alley edges (not walkable)")
    svc_edges: list = []
    for u, v, k, data in G.edges(keys=True, data=True):
        hw = data.get("highway", "")
        if isinstance(hw, list):
            hw = hw[0] if hw else ""
        hw = (hw or "").strip()
        if hw in SERVICE_HIGHWAY_TYPES:
            svc_edges.append((u, v, k))
    G.remove_edges_from(svc_edges)
    _step_end(f"removed {len(svc_edges):,} service/alley edges")

    _step_begin("Projecting graph to UTM for metric consolidation")
    G_proj = ox.project_graph(G)
    _step_end()

    _step_begin("Consolidating intersections (tolerance=10 m) -- this is the slow step")
    G_proj = ox.consolidate_intersections(G_proj, tolerance=10, rebuild_graph=True, dead_ends=False)
    cons_nodes_proj = G_proj.number_of_nodes()
    cons_edges_proj = G_proj.number_of_edges()
    node_pct = (raw_nodes - cons_nodes_proj) / raw_nodes * 100 if raw_nodes else 0.0
    edge_pct = (raw_edges - cons_edges_proj) / raw_edges * 100 if raw_edges else 0.0
    _step_end(
        f"{cons_nodes_proj:,} nodes (-{raw_nodes - cons_nodes_proj:,}, {node_pct:.1f}%), "
        f"{cons_edges_proj:,} edges (-{raw_edges - cons_edges_proj:,}, {edge_pct:.1f}%)"
    )

    _step_begin("Reprojecting back to EPSG:4326 (lat/lon)")
    G = ox.project_graph(G_proj, to_crs="epsg:4326")
    _step_end()

    _step_begin(f"Saving graphml to {GRAPH_PATH.name}")
    ox.save_graphml(G, GRAPH_PATH)
    size_mb = GRAPH_PATH.stat().st_size / (1024 * 1024)
    _step_end(f"{size_mb:.1f} MB written")

    _save_igraph_artifact(G)


# ---------------------------------------------------------------------------
# Greenest-routing bake step (FEAT-4, shipped 2026-05-14)
#
# For each post-dedup edge we compute two floats in [0, 1]:
#   - tree_canopy_score    — sparse KDE density at the edge's arc-length
#                            midpoint, looked up in tree_canopy_kde.json
#   - park_proximity_score — inverse distance from midpoint to nearest CPD
#                            park polygon (capped at 200 m → 0), multiplied
#                            by a log-acreage factor (capped at 1.5×)
# The arrays are baked into the pickle alongside the existing edge columns
# and consumed at runtime by `walking._build_flavor_weights` for the
# greenest flavor. See the FEAT-4 entry in docs/FEATURE_HISTORY.md.
# ---------------------------------------------------------------------------

# Chicago-centered equirectangular projection. The bake step works entirely
# in meters so park distance + canopy cell containment can be checked with
# axis-aligned thresholds.
_LAT_REF_DEG     = 41.85
_M_PER_DEG_LAT   = 111_320.0

# Park proximity tuning constants (FEATURE_PLANS.md "Resolved design decisions").
_PARK_CUTOFF_M       = 200.0   # linear cap, edge midpoint → nearest park boundary
_PARK_ACRES_LOG_SAT  = 2.0     # log10(100) — parks ≥ ~100 acres saturate the multiplier
_PARK_MULT_MIN       = 1.0
_PARK_MULT_MAX       = 1.5


def _bake_green_signals(
    edges: list[tuple[int, int]],
    attr_geometry: list,
    vx_lons: list[float],
    vx_lats: list[float],
):
    """Compute per-edge tree_canopy_score + park_proximity_score arrays.

    Returns (canopy_f32, park_f32) — both shape (len(edges),). Edges with no
    canopy cell containing the midpoint score 0; edges further than
    _PARK_CUTOFF_M from any park score 0.

    The function is tolerant of missing artifacts: if either JSON is absent or
    malformed the corresponding array stays all-zeros and the bake continues.
    """
    import json
    import math as _math

    import numpy as _np
    import shapely as _shapely
    from scipy.spatial import cKDTree as _cKDTree
    from shapely.geometry import Polygon as _Polygon
    from shapely.strtree import STRtree as _STRtree

    data_dir   = Path(__file__).resolve().parent / "data"
    tree_path  = data_dir / "tree_canopy_kde.json"
    parks_path = data_dir / "parks_polygons.json"

    m_per_deg_lon = _M_PER_DEG_LAT * _math.cos(_math.radians(_LAT_REF_DEG))

    def _proj(lon: float, lat: float) -> tuple[float, float]:
        return (lon * m_per_deg_lon, lat * _M_PER_DEG_LAT)

    n = len(edges)
    canopy_scores = _np.zeros(n, dtype=_np.float32)
    park_scores   = _np.zeros(n, dtype=_np.float32)

    if n == 0:
        return canopy_scores, park_scores

    # ---- 1. Edge midpoints (arc-length) in projected metres ---------------
    # OPT-053: flatten every edge's geometry into one (M, 2) coord array, then
    # compute segment lengths and the arc-length midpoint of each edge in a
    # single vectorized pass. Cross-edge "diff" rows (the seam between the
    # last coord of edge k and the first coord of edge k+1) get zeroed out so
    # they don't pollute the global cumulative arc-length array. Edges with
    # no geometry (or fewer than 2 coords) fall back to the endpoint
    # midpoint via the same vectorized projection at the end of this block.
    geom_lens = _np.array(
        [len(g) if g is not None else 0 for g in attr_geometry],
        dtype=_np.int64,
    )
    has_geom = geom_lens >= 2
    geom_idx = _np.flatnonzero(has_geom)

    vx_lons_arr = _np.asarray(vx_lons, dtype=_np.float64)
    vx_lats_arr = _np.asarray(vx_lats, dtype=_np.float64)

    mid_lon_arr = _np.zeros(n, dtype=_np.float64)
    mid_lat_arr = _np.zeros(n, dtype=_np.float64)

    # No-geometry edges → endpoint midpoint (vectorized).
    no_geom_idx = _np.flatnonzero(~has_geom)
    if no_geom_idx.size:
        edge_us = _np.fromiter(
            (edges[i][0] for i in no_geom_idx), dtype=_np.int64, count=no_geom_idx.size,
        )
        edge_vs = _np.fromiter(
            (edges[i][1] for i in no_geom_idx), dtype=_np.int64, count=no_geom_idx.size,
        )
        mid_lon_arr[no_geom_idx] = (vx_lons_arr[edge_us] + vx_lons_arr[edge_vs]) / 2.0
        mid_lat_arr[no_geom_idx] = (vx_lats_arr[edge_us] + vx_lats_arr[edge_vs]) / 2.0

    if geom_idx.size:
        g_lens = geom_lens[geom_idx]
        # Per-edge coord offsets into the flat array. edge k owns coords
        # [edge_coord_offsets[k], edge_coord_offsets[k+1]).
        edge_coord_offsets = _np.empty(geom_idx.size + 1, dtype=_np.int64)
        edge_coord_offsets[0] = 0
        _np.cumsum(g_lens, out=edge_coord_offsets[1:])
        total_coords = int(edge_coord_offsets[-1])

        flat = _np.empty((total_coords, 2), dtype=_np.float64)
        for k, i in enumerate(geom_idx):
            s = int(edge_coord_offsets[k])
            e = int(edge_coord_offsets[k + 1])
            flat[s:e] = attr_geometry[i]

        # Per-segment vectors in projected metres.
        diff = _np.diff(flat, axis=0)
        seg_lens_all = _np.hypot(
            diff[:, 0] * m_per_deg_lon,
            diff[:, 1] * _M_PER_DEG_LAT,
        )
        # Zero out the cross-edge "diff" between consecutive edges so they
        # contribute 0 to any edge's cumulative arc length.
        if geom_idx.size > 1:
            cross_indices = edge_coord_offsets[1:-1] - 1
            seg_lens_all[cross_indices] = 0.0

        # Global cumulative arc length over the flattened coords, with a
        # leading 0 so cum_global[i] = arc length up to coord i.
        cum_global = _np.empty(total_coords, dtype=_np.float64)
        cum_global[0] = 0.0
        _np.cumsum(seg_lens_all, out=cum_global[1:])

        edge_starts = edge_coord_offsets[:-1]
        edge_ends   = edge_coord_offsets[1:] - 1
        edge_total  = cum_global[edge_ends] - cum_global[edge_starts]
        edge_target = cum_global[edge_starts] + edge_total / 2.0

        # Find the coord pair containing each edge's midpoint via a single
        # searchsorted. The cross-edge diffs are zero, so cum_global has flat
        # plateaus at the seam — searchsorted with `side='left'` lands at or
        # before the plateau, never inside the next edge's segments.
        search_idx = _np.searchsorted(cum_global, edge_target, side="left")
        # When edge_target equals cum_global[start] (degenerate zero-length edge),
        # searchsorted returns `start`, but we need at least `start + 1` so that
        # `j = search_idx - 1 = start` is a valid lower bound.
        search_idx = _np.maximum(search_idx, edge_starts + 1)
        # Also clamp to the upper bound — the last coord of any edge can be the
        # answer when target lies exactly on it.
        search_idx = _np.minimum(search_idx, edge_ends)

        j = search_idx - 1
        seg_len_j = cum_global[j + 1] - cum_global[j]
        # f = (target - cum[j]) / seg_len_j, with 0 used for zero-length segs.
        safe_seg = _np.where(seg_len_j > 0, seg_len_j, 1.0)
        f = _np.where(seg_len_j > 0, (edge_target - cum_global[j]) / safe_seg, 0.0)

        lon_a = flat[j, 0]
        lat_a = flat[j, 1]
        lon_b = flat[j + 1, 0]
        lat_b = flat[j + 1, 1]
        mid_lon_arr[geom_idx] = lon_a + f * (lon_b - lon_a)
        mid_lat_arr[geom_idx] = lat_a + f * (lat_b - lat_a)

    # Project all midpoints in one bulk multiply.
    mid_xy = _np.column_stack([
        mid_lon_arr * m_per_deg_lon,
        mid_lat_arr * _M_PER_DEG_LAT,
    ])

    # ---- 2. Tree canopy: per-edge KDE density lookup ----------------------
    if tree_path.exists():
        try:
            tree_data = json.loads(tree_path.read_text(encoding="utf-8"))
            cell_size_m = float((tree_data.get("metadata") or {}).get("cell_size_m") or 100.0)
            cells = tree_data.get("cells") or []
            valid_cells = [
                (float(c["lon"]), float(c["lat"]), float(c["density"]))
                for c in cells
                if isinstance(c.get("lon"), (int, float))
                and isinstance(c.get("lat"), (int, float))
                and isinstance(c.get("density"), (int, float))
                and _math.isfinite(float(c["density"]))
            ]
            if valid_cells:
                cell_xy        = _np.array(
                    [_proj(lon, lat) for lon, lat, _ in valid_cells], dtype=_np.float64
                )
                cell_densities = _np.array([d for _, _, d in valid_cells], dtype=_np.float64)
                half_cell = cell_size_m / 2.0
                kdt = _cKDTree(cell_xy)
                _, idxs = kdt.query(mid_xy, k=1)
                dx = _np.abs(mid_xy[:, 0] - cell_xy[idxs, 0])
                dy = _np.abs(mid_xy[:, 1] - cell_xy[idxs, 1])
                inside = (dx <= half_cell) & (dy <= half_cell)
                raw = _np.where(inside, cell_densities[idxs], 0.0)
                canopy_scores = _np.clip(raw, 0.0, 1.0).astype(_np.float32)
            else:
                print(f"  [warn] {tree_path.name} contained no usable cells — tree_canopy_score=0 for every edge")
        except (OSError, ValueError, KeyError, TypeError) as e:
            print(f"  [warn] tree-canopy bake skipped ({type(e).__name__}: {e})")
    else:
        print(f"  [warn] {tree_path.name} not found — tree_canopy_score=0 for every edge")

    # ---- 3. Park proximity: per-edge nearest-park distance ---------------
    if parks_path.exists():
        try:
            parks_data = json.loads(parks_path.read_text(encoding="utf-8"))
            entries = parks_data.get("parks") or []
            projected_polys: list[_Polygon] = []
            park_acres:      list[float]    = []
            for entry in entries:
                ring = entry.get("ring")
                if not ring or len(ring) < 4:
                    continue
                try:
                    poly = _Polygon([_proj(float(lon), float(lat)) for lon, lat in ring])
                except (ValueError, TypeError):
                    continue
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.is_empty or not hasattr(poly, "geom_type"):
                    continue
                projected_polys.append(poly)
                try:
                    park_acres.append(float(entry.get("acres") or 0.0))
                except (TypeError, ValueError):
                    park_acres.append(0.0)

            if projected_polys:
                # OPT-030: shapely 2.x batched STRtree.nearest + shapely.distance.
                # The catalog's "KDTree(park_centroids)" recipe would change the
                # math (centroid distance for a big park like Lincoln Park is
                # hundreds of metres even for edges that touch its boundary),
                # so we keep the original "distance to polygon edge" semantics
                # via shapely's vectorized API.
                strtree = _STRtree(projected_polys)
                mid_pts = _shapely.points(mid_xy)
                nearest_idx_arr = strtree.nearest(mid_pts)
                polys_arr = _np.asarray(projected_polys)
                nearest_polys = polys_arr[nearest_idx_arr]
                dists = _shapely.distance(mid_pts, nearest_polys)

                acres_arr = _np.asarray(park_acres, dtype=_np.float64)
                near_acres = acres_arr[nearest_idx_arr]

                # base = max(0, 1 - dist / CUTOFF). Edges beyond CUTOFF get 0.
                base = _np.clip(1.0 - dists / _PARK_CUTOFF_M, 0.0, 1.0)
                # log10 acres saturating at _PARK_ACRES_LOG_SAT, clamped >= 0.
                with _np.errstate(divide="ignore", invalid="ignore"):
                    log_acres = _np.where(near_acres > 0, _np.log10(_np.maximum(1.0, near_acres)), 0.0)
                factor = log_acres / _PARK_ACRES_LOG_SAT  # 0 at 1 acre, 1 at 100 acres
                multiplier = _np.minimum(
                    _PARK_MULT_MAX,
                    _PARK_MULT_MIN + (_PARK_MULT_MAX - _PARK_MULT_MIN) * factor,
                )
                park_scores[:] = _np.clip(base * multiplier, 0.0, 1.0).astype(_np.float32)
            else:
                print(f"  [warn] {parks_path.name} contained no usable polygons — park_proximity_score=0 for every edge")
        except (OSError, ValueError, KeyError, TypeError) as e:
            print(f"  [warn] parks bake skipped ({type(e).__name__}: {e})")
    else:
        print(f"  [warn] {parks_path.name} not found — park_proximity_score=0 for every edge")

    return canopy_scores, park_scores


def _print_score_histogram(label: str, scores) -> None:
    """One-line summary + a coarse histogram of a [0,1] score array."""
    import numpy as _np
    bins = [0.0, 0.001, 0.05, 0.10, 0.20, 0.40, 0.60, 0.80, 1.0001]
    counts, _ = _np.histogram(scores, bins=bins)
    nz = int((scores > 0).sum())
    n  = len(scores)
    pct = (nz / n * 100.0) if n else 0.0
    print(f"  {label}: non-zero {nz:,}/{n:,} ({pct:.1f}%)  min={float(scores.min()):.3f}  max={float(scores.max()):.3f}  mean={float(scores.mean()):.3f}")
    rows = [
        ("[0.000, 0.001)", counts[0]),
        ("[0.001, 0.050)", counts[1]),
        ("[0.050, 0.100)", counts[2]),
        ("[0.100, 0.200)", counts[3]),
        ("[0.200, 0.400)", counts[4]),
        ("[0.400, 0.600)", counts[5]),
        ("[0.600, 0.800)", counts[6]),
        ("[0.800, 1.000]", counts[7]),
    ]
    for name, c in rows:
        bar = "#" * min(40, int(c * 40 / max(counts.max(), 1)))
        print(f"    {name} {int(c):8,d} {bar}")


def _save_igraph_artifact(G_nx) -> None:
    """Convert the NetworkX MultiDiGraph to a compact igraph artifact and pickle it."""
    try:
        import igraph as ig
        import numpy as np
        from shapely import wkt as shapely_wkt

        _step_begin("Converting to compact igraph artifact")

        nodes = list(G_nx.nodes())
        node_to_idx = {n: i for i, n in enumerate(nodes)}

        edges:         list[tuple[int, int]] = []
        attr_length:   list[float]           = []
        attr_name:     list[str]             = []
        attr_highway:  list[str]             = []
        attr_footway:  list[str]             = []
        attr_geometry: list                  = []
        filtered = 0

        for u, v, data in G_nx.edges(data=True):
            hw = data.get("highway", "")
            if isinstance(hw, list): hw = hw[0] if hw else ""
            hw = (hw or "").strip()
            if hw in SERVICE_HIGHWAY_TYPES:
                filtered += 1
                continue

            edges.append((node_to_idx[u], node_to_idx[v]))
            attr_length.append(float(data.get("length") or 0.0))

            name = data.get("name", "")
            if isinstance(name, list):
                name = name[0] if name else ""
            attr_name.append((name or "").strip())

            attr_highway.append(hw)

            fw = data.get("footway", "")
            if isinstance(fw, list): fw = fw[0] if fw else ""
            attr_footway.append((fw or "").strip())

            geom = data.get("geometry")
            if geom is not None and hasattr(geom, "coords"):
                attr_geometry.append(list(geom.coords))
            elif isinstance(geom, str) and geom:
                try:
                    attr_geometry.append(list(shapely_wkt.loads(geom).coords))
                except Exception:
                    attr_geometry.append(None)
            else:
                attr_geometry.append(None)

        if filtered:
            print(f"  Filtered {filtered:,} service/alley edges before saving artifact")

        # Collapse antiparallel directed edge pairs into one undirected edge.
        # Take min length; first-seen name / highway / footway / geometry.
        directed_ecount = len(edges)
        seen_pairs: dict[tuple[int, int], int] = {}
        dedup_edges:    list[tuple[int, int]] = []
        dedup_length:   list[float]           = []
        dedup_name:     list[str]             = []
        dedup_highway:  list[str]             = []
        dedup_footway:  list[str]             = []
        dedup_geometry: list                  = []
        for i, (u, v) in enumerate(edges):
            key = (min(u, v), max(u, v))
            if key not in seen_pairs:
                seen_pairs[key] = len(dedup_edges)
                dedup_edges.append((u, v))
                dedup_length.append(attr_length[i])
                dedup_name.append(attr_name[i])
                dedup_highway.append(attr_highway[i])
                dedup_footway.append(attr_footway[i])
                dedup_geometry.append(attr_geometry[i])
            elif attr_length[i] < dedup_length[seen_pairs[key]]:
                dedup_length[seen_pairs[key]] = attr_length[i]
        print(f"  Deduplicated to undirected: {len(dedup_edges):,} edges (was {directed_ecount:,} directed)")
        edges, attr_length, attr_name = dedup_edges, dedup_length, dedup_name
        attr_highway, attr_footway, attr_geometry = dedup_highway, dedup_footway, dedup_geometry

        # Vertex lon/lat lists keyed by node index — used by the green-signals
        # bake for None-geometry edges, and again below for ig.Graph vertex attrs.
        vx_lons = [float(G_nx.nodes[n].get("x", 0.0)) for n in nodes]
        vx_lats = [float(G_nx.nodes[n].get("y", 0.0)) for n in nodes]

        _step_end(f"{len(edges):,} undirected edges ready")

        # --- bake greenest-routing edge attributes (FEAT-4) ---
        _step_begin("Baking tree_canopy_score + park_proximity_score per edge")
        edge_tree_canopy_f32, edge_park_proximity_f32 = _bake_green_signals(
            edges, attr_geometry, vx_lons, vx_lats
        )
        _print_score_histogram("tree_canopy_score   ", edge_tree_canopy_f32)
        _print_score_histogram("park_proximity_score", edge_park_proximity_f32)
        _step_end()

        _step_begin("Packing compact arrays + writing pickle")

        # --- compact arrays (format_version 3) ---

        # highway / footway vocab encoding (int8 codes + vocab list)
        highway_vocab = sorted(set(attr_highway))
        footway_vocab = sorted(set(attr_footway))
        hw_to_code = {s: i for i, s in enumerate(highway_vocab)}
        fw_to_code = {s: i for i, s in enumerate(footway_vocab)}
        edge_highway_codes = np.array([hw_to_code[h] for h in attr_highway], dtype=np.int8)
        edge_footway_codes = np.array([fw_to_code[f] for f in attr_footway], dtype=np.int8)

        # lengths as float32 (centimetre precision — more than enough for routing weights)
        edge_lengths_f32 = np.array(attr_length, dtype=np.float32)

        # sources / targets as int32 (derived from the edges list)
        edge_sources_i32 = np.array([u for u, _ in edges], dtype=np.int32)
        edge_targets_i32 = np.array([v for _, v in edges], dtype=np.int32)

        # geometry: quantize (lon, lat) float64 pairs to int32 scaled by 1e5 (~1 m precision)
        edge_geoms: list = []
        for coords in attr_geometry:
            if coords is None:
                edge_geoms.append(None)
            else:
                edge_geoms.append(
                    np.array(
                        [(round(lon * 1e5), round(lat * 1e5)) for lon, lat in coords],
                        dtype=np.int32,
                    )
                )

        # igraph graph carries only vertex x/y; all edge data lives in compact arrays
        ig_graph = ig.Graph(
            n=len(nodes),
            edges=edges,
            directed=False,
            vertex_attrs={"x": vx_lons, "y": vx_lats},
        )

        with open(IGRAPH_PATH, "wb") as f:
            pickle.dump(
                {
                    "format_version":    3,
                    "prefiltered":       True,
                    "graph":             ig_graph,
                    "edge_names":        attr_name,
                    "edge_lengths_f32":  edge_lengths_f32,
                    "edge_sources_i32":  edge_sources_i32,
                    "edge_targets_i32":  edge_targets_i32,
                    "edge_highway_codes": edge_highway_codes,
                    "edge_footway_codes": edge_footway_codes,
                    "highway_vocab":     highway_vocab,
                    "footway_vocab":     footway_vocab,
                    "edge_geoms":        edge_geoms,
                    # FEAT-4 greenest-routing edge attributes — consumed by
                    # `walking._build_flavor_weights("greenest")`.
                    "edge_tree_canopy_f32":    edge_tree_canopy_f32,
                    "edge_park_proximity_f32": edge_park_proximity_f32,
                },
                f,
                protocol=pickle.HIGHEST_PROTOCOL,
            )

        artifact_mb = IGRAPH_PATH.stat().st_size / (1024 * 1024)
        _step_end(f"{artifact_mb:.1f} MB, {ig_graph.vcount():,} vertices, {ig_graph.ecount():,} edges")

    except Exception as e:
        print(f"[error] igraph artifact creation failed ({type(e).__name__}: {e})")
        raise


if __name__ == "__main__":
    force = "--force" in sys.argv
    verbose = "--verbose" in sys.argv
    mirror_url = _parse_mirror_arg(sys.argv)
    if mirror_url:
        try:
            import osmnx as ox
        except ImportError:
            print("osmnx is not installed. Run: pip install osmnx")
            sys.exit(1)
        ox.settings.overpass_url = mirror_url
        print(f"Using non-default Overpass mirror: {mirror_url}\n")

    graphml_usable = GRAPH_PATH.exists() and GRAPH_PATH.stat().st_size >= 1024 and not _is_lfs_pointer(GRAPH_PATH)
    pickle_usable = IGRAPH_PATH.exists() and IGRAPH_PATH.stat().st_size >= 1024

    print("Current files in backend/:")
    print(f"  {GRAPH_PATH.name}      {_file_report(GRAPH_PATH)}")
    print(f"  {IGRAPH_PATH.name}   {_file_report(IGRAPH_PATH)}")
    print()

    if force:
        print("--force given: doing a full rebuild (download + consolidation + pickle).\n")
        if GRAPH_PATH.exists():
            GRAPH_PATH.unlink()
        download_and_save(verbose=verbose)
        sys.exit(0)

    non_interactive = (
        os.getenv("RAILWAY_ENVIRONMENT")
        or os.getenv("CI")
        or not sys.stdin.isatty()
    )
    if non_interactive:
        if not graphml_usable:
            print("Non-interactive environment, graph missing -- downloading.\n")
            if GRAPH_PATH.exists():
                GRAPH_PATH.unlink()
            download_and_save(verbose=verbose)
        elif not pickle_usable:
            print("Non-interactive environment, graphml present but pickle missing -- rebuilding pickle.\n")
            _rebuild_pickle_from_graphml()
        else:
            print("Non-interactive environment, graph + pickle present -- keeping them. (Pass --force to re-download.)")
        sys.exit(0)

    print("What would you like to do?")
    options: list[tuple[str, str, str]] = []
    if graphml_usable:
        options.append(("1", "Rebuild ONLY the pickle from the existing graphml (fast, ~1 min)", "pickle"))
        options.append(("2", "Rebuild BOTH (re-download graphml from OSM, then rebuild pickle) -- slow", "both"))
    else:
        options.append(("1", "Create a fresh graph (download from OSM, then build pickle) -- slow", "both"))
    options.append(("q", "Quit without changes", "quit"))

    for key, label, _ in options:
        print(f"  [{key}] {label}")
    print()

    valid_keys = {key for key, _, _ in options}
    while True:
        answer = input("Choice: ").strip().lower()
        if answer in valid_keys:
            break
        print(f"  Please enter one of: {', '.join(sorted(valid_keys))}")

    action = next(a for k, _, a in options if k == answer)

    if action == "quit":
        print("Aborted. No changes made.")
        sys.exit(0)
    if action == "pickle":
        print()
        _rebuild_pickle_from_graphml()
        sys.exit(0)
    if action == "both":
        print()
        if GRAPH_PATH.exists():
            GRAPH_PATH.unlink()
        download_and_save(verbose=verbose)
        sys.exit(0)
