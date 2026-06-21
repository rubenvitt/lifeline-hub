/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
      VitePWA({
        registerType: 'autoUpdate',
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
