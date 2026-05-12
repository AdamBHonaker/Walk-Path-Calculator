# Features Implemented History

A log of features that have been designed and fully implemented. Entries are moved here from `FEATURE_PLANS.md` when complete.

> **Process:** When a feature in `FEATURE_PLANS.md` is finished, **delete its entry from that file** and add a corresponding entry here summarizing what was built. `FEATURE_PLANS.md` should only ever contain features that have not yet been implemented.

---

## Feature Index

**Bolt-On** = self-contained, no dependencies on other planned features.
**Structural** = depends on one or more other features before it can be fully built or realized.

| Feature | Type | Shipped |
|---------|------|---------|
| Alternative Routes | Structural | 2026-05-02 |
| Multi-Day Step Accumulator | Bolt-On | 2026-05-02 |
| Shareable Route Card | Bolt-On | 2026-05-02 |
| Click Map to Set Origin / Destination | Structural | 2026-05-02 |
| Animated Route Drawing | Bolt-On | 2026-05-02 |
| URL-Encoded Route Sharing | Bolt-On | 2026-05-02 |
| Highlighted Turn Points on Map | Bolt-On | 2026-05-02 |
| Swap Origin / Destination Button | Bolt-On | 2026-05-02 |
| Custom Daily Step Goal | Bolt-On | 2026-05-02 |
| Copy Directions as Plain Text | Bolt-On | 2026-05-02 |
| Calorie Equivalents | Bolt-On | 2026-05-02 |
| Recent Searches | Bolt-On | 2026-05-02 |
| Weight Input for Calories | Bolt-On | 2026-05-02 |
| Pace Customization | Bolt-On | 2026-05-02 |
| Waypoints / Multi-Stop Routes | Structural | 2026-05-02 |
| Reject geocodes outside the Chicago bbox | Bolt-On | 2026-05-05 |
| Tighten geocoder fuzzy-match threshold | Bolt-On | 2026-05-05 |
| Cache + back off on Google Maps 429s | Bolt-On | 2026-05-05 |
| Sheet Snap Memory Across Sessions | Bolt-On | 2026-05-05 |
| Haptic Feedback on Sheet Snap Settle | Bolt-On | 2026-05-05 |
| Pace Selector as Segmented Control on Mobile | Bolt-On | 2026-05-05 |
| Off-screen 480 px PNG Render for ShareDispatch | Bolt-On | 2026-05-05 |
| Landscape phone orientation polish | Bolt-On | 2026-05-05 |
| Tablet range (481–1023 px) layout | Bolt-On | 2026-05-05 |
| Tunnel-based mobile dev access (HTTPS) | Bolt-On | 2026-05-05 |
| Drag-from-body with scroll handoff (sheet) | Bolt-On | 2026-05-05 |
| Velocity-aware sheet snap | Bolt-On | 2026-05-05 |
| Map-First Mobile UI Foundation | Structural | 2026-05-05 |
| Theme Toggle in Personalize Modal | Bolt-On | 2026-05-05 |
| Geolocation CTA on the map | Bolt-On | 2026-05-05 |
| Code-splitting MapView for faster cold-load | Bolt-On | 2026-05-05 |
| Follow My Location (live map tracking) | Bolt-On | 2026-05-11 |

---

## Follow My Location (live map tracking)
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-11

The one-shot "Use my current location" button only seeds an origin — it doesn't help once the user is actually walking the route. Added a continuous "Follow" toggle that streams `watchPosition` fixes, renders a live user-location pin on the map, and re-centers the camera on every update. Works in both route and explore modes.

**What changed:**
- [frontend/src/lib/geolocation.js](frontend/src/lib/geolocation.js) — new `watchCurrentLocation({ onFix, onError })` wraps `navigator.geolocation.watchPosition` with `enableHighAccuracy: true` and `maximumAge: 0`. Reuses the Chicago-bbox gate and the existing `denied / outside_coverage / unavailable` error vocabulary. Returns a teardown function. `resolveCurrentLocation` left untouched so the existing locate flow doesn't churn.
- New [frontend/src/hooks/useFollowLocation.js](frontend/src/hooks/useFollowLocation.js) — owns the watch lifecycle, exposes `{ following, position, error, toggle, stop }`. Auto-stops when its `enabled` prop flips false (mode change, no route or explore result) and on unmount.
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx) — accepts `userPosition` / `following` / `onToggleFollow`. Adds a `walk-path-user-loc` GeoJSON source with two layers: a translucent blue accuracy halo (zoom-interpolated, scaled from the fix's `accuracy` in meters) and a solid blue dot with a white stroke. Auto-`easeTo` on each fix while following — zoom is preserved between fixes but bumped to ≥ 15 on the *first* fix of a session so the pin isn't lost inside a zoomed-out route fit. Manual `dragstart` / `zoomstart` / `rotatestart` / `pitchstart` disengage follow (filtered to user-originated events via the `originalEvent != null` check, so our own `easeTo` doesn't self-cancel). New "Follow / Following" button uses a new `navigation` arrow glyph.
- [frontend/src/App.jsx](frontend/src/App.jsx) — wires the hook, passes the three props into MapView, stops follow on mode change or when both `viewResult` and `exploreResult` clear, and surfaces `watchPosition` errors through the existing `showToast` copy.
- [frontend/src/wayfarer/walkpath-icons.jsx](frontend/src/wayfarer/walkpath-icons.jsx) — added the `navigation` arrow so the Follow button is visually distinct from the adjacent `crosshair` locate button.
- [frontend/src/App.css](frontend/src/App.css) — `.map-follow-btn` mirrors `.map-locate-btn`'s editorial chrome; `--active` inverts ink/paper to signal a live watch. Mobile media query collapses it to a 44 × 44 icon and stacks it directly below the locate button using the same `:has()` re-anchor pattern the unlock button already uses; the unlock button is pushed one further slot down when both are visible.

**Tests:** 14 new (`watchCurrentLocation` + `useFollowLocation`). Full suite is 218/218.

---

## Code-splitting MapView for faster cold-load
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

The production build was a single 1.03 MB JS bundle (~290 KB gzip), almost entirely MapLibre. On cold load the form panel could not become interactive until that whole bundle parsed. Splitting the MapLibre-dependent surfaces into lazy chunks gets the form rendering immediately while the map streams in alongside.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx) — `MapView` and `ShareDispatch` are now imported via `React.lazy` and each render site is wrapped in a `<Suspense>` boundary with a same-dimension placeholder (`.map-lazy-fallback`, `.share-card-lazy-fallback`) so first paint doesn't shift. ShareDispatch had to be lazy too — leaving it eager would have pinned MapLibre back into the initial graph since the modal's import is at module top-level.
- [frontend/src/main.jsx](frontend/src/main.jsx) — removed the eager `import "maplibre-gl/dist/maplibre-gl.css"`. The stylesheet now lives inside [MapView.jsx](frontend/src/MapView.jsx) and [ShareDispatch.jsx](frontend/src/components/ShareDispatch.jsx), so Vite emits it as a separate CSS chunk that loads in parallel with the lazy JS.
- [frontend/vite.config.js](frontend/vite.config.js) — added `build.rollupOptions.output.manualChunks` pinning anything under `node_modules/maplibre-gl/` into a shared `maplibre` chunk so MapView and ShareDispatch don't each duplicate the library.
- [frontend/src/App.css](frontend/src/App.css) — added the two fallback selectors above so the placeholder reserves the right box.

**Build result:**
- Initial chunk: **220 KB / 69.5 KB gzip** (was ~290 KB gzip — a 76% reduction, comfortably past the 60% acceptance bar).
- Separate chunks: `maplibre-*.js` 803 KB / 218 KB gzip, `maplibre-*.css` 65 KB / 9.2 KB gzip, `MapView-*.js` 6.6 KB, `ShareDispatch-*.js` 5.0 KB.
- `html-to-image` continues to load on demand via the existing dynamic `import("html-to-image")` in `handleDownloadCard`.

**Test impact:** all 170 frontend tests pass with the lazy boundaries in place. The maplibre-gl module mock in `test-setup.js` still applies because vi.mock matches by module ID, not by static-vs-dynamic import.

---

## Geolocation CTA on the map
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

Added a "Use my current location" floating action on the map. Click it to populate the first empty stop (or origin if all stops have values) without typing — bridges the gap between pick-on-map (already required clicking a precise spot) and typed entry. Designed so FEAT #1 (Neighborhood Explorer)'s "current location" mode can reuse the same helper.

**What changed:**
- New [frontend/src/lib/geolocation.js](frontend/src/lib/geolocation.js) — `resolveCurrentLocation()` wraps `navigator.geolocation.getCurrentPosition` and classifies outcomes into `{ lat, lon }` or `{ error: "denied" | "outside_coverage" | "unavailable" }`. Coverage gating happens locally against the same Chicago bbox the backend uses, so we don't pay a `/reverse-geocode` round trip for points the backend would 422 anyway.
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx) gained `onLocateMe` / `locating` props and renders a top-right floating button. While resolving, the button gets `wf-anim-radar` (reusing the existing keyframe in [motion.css](frontend/src/wayfarer/motion.css)) and is disabled. The button hides during pick-on-map and on style errors.
- [frontend/src/App.jsx](frontend/src/App.jsx) owns the `locating` state and `handleLocateMe`: target = first empty stop, falling back to origin; success calls the existing `resolveStopLabel` helper for the address; failure inserts `lat.toFixed(5), lon.toFixed(5)` and toasts the same "no name we know" copy as `handleMapPick`. Toast plumbing factored into a small `showToast` callback so the three error paths (denied / outside_coverage / unavailable) and the coordinates-fallback share one call site.
- [App.css](frontend/src/App.css) — `.map-locate-btn` mirrors `.map-unlock-btn`'s editorial chrome but anchors top-right by default; mobile media query (≤ 768 px) collapses it to 44 × 44 px under the floating masthead, with a `:has(+ .map-locate-btn)` rule that pushes the unlock button below the locate button when both are visible so they don't overlap.

