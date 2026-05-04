import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RouteCard from "./RouteCard.jsx";

const VALID_RESULT = {
  total_steps: 4200,
  total_miles: 2.1,
  total_minutes: 42,
  calories_approx: 172,
  pace: "normal",
  path: [[41.88, -87.63], [41.89, -87.64]],
  origin_coords: [41.88, -87.63],
  dest_coords: [41.89, -87.64],
};

describe("RouteCard", () => {
  it("renders null when result is null", () => {
    const { container } = render(
      <RouteCard result={null} originLabel="A" destLabel="B" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders step count when result is provided", () => {
    render(
      <RouteCard result={VALID_RESULT} originLabel="Wrigleyville" destLabel="Logan Square" />,
    );
    expect(screen.getByText("4,200")).toBeInTheDocument();
  });

  it("renders miles, minutes, and calories", () => {
    render(
      <RouteCard result={VALID_RESULT} originLabel="A" destLabel="B" />,
    );
    expect(screen.getByText(/2\.1 mi/)).toBeInTheDocument();
    expect(screen.getByText(/42 min/)).toBeInTheDocument();
    expect(screen.getByText(/172 cal/)).toBeInTheDocument();
  });

  it("renders origin and destination labels", () => {
    render(
      <RouteCard result={VALID_RESULT} originLabel="Wrigleyville" destLabel="Logan Square" />,
    );
    expect(screen.getByText("Wrigleyville")).toBeInTheDocument();
    expect(screen.getByText("Logan Square")).toBeInTheDocument();
  });
});
