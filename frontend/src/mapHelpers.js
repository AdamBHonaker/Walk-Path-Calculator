// Wayfarer palette: ink for the route line, ember for the active turn.
// Kept in sync with src/wayfarer/tokens.css so MapLibre paint values match
// the rest of the design system. The share card overrides via the
// `routeColor` parameter on renderWalkRoute().
export const WALK_PATH_COLOR  = "#171310"; // var(--ink)
export const TURN_COLOR_ACTIVE = "#9c2a1a"; // var(--ember)

// Alternating segment opacity expression: odd-indexed segments render at 55%
// opacity, even at 100%. Creates subtle perceptual breaks between direction
// steps without colour changes. Applied to walk-segments-line after animation
// completes via setPaintProperty (hidden at 0 during draw-in).
export const SEG_ALT_OPACITY_EXPR = ["case", ["==", ["%", ["get", "segmentIndex"], 2], 1], 0.55, 1.0];

// Shared map defaults — used by both MapView and RouteCard so the two
// renderings can never drift on tile provider or default framing.
export const MAP_STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";
export const DEFAULT_MAP_CENTER = [-87.654, 41.966]; // Uptown, Chicago
export const DEFAULT_MAP_ZOOM   = 13;

// OPT-042: editorial map tint via a MapLibre `background` layer rather
// than the prior CSS `filter: sepia(...) saturate(...) brightness(...)`
// on `.maplibregl-canvas`. The CSS filter forced the browser to apply
// the matrix to the entire WebGL canvas on EVERY composite (pan/zoom
// dragged the filter through the GPU each frame). A background layer is
// part of the map's own paint pipeline — it composites once per frame
// alongside the rest of the layers, with no extra surface allocation.
//
// The tint layer is inserted ABOVE the OpenFreeMap Liberty base layers
// (water, land, buildings, roads, labels) but BELOW the route + explore
// overlays added by MapRouteLayer / MapExploreLayer. The visual contract
// shifts slightly vs. the CSS filter — route lines and explore polygons
// now show in their true Wayfarer colors (more pop, less unified tone).
// Tune the values via real-device side-by-side review (see PV-014).
export const MAP_TINT_LAYER_ID = "passage-map-tint";
export const MAP_TINT = {
  cream: { color: "#8B6F47", opacity: 0.12 }, // warm sepia wash
  dusk:  { color: "#0a0807", opacity: 0.45 }, // dark warm overlay
};

// Returns the active tint object based on the document root theme class.
// SSR-safe: returns the Cream variant when document is unavailable.
export function getActiveMapTint() {
  if (typeof document === "undefined" || !document.documentElement) {
    return MAP_TINT.cream;
  }
  return document.documentElement.classList.contains("theme-dusk")
    ? MAP_TINT.dusk
    : MAP_TINT.cream;
}

// Backend returns [lat, lon]; GeoJSON / MapLibre expects [lon, lat].
export const toGeo = ([lat, lon]) => [lon, lat];

