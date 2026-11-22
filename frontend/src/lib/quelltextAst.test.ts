import { describe, expect, it } from 'vitest';
import {
  type AstKnoten,
  istStringLiteral,
  ohneHuelle,
  parseQuelltext,
  sichtbareTexte,
  statischerText,
  textVon,
  walk,
  zeileVon,
} from './quelltextAst';

/** Alle Knoten einer Art in Besuchsreihenfolge. */
function alle(wurzel: AstKnoten, typ: string): AstKnoten[] {
  const funde: AstKnoten[] = [];
  walk(wurzel, (knoten) => {
    if (knoten.type === typ) funde.push(knoten);
  });
  return funde;
}

describe('quelltextAst', () => {
  it('findet JSX-Text in einer TSX-Datei', () => {
    const programm = parseQuelltext('x.tsx', 'const a = <b>Hallo</b>;');
    expect(alle(programm, 'JSXText').map((k) => k.value)).toEqual(['Hallo']);
  });

  it('parst eine .ts-Datei auf Wunsch als TSX', () => {
    const programm = parseQuelltext('x.ts', 'const a = <b>Hallo</b>;', 'tsx');
    expect(alle(programm, 'JSXText')).toHaveLength(1);
  });

  it('sieht den Aufruf hinter optionaler Verkettung', () => {
    const programm = parseQuelltext('x.ts', "a?.b('k');");
    expect(alle(programm, 'CallExpression')).toHaveLength(1);
    const anweisung = (programm.body as AstKnoten[])[0];
    expect(ohneHuelle(anweisung.expression as AstKnoten).type).toBe('CallExpression');
  });

  it('entfernt Klammern, as, satisfies und Non-Null um einen Ausdruck', () => {
    const programm = parseQuelltext('x.ts', "const v = ((f('x') as T) satisfies U)!;");
    const dekl = alle(programm, 'VariableDeclarator')[0];
    expect(ohneHuelle(dekl.init as AstKnoten).type).toBe('CallExpression');
  });

  it('wirft bei Syntaxfehlern mit dem Pfad in der Meldung', () => {
    expect(() => parseQuelltext('kaputt.ts', 'const = ;')).toThrow(/kaputt\.ts/);
  });

  it('rechnet Offsets in 1-basierte Zeilen um', () => {
    expect(zeileVon('a', 0)).toBe(1);
    expect(zeileVon('a\nb\nc', 4)).toBe(3);
    expect(zeileVon('a\nb\nc', 2)).toBe(2);
  });

  it('liefert den Quelltext eines Knotens', () => {
    const text = 'f(1 as any);';
    const programm = parseQuelltext('x.ts', text);
    const aufruf = alle(programm, 'CallExpression')[0];
    expect(textVon(text, (aufruf.arguments as AstKnoten[])[0])).toBe('1 as any');
  });

  it('besucht in Quelltext-Reihenfolge und reicht die Eltern mit', () => {
    const programm = parseQuelltext('x.ts', 'a; b; c;');
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
    const programm = parseQuelltext('x.ts', "f('x', 1);");
    const [s, z] = alle(programm, 'CallExpression')[0].arguments as AstKnoten[];
    expect(istStringLiteral(s)).toBe(true);
    expect(istStringLiteral(z)).toBe(false);
  });

  it('steigt nicht ab, wenn der Besuch false liefert', () => {
    const programm = parseQuelltext('x.ts', 'f(a); g(b);');
    const namen: string[] = [];
    walk(programm, (knoten) => {
      if (knoten.type === 'Identifier') namen.push(knoten.name as string);
      if (knoten.type === 'CallExpression' && (knoten.callee as AstKnoten).name === 'f')
        return false;
    });
    expect(namen).toEqual(['g', 'b']);
  });

  it('liest statischen Text aus String- und platzhalterlosen Template-Literalen', () => {
    const programm = parseQuelltext('x.ts', "f('a', `b`, `c${d}`, 1);");
    const args = alle(programm, 'CallExpression')[0].arguments as AstKnoten[];
    expect(args.map(statischerText)).toEqual(['a', 'b', undefined, undefined]);
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
    expect(sichtbareTexte('x.tsx', text)).toEqual([
      { text: 'Hallo', zeile: 4 },
      { text: 'Kopf ', zeile: 5 },
      { text: ' Mitte ', zeile: 5 },
      { text: ' Ende', zeile: 5 },
      { text: 'Titel', zeile: 6 },
      { text: 'Text', zeile: 6 },
    ]);
  });

  it('zählt die Zeile eines Template-Teils ab Backtick bzw. schließender Klammer', () => {
    expect(sichtbareTexte('x.ts', 'const t = `\nA${b}\nC`;')).toEqual([
      { text: '\nA', zeile: 1 },
      { text: '\nC', zeile: 2 },
    ]);
  });

  it('besucht Template-Teile und Platzhalter verschränkt in Quelltext-Reihenfolge', () => {
    expect(sichtbareTexte('x.ts', "const t = `A${'b'}C${'d'}E`;").map((t) => t.text)).toEqual([
      'A',
      'b',
      'C',
      'd',
      'E',
    ]);
  });

  it('zählt die Zeile eines JSX-Texts ab seinem ersten sichtbaren Zeichen', () => {
    const text = ['const j = (', '  <p>', '    Hallo', '  </p>', ');'].join('\n');
    expect(sichtbareTexte('x.tsx', text)).toEqual([{ text: '\n    Hallo\n  ', zeile: 3 }]);
  });
});
