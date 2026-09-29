/// <reference types="vitest/config" />
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const frontendVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

// `frontend/dist` muss zur Compile-Zeit existieren, sonst bricht rust-embed
// (src/static_files.rs) den Backend-Build — deshalb ist die .gitkeep dort getrackt.
// Vites emptyOutDir räumt sie bei jedem Build weg; der Hook schreibt sie danach LEER
// neu, damit der Arbeitsbaum byte-identisch sauber bleibt. Pfad aus der aufgelösten
// Config, weil das Paket ESM ist und auch von woanders gebaut werden kann.
const gitkeepBewahren = (): Plugin => {
  let gitkeepPfad = '';
  return {
    name: 'lifeline-dist-gitkeep-bewahren',
    apply: 'build',
    configResolved(config) {
      gitkeepPfad = resolve(config.root, config.build.outDir, '.gitkeep');
    },
    closeBundle() {
      writeFileSync(gitkeepPfad, '');
    },
  };
};

// Dev-Port und Proxy-Ziel kommen aus .env.local und der Umgebung (process.env hat
// Vorrang), weil Workspaces Ports dynamisch vergeben.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const backendUrl = env.LIFELINE_BACKEND_URL || 'http://127.0.0.1:8080';
  const frontendPort = env.FRONTEND_PORT ? Number(env.FRONTEND_PORT) : undefined;

  return {
    plugins: [
      react(),
      gitkeepBewahren(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg'],
        workbox: {
          // Der Haupt-Chunk überschreitet das 2-MiB-Precache-Limit, solange es kein Code-Splitting gibt.
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          // Seitenwechsel auf /api/ MÜSSEN zum Server: der OIDC-Login ist ein Full-Page-Redirect
          // über `/api/auth/oidc/…`. Sonst antwortet der Service Worker mit dem gecachten
          // `index.html`, und der Login endet stumm wieder auf der Login-Seite.
          navigateFallbackDenylist: [/^\/api\//],
        },
        manifest: {
          name: 'lifeline-hub',
          short_name: 'lifeline',
          description: 'Elektronisches Einsatztagebuch',
          theme_color: '#a8071a',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(frontendVersion),
    },
    // maplibre-gl nicht vorbündeln (nur Dev-Server): maplibre baut seine Worker-URL relativ zu
    // `import.meta.url` und suchte den Worker sonst unter `node_modules/.vite/deps/`, wo er nicht
    // liegt. Den Prod-Build versorgt `setWorkerUrl` in Kartenflaeche.tsx.
    optimizeDeps: { exclude: ['maplibre-gl'] },
    server: {
      port: frontendPort, // undefined → Vite-Default (5173) bzw. nächster freier Port
      strictPort: false,
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: false,
      testTimeout: 10000,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  };
});
