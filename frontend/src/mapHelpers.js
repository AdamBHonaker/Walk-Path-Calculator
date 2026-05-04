export const WALK_PATH_COLOR  = "#2d7a3e";
export const TURN_COLOR_ACTIVE = "#4caf77";

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

export function renderWalkRoute(map, result, turnCoords, activeTurnIndex, layerIds, sourceIds, fitPadding = 60) {
  if (!result?.path?.length) return;

  const { path, origin_coords, dest_coords } = result;

  const { geoPath, bounds } = path.reduce(
    ({ geoPath, bounds }, pt) => {
      const [lon, lat] = toGeo(pt);
      geoPath.push([lon, lat]);
      return {
        geoPath,
        bounds: [
          [Math.min(bounds[0][0], lon), Math.min(bounds[0][1], lat)],
          [Math.max(bounds[1][0], lon), Math.max(bounds[1][1], lat)],
        ],
      };
    },
    { geoPath: [], bounds: [[Infinity, Infinity], [-Infinity, -Infinity]] },
  );

  trackSource(map, "walk-path", {
    type: "geojson",
    data: { type: "Feature", geometry: { type: "LineString", coordinates: geoPath } },
  }, sourceIds);
  trackLayer(map, {
    id: "walk-path-line", type: "line", source: "walk-path",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": WALK_PATH_COLOR, "line-width": 4 },
  }, layerIds);

  if (turnCoords?.length) {
    trackSource(map, "walk-turns", {
      type: "geojson",
      data: buildTurnsGeoJson(turnCoords, activeTurnIndex),
    }, sourceIds);
    trackLayer(map, {
      id: "walk-turns-circle", type: "circle", source: "walk-turns",
      paint: {
        "circle-radius":       ["case", ["get", "active"], 8, 5],
        "circle-color":        ["case", ["get", "active"], TURN_COLOR_ACTIVE, WALK_PATH_COLOR],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity":      ["case", ["get", "active"], 1, 0.75],
      },
    }, layerIds);
  }

  // Numbered markers for intermediate stops (multi-stop routes only).
  const stopCoords = Array.isArray(result.stop_coords) ? result.stop_coords : null;
  if (stopCoords && stopCoords.length > 2) {
    const intermediates = stopCoords.slice(1, -1).map((c, i) => ({
      type: "Feature",
      properties: { label: String(i + 1) },
      geometry: { type: "Point", coordinates: toGeo(c) },
    }));
    trackSource(map, "walk-stops", {
      type: "geojson",
      data: { type: "FeatureCollection", features: intermediates },
    }, sourceIds);
    trackLayer(map, {
      id: "walk-stops-circle", type: "circle", source: "walk-stops",
      paint: {
        "circle-radius": 11,
        "circle-color": WALK_PATH_COLOR,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    }, layerIds);
    trackLayer(map, {
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
  }

  if (origin_coords) {
    const pt = toGeo(origin_coords);
    trackSource(map, "walk-origin", {
      type: "geojson",
      data: { type: "Feature", geometry: { type: "Point", coordinates: pt } },
    }, sourceIds);
    trackLayer(map, {
      id: "walk-origin-circle", type: "circle", source: "walk-origin",
      paint: {
        "circle-radius": 9, "circle-color": WALK_PATH_COLOR,
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
      },
    }, layerIds);
  }

  if (dest_coords) {
    const pt = toGeo(dest_coords);
    trackSource(map, "walk-dest", {
      type: "geojson",
      data: { type: "Feature", geometry: { type: "Point", coordinates: pt } },
    }, sourceIds);
    trackLayer(map, {
      id: "walk-dest-circle", type: "circle", source: "walk-dest",
      paint: {
        "circle-radius": 9, "circle-color": "#1a1a1a",
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
      },
    }, layerIds);
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
