import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { formatBlocks } from "./lib/directionFormat.js";
import { calorieEquivalent } from "./calorieEquiv.js";
import { lbToKg } from "./lib/units.js";
import { loadDailyGoal, loadStoredPace } from "./lib/personaPrefs.js";
import { PACE_LABELS, motivationMessage } from "./lib/routeFormat.js";
import { RECENT_MAX, loadRecentSearches, saveRecentSearch, recentEntryStops, formatRecentChip } from "./lib/recentSearches.js";
import { parseStopsParam, MAX_STOPS } from "./lib/urlParams.js";
import { STEP_LOG_TTL_DAYS, loadStepLog, logWalk, clearStepLog } from "./lib/stepLog.js";

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
    expect(motivationMessage(4000)).toMatch(/serious walk/i);
    expect(motivationMessage(6999)).toMatch(/serious walk/i);
  });

  it("returns almost-full-day message for 7000–9999 steps", () => {
    expect(motivationMessage(7000)).toMatch(/full day/i);
    expect(motivationMessage(9999)).toMatch(/full day/i);
  });

  it("returns over-10k message for 10000+ steps", () => {
    expect(motivationMessage(10000)).toMatch(/ten thousand/i);
    expect(motivationMessage(15000)).toMatch(/ten thousand/i);
  });
});

// ── calorieEquivalent ────────────────────────────────────────────────────

describe("calorieEquivalent", () => {
  it("returns null for zero calories", () => {
    expect(calorieEquivalent(0)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(calorieEquivalent(null)).toBeNull();
  });

  it("returns a string starting with ≈", () => {
    expect(calorieEquivalent(100)).toMatch(/^≈/);
  });

  it("picks exact match for banana at 90 cal", () => {
    expect(calorieEquivalent(90)).toBe("≈ 1 banana, returned to the day.");
  });

  it("picks half a banana for 45 cal", () => {
    expect(calorieEquivalent(45)).toBe("≈ half a banana, returned to the day.");
  });

  it("uses plural for 2+ items", () => {
    expect(calorieEquivalent(180)).toBe("≈ 2 bananas, returned to the day.");
  });

  it("picks exact match for can of soda at 150 cal", () => {
    expect(calorieEquivalent(150)).toBe("≈ 1 can of soda, returned to the day.");
  });
});

// ── handleHeightChange (height-to-inches conversion) ─────────────────────

describe("height-to-inches conversion in App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
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

    // Open the Personalize modal and select 5 ft 9 in
    await user.click(screen.getByRole("button", { name: /add your particulars/i }));

    const ftSelect = screen.getByRole("combobox", { name: /height feet/i });
    const inSelect = screen.getByRole("combobox", { name: /height inches/i });
    await user.selectOptions(ftSelect, "5");
    await user.selectOptions(inSelect, "9");

    // Close modal and submit
    await user.click(screen.getByRole("button", { name: /keep these particulars/i }));
    await user.click(screen.getByRole("button", { name: /commence the journey/i }));

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

    await user.click(screen.getByRole("button", { name: /commence the journey/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.height_inches).toBeNull();
  });
});

// ── handleSubmit error handling ───────────────────────────────────────────

describe("handleSubmit error handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
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
    await user.click(screen.getByRole("button", { name: /commence the journey/i }));

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
    await user.click(screen.getByRole("button", { name: /commence the journey/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to fetch")
    );
  });
});

// ── animated route drawing — markers render before animation frames fire ──