**FEAT #1 reuse note:** chunk 8 of the Neighborhood Explorer plan now expects this helper — keep `resolveCurrentLocation`'s return shape stable when wiring the explorer's "📍 My location" radio.

---

## Theme Toggle in Personalize Modal
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

The Cream / Dusk theme switcher used to live in `TweaksPanel`, a hidden component activated only by an external AI editor harness via a `__activate_edit_mode` postMessage protocol — end users couldn't reach it. Promoted to a real user-facing setting: a "Display" section in `PersonalizeModal` next to height / weight / daily measure. The harness panel and its protocol were deleted entirely.

**What changed:**
- New [frontend/src/lib/theme.js](frontend/src/lib/theme.js) — `loadTheme()` / `applyTheme(theme)` helpers using the existing safe-storage wrappers. The `walkpath:theme` localStorage key matches the boot script in [frontend/index.html](frontend/index.html), so the page picks up the right palette before React mounts (no FOUC).
- [frontend/src/components/PersonalizeModal.jsx](frontend/src/components/PersonalizeModal.jsx) gained a Display section — two-cell segmented control with proper `radiogroup` / `aria-checked` semantics, 44 px tap height, italic editorial labels ("Cream / Bone-white paper" · "Dusk / Lamplit deep ink"), italic hint line beneath. Theme state is local to the modal; `applyTheme` mutates `<html>` and writes to localStorage on every change. The Reset button intentionally does **not** clear theme — it's a display preference, not a particular.
- Deleted `frontend/src/components/TweaksPanel.jsx` and its references in `App.jsx` (import + render). The `__edit_mode_*` postMessage protocol is gone with it; nothing else in the codebase referenced either.

**Concurrent fix — height select native rendering on Dusk:** promoting the toggle exposed an existing rendering bug. The `<select>` elements for height feet / inches had no inline styling, so macOS Safari / iOS drew the displayed value in OS system colours regardless of our `color`. On Dusk that meant dark system text on the dark `paper-bright` background — unreadable. Opted out of native rendering with `appearance: none` (plus `WebkitAppearance` / `MozAppearance`) on a new `heightSelectStyle`, added an explicit chevron span (`▾` in `var(--mute)`) in a `position: relative` wrapper around each select, and set `colorScheme: "light dark"` so the native option popup also carries the active theme. Disabled state (inches while feet is null) gets `opacity: 0.4` + `cursor: not-allowed` since `appearance: none` strips the browser's default disabled styling.

---

## Map-First Mobile UI Foundation
**Type:** Structural | **Area:** Frontend + Wayfarer | **Shipped:** 2026-05-05

Replaces the single-breakpoint "stack the layout vertically" mobile fallback (a leftover from the Wayfarer Phase 1 migration) with a real map-first composition: below 768 px the app renders a new `MobileLayout` — full-bleed map, floating compact `Masthead`, and a draggable `WFSheet` containing form / results / directions. Wayfarer was extended with the responsive primitives the new layout depends on so future components inherit them.

This entry covers the platform layer; the sheet-behaviour refinements (snap memory, haptic, velocity, drag-from-body, landscape profile) and per-component polish (segmented pace, off-screen PNG, tablet range) shipped concurrently and have their own entries below.

**Wayfarer extensions:**
- New breakpoint tokens (`--bp-mobile`, `--bp-tablet`, `--bp-desktop`), safe-area `env()` helpers (`--safe-top/right/bottom/left`), and compact type variants (`--fs-display-compact`, `--fs-headline-compact`, `--fs-title-compact`) in [tokens.css](frontend/src/wayfarer/tokens.css).
- New [responsive.css](frontend/src/wayfarer/responsive.css) — visibility helpers (`wf-mobile-only` / `wf-mobile-hide` / `wf-tablet-up`), safe-area paddings, container utility, a `(pointer: coarse)` 44 × 44 px touch-target floor, and the `wf-modal-overlay` / `wf-modal-card` mobile-fullscreen overrides used by `WFModal` and `PersonalizeModal`.
- New `WFSheet` primitive in [primitives.jsx](frontend/src/wayfarer/primitives.jsx) — paper-stock bottom sheet with snap-point math (px / % / dvh), pointer-event drag, editorial easing curve (`--ease-walk` × `--dur-considered`), and `prefers-reduced-motion` handling.
- `WFModal` ([extras.jsx](frontend/src/wayfarer/extras.jsx)) renders full-screen below 480 px via the new responsive classes; centred 480 px card above.
- Form primitives ([forms.jsx](frontend/src/wayfarer/forms.jsx)) bumped to a 16 px font floor (defeats iOS zoom-on-focus) and a 44 px `minHeight` on `WFInput` / `WFButton` / `WFCheck` / `WFRadio`.

**App-level branch:**
- New [`useMediaQuery`](frontend/src/lib/useMediaQuery.js) hook — SSR-safe `matchMedia` subscription used for `(max-width: 768px)` and other breakpoints.
- New [`MobileLayout`](frontend/src/components/MobileLayout.jsx) — composition root that takes `masthead`, `map`, and children, wraps them in a fixed-position shell, and owns the `WFSheet`.
- [App.jsx](frontend/src/App.jsx) extracts `mainContents` and `mapNode` once and slots them into either the existing desktop two-column layout or `MobileLayout`. The same JSX nodes mean React (and the MapLibre instance) preserve component identity across breakpoint crossings — no re-init when a tablet rotates.
- Sheet auto-promotes from peek to half on route arrival, respecting the user's stored snap preference (see Sheet Snap Memory entry).
- [MapView.jsx](frontend/src/MapView.jsx) accepts a `mapPadding` prop (number or `{top, right, bottom, left}`) and threads it into `fitBounds` + active-turn `flyTo` so the route polyline always fits the visible slice above the sheet. App.jsx computes the padding from the sheet's obscured-area callback.
- Compact `Masthead` variant in [Masthead.jsx](frontend/src/components/Masthead.jsx) — brand mark + "Particulars" button that opens `PersonalizeModal`, with safe-area-top padding.

**Component-level refinements:**
- `RouteFlavorTabs` drops the per-tab stats line below 480 px (so 3 cramped tabs become 3 readable tabs); 44 px tap height.
- `DirectionLedger` rows enforce 44 px min-height; Copy + "Show all" buttons taller for thumbs.
- `ShareDispatch` card width is responsive (`min(480, container)`); the editorial 480 px design width is preserved at PNG export time (see Off-screen 480 px PNG Render entry).
- `PersonalizeModal` adopts the new `wf-modal-card` / `wf-modal-overlay` classes so it goes full-screen below 480 px; weight + custom-goal inputs at 16 px font; preset chips at 44 px.

**App.css cleanup:**
- The single `@media (max-width: 700px)` rule that just stacked the columns is gone. Replaced by a `(pointer: coarse)` 44 px floor on the legacy icon buttons (`.swap-btn`, `.stop-move-btn`, `.stop-remove-btn`, `.pick-map-btn`, `.share-modal-close`, `.map-pick-confirm-btn`, `.map-unlock-btn`, `.recent-chip`, `.recent-clear-btn`), an `.app--mobile` 100 dvh shell, mobile-only stop-row label stacking (label on top instead of a 64 px right-aligned column), and a fluid `clamp(48px, 18vw, 96px)` `step-hero-count`.
- Toast respects `--safe-bottom`; `.map-unlock-btn` moves to top-right under the masthead on mobile so the sheet doesn't bury it.

**Other:**
- `viewport-fit=cover` added to [frontend/index.html](frontend/index.html) so `env(safe-area-inset-*)` resolves on notched devices.

---

## Velocity-aware sheet snap
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

`WFSheet` previously settled to the *nearest* snap point on release, which read sticky next to native bottom sheets (Apple Maps, Google Maps, Vaul) — a quick upward flick that released closer to "half" would not promote to "full". The sheet now tracks pointer samples during drag and, on release, computes exit velocity over the trailing ~80 ms; a flick above the threshold promotes/demotes one snap in the direction of motion, while slower releases keep the nearest-snap fallback. Reduced-motion users keep nearest-snap since the velocity feel is itself a motion signal. Multiple-snap leaps (peek → full on a hard fling) are intentionally out of scope for v1.

