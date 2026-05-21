import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  haversineMeters,
  toGeo,
  buildTurnsGeoJson,
  buildRouteSegments,
  clearLayers,
  renderWalkRoute,
  renderExplore,
  WALK_PATH_COLOR,
  SEG_ALT_OPACITY_EXPR,
} from "./mapHelpers.js";

// ── toGeo ────────────────────────────────────────────────────────────────

describe("toGeo", () => {
  it("swaps [lat, lon] to [lon, lat] for GeoJSON", () => {
    expect(toGeo([41.9, -87.6])).toEqual([-87.6, 41.9]);
  });
});

// ── haversineMeters ──────────────────────────────────────────────────────

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters([41.9, -87.6], [41.9, -87.6])).toBe(0);
  });

  it("returns a positive distance for distinct points", () => {
    const d = haversineMeters([41.88, -87.63], [41.90, -87.63]);
    expect(d).toBeGreaterThan(0);
  });

  it("is approximately correct (~2.2 km for ~0.02° latitude)", () => {
    // 0.02° lat ≈ 2222 m
    const d = haversineMeters([41.88, -87.63], [41.90, -87.63]);
    expect(d).toBeCloseTo(2224, -2); // within ~100 m
  });

  it("is symmetric", () => {
    const a = [41.88, -87.63];
    const b = [41.90, -87.65];
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 5);
  });
});

// ── buildTurnsGeoJson ────────────────────────────────────────────────────

describe("buildTurnsGeoJson", () => {
  it("returns a FeatureCollection", () => {
    const result = buildTurnsGeoJson([]);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toEqual([]);
  });

  it("includes one feature per valid turn coord", () => {
    const turns = [[41.88, -87.63], [41.90, -87.65]];
    const { features } = buildTurnsGeoJson(turns);
    expect(features).toHaveLength(2);
  });

  it("deduplicates coords that are less than 5 m apart", () => {
    // Two points ~1 m apart should collapse to one feature
    const base = [41.88000, -87.63000];
    const nearby = [41.88001, -87.63000]; // ~1.1 m away
    const { features } = buildTurnsGeoJson([base, nearby]);
    expect(features).toHaveLength(1);
  });

  it("keeps coords that are more than 5 m apart", () => {
    const a = [41.88, -87.63];
    const b = [41.89, -87.63]; // ~1.1 km away
    const { features } = buildTurnsGeoJson([a, b]);
    expect(features).toHaveLength(2);
  });

  it("assigns each feature a stable id matching its original turnCoords index", () => {
    // After dedup, the surviving feature should keep its source-array index
    // as `id` so setFeatureState({source, id}) can address it.
    const turns = [[41.88, -87.63], [41.90, -87.65]];
    const { features } = buildTurnsGeoJson(turns);
    expect(features[0].id).toBe(0);
    expect(features[1].id).toBe(1);
  });

  it("does not bake an `active` flag into properties (handled via feature-state)", () => {
    const turns = [[41.88, -87.63], [41.90, -87.65]];
    const { features } = buildTurnsGeoJson(turns);
    expect(features.every(f => !("active" in f.properties))).toBe(true);
  });

  it("converts coordinates to GeoJSON [lon, lat] order", () => {
    const turns = [[41.88, -87.63]];
    const { features } = buildTurnsGeoJson(turns);
    expect(features[0].geometry.coordinates).toEqual([-87.63, 41.88]);
  });

  it("skips null/undefined entries in the turn array", () => {
    const turns = [null, [41.88, -87.63], undefined];
    const { features } = buildTurnsGeoJson(turns);
    expect(features).toHaveLength(1);
  });
});

// ── SEG_ALT_OPACITY_EXPR ─────────────────────────────────────────────────

