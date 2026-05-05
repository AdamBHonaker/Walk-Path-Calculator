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
  } else if (!drawEndpointDots) {
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
  } else if (!drawEndpointDots) {
    dropTracked(map, ["walk-dest-circle", "walk-dest"], sourceIds, layerIds);
  }

  if (geoPath.length > 0) {
    map.fitBounds(bounds, { padding: fitPadding, animate: false });
  }
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
