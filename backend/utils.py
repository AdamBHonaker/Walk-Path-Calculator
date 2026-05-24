"""
Shared utility functions and geographic constants.
"""

import math

_EARTH_RADIUS_MILES = 3958.8

WALKING_SPEED_MPH: float = 3.0

# Single source of truth for the meters-per-mile conversion factor used across
# the routing/explore/geocoding modules. Keeping the prior 1609.34 (vs. the
# more precise 1609.344) preserves byte-for-byte numeric output of every
# distance/area calculation that already exists.
METERS_PER_MILE: float = 1609.34

# TD-055 / B-39: longitude-projection scale at Chicago's reference latitude.
# Used by KDTree-backed nearest-neighbor lookups so a degree of longitude
# contributes the right amount of distance vs. a degree of latitude (at
# 41.85° N, 1° lon ≈ 0.74 × 1° lat in meters). Hoisted here from
# geocoding.py so any future consumer (multi-city pipelines, address-snap
# helpers) reads from one place instead of redefining it inline.
KDTREE_LON_SCALE: float = math.cos(math.radians(41.85))


def quantize_coord(lat: float, lon: float) -> tuple[int, int]:
    """Quantize a (lat, lon) pair to ~1 m precision for cache or dedupe keys.

    Five decimal places ≈ 1.1 m at Chicago latitude. Used everywhere we want
    coordinates that are "close enough" to share a cache entry — route caches,
    KDTree-snap caches, places dedupe, isochrone cache.
    """
    return (round(lat * 1e5), round(lon * 1e5))


def quantize_geojson(obj, decimals: int = 5):
    """Recursively round every float to `decimals` places.

    Applied at the /route and /explore response boundary so the lat/lon coords
    that dominate response byte count don't ship 15+ digits of float64 noise.
    Five decimals = ~1.1 m precision, well below what any map rendering will
    show. Already-rounded fields (total_miles, distance_miles, etc.) are
    untouched because their precision is below `decimals`.
    """
    if isinstance(obj, float):
        return round(obj, decimals)
    if isinstance(obj, dict):
        return {k: quantize_geojson(v, decimals) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [quantize_geojson(v, decimals) for v in obj]
    return obj


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

# Bias-bbox string in Google Geocoding API format ("SW|NE"). No longer used
# by runtime code (the LocationIQ cutover gave geocoding.py its own viewbox
# constant). Retained for `backend/scripts/verify_neighborhood_coords.py`,
# which is intentionally still pointed at Google as an independent
# cross-source for landmark verification. Safe to remove if that script
# ever migrates off Google.
CHICAGO_BBOX_GOOGLE: str = f"{CHICAGO_SOUTH},{CHICAGO_WEST}|{CHICAGO_NORTH},{CHICAGO_EAST}"


def chicago_bbox_contains(lat: float, lon: float) -> bool:
    """Return True if (lat, lon) is inside Chicago's bounding box."""
    return CHICAGO_SOUTH <= lat <= CHICAGO_NORTH and CHICAGO_WEST <= lon <= CHICAGO_EAST

# OSM highway tags for service/alley edges that are technically walkable but
# not desirable for pedestrian routing (driveways, parking lot lanes, etc.).
# Single source of truth — imported by walking.py (runtime filter) and
# fetch_street_graph.py (graph-build filter) to keep them in sync.
SERVICE_HIGHWAY_TYPES: frozenset[str] = frozenset({"service", "alley"})

# Street-graph coverage — full Chicago city limits (77 community areas).
# Mirrors the CHICAGO_* bbox above so every community-area centroid in
# `community_areas.COMMUNITY_AREA_CENTROIDS` is inside the loaded graph.
# Re-run `fetch_street_graph.py --force` whenever these values change.
STREET_GRAPH_SOUTH: float = CHICAGO_SOUTH
STREET_GRAPH_NORTH: float = CHICAGO_NORTH
STREET_GRAPH_WEST:  float = CHICAGO_WEST
STREET_GRAPH_EAST:  float = CHICAGO_EAST

# OSMnx bbox format: (west, south, east, north)
STREET_GRAPH_BBOX_OSMNX: tuple = (STREET_GRAPH_WEST, STREET_GRAPH_SOUTH, STREET_GRAPH_EAST, STREET_GRAPH_NORTH)
