import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Die Suite ist selbsttragend: `pnpm e2e` startet Backend UND Vite selbst (LFH-309/F29).
// Vorher stand hier nur der Vite-Dev-Server und der Hinweis, das Backend „separat (siehe
// Step 5)" zu starten — ein Verweis auf einen Schritt, den es im Repo nie gab.

const frontendVerzeichnis = fileURLToPath(new URL('.', import.meta.url));
// Dieselbe Cargo-Wahrheit wie check-all.sh: build.target-dir bzw. CARGO_TARGET_DIR
// kann das Binary außerhalb des Worktrees ablegen.
const cargoMetadaten = JSON.parse(execFileSync(
  'cargo', ['metadata', '--format-version', '1', '--no-deps'],
  { cwd: resolve(frontendVerzeichnis, '..'), encoding: 'utf8' },
)) as { target_directory: string };
const binaer = join(cargoMetadaten.target_directory, 'debug', 'lifeline-hub');

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
const vorbelegt = process.env[ENV_SCHLUESSEL];

// Env-Hygiene wie im Sammel-Gate (scripts/lib/dev-env.sh): Playwright merged
// webServer.env mit process.env, das e2e-Backend erbt also die komplette Dev-Umgebung.
// Auf der CLI gepinnt sind nur --db-path/--bind/--admin-password; alles andere käme
// ungefiltert durch, und der Lauf wäre grün oder rot je nach lokaler Env-Belegung statt
// durch Konstruktion. Konkrete Brecher: LIFELINE_TLS=true (Backend spricht HTTPS, der
// Health-Check auf http:// wird nie grün), LIFELINE_ADMIN_USER (Bootstrap legt einen
// anderen Benutzer an → jeder Spec-Login scheitert), LIFELINE_BACKUP_VERZEICHNIS (der
// Testlauf schreibt ins echte Dev-Backup-Verzeichnis).
// Bewusst hier statt nur in check-all.sh: der Task fordert ein alleinstehendes
// `pnpm e2e`, und das läuft nicht durch den Gate-Wrapper.
for (const schluessel of Object.keys(process.env)) {
  // Unsere eigene Lauf-Variable trägt zwar das LIFELINE_-Präfix, ist aber KEINE
  // Dev-Variable, sondern der Kanal zu den Workern — würde sie mitgeräumt, zöge jeder
  // Worker wieder eigene Ports.
  if (schluessel !== ENV_SCHLUESSEL && /^(LIFELINE|KS|AWS)_/.test(schluessel)) {
    delete process.env[schluessel];
  }
}

const lauf: { backendPort: number; frontendPort: number; datenbank: string } = vorbelegt
  ? JSON.parse(vorbelegt)
  : await (async () => {
      const [backendPort, frontendPort] = await freiePorts(2);
      // Temp-DB je Lauf erspart jedes Cleanup im Repo-Baum: die Specs dürfen ihre
      // `Date.now()`-Fixtures behalten, und es bleibt kein frontend/lifeline.db zurück.
      // Was bleibt, ist ein Verzeichnis pro Lauf unter $TMPDIR — klein und vom System
      // periodisch geräumt.
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
  /**
   * GEDECKELTE WORKER-ZAHL — gemessen, nicht vorsichtshalber (03.09.2026).
   *
   * Playwrights Vorgabe ist `cpus / 2`, hier also 6. Damit fielen in zwei
   * Vollläufen hintereinander je zwei bis drei Tests aus — WANDERND (erst
   * `kraefte-schmal`, dann `fokus-verdeckung` + `gate1-ueberlauf`) und
   * ausnahmslos mit Infrastruktur-Signaturen: `page.goto`-Timeout nach 90 s,
   * `ERR_CONNECTION_REFUSED`, ein fehlgeschlagenes Seeding („mindestens 8
   * gesäte Zeilen" → 0). Nie eine Zusicherung über das geprüfte Verhalten.
   *
   * Der Grund ist Lastdruck, kein Testfehler: sechs Chromium-Instanzen plus
   * Backend plus Vite kommen auf eine Maschine, die im Leerlauf schon rund 10
   * ihrer 12 Kerne belegt hat. Mit drei Workern: 93/93, und der Preis sind
   * 4,2 statt 3,4 Minuten.
   *
   * Das ist bewusst KEINE Toleranz an einer Zusicherung — die Tests bleiben
   * scharf, es laufen nur weniger gleichzeitig. Ein Gate, das je Lauf andere
   * Tests rot färbt, wird abgeschaltet statt befolgt; genau deshalb steht die
   * Zahl hier und nicht in einem Kommentar.
   *
   * Übersteuerbar: `PW_WORKERS=6 pnpm e2e` auf einer ruhigen Maschine.
   */
  workers: Number(process.env.PW_WORKERS ?? 3),
  /*
   * FRISTEN NACH HARDWARE, NICHT NACH WUNSCH (LFH-522, gemessen im ersten CI-Lauf).
   *
   * Auf einem GitHub-Runner (2 vCPU) fielen 10 von 151 Tests aus — ausnahmslos an der Uhr:
   * `page.goto`/`locator.click` überschritten den 30-s-Testtimeout, während 141 grün
   * durchliefen. Das ist keine Regression, sondern die Hardware: die Suite fährt gegen den
   * Vite-DEV-Server, der jedes Modul beim ersten Aufruf übersetzt, und zwei Worker teilen
   * sich dabei zwei Kerne mit dem Backend.
   *
   * Deshalb längere Fristen NUR unter `CI` — lokal bleiben 30 s, damit ein echt hängender
   * Test hier schnell auffällt und nicht eine halbe Minute pro Lauf kostet.
   */
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 25_000 : 10_000 },
  /*
   * EIN Wiederholungsversuch, und nur unter CI. Das ist bewusst die schwächste Zusicherung
   * in dieser Datei, deshalb die Grenze: ein Test, der ZWEIMAL scheitert, bleibt rot — ein
   * deterministisch kaputter Test wird also nicht grün gewaschen. Was `retries` auffängt,
   * ist der Fall, den `trace: 'on-first-retry'` unten ohnehin schon voraussetzt: ein Ausfall,
   * der beim zweiten Anlauf nicht wiederkehrt. Wer hier auf 2 erhöht, verschiebt die Grenze
   * zwischen „flaky" und „kaputt" — und sollte vorher wissen, warum.
   */
  retries: process.env.CI ? 1 : 0,
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