describe("SEG_ALT_OPACITY_EXPR", () => {
  it("is a non-empty array (valid MapLibre expression)", () => {
    expect(Array.isArray(SEG_ALT_OPACITY_EXPR)).toBe(true);
    expect(SEG_ALT_OPACITY_EXPR.length).toBeGreaterThan(0);
  });

  it("starts with 'case' operator", () => {
    expect(SEG_ALT_OPACITY_EXPR[0]).toBe("case");
  });
});

// ── buildRouteSegments ───────────────────────────────────────────────────

describe("buildRouteSegments", () => {
  it("returns empty FeatureCollection for null directions", () => {
    const fc = buildRouteSegments([[41.88, -87.63], [41.89, -87.64]], null);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(0);
  });

  it("returns empty FeatureCollection for empty directions", () => {
    const fc = buildRouteSegments([[41.88, -87.63], [41.89, -87.64]], []);
    expect(fc.features).toHaveLength(0);
  });

  it("returns empty FeatureCollection for empty path", () => {
    const fc = buildRouteSegments([], [{ distance_meters: 100 }]);
    expect(fc.features).toHaveLength(0);
  });

  it("produces N segments for N direction steps", () => {
    const path = [
      [41.88, -87.63],
      [41.885, -87.635],
      [41.89, -87.64],
    ];
    // Two steps: step 0 covers the first edge, step 1 covers the second edge.
    const directions = [
      { distance_meters: haversineMeters(path[0], path[1]) },
      { distance_meters: haversineMeters(path[1], path[2]) },
    ];
    const fc = buildRouteSegments(path, directions);
    expect(fc.features).toHaveLength(2);
  });

  it("each feature has segmentIndex matching its position", () => {
    const path = [
      [41.88, -87.63],
      [41.885, -87.635],
      [41.89, -87.64],
    ];
    const directions = [
      { distance_meters: haversineMeters(path[0], path[1]) },
      { distance_meters: haversineMeters(path[1], path[2]) },
    ];
    const fc = buildRouteSegments(path, directions);
    expect(fc.features[0].properties.segmentIndex).toBe(0);
    expect(fc.features[1].properties.segmentIndex).toBe(1);
  });

  it("each feature has stable id matching segmentIndex", () => {
    const path = [[41.88, -87.63], [41.885, -87.635], [41.89, -87.64]];
    const d = haversineMeters(path[0], path[1]);
    const fc = buildRouteSegments(path, [{ distance_meters: d }, { distance_meters: d }]);
    expect(fc.features[0].id).toBe(0);
    expect(fc.features[1].id).toBe(1);
  });

  it("last segment's final coord equals path[last] exactly", () => {
    // Critical: ensures no index-overrun when anchoring the last segment end.
    const path = [
      [41.88, -87.63],
      [41.885, -87.635],
      [41.89, -87.64],
    ];
    const directions = [
      { distance_meters: haversineMeters(path[0], path[1]) },
      { distance_meters: haversineMeters(path[1], path[2]) },
    ];
    const fc = buildRouteSegments(path, directions);
    const lastSeg = fc.features[fc.features.length - 1];
    const lastCoord = lastSeg.geometry.coordinates[lastSeg.geometry.coordinates.length - 1];
    // GeoJSON is [lon, lat]; path[last] is [lat, lon].
    expect(lastCoord[0]).toBeCloseTo(path[path.length - 1][1], 6); // lon
    expect(lastCoord[1]).toBeCloseTo(path[path.length - 1][0], 6); // lat
  });

  it("each segment has at least 2 coordinates", () => {
    const path = [[41.88, -87.63], [41.885, -87.635], [41.89, -87.64]];
    const d = haversineMeters(path[0], path[1]);
    const fc = buildRouteSegments(path, [{ distance_meters: d }, { distance_meters: d }]);
    for (const f of fc.features) {
      expect(f.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("uses GeoJSON [lon, lat] coordinate order", () => {
    const path = [[41.88, -87.63], [41.89, -87.63]];
    const fc = buildRouteSegments(path, [{ distance_meters: haversineMeters(path[0], path[1]) }]);
    // First coord of first segment should be path[0] as [lon, lat]
    expect(fc.features[0].geometry.coordinates[0]).toEqual([-87.63, 41.88]);
  });

  it("3-step route produces 3 segments", () => {
    const path = [
      [41.88, -87.63],
      [41.883, -87.633],
      [41.886, -87.636],
      [41.89,  -87.64],
    ];
    const directions = [
      { distance_meters: haversineMeters(path[0], path[1]) },
      { distance_meters: haversineMeters(path[1], path[2]) },
      { distance_meters: haversineMeters(path[2], path[3]) },
    ];
    const fc = buildRouteSegments(path, directions);
    expect(fc.features).toHaveLength(3);
  });
});

// ── clearLayers ──────────────────────────────────────────────────────────

describe("clearLayers", () => {
  it("calls removeLayer for each tracked layer ID", () => {
    const map = { removeLayer: vi.fn(), removeSource: vi.fn() };
    const layerIds = ["layer-a", "layer-b"];
    const sourceIds = [];
    clearLayers(map, layerIds, sourceIds);
    expect(map.removeLayer).toHaveBeenCalledWith("layer-a");
    expect(map.removeLayer).toHaveBeenCalledWith("layer-b");
  });

  it("empties the layerIds array after clearing", () => {
    const map = { removeLayer: vi.fn(), removeSource: vi.fn() };
    const layerIds = ["layer-a"];
    const sourceIds = [];
    clearLayers(map, layerIds, sourceIds);
    expect(layerIds).toHaveLength(0);
  });

  it("does not throw if a layer is already removed", () => {
    const map = {
      removeLayer: vi.fn(() => { throw new Error("layer gone"); }),
      removeSource: vi.fn(),
    };
    expect(() => clearLayers(map, ["layer-a"], [])).not.toThrow();
  });
});

// ── renderWalkRoute ──────────────────────────────────────────────────────

describe("renderWalkRoute", () => {
  let map;
  let layerIds;
  let sourceIds;

  beforeEach(() => {
    layerIds = [];
    sourceIds = [];
    map = {
      addSource: vi.fn(),
      addLayer:  vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      fitBounds: vi.fn(),
    };
  });

  it("returns early and adds nothing when result has no path", () => {
    renderWalkRoute(map, { path: [] }, null, null, layerIds, sourceIds);
    expect(map.addSource).not.toHaveBeenCalled();
    expect(layerIds).toHaveLength(0);
  });

  it("returns early when result is null", () => {
    renderWalkRoute(map, null, null, null, layerIds, sourceIds);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("adds a walk-path source and layer for a valid path", () => {
    const result = {
      path: [[41.88, -87.63], [41.89, -87.64]],
    };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(sourceIds).toContain("walk-path");
    expect(layerIds).toContain("walk-path-line");
  });

  it("converts path coordinates from [lat,lon] to [lon,lat] in GeoJSON", () => {
    const result = { path: [[41.88, -87.63]] };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    const call = map.addSource.mock.calls.find(c => c[0] === "walk-path");
    const coords = call[1].data.geometry.coordinates;
    expect(coords[0]).toEqual([-87.63, 41.88]);
  });

  it("adds walk-origin and walk-dest markers when provided", () => {
    const result = {
      path: [[41.88, -87.63], [41.89, -87.64]],
      origin_coords: [41.88, -87.63],
      dest_coords:   [41.89, -87.64],
    };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(sourceIds).toContain("walk-origin");
    expect(sourceIds).toContain("walk-dest");
  });

  it("uses WALK_PATH_COLOR for the route line", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    const lineLayerCall = map.addLayer.mock.calls.find(c => c[0].id === "walk-path-line");
    expect(lineLayerCall[0].paint["line-color"]).toBe(WALK_PATH_COLOR);
  });

  it("calls fitBounds when the path has at least one point", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(map.fitBounds).toHaveBeenCalled();
  });

  it("adds walk-turns source and layer when turnCoords are provided", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    const turnCoords = [[41.88, -87.63], [41.89, -87.64]];
    renderWalkRoute(map, result, turnCoords, null, layerIds, sourceIds);
    expect(sourceIds).toContain("walk-turns");
    expect(layerIds).toContain("walk-turns-circle");
  });

  it("omits walk-turns source when turnCoords is null", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(sourceIds).not.toContain("walk-turns");
    expect(layerIds).not.toContain("walk-turns-circle");
  });

  it("emits walk-turns features with stable ids and no baked-in active flag", () => {
    // Active-turn highlighting is now applied via setFeatureState in
    // MapRouteLayer — the source data carries the raw turn geometry only.
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    const turnCoords = [[41.88, -87.63], [41.89, -87.64]];
    renderWalkRoute(map, result, turnCoords, 1, layerIds, sourceIds);
    const call = map.addSource.mock.calls.find(c => c[0] === "walk-turns");
    const features = call[1].data.features;
    expect(features.map(f => f.id)).toEqual([0, 1]);
    expect(features.every(f => !("active" in f.properties))).toBe(true);
  });

  it("adds intermediate stop markers for multi-stop routes", () => {
    const result = {
      path: [[41.88, -87.63], [41.89, -87.64]],
      stop_coords: [[41.88, -87.63], [41.885, -87.635], [41.89, -87.64]],
    };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(sourceIds).toContain("walk-stops");
    expect(layerIds).toContain("walk-stops-circle");
    expect(layerIds).toContain("walk-stops-label");
  });

  it("omits stop markers when stop_coords has only origin and dest (length <= 2)", () => {
    const result = {
      path: [[41.88, -87.63], [41.89, -87.64]],
      stop_coords: [[41.88, -87.63], [41.89, -87.64]],
    };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(sourceIds).not.toContain("walk-stops");
  });

  it("adds walk-segment-casing and walk-segments-line when directions are provided", () => {
    const path = [[41.88, -87.63], [41.89, -87.64]];
    const result = {
      path,
      directions: [{ distance_meters: 1200 }, { distance_meters: 900 }],
    };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(sourceIds).toContain("walk-segments");
    expect(layerIds).toContain("walk-segment-casing");
    expect(layerIds).toContain("walk-segments-line");
  });

  it("omits segment layers when directions is absent", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(sourceIds).not.toContain("walk-segments");
    expect(layerIds).not.toContain("walk-segment-casing");
    expect(layerIds).not.toContain("walk-segments-line");
  });

  it("omits segment layers when directions is empty", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]], directions: [] };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(sourceIds).not.toContain("walk-segments");
    expect(layerIds).not.toContain("walk-segments-line");
  });

  it("adds walk-turns-label when turnCoords are provided", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    const turnCoords = [[41.88, -87.63], [41.89, -87.64]];
    renderWalkRoute(map, result, turnCoords, null, layerIds, sourceIds);
    expect(layerIds).toContain("walk-turns-label");
  });

  it("omits walk-turns-label when turnCoords is null", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    renderWalkRoute(map, result, null, null, layerIds, sourceIds);
    expect(layerIds).not.toContain("walk-turns-label");
  });

  it("walk-turns-circle uses bumped radius (11 inactive, 13 active)", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    const turnCoords = [[41.88, -87.63]];
    renderWalkRoute(map, result, turnCoords, null, layerIds, sourceIds);
    const circle = map.addLayer.mock.calls.find(c => c[0].id === "walk-turns-circle");
    const radiusExpr = circle[0].paint["circle-radius"];
    // Expression: ["case", [...active...], 13, 11]
    expect(radiusExpr[radiusExpr.length - 1]).toBe(11);           // inactive (fallback)
    expect(radiusExpr[radiusExpr.length - 2]).toBe(13);           // active
  });
});

