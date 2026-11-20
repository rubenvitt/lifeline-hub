import { useEffect, useState } from 'react';

/**
 * Stückweises Rendern beim ersten Anzeigen einer Liste (LLH-1974, `frontend/AGENTS.md`,
 * Bedien-Leitlinie, „Overlays in Zeilen erst bei Bedarf“).
 *
 * Eine Liste hängt beim Öffnen der Seite alle Zeilen in EINEM Commit ein, und der blockiert den
 * Hauptthread am Stück. Gestückelt kommt im ersten Commit nur ein Stück, jedes weitere in einer
 * eigenen Aufgabe: mehrere kurze Blockaden statt einer langen. Nur beim ersten Anzeigen; danach
 * (Filter, Sortierung, Live-Daten) rendert die Liste sofort vollständig.
 */
export const STUECK_ZEILEN = 4;

/**
 * Modulschalter. In der Vitest-Umgebung aus (`src/test/setup.ts`), damit Tests weiter synchron
 * alle Zeilen sehen; eigene Tests schalten ihn ein.
 */
let stueckweiseAn = true;
export function setzeStueckweise(an: boolean): void {
  stueckweiseAn = an;
}

/**
 * Wie viele der `anzahl` Zeilen gerade zu rendern sind. Gestückelt wird nur, wenn die Liste beim
 * ersten Render `aktiv` ist und mehr als {@link STUECK_ZEILEN} Zeilen hat. Wird `aktiv` falsch
 * (Druck, Deeplink, Virtualisierung) oder sind alle Zeilen da, ist das Stückeln für diese
 * Instanz vorbei.
 */
export function useStueckweise(anzahl: number, aktiv: boolean): number {
  const [bis, setBis] = useState<number | null>(() =>
    aktiv && stueckweiseAn && anzahl > STUECK_ZEILEN ? STUECK_ZEILEN : null,
  );
  // Beim Rendern angepasst, nicht per Effekt: derselbe Render zeigt dann schon alles.
  if (bis != null && (!aktiv || bis >= anzahl)) setBis(null);
  const laeuft = bis != null && aktiv && bis < anzahl;

  useEffect(() => {
    if (!laeuft) return;
    const t = setTimeout(() => setBis((b) => (b == null ? null : b + STUECK_ZEILEN)), 0);
    return () => clearTimeout(t);
  }, [laeuft, bis]);

  return laeuft ? bis : anzahl;
}
