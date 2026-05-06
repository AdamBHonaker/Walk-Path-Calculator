// Resolve and validate the backend base URL at module load. Production builds
// require an explicit `VITE_BACKEND_URL`; dev builds default to localhost. A
// bare http:// URL is rejected in production to keep the deployed PWA from
// silently downgrading to plaintext.

function normalizeBackendUrl(rawUrl) {
  if (!rawUrl) return null;
  if (rawUrl.match(/^https:\/\//i)) return rawUrl;
  if (rawUrl.match(/^http:\/\//i)) {
    if (import.meta.env.PROD) {
      throw new Error("VITE_BACKEND_URL must use https:// in production builds.");
    }
    return rawUrl;
  }
  return `https://${rawUrl}`;
}

function resolveBackendUrl() {
  const normalized = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL);
  if (normalized) return normalized;
  if (import.meta.env.PROD) {
    throw new Error("VITE_BACKEND_URL is required in production builds.");
  }
  return "http://localhost:8000";
}

export const BACKEND_URL = resolveBackendUrl();