**What changed:**
- [frontend\src\wayfarer\primitives.jsx](frontend\src\wayfarer\primitives.jsx): added a 4–6-sample ring buffer to `dragStateRef.samples`, populated on `pointerdown`/`pointermove`. Extracted the snap-decision logic into a pure exported helper `decideSnap({ samples, currentSnap, finalTranslate, snapPx, maxHeightPx, reducedMotion })` that returns the nearest snap unless `|velocity| > SHEET_VELOCITY_THRESHOLD` (0.8 px/ms) over the trailing `SHEET_VELOCITY_WINDOW_MS` (80 ms) — in which case it returns `currentSnap ± 1` clamped to the snap range. `onPointerUp` (and the body-drag release path added in the sibling feature) now call the helper instead of computing nearest inline. A small `pointerNow()` shim prefers `performance.now()` and falls back to `Date.now()`.
- [frontend\src\wayfarer\WFSheet.test.jsx](frontend\src\wayfarer\WFSheet.test.jsx): added a `decideSnap` test suite covering nearest fallback below threshold, single-snap promotion on a fast upward fling (the spec's `[(t=0, y=400), (t=80, y=200)]` trajectory plus a same-release-y comparison vs. a slow trajectory), single-snap demotion on a fast downward fling, clamping at the top snap, reduced-motion override, stale-sample trimming via the 80 ms window, and the documented threshold constant.
- [docs\FEATURE_PLANS.md](docs\FEATURE_PLANS.md): entry removed; bolt-on index renumbered.

---

## Drag-from-body with scroll handoff (sheet)
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

The `WFSheet` previously only dragged from its handle, leaving the largest target on a touch device — the body itself — inert. Native bottom sheets (Vaul, Apple Maps, Google Maps) treat a downward drag from the body as a sheet drag *only when* the body is scrolled to the top, otherwise letting the body scroll. This shipped that handoff.

**What changed:**
- [frontend/src/wayfarer/primitives.jsx](frontend/src/wayfarer/primitives.jsx): added `bodyDragRef` plus `onBodyPointerDown` / `onBodyPointerMove` / `onBodyPointerUp` wired to `.wf-sheet-body`. The state machine has three phases — `pending` → (`dragging` | `released`) — committed on the first move past `BODY_DRAG_DEADZONE_PX` (8 px). If the body's `scrollTop === 0` and the gesture is downward, the gesture sets pointer capture and behaves identically to the existing handle drag (samples velocity, settles via `decideSnap`, fires the same haptic). Otherwise it transitions to `released` and never re-engages, so native scroll runs uninterrupted. Existing `overscroll-behavior: contain` on the body keeps iOS rubber-banding from interfering.
- [frontend/src/wayfarer/WFSheet.test.jsx](frontend/src/wayfarer/WFSheet.test.jsx): four new gesture tests cover the four decision branches (commit-to-drag, scrollTop>0 release, upward release, deadzone ignored) by stubbing `scrollTop` on the body element and dispatching synthetic pointer events.

**Decisions made on the open questions:**
- **Deadzone:** 8 px (matched Vaul's default), exported as `BODY_DRAG_DEADZONE_PX` so it's tweakable in one place.
- **`touch-action` on the body:** kept the current default (`auto` / pan-y) rather than flipping to `none`. The commit branch only fires when `scrollTop === 0` — there's nothing for the browser to scroll above that, so native scroll quietly no-ops while the JS drag runs. Synthesizing body scroll ourselves would have been a far larger undertaking with no observable user-facing benefit. Worth re-testing on iOS Safari once the next round of mobile-device testing happens; if it reads off, the fix is to add `touch-action: none` to the body during the dragging phase only.


**Type:** Bolt-On | **Area:** Dev tooling | **Shipped:** 2026-05-05

Real-device mobile testing previously required the phone to share Wi-Fi with the dev machine and hit the laptop's LAN IP over plain HTTP — which blocks every browser secure-context behavior (PWA service-worker registration, "Add to Home Screen", `navigator.geolocation` on iOS Safari, Web Share, clipboard writes) and excludes any reviewer not on the home network. A new tunnel orchestrator gives a public HTTPS URL for a session with no manual env wiring.

**What changed:**
- New [scripts/dev-tunnel.mjs](scripts/dev-tunnel.mjs): cross-platform Node ESM orchestrator that spawns uvicorn (`127.0.0.1:8000`), opens an ephemeral Cloudflare tunnel to it, writes the captured URL into `frontend/.env.local` as `VITE_BACKEND_URL`, starts vite, opens a second Cloudflare tunnel to the frontend, and prints the public HTTPS URL. SIGINT tears down all four child processes and removes `frontend/.env.local` so the next `npm run dev` starts clean.
- [frontend/package.json](frontend/package.json): new `dev:tunnel` script.
- [frontend/vite.config.js](frontend/vite.config.js): `server.allowedHosts` now includes `.trycloudflare.com` so vite's host check accepts the ephemeral subdomain.
- [backend/main.py](backend/main.py): reads a dev-only `DEV_TUNNEL_ORIGIN_REGEX` env var and passes it to `CORSMiddleware(allow_origin_regex=…)`. The orchestrator sets `^https://[a-z0-9-]+\.trycloudflare\.com$` so any per-session frontend tunnel origin is accepted without manual CORS edits. Production never sets the var.
- [backend/.env.example](backend/.env.example): documents `DEV_TUNNEL_ORIGIN_REGEX` with a "never set in production" warning.
- New [docs/MOBILE_TESTING.md](docs/MOBILE_TESTING.md): full setup walkthrough (cloudflared install via `winget` / `brew`), the security caveat (don't run against a `backend/.env` holding production secrets), iOS Safari verification checklist, and an ngrok fallback path.
- [CLAUDE.md](CLAUDE.md): pointer in "Running Locally" to the new mobile-testing doc.

**Decisions made on the open questions:** Cloudflare default (no account, free `trycloudflare.com`); per-session ephemeral URLs (named-tunnel deferred); separate `dev:tunnel` script (vs. a flag on `npm run dev`); both backend and frontend tunneled (a CORS-permitted phone request to localhost would otherwise hit the *phone's* localhost). QR-code output skipped — keeps zero new npm deps; the printed URL is highlighted prominently enough to type in.

## Tablet range (481–1023 px) layout
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

The mobile/desktop layout switch in [frontend/src/App.jsx](frontend/src/App.jsx) previously flipped at 768 px, leaving the 481–768 px tablet portrait range either rendered as a phone sheet or — on the desktop side of the line — squashed under a 420 px sidebar that ate most of the map. The switch now flips at 480 px, and the 481–1023 px range is a deliberate tablet branch of the desktop two-column layout with a narrowed sidebar (Approach A from the original plan).

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): `isMobile` shrunk from `(max-width: 768px)` → `(max-width: 480px)`. Added `isTablet = useMediaQuery("(min-width: 481px) and (max-width: 1023px)")` and an `app--tablet` class on the root `.app`. The same `mainContents` and `mapNode` JSX feed both desktop branches, so React component identity (and `MapView`'s MapLibre instance) is preserved when a tablet rotates across the 1024 px threshold — no map re-init.
- [frontend/src/App.css](frontend/src/App.css): `.app--tablet .panel-cards` reduces the sidebar from 420 px → 320 px (with a 280 px floor) only inside the tablet range, so the map remains the dominant surface on a 600 px portrait without restructuring the layout.
- [frontend/src/lib/useMediaQuery.js](frontend/src/lib/useMediaQuery.js): comment updated to document the new 480 px threshold and the tablet range.
- [frontend/src/App.tablet.test.jsx](frontend/src/App.tablet.test.jsx): new viewport tests (400 / 600 / 900 / 1200 px) that stub `window.matchMedia` against a fixed width and assert the right layout class plus presence/absence of `.panel-cards` and `.mobile-shell`. Sheet UI is verified to stay mobile-only.

## Landscape phone orientation polish
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

The mobile bottom-sheet snap profile now adapts to landscape phones (e.g. 667 × 375 px). The default `["140px", "50dvh", "88dvh"]` profile eats nearly 40 % of a short viewport at peek and swallows the map entirely at full. Under `(orientation: landscape) and (max-height: 480px)`, the sheet now snaps to `["48px", "60dvh", "100dvh"]` instead — handle-only peek, map's upper third preserved at half, full screen at full. Portrait behaviour is unchanged.

Implemented per Approach A from the original scope (retune) rather than Approach B (right-side drawer): no `WFSheet` API growth, no layout-tree restructure.

**What changed:**
- [frontend/src/components/MobileLayout.jsx](frontend/src/components/MobileLayout.jsx): added `LANDSCAPE_SNAP_POINTS` and a `useMediaQuery("(orientation: landscape) and (max-height: 480px)")` branch. Caller-supplied `snapPoints` still wins over both defaults so tests and future callers can override.
- [frontend/src/components/MobileLayout.test.jsx](frontend/src/components/MobileLayout.test.jsx): two new tests cover the landscape and portrait branches by asserting the resolved `.wf-sheet` height (largest snap) at a 375 px landscape viewport vs an 800 px portrait viewport.

---

## Sheet Snap Memory Across Sessions
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

The mobile bottom sheet now opens at the user's last manually-chosen snap (peek / half / full) on every page load instead of always starting at peek. Auto-promote behaviour was also tightened: a route arrival only promotes the sheet **from peek** to half — if the user had previously dragged to half or full, that preference wins so the sheet doesn't fight them.

**What changed:**
- New [frontend/src/lib/sheetSnap.js](frontend/src/lib/sheetSnap.js) — `loadSheetSnap()` / `saveSheetSnap(idx)` helpers under the existing safe-storage wrappers from [storage.js](frontend/src/lib/storage.js). Out-of-range stored values (e.g., from a future schema bump) are silently treated as absent rather than thrown, so a downgrade can't break the load path.
- [frontend/src/App.jsx](frontend/src/App.jsx): `useState(() => loadSheetSnap() ?? 0)` for the initial sheet snap. The auto-promote `useEffect` now uses a functional updater (`setSheetSnap(prev => prev === 0 ? 1 : prev)`) so a stored half/full preference is preserved across route arrivals.
- [frontend/src/components/MobileLayout.jsx](frontend/src/components/MobileLayout.jsx): `handleSnapChange` schedules a 500 ms debounced `saveSheetSnap(idx)` write after each call. `WFSheet`'s `onSnapChange` only fires from drag releases (not from prop changes), so the debounced write naturally captures only manual settles, not auto-promote.

**Follow-up (BUG-014, same date):** The auto-promote was further gated by a `userMovedSheetRef` flag in [App.jsx](frontend/src/App.jsx) that flips true on the first manual snap change. After that, route arrivals no longer promote the sheet for the rest of the session — needed because `setResult(null)` immediately preceding `setResult(data)` on every submit was re-triggering the "first result" branch. The same property that makes the persistence write user-only (drag-release-only `onSnapChange`) is what makes the flag user-only.

---

## Haptic Feedback on Sheet Snap Settle
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

`WFSheet` now fires a 10 ms `navigator.vibrate` pulse when the user drags and releases to a different snap, giving Android Chrome a brief tactile confirmation that matches native bottom-sheet behaviour. iOS Safari ignores the call (no-op), so this is upside-only on platforms that support it. Same-snap releases (drag and release without crossing a snap boundary) don't vibrate, and the call is skipped entirely under `prefers-reduced-motion: reduce` since vibration is itself a motion signal.

**What changed:**
- [frontend/src/wayfarer/primitives.jsx](frontend/src/wayfarer/primitives.jsx): added a feature-checked vibrate call inside `WFSheet`'s `onPointerUp` handler, gated on (a) the snap actually changed (`nearestIdx !== currentSnap`), (b) reduced-motion is not active (re-uses the existing `reducedMotionRef`), and (c) `navigator.vibrate` is callable. `currentSnap` was added to the `useCallback` dependency array so the closure stays current.

---

## Pace Selector as Segmented Control on Mobile
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

Below 480 px the three pace options (Strolling / Steady / Earnest) now render as a horizontal segmented control sharing borders, with the active segment ink-filled — replacing the vertical `WFRadio` stack that previously ate ~140 px of sheet vertical space inside the bottom sheet. Above 480 px the existing layout is unchanged. Selection still persists via the existing `walkpath:walkPace` localStorage key.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added a component-local `PaceSegmented` (button-based `radiogroup` with `aria-checked`, `tabIndex` roving focus, ArrowLeft/Up & ArrowRight/Down keyboard navigation, 44 px `minHeight`). `PaceSelector` now uses `useMediaQuery("(max-width: 480px)")` to render either the segmented variant or the existing vertical `WFRadio` layout. Kept component-local rather than promoting to a Wayfarer primitive — premature abstraction risk without a second use site.

---

## Off-screen 480 px PNG Render for ShareDispatch
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-05

The shareable route-card PNG now always renders at the editorial 480 px design width regardless of the visible card size on mobile. On a 320 px phone the visible card still scales responsively to fit the modal (so the user previews what fits the screen), but the captured image is consistent: stats grid in 4 columns, drop figure at 54 px, no narrow-viewport reflow.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx) `handleDownloadCard`: measures the visible card width via `getBoundingClientRect` before capture; when it's below 480 px, passes `style: { width: "480px", maxWidth: "480px" }` to `html-to-image`'s `toPng()` options. `html-to-image` applies the style override only to its DOM clone before drawing to canvas, so the visible card stays untouched and there's no extra MapLibre instance to manage.

**Plan deviation:** the original plan called for mounting a hidden full-design-width copy of `ShareDispatch` and capturing that. The simpler `style`-override path achieves the same outcome (480 px-wide PNG, no MapLibre re-init, no parallel-mount cleanup dance) with one option line. The acceptance criteria are satisfied either way; documented here so a future contributor isn't surprised by the divergence between the plan and the shipped code.

---

## Reject geocodes outside the Chicago bbox
**Type:** Bolt-On | **Area:** Backend | **Shipped:** 2026-05-05

`resolve_location()` now validates every successful coordinate (whether from neighborhood match, fuzzy match, or Google Maps fallback) against Chicago's bbox. Coordinates outside the bbox raise `LocationOutsideChicagoError`, which `main.py` converts to HTTP 422 with `{"message": "'<query>' isn't in Chicago. Try a Chicago neighborhood, landmark, or street address.", "stop_index": i}`. Previously, queries that resolved to real out-of-state places (e.g., explicit lat/lon outside the bbox, or Google returning genuine out-of-state coords) silently snapped to the bbox edge and returned a nonsensical route.

- New helper `chicago_bbox_contains(lat, lon)` in [backend/utils.py](backend/utils.py) — single-source-of-truth bbox membership check.
- `resolve_location()` factored into a thin wrapper around `_resolve_location_inner()` so the bbox check applies to every code path.
- `/route` uses `asyncio.gather(..., return_exceptions=True)` so a per-stop bbox failure surfaces with the offending `stop_index` instead of being lost behind gather's first-raise-wins semantics.
- 4 new tests in `TestGeocodeBboxRejection` covering explicit-coord rejection (north/south of bbox), the unit contract on `resolve_location`, and the in-bbox happy path.

**Residual:** when Google's bbox-bias parameter causes the API to return a Chicago coordinate for an out-of-state query (e.g., "Huntington WV" mapped to 41.88, -87.63 in our local cache), this fix can't catch it — the cached coord is in-bbox. Tightening the bias and/or cache invalidation would be a follow-up.

---

## Tighten geocoder fuzzy-match threshold
**Type:** Bolt-On | **Area:** Backend | **Shipped:** 2026-05-05

The fuzzy-match step in `resolve_location()` is now guarded by an explicit regression test set, locking in the calibrated `_FUZZY_THRESHOLD = 0.95` value. Previously the threshold sat in [backend/geocoding.py](backend/geocoding.py) without test coverage, so a future tweak could have silently re-admitted false-positive matches like "huntington" → "uptown" or rejected legitimate typos like "broonzeville" → "bronzeville".

- 8 new tests in `TestFuzzyMatchRegression` (in [backend/tests/test_main.py](backend/tests/test_main.py)) covering the canonical set:
  - **Negatives:** `huntington`, `huntington wv`, `times square`, `pilsn` must NOT fuzzy-match.
  - **Positives:** `wriggleyville` → wrigleyville, `logn square` → logan square, `broonzeville` → bronzeville must match.
  - **Abbreviation path:** `Logan Sq` resolves end-to-end via `_normalize_street_abbr` (not fuzzy), documenting that abbreviations don't depend on the fuzzy threshold.
- Comment added to `_FUZZY_THRESHOLD` calling out the calibration window (0.94 admits false positives; 0.96 rejects legitimate typos).

---

## Cache + back off on Google Maps 429s
**Type:** Bolt-On | **Area:** Backend + Frontend | **Shipped:** 2026-05-05

A circuit breaker now fronts the Google Geocoding API. When Google returns HTTP 429 or API status `OVER_QUERY_LIMIT`, the breaker opens for an exponentially-increasing cool-off (60s → 120s → 240s, capped at 300s). During the cool-off, `geocode_google()` raises `GeocoderDegradedError` without making a network call; `main.py` converts that to HTTP 503 with `{"message": "The geocoding service is overloaded — try a Chicago neighborhood name (e.g., 'Wrigleyville') instead."}`. The first call after cool-off is a probe — success closes the breaker and resets the backoff; another 429 doubles it.

The first two layers from the spec (aggressive cache writes, in-memory dict fronting the file cache) were already in place — `_geocode_cache` is checked at the top of `geocode_google` before any network I/O, and disk writes are batched every 50 entries with an `atexit` flusher. No additional `lru_cache` was needed.

**Backend:**
- New `GeocoderDegradedError` exception in [backend/geocoding.py](backend/geocoding.py).
- Module-level breaker state (`_circuit_open_until`, `_circuit_consecutive_trips`) guarded by `_circuit_lock`.
- Helpers `_circuit_is_open`, `_circuit_trip_429`, `_circuit_record_success`, plus a `_circuit_reset_for_test` hook for the test suite.
- Cached results bypass the breaker (cache hits are free).
- Neighborhood-name queries continue to succeed during cool-off because they short-circuit before reaching `geocode_google`.

**Frontend:**
- `fetchRoute` in [frontend/src/App.jsx](frontend/src/App.jsx) now reads `detail.message` from the response body for 429 *and* 503, so the breaker's structured friendly message reaches the user. Hardcoded "rate-limited" copy is the fallback when no body is present.

**Tests:** 5 new cases in `TestGeocoderCircuitBreaker` covering: 429 trips the breaker; subsequent uncached calls skip the network entirely; neighborhood queries still resolve while degraded; probe-after-cooloff success closes the breaker; end-to-end `/route` returns HTTP 503 with the friendly message.

---

## Waypoints / Multi-Stop Routes
**Type:** Structural | **Area:** Backend + Frontend | **Shipped:** 2026-05-02

`POST /route` now accepts a `stops` array of 2–8 ordered locations and chains the legs into one rendered route — e.g., Wrigleyville → Lincoln Park → Logan Square. Each consecutive `(stop_i, stop_{i+1})` pair is computed via the existing `_compute_route` LRU and stitched into a single polyline with leg-aware directions. The legacy `{origin, destination}` request body still works and is normalized to a 2-stop request, so older clients are unaffected.

**Backend:**
- `RouteRequest` (in [backend/main.py](backend/main.py)) gained a `stops: list[str] | None` field with `min_length=2, max_length=8`. A `model_validator(mode="after")` normalizes legacy `{origin, destination}` into `stops`, strips whitespace, rejects empty entries, and mirrors `stops[0]`/`stops[-1]` back onto `origin`/`destination` so downstream code reads either shape.
- N-way concurrent geocoding (`asyncio.gather` over `resolve_location` per stop). Unresolvable stops raise HTTP 400 with a structured detail `{message, stop_index}` so the frontend can highlight the offending input. Adjacent-duplicate validation (the per-leg generalization of the legacy `_SAME_LOCATION_DEG2` check) raises 400 with `stop_index = i+1`.
- Sequential leg compute (`_compute_route(..., DEFAULT_FLAVOR)` per leg) — the per-leg cache is the existing 1536-entry quantized LRU, so repeat or shared sub-routes hit the cache for free.
- New `_stitch_legs(legs_raw)` concatenates per-leg paths, dropping the duplicated seam point when leg `N+1`'s first point is within ~1 m of leg `N`'s last point. Returns the stitched path plus per-leg `(start, end)` index ranges; adjacent leg slices share the seam index by design.
- Multi-stop response (`len(stops) > 2`) carries: `stops`, `stop_coords`, top-level `path`/`directions`/totals (sums across legs), and a new `legs[]` array with `{from_label, to_label, miles, minutes, steps, calories_approx, path_slice}`. Each step in `directions` is annotated with `leg_index` so the frontend can insert dividers without tracking offsets. `routes` contains exactly one entry forced to `fastest`; `available_flavors = ["fastest"]`. Per-flavor alternative routes remain available in the 2-stop case unchanged.
- Tests in [backend/tests/test_main.py](backend/tests/test_main.py): `TestMultiStopRoutes` covers the 3-stop happy path (legs, totals, seam-shared path slices, monotonic `leg_index`), legacy 2-stop regression, adjacent-duplicate rejection with `stop_index`, unresolvable-middle-stop with `stop_index`, the 9-stop `422`, and that multi-stop forces a single fastest flavor.

**Frontend:**
- [App.jsx](frontend/src/App.jsx) state moved from two `origin`/`destination` strings to a `stops` array of `{id, value}` rows with stable per-row ids (so React keys survive reordering). Helpers: `setStopValue`, `addStop` (cap at `MAX_STOPS = 8`), `removeStop` (min 2), `moveStop` (up/down), `reverseStops`. Pick-on-map mode is now keyed on stop `id` instead of the literal strings `"origin"`/`"destination"`.
- The form renders a vertical stops list — each row has a label (`From` / `Stop N` / `To`), text input, map-pick button, ↑/↓ reorder buttons, and a × remove button (visible when `stops.length > 2`). Below the list: `+ Add stop` (disabled at 8) and a `↕ Reverse` button (disabled when any stop is empty). Up/down arrows replace the originally-planned `@dnd-kit/core` drag-and-drop for v1 — zero new dependencies, fully accessible, and trivially touch-friendly.
- URL params: `?stops=A|B|C` for 3+ stops (pipe-separated), legacy `?from=&to=` preserved for 2-stop. On load, `?stops=` takes precedence; `parseStopsParam` tolerates whitespace, drops empty segments, and caps at `MAX_STOPS`.
- Recent searches: `saveRecentSearch` accepts either an array of stops or the legacy `(origin, destination)` 2-arg form; entries are persisted as `{stops, origin, destination, timestamp}` so legacy readers (the `origin`/`destination` fields) keep working. `recentEntryStops(entry)` reads either shape, and `formatRecentChip` renders the chip as `A → B → C → D` (≤4) or `A → … → Z (N stops)` (≥5).
- Map: [mapHelpers.js](frontend/src/mapHelpers.js) `renderWalkRoute` now reads `result.stop_coords`; when the route has 3+ stops, intermediate stops render as numbered green circle markers ("1", "2", …) with a white text label, layered above the path but below the start/end pins. The single polyline is unchanged because the backend pre-stitches `path`.
- Directions: `DirectionList` accepts an optional `legs` prop. When present and a step's `leg_index` differs from the previous step's, a `→ Stop {N}: {to_label}` divider row is inserted before the step, giving the user a clear "I'm now heading to my next stop" cue.
- Flavor tabs gating: when `stops.length > 2`, `RouteFlavorTabs` is hidden and a small `.multi-stop-note` explains that alternative routes are 2-stop-only.
- Tests in [App.test.jsx](frontend/src/App.test.jsx): unit tests for `parseStopsParam`, `formatRecentChip`, `recentEntryStops`, plus a recent-searches multi-stop round-trip case. CSS additions in [App.css](frontend/src/App.css) cover `.stops-group`, `.stop-row`, `.stop-move-btn`, `.stop-remove-btn`, `.add-stop-btn`, `.direction-leg-divider`, `.multi-stop-note`, and `.recent-chip-route` truncation, in the existing dark-green palette.

**Out of scope for v1:** drag-and-drop reorder (`@dnd-kit/core`), TSP-style "optimize order" button, per-leg flavor selection, round-trip detection, and per-leg height/step overrides.

---

## Alternative Routes
**Type:** Structural | **Area:** Backend + Frontend | **Shipped:** 2026-05-02

`POST /route` now returns three route alternatives in a `routes` array — `fastest`, `fewest_turns`, and `greenest` — and the result panel renders a tabbed picker above the step hero that swaps the visible route in place without re-fetching. All three flavors are computed from the same OD pair on the server (each with its own LRU cache entry), so switching tabs is instant. Top-level totals (`total_miles`, `total_steps`, `path`, `directions`, …) continue to mirror the default fastest route, so any older client that ignores the new `routes`/`default_flavor`/`available_flavors` fields keeps working unchanged.

**Flavors via edge-weight modifiers** (re-run Dijkstra with modified weights, not Yen's k-shortest-paths):
- **Fastest** — length-only weights (existing behavior).
- **Fewest turns** — every edge weight gets a fixed `+30 m` penalty, which biases Dijkstra toward routes that traverse fewer edges (and therefore fewer junctions). True edge-pair turn penalties would require an edge-expanded graph; this approximation captures most of the effect at zero preprocessing cost.
- **Greenest** — edge length is multiplied by `0.6` when `highway ∈ {footway, path, cycleway, pedestrian, track}`, favoring off-street paths, plazas, and trails. Park-polygon proximity (the OSM `leisure=park` data fetcher proposed in the original plan) is **out of scope for v1** — the highway-tag heuristic is a reasonable first cut without the heavy data dependency.

Per-flavor weight vectors are built lazily on first use and cached as a module-level `dict[str, list[float]]`. The flavor weights survive across requests but are rebuilt if the graph's edge count ever changes (defensive). Walking-time output always uses real `length` (in metres) divided by `WALKING_SPEED_MPS` — the flavor weight is purely a routing preference, never a distance.

**What changed:**
- [backend/walking.py](backend/walking.py): added `FLAVORS = ("fastest", "fewest_turns", "greenest")`, `DEFAULT_FLAVOR`, `_TURN_PENALTY_M = 30.0`, `_GREEN_HIGHWAYS`, `_GREEN_DISCOUNT = 0.6`, and a module-global `_flavor_weights: dict[str, list[float]]` cache; new `_build_flavor_weights(G, flavor)` and `_get_flavor_weights(flavor)` helpers; threaded a `flavor` parameter through `_get_shortest_path_by_node` (LRU now keyed on `(orig, dest, flavor)`), `_get_shortest_path`, `_build_minutes`, `_build_directions`, `_build_path`, and `_compute_route_quantized`/`_compute_route` (default `"fastest"` everywhere preserves current callers); new public `walk_paths_alternatives(o_lat, o_lon, d_lat, d_lon)` returns a list of `{flavor, path, directions, minutes}` for all three flavors, hitting the per-flavor cache; bumped LRU sizes from 512 → 1536 to absorb 3× the entries.
- [backend/main.py](backend/main.py): `/route` calls `walk_paths_alternatives` instead of a single `_compute_route`; new local `_summarize(alt)` builds full per-route payload (totals + enriched directions); response now includes `routes`, `default_flavor`, `available_flavors`, while the legacy top-level `total_miles/total_minutes/total_steps/calories_approx/daily_goal_pct/path/directions` mirror the default fastest route for backward compatibility.
- [backend/tests/test_main.py](backend/tests/test_main.py): added a `TestAlternativeRoutes` class covering (a) the routes array returns three flavors in the documented order, (b) each alternative carries a complete payload, (c) the legacy top-level fields equal the `default_flavor` route's fields, and (d) no flavor undercuts `fastest` in distance.
- [frontend/src/App.jsx](frontend/src/App.jsx): exported `safeFlavorLabel`; added a `RouteFlavorTabs` memo component (3 buttons with icon, label, and inline `mi · min · steps` summary; collapses to a single column under 540px); added `activeFlavor` state (resets to `result.default_flavor` whenever a new result arrives); added a memoized `viewResult` that overlays the active route's per-flavor fields onto the top-level metadata, then swapped every consumer (`<MapView>`, `<StepHero>`, `<ComparePanel>`, `<DirectionList>`, `<RouteCard>`, `useTurnCoords`, `handleLogWalk`, share modal) from `result` → `viewResult` so the rest of the renderers work unchanged regardless of flavor.
- [frontend/src/App.css](frontend/src/App.css): added a `.flavor-tabs` 3-column grid and `.flavor-tab` / `.flavor-tab--active` styles matching the existing dark-green palette (`#1a3a22 → #1e4428` gradient on active, accent border `#2d7a3e`).
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added an `alternative route flavor tabs` describe block with three tests — tabs render after a successful route, switching tabs swaps the visible step total in `<StepHero>` and updates `aria-selected`, and tab switches do **not** trigger a re-fetch.

---

## Multi-Day Step Accumulator
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

After a successful route, users can tap a “＋ Log this walk” button to persist `{ timestamp, date, steps, miles, origin, destination }` to a `walkpath:stepLog` `localStorage` array. A new collapsible "This week" panel below the recent-routes list shows running weekly totals (steps + miles), a progress bar against `7 × dailyGoal` (defaulting to 70,000 if no goal is set), and a per-entry list with each walk's date, route, and step count. Entries older than 7 days are pruned automatically on every `loadStepLog()` call (and the pruned list is persisted back). After logging, the button switches to a disabled "✓ Logged this walk" state until a new route is fetched, preventing accidental duplicates of the same walk.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `STEP_LOG_KEY`, `STEP_LOG_TTL_DAYS = 7`, `pruneExpired`, and exported `loadStepLog`, `logWalk`, and `clearStepLog` helpers; added a `WeeklySummaryPanel` component that renders a collapsible toggle with totals, weekly goal bar, log list, and clear button (returns `null` when log is empty); added `stepLog` and `walkLogged` state in `App`, reset `walkLogged` whenever `result` changes, wired `handleLogWalk` and `handleClearStepLog`; rendered a "＋ Log this walk" button after `ComparePanel` in the result block, and `<WeeklySummaryPanel>` below `<RecentSearches>` in the form panel.
- [frontend/src/App.css](frontend/src/App.css): added `.log-walk-btn` (and `--logged` modifier) and a `.weekly-summary` block (toggle, body, log list, clear button, hint) matching the existing dark-green health palette.
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added a `step log` describe block covering empty/corrupt storage, persistence + retrieval shape, prepend ordering, 7-day expiry (with persisted prune-back), and `clearStepLog`.

---

## Animated Route Drawing
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02 | **Updated:** 2026-05-03

When a new route result loads, the green path animates progressively from origin to destination by physically growing the rendered LineString rather than stepping a dash pattern. Each animation frame computes a target distance along the route, builds a coordinate prefix up to that distance (interpolating within the in-progress segment), and calls `setData` on the `walk-path` GeoJSON source. Easing is ease-out cubic. Duration scales with route length at ~4 Chicago long blocks per second (a long block ≈ 0.125 mi, so ~0.5 mi/sec), clamped to `[600 ms, 8000 ms]` so a 0.1-mi corner walk doesn't snap and a 10-mi cross-town route doesn't drag. Origin and destination circle markers are rendered synchronously in `renderWalkRoute` before any RAF callback fires, so they are always visible at frame 0. The animation is cancelled on cleanup when the result changes or the component unmounts. Users who have `prefers-reduced-motion: reduce` set in their OS skip the animation entirely and see the solid path immediately.

**What changed:**
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx): defines `ANIM_BLOCKS_PER_SEC = 4`, `ANIM_MILES_PER_BLOCK = 0.125`, `ANIM_MIN_DURATION_MS = 600`, `ANIM_MAX_DURATION_MS = 8000`, and an `animDurationMs(miles)` helper that derives the per-route duration. After `renderWalkRoute`, the result `useEffect` precomputes cumulative segment distances along `result.path` via `haversineMeters`, grabs the `walk-path` source, and runs an RAF loop: each frame computes `t = elapsed / durationMs`, applies `1 - (1 - t)^3` easing, finds the segment containing the target distance, builds the coordinate prefix plus an interpolated point, and calls `src.setData({ type: "Feature", geometry: { type: "LineString", coordinates } })`. On completion, the source is reset to the full path. `rafRef = useRef(null)` tracks the active frame and `stopAnim` cancels it on cleanup. Reduced-motion check (`window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches`) short-circuits before scheduling. `haversineMeters` and `toGeo` are imported from [frontend/src/mapHelpers.js](frontend/src/mapHelpers.js).
- [frontend/src/test-setup.js](frontend/src/test-setup.js): added `flyTo`, `getSource`, `getCanvas`, and `setPaintProperty` stubs to the maplibregl `Map` mock; added a global `window.matchMedia` stub (returns `{ matches: false }` by default) so MapView's media query check doesn't throw in jsdom.
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): `animated route drawing` describe block with two Vitest tests — one stubs `requestAnimationFrame` to never fire and asserts the "Unlock map" button (markers) appears synchronously before any frame callback; the other sets `window.matchMedia` to return `matches: true` for the prefers-reduced-motion query and asserts RAF is never called.

---

## URL-Encoded Route Sharing
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

Routes are now bookmarkable and shareable via URL query params. After a successful fetch, `history.replaceState` writes `?from=…&to=…` (and optionally `&hft=…&hin=…` for height) into the browser URL without a page reload. On mount, the app reads these params to pre-populate the origin, destination, and height fields; if both `from` and `to` are present, the form auto-submits so the map populates immediately on page load.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `readUrlParams()` helper (parses `from`, `to`, `hft`, `hin` from `window.location.search` with range validation); updated `origin`, `destination`, `heightFt`, and `heightIn` `useState` initializers to use lazy functions that call `readUrlParams()` so URL params are reflected on first render; after `setResult` in `fetchRoute`, calls `history.replaceState` to write the current `from`/`to` (and height if set) to the URL; added a `useEffect([], [])` mount-only effect that reads URL params and calls `fetchRoute` if both `from` and `to` are present.
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added `URL-Encoded Route Sharing` describe block (6 cases: form pre-populated from params, auto-submit fires on mount, no auto-submit with only one param, URL written after fetch, height params included in URL, height pre-populated from URL); added `window.history.replaceState(null, "", "/")` to `beforeEach`/`afterEach` in all test groups that use `fetch` to prevent URL param bleed-through between tests.

---

## Highlighted Turn Points on Map
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

Small green circle markers are now placed at each turn along the route on the map. Clicking any row in the turn-by-turn directions list highlights the corresponding circle (larger radius + brighter accent color) and smoothly flies the map to that intersection (`zoom: 16, duration: 600 ms`). Keyboard users can activate steps with Enter/Space. Clicking the same step a second time deselects it (returning to plain circles). Turn markers reset when a new route is fetched.

**How turn coordinates are derived:** `directions[i]` carries `distance_meters` but no coordinate. A `useTurnCoords` hook in [frontend/src/App.jsx](frontend/src/App.jsx) walks the raw `path` polyline, accumulating Haversine segment lengths and interpolating within each segment (±10 m tolerance) to find the exact `[lat, lon]` for each turn threshold. Turns that map to within 5 m of each other are deduplicated; any turns left unresolved by rounding are anchored to the final polyline point.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `haversineMeters` helper and `useTurnCoords(path, directions)` hook (memoized); added `activeTurnIndex` state (reset on new result via `useEffect`); `DirectionList` now accepts `activeTurnIndex` and `onStepClick` — clicking a row calls `setActiveTurnIndex`, and keyboard `Enter`/`Space` also fires the handler; added `.direction-item--clickable` and `.direction-item--active` class logic; passed `turnCoords` and `activeTurnIndex` props to `<MapView>`.
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx): added `TURN_COLOR_ACTIVE` constant; added `haversineMeters` helper and `buildTurnsGeoJson(turnCoords, activeTurnIndex)` factory (deduplicates features within 5 m); `renderWalkRoute` adds a `"walk-turns"` GeoJSON source + `"walk-turns-circle"` circle layer (5 px radius, white stroke, data-driven active state for 8 px + accent color); a separate `useEffect` on `activeTurnIndex` calls `map.getSource("walk-turns").setData(...)` to update highlight state and fires `map.flyTo` to center on the active turn, all without re-rendering the full route.
- [frontend/src/App.css](frontend/src/App.css): added `.direction-item--clickable` (pointer cursor + transition) and `.direction-item--active` (bright green border + dark green background) rules.

---

## Pace Customization
**Type:** Bolt-On | **Area:** Frontend + Backend | **Shipped:** 2026-05-02

Users can now choose their walking pace — Leisurely (2 mph), Normal (3 mph), or Brisk (4 mph) — via a three-button radio group in the form. The selection persists to `localStorage` and is sent to the backend on every route request. Because the Dijkstra path is speed-free and cached, only the time-derived fields (total minutes, per-segment minutes, and calories) are recomputed post-hoc from each direction's `distance_meters` at the chosen speed; the polyline and step count are unchanged. The chosen pace and speed appear in the API response and are surfaced as a new 🚶 chip in `StepHero`.

**Calorie coupling:** MET is now pace-aware (leisurely = 2.8, normal = 3.5, brisk = 5.0), matching the values specified in the Feature 5 plan. This coupling applies to both the flat-walking formula and the grade-adjusted formula.

**Critical caching note:** `_compute_route` intentionally remains speed-free. Threading a speed parameter into the cache key would split the LRU cache across paces and balloon memory. All pace scaling happens after the cached call returns, in `POST /route`.

**What changed:**
- [backend/steps.py](backend/steps.py): exported `PACE_TO_MET: dict[str, float]` (`leisurely=2.8`, `normal=3.5`, `brisk=5.0`); extended `calories_from_minutes` signature to `(minutes, weight_kg=None, met=_BASE_MET)` and updated its formula to `met × weight_kg × 0.0175 × minutes` (matches legacy output for the 70 kg / MET-3.5 default); added `base_met=_BASE_MET` parameter to `calories_from_minutes_with_grade` so pace adjusts the MET baseline before grade is added.
- [backend/main.py](backend/main.py): added `from typing import Literal`; added `PACE_TO_MPH` constant (`leisurely=2.0`, `normal=3.0`, `brisk=4.0`); added `pace: Literal["leisurely", "normal", "brisk"] | None = None` to `RouteRequest`; after `_compute_route` returns, derives `total_meters` by summing `direction["distance_meters"]`, recomputes `total_minutes` and each direction's `minutes` from meters at the chosen speed, and passes `pace_met` to both calorie functions; adds `pace` and `walking_speed_mph` to the response.
- [backend/tests/test_steps.py](backend/tests/test_steps.py): added `TestPaceToMet` class (5 cases: normal MET = 3.5, strict ordering, all three paces present, brisk burns more, leisurely burns less).
- [backend/tests/test_main.py](backend/tests/test_main.py): added `TestPaceCustomization` class (7 cases: default is normal, pace echoed in response, invalid pace rejected, brisk ≈ 75% of normal minutes, leisurely longer than normal, distance unchanged by pace, brisk calories > leisurely calories).
- [frontend/src/App.jsx](frontend/src/App.jsx): added `PACE_OPTIONS`, `PACE_LABELS`, and `loadStoredPace()` exports; added `PaceSelector` memo component (three-button radio group with label + speed detail); added `walkPace` state (initialised from `localStorage`) and a `useEffect` to persist it; included `pace: walkPace` in the `fetchRoute` POST body; rendered `<PaceSelector>` below `<StepGoalInput>` in the form; added a 🚶 stat chip in `StepHero` showing the pace label from the response.
- [frontend/src/App.css](frontend/src/App.css): added `.pace-selector`, `.pace-selector-label`, `.pace-options`, `.pace-btn` / `--active`, `.pace-btn-label`, and `.pace-btn-detail` rules matching the existing green dark-theme aesthetic.

---

## Weight Input for Calories
**Type:** Bolt-On | **Area:** Frontend + Backend | **Shipped:** 2026-05-02

Users can now enter their weight to receive personalized calorie estimates. The weight field (lb or kg, with unit toggle) collapses like the height input. The selected unit persists to `localStorage`. When weight is provided the response now carries `personalized_calories: true` and the 🔥 calorie chip in `StepHero` shows a green "personalized" badge.

**What changed:**
- [backend/steps.py](backend/steps.py): added `MET_DEFAULT: float = 3.5` public constant; changed `calories_from_minutes` signature to `(minutes, weight_kg=None, met=MET_DEFAULT)` — uses `weight_kg or 70.0` so omitting the field reproduces legacy output exactly (3.5 MET × 70 kg × 0.0175 × 30 min = 129 cal).
- [backend/main.py](backend/main.py): added `weight_kg: float | None = None` to `RouteRequest` with a Pydantic validator (range 30–300 kg); passes weight through to both `calories_from_minutes` and `calories_from_minutes_with_grade`; added `personalized_calories: bool` field to the response.
- [frontend/src/App.jsx](frontend/src/App.jsx): exported `lbToKg` helper; added `WeightInput` component (collapsible, lb/kg toggle, unit persisted in `localStorage:walkpath:weightUnit`); added `weightKg` state and `handleWeightChange` callback; included `weight_kg` in the `fetchRoute` POST body; updated `StepHero` to destructure `personalized_calories` and render a `.stat-chip-badge` on the calorie chip when true.
- [frontend/src/App.css](frontend/src/App.css): added `.weight-inputs`, `.weight-number-input`, `.weight-unit-toggle`, and `.stat-chip-badge` rules.
- [backend/tests/test_steps.py](backend/tests/test_steps.py): added `TestCaloriesFromMinutesWeight` class (6 cases: legacy match, None default, heavier burns more, linear scaling, combined weight+MET, int return type).
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added `lbToKg` unit tests (3 cases) and `WeightInput sends weight_kg in kg` integration tests (2 UI cases: lbs→kg conversion and null when not entered).

---

## Recent Searches
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

Persists the last 10 successful route searches to `localStorage` and renders them as quick-pick chips below the form. Clicking a chip re-populates origin and destination and immediately fires the route fetch. A "Clear history" link removes all entries.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `RECENT_KEY` / `RECENT_MAX` constants, `loadRecentSearches()` and `saveRecentSearch(origin, destination)` localStorage helpers, a `RecentSearches` component (heading + clear button + chip list), and `recentSearches` state (initialised from `localStorage`). Refactored `handleSubmit` into a `fetchRoute(originVal, destVal)` function so both form submission and chip clicks share one fetch path; `handleRecentSelect` sets form state and calls `fetchRoute` directly to avoid stale-closure issues. `handleClearRecent` removes the localStorage key and clears the state array.
- [frontend/src/App.css](frontend/src/App.css): added `.recent-searches`, `.recent-searches-header`, `.recent-searches-label`, `.recent-clear-btn`, `.recent-chips`, `.recent-chip`, `.recent-chip-from`, `.recent-chip-arrow`, and `.recent-chip-to` rules, matching the existing green dark-theme aesthetic.

---

## Swap Origin / Destination Button
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

A circular swap button (↕) sits at the vertical midpoint between the From and To inputs. Clicking it swaps the `origin` and `destination` state values in a single update cycle, letting users reverse a route without retyping. The button is disabled when both fields are empty and rotates 180° on hover for affordance.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): wrapped the From/To labels in a new `.from-to-group` container, added a `handleSwap` callback, and rendered a `<button className="swap-btn">` between the inputs.
- [frontend/src/App.css](frontend/src/App.css): new `.from-to-group` (relative-positioned) and `.swap-btn` (absolutely centered, 32 px green pill with hover rotation) rules.

