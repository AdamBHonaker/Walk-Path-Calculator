import { describe, it, expect, beforeEach } from "vitest";
import { runStorageMigrations, CURRENT_SCHEMA_VERSION } from "./storageSchema.js";

describe("runStorageMigrations", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("persists the current version on a fresh install", () => {
    expect(localStorage.getItem("walkpath:schemaVersion")).toBeNull();
    const result = runStorageMigrations();
    expect(result).toBe(CURRENT_SCHEMA_VERSION);
    expect(localStorage.getItem("walkpath:schemaVersion"))
      .toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it("short-circuits on a subsequent boot at the same version", () => {
    localStorage.setItem("walkpath:schemaVersion", String(CURRENT_SCHEMA_VERSION));
    const result = runStorageMigrations();
    expect(result).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("treats a malformed version marker as v1 and reseeds", () => {
    localStorage.setItem("walkpath:schemaVersion", "not-a-number");
    const result = runStorageMigrations();
    expect(result).toBe(CURRENT_SCHEMA_VERSION);
    expect(localStorage.getItem("walkpath:schemaVersion"))
      .toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it("treats a missing marker as v1 (the pre-versioning baseline)", () => {
    // A user who installed before TD-071 has no marker. The runner must
    // accept that as "v1" rather than refusing to advance.
    expect(localStorage.getItem("walkpath:schemaVersion")).toBeNull();
    expect(runStorageMigrations()).toBe(CURRENT_SCHEMA_VERSION);
  });
});
