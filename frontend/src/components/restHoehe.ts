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
 *  - In einem eigenen Scrollbereich (die Gerätehülle rollt ihr `main`, `overflow: auto`) klebt
 *    Chromium ein `bottom: 0` über dessen unterer Polsterung; darunter schiene der Inhalt in einem
 *    Streifen durch. Das Element reicht deshalb wie im Dokument über die Polsterung bis an die
 *    Kante (sichtbare Höhe minus seine Lage darin, negativer Außenabstand in Höhe der Polsterung),
 *    {@link REST_KANTE_VAR} setzt den Fuß um sie tiefer, {@link REST_UNTEN_VAR} gibt sie ihm als
 *    Innenabstand zurück. Die Gerätenavigation steht außerhalb und zählt nie mit.
 *  - Rollt das Dokument, klebt der Fuß an der Fensterkante, die Seitenpolsterung
 *    (`--lfh-seiten-polsterung`, Inhalt von `EinsatzLayout`) liegt aber darüber. Das Element reicht
 *    deshalb über sie hinweg bis an die Kante (`100dvh` minus seine Lage im Dokument, negativer
 *    Außenabstand in Höhe der Polsterung; es muss das letzte im Inhalt sein), und
 *    {@link REST_UNTEN_VAR} gibt dem Fuß die Polsterung als Innenabstand zurück.
 *
 * Dieselbe Unterscheidung gilt oben: was in der Ansicht oben klebt (LLH-1504, die Kurzzeile der
 * Ausgabe), hängt sich im Dokument unter den klebenden Rahmen (`--lfh-rahmen-oben`), im eigenen
 * Scrollbereich an dessen Oberkante; {@link REST_OBEN_VAR} trägt den passenden Wert. Dort zählt
 * die obere Polsterung negativ: Chromium lässt ein `sticky` sonst um sie unter der Kante stehen,
 * und der Inhalt schiene in diesem Streifen darüber durch.
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

/**
 * Das `bottom` eines Fußes, der unten klebt (siehe oben): im Dokument `0px`, im eigenen
 * Scrollbereich minus dessen untere Polsterung, damit er an der Kante steht und nicht darüber.
 * Gesetzt als `bottom: var(--lfh-rest-kante, 0px)`.
 */
export const REST_KANTE_VAR = '--lfh-rest-kante';

/**
 * Das `top` für ein Element, das in der Ansicht oben klebt (siehe oben): im Dokument unter dem
 * klebenden Rahmen, im eigenen Scrollbereich an dessen Oberkante (minus obere Polsterung). Gesetzt
 * als `top: var(--lfh-rest-oben, var(--lfh-rahmen-oben, 0px))`; der Rückfall gilt bis zur ersten
 * Messung.
 */
export const REST_OBEN_VAR = '--lfh-rest-oben';

export interface RestHoehe {
  minHeight: string;
  marginBottom: string;
  /** Wert für {@link REST_UNTEN_VAR}. */
  unten: string;
  /** Wert für {@link REST_KANTE_VAR}. */
  kante: string;
  /** Wert für {@link REST_OBEN_VAR}. */
  oben: string;
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
      kante: '0px',
      oben: 'var(--lfh-rahmen-oben, 0px)',
    };
  }
  const kasten = bereich.getBoundingClientRect();
  const imBereich = oben - kasten.top - bereich.clientTop + bereich.scrollTop;
  const stil = getComputedStyle(bereich);
  const polsterung = parseFloat(stil.paddingBottom) || 0;
  const polsterungOben = parseFloat(stil.paddingTop) || 0;
  return {
    minHeight: `${Math.max(0, Math.floor(bereich.clientHeight - imBereich))}px`,
    marginBottom: `${-polsterung}px`,
    unten: `${polsterung}px`,
    kante: `${-polsterung}px`,
    oben: `${-polsterungOben}px`,
  };
}

/**
 * Callback-Ref: setzt `min-height`, `margin-bottom`, {@link REST_UNTEN_VAR}, {@link REST_KANTE_VAR} und {@link REST_OBEN_VAR}
 * des Elements nach {@link restHoeheVon} und hält sie, solange es hängt. Neu gemessen wird, wenn sich ein Vorfahr
 * in der Größe ändert (Kopf bricht um, Hinweis erscheint, Dichtewechsel, Fenster) — im nächsten Bild, nicht im ResizeObserver selbst: die neue
 * Höhe ändert sofort die beobachteten Vorfahren (dieselbe Falle wie `FensterRahmen`, LLH-1335).
 */
export function useRestHoehe<T extends HTMLElement>(): (el: T | null) => (() => void) | undefined {
  return useCallback((el: T | null) => {
    if (!el) return undefined;
    const messen = () => {
      const { minHeight, marginBottom, unten, kante, oben } = restHoeheVon(el);
      el.style.minHeight = minHeight;
      el.style.marginBottom = marginBottom;
      el.style.setProperty(REST_UNTEN_VAR, unten);
      el.style.setProperty(REST_KANTE_VAR, kante);
      el.style.setProperty(REST_OBEN_VAR, oben);
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
