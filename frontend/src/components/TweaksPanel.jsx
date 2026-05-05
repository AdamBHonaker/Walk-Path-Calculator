import React, { useEffect, useState } from "react";

const STORAGE_KEY = "walkpath:theme";

export function TweaksPanel() {
  const [enabled, setEnabled] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "dusk" ? "dusk" : "cream";
    } catch {
      return "cream";
    }
  });

  // Apply theme to <html class="theme-dusk"> + persist
  useEffect(() => {
    if (theme === "dusk") {
      document.documentElement.classList.add("theme-dusk");
    } else {
      document.documentElement.classList.remove("theme-dusk");
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode — ignore */
    }
  }, [theme]);

  // Host edit-mode protocol — listener FIRST, then announce
  useEffect(() => {
    function onMessage(e) {
      if (!e?.data || typeof e.data !== "object") return;
      if (e.data.type === "__activate_edit_mode") setEnabled(true);
      if (e.data.type === "__deactivate_edit_mode") setEnabled(false);
    }
    window.addEventListener("message", onMessage);
    try {
      window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    } catch { /* cross-origin */ }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const close = () => {
    setEnabled(false);
    try {
      window.parent.postMessage({ type: "__edit_mode_dismissed" }, "*");
    } catch { /* cross-origin */ }
  };

  if (!enabled) return null;

  return (
    <aside
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        padding: 16,
        border: "1px solid var(--ink)",
        background: "var(--paper-bright, var(--paper))",
        fontFamily: "var(--wf-serif)",
        width: 240,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--wf-sans)",
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "var(--ink)",
          }}
        >
          Tweaks
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Close tweaks panel"
          style={{
            background: "transparent",
            border: "none",
            fontSize: 16,
            cursor: "pointer",
            color: "var(--mute)",
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <label
        style={{
          fontStyle: "italic",
          fontSize: 12,
          color: "var(--mute)",
          display: "block",
          marginTop: 4,
        }}
      >
        Theme
      </label>
      <div style={{ display: "flex", marginTop: 6, border: "1px solid var(--ink)" }}>
        {["cream", "dusk"].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            style={{
              flex: 1,
              padding: "6px 10px",
              border: "none",
              background: theme === t ? "var(--ink)" : "transparent",
              color: theme === t ? "var(--paper)" : "var(--ink)",
              fontFamily: "var(--wf-sans)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {t === "cream" ? "Cream" : "Dusk"}
          </button>
        ))}
      </div>
    </aside>
  );
}
