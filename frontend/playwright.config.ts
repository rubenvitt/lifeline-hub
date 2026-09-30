import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Die Suite ist selbsttragend: `pnpm e2e` startet Backend UND Vite selbst.

const frontendVerzeichnis = fileURLToPath(new URL('.', import.meta.url));
/*
 * Der Pfad zum Backend-Binary — über `cargo metadata`, weil `build.target-dir` bzw.
 * `CARGO_TARGET_DIR` es außerhalb des Worktrees ablegen kann (LFH-518). Dieselbe Frage stellt
 * `scripts/lib/backend-binaer.sh`; im Sammel-Gate kommt ihre Antwort als `PW_BINAER` hier an,
 * sodass Gate und Suite dasselbe Binary nehmen. Gefragt wird hier nur beim alleinstehenden Lauf.
 * Das Ziel je Checkout (`<worktree>/target`) legt `.cargo/config.toml` fest (LFH-520).
 *
 * `PW_BINAER` übersteuert das: ein e2e-Shard der CI lädt das Binary als Artefakt und bräuchte
 * sonst die ganze Rust-Toolchain. Der Präfix `PW_` ist Absicht — ein `LIFELINE_`-Name fiele
 * unter die Env-Hygiene und würde geräumt.
 */
const binaerUeberschrieben = process.env.PW_BINAER;
const binaer = binaerUeberschrieben
  ? resolve(binaerUeberschrieben)
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

/**
 * Reserviert n freie Ports und gibt sie erst frei, wenn ALLE vergeben sind.
 * Nacheinander zu reservieren reicht nicht: nach dem Schließen des ersten Listeners
 * vergibt das OS denselben Port sofort wieder, und Backend und Vite kollidieren.
 * Top-Level-await trägt hier, weil das Paket "type": "module" ist.
 */
