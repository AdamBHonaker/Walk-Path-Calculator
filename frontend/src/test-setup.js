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
      addSource() {}
      addLayer() {}
      removeLayer() {}
      removeSource() {}
    },
  },
}));
