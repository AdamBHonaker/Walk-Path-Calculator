# Mobile testing

Two modes for testing Passage on a phone during development:

| Mode | URL | Works for |
|------|-----|-----------|
| **LAN HTTP** | `http://<laptop-IP>:5173` | Casual layout/CSS checks. Phone must be on the same Wi-Fi as the dev machine. |
| **Tunnel HTTPS** | `https://<random>.trycloudflare.com` | Anything that requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts): PWA service-worker registration, "Add to Home Screen", `navigator.geolocation` on iOS Safari, the Web Share API, clipboard writes. Also reachable from cellular / off-network reviewers. |

Use LAN for fast iteration, tunnel for anything browsers gate on HTTPS.

## Tunnel setup

### One-time install

The orchestrator shells out to [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). It must be on `PATH`.

- **Windows:** `winget install cloudflare.cloudflared`
- **macOS:** `brew install cloudflare/cloudflare/cloudflared`
- **Linux:** download the binary from the link above.

No Cloudflare account is required — the script uses the free `trycloudflare.com` ephemeral flavor (no auth, fresh URL per run).

### Run

```bash
cd frontend
npm run dev:tunnel
```

This single command:

1. Starts `uvicorn` (backend) on `127.0.0.1:8000` with `DEV_TUNNEL_ORIGIN_REGEX` set so the dynamic frontend-tunnel origin is accepted by CORS.
2. Opens an ephemeral Cloudflare tunnel to the backend, captures the public URL.
3. Writes `frontend/.env.local` with `VITE_BACKEND_URL=<backend tunnel URL>` so the frontend points at the tunneled backend (not localhost).
4. Starts `vite` (frontend) on `:5173`.
5. Opens an ephemeral Cloudflare tunnel to the frontend, prints the public URL.

Open the printed `https://<random>.trycloudflare.com` URL on your phone. Both the frontend and the backend it talks to are now reachable over public HTTPS for the lifetime of the script.

`Ctrl-C` tears down all four child processes (uvicorn, vite, both `cloudflared` instances) and removes `frontend/.env.local` so the next `npm run dev` doesn't start with a stale tunnel URL.

## Security caveat — read before running

While `npm run dev:tunnel` is running, the dev backend is **briefly reachable from the public internet** at the ephemeral Cloudflare URL. Mitigations:

- The URL is unguessable (random subdomain) and fresh per run.
- The existing rate limits in `backend/main.py` (`RATE_LIMIT_ROUTE = "10/minute"` etc.) apply to tunneled traffic.
- `DEV_TUNNEL_ORIGIN_REGEX` is dev-only and never set in production deploys.

But: **do not run `dev:tunnel` against a `backend/.env` that holds production secrets** (production `LOCATIONIQ_API_KEY`, CDP keys, prod database creds, etc.). Use a dev-scoped key. Treat the tunnel as the same trust boundary as a public staging URL for the duration of the session.

## Verifying on iOS Safari

After opening the tunnel URL on an iPhone:

- App loads with no certificate warning (trycloudflare.com has a valid TLS cert).
- Service worker registers — visible in Safari Dev Tools (Develop menu, attached iPhone).
- "Add to Home Screen" produces a working installed icon.
- `navigator.geolocation` prompts and returns coordinates (this fails on plain LAN HTTP).
- Share-card download flow completes end-to-end (validates the iOS WebGL fix on real hardware).

If any of these fail, capture the Safari console output before reporting.

## Address autocomplete — Chunk 5 mobile sign-off checklist

`AddressAutocomplete.jsx` portals its listbox into `document.body` with
`position: fixed` so the WFSheet's `transform` + `overflow-y: auto` can't
clip it. Unit tests prove the wiring; the items below require a real
device and need a person to drive them. Run `npm run dev:tunnel`, open
the URL on each device, and check off each item or capture the failure.

**iPhone Safari — portrait + landscape** (run the same list twice):

