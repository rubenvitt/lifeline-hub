import { useCallback } from 'react';

/**
 * Mindesthöhe „bis zur Unterkante des Bildlaufs“ (LLH-1294): ein Element füllt mindestens den
 * Rest seines Scrollbereichs, aber nie mehr. Damit steht ein klebender Fuß (das Tastenfeld der
 * Ausgabeansicht) auch bei kurzem Inhalt am unteren Rand, ohne dass die Seite um Kopfleiste oder
 * Gerätenavigation scrollbar wird. `100dvh` war dafür zu groß: es zählt, was über und unter dem
 * Inhalt steht, mit.
 *
 * Ein Fuß mit `position: sticky; bottom: 0` steht an der Kante, an der sein Scrollbereich klebt,
 * und genau dort endet das Element, damit der Fuß bei kurzem und bei langem Inhalt an derselben
 * Stelle steht (Spec: eine Buchung verschiebt keine Zähltaste):
 *  - In einem eigenen Scrollbereich (die Gerätehülle rollt ihr `main`, `overflow: auto`) klebt der
 *    Fuß über dessen unterer Polsterung. Das Element füllt die sichtbare Höhe minus seine Lage
 *    darin minus diese Polsterung. Die Gerätenavigation steht außerhalb und zählt nie mit.
 *  - Rollt das Dokument, klebt der Fuß an der Fensterkante, die Seitenpolsterung
 *    (`--lfh-seiten-polsterung`, Inhalt von `EinsatzLayout`) liegt aber darüber. Das Element reicht
 *    deshalb über sie hinweg bis an die Kante (`100dvh` minus seine Lage im Dokument, negativer
 *    Außenabstand in Höhe der Polsterung; es muss das letzte im Inhalt sein), und
 *    {@link REST_UNTEN_VAR} gibt dem Fuß die Polsterung als Innenabstand zurück.
 *
 * GEMESSEN, wie `--lfh-rahmen-oben` (`rahmenOben.ts`) und `FensterRahmen`.
 * Die Lage wird in Inhaltskoordinaten gerechnet, also unabhängig vom aktuellen Bildlauf.
 */

/** Der nächste Vorfahr, der selbst rollt; `null` = das Dokument. */
export function scrollbereichVon(el: HTMLElement): HTMLElement | null {
  for (let k = el.parentElement; k; k = k.parentElement) {
    // `body` und `html` geben ihren Überlauf an das Fenster ab: dort rollt das Dokument.
    if (k === document.body || k === document.documentElement) return null;
    const { overflowY } = getComputedStyle(k);
    if (overflowY === 'auto' || overflowY === 'scroll') return k;
  }
  return null;
}

/**
 * Wie weit ein Fuß mit `bottom: 0` über der Polsterung liegen muss, die das Element überdeckt
 * (siehe oben). Ein klebender Fuß nimmt sie als untere Innenpolsterung, damit seine Knöpfe nicht an
 * der Fensterkante stehen.
 */
export const REST_UNTEN_VAR = '--lfh-rest-unten';

export interface RestHoehe {
  minHeight: string;
  marginBottom: string;
  /** Wert für {@link REST_UNTEN_VAR}. */
  unten: string;
}

/** Die Werte, gerechnet aus der aktuellen Lage. */
export function restHoeheVon(el: HTMLElement): RestHoehe {
  const bereich = scrollbereichVon(el);
  const oben = el.getBoundingClientRect().top;
  if (bereich == null) {
    const imDokument = Math.round(oben + window.scrollY);
    return {
      minHeight: `calc(100dvh - ${imDokument}px)`,
      marginBottom: 'calc(-1 * var(--lfh-seiten-polsterung, 0px))',
      unten: 'var(--lfh-seiten-polsterung, 0px)',
    };
  }
  const kasten = bereich.getBoundingClientRect();
  const imBereich = oben - kasten.top - bereich.clientTop + bereich.scrollTop;
  const polsterung = parseFloat(getComputedStyle(bereich).paddingBottom) || 0;
  return {
    minHeight: `${Math.max(0, Math.floor(bereich.clientHeight - imBereich - polsterung))}px`,
    marginBottom: '',
    unten: '0px',
  };
}

/**
 * Callback-Ref: setzt `min-height`, `margin-bottom` und {@link REST_UNTEN_VAR} des Elements nach
 * {@link restHoeheVon} und hält sie, solange es hängt. Neu gemessen wird, wenn sich ein Vorfahr
 * in der Größe ändert (Kopf bricht um, Hinweis erscheint, Dichtewechsel, Fenster) — im nächsten Bild, nicht im ResizeObserver selbst: die neue
 * Höhe ändert sofort die beobachteten Vorfahren (dieselbe Falle wie `FensterRahmen`, LLH-1335).
 */
export function useRestHoehe<T extends HTMLElement>(): (el: T | null) => (() => void) | undefined {
  return useCallback((el: T | null) => {
    if (!el) return undefined;
    const messen = () => {
      const { minHeight, marginBottom, unten } = restHoeheVon(el);
      el.style.minHeight = minHeight;
      el.style.marginBottom = marginBottom;
      el.style.setProperty(REST_UNTEN_VAR, unten);
    };
    messen();
    let bild: number | undefined;
    const planen = () => {
      if (bild != null) return;
      bild = requestAnimationFrame(() => {
        bild = undefined;
        messen();
      });
    };
    const beobachter = new ResizeObserver(planen);
    for (let k = el.parentElement; k; k = k.parentElement) beobachter.observe(k);
    window.addEventListener('resize', planen);
    return () => {
      beobachter.disconnect();
      window.removeEventListener('resize', planen);
      if (bild != null) cancelAnimationFrame(bild);
    };
  }, []);
}
