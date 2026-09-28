import { defaultShouldDehydrateQuery, type Query, type QueryClient } from '@tanstack/react-query';
import { EINSATZ_KEYS, istLagebildOfflineKey } from '../api/queryKeys';

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

/** Der Dehydrier-Filter des Persisters: nur Erfolgsstände, nur die Allowlist, nichts
 *  Gesperrtes. Der Guard prüft GENAU diese Funktion, nicht eine Nachbildung. */
export function lagebildDehydrierFilter(qc: QueryClient) {
  return (query: Query): boolean =>
    defaultShouldDehydrateQuery(query) &&
    istLagebildOfflineKey(query.queryKey) &&
    !istLagebildGesperrt(qc, query.queryKey);
}
