/**
 * AST-Scanner für Query-Key-Fundstellen (LFH-312). Sieht mehrzeilige Literale, ignoriert
 * Kommentare strukturell und kennt den Kontext (`['KB','MB']` gegen `queryKey: [...]`).
 *
 * BEWUSST OHNE `import.meta.glob`: der Scanner nimmt Quelltext als String entgegen, das Glob
 * bleibt im Guard-Test. Sonst landete bei einem versehentlichen Produktiv-Import der Quelltext
 * des Frontends im App-Bundle.
 *
 * ZWEI RADIEN (siehe {@link ENGE_ARTEN}):
 *   WEIT (alle Arten): für die Denylist-Guards. „Steht ein VERBOTENER String an Position 0
 *     IRGENDEINES Arrays?“ Fängt auch die Extraktion in eine Konstante.
 *   ENG (nur Query-Key-Kontexte): für den Allowlist-Guard (f); darf Konstanten wie
 *     `['KB','MB','GB','TB']` nicht anfassen.
 */
import * as ts from 'typescript';

/**
 * Aufrufe des QueryClient, die einen Query-Key als ERSTES ARGUMENT nehmen (v4-Stil,
 * `qc.invalidateQueries(['key'])`). Die v5-Form `{ queryKey: ['key'] }` erfasst das
 * `queryKey`-PropertyAssignment.
 */
const CACHE_CALLS = new Set([
  'invalidateQueries',
  'setQueryData',
  'getQueryData',
  'setQueriesData',
  'getQueriesData',
  'removeQueries',
  'refetchQueries',
  'cancelQueries',
  'resetQueries',
  'fetchQuery',
  'prefetchQuery',
  'ensureQueryData',
  'getQueryState',
]);

/** Property-Namen, deren Array-Initializer ein Query-Key ist. */
const SCHLUESSEL_PROPS = new Set(['queryKey', 'mutationKey']);

export type FundArt =
  /** Array ist Initializer eines `queryKey:`-PropertyAssignment. */
  | 'queryKey'
  /** Array ist Initializer eines `mutationKey:`-PropertyAssignment. */
  | 'mutationKey'
  /** Array ist erstes Argument eines Cache-Aufrufs (v4-Stil). */
  | 'cache-call'
  /** Irgendein anderes Array-Literal mit String an Position 0. */
  | 'array-literal'
  /** Template-Literal MIT Platzhaltern an Position 0 — kein Prefix ableitbar. */
  | 'dynamischer-prefix'
  /** String-Literal, das in einen lokalen Key-Helfer fließt (`inval('einsatz-uhs')`). */
  | 'schluessel-helfer-arg';

/**
 * Arten, die der Allowlist-Guard (f) konsumiert: der ENGE Radius. `array-literal` fehlt, sonst
 * wären beliebige String-Arrays Verstöße. `dynamischer-prefix` fehlt, weil es keinen Prefix zum
 * Vergleichen gibt; der Guard verbietet die Art gesondert.
 */
export const ENGE_ARTEN: readonly FundArt[] = [
  'queryKey',
  'mutationKey',
  'cache-call',
  'schluessel-helfer-arg',
];

export interface Fund {
  pfad: string;
  /** 1-basiert, wie in Editor-/Guard-Meldungen üblich. */
  zeile: number;
  /** Erstes Array-Element als String; bei `dynamischer-prefix` der Rohtext des Templates. */
  prefix: string;
  art: FundArt;
}

/** Name des Callees einer CallExpression (`f()` → 'f', `qc.invalidateQueries()` → 'invalidateQueries'). */
function calleeName(ausdruck: ts.Expression): string | undefined {
  if (ts.isIdentifier(ausdruck)) return ausdruck.text;
  if (ts.isPropertyAccessExpression(ausdruck)) return ausdruck.name.text;
  return undefined;
}

/** Ist dieses Array-Literal ein Query-Key — und wenn ja, in welchem Kontext? */
function schluesselKontext(arr: ts.ArrayLiteralExpression): FundArt | undefined {
  const eltern = arr.parent;
  if (!eltern) return undefined;
  if (ts.isPropertyAssignment(eltern) && eltern.initializer === arr) {
    const name =
      ts.isIdentifier(eltern.name) || ts.isStringLiteralLike(eltern.name)
        ? eltern.name.text
        : undefined;
    if (name && SCHLUESSEL_PROPS.has(name)) return name as FundArt;
  }
  if (ts.isCallExpression(eltern) && eltern.arguments[0] === arr) {
    const name = calleeName(eltern.expression);
    if (name && CACHE_CALLS.has(name)) return 'cache-call';
  }
  return undefined;
}

