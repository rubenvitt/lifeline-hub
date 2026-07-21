import { defineConfig, devices } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Die Suite ist selbsttragend: `pnpm e2e` startet Backend UND Vite selbst (LFH-309/F29).
// Vorher stand hier nur der Vite-Dev-Server und der Hinweis, das Backend „separat (siehe
// Step 5)" zu starten — ein Verweis auf einen Schritt, den es im Repo nie gab.

const frontendVerzeichnis = fileURLToPath(new URL('.', import.meta.url));
const binaer = resolve(frontendVerzeichnis, '..', 'target', 'debug', 'lifeline-hub');

// Vorgebautes Binary voraussetzen statt bauen: `cargo build` im webServer-Command würde
// jeden Lauf um Minuten verlängern und den Fehlerfall hinter einem Compile-Log verstecken.
if (!existsSync(binaer)) {
  throw new Error(
    `Backend-Binary fehlt: ${binaer}\n` +
      'Die e2e-Suite startet das Backend selbst und setzt dafür einen Debug-Build voraus.\n' +
      'Vorher einmal `cargo build` im Repo-Wurzelverzeichnis laufen lassen.',
  );
}

/**
 * Reserviert n freie Ports und gibt sie erst frei, wenn ALLE vergeben sind.
 * Nacheinander zu reservieren reicht nicht: nach dem Schließen des ersten Listeners
 * vergibt das OS denselben Port sofort wieder, und Backend und Vite kollidieren.
 * Top-Level-await trägt hier, weil das Paket "type": "module" ist.
 */
async function freiePorts(anzahl: number): Promise<number[]> {
  const server = await Promise.all(
    Array.from({ length: anzahl }, () =>
      new Promise<ReturnType<typeof createServer>>((fertig) => {
        const s = createServer();
        s.listen(0, '127.0.0.1', () => fertig(s));
      }),
    ),
  );
  const ports = server.map((s) => (s.address() as { port: number }).port);
  await Promise.all(server.map((s) => new Promise((fertig) => s.close(fertig))));
  return ports;
}

// Playwright lädt diese Config in JEDEM Worker-Prozess erneut. Ohne Stabilisierung
// zöge jeder Worker eigene Ports und ein eigenes Temp-Verzeichnis — die Tests liefen
// dann gegen Ports, auf denen nie ein Server gestartet wurde (gemessen: 18/18 rot mit
// ERR_CONNECTION_REFUSED, jeder Worker auf einer anderen Portnummer). Der Hauptprozess
// entscheidet einmal und vererbt das Ergebnis über die Umgebung an seine Worker.
const ENV_SCHLUESSEL = 'LIFELINE_E2E_LAUF';
const lauf: { backendPort: number; frontendPort: number; datenbank: string } = process.env[
  ENV_SCHLUESSEL
]
  ? JSON.parse(process.env[ENV_SCHLUESSEL]!)
  : await (async () => {
      const [backendPort, frontendPort] = await freiePorts(2);
      // Temp-DB je Lauf macht jedes Cleanup obsolet: die Specs dürfen ihre
      // `Date.now()`-Fixtures behalten, und im Repo-Baum bleibt kein
      // frontend/lifeline.db zurück.
      const datenbank = join(mkdtempSync(join(tmpdir(), 'lifeline-e2e-')), 'lifeline.db');
      const neu = { backendPort, frontendPort, datenbank };
      process.env[ENV_SCHLUESSEL] = JSON.stringify(neu);
      return neu;
    })();

const { backendPort, frontendPort, datenbank } = lauf;
const backendUrl = `http://127.0.0.1:${backendPort}`;
// IPv4 durchgängig: Vite bindet ohne --host ausschließlich auf [::1], und Playwrights
// Health-Check gegen 127.0.0.1 läuft dann in den Timeout, obwohl der Server längst
// lauscht (gemessen: curl auf [::1] → 200, auf 127.0.0.1 → connection refused). Das war
// der eigentliche Blocker; die vermeintlich fehlende Vite-Ausgabe war nur Playwrights
// stdout-Default 'ignore'.
const baseURL = `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'Backend',
      command: `${binaer} --db-path ${datenbank} --bind 127.0.0.1:${backendPort} --admin-password e2e-admin-pw`,
      url: `${backendUrl}/api/health`,
      // Nie einen fremden Server übernehmen: ein laufender Dev-Stack hätte eine andere DB
      // und ein anderes Admin-Passwort — alle Logins scheiterten mit irreführender Meldung.
      // Dank eigener freier Ports gibt es ohnehin nichts zu übernehmen.
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      name: 'Frontend',
      // Port als CLI-Argument, nicht über FRONTEND_PORT: die Variable steht in der
      // mise-Umgebung bereits auf 5173 und gewinnt gegen alles, was wir hier setzen.
      // `pnpm run dev -- --port X` reicht das `--` an Vite durch → `pnpm exec vite`.
      command: `pnpm exec vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: baseURL,
      // Proxy-Ziel auf unser Test-Backend umbiegen (vite.config.ts liest die Variable,
      // process.env hat dort Vorrang vor .env.local).
      env: { LIFELINE_BACKEND_URL: backendUrl },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
