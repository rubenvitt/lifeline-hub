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
// (src/static_files.rs) und damit der komplette Backend-Build — deshalb ist die
// .gitkeep dort getrackt (LFH-242/F19). Vites emptyOutDir räumt den Ordner bei
// jedem Build aus und würde sie mitnehmen: der Fix zerfiele beim ersten
// `pnpm build`, und die Löschung landete früher oder später in einem Commit.
// Also nach dem Schreiben des Bundles wiederherstellen.
// Die Datei ist bewusst LEER: der Hook schreibt sie nach jedem Build neu, und nur
// bei byte-identischem Inhalt bleibt der Arbeitsbaum sauber. Den Zielpfad holen wir
// aus der aufgelösten Vite-Config statt aus __dirname/cwd — das Paket ist ESM, und
// der Hook soll auch stimmen, wenn woanders her gebaut wird.
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

// Dev-Server und Proxy-Ziel werden NICHT fest verdrahtet (Workspaces vergeben Ports
// dynamisch). Quelle: .env.local (vom `pnpm run setup` geschrieben) + Shell-/CI-ENV,
// wobei process.env Vorrang hat. Defaults greifen für „einfach lokal".
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
          // Der App-Haupt-Chunk überschreitet das 2-MiB-Default-Precache-Limit.
          // Workaround bis zum Code-Splitting (eigener Folge-Task: MapLibre/antd lazy laden).
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
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
    // maplibre-gl aus der Dep-Optimierung heraushalten (ab v6 nötig): der Optimizer bündelt es
    // sonst nach `node_modules/.vite/deps/`, und weil maplibre seine Worker-URL zur Laufzeit als
    // Geschwisterdatei von `import.meta.url` konstruiert, sucht es den Worker dann dort — wo er
    // nicht liegt (gemessen: 404 auf `/node_modules/.vite/deps/maplibre-gl-worker.mjs`, mit
    // exclude: 200 auf den echten Pfad). Betrifft NUR den Dev-Server; der Prod-Build wird über
    // `setWorkerUrl` in Kartenflaeche.tsx versorgt, dort steht die ausführliche Begründung.
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
