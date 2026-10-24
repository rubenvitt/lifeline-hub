import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

/**
 * Gemeinsame Teile der beiden Playwright-Konfigurationen: der e2e-Suite
 * (`playwright.config.ts`) und des Bildlaufs der Anwenderdoku (`playwright.doku.config.ts`,
 * LFH-1128). Beide starten Backend und Vite selbst, je Lauf mit eigenen Ports und eigener
 * Temp-DB, damit mehrere Läufe (Worktrees, Kapitelpakete) nebeneinander laufen.
 */

/**
 * Der Pfad zum Backend-Binary — über `cargo metadata`, weil `build.target-dir` bzw.
 * `CARGO_TARGET_DIR` es außerhalb des Worktrees ablegen kann (LFH-518). Dieselbe Frage stellt
 * `scripts/lib/backend-binaer.sh`; im Sammel-Gate kommt ihre Antwort als `PW_BINAER` hier an,
 * sodass Gate und Suite dasselbe Binary nehmen. Gefragt wird hier nur beim alleinstehenden Lauf.
 * Das Ziel je Checkout (`<worktree>/target`) legt `.cargo/config.toml` fest (LFH-520).
 *
 * `PW_BINAER` übersteuert das: ein e2e-Shard der CI lädt das Binary als Artefakt und bräuchte
 * sonst die ganze Rust-Toolchain. Der Präfix `PW_` ist Absicht — ein `LIFELINE_`-Name fiele
 * unter die Env-Hygiene und würde geräumt.
 *
 * Wirft, wenn das Binary fehlt oder nicht ausführbar ist.
 */
export function backendBinaer(frontendVerzeichnis: string): string {
  const ueberschrieben = process.env.PW_BINAER;
  const binaer = ueberschrieben
    ? resolve(ueberschrieben)
    : join(
        (
          JSON.parse(
            execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
              cwd: resolve(frontendVerzeichnis, '..'),
              encoding: 'utf8',
            }),
          ) as { target_directory: string }
        ).target_directory,
        'debug',
        'lifeline-hub',
      );

  // Vorgebautes Binary voraussetzen statt bauen: `cargo build` im webServer-Command verlängerte
  // jeden Lauf um Minuten und versteckte den Fehlerfall hinter einem Compile-Log.
  if (!existsSync(binaer)) {
    throw new Error(
      `Backend-Binary fehlt: ${binaer}\n` +
        'Die e2e-Suite startet das Backend selbst und setzt dafür einen Debug-Build voraus.\n' +
        'Vorher einmal `cargo build` im Repo-Wurzelverzeichnis laufen lassen.',
    );
  }

  /*
   * Ausführbar muss es auch sein: `actions/upload-artifact` stellt beim Auspacken alles auf 644,
   * und ohne diese Prüfung stürbe der Lauf erst im webServer-Start mit EACCES — an einer Stelle,
   * die nach einem Anwendungsfehler aussieht.
   */
  try {
    accessSync(binaer, constants.X_OK);
  } catch {
    throw new Error(
      `Backend-Binary ist nicht ausführbar: ${binaer}\n` +
        'In der CI verliert actions/upload-artifact die Dateirechte (alles wird 644).\n' +
        'Nach dem Download `chmod +x` auf die Datei anwenden.',
    );
  }
  return binaer;
}

/**
 * Reserviert n freie Ports und gibt sie erst frei, wenn ALLE vergeben sind.
 * Nacheinander zu reservieren reicht nicht: nach dem Schließen des ersten Listeners
 * vergibt das OS denselben Port sofort wieder, und Backend und Vite kollidieren.
 */
