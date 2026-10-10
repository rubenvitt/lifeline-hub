import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KONTEXTE } from './e2e/doku-bilder/kontexte';
import { ADMIN_PW } from './e2e/rollen-kern';
import { backendBinaer, freiePorts, umgebungRaeumen, viteServer } from './e2e/lauf-kern';

/**
 * Bildlauf der Anwenderdokumentation (LFH-1128, `docs/anwender/AGENTS.md`, „Bilder“): fotografiert
 * die App für die Kapitel unter `docs/anwender/kapitel/`. Aufruf in `frontend/`:
 *
 *   mise exec -- pnpm doku:bilder                         alle Kapitel, je eines in eigenem Lauf
 *   mise exec -- pnpm doku:bilder --grep <kapitel>        nur ein Kapitel
 *
 * Kein Test: die Bilder sind Doku, ihre Frische trägt die Mitänderungsregel, kein Pixelvergleich.
 *
 * Getrennt vom e2e-Lauf (`playwright.config.ts` schließt `e2e/doku-bilder/` aus): das Backend
 * startet hier mit `--demo-daten`, und `e2e/doku-bilder/vorbereitung.ts` spielt den Übungseinsatz
 * ein. Jede e2e-Spec sähe sonst dessen Stammdaten.
 *
 * Parallel tauglich: jeder Lauf reserviert eigene Ports und legt eine eigene Temp-DB an, mehrere
 * Worktrees fotografieren nebeneinander. Die Bilder landen im Checkout, in dem der Lauf startet
 * (`e2e/doku-bilder/kern.ts` schreibt relativ zur eigenen Datei). `PW_BINAER` übersteuert das
 * Backend-Binary wie im e2e-Lauf.
 *
 * Gleiche Aufnahmen: ein Worker, Chromium, Zeitzone Europe/Berlin, Gebietsschema de-DE, keine
 * Animationen, Gerätefaktor 1, helles Theme und Dichte `kompakt` im Speicher des Geräts, fester
 * Viewport (Fükw 1440×900; weitere Kontexte in `e2e/doku-bilder/kontexte.ts`). Die Browser-Uhr
 * hält jede Bilder-Spec selbst an (`uhrAnhalten`).
 */

const frontendVerzeichnis = fileURLToPath(new URL('.', import.meta.url));
const binaer = backendBinaer(frontendVerzeichnis);

// Wie im e2e-Lauf: der Hauptprozess entscheidet Ports und Temp-DB einmal und vererbt sie über die
// Umgebung an die Worker, die diese Config erneut laden. Eigener Schlüssel, damit ein e2e-Lauf
// im selben Terminal nichts erbt.
const ENV_SCHLUESSEL = 'LIFELINE_DOKU_LAUF';
const vorbelegt = process.env[ENV_SCHLUESSEL];
umgebungRaeumen(ENV_SCHLUESSEL);

const lauf: { backendPort: number; frontendPort: number; datenbank: string } = vorbelegt
  ? JSON.parse(vorbelegt)
  : await (async () => {
      const [backendPort, frontendPort] = await freiePorts(2);
      const datenbank = join(mkdtempSync(join(tmpdir(), 'lifeline-doku-')), 'lifeline.db');
      const neu = { backendPort, frontendPort, datenbank };
      process.env[ENV_SCHLUESSEL] = JSON.stringify(neu);
      console.log(`Backend-Binary: ${binaer}`);
      return neu;
    })();

const { backendPort, frontendPort, datenbank } = lauf;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const baseURL = `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: './e2e/doku-bilder',
  testMatch: '**/*.bilder.ts',
  globalSetup: './e2e/doku-bilder/vorbereitung.ts',
  // Ein Worker: die Bilder teilen sich den Demo-Einsatz, und gleichzeitige Aufnahmen sähen
  // einander (Live-Strom, Zähler).
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    viewport: KONTEXTE.fuekw,
    deviceScaleFactor: 1,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    reducedMotion: 'reduce',
    colorScheme: 'light',
    // Helles Theme und Dichte `kompakt` (Design LFH-1127, F1/F2): als gespeicherte Wahl des
    // Geräts, wie bei jemandem, der sie eingestellt hat. Gilt auch für Kontexte, die eine Spec
    // selbst öffnet (`browser.newContext()` erbt die Optionen des Projekts).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [
            { name: 'lifeline-hub.theme', value: 'light' },
            { name: 'lifeline-hub.dichte', value: 'kompakt' },
          ],
        },
      ],
    },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'doku' }],
  webServer: [
    {
      name: 'Backend',
      // `--demo-daten` schaltet `/api/demo-daten` frei (src/AGENTS.md, Demo-Daten);
      // `--kritis-extrakt false` wie im e2e-Lauf (kein Deutschland-Extrakt je Lauf).
      command: `${binaer} --db-path ${datenbank} --bind 127.0.0.1:${backendPort} --admin-password ${ADMIN_PW} --kritis-extrakt false --demo-daten`,
      url: `${backendUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    viteServer(frontendPort, backendUrl),
  ],
});
