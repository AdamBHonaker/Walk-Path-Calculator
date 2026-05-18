// Shareable-link URL parsing. The route page accepts both the legacy
// `?from=…&to=…` shape and the multi-stop `?stops=A|B|C` shape. The writer
// lets `URLSearchParams.set` handle percent-encoding, so segments arrive
// here already decoded by `URLSearchParams.get`. `hft` / `hin` carry the
// personalize-modal height so a recipient computes the same step counts the
// sender saw.

export const MAX_STOPS = 8;

export function parseStopsParam(raw) {
  if (!raw) return null;
  const parts = raw.split("|").map(s => {
    // Legacy URLs written before BUG-009 double-encoded each segment, so a
    // single decodeURIComponent recovers the original label. Modern URLs are
    // already decoded by URLSearchParams.get, so this is a no-op for them
    // (an unencoded label has no "%" to decode). Fall back to the raw
    // segment if decoding throws on malformed input.
    let decoded;
    try { decoded = decodeURIComponent(s); }
    catch { decoded = s; }
    return decoded.trim().slice(0, 200);
  });
  const filled = parts.filter(Boolean);
  if (filled.length < 2) return null;
  return filled.slice(0, MAX_STOPS);
}

export function readUrlParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    const hft = p.has("hft") ? parseInt(p.get("hft"), 10) : null;
    const hin = p.has("hin") ? parseInt(p.get("hin"), 10) : null;
    const cap = (s) => (s || "").slice(0, 200);
    const stopsRaw = p.get("stops");
    const stops = parseStopsParam(stopsRaw);
    return {
      from: cap(p.get("from")),
      to:   cap(p.get("to")),
      stops,
      // Height range mirrors loadStoredHeightFt + backend's 36–108 in
      // validator (3–9 ft); shareable URL caps at 8 to match the FT_OPTIONS
      // dropdown.
      hft:  hft != null && !isNaN(hft) && hft >= 3 && hft <= 8 ? hft : null,
      hin:  hin != null && !isNaN(hin) && hin >= 0 && hin <= 11 ? hin : null,
    };
  } catch {
    return { from: "", to: "", stops: null, hft: null, hin: null };
  }
}