- [X] Tap a route stop input → soft keyboard opens → the dropdown sits
      *between* the input and the top of the keyboard, with the bottom
      row fully legible (no clipping behind the keyboard accessory bar).
      If the bottom row hugs the keyboard too tightly, the
      `VIEWPORT_MARGIN_PX` constant (currently 16) in
      [`AddressAutocomplete.jsx`](frontend/src/components/AddressAutocomplete.jsx)
      needs bumping; if it's too generous, lower it.
- [X] Tap a suggestion row → the input value updates, the listbox closes,
      and the form remains usable. No flicker, no scroll jump.
- [ ] Drag the WFSheet up while the listbox is open. The listbox should
      follow the input. Acceptable: a single-frame lag during the drag.
      Unacceptable: the listbox stays pinned at the old position or
      disappears.
- [X] Confirm the route form's stop input *and* the Neighborhood Explorer's
      community-area picker both behave the same way — they share the
      same component, so a regression in one means a regression in both.
- [ ] At "peek" snap (140 px from bottom), the input is offscreen and
      should not be tappable — verify the sheet auto-promotes to half/full
      when entering the route form, the way explore mode already does.
- [X] Verify the dropdown z-index is above the WFSheet's handle / borders
      (z-index 1000 on `.address-autocomplete-list--portaled` vs. the
      sheet's `zIndex: 20`).

**Android Chrome — portrait + landscape**:

- [X] Repeat the iPhone Safari list above.
- [X] TalkBack: enable screen reader, tap the input, then use the volume
      keys to navigate options. `aria-activedescendant` should cause
      TalkBack to read each highlighted row without focus leaving the
      input. (This is the WAI-ARIA combobox 1.1 inline pattern; if
      TalkBack instead reads "search edit" with no row context, the
      pattern wiring regressed.)

If any item fails, paste the Safari/Chrome console output (Develop menu →
attached device) and the device + OS version, and Claude will iterate.

## Tree Canopy heatmap — Chunk 4 mobile sign-off checklist

The toggle is the same `WFCheck` row used on desktop, rendered inside
`ExploreCategoryPanel` under the **Outdoors** group. The body-drag
state machine in [`WFSheet`](frontend/src/wayfarer/primitives.jsx) has
an 8 px deadzone before any pointer move is treated as a sheet drag,
so a tap on the toggle should never collapse or resnap the sheet.
Unit tests prove the persistence wiring; the items below need a real
device. Run `npm run dev:tunnel`, switch to Explore mode, and check
each one off.

**iPhone Safari — portrait + landscape** (run the same list twice):

- [ ] Sheet auto-promotes from peek → half on first explore-mode entry
      (existing behavior — included as a regression check). Drag the
      sheet to **half** so the category panel is reachable.
- [ ] Expand the **Outdoors** group → tap the **Tree canopy** row.
      The checkbox toggles on, the moss-toned bands paint over the
      isochrone, and the sheet stays at half (does not snap to peek
      or full).
- [ ] Tap **Tree canopy** again → bands disappear with no map re-fetch
      (no spinner, no flicker on other layers, no network request in
      Safari Dev Tools → Network).
- [ ] Toggle state survives a full page reload (close the tab, reopen
      the tunnel URL, switch to Explore mode → the toggle is in the
      same state you left it).
- [ ] With Tree canopy + Parks both enabled, the two layers are
      visually distinguishable (parks read as a sharper, more saturated
      green; canopy reads as a softer moss wash). If they bleed into
      each other, the layer-order or `--moss-*` token calibration
      regressed.
- [ ] Switch theme (Personalize → Display → Dusk). Canopy bands recolor
      via the existing `themeVersion` observer — bands remain visible
      in Dusk but read appropriately darker.

**Android Chrome — portrait + landscape**:

- [ ] Repeat the iPhone Safari list above.
- [ ] Long-press the toggle (~600 ms) without moving → tap is registered
      cleanly on release; no context menu, no sheet snap. Confirms the
      WFCheck `<label>` doesn't compete with the body-drag state machine.

**Share-card footer**:

- [ ] Open the share modal on a real device → the share card includes
      the new `Data: …` attribution subline below the colophon.
      Verify it doesn't push the visit-strip off the bottom of the
      card on a narrow viewport, and that it captures cleanly into
      the downloaded PNG (no text clipping, fonts loaded).

If any item fails, paste the Safari/Chrome console output, the device
+ OS version, and which item regressed, and Claude will iterate.

## Parks + Green-Space heatmaps — Chunk 4 mobile sign-off checklist

Same `WFCheck` row wiring as Tree canopy, inside `ExploreCategoryPanel`
under **Outdoors**. The two toggles cover **Park footprints (heatmap)**
(authoritative CPD park polygons, saturated `--field` green) and
**Other green space (heatmap)** (OSM cemeteries / golf / nature
reserves / recreation grounds, softer `--moss-500` wash). Persistence
+ render are unit-tested; the items below require a phone. Run
`npm run dev:tunnel`, switch to Explore mode, drag the sheet to
**half**, expand **Outdoors**, then check each item off.

**iPhone Safari — portrait + landscape** (run the same list twice):

- [ ] Tap **Park footprints (heatmap)** → saturated green fills paint
      every CPD park inside the isochrone (Lincoln Park's huge
      footprint, neighborhood pocket parks). Sheet stays at half — no
      snap to peek or full.
- [ ] Tap **Park footprints (heatmap)** again → fills disappear with
      no network request (Safari Dev Tools → Network shows no new
      `/explore` call) and no flicker on other layers.
- [ ] Tap **Other green space (heatmap)** → softer moss fills appear
      at Graceland / Rosehill / Mt. Olive cemeteries, Diversey golf
      course, Forest Preserve land, and school athletic fields. Sheet
      stays at half.
- [ ] With both heatmaps enabled simultaneously, parks read as a
      sharper, more saturated green and green-space reads as a softer
      moss wash. Where they overlap, the CPD parks layer visually wins
      (z-order: green-space below CPD parks).
- [ ] Toggle states survive a full page reload (close the tab, reopen
      the tunnel URL, switch to Explore mode → both toggles are in
      the same state you left them).
- [ ] Switch theme (Personalize → Display → Dusk). Both layers
      re-resolve their fill colors to the Dusk-theme variants via the
      existing `themeVersion` observer.
- [ ] Both heatmap fills clip cleanly to the isochrone polygon — a
      park or cemetery that pokes outside the walkshed should appear
      cut at the polygon edge.

**Android Chrome — portrait + landscape**:

- [ ] Repeat the iPhone Safari list above.
- [ ] Long-press either toggle (~600 ms) without moving → tap is
      registered cleanly on release; no context menu, no sheet snap.
      Confirms the `WFCheck` `<label>` doesn't compete with the
      body-drag state machine (same posture as the Tree canopy row).

If any item fails, paste the Safari/Chrome console output, the device
+ OS version, and which item regressed, and Claude will iterate.

## Fallback: ngrok

If `cloudflared` won't install or behaves badly on your network, ngrok is a workable fallback. It needs a free account (`ngrok config add-authtoken …`) but offers a nicer request inspector at `http://localhost:4040`. Manual flow (no orchestrator):

1. `ngrok http 8000` → note the `https://…ngrok-free.app` URL.
2. Set `frontend/.env.local` to `VITE_BACKEND_URL=<that URL>`.
3. Start uvicorn with `DEV_TUNNEL_ORIGIN_REGEX="^https://[a-z0-9-]+\.ngrok-free\.app$"`.
4. `ngrok http 5173` in a second terminal → open that URL on your phone.
5. Add `.ngrok-free.app` to `server.allowedHosts` in `frontend/vite.config.js` for the session, or run vite with `--host` and bypass the host check.

Cloudflare is the supported default; ngrok is on you.

## Future: stable subdomain

The free `trycloudflare.com` URL changes every run, which is fine for "open this on my phone for five minutes" but annoying when you're sending a build to a reviewer who needs to come back later. A named Cloudflare tunnel (`cloudflared tunnel create …`) gives a stable subdomain on a domain you control, but requires a real Cloudflare account and a DNS record. Defer until someone actually needs it.
