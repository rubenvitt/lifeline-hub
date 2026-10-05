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
 *   Detail-Keys, die sonst nicht live sind). Die Marke hält bis dahin jeden älteren Stand von der
 *   Platte und aus dem Vorrat (`lagebildStandZulaessig`). Kein `resetQueries`: die Seite behält
 *   ihren Stand bis zur neuen Antwort und springt in keinen Lade- oder Fehlerzweig.
 * - **Einsatz fehlt in der Liste, die vorige kannte ihn:** wie der 404 auf den Kopf
 *   (`raeumeNachRechteentzug` in `api/queryClient.ts`): Sperrmarke, unbeobachtete Queries weg,
 *   der beobachtete Kopf lädt neu und räumt am 404 den Rest.
 * - **Erstes Sehen** (Abruf, `hydrate`, Vorrat) merkt nur den Stand.
 *
 * Läuft an jedem QueryClient aus `erzeugeQueryClient`, auch an gekoppelten Geräten: deren
 * Speicher zeigt Personen, auch wenn sie nichts auf die Platte schreiben.
 */

type Kopf = { id?: unknown; teilschwaerzungen?: unknown };

interface Zustand {
  /** Zuletzt gesehener Stand je Einsatz. */
  bekannt: Map<number, number>;
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

function raeumen(qc: QueryClient, einsatzId: number, marke: number): void {
  lagebildRaeummarkeSetzen(qc, einsatzId, marke);
  const imEinsatz = (q: Query) =>
    istKeyDesEinsatzes(q.queryKey, einsatzId) && !istKopfKey(q.queryKey);
  qc.removeQueries({ predicate: (q) => imEinsatz(q) && q.getObserversCount() === 0 });
  void qc.invalidateQueries({ predicate: (q) => imEinsatz(q) && q.getObserversCount() > 0 });
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
      if (alt === undefined || stand > alt) z.bekannt.set(id, stand);
      continue;
    }
    if (stand > alt) {
      z.bekannt.set(id, stand);
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
 * unter denen der Vorrat gespeichert wurde. Kam die Antwort der neuen Sitzung schon vorher,
 * wird hier verglichen: ein höherer Live-Stand räumt den Einsatz ab jetzt, ein Einsatz, den die
 * Liste im Vorrat kannte und die neue nicht mehr, gilt als verschwunden.
 */
export function schwaerzungsWaechterVorbelegen(
  qc: QueryClient,
  vorrat: readonly VorratEintrag[],
): void {
  const z = zustand(qc);
  const jetzt = Date.now();
  for (const eintrag of vorrat) {
    const key = eintrag.queryKey;
    for (const [id, stand] of koepfe(key, eintrag.state.data)) {
      const live = z.bekannt.get(id);
      if (live === undefined) z.bekannt.set(id, stand);
      else if (live > stand) raeumen(qc, id, jetzt);
    }
    if (!istListenKey(key) || !Array.isArray(eintrag.state.data)) continue;
    const imVorrat = koepfe(key, eintrag.state.data).map(([id]) => id);
    if (z.liste === null) z.liste = new Set(imVorrat);
    else for (const id of imVorrat) if (!z.liste.has(id)) verschwunden(qc, id);
  }
}
