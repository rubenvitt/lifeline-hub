/// <reference types="vitest/config" />
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';

const frontendVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

// PWA-Manifest (LFH-837) als JSON neben der Bildmarke, damit `src/marke/marke.guard.test.ts` es
// lesen kann, ohne diese Konfiguration zu laden. Ein TS-Modul ginge nicht: `tsc -b` legte seine
// `.js`-Ausgabe daneben, und Vite löst `.js` vor `.ts` auf. Titelleiste und Startbildschirm sind
// Kopf-Schwarz, im Tag- wie im Nachtbetrieb (der Rahmen ist in beiden dunkel, LFH-434). Die
// Symbole 192/512 dienen „any“, ein eigenes „maskable“; erzeugt von `scripts/marke/`.
const pwaManifest = JSON.parse(
  readFileSync(new URL('./src/marke/pwaManifest.json', import.meta.url), 'utf8'),
) as Partial<ManifestOptions>;

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

// HEIC-Decoder (LFH-1000, `src/heic/LIESMICH.md`): libheif steht unter der LGPL 3.0 und muss
// sich ersetzen lassen. Glue und WASM gehen deshalb unverändert unter festem Pfad aus
// (`LIBHEIF_PFAD` in `src/heic/heicDekodieren.ts`), der Worker lädt sie zur Laufzeit. Im Build
// werden sie als eigene Dateien ausgegeben, im Dev-Server direkt aus dem Paket geliefert. Nach
// dem Build bricht der Hook, sobald ein Chunk den Glue doch enthält: dann wäre die Bibliothek
// still wieder mit App-Code verschmolzen.
const LIBHEIF_DATEIEN = { 'libheif.js': 'text/javascript', 'libheif.wasm': 'application/wasm' };
const LIBHEIF_ZIEL = 'bibliotheken/libheif';
// Steht nur im Glue (Emscripten-Export), nie im App-Code.
const LIBHEIF_GLUE_MERKMAL = '_heif_context_alloc';
const libheifQuelle = (datei: string) =>
  createRequire(import.meta.url).resolve(`libheif-js/libheif-wasm/${datei}`);

const libheifBibliothek = (): Plugin => {
  let ausgabe = '';
  return {
    name: 'lifeline-libheif-bibliothek',
    configResolved(config) {
      ausgabe = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(`/${LIBHEIF_ZIEL}`, (req, res, weiter) => {
        const datei = (req.url ?? '').replace(/^\//, '').split('?')[0];
        const typ = LIBHEIF_DATEIEN[datei as keyof typeof LIBHEIF_DATEIEN];
        if (!typ) return weiter();
        res.setHeader('Content-Type', typ);
        res.end(readFileSync(libheifQuelle(datei)));
      });
    },
    generateBundle() {
      for (const datei of Object.keys(LIBHEIF_DATEIEN)) {
        this.emitFile({
          type: 'asset',
          fileName: `${LIBHEIF_ZIEL}/${datei}`,
          source: readFileSync(libheifQuelle(datei)),
        });
      }
    },
    closeBundle() {
      const assets = join(ausgabe, 'assets');
      for (const datei of readdirSync(assets)) {
        if (!datei.endsWith('.js')) continue;
        if (readFileSync(join(assets, datei), 'utf8').includes(LIBHEIF_GLUE_MERKMAL)) {
          throw new Error(
            `assets/${datei} enthält den libheif-Glue; er muss unter /${LIBHEIF_ZIEL}/ getrennt bleiben (LFH-1000)`,
          );
        }
      }
    },
  };
};

// Vite 8 bündelt Pakete immer mit Sourcemap vor und hängt sie beim Ausliefern als Base64 an:
// `antd.js` wuchs so von 3,2 auf 11,3 MB. An einem String dieser Größe bricht Node 26 den
// Dev-Server gelegentlich ab („Lazy deopt after a fast API call …“ in `Buffer.byteLength`), und
// jeder Folgetest der e2e-Suite lief in ERR_CONNECTION_REFUSED (LFH-659). `{ mappings: '' }`
// verwirft die Kette, und Vite hängt dann keine Map an, auch keine Ersatz-Map. Der Kommentar
// am Ende ist nötig: bleibt der Code unverändert (Paket ohne Importe, etwa `terra-draw.js`),
// verwirft Vite das Transform-Ergebnis samt leerer Map und liefert die geladene Map doch aus.
// Nur im e2e-Lauf (`playwright.config.ts` setzt die Variable): im Entwickeln bleiben die Pakete
// debugbar. Gemessen wird das in `e2e/dev-server-antwortgroesse.spec.ts`.
//
// Registriert ist das Plugin IMMER, geschaltet wird im Handler: Vite bildet den Cache-Hash der
// Vorbündelung auch aus den Plugin-Namen. Stünde es nur im e2e-Lauf in der Liste, schriebe jeder
// Wechsel zwischen `pnpm dev` und `pnpm e2e` das geteilte `node_modules/.vite/deps` neu, und ein
// laufender Dev-Server verlöre seine Chunks mitten in der Sitzung.
const depsOhneSourcemap = (aktiv: boolean): Plugin => ({
  name: 'lifeline-deps-ohne-sourcemap',
  apply: 'serve',
  enforce: 'pre',
  transform: {
    filter: { id: /\/node_modules\/\.vite\/deps\// },
    handler: (code) =>
      aktiv
        ? {
            code: `${code}\n// Sourcemap im e2e-Lauf weggelassen (LFH-659)\n`,
            map: { mappings: '' },
          }
        : null,
  },
});

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
      libheifBibliothek(),
      depsOhneSourcemap(env.LIFELINE_DEPS_OHNE_SOURCEMAP === '1'),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        workbox: {
          // Der Haupt-Chunk überschreitet das 2-MiB-Precache-Limit, solange es kein Code-Splitting gibt.
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          // Der HEIC-Decoder (LFH-759, 1,5 MB) kommt nicht in den Vorrat: ohne Netz gibt es auch
          // keine HEIC-Bytes zu dekodieren, und jeder Client lüde ihn sonst bei jedem Update vor.
          // Ein vom Betreiber ersetzter Decoder (LFH-1000) käme sonst auch nie an.
          globIgnores: [`${LIBHEIF_ZIEL}/**`],
          // Seitenwechsel auf /api/ MÜSSEN zum Server: der OIDC-Login ist ein Full-Page-Redirect
          // über `/api/auth/oidc/…`. Sonst antwortet der Service Worker mit dem gecachten
          // `index.html`, und der Login endet stumm wieder auf der Login-Seite.
          // Ebenso die Lizenzhinweise (LFH-1000, Benutzermenü „Lizenzen“): sie öffnen als eigene
          // Seite und kämen sonst als App-Hülle zurück.
          navigateFallbackDenylist: [/^\/api\//, /^\/lizenzen\//],
          // Klick auf eine Alarm-Meldung, die über den Service Worker kam (LFH-1062, Android):
          // `public/alarm-sw.js` holt den Tab nach vorn und meldet ihm den Klick.
          importScripts: ['alarm-sw.js'],
        },
        manifest: pwaManifest,
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(frontendVersion),
    },
    // maplibre-gl nicht vorbündeln (nur Dev-Server): maplibre baut seine Worker-URL relativ zu
    // `import.meta.url` und suchte den Worker sonst unter `node_modules/.vite/deps/`, wo er nicht
    // liegt. Den Prod-Build versorgt `setWorkerUrl` in `pages/lagekarte/maplibreWorker.ts`.
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
