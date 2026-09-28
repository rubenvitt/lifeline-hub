import type { EtbEintragAnzeige } from '../api/types';

/**
 * Verfasser eines ETB-Eintrags mit Funktion: „Vitt · S2", „Brandt · EL" (LFH-615).
 *
 * Die Funktion ist ein **Snapshot** vom Anlegen (`erfasser_funktion`), keine Ableitung beim
 * Lesen — der Eintrag sagt, in welcher Funktion damals geschrieben wurde. Fehlt sie, steht nur
 * der Name; eine Funktion wird nicht erfunden.
 *
 * Zwischen „·" und Funktion steht ein GESCHÜTZTES Leerzeichen: wird die Zeile zu schmal,
 * bricht sie vor dem Punkt, nie zwischen Punkt und Kürzel. Die Zeitachse deckelt die
 * Verfasserbreite, damit der Meldungstext die halbe Sicht behält (`e2e/etb-chronologie.spec.ts`).
 */
export function verfasserText(
  e: Pick<EtbEintragAnzeige, 'erfasser_name' | 'erfasser_funktion'>,
): string {
  const funktion = e.erfasser_funktion?.trim();
  return funktion ? `${e.erfasser_name} ·\u00A0${funktion}` : e.erfasser_name;
}
