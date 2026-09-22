import type { EtbEintragAnzeige } from '../api/types';

/**
 * Verfasser eines ETB-Eintrags mit Funktion: „Vitt · S2", „Brandt · EL" (Neuentwurf S4,
 * LFH-615).
 *
 * Die Funktion ist ein **Snapshot** vom Anlegen (`erfasser_funktion`), keine Ableitung
 * beim Lesen — der Eintrag sagt, in welcher Funktion damals geschrieben wurde, auch wenn
 * die Person inzwischen umbesetzt ist. Fehlt sie (keine ableitbare Funktion oder ein
 * Eintrag älter als die Spalte), steht nur der Name; eine Funktion wird nicht erfunden.
 */
export function verfasserText(
  e: Pick<EtbEintragAnzeige, 'erfasser_name' | 'erfasser_funktion'>,
): string {
  const funktion = e.erfasser_funktion?.trim();
  return funktion ? `${e.erfasser_name} · ${funktion}` : e.erfasser_name;
}
