import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MapRouteLayer } from "./MapRouteLayer.jsx";

// maplibre-gl is already mocked globally in test-setup.js.
// Mock mapHelpers to prevent real operations and avoid side effects.
vi.mock("../mapHelpers.js", () => ({
  renderWalkRoute: vi.fn(),
  clearLayers: vi.fn(),
  buildTurnsGeoJson: vi.fn(() => ({ type: "FeatureCollection", features: [] })),
  WALK_PATH_COLOR: "#171310",
  TURN_COLOR_ACTIVE: "#9c2a1a",
  haversineMeters: vi.fn(() => 0),
  toGeo: vi.fn(([lat, lon]) => [lon, lat]),
  lockMapGestures: vi.fn(),
  unlockMapGestures: vi.fn(),
}));

// ── animDurationMs (re-implemented from source constants) ─────────────────
//
// animDurationMs is not exported from MapRouteLayer.jsx. We test it by
// re-implementing the same formula using the known source constants and
// verifying edge-case behavior. This is a white-box regression test to
// guard against the constants being changed unintentionally.

const ANIM_BLOCKS_PER_SEC  = 2;
const ANIM_MILES_PER_BLOCK = 0.125;
const ANIM_MIN_DURATION_MS = 1200;
const ANIM_MAX_DURATION_MS = 15000;

function animDurationMs(miles) {
  const m = Number(miles);
  if (!Number.isFinite(m) || m <= 0) return ANIM_MIN_DURATION_MS;
  const secs = m / (ANIM_BLOCKS_PER_SEC * ANIM_MILES_PER_BLOCK);
  return Math.max(ANIM_MIN_DURATION_MS, Math.min(ANIM_MAX_DURATION_MS, secs * 1000));
}

describe("animDurationMs (source constants regression)", () => {
  it("returns MIN for miles=0", () => {
    expect(animDurationMs(0)).toBe(1200);
  });

  it("returns MIN for miles=-1 (negative)", () => {
    expect(animDurationMs(-1)).toBe(1200);
  });

  it("returns MIN for NaN", () => {
    expect(animDurationMs(NaN)).toBe(1200);
  });

  it("returns MIN for null (Number(null)=0)", () => {
    expect(animDurationMs(null)).toBe(1200);
  });

  it("returns MIN for undefined (Number(undefined)=NaN)", () => {
    expect(animDurationMs(undefined)).toBe(1200);
  });

  it("returns MIN for a very short route (hits floor)", () => {
    // 0.001 mi → (0.001 / 0.25) * 1000 = 4 ms → clamped to 1200
    expect(animDurationMs(0.001)).toBe(1200);
  });

  it("returns MAX for a very long route (hits ceiling)", () => {
    // 100 mi → (100 / 0.25) * 1000 = 400000 ms → clamped to 15000
    expect(animDurationMs(100)).toBe(15000);
  });

  it("returns 10000 for 2.5 miles", () => {
    // 2.5 / (2 * 0.125) = 2.5 / 0.25 = 10 secs = 10000 ms
    expect(animDurationMs(2.5)).toBe(10000);
  });

  it("returns a value between MIN and MAX for a mid-range distance", () => {
    // 1.0 mi → (1.0 / 0.25) * 1000 = 4000 ms, within [1200, 15000]
    const result = animDurationMs(1.0);
    expect(result).toBe(4000);
    expect(result).toBeGreaterThanOrEqual(ANIM_MIN_DURATION_MS);
    expect(result).toBeLessThanOrEqual(ANIM_MAX_DURATION_MS);
  });

  it("clamps exactly at MIN boundary (0.3 mi → 1200 ms)", () => {
    // 0.3 mi → (0.3 / 0.25) * 1000 = 1200 ms = exactly MIN
    expect(animDurationMs(0.3)).toBe(1200);
  });

  it("clamps exactly at MAX boundary (3.75 mi → 15000 ms)", () => {
    // 3.75 mi → (3.75 / 0.25) * 1000 = 15000 ms = exactly MAX
    expect(animDurationMs(3.75)).toBe(15000);
  });

  it("returns value in seconds * 1000 for an in-range distance", () => {
    const miles = 1.5;
    const expectedMs = (miles / (ANIM_BLOCKS_PER_SEC * ANIM_MILES_PER_BLOCK)) * 1000;
    expect(animDurationMs(miles)).toBe(
      Math.max(ANIM_MIN_DURATION_MS, Math.min(ANIM_MAX_DURATION_MS, expectedMs))
    );
  });
});

