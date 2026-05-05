import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WPIcon, WP_ICON_NAMES } from "./walkpath-icons.jsx";

describe("WPIcon", () => {
  it.each(WP_ICON_NAMES)("renders %s with the right viewBox + currentColor default", (name) => {
    const { container } = render(<WPIcon name={name} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
  });

  it("respects size prop", () => {
    const { container } = render(<WPIcon name="stride" size={32} />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
  });

  it("forwards aria-label", () => {
    const { getByLabelText } = render(<WPIcon name="stride" aria-label="Walking pace" />);
    expect(getByLabelText("Walking pace")).toBeInTheDocument();
  });
});
