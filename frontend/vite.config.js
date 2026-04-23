import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Walk Path Calculator",
        short_name: "Walk Path",
        description: "Real walking directions with exact step counts for Chicago — walk more, feel better.",
        theme_color: "#2d7a3e",
        background_color: "#0a1a0f",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2}", "icon-*.png", "apple-touch-icon.png"],
        runtimeCaching: [
          {
            urlPattern: /\/(route|health)(\?.*)?$/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
