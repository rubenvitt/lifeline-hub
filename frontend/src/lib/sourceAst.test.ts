import { describe, expect, it } from 'vitest';
import {
  type AstNode,
  isStringLiteral,
  parseSource,
  visibleTexts,
  staticText,
  textOf,
  walk,
  lineOf,
} from './sourceAst';

/** Alle Knoten einer Art in Besuchsreihenfolge. */
function alle(wurzel: AstNode, typ: string): AstNode[] {
  const funde: AstNode[] = [];
  walk(wurzel, (knoten) => {
    if (knoten.type === typ) funde.push(knoten);
  });
  return funde;
}

describe('sourceAst', () => {
  it('findet JSX-Text in einer TSX-Datei', () => {
    const programm = parseSource('x.tsx', 'const a = <b>Hallo</b>;');
    expect(alle(programm, 'JSXText').map((k) => k.value)).toEqual(['Hallo']);
  });

  it('parst eine .ts-Datei auf Wunsch als TSX', () => {
    const programm = parseSource('x.ts', 'const a = <b>Hallo</b>;', 'tsx');
    expect(alle(programm, 'JSXText')).toHaveLength(1);
  });

  it('sieht den Aufruf hinter optionaler Verkettung', () => {
    const programm = parseSource('x.ts', "a?.b('k');");
    expect(alle(programm, 'CallExpression')).toHaveLength(1);
  });

  it('wirft bei Syntaxfehlern mit dem Pfad in der Meldung', () => {
    expect(() => parseSource('kaputt.ts', 'const = ;')).toThrow(/kaputt\.ts/);
  });

  it('rechnet Offsets in 1-basierte Zeilen um', () => {
    expect(lineOf('a', 0)).toBe(1);
    expect(lineOf('a\nb\nc', 4)).toBe(3);
    expect(lineOf('a\nb\nc', 2)).toBe(2);
  });

  it('liefert den Quelltext eines Knotens', () => {
    const text = 'f(1 as any);';
    const programm = parseSource('x.ts', text);
    const aufruf = alle(programm, 'CallExpression')[0];
    expect(textOf(text, (aufruf.arguments as AstNode[])[0])).toBe('1 as any');
  });

  it('besucht in Quelltext-Reihenfolge und reicht die Eltern mit', () => {
    const programm = parseSource('x.ts', 'a; b; c;');
    const starts: number[] = [];
    const elternTypen: string[] = [];
    walk(programm, (knoten, eltern) => {
      if (knoten.type === 'Identifier') {
        starts.push(knoten.start);
        elternTypen.push(eltern?.type ?? 'keine');
      }
    });
    expect(starts).toEqual([0, 3, 6]);
    expect(elternTypen).toEqual([
      'ExpressionStatement',
      'ExpressionStatement',
      'ExpressionStatement',
    ]);
  });

  it('erkennt String-Literale, aber keine Zahlen', () => {
    const programm = parseSource('x.ts', "f('x', 1);");
    const [s, z] = alle(programm, 'CallExpression')[0].arguments as AstNode[];
    expect(isStringLiteral(s)).toBe(true);
    expect(isStringLiteral(z)).toBe(false);
  });

  it('steigt nicht ab, wenn der Besuch false liefert', () => {
    const programm = parseSource('x.ts', 'f(a); g(b);');
    const namen: string[] = [];
    walk(programm, (knoten) => {
      if (knoten.type === 'Identifier') namen.push(knoten.name as string);
      if (knoten.type === 'CallExpression' && (knoten.callee as AstNode).name === 'f') return false;
    });
    expect(namen).toEqual(['g', 'b']);
  });

  it('liest statischen Text aus String- und platzhalterlosen Template-Literalen', () => {
    const programm = parseSource('x.ts', "f('a', `b`, `c${d}`, 1);");
    const args = alle(programm, 'CallExpression')[0].arguments as AstNode[];
    expect(args.map(staticText)).toEqual(['a', 'b', undefined, undefined]);
  });

  it('sammelt sichtbare Texte mit Zeilen, ohne Importe und Re-Exporte', () => {
    const text = [
      "import { x } from 'modul';",
      "export { y } from 'anderes';",
      "export * from 'alles';",
      "export const z = 'Hallo';",
      'const t = `Kopf ${a} Mitte ${b} Ende`;',
      'const j = <p title="Titel">Text</p>;',
    ].join('\n');
    expect(visibleTexts('x.tsx', text)).toEqual([
      { text: 'Hallo', line: 4 },
      { text: 'Kopf ', line: 5 },
      { text: ' Mitte ', line: 5 },
      { text: ' Ende', line: 5 },
      { text: 'Titel', line: 6 },
      { text: 'Text', line: 6 },
    ]);
  });

  it('zählt die Zeile eines Template-Teils ab Backtick bzw. schließender Klammer', () => {
    expect(visibleTexts('x.ts', 'const t = `\nA${b}\nC`;')).toEqual([
      { text: '\nA', line: 1 },
      { text: '\nC', line: 2 },
    ]);
  });

  it('besucht Template-Teile und Platzhalter verschränkt in Quelltext-Reihenfolge', () => {
    expect(visibleTexts('x.ts', "const t = `A${'b'}C${'d'}E`;").map((t) => t.text)).toEqual([
      'A',
      'b',
      'C',
      'd',
      'E',
    ]);
  });

  it('zählt die Zeile eines JSX-Texts ab seinem ersten sichtbaren Zeichen', () => {
    const text = ['const j = (', '  <p>', '    Hallo', '  </p>', ');'].join('\n');
    expect(visibleTexts('x.tsx', text)).toEqual([{ text: '\n    Hallo\n  ', line: 3 }]);
  });

  it('zählt die Zeile auch bei Backtick und Klammer in Spalte 0 richtig', () => {
    const text = ['const t =', '`A ${', '  x', '}Erreichbarkeit`;'].join('\n');
    expect(visibleTexts('x.ts', text)).toEqual([
      { text: 'A ', line: 2 },
      { text: 'Erreichbarkeit', line: 4 },
    ]);
  });
});
