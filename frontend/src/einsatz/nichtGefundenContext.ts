import { createContext, useContext, useLayoutEffect, type MutableRefObject } from 'react';
import { useLocation } from 'react-router';

/**
 * Meldung einer Seite an den Einsatzrahmen: „hier steht ‚gibt es nicht‘“. Das sind die Auffangseite
 * einer unbekannten Adresse (LLH-1729) und jede Detailseite, deren Objekt es nicht (mehr) gibt
 * (`SeitenNichtGefunden`, LLH-1827). Der Rahmen merkt die Adresse dann nicht als letzten Ort
 * (`letzterOrt.ts`), wie er auch ein gesperrtes Modul nicht merkt; der Rückweg von Profil und
 * Verwaltung führte sonst auf die Fehlerseite.
 *
 * `marke` ist ein Ref statt eines Zustands: der Rahmen merkt im Effekt desselben Commits, in dem die
 * Seite erscheint. Die Seite setzt die Marke per `useLayoutEffect`, und alle Layout-Effekte laufen
 * vor den Effekten (`useEffect`) des Rahmens; ein Zustand käme erst einen Commit später an.
 *
 * `widerrufe` deckt den späten Fall: eine Detailseite lädt erst und erfährt dann (404), dass es ihr
 * Objekt nicht gibt. Bis dahin hat der Rahmen die Adresse schon gemerkt; er stellt dann den Ort
 * davor wieder her, aber nur, wenn das Gemerkte genau diese Adresse ist.
 */
export interface NichtGefundenMarke {
  marke: MutableRefObject<boolean>;
  /** Nimmt das Merken von `pfad` (ohne Suche) zurück, falls der Rahmen ihn zuletzt gemerkt hat. */
  widerrufe: (pfad: string) => void;
}

const NichtGefundenContext = createContext<NichtGefundenMarke | null>(null);

export const NichtGefundenProvider = NichtGefundenContext.Provider;

/** Setzt die Marke, solange die aufrufende Seite steht. Außerhalb des Rahmens wirkungslos. */
export function useMarkNichtGefunden(): void {
  const kontext = useContext(NichtGefundenContext);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (!kontext) return;
    const flag = kontext.marke;
    flag.current = true;
    kontext.widerrufe(pathname);
    return () => {
      flag.current = false;
    };
  }, [kontext, pathname]);
}
