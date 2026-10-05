import type { Query, QueryClient } from '@tanstack/react-query';
import { EINSATZ_KEYS, GLOBAL_KEYS, einsatzKeys, istKeyDesEinsatzes } from '../api/queryKeys';
import { lagebildRaeummarkeSetzen, lagebildSperren } from './lagebildFilter';

/**
 * Wächter der Schwärzung (LFH-996, Spec `lagebild-offline-lesen`, design.md D3–D5).
 *
 * Er liest nur zwei Antworten, die jedes Gerät ohnehin abruft: den Einsatzkopf und die
 * Einsatzliste. Beide tragen je Einsatz `teilschwaerzungen`, die Zahl der Schwärzungen an einem
 * noch lesbaren Einsatz (fehlt = 0, wächst nur).
 *
 * - **Höherer Stand als bekannt:** Räummarke des Einsatzes auf den Zeitpunkt dieser Antwort.
 *   Unbeobachtete Queries des Einsatzes gehen aus dem Speicher, beobachtete laden neu (auch
 *   Detail-Keys, die sonst nicht live sind). Ein laufender Abruf wird vorher abgebrochen: er kann
 *   vor der Schwärzung beantwortet sein und landete sonst mit einem Zeitpunkt nach der Marke.
 *   Ist der Kopf älter als die Marke (die Liste trug den Stand zuerst), lädt auch er neu, sonst
 *   fiele er bis zum nächsten Abruf aus dem Offline-Lagebild. Die Marke hält jeden älteren Stand
 *   von der Platte und aus dem Vorrat (`lagebildStandZulaessig`). Kein `resetQueries`: die Seite
 *   behält ihren Stand bis zur neuen Antwort und springt in keinen Lade- oder Fehlerzweig.
 * - **Einsatz fehlt in der Liste, die vorige kannte ihn:** wie der 404 auf den Kopf
 *   (`raeumeNachRechteentzug` in `api/queryClient.ts`): Sperrmarke, unbeobachtete Queries weg,
 *   der beobachtete Kopf lädt neu und räumt am 404 den Rest.
 * - **Erstes Sehen** (Abruf, `hydrate`, Vorrat) merkt nur den Stand.
 *
 * Läuft an jedem QueryClient aus `erzeugeQueryClient`, auch an gekoppelten Geräten: deren
 * Speicher zeigt Personen, auch wenn sie nichts auf die Platte schreiben.
 */

type Kopf = { id?: unknown; teilschwaerzungen?: unknown };

interface Bekannt {
  stand: number;
  /** Zeitpunkt der Antwort, die diesen Stand zuerst trug. */
  seit: number;
}

interface Zustand {
  /** Zuletzt gesehener Stand je Einsatz. */
  bekannt: Map<number, Bekannt>;
  /** Einsätze der zuletzt gesehenen Liste, `null` vor der ersten. */
  liste: Set<number> | null;
}

const ZUSTAENDE = new WeakMap<QueryClient, Zustand>();

function zustand(qc: QueryClient): Zustand {
  let z = ZUSTAENDE.get(qc);
  if (!z) ZUSTAENDE.set(qc, (z = { bekannt: new Map(), liste: null }));
  return z;
}

function standVon(kopf: Kopf): number {
  return typeof kopf.teilschwaerzungen === 'number' ? kopf.teilschwaerzungen : 0;
}

function istKopfKey(key: readonly unknown[]): key is readonly [string, number] {
  return key[0] === EINSATZ_KEYS.einsatz && typeof key[1] === 'number' && key.length === 2;
}

function istListenKey(key: readonly unknown[]): boolean {
  return key[0] === GLOBAL_KEYS.einsaetze && key.length === 1;
}

/** Die Köpfe einer Antwort: einer beim Kopf, alle bei der Liste. */
function koepfe(key: readonly unknown[], data: unknown): [number, number][] {
  if (istKopfKey(key)) {
    return data && typeof data === 'object' ? [[key[1], standVon(data as Kopf)]] : [];
  }
  if (!istListenKey(key) || !Array.isArray(data)) return [];
  return (data as Kopf[])
    .filter((k): k is Kopf & { id: number } => typeof k?.id === 'number')
    .map((k) => [k.id, standVon(k)]);
}

/** Einsatz-ID eines einsatzbezogenen Keys, sonst `null`. */
function einsatzIdVon(key: readonly unknown[]): number | null {
  const id = key[1];
  return typeof id === 'number' && istKeyDesEinsatzes(key, id) ? id : null;
}

function raeumen(qc: QueryClient, einsatzId: number, marke: number): void {
  lagebildRaeummarkeSetzen(qc, einsatzId, marke);
  const imEinsatz = (q: Query) =>
    istKeyDesEinsatzes(q.queryKey, einsatzId) && !istKopfKey(q.queryKey);
  const beobachtet = (q: Query) => imEinsatz(q) && q.getObserversCount() > 0;
  qc.removeQueries({ predicate: (q) => imEinsatz(q) && q.getObserversCount() === 0 });
  // `invalidateQueries` bricht einen laufenden Abruf nur ab, wenn der Query schon Daten hat;
  // ohne Daten hinge er sich an den alten Abruf. Deshalb erst abbrechen, dann neu laden.
  void qc
    .cancelQueries({ predicate: beobachtet })
    .then(() => qc.invalidateQueries({ predicate: beobachtet }));
  void qc.invalidateQueries({
    queryKey: einsatzKeys.einsatz(einsatzId),
    exact: true,
    refetchType: 'all',
    predicate: (q) => q.state.dataUpdatedAt < marke,
  });
}

