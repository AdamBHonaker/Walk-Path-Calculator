import { createHash } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Inject a Content-Security-Policy meta tag whose contents differ between dev
// and production builds. Production hashes every inline <script> (only the
// theme-boot script lives in index.html today, but Vite may also inline a
// modulepreload polyfill — both get covered) so `'unsafe-inline'` can be
// dropped from script-src. Dev keeps `'unsafe-inline' 'unsafe-eval'` because
// the Vite dev server + HMR runtime need them, and allow-lists the LAN
// uvicorn + paired Cloudflare-tunnel hostnames used by `npm run dev:tunnel`
// — those values do NOT ship in the production HTML.
//
// `frame-ancestors` is intentionally omitted; per the CSP spec it is ignored
// when delivered via <meta>, so it belongs on an HTTP response header at the
// hosting layer (Railway).
function cspPlugin() {
  let isDev = false;
  return {
    name: "passage-csp",
    config(_userConfig, env) {
      isDev = env.command === "serve";
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const hashes = [];
        if (!isDev) {
          const inlineScriptRe =
            /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
          let match;
          while ((match = inlineScriptRe.exec(html)) !== null) {
            const digest = createHash("sha256")
              .update(match[1], "utf8")
              .digest("base64");
            hashes.push(`'sha256-${digest}'`);
          }
        }

        const scriptSrc = isDev
          ? "'self' 'unsafe-inline' 'unsafe-eval'"
          : ["'self'", ...hashes].join(" ");

        // Dev origins are intentionally NOT included in the production policy.
        // The 192.168.1.191 LAN address is one developer's home network and
        // would otherwise leak into shipped HTML and slightly widen attack
        // surface on hostile LANs.
        const connectSrc = isDev
          ? [
              "'self'",
              "http://localhost:8000",
              "http://192.168.1.191:8000",
              "https://*.trycloudflare.com",
              "ws://localhost:5173",
              "ws://192.168.1.191:5173",
              "https://*.openfreemap.org",
              "https://tiles.openfreemap.org",
            ].join(" ")
          : [
              "'self'",
              "https://*.up.railway.app",
              "https://*.openfreemap.org",
              "https://tiles.openfreemap.org",
            ].join(" ");

        const directives = [
          "default-src 'self'",
          `script-src ${scriptSrc}`,
          // Inline styles remain allowed: the editorial design system uses
          // `style={{ ... }}` throughout (ShareDispatch, ErrorDispatch, the
          // Wayfarer primitives). See TD entry "Inline-style → CSS-class
          // migration" in docs/Technical_Debt.md.
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          `connect-src ${connectSrc}`,
          "worker-src 'self' blob:",
          "base-uri 'self'",
          "object-src 'none'",
          "form-action 'self'",
        ];
        if (!isDev) directives.push("upgrade-insecure-requests");

        const csp = directives.join("; ");
        const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

        return html.replace(
          /(<meta\s+name="viewport"[^>]*>)/i,
          `$1\n    ${meta}`,
        );
      },
    },
  };
}

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.js"],
  },
  plugins: [
    // TD-034: opt into the React Compiler (auto-memoization, available with
    // React 19). `compilationMode: "infer"` is the default — the compiler
    // analyzes each component and only emits memoization where it's safe.
    // Components that hit unsafe patterns (mutation, deps that don't match
    // the rules of hooks) are skipped silently with a build-time log.
    //
    // We keep the existing hand-written `useMemo` / `useCallback` calls in
    // place; the compiler is additive, not a replacement. A future cleanup
    // pass can audit which ones the compiler made redundant — that work
    // is tracked as a follow-up if measurements justify it. For now: opt
    // in and let the compiler optimize what it can.
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
    cspPlugin(),
    VitePWA({
      // "prompt" (not "autoUpdate") so a new SW doesn't silently skipWaiting +
      // reload the page mid-session — that wiped in-progress form state. The
      // app surfaces a toast instead and the user reloads on their own terms.
      registerType: "prompt",
      includeAssets: [
        "passage-icon.svg",
        "passage-icon-16.png",
        "passage-icon-32.png",
        "passage-icon-180.png",
        "passage-icon-192.png",
        "passage-icon-512.png",
      ],
      manifest: {
        name: "Passage",
        short_name: "Passage",
        description: "Real walking directions with exact step counts for Chicago — walk more, feel better.",
        theme_color: "#171310",
        background_color: "#f2ece0",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "passage-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "passage-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
          { src: "passage-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "passage-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "passage-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2}"],
        runtimeCaching: [
          {
            // TD-066 / S-07: explicit NetworkOnly for every backend
            // endpoint. The prior rule only covered /route + /health,
            // which meant /explore, /autocomplete, and /reverse-geocode
            // fell back to Workbox's default strategy. The default is
            // already NetworkOnly for navigation requests but ambiguous
            // for fetches — pin them all so a future Workbox upgrade or
            // global-handler addition can't silently start caching live
            // route + isochrone JSON. The single combined pattern
            // matches all five public endpoints.
            urlPattern: /\/(route|explore|autocomplete|reverse-geocode|health)(\?.*)?$/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // OPT-073: pin React + react-dom into a `react-vendor` chunk so
        // app-code hash bumps don't invalidate the cached React download.
        // Rule ordered before the maplibre rule so the React match wins
        // on `node_modules/react/` paths (maplibre depends on neither).
        manualChunks: (id) => {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) return "react-vendor";
          if (id.includes("node_modules/maplibre-gl/")) return "maplibre";
        },
      },
    },
  },
  server: {
    port: 5173,
    // Allow ephemeral Cloudflare Tunnel hostnames so `npm run dev:tunnel`
    // (see scripts/dev-tunnel.mjs and docs/MOBILE_TESTING.md) doesn't get
    // rejected by Vite's host check. Dev-only; production builds are static.
    allowedHosts: [".trycloudflare.com"],
  },
});
