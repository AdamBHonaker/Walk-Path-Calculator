// Wayfarer palette: ink for the route line, ember for the active turn.
// Kept in sync with src/wayfarer/tokens.css so MapLibre paint values match
// the rest of the design system. The share card overrides via the
// `routeColor` parameter on renderWalkRoute().
export const WALK_PATH_COLOR  = "#171310"; // var(--ink)
export const TURN_COLOR_ACTIVE = "#9c2a1a"; // var(--ember)

// Shared map defaults — used by both MapView and RouteCard so the two
// renderings can never drift on tile provider or default framing.
export const MAP_STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";
export const DEFAULT_MAP_CENTER = [-87.654, 41.966]; // Uptown, Chicago
export const DEFAULT_MAP_ZOOM   = 13;

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
const _METERS_PER_DEG_LAT = 111320;

export function buildTurnsGeoJson(turnCoords, activeTurnIndex) {
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
      properties: { active: i === activeTurnIndex, index: i },
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

export function renderWalkRoute(map, result, turnCoords, activeTurnIndex, layerIds, sourceIds, fitPadding = 60, routeColor = WALK_PATH_COLOR, drawEndpointDots = true) {
  if (!result?.path?.length) return;

  const { path, origin_coords, dest_coords } = result;

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
    upsertGeoSource(
      map, "walk-turns",
      buildTurnsGeoJson(turnCoords, activeTurnIndex),
      sourceIds,
    );
    ensureLayer(map, {
      id: "walk-turns-circle", type: "circle", source: "walk-turns",
      paint: {
        "circle-radius":       ["case", ["get", "active"], 8, 5],
        "circle-color":        ["case", ["get", "active"], TURN_COLOR_ACTIVE, routeColor],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity":      ["case", ["get", "active"], 1, 0.75],
      },
    }, layerIds);
  } else {
    dropTracked(map, ["walk-turns-circle", "walk-turns"], sourceIds, layerIds);
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
export const PLACE_CLUSTER_COLOR       = "#171310";
export const PLACE_PIN_STROKE_COLOR    = "#fffbef"; // var(--paper-bright)
export const PLACE_PIN_TEXT_COLOR      = "#fffbef";

const EXPLORE_LAYER_IDS = [
  "explore-places-glyph",
  "explore-places-pin",
  "explore-places-cluster-count",
  "explore-places-cluster",
  "explore-poly-stroke",
  "explore-residential-fill",
  "explore-poly-fill",
];
const EXPLORE_SOURCE_IDS = ["explore-places", "explore-residential", "explore-poly"];

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

/**
 * Render the explorer's polygon + (optional) residential heatmap + place
 * pins. Mutates `layerIds` / `sourceIds` so the caller can dispose layers
 * at the next render.
 *
 * The caller pre-computes `placeFeatures` (the GeoJSON FeatureCollection
 * for the pin source) and `placeExpressions` (the color/glyph match
 * expressions). This lets a `showResidential`-only toggle reuse the same
 * cached features and skip handing supercluster a fresh setData payload.
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
    placeFeatures = [],
    placeExpressions,
    fitPadding = 60,
  } = options || {};

  // ── Polygon source ────────────────────────────────────────────────
  ensureExploreSource(
    map, "explore-poly",
    { type: "Feature", geometry: result.polygon, properties: {} },
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

  // ── Residential heatmap fill ─────────────────────────────────────
  if (showResidential && result.residential_heatmap) {
    ensureExploreSource(
      map, "explore-residential",
      { type: "Feature", geometry: result.residential_heatmap, properties: {} },
      null, sourceIds,
    );
    if (!map.getLayer("explore-residential-fill")) {
      map.addLayer({
        id: "explore-residential-fill", type: "fill", source: "explore-residential",
        paint: {
          "fill-color":   RESIDENTIAL_FILL_COLOR,
          "fill-opacity": RESIDENTIAL_FILL_OPACITY,
        },
      }, "explore-poly-stroke");
      layerIds.push("explore-residential-fill");
    }
  } else {
    dropTracked(map, ["explore-residential-fill", "explore-residential"], sourceIds, layerIds);
  }

  // ── Places source (clustered) ────────────────────────────────────
  // Subcategory filter + GeoJSON shaping happens in MapView so a
  // `showResidential`-only toggle doesn't re-tile this source.

  ensureExploreSource(
    map, "explore-places",
    { type: "FeatureCollection", features: placeFeatures },
    {
      cluster: true,
      clusterRadius: 40,
      clusterMaxZoom: 13,
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
      "text-font": ["Noto Sans Bold", "Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": PLACE_PIN_TEXT_COLOR },
  }, layerIds);

  // Individual pin: a colored circle per category, stroked white. We use a
  // category→color expression so a single circle layer paints every pin
  // without N category-specific layers (those would each have their own
  // event subscription, ballooning the click handler bookkeeping).
  // Expressions are pre-built by the caller and memoised on categoryStyles.
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
      "text-font": ["Noto Sans Bold", "Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: {
      "text-color":      PLACE_PIN_TEXT_COLOR,
      "text-halo-width": 0.5,
      "text-halo-color": "rgba(0,0,0,0.35)",
    },
  }, layerIds);

  // Fit the polygon bounds on every render. Computed inline (no Turf
  // dependency) by walking the GeoJSON coordinate arrays.
  const b = polygonBounds(result.polygon);
  if (b) {
    map.fitBounds(b, { padding: fitPadding, animate: false, maxZoom: 15 });
  }
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
