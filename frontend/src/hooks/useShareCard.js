// useShareCard — lifecycle for the editorial route share card.
//
// Pulls the share-modal open/close state, Web Share capability probe,
// PNG capture (via lazy-loaded modern-screenshot), copy-link fallback,
// shareable URL / caption / hostname memos, and the toast plumbing for
// all of the above out of App.jsx, where they were previously ~150
// inline lines mixed in with route + explore + sheet orchestration.
//
// Inputs:
//   viewResult   — the active route view (the merged result + flavor).
//                  Drives what the card renders and whether share is enabled.
//   stopValues   — current draft stop list, used to build the share URL
//                  and the slug for the PNG filename.
//   heightFt / heightIn — personalization carried via deep link so the
//                  receiver gets the same step count.
//   origin / destination — labels used in the caption + slug fallback.
//   showToast    — callback for transient UI status (no-op tolerated).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useShareCard({
  viewResult,
  stopValues,
  heightFt,
  heightIn,
  origin,
  destination,
  showToast,
}) {
  const [showShareModal, setShowShareModal] = useState(false);
  const [cardMapReady, setCardMapReady]     = useState(false);
  // Web Share API capability probe — runs once on mount so the share button
  // can label itself accurately ("Share" on mobile, "Download PNG" on
  // desktop) instead of showing an action that won't fire.
  const [canWebShare, setCanWebShare]       = useState(false);
  const cardRef    = useRef(null);
  const cardMapRef = useRef(null);

  useEffect(() => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
        const probe = new File([new Blob(["x"], { type: "image/png" })], "probe.png", { type: "image/png" });
        if (navigator.canShare({ files: [probe] })) setCanWebShare(true);
      }
    } catch { /* fall through to download fallback */ }
  }, []);

  const handleOpenShare = useCallback(() => {
    setCardMapReady(false);
    setShowShareModal(true);
  }, []);

  const handleCloseShare = useCallback(() => {
    setShowShareModal(false);
    setCardMapReady(false);
  }, []);

  const handleCardMapReady = useCallback(() => setCardMapReady(true), []);

  // Deep-link URL for the rendered route — same encoding fetchRoute uses
  // when it writes window.history, so receivers re-hit /route with
  // identical stops + height.
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !viewResult) return "";
    const stopsArr = Array.isArray(viewResult.stops) && viewResult.stops.length >= 2
      ? viewResult.stops
      : stopValues.map(v => v.trim()).filter(Boolean);
    if (stopsArr.length < 2) return window.location.origin + "/";
    const params = new URLSearchParams();
    if (stopsArr.length > 2) {
      params.set("stops", stopsArr.map(encodeURIComponent).join("|"));
    } else {
      params.set("from", stopsArr[0]);
      params.set("to", stopsArr[1]);
    }
    if (heightFt !== null) params.set("hft", String(heightFt));
    if (heightIn !== null) params.set("hin", String(heightIn));
    return `${window.location.origin}/?${params.toString()}`;
  }, [viewResult, stopValues, heightFt, heightIn]);

  // Hostname only — printed onto the share card as a tasteful "plan yours
  // at …" line. The full URL with stops travels via Web Share / clipboard.
  const siteHost = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.host.replace(/^www\./i, "");
  }, []);

  const shareCaption = useMemo(() => {
    if (!viewResult) return "";
    const steps = viewResult.total_steps?.toLocaleString?.() ?? viewResult.total_steps;
    return `From ${origin} to ${destination} — ${steps} steps with Passage.`;
  }, [viewResult, origin, destination]);

  const handleShareCard = useCallback(async () => {
    if (!cardRef.current) return;
    let overlay = null;
    try {
      const { domToBlob } = await import("modern-screenshot");

      // iOS Safari can clear the WebGL backbuffer between MapLibre's `idle`
      // and the moment the screenshot lib reads canvas.toDataURL() during
      // clone, even with preserveDrawingBuffer:true — producing a blank map
      // in the exported PNG. Snapshot the map ourselves and overlay an <img>
      // so the clone picks up a stable raster instead of the live canvas.
      // (Kept after the modern-screenshot swap as defense-in-depth — the lib
      // claims better iOS behavior but this overlay is cheap insurance.)
      const map = cardMapRef.current;
      if (map) {
        await new Promise(resolve => {
          map.once("render", resolve);
          map.triggerRepaint();
        });
        const mapDataUrl = map.getCanvas().toDataURL("image/png");
        overlay = document.createElement("img");
        overlay.src = mapDataUrl;
        overlay.style.position = "absolute";
        overlay.style.inset = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "10";
        map.getContainer().appendChild(overlay);
      }

      // Force the editorial 480px design width during capture so the PNG
      // doesn't reflow narrower on phones — the visible card stays unchanged
      // because modern-screenshot applies the style override only to its DOM
      // clone. No-op when the visible card is already at design width.
      const visibleWidth = cardRef.current.getBoundingClientRect().width;
      const captureOpts = { scale: 3 };
      if (visibleWidth < 480) {
        captureOpts.style = { width: "480px", maxWidth: "480px" };
      }
      const blob = await domToBlob(cardRef.current, captureOpts);
      if (!blob) throw new Error("PNG capture returned no data");

      const slugStops = stopValues.map(v => v.trim()).filter(Boolean);
      const slugSource = slugStops.length >= 2 ? slugStops.join("-to-") : `${origin}-to-${destination}`;
      const slug = slugSource.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const filename = `walk-${slug}.png`;

      // Prefer the native share sheet — it bundles the card image with a
      // clickable link back to Passage, which is the whole point of this
      // flow. Falls through to download on browsers without file-share
      // support (most desktops).
      const file = new File([blob], filename, { type: "image/png" });
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({
            files: [file],
            url: shareUrl || undefined,
            title: "Passage",
            text: shareCaption,
          });
          return;
        } catch (err) {
          // User dismissed the share sheet — silently bail.
          if (err?.name === "AbortError") return;
          // Other share failures (NotAllowedError, etc.) fall through to
          // download so the user still walks away with something.
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error("[RouteCard] PNG capture failed:", err);
      showToast?.("Couldn't render the card. Please try again.");
    } finally {
      overlay?.remove();
    }
  }, [stopValues, origin, destination, shareUrl, shareCaption, showToast]);

  const handleCopyShareLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        // Fallback for browsers without async clipboard (older Safari, some
        // in-app webviews). A throwaway textarea + execCommand is the
        // canonical workaround.
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      showToast?.("Link copied — share it anywhere.");
    } catch (err) {
      console.error("[RouteCard] Copy link failed:", err);
      showToast?.("Couldn't copy the link. Try long-pressing the URL.");
    }
  }, [shareUrl, showToast]);

  return {
    showShareModal,
    cardMapReady,
    canWebShare,
    cardRef,
    cardMapRef,
    shareUrl,
    siteHost,
    shareCaption,
    handleOpenShare,
    handleCloseShare,
    handleCardMapReady,
    handleShareCard,
    handleCopyShareLink,
  };
}
