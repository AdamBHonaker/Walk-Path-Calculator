import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, TimeoutError } from "./fetchWithTimeout.js";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("resolves with the response when fetch completes before the timeout", async () => {
    globalThis.fetch = vi.fn((_input, init) =>
      Promise.resolve({ ok: true, signal: init.signal })
    );
    const res = await fetchWithTimeout("/x", {}, 1_000);
    expect(res.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects with TimeoutError (not AbortError) when the timeout fires", async () => {
    // Timeouts must be distinguishable from user-initiated aborts so callers
    // can surface a real error message instead of silently returning.
    vi.useFakeTimers();
    let receivedSignal = null;
    globalThis.fetch = vi.fn((_input, init) => {
      receivedSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    });
    const pending = fetchWithTimeout("/slow", {}, 50);
    vi.advanceTimersByTime(50);
    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    expect(receivedSignal.aborted).toBe(true);
  });

  it("propagates an external abort to the fetch", async () => {
    const ctrl = new AbortController();
    let innerSignal = null;
    globalThis.fetch = vi.fn((_input, init) => {
      innerSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    });
    const pending = fetchWithTimeout("/x", { signal: ctrl.signal }, 10_000);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(innerSignal.aborted).toBe(true);
  });

  it("aborts immediately when the external signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    globalThis.fetch = vi.fn((_input, init) => {
      if (init.signal.aborted) {
        return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }
      return Promise.resolve({ ok: true });
    });
    await expect(
      fetchWithTimeout("/x", { signal: ctrl.signal }, 10_000),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("clears its timeout once the fetch settles (no late aborts leak)", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }));
    await fetchWithTimeout("/x", {}, 10_000);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
