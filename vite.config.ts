import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["spoolside.png"],
      manifest: {
        name: "Spoolside",
        short_name: "Spoolside",
        description: "Your A1 mini print farm, at a glance.",
        theme_color: "#102d44",
        background_color: "#f6f8f8",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        importScripts: ["/push-handlers.js"],
        globPatterns: ["**/*.{js,css,html,png,woff2}"],
        maximumFileSizeToCacheInBytes: 5000000,
      },
    }),
  ],
});
