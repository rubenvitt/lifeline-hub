import type { Betriebsart, Sprechgruppe } from '../api/types';

/**
 * Schlüssel → Anzeige-Label für das Kommunikationsmittel (Abschnitt LFH-86, Einheit LFH-108).
 * Die Schlüssel prüft das Backend (`KOMMUNIKATIONSMITTEL` in src/routes/support.rs, LFH-140):
 * ein neuer Schlüssel hier braucht dort denselben Eintrag, sonst endet das Speichern in 400.
 *
 * Reiner Kern ohne React, geteilt von `FunkErreichbarkeit` und dem Funkplan (LFH-548).
 */
const KOMMUNIKATIONSMITTEL_LABEL: Record<string, string> = {
  digitalfunk: 'Digitalfunk',
  mobil: 'Mobil',
  festnetz: 'Festnetz',
};

export const KOMMUNIKATIONSMITTEL_OPTIONEN = Object.entries(KOMMUNIKATIONSMITTEL_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/** Label zum Schlüssel; ein unbekannter Schlüssel erscheint roh, leer wird `null`. */
export function kommunikationsmittelLabel(schluessel: string | null | undefined): string | null {
  if (!schluessel) return null;
  return KOMMUNIKATIONSMITTEL_LABEL[schluessel] ?? schluessel;
}

/** Zugeordnete Sprechgruppen nach Betriebsart, in der gelieferten Reihenfolge. */
export function teileSprechgruppen(sprechgruppen: readonly Sprechgruppe[] | null | undefined): {
  tmo: Sprechgruppe[];
  dmo: Sprechgruppe[];
} {
  const alle = sprechgruppen ?? [];
  return {
    tmo: alle.filter((s) => s.betriebsart === 'TMO'),
    dmo: alle.filter((s) => s.betriebsart === 'DMO'),
  };
}

/**
 * Eine Sprechgruppe mit ihrer Betriebsart: „TMO 311“ aus „311“. Trägt die Bezeichnung die
 * Betriebsart schon („DMO 505“, „tmo 412_F_DRK“), bleibt sie, wie sie ist — „DMO DMO 505“ läse
 * sich wie ein Fehler. Die eine Regel für Fernmeldeskizze, Funkplan-Bericht und die Führungsstelle
 * auf den Einsatzdaten (LFH-884); die Funkplan-Tabelle trennt nach Spalten und braucht sie nicht.
 */
export function mitBetriebsart(art: Betriebsart, bezeichnung: string): string {
  return bezeichnung.trim().toUpperCase().startsWith(art) ? bezeichnung : `${art} ${bezeichnung}`;
}
