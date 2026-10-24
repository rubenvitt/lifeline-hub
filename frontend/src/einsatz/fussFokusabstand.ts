import { useEffect, useState } from 'react';

/**
 * Fokus nicht unter dem klebenden Fuß des Modulpanels (WCAG 2.4.11 „Focus Not Obscured").
 *
 * Das Modulpanel trägt einen Fuß mit `position: sticky; bottom: 0`. Steht ein Tab-Ziel schon im
 * Fenster, scrollt der Browser nicht — auch wenn der Fuß darüber liegt.
 *
 * Abhilfe: `scroll-padding-block-end` in Höhe des Fußes am SCROLLPORT. `scroll-margin` an den
 * Zielen blieb wirkungslos, sobald das Ziel schon im Scrollport stand — dieselbe Erfahrung wie bei
 * der Speicherleiste (`index.css`). Gemessen bei 1366 × 520 in `handschuh` (LLH-1241, e2e
 * `fokus-verdeckung`, „Einheit“): „Material“ und „Bereitstellungsräume“ lagen getabbt unter dem
 * Fuß des Modulpanels. Das Panel rollt mit dem Dokument: die Variable hängt am `<html>`, das
 * Padding setzt `index.css` nur, solange der Fokus im Panel steht — sonst rollte jeder Fokus im
 * Inhalt um die Fußhöhe zu weit. Die Rail brauchte dasselbe, bis ihr Fuß nicht mehr klebte
 * (LLH-1273, `IconRail.tsx`).
 *
 * Die Höhe folgt per ResizeObserver dem Fuß, weil sie an Dichte und Schrift hängt. Ohne Fuß
 * (Panel ohne geladenen Einsatz) greift der Rückfall `0px`.
 */
const FUSS_FOKUSABSTAND = '--lfh-modulpanel-fokusabstand';

/**
 * Misst den Fuß und schreibt seine Höhe als Variable ans `<html>`. Liefert einen Callback-Ref
 * (nicht `useRef`: der Fuß erscheint erst, wenn der Einsatz geladen ist, und ein Effekt auf ein
 * damals leeres Ref liefe nie wieder).
 */
export function useFussFokusabstand() {
  const [fuss, setFuss] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!fuss) return;
    const traeger = document.documentElement;
    const aktualisiere = () =>
      traeger.style.setProperty(FUSS_FOKUSABSTAND, `${fuss.getBoundingClientRect().height}px`);
    aktualisiere();
    const beobachter =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(aktualisiere);
    beobachter?.observe(fuss);
    return () => {
      beobachter?.disconnect();
      traeger.style.removeProperty(FUSS_FOKUSABSTAND);
    };
  }, [fuss]);
  return { fussRef: setFuss };
}
