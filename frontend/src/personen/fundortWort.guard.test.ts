import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';

/**
 * Ein Wort für `antreff_ort`: „Fundort“ (LLH-1130, Entscheidung Ruben 18.10.2026; Change
 * `n08alz2v-betroffenenliste-zeilenaktionen`, design.md D7). Dasselbe Feld trug „Fundort“ und
 * „Antreffort“, bei Personen wie bei Tieren. Wire-Feld und Spalte bleiben `antreff_ort`; geprüft
 * wird nur, was Menschen lesen, und die Kommentare, die die Oberfläche beschreiben.
 *
 * Ausgenommen sind Tests und die aus dem Server erzeugten Typen (`api/types.generated.ts`): deren
 * Doku-Kommentare stammen aus dem Backend.
 */
const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    try {
      if (statSync(resolve(process.cwd(), kandidat, 'personen')).isDirectory()) {
        return resolve(process.cwd(), kandidat);
      }
    } catch {
      // nächster Kandidat
    }
  }
  throw new Error(`src/ nicht gefunden (cwd: ${process.cwd()})`);
})();

const AUSGENOMMEN = new Set(['api/types.generated.ts']);

function quelldateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) return quelldateien(pfad);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [pfad] : [];
  });
}

/** Dateien, die das alte Wort tragen (Code wie Kommentar). */
export function antreffortBefunde(dateien: Record<string, string>): string[] {
  return Object.entries(dateien)
    .filter(([pfad]) => !/\.test\.tsx?$/.test(pfad) && !AUSGENOMMEN.has(pfad))
    .filter(([, inhalt]) => /Antreffort/i.test(inhalt))
    .map(([pfad]) => pfad);
}

/**
 * Die Orte, an denen das Feld sichtbar steht: Maske, Detail, Liste, Druck, Vorschau, die
 * Aufbewahrungstexte und die Tier-Seiten. Jeder trägt „Fundort“ im Code, nicht nur im Kommentar.
 */
const FUNDORT_ORTE = [
  'personen/AufnahmeFelder.tsx',
  'pages/PersonenDetailPage.tsx',
  'personen/personenSpalten.tsx',
  'personen/PersonenDruckTabelle.tsx',
  'personen/PersonVorschau.tsx',
  'aufbewahrung/kategorieText.ts',
  'pages/TierePage.tsx',
  'pages/TiereDetailPage.tsx',
  'pages/tiere/TiereDruckTabelle.tsx',
] as const;

describe('Ein Wort „Fundort“ für antreff_ort (LLH-1130)', () => {
  it('kein Quelltext unter src/ sagt „Antreffort“', () => {
    const dateien: Record<string, string> = {};
    for (const pfad of quelldateien(SRC)) {
      dateien[relative(SRC, pfad).split('\\').join('/')] = readFileSync(pfad, 'utf8');
    }
    expect(antreffortBefunde(dateien)).toEqual([]);
  });

  it.each(FUNDORT_ORTE)('%s zeigt „Fundort“', (pfad) => {
    const code = ohneKommentare(readFileSync(join(SRC, pfad), 'utf8')).join('\n');
    expect(code).toMatch(/Fundort/);
  });

  it('erkennt das alte Wort und lässt Tests und erzeugte Typen aus (Selbstbeweis)', () => {
    expect(
      antreffortBefunde({
        'x.tsx': "<Form.Item label='Antreffort' />",
        'y.ts': '/** Einsatzgrenze des sitzungsweiten Antrefforts. */',
        'z.test.tsx': "getByLabelText('Antreffort')",
        'api/types.generated.ts': 'Adresse, Antreffort, Zustand',
        'w.tsx': "<Form.Item label='Fundort' />",
      }),
    ).toEqual(['x.tsx', 'y.ts']);
  });
});
