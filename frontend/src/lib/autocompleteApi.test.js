import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAutocomplete, _clearAutocompleteCache } from "./autocompleteApi.js";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(impl) {
  globalThis.fetch = vi.fn(impl);
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  // OPT-065: clear the in-memory LRU between tests so a `("x", 8)` call
  // in one case doesn't return the cached value into the next case's
  // assertion (the cache is module-scoped, persists across tests).
  _clearAutocompleteCache();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("fetchAutocomplete", () => {
  it("short-circuits on an empty query without calling fetch", async () => {
    const fakeFetch = vi.fn();
    globalThis.fetch = fakeFetch;
    expect(await fetchAutocomplete("")).toEqual([]);
    expect(await fetchAutocomplete("   ")).toEqual([]);
    expect(await fetchAutocomplete(null)).toEqual([]);
    expect(await fetchAutocomplete(undefined)).toEqual([]);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("trims the query before sending and respects the limit", async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ suggestions: [] })));
    await fetchAutocomplete("  Wrigley  ", { limit: 5 });
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("q=Wrigley");
    expect(url).toContain("limit=5");
    expect(url).not.toContain("  ");
  });

  it("returns the suggestions array on a 200", async () => {
    const suggestions = [
      { label: "Wrigleyville", lat: 41.95, lon: -87.65, source: "neighborhood" },
    ];
    mockFetch(() => Promise.resolve(jsonResponse({ suggestions })));
    expect(await fetchAutocomplete("wrigley")).toEqual(suggestions);
  });

  it("returns [] when the response body lacks a suggestions array", async () => {
    mockFetch(() => Promise.resolve(jsonResponse({})));
    expect(await fetchAutocomplete("x")).toEqual([]);
    mockFetch(() => Promise.resolve(jsonResponse({ suggestions: "not-an-array" })));
    expect(await fetchAutocomplete("x")).toEqual([]);
  });

  it("throws with the status attached on a non-OK response", async () => {
    mockFetch(() => Promise.resolve(jsonResponse({}, { ok: false, status: 503 })));
    await expect(fetchAutocomplete("x")).rejects.toMatchObject({ status: 503 });
  });

  it("OPT-065: serves a repeat (q, limit) hit from the in-memory LRU without re-fetching", async () => {
    const suggestions = [
      { label: "Heritage Outpost", lat: 41.92, lon: -87.69, source: "place" },
    ];
    const fakeFetch = vi.fn(() => Promise.resolve(jsonResponse({ suggestions })));
    globalThis.fetch = fakeFetch;
    expect(await fetchAutocomplete("heritage", { limit: 8 })).toEqual(suggestions);
    expect(await fetchAutocomplete("heritage", { limit: 8 })).toEqual(suggestions);
    // Second call must have come from the cache, not the network.
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("OPT-065: differs by limit — `(q, 5)` and `(q, 8)` are separate cache slots", async () => {
    const fakeFetch = vi.fn(() => Promise.resolve(jsonResponse({ suggestions: [] })));
    globalThis.fetch = fakeFetch;
    await fetchAutocomplete("clark", { limit: 5 });
    await fetchAutocomplete("clark", { limit: 8 });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("aborts when the caller's AbortSignal fires (composed via fetchWithTimeout)", async () => {
    const ctrl = new AbortController();
    mockFetch((_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
    );
    const pending = fetchAutocomplete("loop", { signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
