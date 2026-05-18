import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchExplore } from "./exploreApi.js";

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

describe("fetchExplore", () => {
  it("posts the community-area origin shape", async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ places: [] })));
    await fetchExplore({
      origin: { kind: "community_area", communityArea: "Loop" },
      maxMinutes: 20,
    });
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      max_minutes: 20,
      origin: { community_area: "Loop" },
    });
  });

  it("posts the lat/lon origin shape", async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ places: [] })));
    await fetchExplore({
      origin: { kind: "current", lat: 41.9, lon: -87.65 },
      maxMinutes: 15,
    });
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      max_minutes: 15,
      origin: { lat: 41.9, lon: -87.65 },
    });
  });

  it("includes categories when supplied; omits the field otherwise", async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ places: [] })));
    await fetchExplore({
      origin: { kind: "community_area", communityArea: "Loop" },
      maxMinutes: 20,
      categories: ["libraries", "parks"],
    });
    const withCats = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(withCats.categories).toEqual(["libraries", "parks"]);

    globalThis.fetch.mockClear();
    await fetchExplore({
      origin: { kind: "community_area", communityArea: "Loop" },
      maxMinutes: 20,
    });
    const withoutCats = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(withoutCats).not.toHaveProperty("categories");
  });

  it("returns the parsed body on a 200", async () => {
    const body = { polygon: null, places: [{ name: "X" }] };
    mockFetch(() => Promise.resolve(jsonResponse(body)));
    const data = await fetchExplore({
      origin: { kind: "community_area", communityArea: "Loop" },
      maxMinutes: 20,
    });
    expect(data).toEqual(body);
  });

  it("extracts detail.message from a structured error", async () => {
    mockFetch(() => Promise.resolve(jsonResponse(
      { detail: { message: "Origin outside coverage area." } },
      { ok: false, status: 422 },
    )));
    await expect(
      fetchExplore({ origin: { kind: "community_area", communityArea: "x" }, maxMinutes: 20 }),
    ).rejects.toMatchObject({ message: "Origin outside coverage area.", status: 422 });
  });

  it("falls back to the unified 429 copy when detail is missing", async () => {
    mockFetch(() => Promise.resolve(jsonResponse({}, { ok: false, status: 429 })));
    await expect(
      fetchExplore({ origin: { kind: "community_area", communityArea: "Loop" }, maxMinutes: 20 }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("rate-limited"),
      status: 429,
    });
  });

  it("survives a non-JSON 5xx body", async () => {
    mockFetch(() => Promise.resolve({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("not json")),
    }));
    await expect(
      fetchExplore({ origin: { kind: "community_area", communityArea: "Loop" }, maxMinutes: 20 }),
    ).rejects.toMatchObject({ status: 502 });
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
    const pending = fetchExplore({
      origin: { kind: "community_area", communityArea: "Loop" },
      maxMinutes: 20,
      signal: ctrl.signal,
    });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
