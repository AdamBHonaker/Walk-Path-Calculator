// Thin localStorage wrappers that swallow exceptions (quota, privacy mode,
// disabled storage). Every call site previously open-coded this try/catch —
// using these helpers keeps the surface area in one place.

export function safeGet(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

export function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}

export function safeRemove(key) {
  try { localStorage.removeItem(key); return true; }
  catch { return false; }
}

export function loadJSON(key, fallback = null) {
  const raw = safeGet(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch { return fallback; }
}

export function saveJSON(key, value) {
  return safeSet(key, JSON.stringify(value));
}
