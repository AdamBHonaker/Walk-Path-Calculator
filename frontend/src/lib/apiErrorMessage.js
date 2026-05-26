// Shared parser for FastAPI error envelopes used by both /route and /explore
// callers. Backend returns either { detail: { message, ... } } (structured —
// the route endpoint's per-stop errors and the explore endpoint's 422s) or
// { detail: "<string>" } (FastAPI default). A 429 from either endpoint means
// the LocationIQ breaker tripped — same root cause, same recovery hint.
//
// `serviceLabel` ("route" / "explore") is purely for the 429 fallback copy
// since the user-facing service name differs between endpoints; the parsed
// `detail.message` / string-`detail` paths short-circuit it.

const DEFAULT_429 = "Service is rate-limited — try again in a minute.";

export async function parseApiErrorMessage(response, serviceLabel = null) {
  const fallback429 = serviceLabel
    ? `The ${serviceLabel} service is rate-limited — try again in a minute.`
    : DEFAULT_429;
  let msg = `Service error (${response.status})`;
  try {
    const d = await response.json();
    if (d.detail && typeof d.detail === "object" && d.detail.message) {
      return d.detail.message;
    }
    if (typeof d.detail === "string") {
      return d.detail;
    }
    if (response.status === 429) return fallback429;
  } catch (e) {
    if (response.status === 429) return fallback429;
    // Non-429 with an unparseable body (e.g. proxy / CDN HTML error page).
    // Surface in dev so the underlying response shape is diagnosable; the
    // user-facing string still falls through to the generic Service-error.
    console.warn(`[apiErrorMessage] ${response.status} body not JSON:`, e);
  }
  return msg;
}