function verschwunden(qc: QueryClient, einsatzId: number): void {
  const kopfKey = einsatzKeys.einsatz(einsatzId);
  lagebildSperren(qc, kopfKey, 'einsatz');
  qc.removeQueries({
    predicate: (q) => istKeyDesEinsatzes(q.queryKey, einsatzId) && q.getObserversCount() === 0,
  });
  void qc.invalidateQueries({ queryKey: kopfKey, exact: true });
}

/**
 * Nimmt einen Stand auf. `vergleichen` nur bei einer Serverantwort (Abruf oder `setQueryData`
 * mit der Antwort einer Mutation); `marke` ist deren Zeitpunkt.
 */
function aufnehmen(
  qc: QueryClient,
  key: readonly unknown[],
  data: unknown,
  vergleichen: boolean,
  marke: number,
): void {
  const z = zustand(qc);
  for (const [id, stand] of koepfe(key, data)) {
    const alt = z.bekannt.get(id);
    if (alt === undefined || !vergleichen) {
      if (alt === undefined || stand > alt.stand) z.bekannt.set(id, { stand, seit: marke });
      continue;
    }
    if (stand > alt.stand) {
      z.bekannt.set(id, { stand, seit: marke });
      raeumen(qc, id, marke);
    }
  }
  if (!istListenKey(key) || !Array.isArray(data)) return;
  const neu = new Set(koepfe(key, data).map(([id]) => id));
  const vorher = z.liste;
  z.liste = neu;
  if (!vergleichen || vorher === null) return;
  for (const id of vorher) if (!neu.has(id)) verschwunden(qc, id);
}

/** Hängt den Wächter an den Cache. Liefert die Abmeldung. */
export function schwaerzungsWaechterStarten(qc: QueryClient): () => void {
  return qc.getQueryCache().subscribe((ereignis) => {
    const { query } = ereignis;
    const key = query.queryKey;
    if (!istKopfKey(key) && !istListenKey(key)) return;
    if (ereignis.type === 'removed') {
      // `clear()` beim Abmelden: die nächste Liste vergleicht nicht mit der fremden Sitzung.
      if (istListenKey(key)) zustand(qc).liste = null;
      return;
    }
    const { data, dataUpdatedAt } = query.state;
    if (data === undefined) return;
    if (ereignis.type === 'added') {
      aufnehmen(qc, key, data, false, dataUpdatedAt);
    } else if (ereignis.type === 'updated') {
      const art = ereignis.action.type;
      // `hydrate` setzt einen bestehenden Query per `setState`: erstes Sehen, kein Vergleich.
      if (art === 'success' || art === 'setState') {
        aufnehmen(qc, key, data, art === 'success', dataUpdatedAt);
      }
    }
  });
}

type VorratEintrag = { queryKey: readonly unknown[]; state: { data?: unknown } };

/**
 * Belegt den Wächter beim Sitzungsbeginn aus dem Vorrat vor (design.md D5): Stände und Liste,
 * unter denen der Vorrat gespeichert wurde. Je Einsatz zählt der höchste Stand im Vorrat; ein
 * Einsatz, von dem der Vorrat nur Daten und weder Kopf noch Liste hält, zählt als 0. Kam die
 * Antwort der neuen Sitzung schon vorher, wird hier verglichen: ein höherer Live-Stand räumt den
 * Einsatz ab der Antwort, die ihn trug, ein Einsatz, den die Liste im Vorrat kannte und die neue
 * nicht mehr, gilt als verschwunden.
 */
export function schwaerzungsWaechterVorbelegen(
  qc: QueryClient,
  vorrat: readonly VorratEintrag[],
): void {
  const z = zustand(qc);
  const staende = new Map<number, number>();
  let listeImVorrat: number[] | null = null;
  for (const { queryKey: key, state } of vorrat) {
    const id = einsatzIdVon(key);
    if (id !== null && !staende.has(id)) staende.set(id, 0);
    const koepfeHier = koepfe(key, state.data);
    for (const [kid, stand] of koepfeHier) staende.set(kid, Math.max(staende.get(kid) ?? 0, stand));
    if (istListenKey(key) && Array.isArray(state.data)) listeImVorrat = koepfeHier.map(([k]) => k);
  }
  for (const [id, stand] of staende) {
    const live = z.bekannt.get(id);
    if (live === undefined) z.bekannt.set(id, { stand, seit: 0 });
    else if (live.stand > stand) raeumen(qc, id, live.seit);
  }
  if (listeImVorrat === null) return;
  if (z.liste === null) z.liste = new Set(listeImVorrat);
  else for (const id of listeImVorrat) if (!z.liste.has(id)) verschwunden(qc, id);
}
