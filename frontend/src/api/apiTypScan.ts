/**
 * AST-Scanner für handgerollte Objekt-Typen im API-Seam (LFH-265), konsumiert von
 * `apiResponseTypen.guard.test.ts`. Response-Formen sollen aus `types.generated.ts`
 * re-exportiert werden; eine Handrolle driftet still gegen das Backend.
 *
 * Mechanik wie `queryKeyScan.ts`: AST über `lib/sourceAst` (oxc-parser, LLH-2020), ohne `import.meta.glob` (das Glob bleibt im
 * Guard-Test, sonst landete bei einem Produktiv-Import der Quelltext im Bundle).
 *
 * ERFASST: `export interface X { … }` (art 'interface') und `export type X = { … }` (art
 * 'objekt-alias'). NICHT gemeldet: `export type X = S['…']` (IndexedAccessType) und Mapped Types
 * wie `PatchWire`.
 *
 * WAS DER SCANNER NICHT SIEHT:
 *  1. Strukturelle Umschreibungen, die kein TypeLiteral sind: ein leeres Interface mit `extends`
 *     oder eine Intersection benannter Typen (`type X = A & B`).
 *  2. Ob der Re-Export das RICHTIGE Schema trifft (das leistet der Typecheck der Konsumenten).
 *  3. Nicht-exportierte lokale Hilfstypen; sie sind kein Vertrag.
 */
import { type AstNode, parseSource, walk, lineOf } from '../lib/sourceAst';

export type ApiTypArt = 'interface' | 'objekt-alias';

export interface ApiTypFund {
  pfad: string;
  /** 1-basiert, wie in Editor-/Guard-Meldungen üblich. */
  zeile: number;
  name: string;
  art: ApiTypArt;
  /** `<dateiname>#<Name>`, der Schlüssel der Allowlist. Datei-qualifiziert, weil Namen
   *  kollidieren. */
  schluessel: string;
}

const EXPORT_HUELLEN = new Set(['ExportNamedDeclaration', 'ExportDefaultDeclaration']);

/** Dateiname ohne Verzeichnis, damit die Allowlist beim Verschieben des Ordners nicht bricht. */
const dateiname = (pfad: string): string => pfad.split('/').pop() ?? pfad;

/** Meldet jede exportierte Objekt-Typ-Deklaration einer Datei (siehe Kopfkommentar). */
export function scanneApiTypen(pfad: string, quelltext: string): ApiTypFund[] {
  const programm = parseSource(pfad, quelltext, 'ts');
  const funde: ApiTypFund[] = [];

  // Die Zeile zählt ab `export`, wie zuvor `getStart` des exportierten Knotens.
  const melde = (name: string, art: ApiTypArt, huelle: AstNode): void => {
    funde.push({
      pfad,
      zeile: lineOf(quelltext, huelle.start),
      name,
      art,
      schluessel: `${dateiname(pfad)}#${name}`,
    });
  };

  walk(programm, (knoten, eltern) => {
    if (!eltern || !EXPORT_HUELLEN.has(eltern.type) || eltern.declaration !== knoten) return;
    const name = (knoten.id as AstNode | null)?.name as string | undefined;
    if (!name) return;
    if (knoten.type === 'TSInterfaceDeclaration') {
      melde(name, 'interface', eltern);
    } else if (
      knoten.type === 'TSTypeAliasDeclaration' &&
      (knoten.typeAnnotation as AstNode).type === 'TSTypeLiteral'
    ) {
      melde(name, 'objekt-alias', eltern);
    }
  });
  return funde;
}