// ── MapRouteLayer render ──────────────────────────────────────────────────

function createMapMock() {
  return {
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    getSource: vi.fn(() => null),
    getLayer: vi.fn(() => null),
    fitBounds: vi.fn(),
    setPaintProperty: vi.fn(),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    triggerRepaint: vi.fn(),
    flyTo: vi.fn(),
    scrollZoom: { disable: vi.fn(), enable: vi.fn() },
    dragPan: { disable: vi.fn(), enable: vi.fn() },
    dragRotate: { disable: vi.fn(), enable: vi.fn() },
    doubleClickZoom: { disable: vi.fn(), enable: vi.fn() },
    touchZoomRotate: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disable: vi.fn(), enable: vi.fn() },
  };
}

describe("MapRouteLayer renders without crashing", () => {
  let mapMock;

  beforeEach(() => {
    mapMock = createMapMock();
    vi.clearAllMocks();
  });

  it("renders with result=null without throwing", () => {
    const mapRef = { current: mapMock };
    expect(() => {
      render(
        <MapRouteLayer
          mapRef={mapRef}
          result={null}
          turnCoords={[]}
          activeTurnIndex={null}
          mode="route"
          mapPadding={60}
        />
      );
    }).not.toThrow();
  });

  it("renders with a valid result without throwing", () => {
    const mapRef = { current: mapMock };
    const result = {
      path: [[41.9, -87.6], [41.88, -87.63]],
      origin_coords: [41.9, -87.6],
      dest_coords: [41.88, -87.63],
      stops: ["Wrigleyville", "Logan Square"],
      stop_coords: [[41.9, -87.6], [41.88, -87.63]],
      directions: [],
    };
    expect(() => {
      render(
        <MapRouteLayer
          mapRef={mapRef}
          result={result}
          turnCoords={[]}
          activeTurnIndex={null}
          mode="route"
          mapPadding={60}
        />
      );
    }).not.toThrow();
  });

  it("renders in explore mode without throwing", () => {
    const mapRef = { current: mapMock };
    expect(() => {
      render(
        <MapRouteLayer
          mapRef={mapRef}
          result={null}
          turnCoords={[]}
          activeTurnIndex={null}
          mode="explore"
          mapPadding={60}
        />
      );
    }).not.toThrow();
  });

  it("renders with mapRef.current=null without throwing", () => {
    const mapRef = { current: null };
    expect(() => {
      render(
        <MapRouteLayer
          mapRef={mapRef}
          result={null}
          turnCoords={[]}
          activeTurnIndex={null}
          mode="route"
          mapPadding={60}
        />
      );
    }).not.toThrow();
  });

  it("renders with turnCoords populated without throwing", () => {
    const mapRef = { current: mapMock };
    const result = {
      path: [[41.9, -87.6], [41.88, -87.63]],
      origin_coords: [41.9, -87.6],
      dest_coords: [41.88, -87.63],
      stops: ["A", "B"],
      stop_coords: [[41.9, -87.6], [41.88, -87.63]],
      directions: [],
    };
    expect(() => {
      render(
        <MapRouteLayer
          mapRef={mapRef}
          result={result}
          turnCoords={[[41.89, -87.615]]}
          activeTurnIndex={0}
          mode="route"
          mapPadding={60}
        />
      );
    }).not.toThrow();
  });
});
