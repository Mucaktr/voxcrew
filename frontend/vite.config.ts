import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// STALE-DIST: derleme sonunda dist/build-info.json (commit, zaman, kaynak özeti); sunucu eski arayüzü bununla fark eder
import { buildInfoPlugin } from "./scripts/build-info.mjs";

// Geliştirme vekili: backend portu STUDIO_PORT ortam değişkeninden (varsayılan 7420).
// Paralel ekipler kendi Vite portunu ve önbelleğini VITE_PORT / VITE_CACHE_DIR ile seçer;
// böylece ekip başına ayrı vite.*.config dosyası gerekmez.
const studioPort = Number(process.env.STUDIO_PORT || 7420);

export default defineConfig({
  plugins: [react(), tailwindcss(), buildInfoPlugin()],
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: Boolean(process.env.VITE_PORT),
    proxy: { "/api": { target: `http://127.0.0.1:${studioPort}`, changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Kararlı vendor parçaları: `react` (her sayfada), `three` (dünya, yapıcı, avatar önizlemesi), `graph` (bellek ve
        // akış grafları). Rollup bir manuel parçanın sahipsiz bağımlılıklarını o parçaya çeker; React ve yardımcılar kendi
        // parçasına alınmazsa React `three` içine düşer ve ana giriş three + graf parçalarını statik olarak içe aktarır
        // (eski nesne biçiminde dünya dışı sayfalar ~1,4 MB fazladan indiriyordu).
        manualChunks(id) {
          const p = id.split("\\").join("/");
          const REACT = /\/node_modules\/(react|react-dom|scheduler|zustand|use-sync-external-store|@babel\/runtime)\//;
          if (p.startsWith("\0")) {
            return p.includes("commonjsHelpers") || p.includes("preload-helper") || REACT.test(p) ? "react" : undefined;
          }
          if (!p.includes("/node_modules/")) return undefined;
          if (REACT.test(p)) return "react";
          if (/\/node_modules\/(three|three-stdlib|three-mesh-bvh|@react-three|troika-[^/]+|camera-controls|maath|meshline|stats-gl|stats\.js|@monogrid|detect-gpu|hls\.js|its-fine|suspend-react|tunnel-rat|react-reconciler|@use-gesture)\//.test(p)) return "three";
          if (/\/node_modules\/(react-force-graph-2d|force-graph|@xyflow|d3-[^/]+|kapsule|accessor-fn|canvas-color-tracker|bezier-js|float-tooltip|index-array-by|lodash-es|tinycolor2|preact|internmap)\//.test(p)) return "graph";
          return undefined;
        },
      },
    },
  },
});
