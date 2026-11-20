import type { BenutzerEinstellungen } from '../../api/types';
import { SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN } from '../willkommen';

/** Die zwei Teile des Rundgangs für Erstnutzer (LLH-1990). */
export type RundgangTeil = 'liste' | 'einsatz';

/**
 * Schlüssel im Benutzer-Einstellungsfach: Zeitpunkt, zu dem der Teil zum ersten Mal stand. Spiegel
 * von `SCHLUESSEL_RUNDGANG_*_GESEHEN` in `src/benutzer_einstellungen/mod.rs`; es zählt nur, ob er da
 * ist.
 */
export const SCHLUESSEL_RUNDGANG: Record<RundgangTeil, string> = {
  liste: 'rundgang_liste_gesehen',
  einsatz: 'rundgang_einsatz_gesehen',
};

/**
 * Teil „Liste“ startet von selbst nur bei BEKANNTEM Stand (wie `istWillkommenOffen`), solange die
 * Willkommenskarte steht und der Teil noch nie stand. Wer die Karte schon geschlossen hat, kennt
 * die App.
 */
export function sollListeSelbstStarten(stand: BenutzerEinstellungen | undefined): boolean {
  if (stand === undefined) return false;
  const e = stand.eintraege;
  return !(SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN in e) && !(SCHLUESSEL_RUNDGANG.liste in e);
}

/**
 * Teil „Einsatz“ startet von selbst nur in einer Übung, nie in einem echten Einsatz, und nur für
 * Erstnutzer: die Karte steht noch, oder Teil „Liste“ lief schon.
 */
export function sollEinsatzSelbstStarten(
  stand: BenutzerEinstellungen | undefined,
  uebung: boolean,
): boolean {
  if (!uebung || stand === undefined) return false;
  const e = stand.eintraege;
  if (SCHLUESSEL_RUNDGANG.einsatz in e) return false;
  return !(SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN in e) || SCHLUESSEL_RUNDGANG.liste in e;
}
