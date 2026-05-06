import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShareDispatch } from "./ShareDispatch.jsx";

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

describe("ShareDispatch", () => {
  it("renders null when result is null", () => {
    const { container } = render(
      <ShareDispatch result={null} originLabel="A" destLabel="B" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders step count when result is provided", () => {
    render(
      <ShareDispatch result={VALID_RESULT} originLabel="Wrigleyville" destLabel="Logan Square" />,
    );
    expect(screen.getByText("4,200")).toBeInTheDocument();
  });

  it("renders miles, minutes, and calories", () => {
    render(
      <ShareDispatch result={VALID_RESULT} originLabel="A" destLabel="B" />,
    );
    // Stats are rendered as a number above its caps unit label.
    expect(screen.getByText("2.1")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("172")).toBeInTheDocument();
    expect(screen.getByText(/^miles$/i)).toBeInTheDocument();
    expect(screen.getByText(/^minutes$/i)).toBeInTheDocument();
    expect(screen.getByText(/^calories$/i)).toBeInTheDocument();
  });

  it("renders origin and destination labels", () => {
    render(
      <ShareDispatch result={VALID_RESULT} originLabel="Wrigleyville" destLabel="Logan Square" />,
    );
    // Title is a single h1 with text broken up by inline spans for "From"/"to";
    // assert the names appear anywhere in the heading.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/Wrigleyville/);
    expect(heading).toHaveTextContent(/Logan Square/);
  });

  it("prints the site host when provided so screenshots advertise the URL", () => {
    render(
      <ShareDispatch
        result={VALID_RESULT}
        originLabel="A"
        destLabel="B"
        siteHost="passage.app"
      />,
    );
    expect(screen.getByText("passage.app")).toBeInTheDocument();
    expect(screen.getByText(/^plan yours at$/i)).toBeInTheDocument();
  });

  it("omits the visit strip when siteHost is empty", () => {
    render(
      <ShareDispatch result={VALID_RESULT} originLabel="A" destLabel="B" />,
    );
    expect(screen.queryByText(/plan yours at/i)).not.toBeInTheDocument();
  });
});
