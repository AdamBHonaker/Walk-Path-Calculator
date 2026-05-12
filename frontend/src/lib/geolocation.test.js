import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCurrentLocation, watchCurrentLocation } from "./geolocation.js";

// Helper: install a fake navigator.geolocation that resolves with the
// given coords (or rejects with the given GeolocationPositionError code).
function installGeo({ position, code } = {}) {
  const getCurrentPosition = vi.fn((onSuccess, onError) => {
    if (code != null) onError({ code });
    else onSuccess({ coords: position });
  });
  globalThis.navigator = { geolocation: { getCurrentPosition } };
  return getCurrentPosition;
}

const ORIGINAL_NAV = globalThis.navigator;

describe("resolveCurrentLocation", () => {
  afterEach(() => {
    globalThis.navigator = ORIGINAL_NAV;
  });

  it("returns { error: 'unavailable' } when navigator.geolocation is missing", async () => {
    globalThis.navigator = {};
    expect(await resolveCurrentLocation()).toEqual({ error: "unavailable" });
  });

  it("resolves with lat/lon for a Chicago-bbox point", async () => {
    installGeo({ position: { latitude: 41.95, longitude: -87.65 } });
    expect(await resolveCurrentLocation()).toEqual({ lat: 41.95, lon: -87.65 });
  });

  it("returns 'outside_coverage' for a point south of the bbox", async () => {
    installGeo({ position: { latitude: 41.50, longitude: -87.65 } });
    expect(await resolveCurrentLocation()).toEqual({ error: "outside_coverage" });
  });

  it("returns 'outside_coverage' for a point north of the bbox", async () => {
    installGeo({ position: { latitude: 42.10, longitude: -87.65 } });
    expect(await resolveCurrentLocation()).toEqual({ error: "outside_coverage" });
  });

  it("returns 'outside_coverage' for a point west of the bbox", async () => {
    installGeo({ position: { latitude: 41.95, longitude: -88.10 } });
    expect(await resolveCurrentLocation()).toEqual({ error: "outside_coverage" });
  });

  it("returns 'outside_coverage' for a point east of the bbox", async () => {
    installGeo({ position: { latitude: 41.95, longitude: -87.40 } });
    expect(await resolveCurrentLocation()).toEqual({ error: "outside_coverage" });
  });

  it("accepts the south-edge corner exactly (41.64)", async () => {
    installGeo({ position: { latitude: 41.64, longitude: -87.65 } });
    expect(await resolveCurrentLocation()).toEqual({ lat: 41.64, lon: -87.65 });
  });

  it("accepts the north-edge corner exactly (42.02)", async () => {
    installGeo({ position: { latitude: 42.02, longitude: -87.65 } });
    expect(await resolveCurrentLocation()).toEqual({ lat: 42.02, lon: -87.65 });
  });

  it("returns 'unavailable' when coords are non-finite", async () => {
    installGeo({ position: { latitude: NaN, longitude: -87.65 } });
    expect(await resolveCurrentLocation()).toEqual({ error: "unavailable" });
  });

  it("classifies PERMISSION_DENIED (code 1) as 'denied'", async () => {
    installGeo({ code: 1 });
    expect(await resolveCurrentLocation()).toEqual({ error: "denied" });
  });

  it("classifies POSITION_UNAVAILABLE (code 2) as 'unavailable'", async () => {
    installGeo({ code: 2 });
    expect(await resolveCurrentLocation()).toEqual({ error: "unavailable" });
  });

  it("classifies TIMEOUT (code 3) as 'unavailable'", async () => {
    installGeo({ code: 3 });
    expect(await resolveCurrentLocation()).toEqual({ error: "unavailable" });
  });
});

// ── watchCurrentLocation ────────────────────────────────────────────────
function installWatch() {
  let handlers = null;
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((onSuccess, onError) => {
    handlers = { onSuccess, onError };
    return 42;
  });
  globalThis.navigator = { geolocation: { watchPosition, clearWatch } };
  return {
    watchPosition,
    clearWatch,
    emit: (position) => handlers.onSuccess({ coords: position }),
    fail: (code) => handlers.onError({ code }),
  };
}

describe("watchCurrentLocation", () => {
  afterEach(() => {
    globalThis.navigator = ORIGINAL_NAV;
  });

  it("calls onError({ error: 'unavailable' }) when geolocation is missing", () => {
    globalThis.navigator = {};
    const onError = vi.fn();
    const stop = watchCurrentLocation({ onFix: vi.fn(), onError });
    expect(onError).toHaveBeenCalledWith({ error: "unavailable" });
    expect(typeof stop).toBe("function");
    stop();
  });

  it("streams in-bbox fixes to onFix", () => {
    const geo = installWatch();
    const onFix = vi.fn();
    const onError = vi.fn();
    watchCurrentLocation({ onFix, onError });
    geo.emit({ latitude: 41.95, longitude: -87.65, accuracy: 12 });
    geo.emit({ latitude: 41.96, longitude: -87.66, accuracy: 8 });
    expect(onFix).toHaveBeenCalledTimes(2);
    expect(onFix).toHaveBeenNthCalledWith(1, { lat: 41.95, lon: -87.65, accuracy: 12 });
    expect(onFix).toHaveBeenNthCalledWith(2, { lat: 41.96, lon: -87.66, accuracy: 8 });
    expect(onError).not.toHaveBeenCalled();
  });

  it("routes out-of-bbox fixes to onError without invoking onFix", () => {
    const geo = installWatch();
    const onFix = vi.fn();
    const onError = vi.fn();
    watchCurrentLocation({ onFix, onError });
    geo.emit({ latitude: 30.0, longitude: -87.65, accuracy: 12 });
    expect(onFix).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({ error: "outside_coverage" });
  });

  it("classifies PERMISSION_DENIED (code 1) as 'denied'", () => {
    const geo = installWatch();
    const onError = vi.fn();
    watchCurrentLocation({ onFix: vi.fn(), onError });
    geo.fail(1);
    expect(onError).toHaveBeenCalledWith({ error: "denied" });
  });

  it("teardown clears the watch", () => {
    const geo = installWatch();
    const stop = watchCurrentLocation({ onFix: vi.fn(), onError: vi.fn() });
    stop();
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
  });

  it("treats non-finite coords as 'unavailable'", () => {
    const geo = installWatch();
    const onFix = vi.fn();
    const onError = vi.fn();
    watchCurrentLocation({ onFix, onError });
    geo.emit({ latitude: NaN, longitude: -87.65, accuracy: 12 });
    expect(onFix).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({ error: "unavailable" });
  });
});
