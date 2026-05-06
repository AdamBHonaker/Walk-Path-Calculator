import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.js"],
  },
  plugins: [
    react(),
    VitePWA({
      // "prompt" (not "autoUpdate") so a new SW doesn't silently skipWaiting +
      // reload the page mid-session — that wiped in-progress form state. The
      // app surfaces a toast instead and the user reloads on their own terms.
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
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
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /\/(route|health)(\?.*)?$/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Pin maplibre-gl into a single shared chunk so the lazy MapView and
        // lazy ShareDispatch entries don't each duplicate the library.
        manualChunks: (id) => {
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
