import { describe, it, expect } from "vitest";
import {
  drivingMinutes,
  transitMinutes,
  rideShareCost,
  co2AvoidedKg,
  summarize,
} from "./compareEstimates.js";

describe("drivingMinutes", () => {
  it("returns 0 for non-positive miles", () => {
    expect(drivingMinutes(0)).toBe(0);
    expect(drivingMinutes(-1)).toBe(0);
  });

  it("scales linearly with miles at the 22 mph constant", () => {
    expect(drivingMinutes(2.2)).toBeCloseTo(6, 1);
    expect(drivingMinutes(11)).toBeCloseTo(30, 1);
  });
});

describe("transitMinutes", () => {
  it("returns 0 for non-positive walk minutes", () => {
    expect(transitMinutes(0)).toBe(0);
    expect(transitMinutes(-10)).toBe(0);
  });

  it("enforces an 8-minute floor", () => {
    expect(transitMinutes(5)).toBe(8);
  });

  it("scales by 0.55 for longer walks", () => {
    expect(transitMinutes(60)).toBeCloseTo(33, 1);
  });
});

describe("rideShareCost", () => {
  it("is 0 for non-positive miles", () => {
    expect(rideShareCost(0)).toBe(0);
    expect(rideShareCost(-5)).toBe(0);
  });

  it("includes base + distance + time components", () => {
    // 0.5 mi: drive ≈ 1.36 min → 3.5 + 0.9 + ~0.41 ≈ $4.81
    const cost = rideShareCost(0.5);
    expect(cost).toBeGreaterThan(4);
    expect(cost).toBeLessThan(6);
  });

  it("grows with distance", () => {
    expect(rideShareCost(5)).toBeGreaterThan(rideShareCost(1));
  });
});

describe("co2AvoidedKg", () => {
  it("is 0 for non-positive miles", () => {
    expect(co2AvoidedKg(0)).toBe(0);
    expect(co2AvoidedKg(-3)).toBe(0);
  });

  it("matches the EPA per-mile constant", () => {
    expect(co2AvoidedKg(5)).toBeCloseTo(2.02, 2);
  });
});

describe("summarize", () => {
  it("returns all four fields", () => {
    const s = summarize(2, 40);
    expect(s).toHaveProperty("driveMin");
    expect(s).toHaveProperty("transitMin");
    expect(s).toHaveProperty("costUsd");
    expect(s).toHaveProperty("co2Kg");
  });

  it("zero-mile guard returns zeros", () => {
    expect(summarize(0, 0)).toEqual({
      driveMin: 0,
      transitMin: 0,
      costUsd: 0,
      co2Kg: 0,
    });
  });
});
