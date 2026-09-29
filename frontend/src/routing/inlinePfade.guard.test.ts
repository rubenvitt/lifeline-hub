import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Kein Inline-Template-Literal für Einsatzpfade.
 *
 * Der Guard scannt QUELLTEXT: ein geänderter Pfad bricht nichts sichtbar, er führt bloß
 * woanders hin. Gescopt auf die zwei Verzeichnisse des Navigationsrahmens; repoweit wäre er
 * rot geboren.
 *
 * Was er NICHT sieht (Teil des Vertrags):
 *  - Pfade, die über eine Variable zusammengesetzt werden (`const p = '/einsaetze/' + id`)
 *  - Pfade in anderen Verzeichnissen
 *  - Test-Dateien (dort sind Literale die ehrlichere Erwartung)
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
    const treffer = WURZELN.flatMap(dateien).filter((datei) =>
      VERBOTEN.test(readFileSync(datei, 'utf8')),
    );
    expect(treffer, 'Builder aus routing/deeplinks.ts benutzen').toEqual([]);
  });
});
