// Shareable-link URL parsing. The route page accepts both the legacy
// `?from=…&to=…` shape and the multi-stop `?stops=A|B|C` shape (each segment
// individually URL-encoded so a literal "|" in a label can't be misread as a
// separator). `hft` / `hin` carry the personalize-modal height so a recipient
// computes the same step counts the sender saw.

export const MAX_STOPS = 8;

export function parseStopsParam(raw) {
  if (!raw) return null;
  const parts = raw.split("|").map(s => {
    // Per-stop encodeURIComponent in the writer keeps "|" inside a label
    // from being misread as a separator. Tolerate legacy/un-encoded URLs
    // by falling back to the raw segment when decode fails.
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
      hft:  hft != null && !isNaN(hft) && hft >= 4 && hft <= 7 ? hft : null,
      hin:  hin != null && !isNaN(hin) && hin >= 0 && hin <= 11 ? hin : null,
    };
  } catch {
    return { from: "", to: "", stops: null, hft: null, hin: null };
  }
}
