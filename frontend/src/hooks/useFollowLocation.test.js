import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFollowLocation } from "./useFollowLocation.js";

const ORIGINAL_NAV = globalThis.navigator;

function installWatch() {
  let handlers = null;
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((onSuccess, onError) => {
    handlers = { onSuccess, onError };
    return 7;
  });
  globalThis.navigator = { geolocation: { watchPosition, clearWatch } };
  return {
    watchPosition,
    clearWatch,
    emit: (position) => act(() => handlers.onSuccess({ coords: position })),
    fail:  (code)    => act(() => handlers.onError({ code })),
  };
}

afterEach(() => {
  globalThis.navigator = ORIGINAL_NAV;
});

describe("useFollowLocation", () => {
  it("starts idle with no position", () => {
    const { result } = renderHook(() => useFollowLocation());
    expect(result.current.following).toBe(false);
    expect(result.current.position).toBe(null);
  });

  it("toggle() opens watch and surfaces fixes", () => {
    const geo = installWatch();
    const { result } = renderHook(() => useFollowLocation());
    act(() => result.current.toggle());
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(result.current.following).toBe(true);
    geo.emit({ latitude: 41.95, longitude: -87.65, accuracy: 10 });
    expect(result.current.position).toEqual({ lat: 41.95, lon: -87.65, accuracy: 10 });
  });

  it("second toggle() stops the watch and clears position", () => {
    const geo = installWatch();
    const { result } = renderHook(() => useFollowLocation());
    act(() => result.current.toggle());
    geo.emit({ latitude: 41.95, longitude: -87.65, accuracy: 10 });
    act(() => result.current.toggle());
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(result.current.following).toBe(false);
    expect(result.current.position).toBe(null);
  });

  it("stop() called externally tears down even when not toggled", () => {
    const geo = installWatch();
    const { result } = renderHook(() => useFollowLocation());
    act(() => result.current.toggle());
    act(() => result.current.stop());
    expect(geo.clearWatch).toHaveBeenCalled();
    expect(result.current.following).toBe(false);
  });

  it("auto-stops when `enabled` flips false", () => {
    const geo = installWatch();
    const { result, rerender } = renderHook(({ enabled }) => useFollowLocation({ enabled }), {
      initialProps: { enabled: true },
    });
    act(() => result.current.toggle());
    expect(result.current.following).toBe(true);
    rerender({ enabled: false });
    expect(geo.clearWatch).toHaveBeenCalled();
    expect(result.current.following).toBe(false);
    expect(result.current.position).toBe(null);
  });

  it("surfaces a 'denied' error and disengages", () => {
    const geo = installWatch();
    const { result } = renderHook(() => useFollowLocation());
    act(() => result.current.toggle());
    geo.fail(1);
    expect(result.current.error).toBe("denied");
    expect(result.current.following).toBe(false);
    expect(result.current.position).toBe(null);
  });

  it("unmount clears the watch", () => {
    const geo = installWatch();
    const { result, unmount } = renderHook(() => useFollowLocation());
    act(() => result.current.toggle());
    unmount();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
  });
});
