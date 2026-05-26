import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { MapExploreLayer } from "./MapExploreLayer.jsx";

// Minimal MapLibre Map stub with spied add/remove methods. The component
// goes through mapHelpers.renderExplore, which calls addSource + addLayer
// for "explore-poly" / "explore-residential" / "explore-places" — the smoke
// test asserts the names that actually land on the map.
function makeFakeMap() {
  const sources = new Map();
  const layers = new Map();
  return {
    addSource: vi.fn((id, cfg) => sources.set(id, cfg)),
    removeSource: vi.fn((id) => sources.delete(id)),
    getSource: vi.fn((id) => sources.get(id) ?? null),
    addLayer: vi.fn((cfg) => layers.set(cfg.id, cfg)),
    removeLayer: vi.fn((id) => layers.delete(id)),
    getLayer: vi.fn((id) => layers.get(id) ?? null),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    isStyleLoaded: () => true,
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    fitBounds: vi.fn(),
    easeTo: vi.fn(),
    getCanvas: () => ({ style: {} }),
    // Inspection helpers — not on the real Map, just for the test.
    _sources: sources,
    _layers: layers,
  };
}

const POLY = {
  type: "Polygon",
  coordinates: [[
    [-87.65, 41.87], [-87.63, 41.87],
    [-87.63, 41.89], [-87.65, 41.89],
    [-87.65, 41.87],
  ]],
};

const FAKE_RESULT = {
  origin_coords: [41.88, -87.63],
  max_minutes: 20,
  polygon: POLY,
  within_reach_landmarks: [{ name: "Chicago Cultural Center", lat: 41.8838, lon: -87.6248 }],
  stats: { node_count: 1000, area_sq_mi: 1.2 },
  places: [
    { category: "coffee_bakery", subcategory: null, name: "A", lat: 41.88, lon: -87.64, address: "", source: "osm" },
    { category: "coffee_bakery", subcategory: null, name: "B", lat: 41.881, lon: -87.641, address: "", source: "osm" },
  ],
  residential_heatmap: null,
};

function Harness({ map, ...props }) {
  const ref = useRef(map);
  return <MapExploreLayer mapRef={ref} {...props} />;
}

afterEach(() => {
  cleanup();
});

describe("MapExploreLayer (smoke)", () => {
  it("registers the polygon and supercluster sources when an explore result arrives", () => {
    const map = makeFakeMap();
    render(
      <Harness
        map={map}
        mode="explore"
        exploreResult={FAKE_RESULT}
        showResidential={false}
        activeSubs={new Set(["coffee_bakery"])}
        categoryStyles={[{ key: "coffee_bakery", color: "#8e6a3a", glyph: "C" }]}
      />,
    );
    expect(map._sources.has("explore-poly")).toBe(true);
    expect(map._sources.has("explore-places")).toBe(true);
    // Polygon fill + stroke layers come from renderExplore.
    expect(map._layers.has("explore-poly-fill")).toBe(true);
    expect(map._layers.has("explore-poly-stroke")).toBe(true);
    // Supercluster setup — pin layer and cluster layer both wired up.
    expect(map._layers.has("explore-places-pin")).toBe(true);
    expect(map._layers.has("explore-places-cluster")).toBe(true);
  });

  it("adds the residential heatmap source only when toggled on AND data present", () => {
    const map = makeFakeMap();
    const withHeatmap = {
      ...FAKE_RESULT,
      residential_heatmap: {
        type: "MultiPolygon",
        coordinates: [[[[-87.65, 41.87], [-87.63, 41.87], [-87.63, 41.88], [-87.65, 41.87]]]],
      },
    };
    render(
      <Harness
        map={map}
        mode="explore"
        exploreResult={withHeatmap}
        showResidential={true}
        activeSubs={new Set()}
        categoryStyles={[]}
      />,
    );
    expect(map._sources.has("explore-residential")).toBe(true);
    expect(map._layers.has("explore-residential-fill")).toBe(true);
  });

  it("clears explore layers when mode flips back to 'route'", () => {
    const map = makeFakeMap();
    const { rerender } = render(
      <Harness
        map={map}
        mode="explore"
        exploreResult={FAKE_RESULT}
        showResidential={false}
        activeSubs={new Set(["coffee_bakery"])}
        categoryStyles={[{ key: "coffee_bakery", color: "#8e6a3a", glyph: "C" }]}
      />,
    );
    expect(map._sources.has("explore-poly")).toBe(true);

    rerender(
      <Harness
        map={map}
        mode="route"
        exploreResult={FAKE_RESULT}
        showResidential={false}
        activeSubs={new Set(["coffee_bakery"])}
        categoryStyles={[{ key: "coffee_bakery", color: "#8e6a3a", glyph: "C" }]}
      />,
    );
    expect(map._sources.has("explore-poly")).toBe(false);
    expect(map._sources.has("explore-places")).toBe(false);
    expect(map._layers.has("explore-poly-fill")).toBe(false);
  });

  it("does not register any explore sources when result is null", () => {
    const map = makeFakeMap();
    render(
      <Harness
        map={map}
        mode="explore"
        exploreResult={null}
        showResidential={false}
        activeSubs={new Set()}
        categoryStyles={[]}
      />,
    );
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });
});