async function freiePorts(anzahl: number): Promise<number[]> {
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

// Playwright lädt diese Config in JEDEM Worker-Prozess erneut; ohne Stabilisierung zöge
// jeder Worker eigene Ports und ein eigenes Temp-Verzeichnis und liefe gegen Ports ohne
// Server. Der Hauptprozess entscheidet einmal und vererbt das Ergebnis über die Umgebung.
const ENV_SCHLUESSEL = 'LIFELINE_E2E_LAUF';
const vorbelegt = process.env[ENV_SCHLUESSEL];

// Env-Hygiene wie im Sammel-Gate (scripts/lib/dev-env.sh): Playwright merged webServer.env mit
// process.env, das e2e-Backend erbte sonst die Dev-Umgebung — etwa LIFELINE_TLS (der
// Health-Check auf http:// würde nie grün), LIFELINE_ADMIN_USER (jeder Login scheiterte) oder
// LIFELINE_BACKUP_VERZEICHNIS. Hier statt nur in check-all.sh, damit auch ein alleinstehendes
// `pnpm e2e` sauber läuft.
for (const schluessel of Object.keys(process.env)) {
  // Die eigene Lauf-Variable ist keine Dev-Variable, sondern der Kanal zu den Workern.
  if (schluessel !== ENV_SCHLUESSEL && /^(LIFELINE|KS|AWS)_/.test(schluessel)) {
    delete process.env[schluessel];
  }
}

const lauf: { backendPort: number; frontendPort: number; datenbank: string } = vorbelegt
  ? JSON.parse(vorbelegt)
  : await (async () => {
      const [backendPort, frontendPort] = await freiePorts(2);
      // Temp-DB je Lauf: kein Cleanup im Repo-Baum, die Specs dürfen ihre
      // `Date.now()`-Fixtures behalten.
      const datenbank = join(mkdtempSync(join(tmpdir(), 'lifeline-e2e-')), 'lifeline.db');
      const neu = { backendPort, frontendPort, datenbank };
      process.env[ENV_SCHLUESSEL] = JSON.stringify(neu);
      // Einmal im Hauptprozess, nicht je Worker: welches Backend der Lauf startet, steht damit im
      // Log. Dieselbe Zeile gibt Schritt 7 des Sammel-Gates aus (LFH-520).
      console.log(`Backend-Binary: ${binaer}`);
      return neu;
    })();

const { backendPort, frontendPort, datenbank } = lauf;
const backendUrl = `http://127.0.0.1:${backendPort}`;
// IPv4 durchgängig: Vite bindet ohne --host nur auf [::1], und Playwrights Health-Check gegen
// 127.0.0.1 liefe in den Timeout.
const baseURL = `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: './e2e',
  /**
   * Gedeckelte Worker-Zahl: mit Playwrights Vorgabe (`cpus / 2`) fielen unter Lastdruck
   * wandernde Tests mit Infrastruktur-Signaturen aus (goto-Timeout, ERR_CONNECTION_REFUSED),
   * nie an einer Zusicherung. Keine Toleranz an einer Zusicherung — es laufen nur weniger
   * gleichzeitig. Übersteuerbar: `PW_WORKERS=6 pnpm e2e` auf einer ruhigen Maschine.
   *
   * Der Deckel schützt nur vor der eigenen Last. Auf einer Maschine, die nebenher anderes
   * rechnet (Parallel-Session, Subagent, zweites Gate), liefert die Suite KEINE belastbare
   * Aussage (LFH-398). Gemessen am 29.09.2026 unter Load 40–150 auf 16 Kernen: 14 bzw. 16
   * rote Tests in zwei Läufen, jeweils andere, in 23–26 min statt ~18 min. So sieht das aus,
   * und es sieht nach einem kaputten Frontend aus:
   *   - die Fehler sind überwiegend das Test-Budget („Test timeout of … exceeded" an `goto`,
   *     `fill`, `mouse.move`), dazu `Protocol error … session closed` und
   *     `net::ERR_ABORTED; maybe frame was detached?`;
   *   - die Fehlermenge wandert zwischen Läufen, die Laufzeit liegt weit über der üblichen;
   *   - in der ersten Messung zu LFH-398 zusätzlich: Seiten-Snapshot nur mit dem Knopf „Open
   *     Tanstack query devtools", in der Vite-Ausgabe `Auth-Prüfung fehlgeschlagen NetzFehler:
   *     Keine Verbindung`.
   * Zeigt sich dieses Bild, zuerst die Last prüfen (`uptime`), nicht die Ursache im Code
   * suchen, und auf freier Maschine wiederholen. Eine Zusicherung, die über Läufe gleich rot
   * bleibt, ist dagegen kein Lastrauschen, sondern ein eigener Befund (in beiden Läufen:
   * `kopfzeile-schmal.spec.ts`, LFH-809). Keine Testfrist erhöhen, um Lastfehler zu
   * übertünchen: ein Test, der nur mit mehr Geduld grün wird, misst die Maschine, nicht die
   * Software.
   */
  workers: Number(process.env.PW_WORKERS ?? 3),
  /*
   * Längere Fristen NUR unter `CI`: auf 2-vCPU-Runnern übersetzt der Vite-DEV-Server jedes
   * Modul beim ersten Aufruf, und `page.goto`/`click` überschritten 30 s. Lokal bleiben 30 s,
   * damit ein echt hängender Test schnell auffällt.
   */
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 25_000 : 10_000 },
  /*
   * EIN Wiederholungsversuch, nur unter CI: ein Test, der ZWEIMAL scheitert, bleibt rot — ein
   * deterministisch kaputter Test wird nicht grün gewaschen. Wer hier erhöht, verschiebt die
   * Grenze zwischen „flaky" und „kaputt".
   */
  retries: process.env.CI ? 1 : 0,
  /*
   * Unter CI nimmt Playwright sonst `dot` und schreibt keinen Bericht. `blob`, weil die Suite
   * auf mehrere Runner geteilt wird (`playwright merge-reports` führt sie zu EINEM
   * HTML-Bericht zusammen); `github` schreibt Fehler als Annotationen an die PR-Zeile.
   * Lokal `list`.
   */
  reporter: process.env.CI ? [['blob'], ['github']] : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'Backend',
      // `--kritis-extrakt false`: der KRITIS-Import lüde sonst nach 60 s den
      // Deutschland-Extrakt (mehrere GB je Lauf); die Specs brauchen keinen Bestand.
      command: `${binaer} --db-path ${datenbank} --bind 127.0.0.1:${backendPort} --admin-password e2e-admin-pw --kritis-extrakt false`,
      url: `${backendUrl}/api/health`,
      // Nie einen fremden Server übernehmen: ein laufender Dev-Stack hätte eine andere DB und ein
      // anderes Admin-Passwort.
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      name: 'Frontend',
      // Port als CLI-Argument, nicht über FRONTEND_PORT (steht in der mise-Umgebung auf 5173
      // und gewönne). Vite direkt, weil `pnpm run dev -- --port X` das `--` durchreicht.
      //
      // `--no-turbo-fast-api-calls`: Node 26 (V8 14.6, in jedem 26.x-Release) bricht den
      // Dev-Server gelegentlich mit „Lazy deopt after a fast API call with return value is
      // unsupported" ab (`Buffer.byteLength` beim Ausliefern eines großen vorgebündelten
      // Moduls); alle Folgetests liefen dann in ERR_CONNECTION_REFUSED. Der Schalter ist eine
      // V8-Option und in NODE_OPTIONS verboten, deshalb startet der Befehl Node selbst
      // (`process.execPath`, dieselbe gepinnte Version).
      command: `"${process.execPath}" --no-turbo-fast-api-calls node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: baseURL,
      // Proxy-Ziel auf unser Test-Backend umbiegen (vite.config.ts liest die Variable,
      // process.env hat dort Vorrang vor .env.local).
      env: { LIFELINE_BACKEND_URL: backendUrl },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
