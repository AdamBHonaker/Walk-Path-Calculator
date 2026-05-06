# Technical Debt

Known technical debt catalogued for future resolution. Priority: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an item in this file is resolved, **delete its entry from this file** and add a corresponding entry to the **Technical Debt Paid Off** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain debt that has not yet been addressed.

---

## Tech Debt Scan — 2026-04-28 (backend/)

*(All 8 items from this scan resolved on 2026-04-28. See [RESOLVED_HISTORY.md](archive/RESOLVED_HISTORY.md).)*

---

## Tech Debt Scan — 2026-04-28 (frontend/)

*(All 6 items from this scan resolved on 2026-04-28. See [RESOLVED_HISTORY.md](archive/RESOLVED_HISTORY.md).)*

---

## Tech Debt Scan — 2026-05-03 (full project)

*(All 11 items from this scan resolved on 2026-05-04. See [RESOLVED_HISTORY.md](archive/RESOLVED_HISTORY.md).)*

---

## Tech Debt Scan — 2026-05-06 (backend/)

*(All 7 items from this scan resolved on 2026-05-06. See [RESOLVED_HISTORY.md](archive/RESOLVED_HISTORY.md).)*

---

## Tech Debt Scan — 2026-05-06 (frontend/)

*(10 of 11 items from this scan resolved on 2026-05-06; TD-009 (outdated dependencies) deferred — needs version-by-version device testing. See [RESOLVED_HISTORY.md](archive/RESOLVED_HISTORY.md).)*

---

### TD-009 · Outdated direct dependencies
- **File**: [frontend/package.json:15-19](frontend/package.json#L15-L19)
- **Line(s)**: 16, 17, 18–19
- **Category**: Outdated Dependency
- **Priority**: 🟡 Medium
- **Description**: Pinned majors that are one (or two) majors behind:
  - `react` / `react-dom` `^18.3.1` — React 19 GA shipped in late 2024; brings the new compiler, Actions / `useActionState`, and behavioral changes around `useEffect` timing and refs.
  - `maplibre-gl` `^4.7.1` — v5.x is out; performance + WebGL2 work. The codebase uses many paint expressions ([mapHelpers.js](frontend/src/mapHelpers.js)), so an upgrade needs a smoke-test pass.
  - `html-to-image` `1.11.13` — no longer the most actively maintained PNG-clone library; alternatives (`html2canvas-pro`, `modern-screenshot`) target the same use case with better iOS Safari behavior, which directly intersects the existing iOS workarounds in App.jsx's `handleDownloadCard`.

  None are critical today, but each compounds the cost of staying current and a security advisory in any of them turns into urgent work later.
- **Suggested Improvement**: Land them as separate small upgrades, each behind a manual mobile smoke test on iOS Safari + Android Chrome (the share-card export and the bottom-sheet drag are the highest-risk surfaces). Start with `maplibre-gl` (smallest blast radius), evaluate `html-to-image` against `modern-screenshot`, and treat React 19 as its own scoped initiative once the PWA + Vite story for it is comfortable.

---


