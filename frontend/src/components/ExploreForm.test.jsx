// Tests for the Neighborhood Explorer's origin selector + community-area
// combobox. Chunk 4 of the Local-First Geocoding feature swapped the static
// <select> of 77 community areas for an AddressAutocomplete in
// "local filter" mode (the picker filters the 77 names locally and never
// hits /autocomplete — the backend's lookup_centroid only accepts those
// exact strings). These tests lock in that combobox behavior so a future
// regression in the local-filter logic surfaces quickly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { ExploreForm } from "./ExploreForm.jsx";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function defaults(overrides = {}) {
  return {
    origin: { kind: "community_area", communityArea: "Loop" },
    onOriginChange: vi.fn(),
    maxMinutes: 20,
    onMaxMinutesChange: vi.fn(),
    onSubmit: vi.fn(),
    loading: false,
    reachableNeighborhoods: [],
    onChipClick: vi.fn(),
    onLocateMe: vi.fn(),
    locating: false,
    geoError: null,
    ...overrides,
  };
}

describe("ExploreForm — community-area combobox (chunk 4)", () => {
  it("renders the community-area picker as an AddressAutocomplete combobox", () => {
    render(<ExploreForm {...defaults()} />);
    const combo = screen.getByRole("combobox", { name: "Community area" });
    expect(combo).toBeInTheDocument();
    expect(combo.value).toBe("Loop");
  });

  it("filters the 77 community-area names by prefix as the user types", async () => {
    render(<ExploreForm {...defaults()} />);
    const combo = screen.getByRole("combobox", { name: "Community area" });

    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "log" } });
    await advance(200);

    const options = screen.getAllByRole("option");
    const labels = options.map(o => o.textContent || "");
    // "Logan Square" is the obvious prefix hit; "Logan Square" alone is in
    // the 77 names list — should be present.
    expect(labels.some(lb => lb.includes("Logan Square"))).toBe(true);
  });

  it("commits the origin only when a known community area is selected", async () => {
    const onOriginChange = vi.fn();
    render(<ExploreForm {...defaults({ onOriginChange })} />);
    const combo = screen.getByRole("combobox", { name: "Community area" });

    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "log" } });
    await advance(200);

    const loganSquare = screen
      .getAllByRole("option")
      .find(o => (o.textContent || "").includes("Logan Square"));
    expect(loganSquare).toBeDefined();
    fireEvent.mouseDown(loganSquare);

    expect(onOriginChange).toHaveBeenCalledWith({
      kind: "community_area",
      communityArea: "Logan Square",
    });
  });

  it("does NOT call onOriginChange while the user is mid-type", async () => {
    const onOriginChange = vi.fn();
    render(<ExploreForm {...defaults({ onOriginChange })} />);
    const combo = screen.getByRole("combobox", { name: "Community area" });

    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "humb" } });
    await advance(200);

    // The user typed a partial string. Since they haven't picked a
    // suggestion yet, the parent's origin state must NOT change — the
    // backend's lookup_centroid would reject "humb" and 400 the request.
    expect(onOriginChange).not.toHaveBeenCalled();
  });

  it("hides the combobox when origin kind is 'current' (My location)", () => {
    render(
      <ExploreForm
        {...defaults({ origin: { kind: "current", communityArea: null } })}
      />,
    );
    expect(
      screen.queryByRole("combobox", { name: "Community area" }),
    ).not.toBeInTheDocument();
  });

  it("toggling origin kind back to community_area restores the combobox", () => {
    const { rerender } = render(
      <ExploreForm
        {...defaults({ origin: { kind: "current", communityArea: null } })}
      />,
    );
    expect(
      screen.queryByRole("combobox", { name: "Community area" }),
    ).not.toBeInTheDocument();

    rerender(
      <ExploreForm
        {...defaults({ origin: { kind: "community_area", communityArea: "Uptown" } })}
      />,
    );
    const combo = screen.getByRole("combobox", { name: "Community area" });
    expect(combo.value).toBe("Uptown");
  });
});
