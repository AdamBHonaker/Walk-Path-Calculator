"""
Shared utility functions and geographic constants.
"""

import math
from typing import Any

_EARTH_RADIUS_MILES = 3958.8

_MILES_PER_DEG_LAT: float = 69.0
# Miles per degree of longitude at Chicago's latitude (~41.9°): 69.0 × cos(41.9°) ≈ 51.35
_MILES_PER_DEG_LON: float = 51.35


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in miles between two lat/lon points."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return _EARTH_RADIUS_MILES * 2 * math.asin(math.sqrt(a))


class SpatialGrid:
    """
    Generic cell-based spatial bucket index for lat/lon data.

    Divides the lat/lon plane into cells of cell_lat_deg × cell_lon_deg and
    supports O(cells in radius ring + results) radius queries.
    """

    def __init__(self, cell_lat_deg: float, cell_lon_deg: float) -> None:
        self._clat = cell_lat_deg
        self._clon = cell_lon_deg
        self._grid: dict[tuple[int, int], list[tuple[float, float, Any]]] = {}

    def _cell(self, lat: float, lon: float) -> tuple[int, int]:
        return (int(math.floor(lat / self._clat)), int(math.floor(lon / self._clon)))

    def add(self, lat: float, lon: float, value: Any) -> None:
        self._grid.setdefault(self._cell(lat, lon), []).append((lat, lon, value))

    def query(self, lat: float, lon: float, radius_miles: float) -> list[tuple[float, Any]]:
        dlat = radius_miles / _MILES_PER_DEG_LAT
        dlon = radius_miles / _MILES_PER_DEG_LON
        min_cl = int(math.floor((lat - dlat) / self._clat))
        max_cl = int(math.floor((lat + dlat) / self._clat))
        min_cn = int(math.floor((lon - dlon) / self._clon))
        max_cn = int(math.floor((lon + dlon) / self._clon))
        lat_lo, lat_hi = lat - dlat, lat + dlat
        lon_lo, lon_hi = lon - dlon, lon + dlon
        results: list[tuple[float, Any]] = []
        for cl in range(min_cl, max_cl + 1):
            for cn in range(min_cn, max_cn + 1):
                bucket = self._grid.get((cl, cn))
                if not bucket:
                    continue
                for e_lat, e_lon, value in bucket:
                    if e_lat < lat_lo or e_lat > lat_hi or e_lon < lon_lo or e_lon > lon_hi:
                        continue
                    d = haversine_miles(lat, lon, e_lat, e_lon)
                    if d <= radius_miles:
                        results.append((d, value))
        return results


# Chicago geographic bounds
CHICAGO_SOUTH: float = 41.64
CHICAGO_NORTH: float = 42.02
CHICAGO_WEST:  float = -87.94
CHICAGO_EAST:  float = -87.52

CHICAGO_BBOX_GOOGLE: str = f"{CHICAGO_SOUTH},{CHICAGO_WEST}|{CHICAGO_NORTH},{CHICAGO_EAST}"

# Street-graph coverage — full Chicago city limits + a small buffer
STREET_GRAPH_SOUTH: float = 41.6400
STREET_GRAPH_NORTH: float = 42.0830
STREET_GRAPH_WEST:  float = -87.9400
STREET_GRAPH_EAST:  float = -87.5200

# OSMnx bbox format: (west, south, east, north)
STREET_GRAPH_BBOX_OSMNX: tuple = (STREET_GRAPH_WEST, STREET_GRAPH_SOUTH, STREET_GRAPH_EAST, STREET_GRAPH_NORTH)
