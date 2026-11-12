import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  /**
   * Das Verzeichnis beim Ende dieses Prozesses löschen. Nur im Hauptprozess setzen, der es
   * anlegt: die Worker erben den Pfad und dürfen es nicht vor ihm wegräumen.
   */
  deleteOnExit?: boolean;
  /** Nur für den Selbsttest: den Fehlerpfad des Löschens auslösen. */
  remove?: (path: string) => void;
};

const removeRecursive = (path: string) => rmSync(path, { recursive: true, force: true });

/**
 * Legt das Lauf-Verzeichnis an. Vorher räumt es verwaiste Verzeichnisse desselben Präfixes ab,
 * die hart beendete Läufe hinterlassen haben (älter als 24 h). Jüngere bleiben: ein paralleler
 * Lauf (anderer Worktree, anderer Anteil) benutzt sie gerade. Was sich nicht löschen lässt, wird
 * eine Warnung, kein Abbruch.
 *
 * Mit `deleteOnExit` löscht der Prozess das Verzeichnis bei seinem Ende, synchron im
 * `exit`-Ereignis. Das greift bei grünem und rotem Lauf, aber auch, wenn schon der Webserver nicht
 * startet, die Config wirft oder nur `--list` läuft; ein `globalTeardown` liefe dort nicht.
 * Playwright beendet Backend und Vite vorher. Nur ein hart getöteter Prozess (SIGKILL)
 * hinterlässt etwas, das räumt der nächste Lauf.
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
  const runDir = mkdtempSync(join(baseDir, prefix));
  if (options.deleteOnExit) process.on('exit', () => removeRecursive(runDir));
  return runDir;
}
