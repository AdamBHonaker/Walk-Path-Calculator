"""
One-time generator for backend/data/tree_canopy_kde.json — a sparse
kernel-density grid of Chicago's mapped trees, used by the Neighborhood
Explorer to render a shade/canopy overlay alongside the existing
residential heatmap.

Source: OpenStreetMap `natural=tree` nodes inside the Chicago street-graph
bbox, fetched via the public Overpass API. We originally scoped this on
the Chicago Data Portal's "Street Tree Inventory," but CDP doesn't
actually publish a comprehensive per-tree inventory (only 311 service
requests for trims/debris). OSM coverage is uneven — denser on the North
Side than on the South Side, mapper-dependent — but it's real per-tree
point data and matches the source pattern of `build_residential.py`.

Usage:
    python backend/scripts/build_tree_canopy.py

Why baked KDE, not raw points: at runtime we want a smooth density
overlay, not tens of thousands of point features. The grid bake compresses
to a sparse JSON artifact (<1 MB target) the runtime loads once.

Refresh cadence: yearly. OSM tree mapping is a slow-moving signal.

Output schema (sparse — sub-threshold cells are dropped):
    {
      "metadata": {
        "source":      "osm_natural_tree",
        "fetched_at":  "YYYY-MM-DDTHH:MM:SSZ",
        "cell_size_m": 50,
        "bandwidth_m": 75,
        "tree_count":  <int>,
        "cell_count":  <int>,
        "bbox":        [south, west, north, east]
      },
      "cells": [{ "lat": ..., "lon": ..., "density": 0.0-1.0 }, ...]
    }

The density value is max-normalized across the whole city, so values
near the dense North Side parkways trend toward 1.0 and OSM-sparse
South/Southwest blocks toward 0.0.
"""

from __future__ import annotations

import json
import logging
import math
import sys
import time
from pathlib import Path

