/**
 * AST-Scanner für handgerollte Objekt-Typen im API-Seam (LFH-265), konsumiert von
 * `apiResponseTypen.guard.test.ts`. Response-Formen sollen aus `types.generated.ts`
 * re-exportiert werden; eine Handrolle driftet still gegen das Backend.
 *
 * Mechanik wie `queryKeyScan.ts`: TS-AST, ohne `import.meta.glob` (das Glob bleibt im
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
import * as ts from 'typescript';

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

const istExportiert = (knoten: ts.Node): boolean =>
  ts.canHaveModifiers(knoten) &&
  (ts.getModifiers(knoten) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Dateiname ohne Verzeichnis, damit die Allowlist beim Verschieben des Ordners nicht bricht. */
const dateiname = (pfad: string): string => pfad.split('/').pop() ?? pfad;

/** Meldet jede exportierte Objekt-Typ-Deklaration einer Datei (siehe Kopfkommentar). */
export function scanneApiTypen(pfad: string, quelltext: string): ApiTypFund[] {
  const quelle = ts.createSourceFile(
    pfad,
    quelltext,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const funde: ApiTypFund[] = [];
  const zeileVon = (knoten: ts.Node): number =>
    quelle.getLineAndCharacterOfPosition(knoten.getStart(quelle)).line + 1;

  const melde = (name: string, art: ApiTypArt, knoten: ts.Node): void => {
    funde.push({
      pfad,
      zeile: zeileVon(knoten),
      name,
      art,
      schluessel: `${dateiname(pfad)}#${name}`,
    });
  };

  const gehe = (knoten: ts.Node): void => {
    if (ts.isInterfaceDeclaration(knoten) && istExportiert(knoten)) {
      melde(knoten.name.text, 'interface', knoten);
    } else if (
      ts.isTypeAliasDeclaration(knoten) &&
      istExportiert(knoten) &&
      ts.isTypeLiteralNode(knoten.type)
    ) {
      melde(knoten.name.text, 'objekt-alias', knoten);
    }
    ts.forEachChild(knoten, gehe);
  };
  gehe(quelle);
  return funde;
}
