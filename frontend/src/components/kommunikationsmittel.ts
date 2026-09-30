import type { Sprechgruppe } from '../api/types';

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
