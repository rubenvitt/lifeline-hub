import {
  defaultShouldDehydrateQuery,
  type DehydrateOptions,
  type Query,
  type QueryClient,
} from '@tanstack/react-query';
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

/** `einsatz` sperrt alles des Einsatzes, `prefix` nur den Prefix des Keys in diesem Einsatz. */
export type LagebildSperrBereich = 'einsatz' | 'prefix';

function einsatzMarke(einsatzId: number) {
  return `e:${einsatzId}`;
}
function prefixMarke(prefix: unknown, einsatzId: number) {
  return `p:${String(prefix)}:${einsatzId}`;
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
  marken.add(bereich === 'einsatz' ? einsatzMarke(einsatzId) : prefixMarke(key[0], einsatzId));
}

/** Nach einem Fetch-Erfolg: die Prefix-Marke des Keys fällt, die Einsatz-Marke nur mit dem
 *  Einsatzkopf selbst — erst er belegt, dass der Einsatz wieder lesbar ist. */
export function lagebildEntsperren(qc: QueryClient, key: readonly unknown[]): void {
  const einsatzId = key[1];
  const marken = SPERREN.get(qc);
  if (!marken || typeof einsatzId !== 'number') return;
  marken.delete(prefixMarke(key[0], einsatzId));
  if (key[0] === EINSATZ_KEYS.einsatz) marken.delete(einsatzMarke(einsatzId));
}

export function istLagebildGesperrt(qc: QueryClient, key: readonly unknown[]): boolean {
  const einsatzId = key[1];
  const marken = SPERREN.get(qc);
  if (!marken || typeof einsatzId !== 'number') return false;
  return marken.has(einsatzMarke(einsatzId)) || marken.has(prefixMarke(key[0], einsatzId));
}

/**
 * Darf dieser Einzelstand auf die Platte bzw. zurück in den Speicher? Nur die Allowlist, nichts
 * Gesperrtes, und nur ein Stand, dessen letzter Abruf höchstens {@link HOECHSTLIEGEZEIT_MS}
 * zurückliegt: `bestaetigtAt` gilt je Benutzer — ein Einsatz, den niemand mehr öffnet, trüge
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
    dataUpdatedAt >= jetzt - HOECHSTLIEGEZEIT_MS
  );
}

/**
 * Die Dehydrier-Optionen des Persisters: nur Erfolgsstände, die {@link lagebildStandZulaessig}
 * sind, und **keine Mutationen**. Ohne die zweite Regel nähme `dehydrate` jede pausierte
 * Mutation samt `variables` mit — ohne Netz pausiert jede (`networkMode: 'online'`), also
 * Chat-Texte und Personen-PATCHes (Review LFH-723, Befund 1). Offline-Schreiben läuft über die
 * Offline-Queue, nicht über den Mutations-Cache. Der Guard prüft GENAU diese Optionen.
 */
export function lagebildDehydrierOptionen(qc: QueryClient): DehydrateOptions {
  return {
    shouldDehydrateQuery: (query: Query) =>
      defaultShouldDehydrateQuery(query) &&
      lagebildStandZulaessig(qc, query.queryKey, query.state.dataUpdatedAt),
    shouldDehydrateMutation: () => false,
  };
}
