import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Kein Inline-Template-Literal für Einsatzpfade (LFH-337 · M9).
 *
 * Der Guard scannt QUELLTEXT, nicht Laufzeitverhalten: ein geänderter Pfad bricht
 * nichts sichtbar, er führt bloß woanders hin. Bewusst auf die zwei Verzeichnisse
 * des Navigationsrahmens gescopt — dieselbe Scoping-Begründung wie bei
 * `components/aktionsabstand.guard.test.ts`: ein repoweiter Scan wäre rot geboren
 * und würde abgeschaltet statt befolgt.
 *
 * Was er NICHT sieht (Teil des Vertrags, nicht Beiwerk):
 *  - Pfade, die über eine Variable zusammengesetzt werden (`const p = '/einsaetze/' + id`)
 *  - Pfade in anderen Verzeichnissen
 *  - Test-Dateien (bewusst ausgenommen: dort sind Literale die ehrlichere Erwartung)
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const WURZELN = [join(SRC, 'einsatz'), join(SRC, 'command-palette')];
const VERBOTEN = /\/einsaetze\/\$\{/;

function dateien(pfad: string): string[] {
  return readdirSync(pfad).flatMap((eintrag) => {
    const voll = join(pfad, eintrag);
    if (statSync(voll).isDirectory()) return dateien(voll);
    if (!/\.tsx?$/.test(eintrag) || /\.test\.tsx?$/.test(eintrag)) return [];
    return [voll];
  });
}

describe('Einsatzpfade im Navigationsrahmen', () => {
  it('baut keinen Pfad als Inline-Template-Literal', () => {
    const treffer = WURZELN.flatMap(dateien)
      .filter((datei) => VERBOTEN.test(readFileSync(datei, 'utf8')));
    expect(treffer, 'Builder aus routing/deeplinks.ts benutzen').toEqual([]);
  });
});
