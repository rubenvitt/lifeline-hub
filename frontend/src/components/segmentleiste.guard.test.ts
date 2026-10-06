/**
 * Segmentleisten-Guard (LFH-973): ein Umschalter zwischen Sichten ist die `Segmentleiste`, nicht
 * antds `Segmented` (`frontend/AGENTS.md`, Gestaltungssprache).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * `Segmented` setzt `aria-label="segmented control"` fest; ein Screenreader liest den englischen
 * Rest statt der Beschriftung vor. Optik und Tastaturbedienung weichen zudem von der
 * Segmentleiste der übrigen Seiten ab.
 *
 * ── Was er zählt ────────────────────────────────────────────────────────────────
 * Einen Import von `Segmented` aus `antd` in einer Quelldatei unter `src/`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Ausnahmen MIT Grund am Eintrag. Ein Eintrag ohne Fund ist tot und färbt den Guard rot.
 */
const AUSNAHMEN: Record<string, string> = {
  '/src/etb/BuchstabierHilfe.tsx':
    'Wahl der Buchstabiertafel im Popover der Eingabehilfe, keine Sicht einer Seite; bei der ' +
    'Umstellung des Meldebilds ausdrücklich ausgenommen, eigener Umbau steht aus.',
};

function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (/\.tsx?$/.test(eintrag.name) && !/\.test\.tsx?$/.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/** Importiert die Datei `Segmented` aus antd? */
export function importiertSegmented(quelle: string): boolean {
  return /import\s*\{[^}]*\bSegmented\b[^}]*\}\s*from\s*['"]antd['"]/.test(quelle);
}

describe('Segmentleisten-Guard (LFH-973)', () => {
  const quellen = lieseQuellen(SRC);
  const funde = Object.entries(quellen)
    .filter(([, inhalt]) => importiertSegmented(inhalt))
    .map(([pfad]) => pfad);

  it('kein Import von antds Segmented außerhalb der Ausnahmen', () => {
    expect(funde.filter((pfad) => !(pfad in AUSNAHMEN))).toEqual([]);
  });

  it('jede Ausnahme hat einen Fund', () => {
    expect(Object.keys(AUSNAHMEN).filter((pfad) => !funde.includes(pfad))).toEqual([]);
  });

  it('erkennt den Import auch mitten in einer Liste und über Zeilen', () => {
    expect(importiertSegmented("import { Button, Segmented, Space } from 'antd';")).toBe(true);
    expect(importiertSegmented("import {\n  Input,\n  Segmented,\n} from 'antd';")).toBe(true);
    expect(importiertSegmented("import Segmentleiste from './instrument/Segmentleiste';")).toBe(
      false,
    );
    expect(importiertSegmented("import { SegmentedProps } from 'antd';")).toBe(false);
  });
});
