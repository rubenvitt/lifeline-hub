import type { EtbEintragAnzeige } from '../api/types';

/**
 * Verfasser eines ETB-Eintrags mit Funktion: „Vitt · S2", „Brandt · EL" (Neuentwurf S4,
 * LFH-615).
 *
 * Die Funktion ist ein **Snapshot** vom Anlegen (`erfasser_funktion`), keine Ableitung
 * beim Lesen — der Eintrag sagt, in welcher Funktion damals geschrieben wurde, auch wenn
 * die Person inzwischen umbesetzt ist. Fehlt sie (keine ableitbare Funktion oder ein
 * Eintrag älter als die Spalte), steht nur der Name; eine Funktion wird nicht erfunden.
 *
 * Zwischen „·" und Funktion steht ein GESCHÜTZTES Leerzeichen: wird die Zeile zu schmal,
 * bricht sie vor dem Punkt („Administrator" / „· EL"), nie zwischen Punkt und Kürzel. Die
 * Zeitachse deckelt die Verfasserbreite, damit der Meldungstext ab 1200 px die halbe Sicht
 * behält (`e2e/etb-chronologie.spec.ts`, gemessen: ungedeckelt 0,4986 im Handschuhbetrieb).
 */
export function verfasserText(
  e: Pick<EtbEintragAnzeige, 'erfasser_name' | 'erfasser_funktion'>,
): string {
  const funktion = e.erfasser_funktion?.trim();
  return funktion ? `${e.erfasser_name} ·\u00A0${funktion}` : e.erfasser_name;
}
