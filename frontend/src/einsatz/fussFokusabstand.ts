import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Fokus nicht unter dem klebenden Spaltenfuß (WCAG 2.4.11 „Focus Not Obscured").
 *
 * Rail und Modulpanel tragen je einen Fuß mit `position: sticky; bottom: 0`. Steht ein
 * Tab-Ziel schon im Fenster, scrollt der Browser nicht — auch wenn der Fuß darüber liegt.
 *
 * Abhilfe je nach Scrollport, in Höhe des Fußes:
 *  - Modulpanel (rollt mit dem Dokument): die Ziele tragen `scroll-margin-block-end`; Chrome
 *    rechnet den Rand ein und scrollt das Dokument um genau diesen Betrag (gemessen in e2e
 *    `fokus-verdeckung`, „Modulpanel“).
 *  - Rail (rollt in der eigenen Spalte, `rail-spalte`): die SPALTE trägt
 *    `scroll-padding-block-end`. `scroll-margin` an den Zielen blieb dort wirkungslos — Chromium
 *    rollte die Spalte weder beim Fokus noch mit `scrollIntoView({ block: 'nearest' })`, und bei
 *    1366 × 520 in `handschuh` lag „Kommunikation“ ganz unter dem Fuß (LLH-1241, e2e
 *    `fokus-verdeckung`, „Rail“). Dieselbe Erfahrung wie bei der Speicherleiste (`index.css`).
 *    Die Ziele im Fuß zählt das Padding mit; sie stehen aber am Ende der Spalte, ein Fokus dort
 *    rollt sie höchstens ans Ende, wo der Fuß ohnehin steht.
 * Die Höhe folgt per ResizeObserver dem Fuß, weil sie an Dichte und Schrift hängt. Die Variable
 * hängt an der Wurzel der Spalte; ohne Fuß (Akkordeon im Navigations-Drawer) greift der Rückfall
 * `0px`.
 */
const FUSS_FOKUSABSTAND = '--lfh-fuss-fokusabstand';

/** Stilanteil der Ziele, die mit dem Dokument rollen — rein, damit die Zusicherung ohne Layout
    prüfbar bleibt. */
export const fussFokusabstandStil: CSSProperties = {
  scrollMarginBlockEnd: `var(${FUSS_FOKUSABSTAND}, 0px)`,
};

/** Stilanteil eines eigenen Scrollports, an dessen Ende der Fuß klebt (Rail-Spalte). */
export const fussFokusabstandScrollportStil: CSSProperties = {
  scrollPaddingBlockEnd: `var(${FUSS_FOKUSABSTAND}, 0px)`,
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
