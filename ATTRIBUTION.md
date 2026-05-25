# Attribution

Passage is MIT-licensed (see [`LICENSE`](LICENSE)) but is built on data and
software from several upstream sources that carry their own license
obligations. This file documents each one and the form of attribution
Passage owes.

If you fork, redistribute, or deploy Passage you inherit the obligations
below — particularly the OpenStreetMap ODbL share-alike requirement on the
data artifacts in `backend/data/` that are derived from OSM.

---

## Data

### OpenStreetMap (OSM)

**License:** [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
**Attribution required:** "© OpenStreetMap contributors" with a link to
<https://www.openstreetmap.org/copyright>.

Derived artifacts in this repository:

- `backend/street_graph_igraph.pkl` and the upstream `street_graph.graphml`
  — built from OSMnx queries against OSM (`backend/fetch_street_graph.py`).
- `backend/data/places_osm.json` — OSM POIs harvested via Overpass
  (`backend/scripts/build_places_osm.py`).
- `backend/data/residential_polygons.json` — OSM `landuse=residential`
  polygons (`backend/scripts/build_residential.py`).
- `backend/data/green_space_polygons.json` — OSM `landuse=cemetery`,
  `leisure=golf_course`, `leisure=nature_reserve`, `landuse=recreation_ground`
  (`backend/scripts/build_green_space.py`).
- `backend/data/chicago_boundary.json` — OSM administrative boundary
  (`backend/scripts/build_chicago_boundary.py`).
- `backend/data/chicago_geocode.db` (`addresses`, `intersections` tables)
  — OSM address points + street network intersections
  (`backend/scripts/build_address_points.py`,
  `backend/scripts/build_intersections.py`).

Any redistribution of these artifacts, or of substantial derivative works,
must remain ODbL-licensed and credit OpenStreetMap contributors.

### NLCD Tree Canopy Cover 2021

**Source:** USFS / MRLC (Multi-Resolution Land Characteristics consortium),
GeoServer WCS coverage `mrlc_download__nlcd_tcc_conus_2021_v2021-4`.
**License:** US Government work; public domain in the United States.
**Suggested citation:** "USDA Forest Service, NLCD Tree Canopy Cover 2021
(CONUS), via MRLC."

Derived artifact:

- `backend/data/tree_canopy_kde.json` — 100 m output grid block-averaged
  from the 30 m native NLCD raster (`backend/scripts/build_tree_canopy.py`).

### Chicago Data Portal (CDP)

**Source:** <https://data.cityofchicago.org/>
**License:** Per the [City of Chicago Terms of Use](https://www.cityofchicago.org/city/en/narr/foia/data_disclaimer.html);
attribution to "City of Chicago" is requested.

Derived artifacts (all in `backend/data/places_curated.json`, each tagged
with its `_source` key on the records):

- CPL library locations (`cpl_locations`) — `build_libraries.py`
- 2013 City of Chicago farmers markets (`farmers_markets_2013`) —
  `build_farmers_markets.py`
- CPS school locations (`cps_schools`) — `build_schools_cps.py`
- CPD police stations (`cpd_stations`) — `build_police_stations.py`
- CFD fire stations (`cfd_stations`) — `build_fire_stations.py`
- Divvy bike-share stations (`cdp_divvy`) — `build_divvy.py`
- Commission on Chicago Landmarks (`cdp_landmarks`) — `build_landmarks.py`
- CPD park boundaries → `backend/data/parks_polygons.json`
  (dataset `ejsh-fztr.geojson`) — `build_parks.py`

### LocationIQ

**Source:** <https://locationiq.com/>
**License:** Per the [LocationIQ Terms of Service](https://locationiq.com/legal/terms).
The free tier permits caching of geocoding results; Passage caches positive
and negative responses into the SQLite tables `cached_forward` /
`cached_reverse` in `backend/data/chicago_geocode.db`.

Runtime use: forward + reverse geocoding fallback after the local-first
cascade misses (`backend/geocoding.py`). Attribution is shown to end users
in the UI when a result is sourced from LocationIQ.

---

## Software

### MapLibre GL JS

**License:** BSD-3-Clause. See `frontend/node_modules/maplibre-gl/LICENSE.txt`
in any installed copy for the full text. Includes original Mapbox GL JS
copyrights (BSD-3-Clause) where retained.

### Other npm + PyPI dependencies

Bundled `node_modules/*/LICENSE` and the installed Python distributions
under `backend/.venv/Lib/site-packages/*/LICENSE` retain their original
licenses. The dependency lockfiles (`frontend/package-lock.json`,
`backend/requirements.txt`) are the authoritative source for what is
bundled at any given commit.

### Fonts (self-hosted under `frontend/public/fonts/`)

- **Fraunces** — Open Font License 1.1 (designer: Phaedra Charles & David
  Jonathan Ross). <https://fonts.google.com/specimen/Fraunces>
- **Inter** — Open Font License 1.1 (designer: Rasmus Andersson).
  <https://rsms.me/inter/>
- **JetBrains Mono** — Open Font License 1.1 (designer: JetBrains).
  <https://www.jetbrains.com/lp/mono/>

OFL permits embedding, redistribution, and modification with attribution
retained in the bundled font files.

---

## Updates

When a new upstream data source is ingested (new CDP dataset, new OSM tag
query, new vendor API), add a section here in the same shape and link the
ingest script. The repo's audit process treats undocumented sources as
drift to be paid down in the next documentation pass.
