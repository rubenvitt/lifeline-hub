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
export type AstKnoten = { type: string; start: number; end: number } & Record<string, unknown>;

/**
 * Parst Quelltext. Die Sprache folgt der Endung (`.tsx` → TSX, sonst TS), `lang` überstimmt sie.
 * Wirft bei Syntaxfehlern: ein leerer AST ließe einen Guard still grün.
 */
export function parseQuelltext(pfad: string, text: string, lang?: 'ts' | 'tsx'): AstKnoten {
  const sprache = lang ?? (pfad.endsWith('.tsx') ? 'tsx' : 'ts');
  const ergebnis = parseSync(pfad, text, { lang: sprache, sourceType: 'module' });
  if (ergebnis.errors.length > 0) {
    throw new Error(`${pfad}: ${ergebnis.errors[0].message}`);
  }
  return ergebnis.program as unknown as AstKnoten;
}

const istKnoten = (wert: unknown): wert is AstKnoten =>
  typeof wert === 'object' && wert !== null && typeof (wert as AstKnoten).type === 'string';

/**
 * Geht in Quelltext-Reihenfolge über alle Knoten und reicht den Elternknoten mit. Liefert der
 * Besuch `false`, bleiben die Kinder dieses Knotens unbesucht.
 */
export function walk(
  wurzel: AstKnoten,
  besuch: (knoten: AstKnoten, eltern: AstKnoten | null) => boolean | void,
): void {
  const gehe = (knoten: AstKnoten, eltern: AstKnoten | null) => {
    if (besuch(knoten, eltern) === false) return;
    const kinder: AstKnoten[] = [];
    for (const schluessel of visitorKeys[knoten.type] ?? []) {
      const kind = knoten[schluessel];
      if (Array.isArray(kind)) {
        for (const element of kind) if (istKnoten(element)) kinder.push(element);
      } else if (istKnoten(kind)) {
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
export function zeileVon(text: string, offset: number): number {
  let zeile = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) zeile++;
  return zeile;
}

/** Quelltext eines Knotens. */
export const textVon = (text: string, knoten: AstKnoten): string =>
  text.slice(knoten.start, knoten.end);

/** String-Literal (`'x'`, `"x"`); Zahlen, `null` und reguläre Ausdrücke zählen nicht. */
export const istStringLiteral = (
  knoten: AstKnoten | null | undefined,
): knoten is AstKnoten & { type: 'Literal'; value: string } =>
  knoten?.type === 'Literal' && typeof knoten.value === 'string';

/**
 * Statischer Text eines String-Literals oder eines Template-Literals ohne Platzhalter (wie TS
 * `isStringLiteralLike`); sonst `undefined`.
 */
export function statischerText(knoten: AstKnoten | null | undefined): string | undefined {
  if (istStringLiteral(knoten)) return knoten.value;
  if (knoten?.type === 'TemplateLiteral' && (knoten.expressions as AstKnoten[]).length === 0) {
    return templateTeilText((knoten.quasis as AstKnoten[])[0]);
  }
  return undefined;
}

/** Text eines Template-Teils (`TemplateElement`), aufgelöst wie TS `.text`. */
const templateTeilText = (teil: AstKnoten): string => {
  const wert = teil.value as { cooked: string | null; raw: string };
  return wert.cooked ?? wert.raw;
};

/** Re-Exporte (`export { a } from`, `export { a }`, `export * from`) tragen keine sichtbaren Texte. */
const istImportOderReExport = (knoten: AstKnoten): boolean =>
  knoten.type === 'ImportDeclaration' ||
  knoten.type === 'ExportAllDeclaration' ||
  (knoten.type === 'ExportNamedDeclaration' && knoten.declaration == null);

/**
 * Sichtbare Zeichenketten einer Quelle: String-Literale, Template-Teile und JSX-Text, je mit
 * 1-basierter Zeile. Ohne Import- und Re-Export-Pfade. Ein Template-Teil zählt ab seinem Backtick
 * bzw. ab der schließenden Klammer davor, ein JSX-Text ab seinem ersten sichtbaren Zeichen (beides
 * wie zuvor `getStart` der TS-Token).
 */
export function sichtbareTexte(pfad: string, text: string): { text: string; zeile: number }[] {
  const texte: { text: string; zeile: number }[] = [];
  walk(parseQuelltext(pfad, text), (knoten) => {
    if (istImportOderReExport(knoten)) return false;
    if (istStringLiteral(knoten))
      texte.push({ text: knoten.value, zeile: zeileVon(text, knoten.start) });
    else if (knoten.type === 'TemplateElement')
      texte.push({ text: templateTeilText(knoten), zeile: zeileVon(text, knoten.start - 1) });
    else if (knoten.type === 'JSXText') {
      const roh = (knoten.raw as string | undefined) ?? (knoten.value as string);
      // Wie TS `getStart`: führende Leerzeichen und Umbrüche zählen nicht zur Zeile.
      const fuehrend = /^\s*/.exec(roh)?.[0].length ?? 0;
      texte.push({ text: roh, zeile: zeileVon(text, knoten.start + fuehrend) });
    }
  });
  return texte;
}

const HUELLEN = new Set([
  'ParenthesizedExpression',
  'ChainExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
]);

/** Der Ausdruck ohne Klammern, `?.`-Kette, `as`, `satisfies` und `!` drumherum. */
export function ohneHuelle(knoten: AstKnoten): AstKnoten {
  let aktuell = knoten;
  while (HUELLEN.has(aktuell.type) && istKnoten(aktuell.expression)) aktuell = aktuell.expression;
  return aktuell;
}
