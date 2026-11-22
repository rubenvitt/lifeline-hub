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

/** Geht in Quelltext-Reihenfolge über alle Knoten und reicht den Elternknoten mit. */
export function walk(
  wurzel: AstKnoten,
  besuch: (knoten: AstKnoten, eltern: AstKnoten | null) => void,
): void {
  const gehe = (knoten: AstKnoten, eltern: AstKnoten | null) => {
    besuch(knoten, eltern);
    for (const schluessel of visitorKeys[knoten.type] ?? []) {
      const kind = knoten[schluessel];
      if (Array.isArray(kind)) {
        for (const element of kind) if (istKnoten(element)) gehe(element, knoten);
      } else if (istKnoten(kind)) {
        gehe(kind, knoten);
      }
    }
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
