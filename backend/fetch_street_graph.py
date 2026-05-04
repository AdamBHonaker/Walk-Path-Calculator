"""
Downloads the Chicago pedestrian street network from OpenStreetMap
and saves it as backend/street_graph.graphml + a fast igraph artifact.

Run once on initial setup, or with --force to re-download a fresh copy.

Usage:
  python fetch_street_graph.py           # download if missing
  python fetch_street_graph.py --force   # always re-download

Geographic scope: northern Chicago only (20th St→Howard, lakefront→city west edge).
Defined in utils.STREET_GRAPH_BBOX_OSMNX — edit there to adjust coverage.

The igraph artifact (street_graph_igraph.pkl) is also built automatically.
The server loads from the .pkl on startup (fast); the .graphml is the source of truth.
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
    _set_step_total(2)
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

    ox.settings.log_console = True
    _ = verbose

    _set_step_total(7)

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


def _save_igraph_artifact(G_nx) -> None:
    """Convert the NetworkX MultiDiGraph to a compact igraph artifact and pickle it."""
    try:
        import igraph as ig
        from shapely import wkt as shapely_wkt

        _step_begin("Converting to compact igraph artifact")

        nodes = list(G_nx.nodes())
        node_to_idx = {n: i for i, n in enumerate(nodes)}

        edges:         list[tuple[int, int]] = []
        attr_length:   list[float]           = []
        attr_name:     list[str]             = []
        attr_highway:  list[str]             = []
        attr_footway:  list[str]             = []
        attr_geometry: list[list | None]     = []
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

        ig_graph = ig.Graph(
            n=len(nodes),
            edges=edges,
            directed=True,
            vertex_attrs={
                "x": [float(G_nx.nodes[n].get("x", 0.0)) for n in nodes],
                "y": [float(G_nx.nodes[n].get("y", 0.0)) for n in nodes],
            },
            edge_attrs={
                "length":   attr_length,
                "name":     attr_name,
                "highway":  attr_highway,
                "footway":  attr_footway,
                "geometry": attr_geometry,
            },
        )

        with open(IGRAPH_PATH, "wb") as f:
            pickle.dump({"graph": ig_graph}, f, protocol=pickle.HIGHEST_PROTOCOL)

        artifact_mb = IGRAPH_PATH.stat().st_size / (1024 * 1024)
        _step_end(f"{artifact_mb:.1f} MB, {ig_graph.vcount():,} vertices, {ig_graph.ecount():,} edges")

    except Exception as e:
        print(f"[warning] igraph artifact creation failed ({type(e).__name__}: {e})")


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
