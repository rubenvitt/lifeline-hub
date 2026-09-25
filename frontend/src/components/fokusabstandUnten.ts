import { useCallback } from 'react';

/**
 * Fokusabstand zu einer am Seitenfuß angepinnten Leiste (WCAG 2.4.11 „Focus Not Obscured").
 *
 * Beim Vorwärtstabben rollt der Browser ein Ziel an den UNTEREN Rand des Fensters — genau
 * dorthin, wo eine `sticky`/`fixed`-Fußleiste steht. Ohne Abzug parkt das Ziel hinter ihr.
 * Gemessen an zwei Seiten:
 *  - Befehlsentwurf (LFH-465): `einsatzunterstuetzung` stand auf `top: 764`, die Leiste
 *    begann bei 766 — mit Abzug 42 px (`kompakt`) bzw. 133 px (`handschuh`) frei.
 *  - ETB (LFH-373): jeder zweite bis jeder Zeilenauslöser lag vollständig hinter der
 *    Erfassungsleiste, auf 390 und 1366 px, in `kompakt` wie `handschuh`.
 *
 * Die Regel dazu steht EINMAL, in `index.css`:
 * `:root { scroll-padding-block-end: var(--lfh-fokusabstand-unten, 0px) }`. Sie sitzt am
 * Scrollport, und der ist auf beiden Seiten das Dokument. Bis LFH-373 stand sie seitenlokal
 * in `pages/befehlAktionsleiste.css` — ein zweiter `:root`-Block für das ETB hätte sie still
 * überschrieben, weil beide dieselbe Eigenschaft setzen. Eine gemeinsame Variable streitet
 * nicht: nie sind zwei dieser Seiten zugleich eingehängt, und wer aushängt, räumt weg.
 *
 * `scroll-padding` am Scrollport, nicht `scroll-margin` an den Zielen: die Ziel-Variante blieb
 * in LFH-465 im Browser gemessen wirkungslos (die Ursache ist nicht geklärt und wird hier
 * nicht behauptet). `einsatz/fussFokusabstand.ts` löst die SPALTENFÜSSE von Rail und
 * Modulpanel dagegen mit `scroll-margin` und ist dort nachgemessen — das ist ein anderer
 * Scrollfall (ein Ziel, das schon im Fenster steht), kein Widerspruch.
 *
 * Die Höhe wird GEMESSEN und folgt per ResizeObserver: Dichtestufe und Umbruch verändern sie
 * um mehr als das Doppelte, ein Festwert wäre in einer der Stufen daneben.
 */
export const FOKUSABSTAND_UNTEN = '--lfh-fokusabstand-unten';

/**
 * Callback-Ref-Körper: misst die Leiste, schreibt Höhe + `abstand` an `<html>` und gibt die
 * Aufräumfunktion zurück (React 19 ruft sie beim Aushängen). Das Wurzelelement überlebt die
 * Route — ohne Aufräumen verschöbe der Abzug den Fokus-Scroll jeder folgenden Seite um eine
 * Leistenhöhe, die es dort nicht gibt. `e2e/befehl-aktionsleiste.spec.ts` prüft genau das.
 */
export function beobachteFussleiste(
  leiste: HTMLElement | null,
  abstand: number,
): (() => void) | undefined {
  if (!leiste) return undefined;
  const wurzel = document.documentElement;
  const aktualisiere = () =>
    wurzel.style.setProperty(
      FOKUSABSTAND_UNTEN,
      `${leiste.getBoundingClientRect().height + abstand}px`,
    );
  aktualisiere();
  const beobachter = new ResizeObserver(aktualisiere);
  beobachter.observe(leiste);
  return () => {
    beobachter.disconnect();
    wurzel.style.removeProperty(FOKUSABSTAND_UNTEN);
  };
}

/**
 * Stabiler Callback-Ref für die Fußleiste. `useCallback`, nicht inline: eine Seite, die bei
 * jedem Tastenanschlag neu rendert (Befehlsentwurf, ETB-Erfassung), bekäme sonst jedes Mal
 * eine neue Ref-Identität, und React baute Beobachter samt Variable pro Zeichen neu auf.
 */
export function useFokusabstandUnten(abstand: number) {
  return useCallback((el: HTMLElement | null) => beobachteFussleiste(el, abstand), [abstand]);
}
