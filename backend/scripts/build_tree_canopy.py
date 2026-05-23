"""
One-time generator for backend/data/tree_canopy_kde.json — a sparse
50 m grid of Chicago tree canopy fraction, sampled from the NLCD Tree
Canopy Cover (TCC) 2021 CONUS raster.

Source: MRLC GeoServer WCS endpoint for `nlcd_tcc_conus_2021_v2021-4`,
the NLCD-companion product the USFS publishes alongside each NLCD
release. Native resolution is 30 m. We fetch the bbox in
`CHUNK_COUNT` longitudinal slices (the full Chicago bbox in one shot
trips a silent truncation bug on the MRLC server that zeroes out
everything east of about -87.65) and block-average each chunk onto
our 100 m output grid.

This replaced an earlier OSM `natural=tree` Overpass + gaussian-KDE bake
(see RESOLVED_HISTORY.md "TD-033"). The OSM version produced an honest
"where have OSM mappers been" signal but mapper bias clustered ~30k
points into Grant/Millennium Park and left dense residential
neighborhoods reading sparse. NLCD TCC is uniform raster coverage,
so Lincoln Park / Pullman / Beverly read true and downtown reads bare.

Why MRLC WCS rather than the USFS RDW ImageServer: the USFS service at
imagery.geoplatform.gov returns symbology-stretched output from its
`/exportImage` endpoint (the raw 0-100 values are only reachable via
per-point `/identify` — ~1.5 M HTTP calls for Chicago at 50 m, infeasible).
MRLC's WCS GetCoverage returns the raw single-band U8 GeoTIFF in one call.

Why baked sparse cells, not the raw raster: the runtime (`tree_canopy.py`)
hasn't changed — it consumes `{lat, lon, density}` records to drive its
three-band overlay. Density is now raw canopy fraction (0-1, where 0.40
means 40% canopy), not the previous max-normalized OSM count.

Usage:
    python backend/scripts/build_tree_canopy.py

Refresh cadence: every few years. NLCD TCC is a slow-moving product;
v2021-4 is the latest CONUS release as of 2026-05.

Output schema (sparse — sub-threshold cells are dropped):
    {
      "metadata": {
        "source":      "nlcd_tcc_conus_2021",
        "fetched_at":  "YYYY-MM-DDTHH:MM:SSZ",
        "cell_size_m": 50,
        "cell_count":  <int>,
        "bbox":        [south, west, north, east]
      },
      "cells": [{ "lat": ..., "lon": ..., "density": 0.0-1.0 }, ...]
    }
"""

from __future__ import annotations

import io
import json
import logging
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import (  # noqa: E402
    STREET_GRAPH_EAST,
    STREET_GRAPH_NORTH,
    STREET_GRAPH_SOUTH,
    STREET_GRAPH_WEST,
)

WCS_URL = "https://www.mrlc.gov/geoserver/wcs"
COVERAGE_ID = "mrlc_download__nlcd_tcc_conus_2021_v2021-4"
USER_AGENT = "Passage tree-canopy ingest (https://github.com/AdamBHonaker/Passage)"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "tree_canopy_kde.json"

# The OSM-era bake used a 50 m grid because mapper bias made most of the
# city sub-threshold (~30k cells / 519 KB). NLCD's signal is uniform
# real-world canopy, so a 50 m grid landed at 10.8 MB / 229k cells —
# 20× the previous size. 100 m keeps the heatmap's visual fidelity
# (cells are unioned into a MultiPolygon at runtime, so a 50/100 m
# difference is imperceptible after union at typical zoom) while
# bringing the artifact back to ~2.7 MB and 4×-ing STRtree memory.
CELL_SIZE_M = 100
# Drop cells whose canopy fraction is below this. Runtime's lowest band
# is 0.05 (5% canopy), so any cell beneath that is invisible — keeping
# it would only bloat the artifact and the STRtree.
MIN_DENSITY_KEEP = 0.05

# NLCD TCC pixel encoding: 0-100 = canopy percent, 254 = non-processing
# area, 255 = background (water / outside CONUS).
TCC_MAX_VALID = 100
TCC_NODATA_VALUES = (254, 255)

