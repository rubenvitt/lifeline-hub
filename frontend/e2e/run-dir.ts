import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Das Lauf-Verzeichnis der Playwright-Läufe (LLH-1666, Spec `e2e-lauf-aufraeumen`): DB und
 * `karten/` des Backends (`default_karten_dir` in `src/config.rs`) liegen je Lauf in einem
 * eigenen Temp-Verzeichnis. Auf den Wegwerf-Runnern von GitHub war ein vergessenes Verzeichnis
 * egal; auf dem eigenen Runner und auf jedem Laptop füllte es mit jedem Lauf die Platte.
 *
 * Ohne Playwright-Import, damit der Selbsttest (`scripts/e2e-run-dir.test.mjs`, Schritt 11 des
 * Gates) es mit nacktem Node lädt.
 */

/** Ab diesem Alter gilt ein Lauf-Verzeichnis als verwaist: kein Lauf dauert einen Tag. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type RunDirOptions = {
  /** Wo die Verzeichnisse liegen; Vorgabe das Temp-Verzeichnis des Systems. */
  baseDir?: string;
  /** Nur für den Selbsttest: den Fehlerpfad des Löschens auslösen. */
  remove?: (path: string) => void;
};

const removeRecursive = (path: string) => rmSync(path, { recursive: true, force: true });

/**
 * Legt das Lauf-Verzeichnis an. Vorher räumt es verwaiste Verzeichnisse desselben Präfixes ab,
 * die abgebrochene Läufe hinterlassen haben (älter als 24 h). Jüngere bleiben: ein paralleler
 * Lauf (anderer Worktree, anderer Anteil) benutzt sie gerade. Was sich nicht löschen lässt, wird
 * eine Warnung, kein Abbruch.
 */
export function createRunDir(prefix: string, options: RunDirOptions = {}): string {
  const baseDir = options.baseDir ?? tmpdir();
  const remove = options.remove ?? removeRecursive;
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const name of readdirSync(baseDir)) {
    if (!name.startsWith(prefix)) continue;
    const path = join(baseDir, name);
    try {
      const stat = statSync(path);
      if (!stat.isDirectory() || stat.mtimeMs >= cutoff) continue;
      remove(path);
    } catch (error) {
      console.warn(`Verwaistes Lauf-Verzeichnis nicht gelöscht: ${path} (${String(error)})`);
    }
  }
  return mkdtempSync(join(baseDir, prefix));
}

/**
 * Löscht das Verzeichnis des Laufs, dessen DB-Pfad die Konfiguration über `envKey` an die Worker
 * vererbt hat. Für `globalTeardown`: Playwright ruft es auch nach roten Tests und beendet die
 * Webserver erst danach; die offene DB zu löschen schadet dem Backend unter Linux und macOS
 * nicht. Ohne Variable tut es nichts. Ein Pfad außerhalb von `baseDir` bleibt stehen (Warnung):
 * die Variable kommt aus der Umgebung, und ein falscher Wert soll nichts Fremdes löschen.
 */
export function deleteRunDir(envKey: string, options: Pick<RunDirOptions, 'baseDir'> = {}) {
  const value = process.env[envKey];
  if (!value) return;
  const { datenbank } = JSON.parse(value) as { datenbank: string };
  const runDir = dirname(resolve(datenbank));
  const baseDir = resolve(options.baseDir ?? tmpdir());
  if (dirname(runDir) !== baseDir) {
    console.warn(`Lauf-Verzeichnis liegt nicht unter ${baseDir}, bleibt stehen: ${runDir}`);
    return;
  }
  removeRecursive(runDir);
}