---

## Copy Directions as Plain Text
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

A "Copy" button in the directions heading writes a formatted plain-text summary to the clipboard. The confirmation state briefly shows "Copied!" (green, no underline) for 2 seconds before resetting.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added exported `formatDirectionsText(directions, result)` helper (header line with miles/minutes/steps, then numbered turn-by-turn steps reusing `formatBlocks` and `pathTypePhrase`); updated `DirectionList` to accept a `result` prop, added `copied` state and `handleCopy` async function, wrapped the existing "Show all" toggle and new "Copy" button in a `.directions-actions` div; passed `result` at the `<DirectionList>` call site.
- [frontend/src/App.css](frontend/src/App.css): added `.directions-actions` (flex row, 10 px gap), `.copy-directions-btn` (matches `.directions-toggle-all` styling), and `.copy-directions-btn--copied` (green, bold, no underline).

---

## Custom Daily Step Goal
**Type:** Bolt-On | **Area:** Frontend + Backend | **Shipped:** 2026-05-02

Replaced the hardcoded 10,000-step daily goal with a user-configurable value. The goal is persisted to `localStorage`, sent to the backend on each route request, and reflected in the progress bar label in `StepHero`.

**What changed:**
- [backend/main.py](backend/main.py): added `daily_goal: int | None = None` to `RouteRequest` with a Pydantic validator (range 1,000–100,000); passes the value (defaulting to 10,000) into `daily_goal_pct()`.
- [frontend/src/App.jsx](frontend/src/App.jsx): added `loadDailyGoal()` localStorage helper, `dailyGoal` state, `handleGoalChange` callback, and a new `StepGoalInput` component (collapsed toggle with five preset chips — 5k/7.5k/10k/15k/20k — plus a custom number input and a Reset button). `StepHero` now receives `dailyGoal` as a prop and renders the actual goal number in the bar label. The fetch body includes `daily_goal`.
- [frontend/src/App.css](frontend/src/App.css): added `.goal-body`, `.goal-presets`, `.goal-preset-btn` / `--active`, `.goal-custom`, `.goal-number-input`, and `.goal-clear-btn` rules mirroring the height-section visual pattern.

