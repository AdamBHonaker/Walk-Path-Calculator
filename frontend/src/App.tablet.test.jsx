import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import App from "./App.jsx";

// Build a matchMedia stub that reports a fixed viewport width so the
// (max-width: ...) and (min-width: ...) queries used by App.jsx and
// PaceSelector resolve deterministically.
function makeViewportMatchMedia(width) {
  return vi.fn((query) => {
    let matches = false;
    const max = query.match(/\(max-width:\s*(\d+)px\)/);
    const min = query.match(/\(min-width:\s*(\d+)px\)/);
    const minOnly = !max && min;
    const maxOnly = !min && max;
    if (maxOnly) matches = width <= parseInt(max[1], 10);
    else if (minOnly) matches = width >= parseInt(min[1], 10);
    else if (min && max) {
      matches =
        width >= parseInt(min[1], 10) && width <= parseInt(max[1], 10);
    }
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
}

describe("Tablet range layout (FEAT-007)", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("at 600 px: applies app--tablet, uses desktop two-column layout (no sheet)", () => {
    window.matchMedia = makeViewportMatchMedia(600);
    const { container } = render(<App />);
    const root = container.querySelector(".app");
    expect(root).not.toBeNull();
    expect(root.classList.contains("app--tablet")).toBe(true);
    expect(root.classList.contains("app--mobile")).toBe(false);
    // Desktop layout renders .panel-cards + .panel-map; the mobile sheet shell
    // (.mobile-shell) must not be present in the tablet range.
    expect(container.querySelector(".panel-cards")).not.toBeNull();
    expect(container.querySelector(".panel-map")).not.toBeNull();
    expect(container.querySelector(".mobile-shell")).toBeNull();
  });

  it("at 900 px: applies app--tablet, uses desktop two-column layout (no sheet)", () => {
    window.matchMedia = makeViewportMatchMedia(900);
    const { container } = render(<App />);
    const root = container.querySelector(".app");
    expect(root.classList.contains("app--tablet")).toBe(true);
    expect(root.classList.contains("app--mobile")).toBe(false);
    expect(container.querySelector(".panel-cards")).not.toBeNull();
    expect(container.querySelector(".mobile-shell")).toBeNull();
  });

  it("at 1200 px: no tablet class, plain desktop two-column layout", () => {
    window.matchMedia = makeViewportMatchMedia(1200);
    const { container } = render(<App />);
    const root = container.querySelector(".app");
    expect(root.classList.contains("app--tablet")).toBe(false);
    expect(root.classList.contains("app--mobile")).toBe(false);
    expect(container.querySelector(".panel-cards")).not.toBeNull();
  });

  it("at 400 px: mobile sheet still wins (sheet stays mobile-only)", () => {
    window.matchMedia = makeViewportMatchMedia(400);
    const { container } = render(<App />);
    const root = container.querySelector(".app");
    expect(root.classList.contains("app--mobile")).toBe(true);
    expect(root.classList.contains("app--tablet")).toBe(false);
    expect(container.querySelector(".mobile-shell")).not.toBeNull();
    // Two-column desktop sidebar is not rendered at mobile widths.
    expect(container.querySelector(".panel-cards")).toBeNull();
  });
});
