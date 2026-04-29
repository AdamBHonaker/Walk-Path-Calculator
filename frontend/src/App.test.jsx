import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { formatBlocks, motivationMessage } from "./App.jsx";

// ── formatBlocks ─────────────────────────────────────────────────────────

describe("formatBlocks", () => {
  it("returns singular for 1 long block", () => {
    expect(formatBlocks(1, "long")).toBe("1 long block");
  });

  it("returns plural for multiple long blocks", () => {
    expect(formatBlocks(3, "long")).toBe("3 long blocks");
  });

  it("returns singular for 1 short block", () => {
    expect(formatBlocks(1, "short")).toBe("1 short block");
  });

  it("returns plural for multiple short blocks", () => {
    expect(formatBlocks(2, "short")).toBe("2 short blocks");
  });
});

// ── motivationMessage ────────────────────────────────────────────────────

describe("motivationMessage", () => {
  it("returns short-walk message for fewer than 1500 steps", () => {
    expect(motivationMessage(0)).toMatch(/short walk/i);
    expect(motivationMessage(1499)).toMatch(/short walk/i);
  });

  it("returns neighborhood-walk message for 1500–3999 steps", () => {
    expect(motivationMessage(1500)).toMatch(/neighborhood walk/i);
    expect(motivationMessage(3999)).toMatch(/neighborhood walk/i);
  });

  it("returns serious-steps message for 4000–6999 steps", () => {
    expect(motivationMessage(4000)).toMatch(/serious steps/i);
    expect(motivationMessage(6999)).toMatch(/serious steps/i);
  });

  it("returns almost-full-day message for 7000–9999 steps", () => {
    expect(motivationMessage(7000)).toMatch(/full day/i);
    expect(motivationMessage(9999)).toMatch(/full day/i);
  });

  it("returns over-10k message for 10000+ steps", () => {
    expect(motivationMessage(10000)).toMatch(/10,000 steps/i);
    expect(motivationMessage(15000)).toMatch(/10,000 steps/i);
  });
});

// ── handleHeightChange (height-to-inches conversion) ─────────────────────

describe("height-to-inches conversion in App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct height_inches when both ft and in are selected", async () => {
    const user = userEvent.setup();
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        origin_coords: [41.9, -87.6],
        dest_coords: [41.88, -87.63],
        total_miles: 1.2,
        total_minutes: 24,
        total_steps: 2520,
        calories_approx: 103,
        daily_goal_pct: 25,
        step_length_inches: 28.5,
        personalized: true,
        path: [[41.9, -87.6], [41.88, -87.63]],
        directions: [],
      }),
    });

    render(<App />);

    // Fill in origin and destination
    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Wrigleyville");
    await user.type(toInput, "Logan Square");

    // Open height picker and select 5 ft 9 in
    const heightToggle = screen.getByRole("button", { name: /add your height/i });
    await user.click(heightToggle);

    const ftSelect = screen.getByRole("combobox", { name: /height feet/i });
    const inSelect = screen.getByRole("combobox", { name: /height inches/i });
    await user.selectOptions(ftSelect, "5");
    await user.selectOptions(inSelect, "9");

    // Submit
    await user.click(screen.getByRole("button", { name: /get walking route/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.height_inches).toBe(69); // 5 * 12 + 9
  });

  it("sends null height_inches when height is not selected", async () => {
    const user = userEvent.setup();
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        origin_coords: [41.9, -87.6],
        dest_coords: [41.88, -87.63],
        total_miles: 0.5,
        total_minutes: 10,
        total_steps: 1000,
        calories_approx: 41,
        daily_goal_pct: 10,
        step_length_inches: 30,
        personalized: false,
        path: [[41.9, -87.6]],
        directions: [],
      }),
    });

    render(<App />);

    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Lincoln Park");
    await user.type(toInput, "River North");

    await user.click(screen.getByRole("button", { name: /get walking route/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.height_inches).toBeNull();
  });
});

// ── handleSubmit error handling ───────────────────────────────────────────

describe("handleSubmit error handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a server error message when the API returns a non-ok response", async () => {
    const user = userEvent.setup();
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ detail: "Origin not found in Chicago" }),
    });

    render(<App />);

    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Nowhere");
    await user.type(toInput, "Somewhere");
    await user.click(screen.getByRole("button", { name: /get walking route/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Origin not found in Chicago")
    );
  });

  it("shows a generic error message on network failure", async () => {
    const user = userEvent.setup();
    fetch.mockRejectedValueOnce(new Error("Failed to fetch"));

    render(<App />);

    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Wrigleyville");
    await user.type(toInput, "Logan Square");
    await user.click(screen.getByRole("button", { name: /get walking route/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to fetch")
    );
  });
});
