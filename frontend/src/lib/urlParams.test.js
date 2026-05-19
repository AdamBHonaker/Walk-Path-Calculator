import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseStopsParam, readUrlParams, MAX_STOPS } from "./urlParams.js";

// ── parseStopsParam ──────────────────────────────────────────────────────

describe("parseStopsParam", () => {
  it("returns null for null input", () => {
    expect(parseStopsParam(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseStopsParam("")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseStopsParam(undefined)).toBeNull();
  });

  it("parses a two-segment pipe-delimited string", () => {
    expect(parseStopsParam("A|B")).toEqual(["A", "B"]);
  });

  it("parses a three-segment string", () => {
    expect(parseStopsParam("A|B|C")).toEqual(["A", "B", "C"]);
  });

  it("returns null when fewer than 2 non-empty segments", () => {
    expect(parseStopsParam("A")).toBeNull();
  });

  it("returns null when only one segment after filtering blanks", () => {
    expect(parseStopsParam("A|")).toBeNull();
  });

  it(`truncates to ${MAX_STOPS} segments when given more`, () => {
    const stops = Array.from({ length: MAX_STOPS + 3 }, (_, i) => `Stop${i}`);
    const result = parseStopsParam(stops.join("|"));
    expect(result).toHaveLength(MAX_STOPS);
    expect(result[0]).toBe("Stop0");
    expect(result[MAX_STOPS - 1]).toBe(`Stop${MAX_STOPS - 1}`);
  });

  it("handles exactly MAX_STOPS segments", () => {
    const stops = Array.from({ length: MAX_STOPS }, (_, i) => `Stop${i}`);
    const result = parseStopsParam(stops.join("|"));
    expect(result).toHaveLength(MAX_STOPS);
  });

  it("decodes a legacy double-encoded segment", () => {
    // Legacy URLs double-encoded each segment; decodeURIComponent recovers it.
    const encoded = "Logan%20Square";
    const result = parseStopsParam(`${encoded}|Wrigleyville`);
    expect(result).toEqual(["Logan Square", "Wrigleyville"]);
  });

  it("falls back to raw segment when decodeURIComponent throws", () => {
    // A bare % with no following hex digits is malformed and throws.
    const malformed = "Bad%ZZSegment";
    const result = parseStopsParam(`${malformed}|Wrigleyville`);
    // The malformed segment is kept as-is (raw fallback), trimmed.
    expect(result).not.toBeNull();
    expect(result[1]).toBe("Wrigleyville");
  });

  it("trims whitespace from each segment", () => {
    expect(parseStopsParam("  Wrigleyville  |  Logan Square  ")).toEqual([
      "Wrigleyville",
      "Logan Square",
    ]);
  });

  it("truncates individual segments to 200 characters", () => {
    const long = "x".repeat(250);
    const result = parseStopsParam(`${long}|B`);
    expect(result[0]).toHaveLength(200);
  });
});

// ── readUrlParams ────────────────────────────────────────────────────────

describe("readUrlParams", () => {
  const origLocation = window.location;

  function setSearch(search) {
    Object.defineProperty(window, "location", {
      value: { ...origLocation, search },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: origLocation,
      writable: true,
      configurable: true,
    });
  });

  it("reads from and to from query string", () => {
    setSearch("?from=Wrigleyville&to=Logan+Square");
    const params = readUrlParams();
    expect(params.from).toBe("Wrigleyville");
    expect(params.to).toBe("Logan Square");
  });

  it("returns hft and hin when both are in range", () => {
    setSearch("?hft=5&hin=3");
    const params = readUrlParams();
    expect(params.hft).toBe(5);
    expect(params.hin).toBe(3);
  });

  it("returns null for hft below 3", () => {
    setSearch("?hft=2");
    const params = readUrlParams();
    expect(params.hft).toBeNull();
  });

  it("returns null for hft above 8", () => {
    setSearch("?hft=9");
    const params = readUrlParams();
    expect(params.hft).toBeNull();
  });

  it("returns null for hin above 11", () => {
    setSearch("?hin=12");
    const params = readUrlParams();
    expect(params.hin).toBeNull();
  });

  it("returns null for hin below 0", () => {
    setSearch("?hin=-1");
    const params = readUrlParams();
    expect(params.hin).toBeNull();
  });

  it("accepts hin=0 (boundary value)", () => {
    setSearch("?hin=0");
    const params = readUrlParams();
    expect(params.hin).toBe(0);
  });

  it("accepts hft=3 (boundary value)", () => {
    setSearch("?hft=3");
    const params = readUrlParams();
    expect(params.hft).toBe(3);
  });

  it("accepts hft=8 (boundary value)", () => {
    setSearch("?hft=8");
    const params = readUrlParams();
    expect(params.hft).toBe(8);
  });

  it("accepts hin=11 (boundary value)", () => {
    setSearch("?hin=11");
    const params = readUrlParams();
    expect(params.hin).toBe(11);
  });

  it("returns null for hft when not present", () => {
    setSearch("?from=A&to=B");
    const params = readUrlParams();
    expect(params.hft).toBeNull();
    expect(params.hin).toBeNull();
  });

  it("parses stops from ?stops= param", () => {
    setSearch("?stops=A|B|C");
    const params = readUrlParams();
    expect(params.stops).toEqual(["A", "B", "C"]);
  });

  it("returns null for stops when param is absent", () => {
    setSearch("?from=A&to=B");
    const params = readUrlParams();
    expect(params.stops).toBeNull();
  });

  it("caps from and to at 200 characters", () => {
    const long = "x".repeat(250);
    setSearch(`?from=${long}&to=${long}`);
    const params = readUrlParams();
    expect(params.from.length).toBeLessThanOrEqual(200);
    expect(params.to.length).toBeLessThanOrEqual(200);
  });

  it("returns safe defaults when an exception is thrown", () => {
    // Force URLSearchParams to throw by making window.location.search a
    // getter that throws.
    Object.defineProperty(window, "location", {
      get() { throw new Error("access denied"); },
      configurable: true,
    });
    const params = readUrlParams();
    expect(params).toEqual({ from: "", to: "", stops: null, hft: null, hin: null });
  });
});
