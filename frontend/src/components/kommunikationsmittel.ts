import type { Betriebsart, Sprechgruppe } from '../api/types';

/*
 * Funk-Hilfen für Sprechgruppen (TMO/DMO). Die früheren Kommunikationsmittel-Labels
 * (digitalfunk/mobil/festnetz) sind mit LLH-1134 entfallen: Telefon und weitere Verbindungen sind
 * typisiert (`verbindungen.ts`), Funk zeigt sich an Rufname und Sprechgruppen.
 */

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
