import { defineConfig, devices } from '@playwright/test';

// Dev-Port wie in vite.config aus ENV (von `npm run setup` gesetzt), Default 5173.
const frontendPort = process.env.FRONTEND_PORT || '5173';
const baseURL = process.env.FRONTEND_URL || `http://localhost:${frontendPort}`;

/** Startet automatisch den Vite-Dev-Server (erbt ENV → liest FRONTEND_PORT/
 *  LIFELINE_BACKEND_URL). Das Backend muss separat auf dem konfigurierten Port
 *  laufen (siehe Step 5). */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
