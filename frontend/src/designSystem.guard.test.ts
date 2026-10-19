import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generateDesignSystem,
  isForeign,
  PROJECT_DIR,
  type DesignSystemFiles,
} from '../scripts/design-system/generate';
import { checkOutput, listFiles } from '../scripts/design-system/output';
import { DESIGN_SYSTEM_COMMAND } from '../scripts/design-system/readme';

/**
 * Wächter des Design Systems „Lifeline Hub“ (Change `uzfj5f43-design-system-aus-code`,
 * design.md D5, Spec `design-system-artifact`, „Drift ist im Gate rot“).
 *
 * `docs/design/design-system/project/` ist erzeugt: Tokens aus `theme/tokens.ts`, README aus
 * `frontend/AGENTS.md`, Vorschauen aus den echten Bausteinen. Der Test erzeugt alles im Speicher
 * neu und vergleicht Datei für Datei, Byte für Byte, auch die Vorschauen: die Ausgabe ist
 * deterministisch (zwei Läufe gleich, gemessen). Einen Klassen-Hash gibt es nicht (`hashed: false`,
 * feste `cssVar`-Schlüssel je Thema); das antd-CSS hängt an der antd-Version, ein antd-Update
 * erzeugt die Vorschauen also mit neu. Dateien, die das Veröffentlichen oder die Seite des
 * Artifacts schreiben (`design-system.json`, `tokens.css`, `manifest.json`, `api/`), und
 * Punktdateien (`.DS_Store`) sind ausgenommen.
 *
 * Daneben prüft er, was ein Byte-Vergleich nicht sieht, weil auch eine falsche Ausgabe
 * deterministisch ist (`output.ts`, `checkOutput`): antd-CSS und Schriften in jeder Vorschau, den
 * ersten Satz der Baustein-READMEs und die Grenzen des Artifact-Typs.
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

/** Einmal erzeugt je Lauf; alle Prüfungen lesen dieselbe Ausgabe. */
let generated: Promise<DesignSystemFiles> | undefined;
const generate = () => (generated ??= generateDesignSystem());

/** Die eingecheckten Dateien ohne die fremden. */
const listCheckedIn = () => listFiles(PROJECT_DIR).filter((path) => !isForeign(path));

const asBytes = (content: string | Uint8Array) =>
  typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);

/** Abweichungen zwischen Erzeugtem und Eingechecktem, je Datei eine Zeile. */
function compare(files: DesignSystemFiles): string[] {
  const findings: string[] = [];
  const checkedIn = new Set(listCheckedIn());
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
  for (const path of listCheckedIn()) {
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
      write(await generate());
    },
    120_000,
  );

  it.skipIf(WRITE)(
    'liegt so im Repo, wie der Generator es aus dem Code erzeugt',
    async () => {
      const findings = compare(await generate());
      expect(
        findings,
        `Das Design System ist nicht aktuell. Neu erzeugen mit \`${DESIGN_SYSTEM_COMMAND}\` und mitcommitten.`,
      ).toEqual([]);
    },
    120_000,
  );

  it('trägt in jeder Vorschau antd-CSS und Schriften und hält die Grenzen des Artifact-Typs', async () => {
    expect(checkOutput(await generate())).toEqual([]);
  }, 120_000);
});
