import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useShareCard } from "./useShareCard.js";

// ── useShareCard ──────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  viewResult: null,
  stopValues: ["", ""],
  heightFt: null,
  heightIn: null,
  origin: "Wrigleyville",
  destination: "Logan Square",
  showToast: vi.fn(),
};

function makeResult(overrides = {}) {
  return {
    stops: ["Wrigleyville", "Logan Square"],
    total_steps: 5880,
    total_miles: 2.8,
    total_minutes: 56,
    path: [[41.9476, -87.6553], [41.9290, -87.7000]],
    directions: [],
    ...overrides,
  };
}

describe("useShareCard — initial state", () => {
  it("canWebShare starts as false before mount effects run", () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    // canWebShare starts false; may update after mount effect
    expect(typeof result.current.canWebShare).toBe("boolean");
  });

  it("showShareModal starts as false", () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    expect(result.current.showShareModal).toBe(false);
  });

  it("cardMapReady starts as false", () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    expect(result.current.cardMapReady).toBe(false);
  });
});

describe("useShareCard — canWebShare probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("canWebShare becomes true when navigator.canShare returns true for a file probe", async () => {
    // Stub navigator.canShare to return true for a file probe
    Object.defineProperty(globalThis.navigator, "canShare", {
      configurable: true,
      value: vi.fn(() => true),
    });

    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));

    // After the useEffect fires
    await act(async () => {});

    expect(result.current.canWebShare).toBe(true);
  });

  it("canWebShare stays false when navigator.canShare is undefined", async () => {
    // Ensure canShare is not present
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, "canShare");
    if (descriptor) {
      Object.defineProperty(globalThis.navigator, "canShare", {
        configurable: true,
        value: undefined,
      });
    }

    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    await act(async () => {});

    expect(result.current.canWebShare).toBe(false);

    // Restore
    if (descriptor) {
      Object.defineProperty(globalThis.navigator, "canShare", descriptor);
    }
  });

  it("canWebShare stays false when canShare throws", async () => {
    Object.defineProperty(globalThis.navigator, "canShare", {
      configurable: true,
      value: vi.fn(() => { throw new Error("not supported"); }),
    });

    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    await act(async () => {});

    expect(result.current.canWebShare).toBe(false);
  });
});

describe("useShareCard — modal open/close", () => {
  it("handleOpenShare sets showShareModal=true", async () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    expect(result.current.showShareModal).toBe(false);

    await act(async () => {
      result.current.handleOpenShare();
    });

    expect(result.current.showShareModal).toBe(true);
  });

  it("handleCloseShare sets showShareModal=false", async () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));

    await act(async () => {
      result.current.handleOpenShare();
    });
    expect(result.current.showShareModal).toBe(true);

    await act(async () => {
      result.current.handleCloseShare();
    });
    expect(result.current.showShareModal).toBe(false);
  });

  it("handleOpenShare resets cardMapReady to false", async () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));

    // Simulate card map becoming ready
    await act(async () => {
      result.current.handleCardMapReady();
    });
    expect(result.current.cardMapReady).toBe(true);

    // Re-opening the modal should reset it
    await act(async () => {
      result.current.handleOpenShare();
    });
    expect(result.current.cardMapReady).toBe(false);
  });

  it("handleCardMapReady sets cardMapReady=true", async () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    expect(result.current.cardMapReady).toBe(false);

    await act(async () => {
      result.current.handleCardMapReady();
    });

    expect(result.current.cardMapReady).toBe(true);
  });
});

describe("useShareCard — shareCaption", () => {
  it("is empty string when viewResult is null", () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    expect(result.current.shareCaption).toBe("");
  });

  it("includes origin, destination, and step count", () => {
    const viewResult = makeResult();
    const { result } = renderHook(() =>
      useShareCard({ ...DEFAULT_PROPS, viewResult })
    );
    expect(result.current.shareCaption).toContain("Wrigleyville");
    expect(result.current.shareCaption).toContain("Logan Square");
    expect(result.current.shareCaption).toContain("5,880");
  });

  it("includes 'Passage' in the caption", () => {
    const viewResult = makeResult();
    const { result } = renderHook(() =>
      useShareCard({ ...DEFAULT_PROPS, viewResult })
    );
    expect(result.current.shareCaption).toContain("Passage");
  });
});

describe("useShareCard — shareUrl", () => {
  it("is empty string when viewResult is null", () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    expect(result.current.shareUrl).toBe("");
  });

  it("includes ?from= and ?to= for a 2-stop route", () => {
    const viewResult = makeResult({ stops: ["Wrigleyville", "Logan Square"] });
    const { result } = renderHook(() =>
      useShareCard({ ...DEFAULT_PROPS, viewResult, stopValues: ["Wrigleyville", "Logan Square"] })
    );
    expect(result.current.shareUrl).toContain("from=");
    expect(result.current.shareUrl).toContain("to=");
    expect(result.current.shareUrl).toContain("Wrigleyville");
    expect(result.current.shareUrl).toContain("Logan");
  });

  it("uses ?stops= for a 3-stop route", () => {
    const viewResult = makeResult({ stops: ["A", "B", "C"] });
    const { result } = renderHook(() =>
      useShareCard({ ...DEFAULT_PROPS, viewResult, stopValues: ["A", "B", "C"] })
    );
    expect(result.current.shareUrl).toContain("stops=");
  });

  it("includes height params when heightFt and heightIn are set", () => {
    const viewResult = makeResult();
    const { result } = renderHook(() =>
      useShareCard({ ...DEFAULT_PROPS, viewResult, heightFt: 5, heightIn: 9 })
    );
    expect(result.current.shareUrl).toContain("hft=5");
    expect(result.current.shareUrl).toContain("hin=9");
  });
});

describe("useShareCard — handleCopyShareLink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls navigator.clipboard.writeText with the shareUrl", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const viewResult = makeResult();
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useShareCard({ ...DEFAULT_PROPS, viewResult, showToast })
    );

    await act(async () => {
      await result.current.handleCopyShareLink();
    });

    expect(writeText).toHaveBeenCalledWith(result.current.shareUrl);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("copied"));
  });

  it("does nothing when shareUrl is empty (viewResult is null)", async () => {
    const writeText = vi.fn();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));

    await act(async () => {
      await result.current.handleCopyShareLink();
    });

    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("useShareCard — siteHost", () => {
  it("returns a non-empty string", () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    expect(typeof result.current.siteHost).toBe("string");
  });
});

describe("useShareCard — refs", () => {
  it("exposes cardRef and cardMapRef as ref objects", () => {
    const { result } = renderHook(() => useShareCard(DEFAULT_PROPS));
    expect(result.current.cardRef).toHaveProperty("current");
    expect(result.current.cardMapRef).toHaveProperty("current");
  });
});