// ── Symbol layer text-font regression (commit 67c8c17 fix) ───────────────
describe("symbol layers use single Noto Sans Bold font (not a comma-joined list)", () => {
  let capturedLayers;
  let mockMap;

  beforeEach(() => {
    capturedLayers = [];
    mockMap = {
      addSource: vi.fn(),
      addLayer: vi.fn((cfg) => capturedLayers.push(cfg)),
      getSource: vi.fn(() => null),
      getLayer: vi.fn(() => null),
      fitBounds: vi.fn(),
      setPaintProperty: vi.fn(),
      setFeatureState: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      isStyleLoaded: vi.fn(() => true),
    };
  });

  it("walk-stops-label text-font is exactly [\"Noto Sans Bold\"]", () => {
    // renderWalkRoute adds the stop-label symbol layer for multi-stop routes.
    const fakeResult = {
      path: [[41.88, -87.63], [41.90, -87.65]],
      directions: [],
      stop_coords: [[41.88, -87.63], [41.885, -87.635], [41.90, -87.65]],
      stops: ["A", "B", "C"],
    };
    renderWalkRoute(mockMap, fakeResult, [], null, [], []);
    const stopLabel = capturedLayers.find(l => l.id === "walk-stops-label");
    expect(stopLabel).toBeDefined();
    expect(stopLabel.layout?.["text-font"]).toEqual(["Noto Sans Bold"]);
    const font = stopLabel.layout?.["text-font"];
    expect(Array.isArray(font)).toBe(true);
    expect(font).toHaveLength(1);
    expect(font[0]).not.toContain(",");
  });

  it("walk-turns-label text-font is exactly [\"Noto Sans Bold\"]", () => {
    const fakeResult = {
      path: [[41.88, -87.63], [41.90, -87.65]],
    };
    const turnCoords = [[41.88, -87.63], [41.90, -87.65]];
    renderWalkRoute(mockMap, fakeResult, turnCoords, null, [], []);
    const turnsLabel = capturedLayers.find(l => l.id === "walk-turns-label");
    expect(turnsLabel).toBeDefined();
    expect(turnsLabel.layout?.["text-font"]).toEqual(["Noto Sans Bold"]);
    const font = turnsLabel.layout?.["text-font"];
    expect(Array.isArray(font)).toBe(true);
    expect(font).toHaveLength(1);
    expect(font[0]).not.toContain(",");
  });

  it("explore-places-cluster-count text-font is exactly [\"Noto Sans Bold\"]", () => {
    const fakeResult = {
      polygon: { type: "Polygon", coordinates: [[[-87.7, 41.9], [-87.6, 41.9], [-87.6, 42.0], [-87.7, 42.0], [-87.7, 41.9]]] },
      places: [],
    };
    renderExplore(mockMap, fakeResult, {}, [], []);
    const clusterCount = capturedLayers.find(l => l.id === "explore-places-cluster-count");
    expect(clusterCount).toBeDefined();
    expect(clusterCount.layout?.["text-font"]).toEqual(["Noto Sans Bold"]);
    const font = clusterCount.layout?.["text-font"];
    expect(Array.isArray(font)).toBe(true);
    expect(font).toHaveLength(1);
    expect(font[0]).not.toContain(",");
  });

  it("explore-places-glyph text-font is exactly [\"Noto Sans Bold\"]", () => {
    const fakeResult = {
      polygon: { type: "Polygon", coordinates: [[[-87.7, 41.9], [-87.6, 41.9], [-87.6, 42.0], [-87.7, 42.0], [-87.7, 41.9]]] },
      places: [],
    };
    renderExplore(mockMap, fakeResult, {}, [], []);
    const glyph = capturedLayers.find(l => l.id === "explore-places-glyph");
    expect(glyph).toBeDefined();
    expect(glyph.layout?.["text-font"]).toEqual(["Noto Sans Bold"]);
    const font = glyph.layout?.["text-font"];
    expect(Array.isArray(font)).toBe(true);
    expect(font).toHaveLength(1);
    expect(font[0]).not.toContain(",");
  });
});