_CHI_REF_LAT = 41.85
METERS_PER_DEG_LAT = 111_320.0
METERS_PER_DEG_LON = METERS_PER_DEG_LAT * math.cos(math.radians(_CHI_REF_LAT))

logger = logging.getLogger("build_tree_canopy")


def _grid_dims() -> tuple[int, int, float, float]:
    """Return (n_rows, n_cols, cell_h_deg, cell_w_deg) for the bbox grid."""
    cell_h_deg = CELL_SIZE_M / METERS_PER_DEG_LAT
    cell_w_deg = CELL_SIZE_M / METERS_PER_DEG_LON
    n_rows = int(math.ceil((STREET_GRAPH_NORTH - STREET_GRAPH_SOUTH) / cell_h_deg))
    n_cols = int(math.ceil((STREET_GRAPH_EAST - STREET_GRAPH_WEST) / cell_w_deg))
    return n_rows, n_cols, cell_h_deg, cell_w_deg


# MRLC's GeoServer silently returns zero-canopy beyond ~0.30° east-west
# when the full Chicago bbox is requested at native 30 m resolution
# (everything east of about -87.65 reads as 0). Splitting the request
# into multiple sub-bboxes works around the issue; each sub-bbox stays
# well under that threshold. We do a simple longitudinal split into
# `CHUNK_COUNT` slices and accumulate per-cell sums + counts directly
# into the output grid, so the sub-rasters never have to be stitched.
CHUNK_COUNT = 3


def _fetch_chunk(lon_w: float, lon_e: float) -> tuple[np.ndarray, float, float]:
    """Fetch one longitudinal slice of NLCD TCC at native resolution.

    Returns `(arr, pixel_w_deg, pixel_h_deg)`. `arr` is U8 with row 0 at
    the NORTH edge of the requested bbox (WCS image convention).
    """
    params = [
        ("service", "WCS"),
        ("version", "2.0.1"),
        ("request", "GetCoverage"),
        ("coverageId", COVERAGE_ID),
        ("subset", f"Long({lon_w},{lon_e})"),
        ("subset", f"Lat({STREET_GRAPH_SOUTH},{STREET_GRAPH_NORTH})"),
        ("subsettingCRS", "http://www.opengis.net/def/crs/EPSG/0/4326"),
        ("outputCRS",     "http://www.opengis.net/def/crs/EPSG/0/4326"),
        ("format", "image/geotiff"),
    ]
    resp = requests.get(
        WCS_URL,
        params=params,
        headers={"User-Agent": USER_AGENT, "Accept": "image/geotiff,*/*"},
        timeout=600,
    )
    resp.raise_for_status()
    if not resp.content or not resp.content.startswith((b"II", b"MM")):
        raise RuntimeError(
            f"MRLC WCS did not return a TIFF for Long({lon_w},{lon_e}) "
            f"(status {resp.status_code}, content-type "
            f"{resp.headers.get('content-type')}, first 200 bytes: "
            f"{resp.content[:200]!r})"
        )

    img = Image.open(io.BytesIO(resp.content))
    arr = np.asarray(img, dtype=np.uint8)
    if arr.ndim != 2:
        raise RuntimeError(f"Unexpected TIFF shape {arr.shape}; expected single-band")
    n_rows, n_cols = arr.shape
    pixel_h_deg = (STREET_GRAPH_NORTH - STREET_GRAPH_SOUTH) / n_rows
    pixel_w_deg = (lon_e - lon_w) / n_cols
    return arr, pixel_w_deg, pixel_h_deg


def _accumulate(
    native: np.ndarray,
    lon_w: float,
    pixel_w_deg: float,
    pixel_h_deg: float,
    sum_flat: np.ndarray,
    cnt_flat: np.ndarray,
    n_rows: int,
    n_cols: int,
    cell_h_deg: float,
    cell_w_deg: float,
) -> None:
    """Map native pixels in one chunk into the shared output grid bins."""
    n_native_rows, n_native_cols = native.shape
    native_lat_centers = STREET_GRAPH_NORTH - (np.arange(n_native_rows) + 0.5) * pixel_h_deg
    native_lon_centers = lon_w + (np.arange(n_native_cols) + 0.5) * pixel_w_deg

    r_out = ((native_lat_centers - STREET_GRAPH_SOUTH) / cell_h_deg).astype(np.int32)
    c_out = ((native_lon_centers - STREET_GRAPH_WEST)  / cell_w_deg).astype(np.int32)
    r_out = np.clip(r_out, 0, n_rows - 1)
    c_out = np.clip(c_out, 0, n_cols - 1)

    flat_idx = r_out[:, None] * n_cols + c_out[None, :]
    valid = native <= TCC_MAX_VALID
    fiv = flat_idx[valid]
    vv = native[valid].astype(np.float32)
    sum_flat += np.bincount(fiv, weights=vv, minlength=sum_flat.size)
    cnt_flat += np.bincount(fiv,                minlength=cnt_flat.size)


