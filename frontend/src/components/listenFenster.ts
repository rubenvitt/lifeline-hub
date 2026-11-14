import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Seitenfenster für Listen, die nur nach unten (zu Älterem) blättern (LLH-1687): Chat, Infotelefon
 * und die abgeschlossenen Meldungen, Aufträge und Erinnerungen.
 *
 * TanStack lädt bei einer Invalidierung jede gehaltene Seite einer `useInfiniteQuery` nacheinander
 * neu. Ohne Deckel kostete jedes Live-Ereignis nach tiefem Blättern eine Kette über alle Seiten, in
 * jedem Tab. Mit `maxPages` fällt beim Weiterblättern die vorderste Seite heraus. Diese Listen
 * haben keinen Cursor nach vorn (anders als das ETB, `etb/seitenfenster.ts`); den Weg zurück zum
 * Neuesten bietet deshalb der Knopf {@link ZumKopfKnopf}, der das Fenster durch den Kopf ersetzt.
 *
 * Der Kopf ist die Seite mit dem Startparameter `undefined` (alle fünf Listen beginnen dort).
 */
export const LISTEN_MAX_SEITEN = 5;

/** `true`, wenn die neueste Seite aus dem Fenster gefallen ist. */
export function kopfVerlassen(daten: InfiniteData<unknown, unknown> | undefined): boolean {
  return daten != null && daten.pageParams.length > 0 && daten.pageParams[0] !== undefined;
}

/**
 * Ersetzt das Fenster durch den Kopf (Muster `zumKopf` in `pages/EtbPage.tsx`). Erst holen, dann
 * ersetzen: Scheitert der Abruf, bleibt das Fenster, wie es ist — kein `resetQueries`, das ließe
 * bei schlechtem Netz eine leere Liste zurück. Liefert, ob ersetzt wurde.
 */
export async function zumKopf<T>(
  qc: QueryClient,
  schluessel: QueryKey,
  ladeKopf: () => Promise<T[]>,
): Promise<boolean> {
  let kopf: T[];
  try {
    kopf = await ladeKopf();
  } catch {
    return false;
  }
  await qc.cancelQueries({ queryKey: schluessel, exact: true });
  qc.setQueryData<InfiniteData<T[], unknown>>(schluessel, {
    pages: [kopf],
    pageParams: [undefined],
  });
  return true;
}
