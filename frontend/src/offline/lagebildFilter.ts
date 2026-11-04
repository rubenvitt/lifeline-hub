import { type DehydrateOptions, type Query, type QueryClient } from '@tanstack/react-query';
import { EINSATZ_KEYS, istLagebildOfflineKey } from '../api/queryKeys';
import { HOECHSTLIEGEZEIT_MS } from './lagebildStart';

/**
 * Sperrmarken nach Rechteentzug (LFH-723, design.md D6), je QueryClient und nur im Speicher.
 *
 * Nach einer 403 verliert eine BEOBACHTETE Query ihre Daten, bleibt aber im Cache — eine
 * Geschwister-Query steht danach auf `success` mit `data: undefined` und würde ohne Marke so
 * geschrieben. Die Marke gilt bis zum nächsten Fetch-Erfolg im Bereich.
 */
const SPERREN = new WeakMap<QueryClient, Set<string>>();

/** `einsatz` sperrt alles des Einsatzes, `prefix` nur den Prefix des Keys in diesem Einsatz,
 *  `unterbereich` nur Prefix und dritte Stelle (die Kräfte-Zeitachse je Modul, LLH-1462). */
export type LagebildSperrBereich = 'einsatz' | 'prefix' | 'unterbereich';

function einsatzMarke(einsatzId: number) {
  return `e:${einsatzId}`;
}
function prefixMarke(prefix: unknown, einsatzId: number) {
  return `p:${String(prefix)}:${einsatzId}`;
}
function unterMarke(key: readonly unknown[], einsatzId: number) {
  return `u:${String(key[0])}:${String(key[2])}:${einsatzId}`;
}

function marke(key: readonly unknown[], einsatzId: number, bereich: LagebildSperrBereich) {
  if (bereich === 'einsatz') return einsatzMarke(einsatzId);
  return bereich === 'prefix' ? prefixMarke(key[0], einsatzId) : unterMarke(key, einsatzId);
}

export function lagebildSperren(
  qc: QueryClient,
  key: readonly unknown[],
  bereich: LagebildSperrBereich,
): void {
  const einsatzId = key[1];
  if (typeof einsatzId !== 'number') return;
  let marken = SPERREN.get(qc);
  if (!marken) SPERREN.set(qc, (marken = new Set()));
  marken.add(marke(key, einsatzId, bereich));
}

/** Nach einem Fetch-Erfolg: Prefix- und Unterbereichs-Marke des Keys fallen, die Einsatz-Marke nur mit dem
 *  Einsatzkopf selbst — erst er belegt, dass der Einsatz wieder lesbar ist. */
export function lagebildEntsperren(qc: QueryClient, key: readonly unknown[]): void {
  const einsatzId = key[1];
  const marken = SPERREN.get(qc);
  if (!marken || typeof einsatzId !== 'number') return;
  marken.delete(prefixMarke(key[0], einsatzId));
  if (key.length > 2) marken.delete(unterMarke(key, einsatzId));
  if (key[0] === EINSATZ_KEYS.einsatz) marken.delete(einsatzMarke(einsatzId));
}

export function istLagebildGesperrt(qc: QueryClient, key: readonly unknown[]): boolean {
  const einsatzId = key[1];
  const marken = SPERREN.get(qc);
  if (!marken || typeof einsatzId !== 'number') return false;
  return (
    marken.has(einsatzMarke(einsatzId)) ||
    marken.has(prefixMarke(key[0], einsatzId)) ||
    (key.length > 2 && marken.has(unterMarke(key, einsatzId)))
  );
}

/**
 * Räummarken nach einer Schwärzung (LFH-996, design.md D3/D5), je QueryClient und nur im
 * Speicher: ein Stand eines Einsatzes, der vor seiner Marke abgerufen wurde, gilt nicht mehr.
 * Gesetzt nur vom Schwärzungswächter (`schwaerzungsWaechter.ts`); die Zeit ist Geräteuhr wie
 * `dataUpdatedAt`, es wird nie gegen die Serveruhr verglichen.
 */
const RAEUMMARKEN = new WeakMap<QueryClient, Map<number, number>>();

export function lagebildRaeummarkeSetzen(qc: QueryClient, einsatzId: number, zeit: number): void {
  let marken = RAEUMMARKEN.get(qc);
  if (!marken) RAEUMMARKEN.set(qc, (marken = new Map()));
  marken.set(einsatzId, Math.max(zeit, marken.get(einsatzId) ?? 0));
}

function vorRaeummarke(qc: QueryClient, key: readonly unknown[], dataUpdatedAt: number): boolean {
  const einsatzId = key[1];
  if (typeof einsatzId !== 'number') return false;
  const marke = RAEUMMARKEN.get(qc)?.get(einsatzId);
  return marke !== undefined && dataUpdatedAt < marke;
}

/**
 * Darf dieser Einzelstand auf die Platte bzw. zurück in den Speicher? Nur die Allowlist, nichts
 * Gesperrtes, nichts vor der Räummarke seines Einsatzes (LFH-996), und nur ein Stand, dessen
 * letzter Abruf höchstens {@link HOECHSTLIEGEZEIT_MS} zurückliegt: `bestaetigtAt` gilt je Benutzer — ein Einsatz, den niemand mehr öffnet, trüge
 * seinen alten Stand sonst unbegrenzt weiter, solange die Person anderswo arbeitet, auch nach
 * einem Rechteentzug, den kein Abruf mehr bemerkt (Review LFH-723, Befund 3).
 */
export function lagebildStandZulaessig(
  qc: QueryClient,
  key: readonly unknown[],
  dataUpdatedAt: number,
  jetzt = Date.now(),
): boolean {
  return (
    istLagebildOfflineKey(key) &&
    !istLagebildGesperrt(qc, key) &&
    !vorRaeummarke(qc, key, dataUpdatedAt) &&
    dataUpdatedAt >= jetzt - HOECHSTLIEGEZEIT_MS
  );
}

/**
 * Trägt die Query einen Stand? Erfolg, oder Fehler MIT Daten: fällt der Server im laufenden Tab
 * weg, stehen die Queries nach den Wiederholungen auf `error` und behalten ihren letzten guten
 * Stand. `defaultShouldDehydrateQuery` nähme nur `success` — die nächste Speicherung trüge den
 * Stand dann von der Platte, und genau das Neuladen danach fände nichts. Ein per Rechteentzug
 * geleerter Bereich hat keine Daten mehr und fällt hier heraus.
 */
function hatStand(query: Query): boolean {
  const { status, data } = query.state;
  return data !== undefined && (status === 'success' || status === 'error');
}

/**
 * Die Dehydrier-Optionen des Persisters: nur Stände (`hatStand`), die {@link lagebildStandZulaessig}
 * sind, und **keine Mutationen**. Ohne die zweite Regel nähme `dehydrate` jede pausierte
 * Mutation samt `variables` mit — ohne Netz pausiert jede (`networkMode: 'online'`), also
 * Chat-Texte und Personen-PATCHes (Review LFH-723, Befund 1). Offline-Schreiben läuft über die
 * Offline-Queue, nicht über den Mutations-Cache. Der Guard prüft GENAU diese Optionen.
 */
export function lagebildDehydrierOptionen(qc: QueryClient): DehydrateOptions {
  return {
    shouldDehydrateQuery: (query: Query) =>
      hatStand(query) && lagebildStandZulaessig(qc, query.queryKey, query.state.dataUpdatedAt),
    shouldDehydrateMutation: () => false,
  };
}
