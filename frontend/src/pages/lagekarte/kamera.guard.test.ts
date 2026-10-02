import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Jeder Kamera-Aufruf der Lagekarte sagt, wer bewegt (LFH-766, D2 in
 * `openspec/changes/lfh-766-eigenposition-anflug-genauigkeit/design.md`): letztes Argument ist
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

function kameraAufrufe(datei: string) {
  const quelle = readFileSync(join(hier, datei), 'utf8');
  const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const funde: { datei: string; zeile: number; methode: string; marke: string | null }[] = [];
  const besuche = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      KAMERA.has(n.expression.name.text)
    ) {
      const letztes = n.arguments[n.arguments.length - 1];
      const marke =
        letztes != null && ts.isIdentifier(letztes) && MARKEN.has(letztes.text)
          ? letztes.text
          : null;
      const automatischErlaubt =
        datei === 'kamera.ts' || (n.arguments[0]?.getText(sf).includes('startAnsicht') ?? false);
      funde.push({
        datei,
        zeile: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        methode: n.expression.name.text,
        // Was hier stehen muss — die gefundene Marke wird daran gemessen.
        marke: marke === (automatischErlaubt ? 'AUTOMATISCH' : 'BEDIENUNG') ? 'passt' : marke,
      });
    }
    ts.forEachChild(n, besuche);
  };
  besuche(sf);
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
