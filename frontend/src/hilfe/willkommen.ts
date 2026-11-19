import type { BenutzerEinstellungen } from '../api/types';

/**
 * Schlüssel im Benutzer-Einstellungsfach (LLH-1824): Zeitpunkt, zu dem die Willkommenskarte
 * geschlossen wurde. Spiegel von `SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN` in
 * `src/benutzer_einstellungen/mod.rs`; es zählt nur, ob er da ist.
 */
export const SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN = 'willkommen_geschlossen';

/**
 * Die Karte steht nur bei BEKANNTEM Stand ohne Schlüssel: lieber keine Karte als eine, die nach
 * dem Schließen wiederkommt, weil der Stand noch lädt oder nicht abrufbar ist.
 */
export function istWillkommenOffen(stand: BenutzerEinstellungen | undefined): boolean {
  return stand !== undefined && !(SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN in stand.eintraege);
}
