import "@testing-library/jest-dom";
import { vi } from "vitest";

// maplibre-gl requires WebGL which jsdom does not support; stub the Map class
vi.mock("maplibre-gl", () => ({
  default: {
    Map: class {
      constructor() {}
      scrollZoom = { disable() {}, enable() {} };
      dragPan    = { disable() {}, enable() {} };
      dragRotate = { disable() {}, enable() {} };
      doubleClickZoom = { disable() {}, enable() {} };
      touchZoomRotate = { disable() {}, enable() {} };
      keyboard   = { disable() {}, enable() {} };
      once() {}
      on() {}
      off() {}
      remove() {}
      isStyleLoaded() { return true; }
      resize() {}
      triggerRepaint() {}
      fitBounds() {}
      flyTo() {}
      addSource() {}
      addLayer() {}
      removeLayer() {}
      removeSource() {}
      getSource() { return null; }
      getCanvas() { return null; }
      setPaintProperty() {}
    },
  },
}));

// jsdom does not implement matchMedia; return a stub that never matches
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
