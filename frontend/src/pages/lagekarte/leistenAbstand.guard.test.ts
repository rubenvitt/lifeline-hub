import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Die Abstände der rechten Kartenleiste und der Bausteine über der Karte kommen aus der
 * Dichte-Staffel, nicht aus einer Zahl (LFH-377, LFH-703).
 * Haarlinien trennen die Abschnitte (`KlappPaneel`/`LeistenAbschnitt`), gepolstert mit
 * `token.padding`.
 *
 * Geprüft wird die Quelle, nicht ein Pixelabstand: jsdom rechnet kein Layout, und `test/utils.tsx`
 * mountet ein nacktes `ConfigProvider`. Der Scan läuft über den TS-Syntaxbaum, damit ein Kommentar
 * mit einer Zahl das Gate nicht füllt.
 *
 * Was der Scan sieht: Stil-Schlüssel `margin*`/`padding*`/`gap`/`rowGap`/`columnGap` mit Zahl,
 * Zeichenkette mit Zahl oder Zahl-Stück in einem Template (`` `0 ${x}px 4px` ``), auch hinter `?:`,
 * `as`, `satisfies` und Klammern; die Kurzschreibweise (`{ gap }`) als Befund, weil ihr Wert nicht
 * an der Stelle steht; `size` an `Space`/`Space.Compact`, `gap` an `Flex` und `gutter` an `Row`,
 * jeweils auch als Array.
 *
 * Was er nicht sieht (Teil des Vertrags): einen Wert aus einer Variablen (`padding: rand` mit
 * `const rand = 12`), einen Spread aus einer Hilfsfunktion in einer anderen Datei, Stile aus
 * CSS-Dateien (die Leiste hat dort keine Abstände; `lagekarte.css` polstert nur die Maßstabsleiste)
 * und Bausteine außerhalb von `DATEIEN`.
 *
 * Bewusst fest und deshalb benannt statt als Zahl: die Haarlinie zwischen den Kartenknöpfen
 * (`KNOPF_FUGE` in `KartenUeberlagerung.tsx`, 1 px in jeder Dichte, wie die Fuge des
 * Kennzahlenbands) und der Kartenrand `UEBERLAGERUNG_RAND`/`FUSS_ABSTAND` (Abstand zur
 * Kartenkante, kein Abstand im Baustein).
 */

const hier = dirname(fileURLToPath(import.meta.url));

/** Die Leiste selbst und was sie unmittelbar als Abschnittsinhalt einhängt — seit LFH-703 auch
 *  die Inspectors im Abschnitt „Ausgewählt“ und die Bausteine über der Karte (Detailkarte,
 *  Überlagerung, Snapshot-Band im Fuß). */
const DATEIEN = [
  'Sidebar.tsx',
  'KlappPaneel.tsx',
  'AnsichtSwitcher.tsx',
  'FachebenenInspector.tsx',
  'Inspector.tsx',
  'KartenDetailCard.tsx',
  'KartenUeberlagerung.tsx',
  'SnapshotLeiste.tsx',
] as const;

/** Stil-Schlüssel, die einen Abstand tragen. `0` bleibt erlaubt: es ist kein Maß, sondern
 *  das Abschalten der Browser-Vorgabe (`margin: 0` an Überschrift und Absatz). */
const ABSTAND = /^(margin|padding|gap|rowGap|columnGap)/;

/** Abstands-Props von Layout-Bausteinen: `<Space size>`, `<Flex gap>`, `<Row gutter>`. */
const JSX_ABSTAND: Record<string, string> = {
  Space: 'size',
  'Space.Compact': 'size',
  Flex: 'gap',
  Row: 'gutter',
};

/** Eine Zahl ungleich 0 in einem Textstück (`4px`, `0 4px`, `0.5rem`) — `0` allein nicht. */
const ZAHL_STUECK = /(^|[^\w$.])(?!0(?![.\d]))\d+(\.\d+)?/;

/** Ein fester Wert: Zahl, Zeichenkette oder Template mit Zahl, Array daraus — auch hinter
 *  `?:`, `as`, `satisfies` und Klammern. `null`, wenn der Wert nicht fest ist. */