export function haversineMeters([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const dφ = (lat2 - lat1) * Math.PI / 180;
  const dλ = (lon2 - lon1) * Math.PI / 180;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 5 m dedup threshold: at Chicago latitude (~41.9°) this is well within the
// equirectangular approximation's accuracy. We compare squared meters to skip
// the trig + sqrt of a full Haversine call per turn pair.
const _DEDUP_METERS_SQ = 25;
// Equirectangular approximation: meters per degree of latitude. WGS84's
// geodetic latitude varies the meridional radius from ~110.6 km at the
// equator to ~111.7 km at the poles; 111320 m is the canonical "round
// midpoint" value used by most map-tile pipelines. At Chicago's latitude
// (~41.9°) the meridional radius is ~111.04 km, so the error is < 0.3 %
// — well below the dedup threshold (5 m at 5-m radius = 0.025 % error).
const _METERS_PER_DEG_LAT = 111320;

// Linearly interpolate between path[pi] and path[pi+1] at fraction t.
// Returns the raw path point when t is at the boundary (avoids index overrun).
function _interp(path, pi, t) {
  if (t <= 0) return path[pi];
  if (t >= 1 || pi + 1 >= path.length) return path[Math.min(pi + 1, path.length - 1)];
  const a = path[pi];
  const b = path[pi + 1];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

// Map each direction step to the path vertex + interpolation fraction {pi, t}
// where that step begins. Mirrors useTurnCoords but returns raw {pi,t} pairs
// instead of interpolated [lat,lon] coords.
function _buildTurnPathInfo(path, directions) {
  const N = directions.length;
  if (N === 0 || path.length < 2) return [];

  const cumDist = [0];
  for (let i = 1; i < path.length; i++) {
    cumDist[i] = cumDist[i - 1] + haversineMeters(path[i - 1], path[i]);
  }

  let pi = 0;
  let running = 0;
  const result = [];
  for (let i = 0; i < N; i++) {
    const target = running;
    // Advance pi until the target falls within [cumDist[pi], cumDist[pi+1]).
    // The <= check means a turn that lands exactly on a vertex is attributed
    // to the *next* segment (t=0), matching useTurnCoords behaviour.
    while (pi + 1 < path.length - 1 && cumDist[pi + 1] <= target) pi++;
    const segLen = cumDist[pi + 1] - cumDist[pi];
    const t = segLen <= 0 ? 0 : Math.min(1, (target - cumDist[pi]) / segLen);
    result.push({ pi, t });
    running += directions[i].distance_meters ?? 0;
  }
  return result;
}

// Build a GeoJSON FeatureCollection of N per-step LineString segments from
// the route path + direction array. Each feature carries `segmentIndex` (0-based)
// for the alternating-opacity data expression, and `id: i` so setFeatureState
// can address it directly. All N segments are always emitted — no dedup.
export function buildRouteSegments(path, directions) {
  if (!directions?.length || !path?.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const turnInfos = _buildTurnPathInfo(path, directions);
  const N = turnInfos.length;
  const features = [];

  for (let i = 0; i < N; i++) {
    const { pi: startPi, t: startT } = turnInfos[i];
    const coords = [];

    coords.push(toGeo(_interp(path, startPi, startT)));

    if (i === N - 1) {
      // Last segment: include intermediate verts up to (but not including)
      // the final point, then anchor directly to path[last] — avoids the
      // index-overrun that would occur if we tried to interpolate at t=1
      // beyond the last vertex.
      for (let k = startPi + 1; k < path.length - 1; k++) {
        coords.push(toGeo(path[k]));
      }
      coords.push(toGeo(path[path.length - 1]));
    } else {
      const { pi: endPi, t: endT } = turnInfos[i + 1];
      for (let k = startPi + 1; k <= endPi; k++) {
        coords.push(toGeo(path[k]));
      }
      coords.push(toGeo(_interp(path, endPi, endT)));
    }

    // GeoJSON LineString requires ≥ 2 points; guard against degenerate turns.
    if (coords.length < 2) coords.push(coords[0]);

    features.push({
      type: "Feature",
      id: i,
      properties: { segmentIndex: i },
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  return { type: "FeatureCollection", features };
}

// Build the GeoJSON FeatureCollection for the turn-point source. The active
// flag is no longer baked into properties — the paint expression reads
// `feature-state.active` so the active-turn flip is a property bump on the
// existing tile data via `setFeatureState`, not a full source re-upload.
// Each feature carries `id = i` (the original turnCoords index) so callers
// can address them with setFeatureState({source, id}, {active: true}).
export function buildTurnsGeoJson(turnCoords) {
  const features = [];
  let prevCoord = null;
  for (let i = 0; i < turnCoords.length; i++) {
    const coord = turnCoords[i];
    if (!coord) continue;
    if (prevCoord) {
      const cosLat = Math.cos(prevCoord[0] * Math.PI / 180);
      const dy = (coord[0] - prevCoord[0]) * _METERS_PER_DEG_LAT;
      const dx = (coord[1] - prevCoord[1]) * _METERS_PER_DEG_LAT * cosLat;
      if (dx * dx + dy * dy < _DEDUP_METERS_SQ) continue;
    }
    prevCoord = coord;
    features.push({
      type: "Feature",
      id: i,
      properties: { index: i },
      geometry: { type: "Point", coordinates: toGeo(coord) },
    });
  }
  return { type: "FeatureCollection", features };
}

export function clearLayers(map, layerIds, sourceIds) {
  for (const id of layerIds.splice(0)) {
    try { map.removeLayer(id); } catch { /* already gone */ }
  }
  for (const id of sourceIds.splice(0)) {
    try { map.removeSource(id); } catch { /* already gone */ }
  }
}

function trackSource(map, id, data, sourceIds) {
  map.addSource(id, data);
  sourceIds.push(id);
}

function trackLayer(map, cfg, layerIds) {
  map.addLayer(cfg);
  layerIds.push(cfg.id);
}

// Upsert a GeoJSON source: if it already exists, update its data via setData;
// otherwise create and track it. Lets repeat renders reuse the GPU buffer
// instead of tearing the source down and rebuilding it from scratch.
function upsertGeoSource(map, id, data, sourceIds) {
  const existing = map.getSource?.(id);
  if (existing && typeof existing.setData === "function") {
    existing.setData(data);
    if (!sourceIds.includes(id)) sourceIds.push(id);
    return;
  }
  trackSource(map, id, { type: "geojson", data }, sourceIds);
}

function ensureLayer(map, cfg, layerIds) {
  if (map.getLayer?.(cfg.id)) {
    if (!layerIds.includes(cfg.id)) layerIds.push(cfg.id);
    return;
  }
  trackLayer(map, cfg, layerIds);
}

// Drop a source (and its dependent layer ids) if it was previously tracked.
// Used when a previous render created e.g. walk-stops for a multi-stop route
// and the new render is 2-stop, so the leftover source must be cleaned up.
function dropTracked(map, ids, sourceIds, layerIds) {
  for (const id of ids) {
    const layerIdx = layerIds.indexOf(id);
    if (layerIdx >= 0) {
      try { map.removeLayer(id); } catch { /* already gone */ }
      layerIds.splice(layerIdx, 1);
    }
    const sourceIdx = sourceIds.indexOf(id);
    if (sourceIdx >= 0) {
      try { map.removeSource(id); } catch { /* already gone */ }
      sourceIds.splice(sourceIdx, 1);
    }
  }
}

// `activeTurnIndex` is no longer consumed by the source build — it's applied
// via setFeatureState in `applyActiveTurnFeatureState` below. The parameter
// remains in the signature for backward compatibility with test fixtures.
//
// `precomputedSegments` is an optional GeoJSON FeatureCollection produced by
// `buildRouteSegments` upstream (memoized in MapRouteLayer); when supplied,
// the per-edge segment FeatureCollection isn't rebuilt here, sparing the
// `_buildTurnPathInfo` cum-distance walk on flavor swaps that keep the path
// identical.
export function renderWalkRoute(map, result, turnCoords, _activeTurnIndex, layerIds, sourceIds, fitPadding = 60, routeColor = WALK_PATH_COLOR, drawEndpointDots = true, precomputedSegments = null) {
  if (!result?.path?.length) return;

  const { path, origin_coords, dest_coords, directions } = result;

  const geoPath = [];
  let minLon = Infinity, minLat = Infinity;
  let maxLon = -Infinity, maxLat = -Infinity;
  for (let i = 0; i < path.length; i++) {
    const lat = path[i][0];
    const lon = path[i][1];
    geoPath.push([lon, lat]);
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  const bounds = [[minLon, minLat], [maxLon, maxLat]];

  // ── Per-step segment layers (below the scrim) ────────────────────────
  // walk-segment-casing: blurred ember glow revealed via feature-state on
  // the active direction step. walk-segments-line: alternating-opacity copy
  // of the route line, hidden during draw-in animation and swapped in after.
  if (directions?.length) {
    // Clear stale feature state BEFORE the new setData. If the prior route
    // had more turns than the new one, leaving the high-IDs' state set in
    // MapLibre's internal feature-state map orphans them: setData rebinds
    // ids in the source but does not reset state for ids that no longer
    // exist in the data. Clearing before setData prevents the dict from
    // growing monotonically across route swaps.
    if (map.getSource?.("walk-segments")) {
      try { map.removeFeatureState?.({ source: "walk-segments" }); }
      catch { /* source torn down between checks */ }
    }
    const segments = precomputedSegments || buildRouteSegments(path, directions);
    upsertGeoSource(map, "walk-segments", segments, sourceIds);
    ensureLayer(map, {
      id: "walk-segment-casing", type: "line", source: "walk-segments",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": TURN_COLOR_ACTIVE,
        "line-width": 9,
        "line-blur": 2,
        "line-opacity": ["case", ["coalesce", ["feature-state", "active"], false], 0.85, 0],
      },
    }, layerIds);
    ensureLayer(map, {
      id: "walk-segments-line", type: "line", source: "walk-segments",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": routeColor,
        "line-width": 4,
        "line-opacity": 0,  // revealed post-animation via setPaintProperty
      },
    }, layerIds);
  } else {
    dropTracked(map, ["walk-segments-line", "walk-segment-casing", "walk-segments"], sourceIds, layerIds);
  }

  upsertGeoSource(
    map, "walk-path",
    { type: "Feature", geometry: { type: "LineString", coordinates: geoPath } },
    sourceIds,
  );
  ensureLayer(map, {
    id: "walk-path-line", type: "line", source: "walk-path",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": routeColor, "line-width": 4 },
  }, layerIds);

  if (turnCoords?.length) {
    // Clear stale feature state BEFORE setData. setData retains states
    // keyed by feature id, so stale ids past the new feature count would
    // accumulate over many flavor / route swaps and a stale active=true
    // on a still-present id would silently bleed across swaps. Clearing
    // ahead of the upsert addresses both.
    if (map.getSource?.("walk-turns")) {
      try { map.removeFeatureState?.({ source: "walk-turns" }); }
      catch { /* source torn down between checks */ }
    }
    upsertGeoSource(
      map, "walk-turns",
      buildTurnsGeoJson(turnCoords),
      sourceIds,
    );
    ensureLayer(map, {
      id: "walk-turns-circle", type: "circle", source: "walk-turns",
      paint: {
        // Bumped from 5/8 → 11/13 to host 1–2 digit step numbers.
        "circle-radius":       ["case", ["coalesce", ["feature-state", "active"], false], 13, 11],
        "circle-color":        ["case", ["coalesce", ["feature-state", "active"], false], TURN_COLOR_ACTIVE, routeColor],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity":      ["case", ["coalesce", ["feature-state", "active"], false], 1, 0.75],
      },
    }, layerIds);
    ensureLayer(map, {
      id: "walk-turns-label", type: "symbol", source: "walk-turns",
      layout: {
        "text-field":  ["to-string", ["+", ["get", "index"], 1]],  // 0-based → 1-based
        "text-size":   10,
        "text-anchor": "center",
        // Single-font only: OpenFreeMap 404s on comma-joined font fallbacks,
        // which errors the entire glyph bucket and would hide the numbered
        // markers. See walk-stops-label for the same constraint.
        "text-font":   ["Noto Sans Bold"],
      },
      paint: { "text-color": "#ffffff" },
    }, layerIds);
  } else {
    dropTracked(map, ["walk-turns-label", "walk-turns-circle", "walk-turns"], sourceIds, layerIds);
  }

  // Numbered markers for intermediate stops (multi-stop routes only).
  const stopCoords = Array.isArray(result.stop_coords) ? result.stop_coords : null;
  if (stopCoords && stopCoords.length > 2) {
    const intermediates = stopCoords.slice(1, -1).map((c, i) => ({
      type: "Feature",
      properties: { label: String(i + 1) },
      geometry: { type: "Point", coordinates: toGeo(c) },
    }));
    upsertGeoSource(
      map, "walk-stops",
      { type: "FeatureCollection", features: intermediates },
      sourceIds,
    );
    ensureLayer(map, {
      id: "walk-stops-circle", type: "circle", source: "walk-stops",
      paint: {
        "circle-radius": 11,
        "circle-color": routeColor,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    }, layerIds);
    ensureLayer(map, {
      id: "walk-stops-label", type: "symbol", source: "walk-stops",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-allow-overlap": true,
        // Single-font only: OpenFreeMap 404s on comma-joined font fallbacks,
        // which errors the entire glyph bucket and would hide the numbered
        // markers on multi-stop routes. Applies to every symbol layer here
        // (see explore-places-cluster-count + explore-places-glyph below).
        "text-font": ["Noto Sans Bold"],
      },
      paint: {
        "text-color": "#ffffff",
      },
    }, layerIds);
  } else {
    dropTracked(map, ["walk-stops-label", "walk-stops-circle", "walk-stops"], sourceIds, layerIds);
  }

  // Drop whenever the layer shouldn't be present, regardless of why
  // (flag off OR coords missing). Previously the cleanup branch only
  // ran when drawEndpointDots was false, leaking stale dots when the
  // flag stayed true but coords went missing between renders.
  if (drawEndpointDots && origin_coords) {
    const pt = toGeo(origin_coords);
    upsertGeoSource(
      map, "walk-origin",
      { type: "Feature", geometry: { type: "Point", coordinates: pt } },
      sourceIds,
    );
    ensureLayer(map, {
      id: "walk-origin-circle", type: "circle", source: "walk-origin",
      paint: {
        "circle-radius": 9, "circle-color": routeColor,
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
      },
    }, layerIds);
  } else {
    dropTracked(map, ["walk-origin-circle", "walk-origin"], sourceIds, layerIds);
  }

  if (drawEndpointDots && dest_coords) {
    const pt = toGeo(dest_coords);
    upsertGeoSource(
      map, "walk-dest",
      { type: "Feature", geometry: { type: "Point", coordinates: pt } },
      sourceIds,
    );
    ensureLayer(map, {
      id: "walk-dest-circle", type: "circle", source: "walk-dest",
      paint: {
        "circle-radius": 9, "circle-color": routeColor,
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
      },
    }, layerIds);
  } else {
    dropTracked(map, ["walk-dest-circle", "walk-dest"], sourceIds, layerIds);
  }

  if (geoPath.length > 0) {
    map.fitBounds(bounds, { padding: fitPadding, animate: false });
  }
}

// ── Explorer (isochrone) rendering ──────────────────────────────────────
//
// Layer order from bottom → top:
//   explore-poly-fill      — soft fill of the reachable polygon
//   explore-residential-fill — pinker residential overlay (toggleable)
//   explore-poly-stroke    — polygon outline (matches WALK_PATH_COLOR)
//   explore-places-cluster (+ count label) — pins clustered at low zoom
//   explore-places-pin     — individual pins at zoom ≥ 14
//   explore-places-glyph   — single-letter symbol on top of each pin
//
// `dataDriven` is true once `places` GeoJSON has actual features so we
// skip the cluster pass for empty selections (avoids a pointless idle
// supercluster build).

export const EXPLORE_FILL_COLOR        = "#1f6d3b"; // var(--field) — green wash
export const EXPLORE_FILL_OPACITY      = 0.18;
export const EXPLORE_STROKE_COLOR      = "#171310"; // var(--ink)
export const EXPLORE_STROKE_WIDTH      = 2;
export const RESIDENTIAL_FILL_COLOR    = "#9c2a1a"; // var(--ember)
export const RESIDENTIAL_FILL_OPACITY  = 0.18;
// CPD parks footprint heatmap. `--field` solid (vs. the residential wash
// at low opacity) so a park reads as a sharper, "this whole block is
// parkland" overlay — visually distinct from the moss-toned tree-canopy
// layer that Feature 2 will add.
export const PARKS_FILL_COLOR          = "#1f6d3b"; // var(--field)
export const PARKS_FILL_OPACITY        = 0.55;
export const PARKS_STROKE_COLOR        = "#13522b";
export const PARKS_STROKE_WIDTH        = 1;
// Tree-canopy density bands — three moss tones from the Wayfarer palette.
// Hex values are the Cream-theme resolution of --moss-100/300/500;
// runtime resolves the live CSS-var values via the resolver in
// MapExploreLayer so Cream ↔ Dusk recolors live.
export const CANOPY_BAND_COLORS = {
  low:  "var(--moss-100)",
  mid:  "var(--moss-300)",
  high: "var(--moss-500)",
};
export const CANOPY_FILL_OPACITY = 0.55;
// Non-CPD green space (OSM-derived cemeteries, golf courses, nature
// reserves, recreation grounds). Painted in `--moss-500` at a softer
// opacity than the CPD parks layer so the two read as adjacent-but-
// distinct shades of green when both are enabled.
export const GREEN_SPACE_FILL_COLOR   = "#6f8a6a"; // var(--moss-500)
export const GREEN_SPACE_FILL_OPACITY = 0.40;
export const GREEN_SPACE_STROKE_COLOR = "#4f6b4d";
export const GREEN_SPACE_STROKE_WIDTH = 0.5;
export const PLACE_CLUSTER_COLOR       = "#b8862a"; // var(--gilt) — Cream value; chosen so cluster bubbles don't blend with the ink-colored polygon stroke

export const PLACE_PIN_STROKE_COLOR    = "#fffbef"; // var(--paper-bright)
export const PLACE_PIN_TEXT_COLOR      = "#fffbef";

const EXPLORE_LAYER_IDS = [
  "explore-places-glyph",
  "explore-places-pin",
  "explore-places-cluster-count",
  "explore-places-cluster",
  "explore-poly-stroke",
  "explore-parks-stroke",
  "explore-parks-fill",
  "explore-greenspace-stroke",
  "explore-greenspace-fill",
  "explore-canopy-fill",
  "explore-residential-fill",
  "explore-poly-fill",
];
const EXPLORE_SOURCE_IDS = ["explore-places", "explore-parks", "explore-greenspace", "explore-canopy", "explore-residential", "explore-poly"];

export function clearExploreLayers(map, layerIds, sourceIds) {
  for (const id of EXPLORE_LAYER_IDS) {
    const idx = layerIds.indexOf(id);
    if (idx >= 0) {
      try { map.removeLayer(id); } catch { /* gone */ }
      layerIds.splice(idx, 1);
    }
  }
  for (const id of EXPLORE_SOURCE_IDS) {
    const idx = sourceIds.indexOf(id);
    if (idx >= 0) {
      try { map.removeSource(id); } catch { /* gone */ }
      sourceIds.splice(idx, 1);
    }
  }
}

function ensureExploreSource(map, id, data, clusterOptions, sourceIds) {
  const existing = map.getSource?.(id);
  if (existing && typeof existing.setData === "function") {
    existing.setData(data);
    if (!sourceIds.includes(id)) sourceIds.push(id);
    return;
  }
  map.addSource(id, { type: "geojson", data, ...(clusterOptions || {}) });
  sourceIds.push(id);
}

// Per-layer helpers split out of the legacy `renderExplore` monolith so
// MapExploreLayer can wire each layer to its own React useEffect with a
// narrow dep array. Toggling a single heatmap no longer thrashes through
// every block of code that touched unrelated sources.
//
// `renderExplore` remains as a façade for share-card paths + the existing
// test suite; production code (MapExploreLayer) calls the per-layer
// helpers directly.

export function renderExplorePolygon(map, polygonGeom, layerIds, sourceIds, fitOptions) {
  if (!polygonGeom) {
    dropTracked(map, ["explore-poly-stroke", "explore-poly-fill", "explore-poly"], sourceIds, layerIds);
    return;
  }
  ensureExploreSource(
    map, "explore-poly",
    { type: "Feature", geometry: polygonGeom, properties: {} },
    null, sourceIds,
  );
  ensureLayer(map, {
    id: "explore-poly-fill", type: "fill", source: "explore-poly",
    paint: {
      "fill-color":   EXPLORE_FILL_COLOR,
      "fill-opacity": EXPLORE_FILL_OPACITY,
    },
  }, layerIds);
  ensureLayer(map, {
    id: "explore-poly-stroke", type: "line", source: "explore-poly",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": EXPLORE_STROKE_COLOR,
      "line-width": EXPLORE_STROKE_WIDTH,
    },
  }, layerIds);

  // Only fit bounds when a new isochrone arrives — not on display-only
  // changes (category filter, heatmap toggle) so the user's pan/zoom is
  // preserved while exploring within a result.
  if (fitOptions?.fitOnRender) {
    const b = polygonBounds(polygonGeom);
    if (b) {
      map.fitBounds(b, { padding: fitOptions.fitPadding ?? 60, animate: false, maxZoom: 15 });
    }
  }
}

export function renderExploreResidential(map, show, residentialHeatmap, layerIds, sourceIds) {
  if (!show || !residentialHeatmap) {
    dropTracked(map, ["explore-residential-fill", "explore-residential"], sourceIds, layerIds);
    return;
  }
  ensureExploreSource(
    map, "explore-residential",
    { type: "Feature", geometry: residentialHeatmap, properties: {} },
    null, sourceIds,
  );
  if (!map.getLayer("explore-residential-fill")) {
    // `beforeId` references the polygon stroke so the residential wash
    // sits beneath the outline. The polygon effect runs first because
    // its dep set fires on every mode/result transition, but if it's
    // ever missing (defensive path), the addLayer call would throw —
    // catch and skip silently so a transient ordering mismatch doesn't
    // surface as a runtime error.
    try {
      map.addLayer({
        id: "explore-residential-fill", type: "fill", source: "explore-residential",
        paint: {
          "fill-color":   RESIDENTIAL_FILL_COLOR,
          "fill-opacity": RESIDENTIAL_FILL_OPACITY,
        },
      }, "explore-poly-stroke");
      layerIds.push("explore-residential-fill");
    } catch { /* polygon stroke not yet present */ }
  }
}

// Tree canopy density bands. Sits above residential and below CPD parks
// so an overlap reads as "park wins, then canopy, then residential."
export function renderExploreCanopy(map, show, canopyHeatmap, canopyBandColors, layerIds, sourceIds) {
  if (!show || !canopyHeatmap?.features?.length) {
    dropTracked(map, ["explore-canopy-fill", "explore-canopy"], sourceIds, layerIds);
    return;
  }
  ensureExploreSource(
    map, "explore-canopy",
    canopyHeatmap,
    null, sourceIds,
  );
  if (!map.getLayer("explore-canopy-fill")) {
    try {
      map.addLayer({
        id: "explore-canopy-fill", type: "fill", source: "explore-canopy",
        paint: {
          "fill-color": [
            "match", ["get", "density_band"],
            "low",  canopyBandColors.low,
            "mid",  canopyBandColors.mid,
            "high", canopyBandColors.high,
            canopyBandColors.mid,
          ],
          "fill-opacity": CANOPY_FILL_OPACITY,
        },
      }, "explore-poly-stroke");
      layerIds.push("explore-canopy-fill");
    } catch { /* polygon stroke not yet present */ }
  }
}

// CPD parks footprints. Each Feature carries name + acres for popups +
// the greenest-routing edge-weight bake; we keep them as Features rather
// than a single MultiPolygon for that reason.
export function renderExploreParks(map, show, parksHeatmap, layerIds, sourceIds) {
  if (!show || !parksHeatmap?.features?.length) {
    dropTracked(map, ["explore-parks-stroke", "explore-parks-fill", "explore-parks"], sourceIds, layerIds);
    return;
  }
  ensureExploreSource(
    map, "explore-parks",
    parksHeatmap,
    null, sourceIds,
  );
  if (!map.getLayer("explore-parks-fill")) {
    try {
      map.addLayer({
        id: "explore-parks-fill", type: "fill", source: "explore-parks",
        paint: {
          "fill-color":   PARKS_FILL_COLOR,
          "fill-opacity": PARKS_FILL_OPACITY,
        },
      }, "explore-poly-stroke");
      layerIds.push("explore-parks-fill");
    } catch { /* polygon stroke not yet present */ }
  }
  if (!map.getLayer("explore-parks-stroke")) {
    try {
      map.addLayer({
        id: "explore-parks-stroke", type: "line", source: "explore-parks",
        paint: {
          "line-color": PARKS_STROKE_COLOR,
          "line-width": PARKS_STROKE_WIDTH,
        },
      }, "explore-poly-stroke");
      layerIds.push("explore-parks-stroke");
    } catch { /* polygon stroke not yet present */ }
  }
}

// Non-CPD green space (OSM cemeteries / golf / nature reserves / rec
// grounds). Sits below CPD parks so a polygon tagged as both reads as
// the authoritative park footprint.
export function renderExploreGreenSpace(map, show, greenSpaceHeatmap, layerIds, sourceIds) {
  if (!show || !greenSpaceHeatmap?.features?.length) {
    dropTracked(map, ["explore-greenspace-stroke", "explore-greenspace-fill", "explore-greenspace"], sourceIds, layerIds);
    return;
  }
  ensureExploreSource(
    map, "explore-greenspace",
    greenSpaceHeatmap,
    null, sourceIds,
  );
  // beforeId varies: prefer "explore-parks-fill" when parks are live
  // (so green-space sits below parks), otherwise fall back to the
  // polygon stroke. This preserves z-order regardless of whether the
  // parks toggle is currently on.
  const beforeId = map.getLayer?.("explore-parks-fill") ? "explore-parks-fill" : "explore-poly-stroke";
  if (!map.getLayer("explore-greenspace-fill")) {
    try {
      map.addLayer({
        id: "explore-greenspace-fill", type: "fill", source: "explore-greenspace",
        paint: {
          "fill-color":   GREEN_SPACE_FILL_COLOR,
          "fill-opacity": GREEN_SPACE_FILL_OPACITY,
        },
      }, beforeId);
      layerIds.push("explore-greenspace-fill");
    } catch { /* anchor layer not yet present */ }
  }
  if (!map.getLayer("explore-greenspace-stroke")) {
    try {
      map.addLayer({
        id: "explore-greenspace-stroke", type: "line", source: "explore-greenspace",
        paint: {
          "line-color": GREEN_SPACE_STROKE_COLOR,
          "line-width": GREEN_SPACE_STROKE_WIDTH,
        },
      }, beforeId);
      layerIds.push("explore-greenspace-stroke");
    } catch { /* anchor layer not yet present */ }
  }
}

// Clustered place pins. The caller (MapExploreLayer) owns subcategory
// filtering and GeoJSON shaping of `placeFeatures` plus the per-category
// color + glyph match expressions, so this helper only paints what it's
// handed.
export function renderExplorePlaces(map, placeFeatures, placeExpressions, layerIds, sourceIds) {
  ensureExploreSource(
    map, "explore-places",
    { type: "FeatureCollection", features: placeFeatures || [] },
    {
      cluster: true,
      clusterRadius: 40,
      // Cluster up through zoom 12; from zoom 13 every place is an
      // individual pin. The default `fitBounds` for a 20-min isochrone
      // lands around zoom 13, so users see real category pins on the
      // first frame instead of a single cluster bubble.
      clusterMaxZoom: 12,
    },
    sourceIds,
  );

  ensureLayer(map, {
    id: "explore-places-cluster", type: "circle", source: "explore-places",
    filter: ["has", "point_count"],
    paint: {
      "circle-color":  PLACE_CLUSTER_COLOR,
      "circle-radius": [
        "step",
        ["get", "point_count"],
        14, 10,
        18, 50,
        22,
      ],
      "circle-stroke-width": 2,
      "circle-stroke-color": PLACE_PIN_STROKE_COLOR,
      "circle-opacity": 0.92,
    },
  }, layerIds);

  ensureLayer(map, {
    id: "explore-places-cluster-count", type: "symbol", source: "explore-places",
    filter: ["has", "point_count"],
    layout: {
      "text-field":  ["get", "point_count_abbreviated"],
      "text-size":   12,
      "text-allow-overlap": true,
      "text-font": ["Noto Sans Bold"],
    },
    paint: { "text-color": PLACE_PIN_TEXT_COLOR },
  }, layerIds);

  const { colorExpr, glyphExpr } = placeExpressions || _fallbackPinExpressions();

  ensureLayer(map, {
    id: "explore-places-pin", type: "circle", source: "explore-places",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color":  colorExpr,
      "circle-radius": 11,
      "circle-stroke-width": 2,
      "circle-stroke-color": PLACE_PIN_STROKE_COLOR,
      "circle-opacity": 0.94,
    },
  }, layerIds);

  ensureLayer(map, {
    id: "explore-places-glyph", type: "symbol", source: "explore-places",
    filter: ["!", ["has", "point_count"]],
    layout: {
      "text-field": glyphExpr,
      "text-size":  12,
      "text-allow-overlap": true,
      "text-font": ["Noto Sans Bold"],
    },
    paint: {
      "text-color":      PLACE_PIN_TEXT_COLOR,
      "text-halo-width": 0.5,
      "text-halo-color": "rgba(0,0,0,0.35)",
    },
  }, layerIds);
}

/**
 * Façade that delegates to the per-layer helpers above. Kept so the
 * existing mapHelpers.test.js + ShareDispatch-style callers don't have
 * to enumerate every helper. Production code in MapExploreLayer calls
 * the per-layer helpers directly so each useEffect's dep array stays
 * scoped to the source it manages.
 *
 * @param {maplibregl.Map} map
 * @param {Object} result               — backend /explore response
 * @param {Object} options
 * @param {boolean} options.showResidential
 * @param {Object[]}       options.placeFeatures   — GeoJSON Features
 * @param {Object}         options.placeExpressions — { colorExpr, glyphExpr }
 * @param {number|Object}  options.fitPadding
 * @param {string[]}       layerIds
 * @param {string[]}       sourceIds
 */
export function renderExplore(map, result, options, layerIds, sourceIds) {
  if (!result?.polygon) {
    clearExploreLayers(map, layerIds, sourceIds);
    return;
  }
  const {
    showResidential = true,
    showParks = false,
    showTreeCanopy = false,
    showGreenSpace = false,
    canopyBandColors = CANOPY_BAND_COLORS,
    placeFeatures = [],
    placeExpressions,
    fitPadding = 60,
    fitOnRender = true,
  } = options || {};

  renderExplorePolygon(map, result.polygon, layerIds, sourceIds, { fitOnRender, fitPadding });
  renderExploreResidential(map, showResidential, result.residential_heatmap, layerIds, sourceIds);
  renderExploreCanopy(map, showTreeCanopy, result.tree_canopy_heatmap, canopyBandColors, layerIds, sourceIds);
  renderExploreParks(map, showParks, result.parks_heatmap, layerIds, sourceIds);
  renderExploreGreenSpace(map, showGreenSpace, result.green_space_heatmap, layerIds, sourceIds);
  renderExplorePlaces(map, placeFeatures, placeExpressions, layerIds, sourceIds);
}

// Safety net for callers that didn't pre-build the pin expressions
// (e.g. test fixtures). Renders all categories as the ink stroke color
// with the bullet glyph. Production callers always pass placeExpressions.
function _fallbackPinExpressions() {
  return {
    colorExpr: ["literal", EXPLORE_STROKE_COLOR],
    glyphExpr: ["literal", "•"],
  };
}

function polygonBounds(geom) {
  let minLon =  Infinity, minLat =  Infinity;
  let maxLon = -Infinity, maxLat = -Infinity;
  const consume = ([lon, lat]) => {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  };
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) for (const c of ring) consume(c);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) for (const ring of poly) for (const c of ring) consume(c);
  } else {
    return null;
  }
  if (!Number.isFinite(minLon)) return null;
  return [[minLon, minLat], [maxLon, maxLat]];
}


export function lockMapGestures(map) {
  map.scrollZoom.disable();
  map.dragPan.disable();
  map.dragRotate.disable();
  map.doubleClickZoom.disable();
  map.touchZoomRotate.disable();
  map.keyboard.disable();
}

export function unlockMapGestures(map) {
  map.scrollZoom.enable();
  map.dragPan.enable();
  map.dragRotate.enable();
  map.doubleClickZoom.enable();
  map.touchZoomRotate.enable();
  map.keyboard.enable();
}
