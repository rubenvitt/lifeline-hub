/**
 * AST-Scanner für Query-Key-Fundstellen (LFH-312), AST über `lib/sourceAst` (oxc-parser, LLH-2020). Sieht mehrzeilige Literale, ignoriert
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
import { type AstNode, parseSource, staticText, textOf, walk, lineOf } from '../lib/sourceAst';

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
function calleeName(ausdruck: AstNode): string | undefined {
  if (ausdruck.type === 'Identifier') return ausdruck.name as string;
  if (ausdruck.type === 'MemberExpression' && !ausdruck.computed) {
    const eigenschaft = ausdruck.property as AstNode;
    if (eigenschaft.type === 'Identifier') return eigenschaft.name as string;
  }
  return undefined;
}

type ParentOf = Map<AstNode, AstNode>;

/** Ist dieses Array-Literal ein Query-Key — und wenn ja, in welchem Kontext? */
function schluesselKontext(arr: AstNode, parentOf: ParentOf): FundArt | undefined {
  const eltern = parentOf.get(arr);
  if (!eltern) return undefined;
  if (
    eltern.type === 'Property' &&
    eltern.kind === 'init' &&
    !eltern.method &&
    !eltern.shorthand &&
    !eltern.computed &&
    eltern.value === arr
  ) {
    const schluessel = eltern.key as AstNode;
    const name =
      schluessel.type === 'Identifier' ? (schluessel.name as string) : staticText(schluessel);
    if (name && SCHLUESSEL_PROPS.has(name)) return name as FundArt;
  }
  if (eltern.type === 'CallExpression' && (eltern.arguments as AstNode[])[0] === arr) {
    const name = calleeName(eltern.callee as AstNode);
    if (name && CACHE_CALLS.has(name)) return 'cache-call';
  }
  return undefined;
}

/** Name eines Parameters, wie TS ihn als `parameter.name` sah (auch mit Vorgabe oder `...`). */
function paramName(param: AstNode): string | undefined {
  let kern = param;
  if (kern.type === 'TSParameterProperty') kern = kern.parameter as AstNode;
  if (kern.type === 'AssignmentPattern') kern = kern.left as AstNode;
  else if (kern.type === 'RestElement') kern = kern.argument as AstNode;
  return kern.type === 'Identifier' ? (kern.name as string) : undefined;
}

const FUNCTION_VALUES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/**
 * Erkennt Funktionen, deren Parameter i strukturell an Position 0 eines Query-Key-Arrays landet
 * (`name → Parameterindex`). Damit wird `inval('einsatz-uhs')` sichtbar, wo das Literal in keinem
 * Array steht. Bestandsform:
 * `const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, id] })` in
 * `live/useEinsatzLiveStream.ts`. Hart auf EINEN Schritt in DERSELBEN Datei begrenzt; alles
 * darüber wäre Datenfluss-Analyse.
 */
function findeSchluesselHelfer(programm: AstNode, parentOf: ParentOf): Map<string, number> {
  const helfer = new Map<string, number>();

  const pruefeFunktion = (name: string | undefined, fn: AstNode): void => {
    const parameter = fn.params as AstNode[];
    if (!name || parameter.length === 0) return;
    const params = parameter.map(paramName);
    walk(fn, (knoten) => {
      if (knoten.type === 'ArrayExpression' && schluesselKontext(knoten, parentOf)) {
        const erstes = (knoten.elements as (AstNode | null)[])[0];
        if (erstes && erstes.type === 'Identifier') {
          const idx = params.indexOf(erstes.name as string);
          if (idx >= 0 && !helfer.has(name)) helfer.set(name, idx);
        }
      }
    });
  };

  walk(programm, (knoten) => {
    if (knoten.type === 'VariableDeclarator') {
      const id = knoten.id as AstNode;
      const init = knoten.init as AstNode | null;
      if (id.type === 'Identifier' && init && FUNCTION_VALUES.has(init.type)) {
        pruefeFunktion(id.name as string, init);
      }
    } else if (knoten.type === 'FunctionDeclaration' && knoten.id) {
      pruefeFunktion((knoten.id as AstNode).name as string, knoten);
    }
  });
  return helfer;
}

/**
 * Meldet jede Query-Key-Fundstelle einer Datei: jedes ArrayLiteral mit String-Literal an
 * Position 0, Template-Literale mit Platzhaltern (`dynamischer-prefix`) und String-Argumente an
 * lokale Key-Helfer. NICHT gemeldet: Identifier/PropertyAccess an Position 0
 * (`[EINSATZ_KEYS.uhs, id]` ist die erwünschte Form) und Spreads.
 */
export function scanneQueryKeys(pfad: string, quelltext: string): Fund[] {
  const programm = parseSource(pfad, quelltext);
  const parentOf: ParentOf = new Map();
  walk(programm, (knoten, eltern) => {
    if (eltern) parentOf.set(knoten, eltern);
  });
  const funde: Fund[] = [];
  const zeile = (knoten: AstNode): number => lineOf(quelltext, knoten.start);

  const helfer = findeSchluesselHelfer(programm, parentOf);

  walk(programm, (knoten) => {
    if (knoten.type === 'ArrayExpression') {
      const erstes = (knoten.elements as (AstNode | null)[])[0];
      const statisch = staticText(erstes);
      if (statisch !== undefined) {
        // Template ohne Platzhalter (`'…'` in Backticks) zählt als statischer Prefix.
        funde.push({
          pfad,
          zeile: zeile(knoten),
          prefix: statisch,
          art: schluesselKontext(knoten, parentOf) ?? 'array-literal',
        });
      } else if (erstes?.type === 'TemplateLiteral' && schluesselKontext(knoten, parentOf)) {
        funde.push({
          pfad,
          zeile: zeile(knoten),
          prefix: textOf(quelltext, erstes),
          art: 'dynamischer-prefix',
        });
      }
    } else if (knoten.type === 'CallExpression') {
      const name = calleeName(knoten.callee as AstNode);
      const idx = name === undefined ? undefined : helfer.get(name);
      if (idx !== undefined) {
        const arg = (knoten.arguments as AstNode[])[idx];
        const statisch = staticText(arg);
        if (statisch !== undefined) {
          funde.push({
            pfad,
            zeile: zeile(knoten),
            prefix: statisch,
            art: 'schluessel-helfer-arg',
          });
        }
      }
    }
  });
  return funde;
}
