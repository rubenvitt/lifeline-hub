import { screen, within } from '@testing-library/react';

/**
 * Zählt die Bedienziele in der Kopfzeile (LFH-392).
 *
 * WARUM NICHT `getAllByRole('button')`: antds `Segmented` rendert je Stufe ein
 * `<input type="radio">` in einem `<label>` — KEINEN Knopf. Ein Knopf-Zähler sah
 * die sechs Umschalter deshalb gar nicht und stand vor wie nach dem Umbau auf
 * derselben Zahl; er hätte die Behauptung „belegt gesunken" trivial erfüllt.
 * Gemessen am Bestand: `button` = 5, `radio` = 6 in der Einsatz-Kopfzeile.
 *
 * WARUM NICHT `querySelectorAll('[role="radio"]')`: die Rolle ist IMPLIZIT aus
 * dem Elementtyp. Als CSS-Attributselektor gemessen: 0 Treffer. Nur RTLs
 * Rollenabfrage rechnet sie aus.
 *
 * WARUM DIE `banner`-LANDMARKE als Container: antds `Layout.Header` rendert ein
 * `<header>` (gemessen: genau eine `banner`-Rolle im Dokument), es braucht also
 * keinen erfundenen `data-`Marker, den nur der Test liest. Wer den Container
 * änderte, ohne den Zähler zu ändern, bekäme sofort eine andere Zahl.
 *
 * `link` ist mitgezählt, weil die globale Kopfzeile links zwei echte Anker trägt
 * (Marke, Verwaltung) — sie sind Bedienziele wie jeder Knopf.
 */
export function zaehleBedienziele(): number {
  const kopf = screen.getByRole('banner');
  return (['button', 'radio', 'link'] as const).reduce(
    (summe, rolle) => summe + within(kopf).queryAllByRole(rolle).length,
    0,
  );
}

/**
 * Die Umschalt-Ziele in der Kopfzeile — die einzige WIDERLEGBARE Form der
 * Nullaussage „die Umschalter sind fort" (LFH-392).
 *
 * Der naheliegende Weg wäre `queryByRole('radiogroup', { name: 'Farbschema
 * wählen' })`. Der taugt hier nicht: das Etikett kam mit `ThemeToggle.tsx` fort
 * und steht im ganzen Repo nirgends mehr. Eine Null darauf ist durch KEINE
 * Änderung am Produktivcode rot zu bekommen — sie behauptete eine Deckung, die
 * sie nicht hat. Diese Zählung schlägt an, sobald irgendein `Segmented` oder
 * `Radio` in die Kopfzeile zurückkehrt, gleich wie beschriftet.
 */
export function radiosImKopf(): number {
  return within(screen.getByRole('banner')).queryAllByRole('radio').length;
}

/** Aufschlüsselung für die Diagnose — ein reiner Zahlenvergleich sagt beim
 *  Fehlschlag nicht, WELCHE Sorte Ziel dazugekommen ist. */
export function bedienzieleNachRolle(): Record<string, number> {
  const kopf = screen.getByRole('banner');
  return Object.fromEntries(
    (['button', 'radio', 'link'] as const).map((rolle) => [
      rolle,
      within(kopf).queryAllByRole(rolle).length,
    ]),
  );
}
