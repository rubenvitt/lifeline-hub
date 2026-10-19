import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generateDesignSystem,
  isForeign,
  PROJECT_DIR,
  type DesignSystemFiles,
} from '../scripts/design-system/generate';

/**
 * Wächter des Design Systems „Lifeline Hub“ (Change `uzfj5f43-design-system-aus-code`,
 * design.md D5, Spec `design-system-artifact`, „Drift ist im Gate rot“).
 *
 * `docs/design/design-system/project/` ist erzeugt: Tokens aus `theme/tokens.ts`, README aus
 * `frontend/AGENTS.md`, Vorschauen aus den echten Bausteinen. Der Test erzeugt alles im Speicher
 * neu und vergleicht Datei für Datei, Byte für Byte, auch die Vorschauen: die Ausgabe ist
 * deterministisch (zwei Läufe gleich, gemessen; antds Klassen-Hash hängt am Theme und an der
 * antd-Version, ein antd-Update erzeugt die Vorschauen also mit neu). Dateien, die das
 * Veröffentlichen oder die Seite des Artifacts schreiben (`design-system.json`, `tokens.css`,
 * `manifest.json`, `api/`), sind ausgenommen.
 *
 * Schlägt er fehl: `mise exec -- pnpm -C frontend design-system` und die Ausgabe mitcommitten.
 * Dieser Befehl startet dieselbe Datei im Schreibmodus (`DESIGN_SYSTEM_WRITE=1`).
 *
 * Mutationsprobe (19.10.2026): `farbenDunkel.text2` von `#c6ccd2` auf `#c6ccd3` gesetzt, ohne
 * neu zu erzeugen → rot mit `tokens.json` und den Vorschauen, die `text2` lesen; zurückgesetzt →
 * grün. Ebenso eine Zeile in der Regel „Gesperrt trägt die Sperre ohne Farbe“ in
 * `frontend/AGENTS.md` → rot mit `README.md` und `components/Gesperrt/README.md`.
 */

const WRITE = process.env.DESIGN_SYSTEM_WRITE === '1';
const COMMAND = 'mise exec -- pnpm -C frontend design-system';

/** Alle Dateien unter `dir`, relativ und mit `/`, ohne die fremden. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .filter((path) => !isForeign(path))
    .sort();
}

const asBytes = (content: string | Uint8Array) =>
  typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);

/** Abweichungen zwischen Erzeugtem und Eingechecktem, je Datei eine Zeile. */
function compare(files: DesignSystemFiles): string[] {
  const findings: string[] = [];
  const checkedIn = new Set(listFiles(PROJECT_DIR));
  for (const [path, content] of files) {
    if (!checkedIn.has(path)) findings.push(`fehlt: ${path}`);
    else if (!asBytes(content).equals(readFileSync(join(PROJECT_DIR, path)))) {
      findings.push(`veraltet: ${path}`);
    }
    checkedIn.delete(path);
  }
  for (const path of checkedIn) findings.push(`überzählig: ${path}`);
  return findings;
}

function write(files: DesignSystemFiles): void {
  for (const path of listFiles(PROJECT_DIR)) {
    if (!files.has(path)) rmSync(join(PROJECT_DIR, path));
  }
  for (const [path, content] of files) {
    const target = join(PROJECT_DIR, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, asBytes(content));
  }
}

describe('Design System „Lifeline Hub“', () => {
  it.runIf(WRITE)(
    'schreibt das Erzeugte nach docs/design/design-system/project/',
    async () => {
      write(await generateDesignSystem());
    },
    120_000,
  );

  it.skipIf(WRITE)(
    'liegt so im Repo, wie der Generator es aus dem Code erzeugt',
    async () => {
      const findings = compare(await generateDesignSystem());
      expect(
        findings,
        `Das Design System ist nicht aktuell. Neu erzeugen mit \`${COMMAND}\` und mitcommitten.`,
      ).toEqual([]);
    },
    120_000,
  );
});
