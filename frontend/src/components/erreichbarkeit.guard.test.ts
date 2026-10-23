import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Wächter „kein Wort Erreichbarkeit“ (LLH-1134, Entscheidung LLH-1126 Option B).
 *
 * ── Warum ──────────────────────────────────────────────────────────────────────
 * „Erreichbarkeit“ war überall unklar: mal Rufnummer, mal Funkkanal, mal beides. Funk (Rufname,
 * Sprechgruppen) und Telefon (typisierte Verbindungen) heißen seither getrennt; Presse sagt
 * „Telefon / E-Mail“, Personal „Kontakt & Konto“, die Betreuungsstelle „Kontakt“. Dieser Wächter
 * hält das Wort aus der Oberfläche und aus der Anwenderhilfe fern.
 *
 * ── Wie ───────────────────────────────────────────────────────────────────────
 * Gelesen werden im Frontend nur ZEICHENKETTEN und JSX-Text (TypeScript-AST, wie
 * `erklaertext.guard.test.ts`), keine Kommentare und keine Bezeichner: der Datenbank- und
 * Wire-Name `erreichbarkeit` (klein) bleibt erlaubt. In der Anwenderhilfe (`docs/anwender/`,
 * in der App als Hilfe gezeigt) zählt jede Zeile. Das Adjektiv „erreichbar“ ist kein Treffer.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const HILFE = join(SRC, '..', '..', 'docs', 'anwender');
const MUSTER = /\bErreichbarkeit/;

function texteAus(quelle: string, dateiname: string): { text: string; zeile: number }[] {
  const datei = ts.createSourceFile(dateiname, quelle, ts.ScriptTarget.Latest, true);
  const texte: { text: string; zeile: number }[] = [];
  const merke = (knoten: ts.Node, text: string) =>
    texte.push({ text, zeile: datei.getLineAndCharacterOfPosition(knoten.getStart()).line + 1 });
  const besuche = (knoten: ts.Node) => {
    if (ts.isImportDeclaration(knoten) || ts.isExportDeclaration(knoten)) return;
    if (
      ts.isStringLiteral(knoten) ||
      ts.isNoSubstitutionTemplateLiteral(knoten) ||
      ts.isTemplateHead(knoten) ||
      ts.isTemplateMiddle(knoten) ||
      ts.isTemplateTail(knoten) ||
      ts.isJsxText(knoten)
    )
      merke(knoten, knoten.text);
    ts.forEachChild(knoten, besuche);
  };
  besuche(datei);
  return texte;
}

function treffer(quelle: string, dateiname = 'x.tsx'): number[] {
  return texteAus(quelle, dateiname)
    .filter(({ text }) => MUSTER.test(text))
    .map(({ zeile }) => zeile);
}

function dateien(verzeichnis: string, endung: RegExp): string[] {
  return readdirSync(verzeichnis, { withFileTypes: true }).flatMap((e) => {
    const pfad = join(verzeichnis, e.name);
    if (e.isDirectory()) return dateien(pfad, endung);
    if (!endung.test(e.name) || /\.test\.|\.d\.ts$|\.generated\./.test(e.name)) return [];
    return [pfad];
  });
}

describe('Wächter „kein Wort Erreichbarkeit“ (LLH-1134)', () => {
  it('Selbstbeweis: Literal, Template und JSX-Text zählen; Kommentar, Bezeichner, Wire-Name nicht', () => {
    const quelle = [
      "const a = 'Erreichbarkeit';",
      '// Erreichbarkeit im Kommentar',
      'const b = <p>Funk / Erreichbarkeit</p>;',
      "const c = { erreichbarkeit: 'x', kontakt_erreichbarkeit: 'y' };",
      'const d = `${n} Erreichbarkeiten`;',
      "const e = 'nicht erreichbar';",
    ].join('\n');
    expect(treffer(quelle)).toEqual([1, 3, 5]);
  });

  it('keine Zeichenkette und kein JSX-Text im Frontend nennt „Erreichbarkeit“', () => {
    const fundorte = dateien(SRC, /\.(ts|tsx)$/).flatMap((pfad) =>
      treffer(readFileSync(pfad, 'utf8'), pfad).map((z) => `${relative(SRC, pfad)}:${z}`),
    );
    expect(fundorte).toEqual([]);
  });

  it('die Anwenderhilfe nennt „Erreichbarkeit“ nicht', () => {
    const fundorte = dateien(HILFE, /\.md$/).flatMap((pfad) =>
      readFileSync(pfad, 'utf8')
        .split('\n')
        .flatMap((zeile, i) => (MUSTER.test(zeile) ? [`${relative(HILFE, pfad)}:${i + 1}`] : [])),
    );
    expect(fundorte).toEqual([]);
  });
});
