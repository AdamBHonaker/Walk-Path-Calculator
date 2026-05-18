import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the network layer at the module boundary so the hook's request shape
// is exercised end-to-end without hitting fetchWithTimeout.
vi.mock("../lib/exploreApi.js", () => ({
  fetchExplore: vi.fn(),
}));

import { fetchExplore } from "../lib/exploreApi.js";
import { useExploreFetch } from "./useExploreFetch.js";

const DEFAULT_PREFS = {
  origin: { kind: "community_area", communityArea: "Loop" },
  maxMinutes: 20,
  selectedCategories: [],
  selectedSubs: [],
};

const FAKE_RESULT = {
  origin_coords: [41.88, -87.63],
  max_minutes: 20,
  polygon: { type: "Polygon", coordinates: [[[-87.65, 41.87], [-87.63, 41.87], [-87.63, 41.89], [-87.65, 41.89], [-87.65, 41.87]]] },
  reachable_neighborhoods: ["Loop"],
  stats: { node_count: 1000, area_sq_mi: 1.2 },
  places: [],
  residential_heatmap: null,
};

beforeEach(() => {
  fetchExplore.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useExploreFetch", () => {
  it("starts idle when mode is 'route'", () => {
    const { result } = renderHook(() =>
      useExploreFetch({ mode: "route", explorePrefs: DEFAULT_PREFS }),
    );
    expect(result.current.exploreResult).toBe(null);
    expect(result.current.exploreLoading).toBe(false);
    expect(result.current.exploreError).toBe("");
    expect(fetchExplore).not.toHaveBeenCalled();
  });

  it("auto-fetches on first entry into explore mode", async () => {
    fetchExplore.mockResolvedValueOnce(FAKE_RESULT);
    const { result } = renderHook(() =>
      useExploreFetch({ mode: "explore", explorePrefs: DEFAULT_PREFS }),
    );
    await waitFor(() => expect(result.current.exploreResult).toEqual(FAKE_RESULT));
    expect(fetchExplore).toHaveBeenCalledTimes(1);
    expect(result.current.exploreLoading).toBe(false);
  });

  it("surfaces backend errors via exploreError", async () => {
    fetchExplore.mockRejectedValueOnce(new Error("Service unavailable"));
    const { result } = renderHook(() =>
      useExploreFetch({ mode: "explore", explorePrefs: DEFAULT_PREFS }),
    );
    await waitFor(() => expect(result.current.exploreError).toBe("Service unavailable"));
    expect(result.current.exploreResult).toBe(null);
    expect(result.current.exploreLoading).toBe(false);
  });

  it("surfaces a friendly error when the request times out (BUG-001 regression)", async () => {
    // Pre-fix, a TimeoutError-shaped AbortError silently cleared the loading
    // flag without setting exploreError — leaving the form stuck looking idle.
    fetchExplore.mockRejectedValueOnce(
      Object.assign(new Error("Request timed out after 12000 ms"), { name: "TimeoutError" }),
    );
    const { result } = renderHook(() =>
      useExploreFetch({ mode: "explore", explorePrefs: DEFAULT_PREFS }),
    );
    await waitFor(() => expect(result.current.exploreError).toMatch(/didn't respond in time/));
    expect(result.current.exploreResult).toBe(null);
    expect(result.current.exploreLoading).toBe(false);
  });

  it("refuses to fetch a 'current' origin without coordinates", async () => {
    const prefs = { ...DEFAULT_PREFS, origin: { kind: "current", communityArea: null } };
    const { result } = renderHook(() =>
      useExploreFetch({ mode: "explore", explorePrefs: prefs }),
    );
    await waitFor(() => expect(result.current.exploreError).toContain("location access"));
    expect(fetchExplore).not.toHaveBeenCalled();
  });

  it("aborts the in-flight request on unmount", async () => {
    // Resolve only after we capture the signal so the unmount can fire mid-flight.
    let capturedSignal;
    fetchExplore.mockImplementationOnce(({ signal }) => {
      capturedSignal = signal;
      return new Promise(() => { /* never resolves */ });
    });
    const { unmount } = renderHook(() =>
      useExploreFetch({ mode: "explore", explorePrefs: DEFAULT_PREFS }),
    );
    await waitFor(() => expect(fetchExplore).toHaveBeenCalledTimes(1));
    expect(capturedSignal.aborted).toBe(false);
    unmount();
    expect(capturedSignal.aborted).toBe(true);
  });

  it("refetches when the category selection changes after an initial result", async () => {
    fetchExplore.mockResolvedValue(FAKE_RESULT);
    const { result, rerender } = renderHook(
      ({ prefs }) => useExploreFetch({ mode: "explore", explorePrefs: prefs }),
      { initialProps: { prefs: DEFAULT_PREFS } },
    );
    await waitFor(() => expect(result.current.exploreResult).toEqual(FAKE_RESULT));
    expect(fetchExplore).toHaveBeenCalledTimes(1);

    rerender({ prefs: { ...DEFAULT_PREFS, selectedCategories: ["coffee_bakery"] } });
    await waitFor(() => expect(fetchExplore).toHaveBeenCalledTimes(2));

    const secondCall = fetchExplore.mock.calls[1][0];
    expect(secondCall.categories).toContain("coffee_bakery");
  });

  it("sends ['__none__'] sentinel when nothing is selected", async () => {
    fetchExplore.mockResolvedValueOnce(FAKE_RESULT);
    renderHook(() =>
      useExploreFetch({ mode: "explore", explorePrefs: DEFAULT_PREFS }),
    );
    await waitFor(() => expect(fetchExplore).toHaveBeenCalledTimes(1));
    expect(fetchExplore.mock.calls[0][0].categories).toEqual(["__none__"]);
  });

  it("aborts the prior request when a new fetch starts", async () => {
    const signals = [];
    fetchExplore.mockImplementation(({ signal }) => {
      signals.push(signal);
      return new Promise(() => { /* never resolves */ });
    });
    const { result } = renderHook(() =>
      useExploreFetch({ mode: "explore", explorePrefs: DEFAULT_PREFS }),
    );
    await waitFor(() => expect(signals.length).toBe(1));
    await act(async () => {
      result.current.fetchExploreResult({ maxMinutes: 30 });
    });
    await waitFor(() => expect(signals.length).toBe(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});
