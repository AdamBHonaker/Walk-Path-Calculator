import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadStepLog,
  logWalk,
  clearStepLog,
  STEP_LOG_KEY,
  STEP_LOG_TTL_DAYS,
} from "./stepLog.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Seed localStorage with a JSON-serialised step log.
function seedLog(entries) {
  localStorage.setItem(STEP_LOG_KEY, JSON.stringify(entries));
}

// ── loadStepLog ───────────────────────────────────────────────────────────

describe("loadStepLog", () => {
  beforeEach(() => localStorage.clear());

  it("returns [] when nothing is stored", () => {
    expect(loadStepLog()).toEqual([]);
  });

  it("returns [] when stored value is not an array", () => {
    seedLog({ not: "an array" });
    expect(loadStepLog()).toEqual([]);
  });

  it("returns [] when stored value is a string", () => {
    localStorage.setItem(STEP_LOG_KEY, "not-json");
    expect(loadStepLog()).toEqual([]);
  });

  it("keeps entries within the TTL window", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const fresh = { timestamp: now - DAY_MS, date: "2026-05-18", steps: 1000, miles: 0.5, minutes: 10, origin: "A", destination: "B" };
    seedLog([fresh]);
    expect(loadStepLog()).toHaveLength(1);
    expect(loadStepLog()[0].steps).toBe(1000);
  });

  it("filters out entries older than 7 days", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const old = { timestamp: now - (STEP_LOG_TTL_DAYS * DAY_MS + 1), date: "2026-05-10", steps: 500, miles: 0.2, minutes: 5, origin: "X", destination: "Y" };
    seedLog([old]);
    expect(loadStepLog()).toEqual([]);
  });

  it("keeps entries exactly at the TTL boundary", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    // Exactly at the cutoff: timestamp = now - 7*DAY_MS (i.e. cutoff itself)
    const boundary = { timestamp: now - STEP_LOG_TTL_DAYS * DAY_MS, date: "2026-05-12", steps: 300, miles: 0.1, minutes: 3, origin: "A", destination: "B" };
    seedLog([boundary]);
    expect(loadStepLog()).toHaveLength(1);
  });

  it("skips entries with non-numeric timestamp", () => {
    seedLog([{ timestamp: "bad", date: "2026-05-19", steps: 100, miles: 0, minutes: 1, origin: "A", destination: "B" }]);
    expect(loadStepLog()).toEqual([]);
  });

  it("skips entries with undefined timestamp", () => {
    seedLog([{ date: "2026-05-19", steps: 100, miles: 0, minutes: 1, origin: "A", destination: "B" }]);
    expect(loadStepLog()).toEqual([]);
  });

  it("mixes fresh and stale entries, returning only fresh ones", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const fresh = { timestamp: now - DAY_MS, date: "2026-05-18", steps: 200, miles: 0.1, minutes: 2, origin: "A", destination: "B" };
    const stale = { timestamp: now - (STEP_LOG_TTL_DAYS * DAY_MS + 1000), date: "2026-05-10", steps: 999, miles: 0.5, minutes: 9, origin: "X", destination: "Y" };
    seedLog([fresh, stale]);
    const log = loadStepLog();
    expect(log).toHaveLength(1);
    expect(log[0].steps).toBe(200);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ── logWalk ───────────────────────────────────────────────────────────────

describe("logWalk", () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes an entry with correct fields and returns it", () => {
    const now = new Date(2026, 4, 19, 12, 0, 0).getTime(); // 2026-05-19 local
    vi.setSystemTime(now);

    const entry = logWalk(
      { steps: 5000, miles: 2.5, minutes: 50, origin: "Wrigleyville", destination: "Logan Square" },
      [],
    );
    expect(entry).not.toBeNull();
    expect(typeof entry.timestamp).toBe("number");
    expect(entry.timestamp).toBe(now);
    expect(entry.steps).toBe(5000);
    expect(entry.miles).toBeCloseTo(2.5, 5);
    expect(entry.minutes).toBe(50);
    expect(entry.origin).toBe("Wrigleyville");
    expect(entry.destination).toBe("Logan Square");
  });

  it("date field is in YYYY-MM-DD format", () => {
    const now = new Date(2026, 4, 19, 10, 0, 0).getTime();
    vi.setSystemTime(now);
    const entry = logWalk({ steps: 100, miles: 0.1, minutes: 1, origin: "A", destination: "B" }, []);
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.date).toBe("2026-05-19");
  });

  it("coerces steps via Number()", () => {
    vi.setSystemTime(Date.now());
    const entry = logWalk({ steps: "3500", miles: 1, minutes: 30, origin: "A", destination: "B" }, []);
    expect(entry.steps).toBe(3500);
  });

  it("coerces miles via Number()", () => {
    vi.setSystemTime(Date.now());
    const entry = logWalk({ steps: 1000, miles: "1.75", minutes: 20, origin: "A", destination: "B" }, []);
    expect(entry.miles).toBeCloseTo(1.75, 5);
  });

  it("miles=undefined becomes 0", () => {
    vi.setSystemTime(Date.now());
    const entry = logWalk({ steps: 100, miles: undefined, minutes: 5, origin: "A", destination: "B" }, []);
    expect(entry.miles).toBe(0);
  });

  it("minutes=undefined becomes null", () => {
    vi.setSystemTime(Date.now());
    const entry = logWalk({ steps: 100, miles: 0.1, minutes: undefined, origin: "A", destination: "B" }, []);
    expect(entry.minutes).toBeNull();
  });

  it("minutes=NaN becomes null", () => {
    vi.setSystemTime(Date.now());
    const entry = logWalk({ steps: 100, miles: 0.1, minutes: NaN, origin: "A", destination: "B" }, []);
    expect(entry.minutes).toBeNull();
  });

  it("prepends new entry to existing log", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const existing = [{ timestamp: now - DAY_MS, date: "2026-05-18", steps: 500, miles: 0.2, minutes: 5, origin: "X", destination: "Y" }];
    logWalk({ steps: 1000, miles: 0.5, minutes: 10, origin: "A", destination: "B" }, existing);
    const stored = JSON.parse(localStorage.getItem(STEP_LOG_KEY));
    expect(stored).toHaveLength(2);
    expect(stored[0].steps).toBe(1000);
    expect(stored[1].steps).toBe(500);
  });

  it("falls back to disk when currentLog is null", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    // Seed a log on disk
    const diskEntry = { timestamp: now - DAY_MS, date: "2026-05-18", steps: 300, miles: 0.1, minutes: 3, origin: "P", destination: "Q" };
    seedLog([diskEntry]);
    logWalk({ steps: 200, miles: 0.1, minutes: 2, origin: "A", destination: "B" }, null);
    const stored = JSON.parse(localStorage.getItem(STEP_LOG_KEY));
    expect(stored).toHaveLength(2);
  });
});

// ── clearStepLog ──────────────────────────────────────────────────────────

describe("clearStepLog", () => {
  beforeEach(() => localStorage.clear());

  it("removes the step log key from localStorage", () => {
    localStorage.setItem(STEP_LOG_KEY, JSON.stringify([{ timestamp: Date.now(), steps: 1 }]));
    clearStepLog();
    expect(localStorage.getItem(STEP_LOG_KEY)).toBeNull();
  });

  it("does not throw when there is nothing to remove", () => {
    expect(() => clearStepLog()).not.toThrow();
    expect(localStorage.getItem(STEP_LOG_KEY)).toBeNull();
  });
});
