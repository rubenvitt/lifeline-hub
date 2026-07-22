/**
 * AST-Scanner für handgerollte Objekt-Typen im API-Seam (LFH-265, Teil A).
 *
 * Zweck: `frontend/src/api/*.ts` soll Response-Formen NICHT mehr von Hand beschreiben, sondern
 * aus `types.generated.ts` re-exportieren. Eine Handrolle driftet still gegen das Backend — genau
 * das, was der Typ-Codegen (LFH-120) verhindern soll. Der Guard `apiResponseTypen.guard.test.ts`
 * konsumiert diesen Scanner.
 *
 * MECHANIK GEERBT von `queryKeyScan.ts` (LFH-312): TS-AST statt zeilenlokaler Regex. Dieselben
 * drei Gründe gelten hier unverändert — mehrzeilige Deklarationen sind sichtbar, Kommentare sind
 * strukturell keine Knoten (kein Fehlalarm für ein auskommentiertes `export interface`), und der
 * Formatierungsstil ist egal.
 *
 * BEWUSST OHNE `import.meta.glob` — wie im Vorbild: der Scanner nimmt Quelltext als String
 * entgegen, das Glob bleibt im Guard-Test. Sonst landete bei einem versehentlichen
 * Produktiv-Import der komplette Quelltext des Frontends im App-Bundle.
 *
 * ERFASST WERDEN ZWEI FORMEN, damit die naheliegende Umgehung nicht offensteht:
 *   `export interface X { … }`       → art 'interface'
 *   `export type X = { … }`          → art 'objekt-alias'
 * Ein `export type X = S['…']` (der erwünschte Re-Export) ist ein IndexedAccessType, kein
 * TypeLiteral, und wird NICHT gemeldet. Ein Mapped Type (`{ [K in keyof T]?: … }`, z. B.
 * `PatchWire` in `patchTriState.ts`) ist ebenfalls ein eigener Knoten und fällt nicht auf.
 *
 * WAS DER SCANNER NICHT SIEHT — bewusste Grenzen, damit die nächste Session nicht raten muss:
 *  1. STRUKTURELLE UMSCHREIBUNGEN einer Handrolle, die kein TypeLiteral sind: ein Interface, das
 *     per `extends` von einem anderen erbt und selbst leer ist, oder eine Intersection aus
 *     benannten Typen (`type X = A & B`). Beides ist im Bestand nicht vorhanden.
 *  2. OB DER RE-EXPORT DAS RICHTIGE SCHEMA TRIFFT. Der Guard prüft die FORM (Handrolle vs.
 *     Re-Export), nicht, ob `OfflineKarte` auf `OfflineKarteAntwort` statt auf `OfflineKarte`
 *     zeigt. Das leistet der Typecheck an den Konsumenten, nicht dieser Scanner.
 *  3. NICHT-EXPORTIERTE lokale Hilfstypen. Sie verlassen das Modul nicht und sind kein Vertrag.
 */
import * as ts from 'typescript';

export type ApiTypArt = 'interface' | 'objekt-alias';

export interface ApiTypFund {
  pfad: string;
  /** 1-basiert, wie in Editor-/Guard-Meldungen üblich. */
  zeile: number;
  name: string;
  art: ApiTypArt;
  /** `<dateiname>#<Name>` — der Schlüssel, unter dem die Allowlist einen Eintrag führt.
   *  Datei-qualifiziert, weil Namen kollidieren (`AdhocEingabe` gibt es zweimal). */
  schluessel: string;
}

const istExportiert = (knoten: ts.Node): boolean =>
  ts.canHaveModifiers(knoten) &&
  (ts.getModifiers(knoten) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Dateiname ohne Verzeichnis — die Allowlist soll beim Verschieben des Ordners nicht brechen. */
const dateiname = (pfad: string): string => pfad.split('/').pop() ?? pfad;

/** Meldet jede exportierte Objekt-Typ-Deklaration einer Datei (siehe Kopfkommentar). */
export function scanneApiTypen(pfad: string, quelltext: string): ApiTypFund[] {
  const quelle = ts.createSourceFile(pfad, quelltext, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const funde: ApiTypFund[] = [];
  const zeileVon = (knoten: ts.Node): number =>
    quelle.getLineAndCharacterOfPosition(knoten.getStart(quelle)).line + 1;

  const melde = (name: string, art: ApiTypArt, knoten: ts.Node): void => {
    funde.push({ pfad, zeile: zeileVon(knoten), name, art, schluessel: `${dateiname(pfad)}#${name}` });
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