export async function freiePorts(anzahl: number): Promise<number[]> {
  const server = await Promise.all(
    Array.from(
      { length: anzahl },
      () =>
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

/**
 * Env-Hygiene wie im Sammel-Gate (scripts/lib/dev-env.sh): Playwright merged webServer.env mit
 * process.env, das Backend erbte sonst die Dev-Umgebung — etwa LIFELINE_TLS (der Health-Check
 * auf http:// würde nie grün), LIFELINE_ADMIN_USER (jeder Login scheiterte) oder
 * LIFELINE_BACKUP_VERZEICHNIS. Hier statt nur in check-all.sh, damit auch ein alleinstehender
 * Lauf sauber läuft. Die eigene Lauf-Variable bleibt: sie ist der Kanal zu den Workern.
 */
export function umgebungRaeumen(laufSchluessel: string) {
  for (const schluessel of Object.keys(process.env)) {
    if (schluessel !== laufSchluessel && /^(LIFELINE|KS|AWS)_/.test(schluessel)) {
      delete process.env[schluessel];
    }
  }
}

/**
 * Vite-Dev-Server für einen Lauf. Port als CLI-Argument, nicht über FRONTEND_PORT (steht in der
 * mise-Umgebung auf 5173 und gewönne). Vite direkt, weil `pnpm run dev -- --port X` das `--`
 * durchreicht.
 *
 * Node 26 (V8 14.6, in jedem 26.x-Release, auch dem gepinnten 26.7.0) bricht den Dev-Server
 * gelegentlich mit „Lazy deopt after a fast API call with return value is unsupported" ab
 * (`Buffer.byteLength` beim Ausliefern eines großen Strings); alle Folgetests liefen dann in
 * ERR_CONNECTION_REFUSED. Der Auslöser war das vorgebündelte `antd.js` mit angehängter Sourcemap,
 * 11,3 MB; `LIFELINE_DEPS_OHNE_SOURCEMAP` drückt es auf 3,2 MB (LFH-659, gemessen in
 * `e2e/dev-server-antwortgroesse.spec.ts`). Der Schalter `--no-turbo-fast-api-calls` bleibt als
 * zweite Sicherung: der Abbruch hängt nicht allein an der Größe, und lokal ließ er sich nicht
 * nachstellen. Er ist eine V8-Option und in NODE_OPTIONS verboten, deshalb startet der Befehl
 * Node selbst (`process.execPath`, dieselbe gepinnte Version).
 */
export function viteServer(frontendPort: number, backendUrl: string) {
  return {
    name: 'Frontend',
    command: `"${process.execPath}" --no-turbo-fast-api-calls node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${frontendPort} --strictPort`,
    // IPv4 durchgängig: Vite bindet ohne --host nur auf [::1], und Playwrights Health-Check gegen
    // 127.0.0.1 liefe in den Timeout.
    url: `http://127.0.0.1:${frontendPort}`,
    // Proxy-Ziel auf das Backend des Laufs umbiegen (vite.config.ts liest die Variablen,
    // process.env hat dort Vorrang vor .env.local).
    env: { LIFELINE_BACKEND_URL: backendUrl, LIFELINE_DEPS_OHNE_SOURCEMAP: '1' },
    reuseExistingServer: false,
    timeout: 60_000,
  };
}

/** Browserablage des Abbilds der Claude-Cloud-Sitzung (dort `PLAYWRIGHT_BROWSERS_PATH`). */
const CLOUD_BROWSER_DIR = '/opt/pw-browsers';

/**
 * Ersatz-Chromium für die Cloud-Sitzung (LLH-1439): das Abbild bringt unter `/opt/pw-browsers`
 * einen Chromium-Build mit, der nicht zum Playwright des Repos passen muss (erwartet 1234, dort
 * lagen 1194 und später 1243), und `playwright install` ist dort gesperrt. Fehlt der erwartete
 * Browser und liegt dort einer, kommt sein Pfad zurück, für `launchOptions.executablePath` im
 * Projekt `chromium`. Bevorzugt die Headless-Shell (sie fährt Playwright headless, so auch die
 * CI), sonst das volle Chromium, je der höchste Build.
 *
 * Sonst `undefined`, und die Konfiguration bleibt, wie sie ist: mit installiertem Browser (CI,
 * Entwicklerrechner) ändert sich nichts, und ohne `/opt/pw-browsers` meldet Playwright den
 * fehlenden Browser wie bisher. Bewusst nur dieses Verzeichnis, nicht Playwrights eigener Cache:
 * dort hieße ein alter Build nach einem Update „`playwright install`“, nicht „nimm ihn“.
 */
export function fallbackChromiumPath(): string | undefined {
  if (existsSync(chromium.executablePath()) || !existsSync(CLOUD_BROWSER_DIR)) return undefined;
  const candidates = [
    {
      pattern: /^chromium_headless_shell-(\d+)$/,
      file: 'chrome-headless-shell-linux64/chrome-headless-shell',
    },
    { pattern: /^chromium-(\d+)$/, file: 'chrome-linux64/chrome' },
  ];
  const entries = readdirSync(CLOUD_BROWSER_DIR);
  for (const { pattern, file } of candidates) {
    const match = entries
      .map((name) => ({ name, build: Number(pattern.exec(name)?.[1] ?? 0) }))
      .filter(({ name, build }) => build > 0 && existsSync(join(CLOUD_BROWSER_DIR, name, file)))
      .sort((a, b) => b.build - a.build)[0];
    if (match) return join(CLOUD_BROWSER_DIR, match.name, file);
  }
  return undefined;
}
