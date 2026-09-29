import type { EinsatzFahrzeug, EinsatzPersonal } from '../api/types';
import { statusKategorie, type StatusDarstellung } from '../theme/statusFarben';

/**
 * Statusanzeige eines disponierten Mittels (Fahrzeug, Personal) als `StatusDarstellung` — EINE
 * Stelle für Fachseiten und Sprungpalette.
 * Die Mandantenfarbe (`status_farbe`) steckt NICHT in der Darstellung: sie geht beim Aufrufer
 * an `StatusTag farbe=…`, das dann die Rand-Form erzwingt.
 * Nicht zu verwechseln mit `MittelStatus` in `meldebildRaster.ts` (Chip-Beschreibung des
 * Meldebilds).
 */

/**
 * Statusanzeige eines disponierten Fahrzeugs — und die GRENZE des Statusfarb-Vertrags.
 *
 * 1. `status_farbe` ist mandantengepflegter Freitext; das Backend prüft kein Format. Diese
 *    Farbe bleibt erhalten, geht aber nur auf Rand und Text (`StatusTag farbe`), nie auf eine
 *    Fläche: ihren Kontrast kann niemand zusichern.
 * 2. Ohne Mandantenfarbe kommt die Darstellung aus `statusKategorie`.
 *
 * Nicht über antds `color`-Prop: ein Nicht-Preset-Wert würde dort eine Vollfläche mit
 * erzwungen weißem Text. Auslöser (`StatusWahl`) und Anzeige tragen dasselbe Etikett.
 */
export function fahrzeugStatusDarstellung(ef: EinsatzFahrzeug): StatusDarstellung {
  // Ohne Status der neutrale Wortlaut — ein „—" sagte weniger, und die Zeile muss von hier aus
  // einen Status bekommen können.
  if (!ef.status_label || !ef.status_kategorie) return { rolle: 'neutral', label: 'kein Status' };
  return { ...statusKategorie[ef.status_kategorie], label: ef.status_label };
}

/**
 * Statusanzeige eines disponierten Einsatzpersonals — dieselbe Vertragsgrenze wie
 * {@link fahrzeugStatusDarstellung}: die Farbe geht auf Rand und Text, nicht auf eine Fläche.
 */
export function personalStatusDarstellung(ep: EinsatzPersonal): StatusDarstellung {
  if (!ep.status_label || !ep.status_kategorie) return { rolle: 'neutral', label: 'kein Status' };
  return { ...statusKategorie[ep.status_kategorie], label: ep.status_label };
}
