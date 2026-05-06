import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MobileLayout } from "./MobileLayout.jsx";

const LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 480px)";

function mockMatchMedia(matches) {
  window.matchMedia = vi.fn((query) => ({
    matches: query === LANDSCAPE_QUERY ? matches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("MobileLayout", () => {
  it("renders the masthead, the map, and the sheet body", () => {
    render(
      <MobileLayout
        masthead={<div data-testid="mh">masthead-here</div>}
        map={<div data-testid="map">map-canvas</div>}
      >
        <div data-testid="body">form-and-results</div>
      </MobileLayout>,
    );
    expect(screen.getByTestId("mh")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });

  it("places the masthead in front of the map for visual stacking", () => {
    const { container } = render(
      <MobileLayout
        masthead={<div data-testid="mh" />}
        map={<div data-testid="map" />}
      >
        <span>body</span>
      </MobileLayout>,
    );
    const shell = container.querySelector(".mobile-shell");
    expect(shell).not.toBeNull();
    const mapWrap = shell.querySelector(".mobile-shell-map");
    const headerWrap = shell.querySelector(".mobile-shell-header");
    expect(mapWrap).not.toBeNull();
    expect(headerWrap).not.toBeNull();
    // Header rendered after map in DOM order so it paints on top without z-index gymnastics.
    const children = Array.from(shell.children);
    expect(children.indexOf(headerWrap)).toBeGreaterThan(children.indexOf(mapWrap));
  });

  describe("landscape phone snap profile", () => {
    const originalMatchMedia = window.matchMedia;
    const originalInnerHeight = window.innerHeight;

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
    });

    it("uses 100dvh full snap on landscape phones (667x375 viewport)", () => {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 375,
      });
      mockMatchMedia(true);
      const { container } = render(
        <MobileLayout map={<div />}>
          <span>body</span>
        </MobileLayout>,
      );
      const sheet = container.querySelector(".wf-sheet");
      // Largest snap on landscape is "100dvh" → matches innerHeight (375).
      expect(sheet.style.height).toBe("375px");
    });

    it("uses 88dvh full snap on portrait phones", () => {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 800,
      });
      mockMatchMedia(false);
      const { container } = render(
        <MobileLayout map={<div />}>
          <span>body</span>
        </MobileLayout>,
      );
      const sheet = container.querySelector(".wf-sheet");
      // Largest snap on portrait is "88dvh" → round(800 * 0.88) = 704.
      expect(sheet.style.height).toBe("704px");
    });
  });

  it("renders without a masthead when none is provided", () => {
    const { container } = render(
      <MobileLayout map={<div />}>
        <span>body</span>
      </MobileLayout>,
    );
    expect(container.querySelector(".mobile-shell-header")).toBeNull();
  });
});
