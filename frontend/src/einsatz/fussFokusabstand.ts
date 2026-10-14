import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Fokus nicht unter dem klebenden Spaltenfuß (WCAG 2.4.11 „Focus Not Obscured").
 *
 * Rail und Modulpanel tragen je einen Fuß mit `position: sticky; bottom: 0`. Steht ein
 * Tab-Ziel schon im Fenster, scrollt der Browser nicht — auch wenn der Fuß darüber liegt.
 *
 * Abhilfe: `scroll-padding-block-end` in Höhe des Fußes am SCROLLPORT. `scroll-margin` an den
 * Zielen blieb wirkungslos, sobald das Ziel schon im Scrollport stand — dieselbe Erfahrung wie bei
 * der Speicherleiste (`index.css`). Gemessen bei 1366 × 520 in `handschuh` (LLH-1241, e2e
 * `fokus-verdeckung`, „Rail“ und „Einheit“): „Kommunikation“ lag getabbt ganz unter dem Fuß der
 * Rail, „Material“ und „Bereitstellungsräume“ unter dem Fuß des Modulpanels.
 *  - Rail (`ort: 'spalte'`): die Spalte `rail-spalte` rollt in sich und trägt das Padding selbst
 *    ({@link fussFokusabstandScrollportStil}); die Variable hängt an der Wurzel der Rail. Die Ziele
 *    im Fuß zählt das Padding mit; sie stehen aber am Ende der Spalte, ein Fokus dort rollt sie
 *    höchstens ans Ende, wo der Fuß ohnehin steht.
 *  - Modulpanel (`ort: 'dokument'`): es rollt mit dem Dokument. Die Variable hängt am `<html>`,
 *    das Padding setzt `index.css` nur, solange der Fokus im Panel steht — sonst rollte jeder
 *    Fokus im Inhalt um die Fußhöhe zu weit.
 * Die Höhe folgt per ResizeObserver dem Fuß, weil sie an Dichte und Schrift hängt. Ohne Fuß
 * (Akkordeon im Navigations-Drawer, Panel ohne geladenen Einsatz) greift der Rückfall `0px`.
 */
const FUSS_FOKUSABSTAND = {
  spalte: '--lfh-fuss-fokusabstand',
  dokument: '--lfh-modulpanel-fokusabstand',
} as const;

/** Stilanteil eines eigenen Scrollports, an dessen Ende der Fuß klebt (Rail-Spalte) — rein, damit
    die Zusicherung ohne Layout prüfbar bleibt. */
export const fussFokusabstandScrollportStil: CSSProperties = {
  scrollPaddingBlockEnd: `var(${FUSS_FOKUSABSTAND.spalte}, 0px)`,
};

/**
 * Misst den Fuß und schreibt seine Höhe als Variable an die Wurzel (`spalte`) bzw. ans `<html>`
 * (`dokument`). Liefert zwei Callback-Refs (nicht `useRef`: der Fuß erscheint erst, wenn der
 * Einsatz geladen ist, und ein Effekt auf ein damals leeres Ref liefe nie wieder); `wurzelRef`
 * braucht nur `spalte`.
 */
export function useFussFokusabstand(ort: 'spalte' | 'dokument') {
  const [wurzel, setWurzel] = useState<HTMLElement | null>(null);
  const [fuss, setFuss] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const traeger = ort === 'dokument' ? document.documentElement : wurzel;
    if (!traeger || !fuss) return;
    const variable = FUSS_FOKUSABSTAND[ort];
    const aktualisiere = () =>
      traeger.style.setProperty(variable, `${fuss.getBoundingClientRect().height}px`);
    aktualisiere();
    const beobachter =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(aktualisiere);
    beobachter?.observe(fuss);
    return () => {
      beobachter?.disconnect();
      traeger.style.removeProperty(variable);
    };
  }, [ort, wurzel, fuss]);
  return { wurzelRef: setWurzel, fussRef: setFuss };
}
