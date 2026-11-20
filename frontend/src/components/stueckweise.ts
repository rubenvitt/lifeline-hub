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

/** `wartet`: noch keine Zeile gesehen; eine Zahl: so weit gerendert; `fertig`: nie mehr stückeln. */
type Stand = 'wartet' | number | 'fertig';

function ordne(stand: Stand, anzahl: number, aktiv: boolean): Stand {
  if (stand === 'fertig' || !aktiv) return 'fertig';
  if (stand === 'wartet') {
    if (anzahl === 0) return 'wartet';
    return anzahl > STUECK_ZEILEN ? STUECK_ZEILEN : 'fertig';
  }
  return stand >= anzahl ? 'fertig' : stand;
}

/**
 * Wie viele der `anzahl` Zeilen gerade zu rendern sind. Gestückelt wird beim ersten Render, der
 * Zeilen hat (eine Liste startet oft leer, solange ihre Daten laden), wenn die Liste dann `aktiv`
 * ist und mehr als {@link STUECK_ZEILEN} Zeilen hat. Wird `aktiv` falsch (Druck, Deeplink,
 * Virtualisierung) oder sind alle Zeilen da, ist das Stückeln für diese Instanz vorbei.
 */
export function useStueckweise(anzahl: number, aktiv: boolean): number {
  const [roh, setStand] = useState<Stand>(() => (stueckweiseAn ? 'wartet' : 'fertig'));
  const stand = ordne(roh, anzahl, aktiv);
  // Beim Rendern angepasst, nicht per Effekt: derselbe Render zeigt schon den neuen Stand.
  if (stand !== roh) setStand(stand);
  const bis = typeof stand === 'number' ? stand : null;

  useEffect(() => {
    if (bis == null) return;
    const t = setTimeout(() => setStand((s) => (typeof s === 'number' ? s + STUECK_ZEILEN : s)), 0);
    return () => clearTimeout(t);
  }, [bis]);

  return bis ?? anzahl;
}
