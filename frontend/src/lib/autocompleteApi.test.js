import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAutocomplete } from "./autocompleteApi.js";

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
