import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "NoteWise — Your notes, understood",
        short_name: "NoteWise",
        description: "Offline AI study assistant. Ask questions, get answers from your own notes with page numbers.",
        theme_color: "#0f3d3e",
        background_color: "#f7f4ee",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app shell is precached so NoteWise opens with no network.
        // The AI runtime (~27 MB wasm) is NOT precached: students who never turn on
        // smart search shouldn't pay for it. It's cached the first time it's used,
        // and the model weights are cached by Transformers.js itself.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png}"],
        // OCR files are cached on first use instead (see runtimeCaching), like the AI runtime.
        globIgnores: ["tesseract/**"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Tesseract.js OCR engine + language data, served from /tesseract, cached on first use.
            urlPattern: ({ url }) => url.pathname.startsWith("/tesseract/"),
            handler: "CacheFirst",
            options: { cacheName: "notewise-ocr", expiration: { maxEntries: 10 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".wasm"),
            handler: "CacheFirst",
            options: { cacheName: "notewise-ai-runtime", expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
