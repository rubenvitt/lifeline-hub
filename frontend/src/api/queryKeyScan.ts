/**
 * AST-Scanner für Query-Key-Fundstellen (LFH-312, AP3).
 *
 * Ersetzt die zeilenlokale Regex der Guards in `queryKeys.guard.test.ts`. Die Regex hatte
 * drei Schwächen, die hier strukturell entfallen:
 *   1. mehrzeilige Literale (`[\n  'einsatz-uhs',`) waren unsichtbar,
 *   2. Kommentare mussten per `istKommentarzeile`-Heuristik ausgefiltert werden (ein
 *      Block-Kommentar-Rumpf ohne `*`-Präfix rutschte trotzdem durch),
 *   3. es gab keinen Kontext — `['KB','MB']` und `queryKey: ['einsatz-uhs']` sahen gleich aus.
 *
 * BEWUSST OHNE `import.meta.glob`: der Scanner nimmt Quelltext als String entgegen. Das Glob
 * bleibt im Guard-Test. Würde diese Datei das Glob ziehen, landete bei einem versehentlichen
 * Produktiv-Import der komplette Quelltext des Frontends im App-Bundle.
 *
 * ZWEI RADIEN, absichtlich getrennt (siehe {@link ENGE_ARTEN}):
 *   WEIT (alle Arten) — für die Denylist-Guards (a)/(c)/(e). Sie fragen „steht ein VERBOTENER
 *     String an Position 0 IRGENDEINES Arrays". Das fängt auch die Extraktion in eine Konstante
 *     (`const K = ['einheiten', id]`) und entspricht dem Radius der bisherigen Regex.
 *   ENG (nur Query-Key-Kontexte) — für den Allowlist-Guard (f). Er fragt „ist dieser Query-Key
 *     erlaubt" und darf Sichtungskategorie-Konstanten wie `['KB','MB','GB','TB']` nicht anfassen.
 */
import * as ts from 'typescript';

/**
 * Aufrufe des QueryClient, die einen Query-Key als ERSTES ARGUMENT nehmen (TanStack v4-Stil,
 * `qc.invalidateQueries(['key'])`). Die im Bestand durchgängige v5-Form
 * `qc.invalidateQueries({ queryKey: ['key'] })` wird stattdessen über das
 * `queryKey`-PropertyAssignment erfasst — beide Formen sind damit abgedeckt.
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
 * Arten, die der Allowlist-Guard (f) konsumiert — der ENGE Radius.
 *
 * `array-literal` fehlt hier bewusst: sonst wären beliebige String-Arrays im Code
 * (`['KB','MB','GB','TB']`) Query-Key-Verstöße. `dynamischer-prefix` fehlt ebenfalls, weil
 * dort gar kein Prefix zum Vergleichen existiert — der Guard behandelt die Art gesondert
 * als immer-verboten (eine Allowlist kann einen unbekannten Prefix nicht erlauben).
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

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * (A)-ERWEITERUNG über den LFH-312-Plan hinaus — isoliert entfernbar.
 *
 * Der Plan erfasst ausdrücklich NUR Array-Literale („Identifier als erstes Element wird NICHT
 * gemeldet"). Diese Erweiterung deckt zusätzlich den Argumentpfad ab. Vom Team-Lead bewilligt
 * mit drei Auflagen, alle erfüllt: Pflicht-Mutationsprobe (`inval('einsatz-uhs')` → Guard (a)
 * UND (f) rot), null gemessene Fehlalarme im Bestand, und Abbruch bei ausufernder Analyse —
 * deshalb hart auf EINEN Schritt in DERSELBEN Datei begrenzt.
 *
 * Nutzen, prospektiv: LFH-307 migriert direkt im Anschluss ~90 Call-Sites. Ein still ins Leere
 * laufender `inval('…')` ist dort der teuerste Fehler — er macht keinen Test rot, er sorgt nur
 * dafür, dass eine fremde Änderung nicht mehr live ankommt.
 *
 * RÜCKBAU auf reinen Plan-Stand: diesen Block, `'schluessel-helfer-arg'` aus `FundArt` und
 * `ENGE_ARTEN`, den `isCallExpression`-Zweig in `scanneQueryKeys` und den describe-Block
 * „Indirektion über lokale Key-Helfer" in queryKeyScan.test.ts löschen. Sonst nichts.
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * Erkennt Funktionen, deren Parameter i strukturell an Position 0 eines Query-Key-Arrays landet,
 * und liefert `name → Parameterindex`. Damit wird anschließend `inval('einsatz-uhs')` sichtbar —
 * der dokumentierte Blindfleck der Regex-Variante (LFH-122/215): dort steht das Literal NICHT
 * in einem Array, keine `[\s*'`-Regel der Welt sieht es.
 *
 * Bestandsform: `const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, id] })`
 * in `live/useEinsatzLiveStream.ts` — die einzige Fundstelle im Repo.
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
 * Meldet jede Query-Key-Fundstelle einer Datei.
 *
 * Gemeldet wird jedes ArrayLiteral, dessen erstes Element ein String-Literal ist — plus
 * Template-Literale mit Platzhaltern (`dynamischer-prefix`) und String-Argumente an lokale
 * Key-Helfer. NICHT gemeldet werden Identifier/PropertyAccess an Position 0
 * (`[EINSATZ_KEYS.uhs, id]` ist die erwünschte Form) und Spreads.
 *
 * Kommentare fallen strukturell weg — sie sind keine AST-Knoten. Die alte
 * `istKommentarzeile`-Heuristik entfällt ersatzlos.
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
