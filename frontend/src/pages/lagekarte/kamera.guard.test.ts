import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type AstKnoten, parseQuelltext, textVon, walk, zeileVon } from '../../lib/quelltextAst';

/**
 * Jeder Kamera-Aufruf der Lagekarte sagt, wer bewegt (LFH-766, D2 in
 * `openspec/changes/archive/2026-10-02-lfh-766-eigenposition-anflug-genauigkeit/design.md`): letztes Argument ist
 * `BEDIENUNG` oder `AUTOMATISCH` aus `kamera.ts`. Fehlt die Markierung an einem Bedienweg, flöge
 * die Eigenposition nach einer Bedienung doch noch an.
 *
 * `AUTOMATISCH` ist nur dort erlaubt, wo die Karte von sich aus fliegt: der Eigenpositions-Anflug
 * in `kamera.ts` und die Startansicht (Aufruf mit `startAnsicht` im ersten Argument). Jeder andere
 * Aufruf ist ein Bedienweg und trägt `BEDIENUNG` — so fällt auch eine vertauschte Marke auf.
 *
 * Geprüft wird die Quelle über den TS-Syntaxbaum, über alle Quelldateien der Lagekarte und die
 * Seite. Nicht gesehen: Kamera-Aufrufe über eine Variable mit anderem Namen als Methode
 * (`const f = map.flyTo`).
 */

const hier = dirname(fileURLToPath(import.meta.url));
const DATEIEN = [
  ...readdirSync(hier).filter(
    (d) => /\.tsx?$/.test(d) && !/\.test\.tsx?$/.test(d) && !d.endsWith('.d.ts'),
  ),
  '../LagekartePage.tsx',
];

/** Alle Kamera-Methoden von MapLibre, die `movestart` auslösen. */
const KAMERA = new Set([
  'flyTo',
  'easeTo',
  'jumpTo',
  'fitBounds',
  'fitScreenCoordinates',
  'zoomIn',
  'zoomOut',
  'zoomTo',
  'panBy',
  'panTo',
  'rotateTo',
  'resetNorth',
  'resetNorthPitch',
  'snapToNorth',
  'setCenter',
  'setZoom',
  'setBearing',
  'setPitch',
]);
const MARKEN = new Set(['BEDIENUNG', 'AUTOMATISCH']);

export function kameraAufrufe(datei: string) {
  const quelle = readFileSync(join(hier, datei), 'utf8');
  const funde: { datei: string; zeile: number; methode: string; marke: string | null }[] = [];
  walk(parseQuelltext(datei, quelle), (n) => {
    if (n.type !== 'CallExpression') return;
    const callee = n.callee as AstKnoten;
    const eigenschaft = callee.property as AstKnoten | undefined;
    if (
      callee.type !== 'MemberExpression' ||
      callee.computed ||
      eigenschaft?.type !== 'Identifier' ||
      !KAMERA.has(eigenschaft.name as string)
    )
      return;
    const argumente = n.arguments as AstKnoten[];
    const letztes = argumente[argumente.length - 1];
    const marke =
      letztes != null && letztes.type === 'Identifier' && MARKEN.has(letztes.name as string)
        ? (letztes.name as string)
        : null;
    const automatischErlaubt =
      datei === 'kamera.ts' ||
      (argumente[0] != null && textVon(quelle, argumente[0]).includes('startAnsicht'));
    funde.push({
      datei,
      zeile: zeileVon(quelle, n.start),
      methode: eigenschaft.name as string,
      // Was hier stehen muss — die gefundene Marke wird daran gemessen.
      marke: marke === (automatischErlaubt ? 'AUTOMATISCH' : 'BEDIENUNG') ? 'passt' : marke,
    });
  });
  return funde;
}

describe('Kamera-Aufrufe tragen ihre Herkunft (LFH-766)', () => {
  it('jeder Aufruf endet mit der passenden Marke', () => {
    const funde = DATEIEN.flatMap(kameraAufrufe);
    // Sähe der Scan die Karte nicht mehr, wäre er still grün.
    expect(funde.filter((f) => f.datei === 'Kartenflaeche.tsx').length).toBeGreaterThanOrEqual(10);
    expect(funde.filter((f) => f.marke !== 'passt')).toEqual([]);
  });
});
