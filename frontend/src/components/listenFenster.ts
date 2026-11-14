import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
 * Kam während des Abrufs ein Live-Ereignis, hat `cancelQueries` dessen Neuladen abgebrochen und den
 * Stand „ungültig“ wiederhergestellt; `setQueryData` erklärte ihn sonst für frisch, und der neue
 * Eintrag fehlte bis zum nächsten Ereignis. Dann wird der Kopf noch einmal geholt.
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
  const verpasst = qc.getQueryState(schluessel)?.isInvalidated === true;
  qc.setQueryData<InfiniteData<T[], unknown>>(schluessel, {
    pages: [kopf],
    pageParams: [undefined],
  });
  if (verpasst) void qc.invalidateQueries({ queryKey: schluessel, exact: true });
  return true;
}

/**
 * Wie viele Einträge vor dem Fenster liegen, also schon herausgefallen sind. Damit zählen „X von Y
 * geladen“ und das Ende von „Ältere laden“ nach der Position in der Liste, nicht nach der Länge
 * des Fensters. Der Anfang jeder Seite wird beim ersten Erscheinen gemerkt (je Seitenparameter);
 * fällt die vorderste heraus, kennt die nächste ihren Anfang schon.
 */
export function useFensterAnfang(
  daten: InfiniteData<readonly unknown[], unknown> | undefined,
  schluessel: QueryKey,
): number {
  const anfaenge = useRef<{ schluessel: string; je: Map<string, number> }>({
    schluessel: '',
    je: new Map(),
  });
  const s = JSON.stringify(schluessel);
  if (anfaenge.current.schluessel !== s) anfaenge.current = { schluessel: s, je: new Map() };
  if (daten == null || daten.pages.length === 0) return 0;
  const je = anfaenge.current.je;
  let vorige: number | null = null;
  let erster = 0;
  daten.pages.forEach((seite, i) => {
    const param = JSON.stringify(daten.pageParams[i] ?? null);
    let anfang = je.get(param);
    if (anfang === undefined) {
      anfang = daten.pageParams[i] === undefined ? 0 : (vorige ?? 0);
      je.set(param, anfang);
    }
    if (i === 0) erster = anfang;
    vorige = anfang + seite.length;
  });
  return erster;
}

/**
 * Verlässt jemand die Ansicht (anderer Reiter, andere Seite) mit einem Fenster ohne Kopf, wird es
 * verworfen: Beim Wiederkommen stünden sonst alte Einträge oben, als wären es die neuesten
 * (Review zu LLH-1687). Das nächste Öffnen holt frisch den Kopf.
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
      if (kopfVerlassen(qc.getQueryData(key))) qc.removeQueries({ queryKey: key, exact: true });
    };
  }, [qc, s, aktiv]);
}
