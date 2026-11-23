import { useEffect } from 'react';
import { useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';

/**
 * Seitenfenster in beide Richtungen für Chat und Infotelefon (LLH-1886, Entwurf
 * `docs/superpowers/specs/2026-11-22-se7ytm9j-chat-infotelefon-seitenfenster-design.md`, D2), nach
 * dem Muster der ETB-Zeitachse (LFH-947); seit LLH-2036 blättert auch das ETB hierüber
 * (Cursor in `etb/seitenfenster.ts`).
 *
 * Die Liste hält höchstens {@link FENSTER_MAX_SEITEN} Seiten. TanStack lädt bei einer
 * Invalidierung so viele Seiten nach, wie im Cache liegen — ohne Deckel kostete jedes
 * Live-Ereignis nach tiefem Blättern eine Kette über alle Seiten, in jedem Tab. Damit der Weg
 * zurück nach unten bleibt, trägt jeder Seitenparameter seine Richtung:
 *
 * - `undefined`: der Kopf (neueste Seite).
 * - `{ aelter: c }`: die Seite unter `c`.
 * - `{ neuer: c }`: die Seite direkt über `c`, absteigend geliefert wie jede Seite.
 *
 * Jeder Folgeparameter stammt aus einem gelesenen Eintrag, deshalb entsteht keine Lücke. Eine
 * `neuer`-Seite holt einen Eintrag mehr ({@link seitenLimit}): kommt sie nicht voll, ist der Kopf
 * erreicht. Mit genau einer Seitengröße bliebe nach dem Rückweg auf denselben Seitengrenzen
 * „Neuere laden“ stehen und holte beim nächsten Klick eine leere Seite. Kopf im
 * Fenster heißt `!hasPreviousPage`; dazu passen `zumKopf` und `useKopfBeimVerlassen` aus
 * `listenFenster.ts`, deren Kopf ebenfalls der Parameter `undefined` ist.
 */
export type FensterParam<C> = { aelter: C } | { neuer: C } | undefined;

/** Höchstzahl gehaltener Seiten, wie im ETB und in den Archiv-Listen. */
export const FENSTER_MAX_SEITEN = 5;

/**
 * Wie eine Liste ihren Cursor bildet. Seiten kommen absteigend (der erste Eintrag ist der
 * jüngste). Die beiden `einschliessend…` machen aus einem Cursor den Nachbarn, dessen ältere bzw.
 * neuere Seite den Cursor-Eintrag selbst noch enthält; das braucht nur eine leere Seite, nach der
 * der Weg sonst am gelesenen Eintrag vorbeiführte (ETB: `lfd_nr ± 1`).
 */
export interface CursorAdapter<T, C> {
  cursor: (eintrag: T) => C;
  einschliessendAelter: (c: C) => C;
  einschliessendNeuer: (c: C) => C;
}

/** Wie viele Einträge eine Seite anfragt: `neuer`-Seiten einen mehr (siehe oben). */
export function seitenLimit<C>(seitengroesse: number, param: FensterParam<C>): number {
  return param != null && 'neuer' in param ? seitengroesse + 1 : seitengroesse;
}

/** Parameter der nächsten (älteren) Seite nach `letzte`, oder `undefined` am unteren Ende. */
export function naechsterParam<T, C>(
  adapter: CursorAdapter<T, C>,
  seitengroesse: number,
  letzte: readonly T[],
  param: FensterParam<C>,
): FensterParam<C> {
  const unterster = letzte[letzte.length - 1];
  if (param && 'neuer' in param) {
    // Eine `neuer`-Seite sagt nichts über Älteres: darunter liegt mindestens der Cursor selbst.
    return {
      aelter:
        unterster !== undefined
          ? adapter.cursor(unterster)
          : adapter.einschliessendAelter(param.neuer),
    };
  }
  if (unterster === undefined || letzte.length < seitengroesse) return undefined;
  return { aelter: adapter.cursor(unterster) };
}

/** Parameter der vorigen (neueren) Seite vor `erste`, oder `undefined`, wenn sie die neueste ist. */
export function vorigerParam<T, C>(
  adapter: CursorAdapter<T, C>,
  seitengroesse: number,
  erste: readonly T[],
  param: FensterParam<C>,
): FensterParam<C> {
  if (param == null) return undefined;
  const oberster = erste[0];
  if ('neuer' in param) {
    // Nicht voll (bis zu einer Seitengröße, angefragt war eine mehr) heißt: über dem Cursor lag
    // nichts mehr. Ein späterer Neuabruf derselben Seite füllt sie mit neuen Einträgen auf; ist
    // sie dann voll, gibt es wieder eine vorige.
    if (oberster === undefined || erste.length < seitenLimit(seitengroesse, param))
      return undefined;
    return { neuer: adapter.cursor(oberster) };
  }
  return {
    neuer:
      oberster !== undefined ? adapter.cursor(oberster) : adapter.einschliessendNeuer(param.aelter),
  };
}

/** Die Fenster-Teile einer `useInfiniteQuery`: Startparameter, Deckel und beide Übergänge. */
export function fensterOptionen<T, C>(adapter: CursorAdapter<T, C>, seitengroesse: number) {
  return {
    initialPageParam: undefined as FensterParam<C>,
    maxPages: FENSTER_MAX_SEITEN,
    getNextPageParam: (letzte: T[], _alle: T[][], param: FensterParam<C>) =>
      naechsterParam(adapter, seitengroesse, letzte, param),
    getPreviousPageParam: (erste: T[], _alle: T[][], param: FensterParam<C>) =>
      vorigerParam(adapter, seitengroesse, erste, param),
  };
}

/**
 * Eine nicht volle `neuer`-Seite vorn IST der Kopf (Review zu LLH-1886): Über ihr lag nichts mehr.
 * Bliebe ihr Parameter `{ neuer: c }`, läse jedes Live-Neuladen die Seite direkt über `c` — schon
 * eine neue Nachricht machte sie „voll“, der Kopf gälte als verloren (kein Mitlaufen, kein
 * Gelesen), und ab zwei fehlte die neueste ganz. Liefert die Daten mit dem Parameter `undefined`
 * vorn, oder `null`, wenn nichts umzuschreiben ist. Das nächste Neuladen holt dann die neuesten
 * Einträge und rechnet die Folgeseiten aus ihnen neu (TanStack: `getNextPageParam`), ohne Doppelte.
 */
export function kopfAngenommen<T>(
  daten: InfiniteData<T[], unknown> | undefined,
  seitengroesse: number,
): InfiniteData<T[], unknown> | null {
  // `useInfiniteQuery` tippt die Parameter als `unknown`; hier stehen nur `FensterParam`e.
  const param = daten?.pageParams[0] as FensterParam<unknown>;
  const erste = daten?.pages[0];
  if (daten == null || erste == null || param == null || !('neuer' in param)) return null;
  if (erste.length >= seitenLimit(seitengroesse, param)) return null;
  return { pages: daten.pages, pageParams: [undefined, ...daten.pageParams.slice(1)] };
}

/** Schreibt {@link kopfAngenommen} in den Cache, sobald die Daten es verlangen. */
export function useKopfAnnehmen<T>(
  schluessel: QueryKey,
  daten: InfiniteData<T[], unknown> | undefined,
  seitengroesse: number,
) {
  const qc = useQueryClient();
  const s = JSON.stringify(schluessel);
  useEffect(() => {
    const neu = kopfAngenommen(daten, seitengroesse);
    if (neu == null) return;
    qc.setQueryData(JSON.parse(s) as QueryKey, neu);
  }, [qc, s, daten, seitengroesse]);
}
