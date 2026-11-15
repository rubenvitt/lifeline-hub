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
const NichtGefundenKontext = createContext<MutableRefObject<boolean> | null>(null);

export const NichtGefundenProvider = NichtGefundenKontext.Provider;

/** Setzt die Marke, solange die aufrufende Seite steht. Außerhalb des Rahmens wirkungslos. */
export function useNichtGefundenMelden(): void {
  const marke = useContext(NichtGefundenKontext);
  useLayoutEffect(() => {
    if (!marke) return;
    marke.current = true;
    return () => {
      marke.current = false;
    };
  }, [marke]);
}
