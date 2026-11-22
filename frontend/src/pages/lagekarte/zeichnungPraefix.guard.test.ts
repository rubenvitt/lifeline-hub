import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type AstNode, parseSource, staticText, walk, lineOf } from '../../lib/sourceAst';
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
    const melde = (knoten: AstNode, wert: AstNode | null | undefined) => {
      if (!wert) return;
      const zeile = lineOf(quelle, knoten.start);
      const statisch = staticText(wert);
      if (statisch !== undefined) funde.push({ datei, zeile, wert: statisch });
      else if (!(datei === 'zeichnen.ts' && wert.type === 'Identifier' && wert.name === 'praefix'))
        funde.push({ datei, zeile, wert: null });
    };
    walk(parseSource(datei, quelle), (n, eltern) => {
      const schluessel = n.key as AstNode | undefined;
      if (
        n.type === 'Property' &&
        eltern?.type === 'ObjectExpression' &&
        !n.shorthand &&
        !n.computed &&
        schluessel?.type === 'Identifier' &&
        schluessel.name === 'prefixId'
      )
        melde(n, n.value as AstNode);
      const links = n.left as AstNode | undefined;
      if (
        n.type === 'AssignmentPattern' &&
        links?.type === 'Identifier' &&
        links.name === 'praefix' &&
        eltern?.type === 'FunctionDeclaration' &&
        (eltern.id as AstNode | null)?.name === 'createZeichnung'
      )
        melde(n, n.right as AstNode);
      const callee = n.callee as AstNode | undefined;
      if (
        n.type === 'CallExpression' &&
        callee?.type === 'Identifier' &&
        callee.name === 'createZeichnung'
      )
        melde(n, (n.arguments as AstNode[])[PRAEFIX_ARGUMENT]);
    });
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