def fetch_and_bake() -> list[dict[str, float]]:
    """Fetch NLCD TCC in longitudinal chunks and bake onto the output grid.

    Each chunk contributes its native pixels to the same per-cell sum +
    count accumulators, so the chunk boundaries don't introduce seams.
    """
    n_rows, n_cols, cell_h_deg, cell_w_deg = _grid_dims()
    sum_flat = np.zeros(n_rows * n_cols, dtype=np.float64)
    cnt_flat = np.zeros(n_rows * n_cols, dtype=np.int64)

    chunk_edges = np.linspace(STREET_GRAPH_WEST, STREET_GRAPH_EAST, CHUNK_COUNT + 1)
    total_bytes = 0
    t0 = time.perf_counter()
    # OPT-052: fetch all three longitudinal chunks in parallel — they're I/O
    # bound against MRLC's WCS endpoint, and parallelism cuts the fetch step
    # from ~3× the slowest chunk to ~1× the slowest. Accumulation stays
    # sequential because `_accumulate` writes to shared sum_flat/cnt_flat
    # arrays with `+=`, which is not atomic across threads even when the
    # underlying numpy ops release the GIL.
    chunk_bounds = [
        (float(chunk_edges[i]), float(chunk_edges[i + 1]))
        for i in range(CHUNK_COUNT)
    ]
    with ThreadPoolExecutor(max_workers=CHUNK_COUNT) as pool:
        futures = [
            pool.submit(_fetch_chunk, lon_w, lon_e)
            for lon_w, lon_e in chunk_bounds
        ]
        results = [f.result() for f in futures]

    for i, ((lon_w, lon_e), (native, pixel_w_deg, pixel_h_deg)) in enumerate(
        zip(chunk_bounds, results)
    ):
        chunk_bytes = native.size  # rough proxy for transfer size after decode
        total_bytes += chunk_bytes
        logger.info(
            "Chunk %d/%d: Long(%.4f, %.4f) → %d × %d (~%.0fm × %.0fm)",
            i + 1, CHUNK_COUNT, lon_w, lon_e, native.shape[1], native.shape[0],
            pixel_w_deg * METERS_PER_DEG_LON, pixel_h_deg * METERS_PER_DEG_LAT,
        )
        _accumulate(
            native, lon_w, pixel_w_deg, pixel_h_deg,
            sum_flat, cnt_flat, n_rows, n_cols, cell_h_deg, cell_w_deg,
        )

    with np.errstate(divide="ignore", invalid="ignore"):
        density_pct = np.where(cnt_flat > 0, sum_flat / np.maximum(cnt_flat, 1), 0.0)
    density = (density_pct / 100.0).reshape(n_rows, n_cols).astype(np.float32)

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
        "Grid: %d × %d, kept %d cells (%.1f%% >= %.2f canopy fraction) in %.1f s",
        n_rows, n_cols, len(cells),
        100.0 * len(cells) / (n_rows * n_cols), MIN_DENSITY_KEEP,
        time.perf_counter() - t0,
    )
    return cells


def main() -> int:
    t0 = time.perf_counter()
    cells = fetch_and_bake()
    if not cells:
        logger.error("No cells passed the threshold — aborting without writing")
        return 1

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "metadata": {
                    "source":      "nlcd_tcc_conus_2021",
                    "fetched_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "cell_size_m": CELL_SIZE_M,
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
        "Wrote %s (%d cells, %.0f KB) in %.1f s",
        OUTPUT_PATH, len(cells), size_kb,
        time.perf_counter() - t0,
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    raise SystemExit(main())
