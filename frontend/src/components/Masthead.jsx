import React from "react";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";

const EPOCH = new Date("2025-04-01");

function issueNumber(today = new Date()) {
  const days = Math.floor((today.getTime() - EPOCH.getTime()) / 86_400_000);
  return String(Math.max(1, days)).padStart(3, "0");
}

function formatDate(d = new Date()) {
  return d
    .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    .toUpperCase();
}

export function Masthead() {
  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        paddingBottom: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontFamily: "var(--wf-sans)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--mute)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <WPIcon name="chicago-mark" size={14} />
          Passage
        </span>
        <span>Vol. I · No. {issueNumber()} · {formatDate()}</span>
      </div>
      <div style={{ height: 1, background: "var(--ink)" }} />
      <div style={{ height: 2, background: "var(--ink)", marginTop: 2 }} />
      <p
        style={{
          fontFamily: "var(--wf-serif)",
          fontStyle: "italic",
          fontSize: 14,
          color: "var(--mute)",
          margin: 0,
          marginTop: 4,
        }}
      >
        A daily routefinder for those who would rather walk.
      </p>
    </header>
  );
}
