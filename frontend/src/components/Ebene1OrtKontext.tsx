import { createContext, useContext } from 'react';

/**
 * Ort und Rückweg auf Profil und Verwaltung (LFH-954, design.md D5). `AppLayout` stellt ihn, der
 * Seitenkopf (`AdminPage`) liest ihn. `undefined` auf der Einsatzliste und außerhalb der Ebene 1.
 */
export interface Ebene1OrtWert {
  /** Ortspfad hinter „Einsätze ›“, z. B. `['Verwaltung', 'Fahrzeuge']`; der letzte ist die Seite. */
  ort: string[];
  /** Nur, wenn der zuletzt offene Einsatz der Person noch aktiv ist. */
  rueckweg?: { label: string; pfad: string };
}

const Ebene1OrtKontext = createContext<Ebene1OrtWert | undefined>(undefined);

export const Ebene1OrtProvider = Ebene1OrtKontext.Provider;

export function useEbene1Ort(): Ebene1OrtWert | undefined {
  return useContext(Ebene1OrtKontext);
}
