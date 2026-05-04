"""
Shared utility functions and geographic constants.
"""

import math

_EARTH_RADIUS_MILES = 3958.8

WALKING_SPEED_MPH: float = 3.0


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in miles between two lat/lon points."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return _EARTH_RADIUS_MILES * 2 * math.asin(min(1.0, math.sqrt(a)))


# Chicago geographic bounds
CHICAGO_SOUTH: float = 41.64
CHICAGO_NORTH: float = 42.02
CHICAGO_WEST:  float = -87.94
CHICAGO_EAST:  float = -87.52

CHICAGO_BBOX_GOOGLE: str = f"{CHICAGO_SOUTH},{CHICAGO_WEST}|{CHICAGO_NORTH},{CHICAGO_EAST}"

# Street-graph coverage — 77 community areas (Chicago city limits only)
STREET_GRAPH_SOUTH: float = 41.8560
STREET_GRAPH_NORTH: float = 42.0230
STREET_GRAPH_WEST:  float = -87.8680
STREET_GRAPH_EAST:  float = -87.5240

# OSMnx bbox format: (west, south, east, north)
STREET_GRAPH_BBOX_OSMNX: tuple = (STREET_GRAPH_WEST, STREET_GRAPH_SOUTH, STREET_GRAPH_EAST, STREET_GRAPH_NORTH)