---

## Calorie Equivalents
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

Below the stat chips in `StepHero`, a small caption line surfaces a friendly food comparison such as "≈ 1 banana" or "≈ half a slice of pizza". No backend changes were needed — the comparison is computed purely from the `calories_approx` value already in the route response.

**What changed:**
- [frontend/src/App.jsx](frontend/src/App.jsx): added `CALORIE_FOODS` lookup table (12 items, 55–550 cal) and `NICE_FRACS` table (¼ through 4), exported `calorieEquivalent(calories)` helper that finds the (food, fraction) pair minimising absolute error, formats singular/plural automatically, and returns `null` for zero/null input. `StepHero` computes `calorieEquiv` and renders a `<p className="calorie-equiv">` beneath the stat chips when a result is available.
- [frontend/src/App.css](frontend/src/App.css): added `.calorie-equiv` rule (0.72 rem, muted green, centered, small bottom margin).
- [frontend/src/App.test.jsx](frontend/src/App.test.jsx): added 7 unit tests for `calorieEquivalent` covering null/zero guard, string prefix, exact matches (banana, can of soda), fractional match (half a banana), and plural output (2 bananas).

---

## Shareable Route Card
**Type:** Bolt-On | **Area:** Frontend | **Shipped:** 2026-05-02

A "📤 Share route card" button in the step-hero panel opens a modal containing a 360×360 summary card (exported at 3× = 1080×1080 for social media). The card shows the walk brand/city header, a mini map thumbnail with the rendered route, step count, key stats (miles · minutes · calories · pace), origin→destination labels, and a walkpath.app footer. A "Download PNG" button is disabled until the mini map finishes rendering all tiles, then triggers a client-side PNG download via `html-to-image`.

