import { useCallback } from 'react';
import { entferneUntereLeiste, meldeUntereLeiste } from './untereLeiste';

/**
 * Fokusabstand zu einer am Seitenfuß angepinnten Leiste (WCAG 2.4.11 „Focus Not Obscured"):
 * misst die Leiste und schreibt ihre Höhe als CSS-Variable an `<html>`.
 *
 * Beim Vorwärtstabben rollt der Browser ein Ziel an den UNTEREN Rand des Fensters — genau
 * dorthin, wo eine angepinnte Fußleiste steht. Wie die Variable verbraucht wird, entscheidet
 * die Seite, und die Seiten entscheiden verschieden, jede gemessen:
 *  - Befehlsentwurf (LFH-465): `scroll-padding-block-end` am Dokument
 *    (`pages/befehlAktionsleiste.css`); `scroll-margin` an den Formularfeldern blieb dort
 *    wirkungslos.
 *  - ETB (LFH-373): `scroll-margin-block-end` an den Zielen der Zeitachse (`index.css`); die
 *    Scrollport-Variante rollte dort bei jedem Fokus IN der Leiste die Seite ans Ende.
 *  - Speicherleiste der Formularseiten (LFH-475, `useSpeicherLeiste`): `scroll-padding` am
 *    Dokument, gescopt über `:has` (`index.css`); `scroll-margin` an den Feldern blieb auch dort
 *    wirkungslos, ein Tab auf „Speichern" rollt die Seite gemessen nicht.
 * Deshalb EINE Messung, aber je Seite eine eigene Variable — eine gemeinsame hätte die Regel
 * der einen Seite auf die andere übertragen.
 *
 * Die Höhe wird GEMESSEN und folgt per ResizeObserver: Dichtestufe und Umbruch verändern sie
 * um mehr als das Doppelte, ein Festwert wäre in einer der Stufen daneben.
 *
 * Dieselbe Messung meldet die Leiste an `components/untereLeiste.ts` (LLH-1424): dort liest das
 * Eingangsband ihre Lage und rückt darüber. Eine neue Fußleiste, die hier misst, ist damit auch
 * dort angeschlossen.
 */
export const FOKUSABSTAND_BEFEHL = '--lfh-befehl-fokusabstand';
export const FOKUSABSTAND_ETB = '--lfh-etb-fokusabstand';
/** Speicherleiste der Formularseiten (LFH-475): `scroll-margin` an den Feldern (`index.css`). */
export const FOKUSABSTAND_SPEICHERLEISTE = '--lfh-speicherleiste-fokusabstand';
/** Tastenfeld der Ausgabeansicht (LLH-1032): `scroll-padding` am Scrollport (`index.css`). */
export const FOKUSABSTAND_ZAEHLTASTEN = '--lfh-zaehltasten-fokusabstand';
/** Klebender Fuß der Erfassungs-Hülle im Dialog (LLH-1274): `scroll-padding` am Dialog (`index.css`). */
export const FOKUSABSTAND_ERFASSUNG = '--lfh-erfassung-fokusabstand';
/**
 * Kurzzeile der Ausgabeansicht (LLH-1504), dieselbe Messung für die OBERE Kante: rückwärts
 * getabbt rollt der Browser ein Ziel an den oberen Rand, unter die klebende Zeile mit Soll,
 * ausgegeben und fehlt. `scroll-padding-block-start` am Scrollport (`index.css`), wie beim Rahmen
 * (LFH-952).
 */
export const FOKUSABSTAND_AUSGABE_KURZZEILE = '--lfh-ausgabe-kurzzeile-fokusabstand';

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
  { untereLeiste = true }: { untereLeiste?: boolean } = {},
): (() => void) | undefined {
  if (!leiste) return undefined;
  const wurzel = document.documentElement;
  const aktualisiere = () =>
    wurzel.style.setProperty(variable, `${leiste.getBoundingClientRect().height + abstand}px`);
  aktualisiere();
  // Dieselbe Leiste meldet sich als untere Leiste, der das Eingangsband ausweicht (LLH-1424,
  // `components/untereLeiste.ts`); ein Kopf oben nicht.
  if (untereLeiste) meldeUntereLeiste(leiste);
  const beobachter = new ResizeObserver(aktualisiere);
  beobachter.observe(leiste);
  return () => {
    beobachter.disconnect();
    wurzel.style.removeProperty(variable);
    if (untereLeiste) entferneUntereLeiste(leiste);
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

/**
 * Wie {@link useFokusabstandUnten}, für einen Kopf, der OBEN in seinem Scrollbereich klebt
 * (LLH-1504): dieselbe Messung, aber keine Meldung als untere Leiste.
 */
export function useFokusabstandOben(abstand: number, variable: string) {
  return useCallback(
    (el: HTMLElement | null) => beobachteFussleiste(el, abstand, variable, { untereLeiste: false }),
    [abstand, variable],
  );
}
