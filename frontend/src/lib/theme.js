// Cream / Dusk theme switching, applied as a class on <html>. The boot
// script in index.html reads the same localStorage key on page load to
// avoid a flash of the wrong theme — keep the key + values in sync.

import { safeGet, safeSet } from "./storage.js";

const THEME_KEY = "walkpath:theme";

export function loadTheme() {
  return safeGet(THEME_KEY) === "dusk" ? "dusk" : "cream";
}

export function applyTheme(theme) {
  const next = theme === "dusk" ? "dusk" : "cream";
  if (next === "dusk") {
    document.documentElement.classList.add("theme-dusk");
  } else {
    document.documentElement.classList.remove("theme-dusk");
  }
  safeSet(THEME_KEY, next);
}
