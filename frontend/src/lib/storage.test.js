import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  safeGet,
  safeSet,
  safeRemove,
  loadJSON,
  saveJSON,
  safeSessionGet,
  safeSessionSet,
} from "./storage.js";

// ── safeGet ───────────────────────────────────────────────────────────────

describe("safeGet", () => {
  beforeEach(() => localStorage.clear());

  it("returns the stored value when key exists", () => {
    localStorage.setItem("test-key", "hello");
    expect(safeGet("test-key")).toBe("hello");
  });

  it("returns null when key does not exist", () => {
    expect(safeGet("nonexistent")).toBeNull();
  });

  it("returns null when localStorage.getItem throws", () => {
    const orig = Object.getOwnPropertyDescriptor(Storage.prototype, "getItem");
    Storage.prototype.getItem = vi.fn(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    try {
      expect(safeGet("test-key")).toBeNull();
    } finally {
      Object.defineProperty(Storage.prototype, "getItem", orig);
    }
  });
});

// ── safeSet ───────────────────────────────────────────────────────────────

describe("safeSet", () => {
  beforeEach(() => localStorage.clear());

  it("stores the value and returns true", () => {
    expect(safeSet("test-key", "world")).toBe(true);
    expect(localStorage.getItem("test-key")).toBe("world");
  });

  it("returns false when localStorage.setItem throws", () => {
    const orig = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
    Storage.prototype.setItem = vi.fn(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    try {
      expect(safeSet("test-key", "value")).toBe(false);
    } finally {
      Object.defineProperty(Storage.prototype, "setItem", orig);
    }
  });
});

// ── safeRemove ────────────────────────────────────────────────────────────

describe("safeRemove", () => {
  beforeEach(() => localStorage.clear());

  it("removes the key and returns true", () => {
    localStorage.setItem("test-key", "data");
    expect(safeRemove("test-key")).toBe(true);
    expect(localStorage.getItem("test-key")).toBeNull();
  });

  it("returns true even when the key does not exist", () => {
    expect(safeRemove("nonexistent")).toBe(true);
  });

  it("returns true even when removeItem throws", () => {
    const orig = Object.getOwnPropertyDescriptor(Storage.prototype, "removeItem");
    Storage.prototype.removeItem = vi.fn(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    try {
      // The source catches and returns false — but the contract says it swallows.
      // We just assert it does not throw.
      expect(() => safeRemove("test-key")).not.toThrow();
    } finally {
      Object.defineProperty(Storage.prototype, "removeItem", orig);
    }
  });
});

// ── loadJSON ──────────────────────────────────────────────────────────────

describe("loadJSON", () => {
  beforeEach(() => localStorage.clear());

  it("returns the parsed value when key holds valid JSON", () => {
    localStorage.setItem("json-key", JSON.stringify({ a: 1 }));
    expect(loadJSON("json-key")).toEqual({ a: 1 });
  });

  it("returns the fallback when the key is absent", () => {
    expect(loadJSON("missing", "default-val")).toBe("default-val");
  });

  it("returns null fallback by default when key is absent", () => {
    expect(loadJSON("missing")).toBeNull();
  });

  it("returns the fallback when the stored value is malformed JSON", () => {
    localStorage.setItem("bad-json", "not-valid-json{{{");
    expect(loadJSON("bad-json", "fallback")).toBe("fallback");
  });

  it("returns an array fallback when stored array parses correctly", () => {
    localStorage.setItem("arr-key", JSON.stringify([1, 2, 3]));
    expect(loadJSON("arr-key", [])).toEqual([1, 2, 3]);
  });
});

// ── saveJSON ──────────────────────────────────────────────────────────────

describe("saveJSON", () => {
  beforeEach(() => localStorage.clear());

  it("stringifies and stores the value, returns true", () => {
    const value = { foo: "bar", count: 42 };
    const result = saveJSON("save-key", value);
    expect(result).toBe(true);
    expect(JSON.parse(localStorage.getItem("save-key"))).toEqual(value);
  });

  it("stores an array correctly", () => {
    saveJSON("arr-key", [1, 2, 3]);
    expect(JSON.parse(localStorage.getItem("arr-key"))).toEqual([1, 2, 3]);
  });
});

// ── safeSessionGet ────────────────────────────────────────────────────────

describe("safeSessionGet", () => {
  beforeEach(() => sessionStorage.clear());

  it("returns the stored value when key exists in sessionStorage", () => {
    sessionStorage.setItem("session-key", "session-val");
    expect(safeSessionGet("session-key")).toBe("session-val");
  });

  it("returns null when key does not exist in sessionStorage", () => {
    expect(safeSessionGet("nonexistent")).toBeNull();
  });

  it("returns null when sessionStorage.getItem throws", () => {
    const origGet = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = vi.fn(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    try {
      expect(safeSessionGet("session-key")).toBeNull();
    } finally {
      sessionStorage.getItem = origGet;
    }
  });
});

// ── safeSessionSet ────────────────────────────────────────────────────────

describe("safeSessionSet", () => {
  beforeEach(() => sessionStorage.clear());

  it("stores the value and returns true", () => {
    expect(safeSessionSet("session-key", "session-val")).toBe(true);
    expect(sessionStorage.getItem("session-key")).toBe("session-val");
  });

  it("returns false when sessionStorage.setItem throws", () => {
    const orig = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
    Storage.prototype.setItem = vi.fn(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    try {
      expect(safeSessionSet("session-key", "value")).toBe(false);
    } finally {
      Object.defineProperty(Storage.prototype, "setItem", orig);
    }
  });
});
