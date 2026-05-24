// Cream / Dusk theme switching, applied as a class on <html>. The boot
// script in index.html reads the same localStorage key on page load to
// avoid a flash of the wrong theme — keep the key + values in sync.
//
// A module-level subscriber set lets components observe theme changes
// without scanning the `<html>` element via a MutationObserver (TD-065 /
// F-08). `applyTheme` is the single write path — every flip notifies
// every subscriber, so MapExploreLayer's paint refresh lives downstream
// of `useSyncExternalStore` rather than DOM-mutation-driven.

import { useSyncExternalStore } from "react";
import { safeGet, safeSet } from "./storage.js";

const THEME_KEY = "walkpath:theme";

let _currentTheme = safeGet(THEME_KEY) === "dusk" ? "dusk" : "cream";
const _subscribers = new Set();

export function loadTheme() {
  return _currentTheme;
}

export function applyTheme(theme) {
  const next = theme === "dusk" ? "dusk" : "cream";
  if (next === "dusk") {
    document.documentElement.classList.add("theme-dusk");
  } else {
    document.documentElement.classList.remove("theme-dusk");
  }
  safeSet(THEME_KEY, next);
  if (_currentTheme !== next) {
    _currentTheme = next;
    for (const cb of _subscribers) cb(next);
  }
}

// React subscription. Components call `useTheme()` and re-render on flip.
// `useSyncExternalStore` guarantees the snapshot used during render matches
// what subscribers will observe — no tearing across concurrent rendering.
function subscribe(cb) {
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}
function getSnapshot() {
  return _currentTheme;
}
export function useTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
