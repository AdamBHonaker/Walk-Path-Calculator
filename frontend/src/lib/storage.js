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

// sessionStorage variants — same swallow-exceptions pattern, different lifetime.
// Use these for state that should survive a reload (PWA SW autoUpdate, browser
// refresh) but not persist across days: in-progress form values, draft inputs.

export function safeSessionGet(key) {
  try { return sessionStorage.getItem(key); }
  catch { return null; }
}

export function safeSessionSet(key, value) {
  try { sessionStorage.setItem(key, value); return true; }
  catch { return false; }
}

export function safeSessionRemove(key) {
  try { sessionStorage.removeItem(key); return true; }
  catch { return false; }
}

export function loadSessionJSON(key, fallback = null) {
  const raw = safeSessionGet(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch { return fallback; }
}

export function saveSessionJSON(key, value) {
  return safeSessionSet(key, JSON.stringify(value));
}
