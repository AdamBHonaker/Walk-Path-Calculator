import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapPickLayer } from "./MapPickLayer.jsx";

// maplibre-gl is already mocked globally in test-setup.js.
// Mock mapHelpers to prevent real gesture unlock calls.
vi.mock("../mapHelpers.js", () => ({
  unlockMapGestures: vi.fn(),
  lockMapGestures: vi.fn(),
}));

import * as mapHelpers from "../mapHelpers.js";

// ── Map mock factory ───────────────────────────────────────────────────────

function createMapMock() {
  const handlers = {};
  return {
    on: vi.fn((event, handler) => { handlers[event] = handler; }),
    off: vi.fn(),
    getCanvas: () => ({ style: {} }),
    _trigger: (event, arg) => handlers[event]?.(arg),
    _handlers: handlers,
  };
}

// Wrapper that passes a pre-built mapRef to MapPickLayer.
function PickLayerWrapper({ mapMock, ...props }) {
  return <MapPickLayer mapRef={{ current: mapMock }} {...props} />;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("MapPickLayer", () => {
  let mapMock;

  beforeEach(() => {
    mapMock = createMapMock();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("pickMode=false", () => {
    it("does not render the hint text when pickMode=false", () => {
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={false}
          resolveLabel={() => Promise.resolve("test")}
          onPickPoint={vi.fn()}
        />
      );
      expect(screen.queryByText(/pan or zoom/i)).not.toBeInTheDocument();
    });

    it("renders nothing visible when pickMode=false and no preview", () => {
      const { container } = render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={false}
          resolveLabel={() => Promise.resolve("test")}
          onPickPoint={vi.fn()}
        />
      );
      // No hint, no confirm card
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("pickMode=true", () => {
    it("shows the map-pick-hint text when pickMode=true", () => {
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("test")}
          onPickPoint={vi.fn()}
        />
      );
      expect(screen.getByText(/pan or zoom/i)).toBeInTheDocument();
    });

    it("calls unlockMapGestures with the map when pickMode=true", () => {
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("test")}
          onPickPoint={vi.fn()}
        />
      );
      expect(mapHelpers.unlockMapGestures).toHaveBeenCalledWith(mapMock);
    });

    it("registers a click handler on the map via map.on", () => {
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("test")}
          onPickPoint={vi.fn()}
        />
      );
      expect(mapMock.on).toHaveBeenCalledWith("click", expect.any(Function));
    });
  });

  describe("map click → preview card", () => {
    it("shows confirm card after a map click", async () => {
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("Some Place")}
          onPickPoint={vi.fn()}
        />
      );

      // Trigger the map click event
      await act(async () => {
        mapMock._trigger("click", { lngLat: { lng: -87.63, lat: 41.88 } });
      });

      // Confirm button should appear
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    });

    it("shows Cancel button after a map click", async () => {
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("Some Place")}
          onPickPoint={vi.fn()}
        />
      );

      await act(async () => {
        mapMock._trigger("click", { lngLat: { lng: -87.63, lat: 41.88 } });
      });

      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    });

    it("shows resolved label after resolveLabel settles", async () => {
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("Wrigleyville")}
          onPickPoint={vi.fn()}
        />
      );

      await act(async () => {
        mapMock._trigger("click", { lngLat: { lng: -87.6553, lat: 41.9476 } });
      });

      await waitFor(() => {
        expect(screen.queryByText("Looking up that spot…")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Wrigleyville")).toBeInTheDocument();
    });

    it("hides hint after click (confirm card replaces it)", async () => {
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("Test")}
          onPickPoint={vi.fn()}
        />
      );

      // Before click: hint visible
      expect(screen.getByText(/pan or zoom/i)).toBeInTheDocument();

      await act(async () => {
        mapMock._trigger("click", { lngLat: { lng: -87.63, lat: 41.88 } });
      });

      // After click: hint gone, confirm card shown
      expect(screen.queryByText(/pan or zoom/i)).not.toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("cancel button", () => {
    it("clicking Cancel removes the confirm card", async () => {
      const user = userEvent.setup();
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("Test Label")}
          onPickPoint={vi.fn()}
        />
      );

      await act(async () => {
        mapMock._trigger("click", { lngLat: { lng: -87.63, lat: 41.88 } });
      });

      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("confirm button", () => {
    it("clicking Confirm calls onPickPoint with (lat, lon, label)", async () => {
      const user = userEvent.setup();
      const onPickPoint = vi.fn();

      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("Some Street")}
          onPickPoint={onPickPoint}
        />
      );

      await act(async () => {
        mapMock._trigger("click", { lngLat: { lng: -87.63, lat: 41.88 } });
      });

      // Wait for the resolving state to settle
      await waitFor(() => {
        expect(screen.queryByText("Looking up that spot…")).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /confirm/i }));

      expect(onPickPoint).toHaveBeenCalledTimes(1);
      const [calledLat, calledLon, calledLabel] = onPickPoint.mock.calls[0];
      expect(calledLat).toBeCloseTo(41.88, 4);
      expect(calledLon).toBeCloseTo(-87.63, 4);
      expect(calledLabel).toBe("Some Street");
    });

    it("clicking Confirm dismisses the confirm card", async () => {
      const user = userEvent.setup();
      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={() => Promise.resolve("Label")}
          onPickPoint={vi.fn()}
        />
      );

      await act(async () => {
        mapMock._trigger("click", { lngLat: { lng: -87.63, lat: 41.88 } });
      });

      await waitFor(() => {
        expect(screen.queryByText("Looking up that spot…")).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /confirm/i }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("race condition: stale resolveLabel response discarded", () => {
    it("second click's label wins when first resolveLabel resolves late", async () => {
      let resolveFirst;
      let callCount = 0;

      const resolveLabel = vi.fn((lat, lng) => {
        callCount++;
        if (callCount === 1) {
          // First click: resolveLabel hangs until we manually resolve it
          return new Promise(resolve => { resolveFirst = resolve; });
        }
        // Second click: resolves immediately
        return Promise.resolve("Second Label");
      });

      render(
        <PickLayerWrapper
          mapMock={mapMock}
          pickMode={true}
          resolveLabel={resolveLabel}
          onPickPoint={vi.fn()}
        />
      );

      // First click
      await act(async () => {
        mapMock._trigger("click", { lngLat: { lng: -87.63, lat: 41.88 } });
      });

      // Second click before first resolves
      await act(async () => {
        mapMock._trigger("click", { lngLat: { lng: -87.64, lat: 41.89 } });
      });

      // Now resolve the first (stale) request — should be ignored
      await act(async () => {
        resolveFirst("First Label (stale)");
        await new Promise(r => setTimeout(r, 0));
      });

      // Wait for the second resolveLabel to settle
      await waitFor(() => {
        expect(screen.queryByText("Looking up that spot…")).not.toBeInTheDocument();
      });

      // Second label should win
      expect(screen.getByText("Second Label")).toBeInTheDocument();
      expect(screen.queryByText("First Label (stale)")).not.toBeInTheDocument();
    });
  });
});
