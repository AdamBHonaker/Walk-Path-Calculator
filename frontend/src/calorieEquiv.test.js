import { describe, it, expect } from "vitest";
import { calorieEquivalent } from "./calorieEquiv.js";

describe("calorieEquivalent", () => {
  it("returns null for zero", () => {
    expect(calorieEquivalent(0)).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(calorieEquivalent(null)).toBeNull();
    expect(calorieEquivalent(undefined)).toBeNull();
  });

  it("returns null for negative values", () => {
    expect(calorieEquivalent(-50)).toBeNull();
  });

  it("matches a banana exactly at 90 cal", () => {
    expect(calorieEquivalent(90)).toBe("≈ 1 banana, returned to the day.");
  });

  it("uses 'half a' at 45 cal (half a banana)", () => {
    expect(calorieEquivalent(45)).toBe("≈ half a banana, returned to the day.");
  });

  it("pluralises at 2× the food's calories", () => {
    expect(calorieEquivalent(180)).toBe("≈ 2 bananas, returned to the day.");
  });

  it("matches a can of soda at 150 cal", () => {
    expect(calorieEquivalent(150)).toBe("≈ 1 can of soda, returned to the day.");
  });

  it("returns a string starting with ≈", () => {
    expect(calorieEquivalent(100)).toMatch(/^≈/);
  });
});
