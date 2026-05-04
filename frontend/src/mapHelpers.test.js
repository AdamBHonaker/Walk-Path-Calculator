import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  haversineMeters,
  toGeo,
  buildTurnsGeoJson,
  clearLayers,
  renderWalkRoute,
  WALK_PATH_COLOR,
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
    const result = buildTurnsGeoJson([], null);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toEqual([]);
  });

  it("includes one feature per valid turn coord", () => {
    const turns = [[41.88, -87.63], [41.90, -87.65]];
    const { features } = buildTurnsGeoJson(turns, null);
    expect(features).toHaveLength(2);
  });

  it("deduplicates coords that are less than 5 m apart", () => {
    // Two points ~1 m apart should collapse to one feature
    const base = [41.88000, -87.63000];
    const nearby = [41.88001, -87.63000]; // ~1.1 m away
    const { features } = buildTurnsGeoJson([base, nearby], null);
    expect(features).toHaveLength(1);
  });

  it("keeps coords that are more than 5 m apart", () => {
    const a = [41.88, -87.63];
    const b = [41.89, -87.63]; // ~1.1 km away
    const { features } = buildTurnsGeoJson([a, b], null);
    expect(features).toHaveLength(2);
  });

  it("marks the active turn with active: true", () => {
    const turns = [[41.88, -87.63], [41.90, -87.65]];
    const { features } = buildTurnsGeoJson(turns, 1);
    expect(features[0].properties.active).toBe(false);
    expect(features[1].properties.active).toBe(true);
  });

  it("sets active: false for all features when activeTurnIndex is null", () => {
    const turns = [[41.88, -87.63], [41.90, -87.65]];
    const { features } = buildTurnsGeoJson(turns, null);
    expect(features.every(f => f.properties.active === false)).toBe(true);
  });

  it("converts coordinates to GeoJSON [lon, lat] order", () => {
    const turns = [[41.88, -87.63]];
    const { features } = buildTurnsGeoJson(turns, null);
    expect(features[0].geometry.coordinates).toEqual([-87.63, 41.88]);
  });

  it("skips null/undefined entries in the turn array", () => {
    const turns = [null, [41.88, -87.63], undefined];
    const { features } = buildTurnsGeoJson(turns, null);
    expect(features).toHaveLength(1);
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

  it("passes activeTurnIndex into the turns GeoJSON", () => {
    const result = { path: [[41.88, -87.63], [41.89, -87.64]] };
    const turnCoords = [[41.88, -87.63], [41.89, -87.64]];
    renderWalkRoute(map, result, turnCoords, 1, layerIds, sourceIds);
    const call = map.addSource.mock.calls.find(c => c[0] === "walk-turns");
    const features = call[1].data.features;
    const activeFeature = features.find(f => f.properties.active === true);
    expect(activeFeature).toBeTruthy();
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
});
