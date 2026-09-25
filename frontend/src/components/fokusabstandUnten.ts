import { useCallback } from 'react';

/**
 * Fokusabstand zu einer am Seitenfuß angepinnten Leiste (WCAG 2.4.11 „Focus Not Obscured"):
 * misst die Leiste und schreibt ihre Höhe als CSS-Variable an `<html>`.
 *
 * Beim Vorwärtstabben rollt der Browser ein Ziel an den UNTEREN Rand des Fensters — genau
 * dorthin, wo eine angepinnte Fußleiste steht. Wie die Variable verbraucht wird, entscheidet
 * die Seite, und die zwei Seiten entscheiden verschieden, beide gemessen:
 *  - Befehlsentwurf (LFH-465): `scroll-padding-block-end` am Dokument
 *    (`pages/befehlAktionsleiste.css`); `scroll-margin` an den Formularfeldern blieb dort
 *    wirkungslos.
 *  - ETB (LFH-373): `scroll-margin-block-end` an den Zielen der Zeitachse (`index.css`); die
 *    Scrollport-Variante rollte dort bei jedem Fokus IN der Leiste die Seite ans Ende.
 * Deshalb EINE Messung, aber je Seite eine eigene Variable — eine gemeinsame hätte die Regel
 * der einen Seite auf die andere übertragen.
 *
 * Die Höhe wird GEMESSEN und folgt per ResizeObserver: Dichtestufe und Umbruch verändern sie
 * um mehr als das Doppelte, ein Festwert wäre in einer der Stufen daneben.
 */
export const FOKUSABSTAND_BEFEHL = '--lfh-befehl-fokusabstand';
export const FOKUSABSTAND_ETB = '--lfh-etb-fokusabstand';

/**
 * Callback-Ref-Körper: misst die Leiste, schreibt Höhe + `abstand` als `variable` an `<html>`
 * und gibt die Aufräumfunktion zurück (React 19 ruft sie beim Aushängen). Das Wurzelelement
 * überlebt die Route — ohne Aufräumen verschöbe der Abzug den Fokus-Scroll jeder folgenden
 * Seite um eine Leistenhöhe, die es dort nicht gibt. `e2e/befehl-aktionsleiste.spec.ts` prüft genau das.
 */
export function beobachteFussleiste(
  leiste: HTMLElement | null,
  abstand: number,
  variable: string,
): (() => void) | undefined {
  if (!leiste) return undefined;
  const wurzel = document.documentElement;
  const aktualisiere = () =>
    wurzel.style.setProperty(variable, `${leiste.getBoundingClientRect().height + abstand}px`);
  aktualisiere();
  const beobachter = new ResizeObserver(aktualisiere);
  beobachter.observe(leiste);
  return () => {
    beobachter.disconnect();
    wurzel.style.removeProperty(variable);
  };
}

/**
 * Stabiler Callback-Ref für die Fußleiste. `useCallback`, nicht inline: eine Seite, die bei
 * jedem Tastenanschlag neu rendert (Befehlsentwurf, ETB-Erfassung), bekäme sonst jedes Mal
 * eine neue Ref-Identität, und React baute Beobachter samt Variable pro Zeichen neu auf.
 */
export function useFokusabstandUnten(abstand: number, variable: string) {
  return useCallback(
    (el: HTMLElement | null) => beobachteFussleiste(el, abstand, variable),
    [abstand, variable],
  );
}
