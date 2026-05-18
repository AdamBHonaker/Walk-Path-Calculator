import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRouteFetch } from "./useRouteFetch.js";

const mockResult = {
  origin_coords: [41.9, -87.6],
  dest_coords: [41.88, -87.63],
  total_miles: 1.2,
  total_minutes: 24,
  total_steps: 2520,
  calories_approx: 103,
  daily_goal_pct: 25,
  step_length_inches: 30,
  personalized: false,
  path: [[41.9, -87.6], [41.88, -87.63]],
  directions: [],
};

const baseProps = {
  heightFt: null, heightIn: null, weightKg: null, dailyGoal: null,
  walkPace: "leisurely",
  avoidStairs: false,
  preferPedestrian: false,
  mobilityProfile: "walking",
  initialUrlParams: { stops: null, from: null, to: null },
};

describe("useRouteFetch — mobility profile override", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => mockResult }));
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("sends user's walkPace and avoidStairs unchanged in walking mode", async () => {
    const { result } = renderHook(() => useRouteFetch(baseProps));
    await act(async () => {
      await result.current.fetchRoute(["A", "B"]);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.avoid_stairs).toBe(false);
    expect(body.pace).toBe("leisurely");
  });

  it("forces avoid_stairs=true and pace=normal when profile is wheeled, regardless of saved values", async () => {
    const { result } = renderHook(() =>
      useRouteFetch({
        ...baseProps,
        avoidStairs: false,        // user previously turned this off
        walkPace: "brisk",         // user previously picked brisk
        mobilityProfile: "wheeled",
      }),
    );
    await act(async () => {
      await result.current.fetchRoute(["A", "B"]);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.avoid_stairs).toBe(true);
    expect(body.pace).toBe("normal");
  });

  it("passes prefer_pedestrian through in both modes (user-toggleable)", async () => {
    const { result } = renderHook(() =>
      useRouteFetch({ ...baseProps, mobilityProfile: "wheeled", preferPedestrian: false }),
    );
    await act(async () => {
      await result.current.fetchRoute(["A", "B"]);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.prefer_pedestrian).toBe(false);
  });
});

describe("useRouteFetch — error surfacing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("surfaces a friendly error when the request times out (BUG-001 regression)", async () => {
    // Simulate the TimeoutError that fetchWithTimeout now raises when its
    // internal timer fires. Pre-fix, this rejected with a generic AbortError
    // and the catch block returned silently — leaving the user with no error
    // message and a cleared loading flag.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      Object.assign(new Error("Request timed out after 10000 ms"), { name: "TimeoutError" }),
    ));
    const { result } = renderHook(() => useRouteFetch(baseProps));
    await act(async () => {
      await result.current.fetchRoute(["A", "B"]);
    });
    await waitFor(() => expect(result.current.error).toMatch(/didn't respond in time/));
    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBe(null);
  });
});
