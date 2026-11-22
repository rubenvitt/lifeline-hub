/**
 * AST-Scanner für Query-Key-Fundstellen (LFH-312), AST über `lib/quelltextAst` (oxc-parser, LLH-2020). Sieht mehrzeilige Literale, ignoriert
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
import {
  type AstKnoten,
  istStringLiteral,
  parseQuelltext,
  textVon,
  walk,
  zeileVon,
} from '../lib/quelltextAst';

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
function calleeName(ausdruck: AstKnoten): string | undefined {
  if (ausdruck.type === 'Identifier') return ausdruck.name as string;
  if (ausdruck.type === 'MemberExpression' && !ausdruck.computed) {
    const eigenschaft = ausdruck.property as AstKnoten;
    if (eigenschaft.type === 'Identifier') return eigenschaft.name as string;
  }
  return undefined;
}

/**
 * Statischer Text eines String-Literals oder eines Template-Literals ohne Platzhalter (TS:
 * `isStringLiteralLike`); sonst `undefined`.
 */
function statischerText(knoten: AstKnoten | null | undefined): string | undefined {
  if (istStringLiteral(knoten)) return knoten.value;
  if (knoten?.type === 'TemplateLiteral' && (knoten.expressions as AstKnoten[]).length === 0) {
    const [teil] = knoten.quasis as AstKnoten[];
    return (teil.value as { cooked: string | null }).cooked ?? undefined;
  }
  return undefined;
}

type ElternVon = Map<AstKnoten, AstKnoten>;

/** Ist dieses Array-Literal ein Query-Key — und wenn ja, in welchem Kontext? */
function schluesselKontext(arr: AstKnoten, elternVon: ElternVon): FundArt | undefined {
  const eltern = elternVon.get(arr);
  if (!eltern) return undefined;
  if (
    eltern.type === 'Property' &&
    eltern.kind === 'init' &&
    !eltern.method &&
    !eltern.shorthand &&
    !eltern.computed &&
    eltern.value === arr
  ) {
    const schluessel = eltern.key as AstKnoten;
    const name =
      schluessel.type === 'Identifier' ? (schluessel.name as string) : statischerText(schluessel);
    if (name && SCHLUESSEL_PROPS.has(name)) return name as FundArt;
  }
  if (eltern.type === 'CallExpression' && (eltern.arguments as AstKnoten[])[0] === arr) {
    const name = calleeName(eltern.callee as AstKnoten);
    if (name && CACHE_CALLS.has(name)) return 'cache-call';
  }
  return undefined;
}

/** Name eines Parameters, wie TS ihn als `parameter.name` sah (auch mit Vorgabe oder `...`). */
function parameterName(param: AstKnoten): string | undefined {
  let kern = param;
  if (kern.type === 'TSParameterProperty') kern = kern.parameter as AstKnoten;
  if (kern.type === 'AssignmentPattern') kern = kern.left as AstKnoten;
  else if (kern.type === 'RestElement') kern = kern.argument as AstKnoten;
  return kern.type === 'Identifier' ? (kern.name as string) : undefined;
}

const FUNKTIONSWERTE = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/**
 * Erkennt Funktionen, deren Parameter i strukturell an Position 0 eines Query-Key-Arrays landet
 * (`name → Parameterindex`). Damit wird `inval('einsatz-uhs')` sichtbar, wo das Literal in keinem
 * Array steht. Bestandsform:
 * `const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, id] })` in
 * `live/useEinsatzLiveStream.ts`. Hart auf EINEN Schritt in DERSELBEN Datei begrenzt; alles
 * darüber wäre Datenfluss-Analyse.
 */
function findeSchluesselHelfer(programm: AstKnoten, elternVon: ElternVon): Map<string, number> {
  const helfer = new Map<string, number>();

  const pruefeFunktion = (name: string | undefined, fn: AstKnoten): void => {
    const parameter = fn.params as AstKnoten[];
    if (!name || parameter.length === 0) return;
    const params = parameter.map(parameterName);
    walk(fn, (knoten) => {
      if (knoten.type === 'ArrayExpression' && schluesselKontext(knoten, elternVon)) {
        const erstes = (knoten.elements as (AstKnoten | null)[])[0];
        if (erstes && erstes.type === 'Identifier') {
          const idx = params.indexOf(erstes.name as string);
          if (idx >= 0 && !helfer.has(name)) helfer.set(name, idx);
        }
      }
    });
  };

  walk(programm, (knoten) => {
    if (knoten.type === 'VariableDeclarator') {
      const id = knoten.id as AstKnoten;
      const init = knoten.init as AstKnoten | null;
      if (id.type === 'Identifier' && init && FUNKTIONSWERTE.has(init.type)) {
        pruefeFunktion(id.name as string, init);
      }
    } else if (knoten.type === 'FunctionDeclaration' && knoten.id) {
      pruefeFunktion((knoten.id as AstKnoten).name as string, knoten);
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
  const programm = parseQuelltext(pfad, quelltext);
  const elternVon: ElternVon = new Map();
  walk(programm, (knoten, eltern) => {
    if (eltern) elternVon.set(knoten, eltern);
  });
  const funde: Fund[] = [];
  const zeile = (knoten: AstKnoten): number => zeileVon(quelltext, knoten.start);

  const helfer = findeSchluesselHelfer(programm, elternVon);

  walk(programm, (knoten) => {
    if (knoten.type === 'ArrayExpression') {
      const erstes = (knoten.elements as (AstKnoten | null)[])[0];
      const statisch = statischerText(erstes);
      if (statisch !== undefined) {
        // Template ohne Platzhalter (`'…'` in Backticks) zählt als statischer Prefix.
        funde.push({
          pfad,
          zeile: zeile(knoten),
          prefix: statisch,
          art: schluesselKontext(knoten, elternVon) ?? 'array-literal',
        });
      } else if (erstes?.type === 'TemplateLiteral' && schluesselKontext(knoten, elternVon)) {
        funde.push({
          pfad,
          zeile: zeile(knoten),
          prefix: textVon(quelltext, erstes),
          art: 'dynamischer-prefix',
        });
      }
    } else if (knoten.type === 'CallExpression') {
      const name = calleeName(knoten.callee as AstKnoten);
      const idx = name === undefined ? undefined : helfer.get(name);
      if (idx !== undefined) {
        const arg = (knoten.arguments as AstKnoten[])[idx];
        const statisch = statischerText(arg);
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
