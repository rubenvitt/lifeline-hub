import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leseAnteil, verteile } from '../scripts/e2e-anteile.mjs';
import { backendBinaer, freiePorts, umgebungRaeumen, viteServer } from './e2e/lauf-kern';

// Die Suite ist selbsttragend: `pnpm e2e` startet Backend UND Vite selbst.

const frontendVerzeichnis = fileURLToPath(new URL('.', import.meta.url));
// Binary aus `PW_BINAER` oder `cargo metadata`, geprüft auf Dasein und Ausführbarkeit; Herleitung
// in `e2e/lauf-kern.ts` (geteilt mit dem Bildlauf der Anwenderdoku, `playwright.doku.config.ts`).
const binaer = backendBinaer(frontendVerzeichnis);

// Playwright lädt diese Config in JEDEM Worker-Prozess erneut; ohne Stabilisierung zöge
// jeder Worker eigene Ports und ein eigenes Temp-Verzeichnis und liefe gegen Ports ohne
// Server. Der Hauptprozess entscheidet einmal und vererbt das Ergebnis über die Umgebung.
const ENV_SCHLUESSEL = 'LIFELINE_E2E_LAUF';
const vorbelegt = process.env[ENV_SCHLUESSEL];

// Env-Hygiene wie im Sammel-Gate (Herleitung in `e2e/lauf-kern.ts`).
umgebungRaeumen(ENV_SCHLUESSEL);

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

/*
 * Firefox und WebKit fahren NUR die Druck-Specs (LFH-729): der Druck soll in allen drei Browsern
 * halten, und dort prüfen sie, ob ihre CSS-Engine die Druckmechanik unter Druckmedium genauso
 * anwendet (`:has()`, komplexe `:not()`, Wurzel im Fluss). Den Seitenumbruch selbst zeigt nur
 * `page.pdf()`, und das gibt es nur in Chromium — die Specs fragen dafür `browserName`.
 * Eine weitere Druck-Spec kommt hier hinein, nicht als eigenes Projekt. Die Druckfälle von
 * Meldebild, Funkplan und Führungsorganisation stehen deshalb in eigenen `*-druck.spec.ts`
 * (Hilfen in `*-kern.ts`): sonst liefe jeweils die ganze Spec dreifach (LFH-915). Die CI fährt
 * alle drei Projekte in jedem der vier Pflicht-Shards (`.github/workflows/ci.yml`); in welchem
 * Anteil die Firefox- und WebKit-Fälle landen, entscheidet die Verteilung unten. Lokal wählt
 * `PW_PROJEKTE` in `scripts/check-all.sh` eine Teilmenge.
 */
const DRUCK_SPECS =
  /\/(druck-fluss|etb-druck|fernmeldeskizze-druck|meldebild-druck|funkplan-druck|fuehrungsorganisation-druck|dokument-anlage-druck|hilfe-druck|einsatzbericht-deckel-druck)\.spec\.ts$/;

/*
 * ANTEILE NACH LAUFZEIT (LFH-1117): `PW_SHARD=k/n` wählt die Spec-Dateien des Anteils k, verteilt
 * nach den Messwerten in `e2e/laufzeiten.json` (`scripts/e2e-anteile.mjs`). Playwrights eigenes
 * `--shard` schneidet nach Testzahl in Dateireihenfolge, und die langsamen Layout-Gates stehen
 * alphabetisch beieinander: e2e 2/4 brauchte 33–36 min, die übrigen 19–26. Eine Datei ohne
 * Messwert zählt mit dem Median; die Tabelle frischt der Job „Testberichte zusammenführen" auf.
 * Die Rechnung ist deterministisch, jeder Worker-Prozess kommt auf dieselbe Menge.
 */
const SPEC_DATEI = /\.spec\.ts$/;
const anteilText = process.env.PW_SHARD;
const anteil = anteilText ? leseAnteil(anteilText) : undefined;
if (anteil && !vorbelegt && process.argv.some((a) => a.startsWith('--shard'))) {
  // Beides zusammen schnitte die Teilmenge ein zweites Mal: Tests fielen still heraus.
  throw new Error('PW_SHARD und --shard schließen sich aus; PW_SHARD verteilt nach Laufzeit.');
}
const projektMuster: Record<string, RegExp | undefined> = {
  chromium: undefined,
  firefox: DRUCK_SPECS,
  webkit: DRUCK_SPECS,
};
const anteilDateien: Record<string, string[]> | undefined = anteil
  ? (() => {
      const testDir = join(frontendVerzeichnis, 'e2e');
      const dateien = (readdirSync(testDir, { recursive: true }) as string[])
        .map((d) => d.split(sep).join('/'))
        .filter((d) => SPEC_DATEI.test(d));
      const einheiten = Object.entries(projektMuster).flatMap(([projekt, muster]) =>
        dateien.filter((d) => !muster || muster.test(`/${d}`)).map((datei) => ({ projekt, datei })),
      );
      const laufzeiten = JSON.parse(readFileSync(join(testDir, 'laufzeiten.json'), 'utf8'));
      const meine = verteile(einheiten, laufzeiten, anteil.gesamt)[anteil.nummer - 1];
      return Object.fromEntries(
        Object.keys(projektMuster).map((projekt) => [
          projekt,
          meine.filter((e) => e.projekt === projekt).map((e) => e.datei),
        ]),
      );
    })()
  : undefined;

/** Ohne Anteil das Muster des Projekts, mit Anteil genau dessen Dateien (leer: keine). */
function testMatch(projekt: string): RegExp | undefined {
  if (!anteilDateien) return projektMuster[projekt];
  const dateien = anteilDateien[projekt];
  if (dateien.length === 0) return /(?!)/;
  const flucht = (d: string) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`/(?:${dateien.map(flucht).join('|')})$`);
}

const { backendPort, frontendPort, datenbank } = lauf;
const backendUrl = `http://127.0.0.1:${backendPort}`;
// IPv4 durchgängig: Vite bindet ohne --host nur auf [::1], und Playwrights Health-Check gegen
// 127.0.0.1 liefe in den Timeout.
const baseURL = `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: './e2e',
  // Der Bildlauf der Anwenderdoku hat seine eigene Konfiguration (`playwright.doku.config.ts`,
  // LFH-1128): er spielt Demo-Daten ein, die jede Spec hier sähe. Seine Dateien heißen
  // `*.bilder.ts` und träfen das Spec-Muster ohnehin nicht; der Ausschluss hält das fest.
  testIgnore: '**/doku-bilder/**',
  // Standard-Rufname des Admins für die ETB-Erfassung (LFH-894); läuft nach den Webservern.
  globalSetup: './e2e/globale-vorbereitung.ts',
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
  // Der Name trägt den Anteil wie bei `--shard` (`report-2.zip`): ohne ihn hießen alle vier
  // `report.zip` und überschrieben sich beim Einsammeln.
  reporter: process.env.CI
    ? [['blob', anteil ? { fileName: `report-${anteil.nummer}.zip` } : {}], ['github']]
    : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', testMatch: testMatch('chromium'), use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testMatch: testMatch('firefox'), use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: testMatch('webkit'), use: { ...devices['Desktop Safari'] } },
  ],
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
    // Vite-Dev-Server samt Node-26-Schutz (Herleitung in `e2e/lauf-kern.ts`, LFH-659).
    viteServer(frontendPort, backendUrl),
  ],
});