/**
 * Erkennt Funktionen, deren Parameter i strukturell an Position 0 eines Query-Key-Arrays landet
 * (`name → Parameterindex`). Damit wird `inval('einsatz-uhs')` sichtbar, wo das Literal in keinem
 * Array steht. Bestandsform:
 * `const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, id] })` in
 * `live/useEinsatzLiveStream.ts`. Hart auf EINEN Schritt in DERSELBEN Datei begrenzt; alles
 * darüber wäre Datenfluss-Analyse.
 */
function findeSchluesselHelfer(quelle: ts.SourceFile): Map<string, number> {
  const helfer = new Map<string, number>();

  const pruefeFunktion = (name: string | undefined, fn: ts.SignatureDeclaration): void => {
    if (!name || fn.parameters.length === 0) return;
    const params = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : undefined));
    const suche = (knoten: ts.Node): void => {
      if (ts.isArrayLiteralExpression(knoten) && schluesselKontext(knoten)) {
        const erstes = knoten.elements[0];
        if (erstes && ts.isIdentifier(erstes)) {
          const idx = params.indexOf(erstes.text);
          if (idx >= 0 && !helfer.has(name)) helfer.set(name, idx);
        }
      }
      ts.forEachChild(knoten, suche);
    };
    ts.forEachChild(fn, suche);
  };

  const gehe = (knoten: ts.Node): void => {
    if (ts.isVariableDeclaration(knoten) && ts.isIdentifier(knoten.name) && knoten.initializer) {
      const init = knoten.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        pruefeFunktion(knoten.name.text, init);
      }
    } else if (ts.isFunctionDeclaration(knoten) && knoten.name) {
      pruefeFunktion(knoten.name.text, knoten);
    }
    ts.forEachChild(knoten, gehe);
  };
  gehe(quelle);
  return helfer;
}

/**
 * Meldet jede Query-Key-Fundstelle einer Datei: jedes ArrayLiteral mit String-Literal an
 * Position 0, Template-Literale mit Platzhaltern (`dynamischer-prefix`) und String-Argumente an
 * lokale Key-Helfer. NICHT gemeldet: Identifier/PropertyAccess an Position 0
 * (`[EINSATZ_KEYS.uhs, id]` ist die erwünschte Form) und Spreads.
 */
export function scanneQueryKeys(pfad: string, quelltext: string): Fund[] {
  const tsx = pfad.endsWith('.tsx');
  const quelle = ts.createSourceFile(
    pfad,
    quelltext,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const funde: Fund[] = [];
  const zeileVon = (knoten: ts.Node): number =>
    quelle.getLineAndCharacterOfPosition(knoten.getStart(quelle)).line + 1;

  const helfer = findeSchluesselHelfer(quelle);

  const gehe = (knoten: ts.Node): void => {
    if (ts.isArrayLiteralExpression(knoten)) {
      const erstes = knoten.elements[0];
      if (erstes && ts.isStringLiteralLike(erstes)) {
        // NoSubstitutionTemplateLiteral (`'…'` ohne Platzhalter) zählt als statischer Prefix.
        funde.push({
          pfad,
          zeile: zeileVon(knoten),
          prefix: erstes.text,
          art: schluesselKontext(knoten) ?? 'array-literal',
        });
      } else if (erstes && ts.isTemplateExpression(erstes) && schluesselKontext(knoten)) {
        funde.push({
          pfad,
          zeile: zeileVon(knoten),
          prefix: erstes.getText(quelle),
          art: 'dynamischer-prefix',
        });
      }
    } else if (ts.isCallExpression(knoten)) {
      const name = calleeName(knoten.expression);
      const idx = name === undefined ? undefined : helfer.get(name);
      if (idx !== undefined) {
        const arg = knoten.arguments[idx];
        if (arg && ts.isStringLiteralLike(arg)) {
          funde.push({
            pfad,
            zeile: zeileVon(knoten),
            prefix: arg.text,
            art: 'schluessel-helfer-arg',
          });
        }
      }
    }
    ts.forEachChild(knoten, gehe);
  };
  gehe(quelle);
  return funde;
}
