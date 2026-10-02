import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ZEICHNUNG_PRAEFIX } from './eigenpositionLayer';

/**
 * Jede terra-draw-Instanz der Lagekarte trägt einen `prefixId`, der mit `td-` beginnt (LFH-766,
 * D3 in `openspec/changes/archive/2026-10-02-lfh-766-eigenposition-anflug-genauigkeit/design.md`): daran legt sich
 * die Eigenposition unter die laufende Zeichnung. Ein Präfix ohne `td-` ließe den Punkt wieder die
 * Stützpunkte verdecken.
 *
 * Geprüft wird die Quelle über den TS-Syntaxbaum, an drei Stellen: `prefixId:` am Adapter, der
 * Vorgabewert des Parameters `praefix` von `createZeichnung` und das Präfix-Argument jedes
 * `createZeichnung`-Aufrufs. Ein Wert, der kein Zeichenketten-Literal ist, gilt als Befund — außer
 * dem Durchreichen von `praefix` in `zeichnen.ts`, dessen Quellen die beiden anderen Stellen sind.
 */

const hier = dirname(fileURLToPath(import.meta.url));
const DATEIEN = readdirSync(hier).filter(
  (d) => /\.tsx?$/.test(d) && !/\.test\.tsx?$/.test(d) && !d.endsWith('.d.ts'),
);
const PRAEFIX_ARGUMENT = 3;

type Fund = { datei: string; zeile: number; wert: string | null };

function praefixe(): Fund[] {
  const funde: Fund[] = [];
  for (const datei of DATEIEN) {
    const quelle = readFileSync(join(hier, datei), 'utf8');
    if (!quelle.includes('prefixId') && !quelle.includes('createZeichnung')) continue;
    const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const melde = (knoten: ts.Node, wert: ts.Expression | undefined) => {
      if (!wert) return;
      const zeile = sf.getLineAndCharacterOfPosition(knoten.getStart()).line + 1;
      if (ts.isStringLiteralLike(wert)) funde.push({ datei, zeile, wert: wert.text });
      else if (!(datei === 'zeichnen.ts' && ts.isIdentifier(wert) && wert.text === 'praefix'))
        funde.push({ datei, zeile, wert: null });
    };
    const besuche = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'prefixId') melde(n, n.initializer);
      if (
        ts.isParameter(n) &&
        n.name.getText(sf) === 'praefix' &&
        ts.isFunctionDeclaration(n.parent) &&
        n.parent.name?.text === 'createZeichnung'
      )
        melde(n, n.initializer);
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === 'createZeichnung'
      )
        melde(n, n.arguments[PRAEFIX_ARGUMENT]);
      ts.forEachChild(n, besuche);
    };
    besuche(sf);
  }
  return funde;
}

describe('terra-draw-Präfixe der Lagekarte (LFH-766)', () => {
  it('jeder Präfix beginnt mit td-', () => {
    const funde = praefixe();
    // Zeichnen-Vorgabe, Abschnitt, Zone, Messen — fände der Scan weniger, sähe er nichts mehr.
    expect(funde.map((f) => f.wert).sort()).toEqual(
      expect.arrayContaining(['td-abschnitt', 'td-mess', 'td-zeichnen', 'td-zone']),
    );
    expect(funde.filter((f) => !f.wert?.startsWith(ZEICHNUNG_PRAEFIX))).toEqual([]);
  });
});