import numpy as np
import requests
from scipy.ndimage import gaussian_filter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import (  # noqa: E402
    STREET_GRAPH_EAST,
    STREET_GRAPH_NORTH,
    STREET_GRAPH_SOUTH,
    STREET_GRAPH_WEST,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "Passage tree-canopy ingest (https://github.com/AdamBHonaker/Passage)"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "tree_canopy_kde.json"

CELL_SIZE_M = 50      # spec: ~50 m grid
BANDWIDTH_M = 75      # spec: 1.5 × cell size — calibration target during ingest
# Drop cells whose normalized density falls below this — the gaussian
# filter has a long tail that would otherwise carry tens of thousands of
# effectively-zero cells. 0.02 keeps a meaningful "light canopy" signal
# while shrinking the committed artifact by ~3-5×.
MIN_DENSITY_KEEP = 0.02

# Chicago is at ~41.8°N; 1° lon ≈ 82.6 km at this latitude. Use a single
# scale factor for the bbox — fine since the city spans < 0.5°.
_CHI_REF_LAT = 41.85
METERS_PER_DEG_LAT = 111_320.0
METERS_PER_DEG_LON = METERS_PER_DEG_LAT * math.cos(math.radians(_CHI_REF_LAT))

logger = logging.getLogger("build_tree_canopy")


def _bbox() -> str:
    return f"{STREET_GRAPH_SOUTH},{STREET_GRAPH_WEST},{STREET_GRAPH_NORTH},{STREET_GRAPH_EAST}"


def fetch() -> list[tuple[float, float]]:
    """Return `(lat, lon)` for every OSM `natural=tree` node inside the bbox.

    Overpass `out;` on a `node[natural=tree]` query returns each node as
    a row with top-level `lat`/`lon` floats (not the `geometry` wrapper
    used for ways).
    """
    bbox = _bbox()
    query = (
        "[out:json][timeout:180];\n"
        f"node[natural=tree]({bbox});\n"
        "out;\n"
    )
    logger.info("Posting Overpass query for natural=tree nodes ...")
    t0 = time.perf_counter()
    resp = requests.post(
        OVERPASS_URL,
        data={"data": query},
        headers={"User-Agent": USER_AGENT},
        timeout=300,
    )
    resp.raise_for_status()
    elements = resp.json().get("elements", [])
    coords: list[tuple[float, float]] = []
    for el in elements:
        try:
            lat = float(el["lat"])
            lon = float(el["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (STREET_GRAPH_SOUTH <= lat <= STREET_GRAPH_NORTH):
            continue
        if not (STREET_GRAPH_WEST <= lon <= STREET_GRAPH_EAST):
            continue
        coords.append((lat, lon))
    logger.info(
        "Overpass returned %d trees (kept %d in bbox) in %.1f s",
        len(elements), len(coords), time.perf_counter() - t0,
    )
    return coords


def _grid_dims() -> tuple[int, int, float, float]:
    """Return (n_rows, n_cols, cell_h_deg, cell_w_deg) for the bbox grid."""
    cell_h_deg = CELL_SIZE_M / METERS_PER_DEG_LAT          # latitude step
    cell_w_deg = CELL_SIZE_M / METERS_PER_DEG_LON          # longitude step
    n_rows = int(math.ceil((STREET_GRAPH_NORTH - STREET_GRAPH_SOUTH) / cell_h_deg))
    n_cols = int(math.ceil((STREET_GRAPH_EAST - STREET_GRAPH_WEST) / cell_w_deg))
    return n_rows, n_cols, cell_h_deg, cell_w_deg


def bake(coords: list[tuple[float, float]]) -> list[dict[str, float]]:
    """Bake the KDE grid and return sparse cell records.

    Approach:
      1. Build a 2D histogram of tree counts per 50 m cell.
      2. Smooth with a gaussian filter (sigma = bandwidth / cell_size).
         Equivalent to a gaussian-KDE evaluated on the grid — orders of
         magnitude faster than scipy.stats.gaussian_kde at this point
         count, with identical results within rounding.
      3. Max-normalize to 0-1.
      4. Emit cells whose density >= MIN_DENSITY_KEEP, recording the
         cell centroid so runtime queries can use a single point per cell.
    """
    n_rows, n_cols, cell_h_deg, cell_w_deg = _grid_dims()
    logger.info(
        "Grid: %d rows × %d cols (cell %.1f m, bandwidth %.1f m)",
        n_rows, n_cols, CELL_SIZE_M, BANDWIDTH_M,
    )

    counts = np.zeros((n_rows, n_cols), dtype=np.float32)
    for lat, lon in coords:
        r = int((lat - STREET_GRAPH_SOUTH) / cell_h_deg)
        c = int((lon - STREET_GRAPH_WEST) / cell_w_deg)
        # Edge points landing exactly on the north/east boundary clamp
        # to the last cell rather than spilling out of the array.
        if r == n_rows:
            r -= 1
        if c == n_cols:
            c -= 1
        if 0 <= r < n_rows and 0 <= c < n_cols:
            counts[r, c] += 1.0

    sigma = BANDWIDTH_M / CELL_SIZE_M
    density = gaussian_filter(counts, sigma=sigma, mode="constant")
    peak = float(density.max())
    if peak <= 0.0:
        logger.warning("No tree data produced any density signal — empty artifact")
        return []
    density /= peak

    keep_mask = density >= MIN_DENSITY_KEEP
    rs, cs = np.where(keep_mask)
    cells: list[dict[str, float]] = []
    for r, c in zip(rs.tolist(), cs.tolist()):
        lat = STREET_GRAPH_SOUTH + (r + 0.5) * cell_h_deg
        lon = STREET_GRAPH_WEST + (c + 0.5) * cell_w_deg
        cells.append({
            "lat":     round(lat, 5),
            "lon":     round(lon, 5),
            "density": round(float(density[r, c]), 3),
        })
    logger.info(
        "Kept %d / %d cells (%.1f%% above %.2f threshold)",
        len(cells), n_rows * n_cols,
        100.0 * len(cells) / (n_rows * n_cols), MIN_DENSITY_KEEP,
    )
    return cells


def main() -> int:
    t0 = time.perf_counter()
    coords = fetch()
    if not coords:
        logger.error("Overpass returned zero usable tree nodes — aborting without writing")
        return 1

    cells = bake(coords)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "metadata": {
                    "source":      "osm_natural_tree",
                    "fetched_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "cell_size_m": CELL_SIZE_M,
                    "bandwidth_m": BANDWIDTH_M,
                    "tree_count":  len(coords),
                    "cell_count":  len(cells),
                    "bbox": [
                        STREET_GRAPH_SOUTH, STREET_GRAPH_WEST,
                        STREET_GRAPH_NORTH, STREET_GRAPH_EAST,
                    ],
                },
                "cells": cells,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    logger.info(
        "Wrote %s (%d trees → %d cells, %.0f KB) in %.1f s",
        OUTPUT_PATH, len(coords), len(cells), size_kb,
        time.perf_counter() - t0,
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
