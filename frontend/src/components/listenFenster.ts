import { useEffect, useRef } from 'react';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Seitenfenster für die Archiv-Listen, die nur nach unten (zu Älterem) blättern (LLH-1687): die
 * abgeschlossenen Meldungen, Aufträge und Erinnerungen.
 *
 * TanStack lädt bei einer Invalidierung jede gehaltene Seite einer `useInfiniteQuery` nacheinander
 * neu. Ohne Deckel kostete jedes Live-Ereignis nach tiefem Blättern eine Kette über alle Seiten, in
 * jedem Tab. Mit `maxPages` fällt beim Weiterblättern die vorderste Seite heraus. Diese Listen
 * haben keinen Cursor nach vorn (anders als das ETB, `etb/seitenfenster.ts`); den Weg zurück zum
 * Neuesten bietet der Knopf `ZumKopfKnopf`, der das Fenster durch den Kopf ersetzt.
 *
 * Chat und Infotelefon tragen das Fenster bewusst nicht: Zufluss-Schleuse und Gelesen-Stand
 * setzen dort den Kopf im Fenster voraus (Review zu LLH-1687).
 *
 * Der Kopf ist die Seite mit dem Startparameter `undefined` (alle drei Listen beginnen dort).
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
 *
 * Kam während des Abrufs ein Live-Ereignis, läuft dessen Neuladen noch (dann bricht `cancelQueries`
 * es ab und lässt den Stand „ungültig“) oder ist schon fertig (dann hat sich der Datenstand
 * geändert). In beiden Fällen könnte der Kopf älter sein als das Ereignis, `setQueryData` erklärte
 * ihn aber für frisch: dann wird er noch einmal geholt.
 */
export async function zumKopf<T>(
  qc: QueryClient,
  schluessel: QueryKey,
  ladeKopf: () => Promise<T[]>,
): Promise<boolean> {
  const standVorher = qc.getQueryState(schluessel)?.dataUpdateCount;
  let kopf: T[];
  try {
    kopf = await ladeKopf();
  } catch {
    return false;
  }
  await qc.cancelQueries({ queryKey: schluessel, exact: true });
  const zustand = qc.getQueryState(schluessel);
  const verpasst = zustand?.isInvalidated === true || zustand?.dataUpdateCount !== standVorher;
  qc.setQueryData<InfiniteData<T[], unknown>>(schluessel, {
    pages: [kopf],
    pageParams: [undefined],
  });
  if (verpasst) void qc.invalidateQueries({ queryKey: schluessel, exact: true });
  return true;
}

/**
 * Verlässt jemand die Ansicht (anderer Reiter, andere Seite) mit einem Fenster ohne Kopf, wird es
 * verworfen: Beim Wiederkommen stünden sonst alte Einträge oben, als wären es die neuesten
 * (Review zu LLH-1687). Das nächste Öffnen holt frisch den Kopf. Ohne Netz bleibt das Fenster:
 * verworfen ließe es nur einen Ladekreis zurück, und der Knopf steht ohnehin über der Liste.
 */
export function useKopfBeimVerlassen(schluessel: QueryKey, aktiv: boolean) {
  const qc = useQueryClient();
  // Der echte Schlüssel (ein JSON-Rundweg verlöre `undefined` in Filterobjekten); der Effekt hängt
  // an seiner Textform, damit ein neu gebautes, gleiches Array ihn nicht neu startet.
  const aktuell = useRef(schluessel);
  useEffect(() => {
    aktuell.current = schluessel;
  });
  const s = JSON.stringify(schluessel);
  useEffect(() => {
    if (!aktiv) return;
    const key = aktuell.current;
    return () => {
      if (!onlineManager.isOnline()) return;
      if (kopfVerlassen(qc.getQueryData(key))) qc.removeQueries({ queryKey: key, exact: true });
    };
  }, [qc, s, aktiv]);
}
