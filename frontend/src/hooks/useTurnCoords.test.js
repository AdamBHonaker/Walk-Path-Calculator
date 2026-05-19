import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTurnCoords } from "./useTurnCoords.js";

// Mock haversineMeters so tests are deterministic and don't depend on
// real spherical geometry. The mock computes a simple Euclidean-ish distance
// scaled so 0.001° ≈ 111 m (close enough for the interpolation logic under test).
vi.mock("../mapHelpers.js", () => ({
  haversineMeters: vi.fn(([lat1, lon1], [lat2, lon2]) => {
    const dLat = (lat2 - lat1) * 111320;
    const dLon = (lon2 - lon1) * 111320 * Math.cos(lat1 * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }),
}));

// ── useTurnCoords ─────────────────────────────────────────────────────────

describe("useTurnCoords", () => {
  it("returns [] for empty path and directions", () => {
    const { result } = renderHook(() => useTurnCoords([], []));
    expect(result.current).toEqual([]);
  });

  it("returns [] for null path and null directions", () => {
    const { result } = renderHook(() => useTurnCoords(null, null));
    expect(result.current).toEqual([]);
  });

  it("returns [] for undefined path and undefined directions", () => {
    const { result } = renderHook(() => useTurnCoords(undefined, undefined));
    expect(result.current).toEqual([]);
  });

  it("returns [] when path has entries but directions is empty", () => {
    const path = [[41.88, -87.63], [41.89, -87.63]];
    const { result } = renderHook(() => useTurnCoords(path, []));
    expect(result.current).toEqual([]);
  });

  it("returns [] when directions has entries but path is empty", () => {
    const directions = [{ distance_meters: 100 }];
    const { result } = renderHook(() => useTurnCoords([], directions));
    expect(result.current).toEqual([]);
  });

  it("single direction with distance_meters=0: turn lands at start of path", () => {
    // distance_meters=0 means the turn threshold is at cumulative 0,
    // so the turn is at the very first point of the path.
    const path = [[41.88, -87.63], [41.90, -87.63]];
    const directions = [{ distance_meters: 0 }];
    const { result } = renderHook(() => useTurnCoords(path, directions));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toBeDefined();
    // At t=0, the interpolated point should equal path[0]
    expect(result.current[0][0]).toBeCloseTo(path[0][0], 5);
    expect(result.current[0][1]).toBeCloseTo(path[0][1], 5);
  });

  it("turn at threshold = segLen lands exactly at the segment endpoint", () => {
    // thresholds[i] = cumulative distance before direction i starts.
    // To place a turn marker at path[1] (= end of the first segment),
    // we need threshold[1] = segLen. That requires directions[0].distance_meters = segLen.
    const segLen = 111320 * 0.01; // 0.01° lat ≈ 1113 m
    const path = [[41.88, -87.63], [41.89, -87.63], [41.90, -87.63]];
    const directions = [
      { distance_meters: segLen }, // threshold[0]=0 → turn at path[0]
      { distance_meters: 0 },      // threshold[1]=segLen → turn at path[1]
    ];
    const { result } = renderHook(() => useTurnCoords(path, directions));
    expect(result.current).toHaveLength(2);
    // The second turn (index 1) should land at path[1] ≈ [41.89, -87.63]
    expect(result.current[1]).toBeDefined();
    expect(result.current[1][0]).toBeCloseTo(41.89, 3);
    expect(result.current[1][1]).toBeCloseTo(-87.63, 4);
  });

  it("multiple turns on a long path: turn markers placed at correct positions", () => {
    const path = [
      [41.88, -87.63],
      [41.90, -87.63],
      [41.92, -87.63],
    ];
    const seg1Len = 111320 * 0.02; // ~2224 m
    // directions[i].distance_meters = length of step i.
    // thresholds[0] = 0 (first turn at origin), thresholds[1] = seg1Len/2
    const directions = [
      { distance_meters: seg1Len / 2 }, // threshold[0]=0 → first turn at path[0]
      { distance_meters: seg1Len },      // threshold[1]=seg1Len/2 → second turn mid-segment 1
    ];
    const { result } = renderHook(() => useTurnCoords(path, directions));
    expect(result.current).toHaveLength(2);
    // First turn is at distance 0 → path[0]
    expect(result.current[0][0]).toBeCloseTo(41.88, 4);
    // Second turn is at threshold = seg1Len/2 = midpoint of segment 0→1
    expect(result.current[1][0]).toBeCloseTo(41.89, 3);
  });

  it("turn with threshold beyond path length gets anchored to last point", () => {
    // path has total length ≈ 1113 m. A second direction whose threshold
    // exceeds this (1500 m) cannot be placed and falls back to the last point.
    const path = [[41.88, -87.63], [41.89, -87.63]];
    const segLen = 111320 * 0.01; // ≈ 1113 m
    const directions = [
      { distance_meters: 1500 }, // threshold[0]=0 → turn at path[0]
      { distance_meters: 0 },    // threshold[1]=1500 > total (1113+10) → anchored
    ];
    const { result } = renderHook(() => useTurnCoords(path, directions));
    expect(result.current).toHaveLength(2);
    // Second turn (unplaced) is anchored to the last polyline point
    expect(result.current[1]).toBeDefined();
    expect(result.current[1][0]).toBeCloseTo(41.89, 5);
    expect(result.current[1][1]).toBeCloseTo(-87.63, 5);
  });

  it("no undefined values in the result array", () => {
    const path = [[41.88, -87.63], [41.89, -87.63]];
    const directions = [
      { distance_meters: 500 },
      { distance_meters: 1_000_000 }, // beyond path
    ];
    const { result } = renderHook(() => useTurnCoords(path, directions));
    expect(result.current.every(c => c !== undefined)).toBe(true);
    expect(result.current.every(c => c !== null)).toBe(true);
  });

  it("±10 m tolerance: threshold at pathCum + segLen + 9 is absorbed by current segment", () => {
    // A segment of exactly 100 m. Place a turn at 100 + 9 = 109 m, which is
    // within the 10 m tolerance, so it should still be placed in this segment.
    const segLen = 100;
    // Construct path so first segment is ~100 m.
    // 100 / 111320 ≈ 0.000898°
    const dLat = 100 / 111320;
    const path = [
      [41.88, -87.63],
      [41.88 + dLat, -87.63],
      [41.90, -87.63], // second segment is much longer
    ];
    const directions = [{ distance_meters: segLen + 9 }]; // within ±10 m tolerance
    const { result } = renderHook(() => useTurnCoords(path, directions));
    expect(result.current).toHaveLength(1);
    // The turn should be resolved (not undefined) by the first segment thanks to tolerance
    expect(result.current[0]).toBeDefined();
  });

  it("zero-length segment: turn placed at the segment start point", () => {
    // If two consecutive identical points create a zero-length segment,
    // the turn at that position should land at the segment start.
    const path = [
      [41.88, -87.63],
      [41.88, -87.63], // identical to previous = zero length
      [41.90, -87.63],
    ];
    const directions = [{ distance_meters: 0 }];
    const { result } = renderHook(() => useTurnCoords(path, directions));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toBeDefined();
    expect(result.current[0][0]).toBeCloseTo(41.88, 5);
    expect(result.current[0][1]).toBeCloseTo(-87.63, 5);
  });

  it("result array has correct length matching directions count", () => {
    const path = [
      [41.88, -87.63],
      [41.89, -87.63],
      [41.90, -87.63],
      [41.91, -87.63],
    ];
    const seg = 111320 * 0.01; // ~1113 m per segment
    const directions = [
      { distance_meters: 0 },
      { distance_meters: seg },
      { distance_meters: seg * 2 },
    ];
    const { result } = renderHook(() => useTurnCoords(path, directions));
    expect(result.current).toHaveLength(3);
  });
});