function festerWert(knoten: ts.Expression, sf: ts.SourceFile): string | null {
  if (
    ts.isParenthesizedExpression(knoten) ||
    ts.isAsExpression(knoten) ||
    ts.isSatisfiesExpression(knoten)
  ) {
    return festerWert(knoten.expression, sf);
  }
  if (ts.isConditionalExpression(knoten)) {
    return festerWert(knoten.whenTrue, sf) ?? festerWert(knoten.whenFalse, sf);
  }
  if (ts.isArrayLiteralExpression(knoten)) {
    const teile = knoten.elements.map((e) => festerWert(e, sf));
    return teile.some((t) => t != null) ? `[${teile.map((t) => t ?? '…').join(', ')}]` : null;
  }
  if (ts.isNumericLiteral(knoten)) return knoten.text === '0' ? null : knoten.text;
  if (
    ts.isPrefixUnaryExpression(knoten) &&
    knoten.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(knoten.operand)
  ) {
    return `-${knoten.operand.text}`;
  }
  if (ts.isStringLiteral(knoten) || ts.isNoSubstitutionTemplateLiteral(knoten)) {
    return ZAHL_STUECK.test(knoten.text) ? `'${knoten.text}'` : null;
  }
  if (ts.isTemplateExpression(knoten)) {
    const stuecke = [knoten.head.text, ...knoten.templateSpans.map((t) => t.literal.text)];
    return stuecke.some((t) => ZAHL_STUECK.test(t)) ? knoten.getText(sf) : null;
  }
  return null;
}

interface Fund {
  datei: string;
  zeile: number;
  was: string;
}

/** Alle festen Abstände einer Quelle, in Baumreihenfolge. */
function festeAbstaende(datei: string, quelle: string): Fund[] {
  const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const funde: Fund[] = [];
  const zeile = (k: ts.Node) => sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1;

  const besuche = (k: ts.Node) => {
    if (ts.isPropertyAssignment(k)) {
      const name = ts.isIdentifier(k.name) || ts.isStringLiteral(k.name) ? k.name.text : undefined;
      const wert = name && ABSTAND.test(name) ? festerWert(k.initializer, sf) : null;
      if (name && wert) funde.push({ datei, zeile: zeile(k), was: `${name}: ${wert}` });
    }
    // `{ gap }`: der Wert steht woanders, der Scan kann ihn nicht beurteilen — also Befund.
    if (ts.isShorthandPropertyAssignment(k) && ABSTAND.test(k.name.text)) {
      funde.push({ datei, zeile: zeile(k), was: `{ ${k.name.text} }` });
    }
    if (ts.isJsxOpeningElement(k) || ts.isJsxSelfClosingElement(k)) {
      const tag = k.tagName.getText(sf);
      const prop = JSX_ABSTAND[tag];
      for (const attr of prop ? k.attributes.properties : []) {
        if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== prop) continue;
        const init = attr.initializer;
        if (init && ts.isJsxExpression(init) && init.expression) {
          const wert = festerWert(init.expression, sf);
          if (wert) funde.push({ datei, zeile: zeile(attr), was: `<${tag} ${prop}={${wert}}>` });
        }
      }
    }
    ts.forEachChild(k, besuche);
  };
  besuche(sf);
  return funde;
}

describe('Abstände der Kartenleiste und der Kartenbausteine (LFH-377, LFH-703)', () => {
  it.each(DATEIEN)('%s trägt keinen festen Abstand in den Formen, die der Scan sieht', (datei) => {
    const quelle = readFileSync(join(hier, datei), 'utf8');
    expect(festeAbstaende(datei, quelle)).toEqual([]);
  });

  // Selbsttest: ohne ihn bliebe das Gate auch grün, wenn der Scan gar nichts findet.
  it('der Scan findet, was er finden soll — und nur das', () => {
    const probe = [
      '// marginBottom: 12 im Kommentar zählt nicht',
      "const a = { marginBottom: 12, padding: '0 4px', gap: -2 };",
      'const b = { margin: 0, padding: token.padding, marginTop: token.marginSM, fontSize: 12 };',
      'const c = <Space size={4}><Space.Compact size={t.marginXS} /></Space>;',
      'const d = { padding: `${t.paddingXS}px ${t.padding}px`, paddingTop: `0 ${x}px 4px` };',
      'const e = { gap, rowGap: offen ? 12 : 0, columnGap: (6 as const), marginLeft: t.marginXS };',
      'const f = <><Flex gap={8} /><Row gutter={[t.margin, 8]} /><Flex gap={t.margin} /></>;',
    ].join('\n');
    expect(festeAbstaende('probe.tsx', probe).map((f) => f.was)).toEqual([
      'marginBottom: 12',
      "padding: '0 4px'",
      'gap: -2',
      '<Space size={4}>',
      'paddingTop: `0 ${x}px 4px`',
      '{ gap }',
      'rowGap: 12',
      'columnGap: 6',
      '<Flex gap={8}>',
      '<Row gutter={[…, 8]}>',
    ]);
  });
});
