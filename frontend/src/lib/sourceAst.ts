/**
 * Quelltext als AST für Guard-Tests und Scans (LLH-2020): ein Parser für alle eigenen
 * AST-Prüfungen, `oxc-parser` (ESTree mit TS-Erweiterungen). Löste `ts.createSourceFile` ab, als
 * TypeScript 7 die klassische Compiler-API nicht mehr mitbrachte.
 *
 * BEWUSST OHNE `import.meta.glob`: der Helfer nimmt Quelltext als String entgegen, das Glob
 * bleibt im Guard-Test. Sonst landete bei einem versehentlichen Produktiv-Import der Quelltext des
 * Frontends im App-Bundle (wie `api/queryKeyScan.ts`).
 */
import { parseSync, visitorKeys } from 'oxc-parser';

/** Ein Knoten des ESTree-AST; die Felder hängen an `type` (siehe `@oxc-project/types`). */
export type AstNode = { type: string; start: number; end: number } & Record<string, unknown>;

/**
 * Parst Quelltext. Die Sprache folgt der Endung (`.tsx` → TSX, sonst TS), `lang` überstimmt sie.
 * Wirft bei Syntaxfehlern: ein leerer AST ließe einen Guard still grün.
 */
export function parseSource(pfad: string, text: string, lang?: 'ts' | 'tsx'): AstNode {
  const sprache = lang ?? (pfad.endsWith('.tsx') ? 'tsx' : 'ts');
  const ergebnis = parseSync(pfad, text, { lang: sprache, sourceType: 'module' });
  if (ergebnis.errors.length > 0) {
    throw new Error(`${pfad}: ${ergebnis.errors[0].message}`);
  }
  return ergebnis.program as unknown as AstNode;
}

const isNode = (wert: unknown): wert is AstNode =>
  typeof wert === 'object' && wert !== null && typeof (wert as AstNode).type === 'string';

/**
 * Geht in Quelltext-Reihenfolge über alle Knoten und reicht den Elternknoten mit. Liefert der
 * Besuch `false`, bleiben die Kinder dieses Knotens unbesucht.
 */
export function walk(
  wurzel: AstNode,
  besuch: (knoten: AstNode, eltern: AstNode | null) => boolean | void,
): void {
  const gehe = (knoten: AstNode, eltern: AstNode | null) => {
    if (besuch(knoten, eltern) === false) return;
    const kinder: AstNode[] = [];
    for (const schluessel of visitorKeys[knoten.type] ?? []) {
      const kind = knoten[schluessel];
      if (Array.isArray(kind)) {
        for (const element of kind) if (isNode(element)) kinder.push(element);
      } else if (isNode(kind)) {
        kinder.push(kind);
      }
    }
    // ESTree führt etwa Template-Teile und Platzhalter in getrennten Listen; besucht wird in
    // Quelltext-Reihenfolge (stabil: bei gleichem Start, etwa Schlüssel und Wert einer Kurzform,
    // bleibt die Reihenfolge der Schlüssel).
    kinder.sort((a, b) => a.start - b.start);
    for (const kind of kinder) gehe(kind, knoten);
  };
  gehe(wurzel, null);
}

/** 1-basierte Zeile eines Offsets, wie in Editor- und Guard-Meldungen üblich. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Quelltext eines Knotens. */
export const textOf = (text: string, knoten: AstNode): string =>
  text.slice(knoten.start, knoten.end);

/** String-Literal (`'x'`, `"x"`); Zahlen, `null` und reguläre Ausdrücke zählen nicht. */
export const isStringLiteral = (
  knoten: AstNode | null | undefined,
): knoten is AstNode & { type: 'Literal'; value: string } =>
  knoten?.type === 'Literal' && typeof knoten.value === 'string';

/**
 * Statischer Text eines String-Literals oder eines Template-Literals ohne Platzhalter (wie TS
 * `isStringLiteralLike`); sonst `undefined`.
 */
export function staticText(knoten: AstNode | null | undefined): string | undefined {
  if (isStringLiteral(knoten)) return knoten.value;
  if (knoten?.type === 'TemplateLiteral' && (knoten.expressions as AstNode[]).length === 0) {
    return templatePartText((knoten.quasis as AstNode[])[0]);
  }
  return undefined;
}

/** Text eines Template-Teils (`TemplateElement`), aufgelöst wie TS `.text`. */
const templatePartText = (teil: AstNode): string => {
  const wert = teil.value as { cooked: string | null; raw: string };
  return wert.cooked ?? wert.raw;
};

/** Re-Exporte (`export { a } from`, `export { a }`, `export * from`) tragen keine sichtbaren Texte. */
const isImportOrReExport = (knoten: AstNode): boolean =>
  knoten.type === 'ImportDeclaration' ||
  knoten.type === 'ExportAllDeclaration' ||
  (knoten.type === 'ExportNamedDeclaration' && knoten.declaration == null);

/**
 * Sichtbare Zeichenketten einer Quelle: String-Literale, Template-Teile und JSX-Text, je mit
 * 1-basierter Zeile. Ohne Import- und Re-Export-Pfade. Ein Template-Teil zählt ab seinem Backtick
 * bzw. seiner schließenden Klammer (dort beginnt er in oxc), ein JSX-Text ab seinem ersten
 * sichtbaren Zeichen (beides wie zuvor `getStart` der TS-Token).
 */
export function visibleTexts(pfad: string, text: string): { text: string; line: number }[] {
  const texte: { text: string; line: number }[] = [];
  walk(parseSource(pfad, text), (knoten) => {
    if (isImportOrReExport(knoten)) return false;
    if (isStringLiteral(knoten))
      texte.push({ text: knoten.value, line: lineOf(text, knoten.start) });
    else if (knoten.type === 'TemplateElement')
      texte.push({ text: templatePartText(knoten), line: lineOf(text, knoten.start) });
    else if (knoten.type === 'JSXText') {
      const roh = (knoten.raw as string | undefined) ?? (knoten.value as string);
      // Wie TS `getStart`: führende Leerzeichen und Umbrüche zählen nicht zur Zeile.
      const fuehrend = /^\s*/.exec(roh)?.[0].length ?? 0;
      texte.push({ text: roh, line: lineOf(text, knoten.start + fuehrend) });
    }
  });
  return texte;
}