**What changed:**
- [frontend/src/mapHelpers.js](frontend/src/mapHelpers.js): new shared module extracting all MapLibre path-rendering logic from `MapView.jsx` — exports `renderWalkRoute`, `clearLayers`, `buildTurnsGeoJson`, `toGeo`, and `WALK_PATH_COLOR`. Both `MapView` and `RouteCard` import from here.
- [frontend/src/RouteCard.jsx](frontend/src/RouteCard.jsx): new `forwardRef` component that creates a mini MapLibre instance with `preserveDrawingBuffer: true` and all gestures disabled. Calls `renderWalkRoute` with a tighter `fitPadding=20`. Fires `onMapReady()` callback on `map.once("idle")` guarded by a `mountedRef`. Defines `_PACE_LABELS` locally.
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx): refactored to import rendering helpers from `mapHelpers.js` instead of implementing them inline.
- [frontend/src/App.jsx](frontend/src/App.jsx): `StepHero` gains an `onShare` prop rendering the share button. App state adds `showShareModal`, `cardMapReady`, `cardRef`. `handleDownloadCard` dynamically imports `html-to-image` and calls `toPng(cardRef.current, { pixelRatio: 3 })`.
- [frontend/src/App.css](frontend/src/App.css): added `.share-card-btn`, `.share-modal-overlay`, `.share-modal`, `.share-modal-header`, `.share-modal-title`, `.share-modal-close`, `.share-modal-card-wrap`, `.share-modal-actions`, `.share-download-btn`, and all `.route-card*` rules.
- `frontend/package.json`: added `html-to-image` dependency.

