import { readFileSync } from 'node:fs';
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
 * Geprüft wird die Quelle über den TS-Syntaxbaum. Nicht gesehen: Kamera-Aufrufe über eine
 * Variable mit anderem Namen als Methode (`const f = map.flyTo`) und Dateien außerhalb von
 * `DATEIEN` — die Lagekarte bewegt die Kamera nur hier.
 */

const hier = dirname(fileURLToPath(import.meta.url));
const DATEIEN = ['Kartenflaeche.tsx', 'kamera.ts'];

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
  const funde: { zeile: number; methode: string; markiert: boolean }[] = [];
  const besuche = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      KAMERA.has(n.expression.name.text)
    ) {
      const letztes = n.arguments[n.arguments.length - 1];
      funde.push({
        zeile: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        methode: n.expression.name.text,
        markiert: letztes != null && ts.isIdentifier(letztes) && MARKEN.has(letztes.text),
      });
    }
    ts.forEachChild(n, besuche);
  };
  besuche(sf);
  return funde;
}

describe('Kamera-Aufrufe tragen ihre Herkunft (LFH-766)', () => {
  it.each(DATEIEN)('%s: jeder Aufruf endet mit BEDIENUNG oder AUTOMATISCH', (datei) => {
    const funde = kameraAufrufe(datei);
    expect(funde.length).toBeGreaterThan(0);
    expect(funde.filter((f) => !f.markiert)).toEqual([]);
  });
});