describe("animated route drawing", () => {
  const mockResult = {
    origin_coords: [41.9, -87.6],
    dest_coords: [41.88, -87.63],
    total_miles: 1.2,
    total_minutes: 24,
    total_steps: 2520,
    calories_approx: 103,
    daily_goal_pct: 25,
    step_length_inches: 28.5,
    personalized: false,
    path: [[41.9, -87.6], [41.88, -87.63]],
    directions: [],
  };

  function makeMatchMedia(prefersReduced = false) {
    return vi.fn((query) => ({
      matches: prefersReduced && query === "(prefers-reduced-motion: reduce)",
      media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("requestAnimationFrame", vi.fn()); // capture without firing
    window.matchMedia = makeMatchMedia(false);        // fresh vi.fn() each test
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("renders origin/dest markers synchronously before any animation frame fires", async () => {
    const user = userEvent.setup();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

    render(<App />);

    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Wrigleyville");
    await user.type(toInput, "Logan Square");
    await user.click(screen.getByRole("button", { name: /commence the journey/i }));

    // Unlock map button appears only when result != null — proves markers rendered
    // synchronously without waiting for any RAF callback to fire
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /unlock map/i })).toBeInTheDocument()
    );

    // Animation was scheduled (RAF was called) but never fired — map was still populated
    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it("does not schedule animation when prefers-reduced-motion is active", async () => {
    window.matchMedia = makeMatchMedia(true); // override before render
    const user = userEvent.setup();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

    render(<App />);

    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Wrigleyville");
    await user.type(toInput, "Logan Square");
    await user.click(screen.getByRole("button", { name: /commence the journey/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /unlock map/i })).toBeInTheDocument()
    );

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});

// ── lbToKg ────────────────────────────────────────────────────────────────

describe("lbToKg", () => {
  it("converts 154 lb to approximately 69.85 kg", () => {
    expect(lbToKg(154)).toBeCloseTo(154 / 2.20462, 3);
  });

  it("converts 0 lb to 0 kg", () => {
    expect(lbToKg(0)).toBe(0);
  });

  it("doubling lb doubles kg", () => {
    expect(lbToKg(200)).toBeCloseTo(lbToKg(100) * 2, 5);
  });
});

// ── WeightInput sends weight_kg in kg ─────────────────────────────────────

describe("WeightInput sends weight_kg in kg", () => {
  const mockResult = {
    origin_coords: [41.9, -87.6],
    dest_coords: [41.88, -87.63],
    total_miles: 1.2,
    total_minutes: 24,
    total_steps: 2520,
    calories_approx: 115,
    daily_goal_pct: 25,
    step_length_inches: 30,
    personalized: false,
    personalized_calories: true,
    path: [[41.9, -87.6], [41.88, -87.63]],
    directions: [],
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("sends weight_kg as kg when entered in lbs", async () => {
    const user = userEvent.setup();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

    render(<App />);

    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Wrigleyville");
    await user.type(toInput, "Logan Square");

    // Open the Personalize modal and enter 154 lbs
    await user.click(screen.getByRole("button", { name: /add your particulars/i }));

    const weightInput = screen.getByRole("spinbutton", { name: /weight in pounds/i });
    await user.clear(weightInput);
    await user.type(weightInput, "154");

    await user.click(screen.getByRole("button", { name: /keep these particulars/i }));
    await user.click(screen.getByRole("button", { name: /commence the journey/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.weight_kg).toBeCloseTo(154 / 2.20462, 1);
  });

  it("sends null weight_kg when weight is not entered", async () => {
    const user = userEvent.setup();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

    render(<App />);

    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Lincoln Park");
    await user.type(toInput, "River North");

    await user.click(screen.getByRole("button", { name: /commence the journey/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.weight_kg).toBeNull();
  });
});

// ── URL-Encoded Route Sharing ─────────────────────────────────────────────

describe("URL-Encoded Route Sharing", () => {
  const mockResult = {
    origin_coords: [41.9476, -87.6553],
    dest_coords:   [41.9290, -87.7000],
    total_miles: 2.8,
    total_minutes: 56,
    total_steps: 5880,
    calories_approx: 241,
    daily_goal_pct: 59,
    step_length_inches: 30,
    personalized: false,
    path: [[41.9476, -87.6553], [41.9290, -87.7000]],
    directions: [],
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("pre-populates form fields from ?from and ?to URL params", () => {
    window.history.replaceState(null, "", "?from=Wrigleyville&to=Logan+Square");
    render(<App />);
    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    expect(fromInput.value).toBe("Wrigleyville");
    expect(toInput.value).toBe("Logan Square");
  });

  it("auto-submits on mount when both URL params are present", async () => {
    window.history.replaceState(null, "", "?from=Wrigleyville&to=Logan+Square");
    fetch.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

    render(<App />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.origin).toBe("Wrigleyville");
    expect(body.destination).toBe("Logan Square");
  });

  it("does not auto-submit when only one URL param is present", async () => {
    window.history.replaceState(null, "", "?from=Wrigleyville");
    render(<App />);
    // Allow a tick for any effects
    await new Promise(r => setTimeout(r, 50));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("writes ?from and ?to to the URL after a successful fetch", async () => {
    const user = userEvent.setup();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

    render(<App />);

    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Wrigleyville");
    await user.type(toInput, "Logan Square");
    await user.click(screen.getByRole("button", { name: /commence the journey/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("from")).toBe("Wrigleyville");
    expect(params.get("to")).toBe("Logan Square");
  });

  it("includes height params in URL when height is set", async () => {
    const user = userEvent.setup();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

    render(<App />);

    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Wrigleyville");
    await user.type(toInput, "Logan Square");

    await user.click(screen.getByRole("button", { name: /add your particulars/i }));
    await user.selectOptions(screen.getByRole("combobox", { name: /height feet/i }), "5");
    await user.selectOptions(screen.getByRole("combobox", { name: /height inches/i }), "9");
    await user.click(screen.getByRole("button", { name: /keep these particulars/i }));

    await user.click(screen.getByRole("button", { name: /commence the journey/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("hft")).toBe("5");
    expect(params.get("hin")).toBe("9");
  });

  it("pre-populates height from URL params hft and hin", () => {
    window.history.replaceState(null, "", "?from=Wrigleyville&to=Logan+Square&hft=5&hin=9");
    render(<App />);
    // Height toggle should reflect the height from URL
    expect(screen.getByRole("button", { name: /5′ 9″/i })).toBeInTheDocument();
  });
});

// ── loadDailyGoal ────────────────────────────────────────────────────────

describe("loadDailyGoal", () => {
  beforeEach(() => localStorage.clear());

  it("returns null when key is absent", () => {
    expect(loadDailyGoal()).toBeNull();
  });

  it("returns the stored number when valid", () => {
    localStorage.setItem("walkpath:dailyGoal", "10000");
    expect(loadDailyGoal()).toBe(10000);
  });

  it("returns null for a value below 1000", () => {
    localStorage.setItem("walkpath:dailyGoal", "500");
    expect(loadDailyGoal()).toBeNull();
  });

  it("returns null for a value above 100000", () => {
    localStorage.setItem("walkpath:dailyGoal", "200000");
    expect(loadDailyGoal()).toBeNull();
  });

  it("returns null for a non-numeric string", () => {
    localStorage.setItem("walkpath:dailyGoal", "abc");
    expect(loadDailyGoal()).toBeNull();
  });

  it("accepts boundary value 1000", () => {
    localStorage.setItem("walkpath:dailyGoal", "1000");
    expect(loadDailyGoal()).toBe(1000);
  });

  it("accepts boundary value 100000", () => {
    localStorage.setItem("walkpath:dailyGoal", "100000");
    expect(loadDailyGoal()).toBe(100000);
  });
});

// ── loadStoredPace ───────────────────────────────────────────────────────

describe("loadStoredPace", () => {
  beforeEach(() => localStorage.clear());

  it("returns 'normal' when key is absent", () => {
    expect(loadStoredPace()).toBe("normal");
  });

  it("returns 'leisurely' when stored", () => {
    localStorage.setItem("walkpath:walkPace", "leisurely");
    expect(loadStoredPace()).toBe("leisurely");
  });

  it("returns 'brisk' when stored", () => {
    localStorage.setItem("walkpath:walkPace", "brisk");
    expect(loadStoredPace()).toBe("brisk");
  });

  it("returns 'normal' for an unrecognised pace string", () => {
    localStorage.setItem("walkpath:walkPace", "sprint");
    expect(loadStoredPace()).toBe("normal");
  });
});

// ── PACE_LABELS ──────────────────────────────────────────────────────────

describe("PACE_LABELS", () => {
  it("has an entry for every valid pace value", () => {
    expect(PACE_LABELS).toMatchObject({
      leisurely: expect.any(String),
      normal:    expect.any(String),
      brisk:     expect.any(String),
    });
  });
});

// ── loadRecentSearches / saveRecentSearch ────────────────────────────────

describe("recent searches", () => {
  beforeEach(() => localStorage.clear());

  it("returns empty array when nothing is stored", () => {
    expect(loadRecentSearches()).toEqual([]);
  });

  it("returns empty array when storage is corrupted JSON", () => {
    localStorage.setItem("walkpath:recentSearches", "not-json{{{");
    expect(loadRecentSearches()).toEqual([]);
  });

  it("returns empty array when stored value is not an array", () => {
    localStorage.setItem("walkpath:recentSearches", JSON.stringify({ key: "val" }));
    expect(loadRecentSearches()).toEqual([]);
  });

  it("saves and retrieves a search entry", () => {
    saveRecentSearch("Wrigleyville", "Logan Square");
    const results = loadRecentSearches();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ origin: "Wrigleyville", destination: "Logan Square" });
    expect(typeof results[0].timestamp).toBe("number");
  });

  it("deduplicates identical origin+destination pairs, keeping the newest", () => {
    saveRecentSearch("A", "B");
    saveRecentSearch("A", "B");
    expect(loadRecentSearches()).toHaveLength(1);
  });

  it("prepends new entries so the most recent is first", () => {
    saveRecentSearch("A", "B");
    saveRecentSearch("C", "D");
    const results = loadRecentSearches();
    expect(results[0]).toMatchObject({ origin: "C", destination: "D" });
    expect(results[1]).toMatchObject({ origin: "A", destination: "B" });
  });

  it(`caps stored entries at RECENT_MAX (${RECENT_MAX})`, () => {
    for (let i = 0; i < RECENT_MAX + 5; i++) {
      saveRecentSearch(`Origin ${i}`, `Dest ${i}`);
    }
    expect(loadRecentSearches()).toHaveLength(RECENT_MAX);
  });

  it("supports multi-stop via array form", () => {
    saveRecentSearch(["A", "B", "C"]);
    const results = loadRecentSearches();
    expect(results[0].stops).toEqual(["A", "B", "C"]);
    expect(results[0].origin).toBe("A");
    expect(results[0].destination).toBe("C");
  });

  it("recentEntryStops reads legacy 2-stop entries", () => {
    expect(recentEntryStops({ origin: "A", destination: "B" })).toEqual(["A", "B"]);
    expect(recentEntryStops({ stops: ["A", "B", "C"] })).toEqual(["A", "B", "C"]);
    expect(recentEntryStops({})).toEqual([]);
  });
});

// ── multi-stop helpers ───────────────────────────────────────────────────

describe("parseStopsParam", () => {
  it("returns null for missing or single-entry input", () => {
    expect(parseStopsParam("")).toBeNull();
    expect(parseStopsParam(null)).toBeNull();
    expect(parseStopsParam("Wrigleyville")).toBeNull();
  });

  it("splits and trims pipe-separated stops", () => {
    expect(parseStopsParam("A|B|C")).toEqual(["A", "B", "C"]);
    expect(parseStopsParam(" A | B | C ")).toEqual(["A", "B", "C"]);
  });

  it("filters out empty entries before length check", () => {
    expect(parseStopsParam("A||B")).toEqual(["A", "B"]);
    expect(parseStopsParam("A|")).toBeNull();
  });

  it(`caps at MAX_STOPS (${MAX_STOPS})`, () => {
    const many = Array.from({ length: MAX_STOPS + 3 }, (_, i) => `S${i}`).join("|");
    expect(parseStopsParam(many)).toHaveLength(MAX_STOPS);
  });
});

describe("formatRecentChip", () => {
  it("renders 2 stops with arrow", () => {
    expect(formatRecentChip(["A", "B"])).toBe("A → B");
  });
  it("renders up to 4 stops fully", () => {
    expect(formatRecentChip(["A", "B", "C", "D"])).toBe("A → B → C → D");
  });
  it("collapses 5+ stops to A → … → Z (N stops)", () => {
    expect(formatRecentChip(["A", "B", "C", "D", "E"])).toBe("A → … → E (5 stops)");
  });
});

// ── step log (Multi-Day Step Accumulator) ───────────────────────────────

describe("step log", () => {
  beforeEach(() => localStorage.clear());

  it("returns empty array when nothing is stored", () => {
    expect(loadStepLog()).toEqual([]);
  });

  it("returns empty array when storage is corrupted JSON", () => {
    localStorage.setItem("walkpath:stepLog", "not-json{{{");
    expect(loadStepLog()).toEqual([]);
  });

  it("returns empty array when stored value is not an array", () => {
    localStorage.setItem("walkpath:stepLog", JSON.stringify({ a: 1 }));
    expect(loadStepLog()).toEqual([]);
  });

  it("logWalk persists an entry that loadStepLog returns", () => {
    logWalk({ steps: 5000, miles: 2.5, origin: "A", destination: "B" });
    const log = loadStepLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      steps: 5000,
      miles: 2.5,
      origin: "A",
      destination: "B",
    });
    expect(typeof log[0].timestamp).toBe("number");
    expect(typeof log[0].date).toBe("string");
  });

  it("logWalk prepends entries so newest is first", () => {
    logWalk({ steps: 1000, miles: 0.5, origin: "A", destination: "B" });
    logWalk({ steps: 2000, miles: 1.0, origin: "C", destination: "D" });
    const log = loadStepLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ origin: "C", destination: "D" });
    expect(log[1]).toMatchObject({ origin: "A", destination: "B" });
  });

  it(`expires entries older than ${STEP_LOG_TTL_DAYS} days on load`, () => {
    const now = Date.now();
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    const oneDayAgo    = now - 1 * 24 * 60 * 60 * 1000;
    localStorage.setItem("walkpath:stepLog", JSON.stringify([
      { timestamp: oneDayAgo,    date: "old", steps: 100, miles: 0.1, origin: "X", destination: "Y" },
      { timestamp: eightDaysAgo, date: "old", steps: 999, miles: 9.9, origin: "X", destination: "Y" },
    ]));
    const log = loadStepLog();
    expect(log).toHaveLength(1);
    expect(log[0].steps).toBe(100);
    // pruned list should be persisted back
    const stored = JSON.parse(localStorage.getItem("walkpath:stepLog"));
    expect(stored).toHaveLength(1);
  });

  it("clearStepLog removes all entries", () => {
    logWalk({ steps: 100, miles: 0.1, origin: "A", destination: "B" });
    expect(loadStepLog()).toHaveLength(1);
    clearStepLog();
    expect(loadStepLog()).toEqual([]);
  });
});

// ── Alternative-route flavor tabs ────────────────────────────────────────

describe("alternative route flavor tabs", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState(null, "", "/");
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  function makeRoutesPayload() {
    const mk = (flavor, miles, mins, steps) => ({
      flavor,
      total_miles: miles,
      total_minutes: mins,
      total_steps: steps,
      calories_approx: 100,
      daily_goal_pct: 25,
      path: [[41.9, -87.6], [41.88, -87.63]],
      directions: [{
        street: `Via ${flavor}`,
        direction: "S",
        direction_full: "South",
        blocks: 1,
        block_type: "long",
        minutes: mins,
        distance_meters: 200,
        distance_miles: miles,
        steps,
      }],
    });
    return {
      origin_coords: [41.9, -87.6],
      dest_coords:   [41.88, -87.63],
      step_length_inches: 30,
      personalized: false,
      default_flavor: "fastest",
      available_flavors: ["fastest", "fewest_turns", "greenest"],
      routes: [
        mk("fastest",      1.2, 24, 2520),
        mk("fewest_turns", 1.4, 28, 2940),
        mk("greenest",     1.5, 30, 3150),
      ],
      // legacy mirror = fastest
      total_miles: 1.2, total_minutes: 24, total_steps: 2520,
      calories_approx: 100, daily_goal_pct: 25,
      path: [[41.9, -87.6], [41.88, -87.63]],
      directions: [{
        street: "Via fastest", direction: "S", direction_full: "South",
        blocks: 1, block_type: "long", minutes: 24,
        distance_meters: 200, distance_miles: 1.2, steps: 2520,
      }],
    };
  }

  async function submitAndAwaitResult(user) {
    const [fromInput, toInput] = screen.getAllByRole("searchbox");
    await user.type(fromInput, "Wrigleyville");
    await user.type(toInput, "Logan Square");
    await user.click(screen.getByRole("button", { name: /commence the journey/i }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Fastest/i })).toBeInTheDocument());
  }

  it("renders three flavor tabs after a successful route", async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => makeRoutesPayload() });
    const user = userEvent.setup();
    render(<App />);
    await submitAndAwaitResult(user);

    expect(screen.getByRole("tab", { name: /Fastest/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Fewest turns/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Greenest/i })).toBeInTheDocument();
  });

  it("defaults to fastest and switches the visible totals when another tab is clicked", async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => makeRoutesPayload() });
    const user = userEvent.setup();
    render(<App />);
    await submitAndAwaitResult(user);

    // fastest is selected initially → 2,520 steps shown in StepHero
    expect(screen.getByRole("tab", { name: /Fastest/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("2,520")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Greenest/i }));

    expect(screen.getByRole("tab", { name: /Greenest/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("3,150")).toBeInTheDocument();
  });

  it("does not refetch when switching tabs", async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => makeRoutesPayload() });
    const user = userEvent.setup();
    render(<App />);
    await submitAndAwaitResult(user);
    expect(fetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: /Fewest turns/i }));
    await user.click(screen.getByRole("tab", { name: /Greenest/i }));

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
