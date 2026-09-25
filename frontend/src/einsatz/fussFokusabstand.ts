import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Fokus nicht unter dem klebenden Spaltenfuß (WCAG 2.4.11 „Focus Not Obscured").
 *
 * Rail und Modulpanel tragen je einen Fuß mit `position: sticky; bottom: 0` (Einstellungen
 * bzw. Einsatzdauer). Die Seite scrollt im Dokument; springt der Fokus per Tab auf ein Ziel,
 * das schon im Fenster steht, scrollt der Browser nicht — auch wenn der Fuß darüber liegt.
 * Gemessen (e2e `fokus-verdeckung`, 1366 × 520 px, `handschuh`): die 72-px-Modulzeile
 * „Bereitstellungsräume" lag vollständig hinter dem 82 px hohen Einsatzdauer-Fuß.
 *
 * Abhilfe nach dem Muster von `pages/EinheitDetailPage.css` (LFH-446): die Ziele tragen
 * `scroll-margin-block-end` in Höhe des Fußes. Hier im Browser NACHGEMESSEN (die dortige
 * Regel war es nie — so der Kommentar in `pages/befehlAktionsleiste.css`, LFH-465): ohne die
 * Angabe blieb das Ziel bei drei
 * Ausgangslagen ganz oder teilweise unter dem Fuß, mit ihr in keiner — Chrome rechnet den
 * Rand in die Frage „ist das Ziel sichtbar?" ein und scrollt dann um genau diesen Betrag.
 * Die Höhe folgt per ResizeObserver dem Fuß (sie hängt an Dichte und Schrift, eine
 * Konstante wäre in zwei von drei Stufen falsch). Die Variable hängt an der Wurzel der
 * Spalte; wo kein Fuß steht (Akkordeon im Navigations-Drawer), greift der Rückfall `0px`.
 */
export const FUSS_FOKUSABSTAND = '--lfh-fuss-fokusabstand';

/** Stilanteil der Ziele — rein, damit die Zusicherung ohne Layout prüfbar bleibt. */
export const fussFokusabstandStil: CSSProperties = {
  scrollMarginBlockEnd: `var(${FUSS_FOKUSABSTAND}, 0px)`,
};

/**
 * Misst den Fuß und schreibt seine Höhe als Variable an die Wurzel. Liefert zwei
 * Callback-Refs (nicht `useRef`: der Fuß erscheint erst, wenn der Einsatz geladen ist, und
 * ein Effekt auf ein damals leeres Ref liefe nie wieder).
 */
export function useFussFokusabstand() {
  const [wurzel, setWurzel] = useState<HTMLElement | null>(null);
  const [fuss, setFuss] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!wurzel || !fuss) return;
    const aktualisiere = () =>
      wurzel.style.setProperty(FUSS_FOKUSABSTAND, `${fuss.getBoundingClientRect().height}px`);
    aktualisiere();
    const beobachter =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(aktualisiere);
    beobachter?.observe(fuss);
    return () => {
      beobachter?.disconnect();
      wurzel.style.removeProperty(FUSS_FOKUSABSTAND);
    };
  }, [wurzel, fuss]);
  return { wurzelRef: setWurzel, fussRef: setFuss };
}
