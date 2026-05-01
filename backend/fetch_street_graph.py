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
from pathlib import Path

from utils import STREET_GRAPH_BBOX_OSMNX

GRAPH_PATH  = Path(__file__).parent / "street_graph.graphml"
IGRAPH_PATH = Path(__file__).parent / "street_graph_igraph.pkl"

BBOX = STREET_GRAPH_BBOX_OSMNX


def _is_lfs_pointer(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            first_line = f.readline(200)
        return first_line.startswith(b"version https://git-lfs.github.com")
    except Exception:
        return False


def _needs_download() -> bool:
    if not GRAPH_PATH.exists():
        return True
    if GRAPH_PATH.stat().st_size < 1024:
        return True
    if _is_lfs_pointer(GRAPH_PATH):
        return True
    return False


def download_and_save() -> None:
    try:
        import osmnx as ox
    except ImportError:
        print("osmnx is not installed. Run: pip install osmnx")
        sys.exit(1)

    print("Querying OpenStreetMap for the full Chicago walk network...")
    print(f"  Bounding box: west={BBOX[0]}, south={BBOX[1]}, east={BBOX[2]}, north={BBOX[3]}")
    print("  This usually takes 3–10 minutes on first download.\n")

    G = ox.graph_from_bbox(bbox=BBOX, network_type="walk")

    raw_nodes = G.number_of_nodes()
    raw_edges = G.number_of_edges()
    print(f"Network downloaded: {raw_nodes:,} nodes, {raw_edges:,} edges")

    print("Consolidating intersections (tolerance=10 m) ...")
    G_proj = ox.project_graph(G)
    G_proj = ox.consolidate_intersections(G_proj, tolerance=10, rebuild_graph=True, dead_ends=False)
    G = ox.project_graph(G_proj, to_crs="epsg:4326")

    cons_nodes = G.number_of_nodes()
    cons_edges = G.number_of_edges()
    node_pct = (raw_nodes - cons_nodes) / raw_nodes * 100
    edge_pct = (raw_edges - cons_edges) / raw_edges * 100
    print(
        f"After consolidation: {cons_nodes:,} nodes (−{raw_nodes - cons_nodes:,}, {node_pct:.1f}%), "
        f"{cons_edges:,} edges (−{raw_edges - cons_edges:,}, {edge_pct:.1f}%)"
    )

    print(f"Saving to {GRAPH_PATH} ...")
    ox.save_graphml(G, GRAPH_PATH)
    size_mb = GRAPH_PATH.stat().st_size / (1024 * 1024)
    print(f"Saved ({size_mb:.1f} MB). Street graph is ready.")

    _save_igraph_artifact(G)


def _save_igraph_artifact(G_nx) -> None:
    """Convert the NetworkX MultiDiGraph to a compact igraph artifact and pickle it."""
    try:
        import igraph as ig
        from shapely import wkt as shapely_wkt

        print("Converting to igraph compact artifact ...")

        nodes = list(G_nx.nodes())
        node_to_idx = {n: i for i, n in enumerate(nodes)}

        _SERVICE_TYPES = {"service", "alley"}

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
            if hw in _SERVICE_TYPES:
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
        print(
            f"igraph artifact saved to {IGRAPH_PATH} "
            f"({artifact_mb:.1f} MB, {ig_graph.vcount():,} vertices, {ig_graph.ecount():,} edges)"
        )

    except Exception as e:
        print(f"[warning] igraph artifact creation failed ({type(e).__name__}: {e})")


if __name__ == "__main__":
    force = "--force" in sys.argv

    if _needs_download():
        reason = (
            "not found" if not GRAPH_PATH.exists()
            else ("LFS pointer" if _is_lfs_pointer(GRAPH_PATH) else "too small")
        )
        print(f"Street graph {reason} — downloading from OpenStreetMap...")
        if GRAPH_PATH.exists():
            GRAPH_PATH.unlink()
        download_and_save()
    elif force:
        print("Street graph exists. Re-downloading (--force).")
        GRAPH_PATH.unlink()
        if IGRAPH_PATH.exists():
            IGRAPH_PATH.unlink()
        download_and_save()
    else:
        import sys
        size_mb = GRAPH_PATH.stat().st_size / (1024 * 1024)
        if not sys.stdin.isatty() or os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("CI"):
            print(f"Street graph already present ({size_mb:.1f} MB). Keeping it (non-interactive).")
        else:
            print(f"Street graph already exists ({size_mb:.1f} MB) at {GRAPH_PATH}.")
            answer = input("Re-download and overwrite? [y/N]: ").strip().lower()
            if answer == "y":
                GRAPH_PATH.unlink()
                if IGRAPH_PATH.exists():
                    IGRAPH_PATH.unlink()
                download_and_save()
            else:
                print("Kept existing graph.")

    # Build igraph artifact from existing graphml if it's missing
    if GRAPH_PATH.exists() and not _needs_download() and not IGRAPH_PATH.exists():
        print("igraph artifact missing — building from existing graphml ...")
        try:
            import osmnx as ox
            G_existing = ox.load_graphml(GRAPH_PATH)
            _save_igraph_artifact(G_existing)
        except Exception as e:
            print(f"[warning] Could not build igraph artifact ({type(e).__name__}: {e})")
