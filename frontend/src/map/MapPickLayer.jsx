import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { unlockMapGestures } from "../mapHelpers.js";
import { formatLatLonLabel } from "../lib/coordsFormat.js";

// Pick-on-map: drops a preview pin on click, pops a Cancel/Confirm card,
// commits to the parent on Confirm. Owns gesture lock/unlock for pick
// duration and the crosshair cursor.
//
export function MapPickLayer({
  mapRef,
  pickMode,
  resolveLabel,
  onPickPoint,
}) {
  const previewMarkerRef = useRef(null);
  const previewReqRef    = useRef(0);
  const [previewPick, setPreviewPick] = useState(null); // {lat, lon, label, resolving}

  // Pick-on-map: unlock gestures while picking so the user can pan/zoom to
  // their target, drop a preview pin on click, and only commit after Confirm.
  // Clicking again while a preview is active moves the pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pickMode) {
      previewMarkerRef.current?.remove();
      previewMarkerRef.current = null;
      previewReqRef.current++;
      setPreviewPick(null);
      // Gesture re-lock on pick exit is owned by MapView's mode/pickMode effect,
      // so explore mode (which wants gestures unlocked) wins on initial mount.
      return;
    }

    unlockMapGestures(map);

    function handleClick(e) {
      const { lng, lat } = e.lngLat;
      previewMarkerRef.current?.remove();
      previewMarkerRef.current = new maplibregl.Marker({ color: "#e53935" })
        .setLngLat([lng, lat])
        .addTo(map);

      const reqId = ++previewReqRef.current;
      setPreviewPick({ lat, lon: lng, label: null, resolving: true });

      if (resolveLabel) {
        Promise.resolve(resolveLabel(lat, lng))
          .then(label => {
            if (previewReqRef.current !== reqId) return;
            setPreviewPick(prev => prev ? { ...prev, label: label || null, resolving: false } : prev);
          })
          .catch(() => {
            if (previewReqRef.current !== reqId) return;
            setPreviewPick(prev => prev ? { ...prev, label: null, resolving: false } : prev);
          });
      } else {
        setPreviewPick(prev => prev ? { ...prev, resolving: false } : prev);
      }
    }

    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [pickMode, resolveLabel, mapRef]);

  // Crosshair cursor while pick mode is active
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    if (canvas) canvas.style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode, mapRef]);

  function handleConfirmPick() {
    if (!previewPick || !onPickPoint) return;
    const { lat, lon, label } = previewPick;
    previewMarkerRef.current?.remove();
    previewMarkerRef.current = null;
    previewReqRef.current++;
    setPreviewPick(null);
    onPickPoint(lat, lon, label);
  }

  function handleCancelPick() {
    previewMarkerRef.current?.remove();
    previewMarkerRef.current = null;
    previewReqRef.current++;
    setPreviewPick(null);
  }

  return (
    <>
      {pickMode && !previewPick && (
        <div className="map-pick-hint">
          <span className="map-pick-hint-lamp" aria-hidden="true" />
          <em>Pan or zoom, then click the map to set this point.</em>
        </div>
      )}
      {previewPick && (
        <div className="map-pick-confirm" role="dialog" aria-label="Confirm location">
          <div className="map-pick-confirm-label">
            {previewPick.resolving
              ? "Looking up that spot…"
              : (previewPick.label
                  || formatLatLonLabel(previewPick.lat, previewPick.lon))}
          </div>
          <div className="map-pick-confirm-sub">
            Click again to move the pin. Confirm to keep it.
          </div>
          <div className="map-pick-confirm-actions">
            <button
              type="button"
              className="map-pick-confirm-btn map-pick-confirm-btn--cancel"
              onClick={handleCancelPick}
            >
              Cancel
            </button>
            <button
              type="button"
              className="map-pick-confirm-btn map-pick-confirm-btn--ok"
              onClick={handleConfirmPick}
              disabled={previewPick.resolving}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </>
  );
}
