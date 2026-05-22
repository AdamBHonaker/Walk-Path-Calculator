import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePersonalization } from "./usePersonalization.js";

const HEIGHT_FT_KEY = "walkpath:heightFt";
const HEIGHT_IN_KEY = "walkpath:heightIn";

// Shape produced by readUrlParams() — only hft/hin matter here.
const params = (hft, hin) => ({ from: "", to: "", stops: null, hft, hin });

describe("usePersonalization — hft/hin atomic pairing (BUG-001)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the visitor's stored height when the URL carries hft but no hin", () => {
    localStorage.setItem(HEIGHT_FT_KEY, "5");
    localStorage.setItem(HEIGHT_IN_KEY, "8");

    const { result } = renderHook(() => usePersonalization(params(6, null)));

    // Lone hft is not a complete pair — fall back to stored values for both.
    expect(result.current.heightFt).toBe(5);
    expect(result.current.heightIn).toBe(8);
    // The mount-time save effect must not delete the stored inches.
    expect(localStorage.getItem(HEIGHT_IN_KEY)).toBe("8");
  });

  it("does not resurrect a removed inches key from a lone-hft link", () => {
    // No stored height at all — the effect must not throw or write garbage.
    const { result } = renderHook(() => usePersonalization(params(6, null)));

    expect(result.current.heightFt).toBeNull();
    expect(result.current.heightIn).toBeNull();
    expect(localStorage.getItem(HEIGHT_IN_KEY)).toBeNull();
  });

  it("ignores an out-of-range hin (parsed to null) and preserves stored inches", () => {
    // urlParams.js nulls any hin outside 0–11, so the hook sees hin: null.
    localStorage.setItem(HEIGHT_IN_KEY, "8");

    const { result } = renderHook(() => usePersonalization(params(6, null)));

    expect(result.current.heightIn).toBe(8);
    expect(localStorage.getItem(HEIGHT_IN_KEY)).toBe("8");
  });

  it("fully replaces height when the URL carries a complete hft+hin pair", () => {
    localStorage.setItem(HEIGHT_FT_KEY, "5");
    localStorage.setItem(HEIGHT_IN_KEY, "8");

    const { result } = renderHook(() => usePersonalization(params(6, 2)));

    expect(result.current.heightFt).toBe(6);
    expect(result.current.heightIn).toBe(2);
    // Replace semantics — the link's height persists over the stored one.
    expect(localStorage.getItem(HEIGHT_FT_KEY)).toBe("6");
    expect(localStorage.getItem(HEIGHT_IN_KEY)).toBe("2");
  });

  it("uses stored height when the URL carries no height params", () => {
    localStorage.setItem(HEIGHT_FT_KEY, "5");
    localStorage.setItem(HEIGHT_IN_KEY, "8");

    const { result } = renderHook(() => usePersonalization(params(null, null)));

    expect(result.current.heightFt).toBe(5);
    expect(result.current.heightIn).toBe(8);
  });
});
