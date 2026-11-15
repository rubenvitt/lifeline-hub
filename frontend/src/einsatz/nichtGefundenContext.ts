import { createContext, useContext, useLayoutEffect, type MutableRefObject } from 'react';

/**
 * Meldung der Auffangseite an den Einsatzrahmen (LLH-1729): „hier steht ‚Seite nicht gefunden‘“.
 * Der Rahmen merkt die Adresse dann nicht als letzten Ort (`letzterOrt.ts`), wie er auch ein
 * gesperrtes Modul nicht merkt; der Rückweg von Profil und Verwaltung führte sonst auf die
 * Fehlerseite.
 *
 * Ein Ref statt eines Zustands: der Rahmen merkt im Effekt desselben Commits, in dem die Seite
 * erscheint. Die Seite setzt die Marke per `useLayoutEffect`, und alle Layout-Effekte laufen vor
 * den Effekten (`useEffect`) des Rahmens; ein Zustand käme erst einen Commit später an.
 */
const NichtGefundenContext = createContext<MutableRefObject<boolean> | null>(null);

export const NichtGefundenProvider = NichtGefundenContext.Provider;

/** Setzt die Marke, solange die aufrufende Seite steht. Außerhalb des Rahmens wirkungslos. */
export function useMarkNichtGefunden(): void {
  const flag = useContext(NichtGefundenContext);
  useLayoutEffect(() => {
    if (!flag) return;
    flag.current = true;
    return () => {
      flag.current = false;
    };
  }, [flag]);
}
