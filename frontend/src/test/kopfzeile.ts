import { screen, within } from '@testing-library/react';

/**
 * Zählt die Bedienziele in der Kopfzeile.
 *
 * Nicht `getAllByRole('button')`: antds `Segmented` rendert je Stufe ein
 * `<input type="radio">`, keinen Knopf — ein Knopf-Zähler sähe die Umschalter nicht.
 * Nicht `querySelectorAll('[role="radio"]')`: die Rolle ist implizit, nur RTLs
 * Rollenabfrage rechnet sie aus.
 * Container ist die `banner`-Landmarke (antds `Layout.Header` rendert ein `<header>`), ohne
 * eigenen `data-`Marker. `link` zählt mit: die globale Kopfzeile trägt zwei echte Anker.
 */
export function zaehleBedienziele(): number {
  const kopf = screen.getByRole('banner');
  return (['button', 'radio', 'link'] as const).reduce(
    (summe, rolle) => summe + within(kopf).queryAllByRole(rolle).length,
    0,
  );
}

/**
 * Die Umschalt-Ziele in der Kopfzeile — die einzige WIDERLEGBARE Form der Nullaussage „die
 * Umschalter sind fort". Eine Abfrage nach einem Etikett, das es nirgends mehr gibt, wäre
 * durch keine Änderung rot zu bekommen; diese Zählung schlägt an, sobald irgendein
 * `Segmented` oder `Radio` zurückkehrt.
 */
export function radiosImKopf(): number {
  return within(screen.getByRole('banner')).queryAllByRole('radio').length;
}

/** Aufschlüsselung für die Diagnose — welche Sorte Ziel dazugekommen ist. */
export function bedienzieleNachRolle(): Record<string, number> {
  const kopf = screen.getByRole('banner');
  return Object.fromEntries(
    (['button', 'radio', 'link'] as const).map((rolle) => [
      rolle,
      within(kopf).queryAllByRole(rolle).length,
    ]),
  );
}
