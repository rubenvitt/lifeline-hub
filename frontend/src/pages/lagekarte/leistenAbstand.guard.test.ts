import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type AstNode, parseSource, staticText, textOf, walk, lineOf } from '../../lib/sourceAst';

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

/** Die Leiste selbst und was sie unmittelbar als Abschnittsinhalt einhängt (seit LLH-1028 auch
 *  Ebenenbaum, Bild-Hintergründe und Modus-Band, seit LLH-1033 die Objektliste) — seit LFH-703
 *  auch die Inspectors der Ansicht „Auswahl“ und die Bausteine über der Karte (Detailkarte, Überlagerung, Snapshot-Band im
 *  Fuß). */
const DATEIEN = [
  'Sidebar.tsx',
  'Ebenenbaum.tsx',
  'BildHintergruende.tsx',
  'ModusBand.tsx',
  'MarkerSuche.tsx',
  'leistenTeile.tsx',
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
function festerWert(knoten: AstNode | null, quelltext: string): string | null {
  if (knoten == null) return null;
  if (
    knoten.type === 'ParenthesizedExpression' ||
    knoten.type === 'TSAsExpression' ||
    knoten.type === 'TSSatisfiesExpression'
  ) {
    return festerWert(knoten.expression as AstNode, quelltext);
  }
  if (knoten.type === 'ConditionalExpression') {
    return (
      festerWert(knoten.consequent as AstNode, quelltext) ??
      festerWert(knoten.alternate as AstNode, quelltext)
    );
  }
  if (knoten.type === 'ArrayExpression') {
    const teile = (knoten.elements as (AstNode | null)[]).map((e) => festerWert(e, quelltext));
    return teile.some((t) => t != null) ? `[${teile.map((t) => t ?? '…').join(', ')}]` : null;
  }
  const isNumber = (k: AstNode) => k.type === 'Literal' && typeof k.value === 'number';
  if (isNumber(knoten)) {
    const roh = textOf(quelltext, knoten);
    return roh === '0' ? null : roh;
  }
  if (
    knoten.type === 'UnaryExpression' &&
    knoten.operator === '-' &&
    isNumber(knoten.argument as AstNode)
  ) {
    return `-${textOf(quelltext, knoten.argument as AstNode)}`;
  }
  const statisch = staticText(knoten);
  if (statisch !== undefined) {
    return ZAHL_STUECK.test(statisch) ? `'${statisch}'` : null;
  }
  if (knoten.type === 'TemplateLiteral') {
    const stuecke = (knoten.quasis as AstNode[]).map(
      (t) => (t.value as { cooked: string | null; raw: string }).cooked ?? '',
    );
    return stuecke.some((t) => ZAHL_STUECK.test(t)) ? textOf(quelltext, knoten) : null;
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
  const funde: Fund[] = [];
  const zeile = (k: AstNode) => lineOf(quelle, k.start);

  walk(parseSource(datei, quelle), (k, eltern) => {
    if (
      k.type === 'Property' &&
      eltern?.type === 'ObjectExpression' &&
      k.kind === 'init' &&
      !k.method &&
      !k.computed
    ) {
      const schluessel = k.key as AstNode;
      const name =
        schluessel.type === 'Identifier'
          ? (schluessel.name as string)
          : schluessel.type === 'Literal' && typeof schluessel.value === 'string'
            ? schluessel.value
            : undefined;
      if (k.shorthand) {
        // `{ gap }`: der Wert steht woanders, der Scan kann ihn nicht beurteilen — also Befund.
        if (name && ABSTAND.test(name)) funde.push({ datei, zeile: zeile(k), was: `{ ${name} }` });
      } else {
        const wert = name && ABSTAND.test(name) ? festerWert(k.value as AstNode, quelle) : null;
        if (name && wert) funde.push({ datei, zeile: zeile(k), was: `${name}: ${wert}` });
      }
    }
    if (k.type === 'JSXOpeningElement') {
      const tag = textOf(quelle, k.name as AstNode);
      const prop = JSX_ABSTAND[tag];
      for (const attr of prop ? (k.attributes as AstNode[]) : []) {
        if (attr.type !== 'JSXAttribute' || textOf(quelle, attr.name as AstNode) !== prop) continue;
        const init = attr.value as AstNode | null;
        const ausdruck =
          init?.type === 'JSXExpressionContainer' ? (init.expression as AstNode) : null;
        if (ausdruck && ausdruck.type !== 'JSXEmptyExpression') {
          const wert = festerWert(ausdruck, quelle);
          if (wert) funde.push({ datei, zeile: zeile(attr), was: `<${tag} ${prop}={${wert}}>` });
        }
      }
    }
  });
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
