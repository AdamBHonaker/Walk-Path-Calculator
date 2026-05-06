"""
Centroids for Chicago's 77 community areas.

This table powers the "Community area" origin mode of the Neighborhood
Explorer (FEAT #1) — the user picks an area from a dropdown and the
isochrone is anchored at that area's representative point.

Data source:
    City of Chicago — Boundaries — Community Areas (current).
    SODA: https://data.cityofchicago.org/resource/igwz-8jzy.json

Generation:
    Centroids are *representative points* (shapely .representative_point()),
    not geometric centroids — guaranteed to lie inside the polygon, which
    matters for irregular shapes (notably O'Hare). Computed once by
    `backend/scripts/build_community_area_centroids.py`. Re-run that script
    only if the City redraws boundaries; the 77 areas have been stable since
    1981.

Format:
    Keys are the city's official community-area names normalized to title
    case, with two punctuation-restorations applied by the generator
    (`O'Hare`, `McKinley Park`). Values are `(lat, lon)` tuples rounded to
    five decimal places (~1 m precision).
"""

from __future__ import annotations

COMMUNITY_AREA_CENTROIDS: dict[str, tuple[float, float]] = {
    "Albany Park":            (41.96853, -87.7243),
    "Archer Heights":         (41.81088, -87.7262),
    "Armour Square":          (41.84062, -87.63313),
    "Ashburn":                (41.74802, -87.70976),
    "Auburn Gresham":         (41.74339, -87.65608),
    "Austin":                 (41.89454, -87.75805),
    "Avalon Park":            (41.74683, -87.58846),
    "Avondale":               (41.93921, -87.70976),
    "Belmont Cragin":         (41.92642, -87.76611),
    "Beverly":                (41.71743, -87.67191),
    "Bridgeport":             (41.83659, -87.64966),
    "Brighton Park":          (41.81944, -87.69921),
    "Burnside":               (41.72946, -87.59673),
    "Calumet Heights":        (41.72975, -87.57308),
    "Chatham":                (41.73695, -87.61417),
    "Chicago Lawn":           (41.77193, -87.69575),
    "Clearing":               (41.77841, -87.76917),
    "Douglas":                (41.83472, -87.61714),
    "Dunning":                (41.94726, -87.80654),
    "East Garfield Park":     (41.87866, -87.70606),
    "East Side":              (41.70787, -87.53502),
    "Edgewater":              (41.98717, -87.66377),
    "Edison Park":            (42.00718, -87.814),
    "Englewood":              (41.77528, -87.64221),
    "Forest Glen":            (41.9917, -87.75166),
    "Fuller Park":            (41.80907, -87.63239),
    "Gage Park":              (41.79559, -87.6963),
    "Garfield Ridge":         (41.80337, -87.74549),
    "Grand Boulevard":        (41.81294, -87.61783),
    "Greater Grand Crossing": (41.76698, -87.62092),
    "Hegewisch":              (41.66822, -87.53566),
    "Hermosa":                (41.92602, -87.7351),
    "Humboldt Park":          (41.90092, -87.72395),
    "Hyde Park":              (41.79424, -87.59259),
    "Irving Park":            (41.95358, -87.71875),
    "Jefferson Park":         (41.98255, -87.77277),
    "Kenwood":                (41.80959, -87.59656),
    "Lake View":              (41.94699, -87.65749),
    "Lincoln Park":           (41.92192, -87.6486),
    "Lincoln Square":         (41.97603, -87.68959),
    "Logan Square":           (41.92481, -87.70117),
    "Loop":                   (41.87894, -87.6272),
    "Lower West Side":        (41.84758, -87.67147),
    "McKinley Park":          (41.83098, -87.67238),
    "Montclare":              (41.92782, -87.79847),
    "Morgan Park":             (41.68768, -87.66899),
    "Mount Greenwood":        (41.69686, -87.70825),
    "Near North Side":        (41.89904, -87.63411),
    "Near South Side":        (41.8566, -87.62155),
    "Near West Side":         (41.87339, -87.66349),
    "New City":               (41.80878, -87.65989),
    "North Center":           (41.94686, -87.68496),
    "North Lawndale":         (41.8583, -87.7139),
    "North Park":             (41.9846, -87.72287),
    "Norwood Park":           (41.98563, -87.80058),
    "O'Hare":                 (41.97313, -87.90468),
    "Oakland":                (41.82414, -87.60511),
    "Portage Park":           (41.95366, -87.76471),
    "Pullman":                (41.70397, -87.59839),
    "Riverdale":              (41.66547, -87.60527),
    "Rogers Park":            (42.0105, -87.67099),
    "Roseland":               (41.71201, -87.61938),
    "South Chicago":          (41.73901, -87.54894),
    "South Deering":          (41.69146, -87.57197),
    "South Lawndale":         (41.83796, -87.71323),
    "South Shore":            (41.76266, -87.5753),
    "Uptown":                 (41.96615, -87.65593),
    "Washington Heights":     (41.71591, -87.64727),
    "Washington Park":        (41.79113, -87.61731),
    "West Elsdon":            (41.79592, -87.72448),
    "West Englewood":         (41.77589, -87.66661),
    "West Garfield Park":     (41.87834, -87.73046),
    "West Lawn":              (41.76959, -87.72736),
    "West Pullman":           (41.67135, -87.63836),
    "West Ridge":             (42.00139, -87.69395),
    "West Town":              (41.90227, -87.68155),
    "Woodlawn":               (41.77614, -87.59507),
}


def community_area_names() -> list[str]:
    """Return the 77 area names in the dataset's natural (alphabetical) order."""
    return list(COMMUNITY_AREA_CENTROIDS.keys())


# Pre-computed lowercase view so `lookup_centroid` is O(1) instead of doing a
# 77-entry linear scan with per-entry `.lower()` allocation per request.
_LOWERCASE_INDEX: dict[str, tuple[float, float]] = {
    k.lower(): v for k, v in COMMUNITY_AREA_CENTROIDS.items()
}


def lookup_centroid(name: str) -> tuple[float, float] | None:
    """Case-insensitive lookup. Returns None if `name` isn't a community area."""
    if not name:
        return None
    return _LOWERCASE_INDEX.get(name.strip().lower())