---

## Click Map to Set Origin / Destination
**Type:** Structural | **Area:** Frontend + Backend | **Shipped:** 2026-05-02 · **Updated:** 2026-05-03

Each stop input has a 📍 pin icon button. Clicking it enters a `pickMode` state keyed on the row's stop id; the map cursor switches to a crosshair, the map's gesture lock is released (so the user can pan/zoom freely to reach their target), and a floating hint banner appears. A click on the map drops a red maplibre Marker at that point and opens a top-of-map confirmation popup that calls `GET /reverse-geocode` to fill in the human-readable label. The user can click again to reposition the pin before deciding. Confirming writes the resolved label (or `lat, lon` as fallback when the geocoder returns nothing) into the input and exits pick mode; cancelling clears the preview without committing. Exiting pick mode re-locks the map's gestures unless the user had already used the explicit "Unlock map" button. A non-blocking toast surfaces on geocoder failure; routing still works against the coordinate string because the geocoder has a coordinate-pair short-circuit.

**What changed:**
- [backend/geocoding.py](backend/geocoding.py): updated `_load_geocode_cache` / `_save_geocode_cache` to handle both forward-geocode tuples and reverse-geocode dicts in the same cache file. Added `_COORD_RE` regex and a coordinate-pair short-circuit at the top of `resolve_location`. Added `_reverse_geocode_google(lat, lon)` and `reverse_geocode_point(lat, lon)` — the latter checks the nearest `NEIGHBORHOOD_COORDS` entry within 200 m before calling Google, and caches results under `rev:{lat:.5f},{lon:.5f}` keys.
- [backend/main.py](backend/main.py): added `GET /reverse-geocode?lat=…&lon=…` endpoint with Chicago bbox validation; calls `reverse_geocode_point` in an executor and returns `{"label": str, "source": str}`.
- [frontend/src/MapView.jsx](frontend/src/MapView.jsx): `pickMode`, `onPickPoint`, and `resolveLabel` props. The pick effect releases gesture locks while picking and re-locks them on exit (unless the local `unlocked` state is true). The map `click` handler creates/replaces a `previewMarkerRef` (a `new maplibregl.Marker({ color: "#e53935" })`) at the click point and sets `previewPick` state; an in-flight `previewReqRef` counter discards stale `resolveLabel` results when the pin is moved. Confirm calls `onPickPoint(lat, lon, label)`, removes the marker, and clears the preview. Cancel just clears the preview. Exiting `pickMode` (parent sets it to `null`) tears down marker + state and re-locks gestures.
- [frontend/src/App.jsx](frontend/src/App.jsx): each stop row (origin, intermediate, destination) wraps its input in an `.input-with-pick` div with a `.pick-map-btn` toggle. `pickMode` state holds the active stop id (`null` when off). `resolveStopLabel(lat, lon)` is a stable `useCallback` passed to MapView for async reverse-geocoding. `handleMapPick(lat, lon, label)` is invoked only on Confirm — writes the resolved label, or falls back to `${lat}, ${lon}` plus a 3.5-s toast on null. `toastTimerRef` drives the toast.
- [frontend/src/App.css](frontend/src/App.css): added `.input-with-pick`, `.pick-map-btn`, `.pick-map-btn--active`, `.map-pick-hint`, `.map-pick-confirm` (top-anchored card with label, sub-hint, and Cancel/Confirm buttons), `.map-pick-confirm-btn` variants, `.toast`, and `@keyframes toast-in`.
- [frontend/src/main.jsx](frontend/src/main.jsx): added `import "maplibre-gl/dist/maplibre-gl.css"`. Without this, maplibre's marker / popup / control DOM has no positioning rules and renders invisibly. The polyline + turn dots had been masking this because they're drawn on the WebGL canvas. See [`archive/RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) BUG-003.
