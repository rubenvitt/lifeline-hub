import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Die Abstände der rechten Kartenleiste kommen aus der Dichte-Staffel, nicht aus einer Zahl
 * (LFH-377, A2-Linie).
 *
 * Vor dem Neuentwurf stapelte die Leiste rund zwölf `Card` mit hartem `marginBottom: 12` und
 * trug selbst `padding: 12` — 12 px in jeder Dichtestufe. Seit S5 trennen Haarlinien die
 * Abschnitte (`KlappPaneel`/`LeistenAbschnitt`), gepolstert mit `token.padding`. Übrig war ein
 * Nachzügler aus dem alten Kartenstapel (`AnsichtSwitcher`, `marginBottom: 12` IN einem schon
 * gepolsterten Paneel) und eine Handvoll Abstände in der Bild-Zeile.
 *
 * Geprüft wird die QUELLE, nicht ein gemessener Pixelabstand: jsdom rechnet kein Layout, und
 * `test/utils.tsx` mountet ein nacktes `ConfigProvider` — eine Abstandsmessung im Vitest mäße
 * antd-Vorgaben. Der Scan läuft über den TS-Syntaxbaum statt per Regex, damit ein Kommentar,
 * der die alte Zahl zitiert, das Gate nicht füllt.
 */

const hier = dirname(fileURLToPath(import.meta.url));

/** Die Leiste selbst und was sie unmittelbar als Abschnittsinhalt einhängt. */
const DATEIEN = ['Sidebar.tsx', 'KlappPaneel.tsx', 'AnsichtSwitcher.tsx'] as const;

/** Stil-Schlüssel, die einen Abstand tragen. `0` bleibt erlaubt: es ist kein Maß, sondern
 *  das Abschalten der Browser-Vorgabe (`margin: 0` an Überschrift und Absatz). */
const ABSTAND = /^(margin|padding|gap|rowGap|columnGap)/;

/** Ein fester Wert: Zahl (`12`) oder Zeichenkette mit Pixelzahl (`'12px'`, `'0 4px'`). */
function festerWert(knoten: ts.Expression): string | null {
  if (ts.isNumericLiteral(knoten)) return knoten.text === '0' ? null : knoten.text;
  if (
    ts.isPrefixUnaryExpression(knoten) &&
    knoten.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(knoten.operand)
  ) {
    return `-${knoten.operand.text}`;
  }
  if (ts.isStringLiteral(knoten) || ts.isNoSubstitutionTemplateLiteral(knoten)) {
    return /[1-9]/.test(knoten.text) ? `'${knoten.text}'` : null;
  }
  return null;
}

interface Fund {
  datei: string;
  zeile: number;
  was: string;
}

/** Alle festen Abstände einer Quelle: Stil-Schlüssel mit Zahl und `<Space size={Zahl}>`. */
function festeAbstaende(datei: string, quelle: string): Fund[] {
  const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const funde: Fund[] = [];
  const zeile = (k: ts.Node) => sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1;

  const besuche = (k: ts.Node) => {
    if (ts.isPropertyAssignment(k)) {
      const name = ts.isIdentifier(k.name) || ts.isStringLiteral(k.name) ? k.name.text : undefined;
      const wert = name && ABSTAND.test(name) ? festerWert(k.initializer) : null;
      if (name && wert) funde.push({ datei, zeile: zeile(k), was: `${name}: ${wert}` });
    }
    if (ts.isJsxOpeningElement(k) || ts.isJsxSelfClosingElement(k)) {
      const tag = k.tagName.getText(sf);
      if (tag === 'Space' || tag === 'Space.Compact') {
        for (const attr of k.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== 'size') continue;
          const init = attr.initializer;
          if (init && ts.isJsxExpression(init) && init.expression) {
            const wert = festerWert(init.expression);
            if (wert) funde.push({ datei, zeile: zeile(attr), was: `<${tag} size={${wert}}>` });
          }
        }
      }
    }
    ts.forEachChild(k, besuche);
  };
  besuche(sf);
  return funde;
}

describe('Abstände der Kartenleiste (LFH-377)', () => {
  it.each(DATEIEN)('%s trägt keinen festen Pixelabstand', (datei) => {
    const quelle = readFileSync(join(hier, datei), 'utf8');
    expect(festeAbstaende(datei, quelle)).toEqual([]);
  });

  // Selbsttest: ohne ihn bliebe das Gate auch grün, wenn der Scan gar nichts findet.
  it('der Scan findet, was er finden soll — und nur das', () => {
    const probe = `
      // marginBottom: 12 im Kommentar zählt nicht
      const a = { marginBottom: 12, padding: '0 4px', gap: -2 };
      const b = { margin: 0, padding: token.padding, marginTop: token.marginSM, fontSize: 12 };
      const c = <Space size={4}><Space.Compact size="small" /></Space>;
    `;
    expect(festeAbstaende('probe.tsx', probe).map((f) => f.was)).toEqual([
      'marginBottom: 12',
      "padding: '0 4px'",
      'gap: -2',
      '<Space size={4}>',
    ]);
  });
});
