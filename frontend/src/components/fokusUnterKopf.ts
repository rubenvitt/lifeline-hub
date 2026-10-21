import { useEffect, type RefObject } from 'react';
import type { TableRef } from 'antd';

/**
 * Fokusabstand unter der stehenden Kopfzeile, wo `scroll-margin-top` nicht greift (LLH-1102,
 * LLH-1358). Eine Stelle für alle Tabellen mit stehender Kopfzeile: `KatalogTabelle` (damit jede
 * `Datensicht` im Tabellenzweig) und die Gefahrenmatrix.
 */

/**
 * Wie weit die Seite nach oben rollen muss, damit ein fokussiertes Ziel nicht unter der stehenden
 * Kopfzeile liegt (negativ = nach oben), oder 0. Rein, damit die Regel ohne Layout prüfbar ist.
 */
export function kopfUeberdeckung(
  ziel: Pick<DOMRect, 'top' | 'bottom'>,
  kopf: Pick<DOMRect, 'top' | 'bottom'>,
): number {
  return ziel.top < kopf.bottom && ziel.bottom > kopf.top ? ziel.top - kopf.bottom : 0;
}

/**
 * Rückwärts in die ERSTE Zeile getabbt, rollt der Browser die Seite nicht weit genug: Chromium
 * beschneidet den Fokusrand (`scroll-margin-top`, `theme/sprache.css` bzw.
 * `pages/gefahren/gefahrenMatrix.css`) an der Oberkante des Scrollcontainers `.ant-table-body`
 * (waagerechtes Scrollen, `scroll.x`), und die erste Zeile beginnt genau dort. Ein Ziel außerhalb
 * der fixierten Kennung blieb so ganz (Gefahrenmatrix, Zellen ohne Polsterung) oder mit seinem
 * Mittelpunkt (Katalogtabellen, gepolsterte Zellen, auch die rechts fixierte Aktionsspalte) unter
 * der Kopfzeile; die Kennung links rollt der Browser richtig. Gemessen in
 * `e2e/fokus-verdeckung.spec.ts`.
 *
 * Nach jedem Fokuswechsel in den Tabellenkörper wird deshalb gemessen und die Seite um die
 * Überdeckung zurückgerollt. Auch bei Fokus per Tipp oder Klick: der trifft den sichtbaren Teil
 * unterhalb der Kopfzeile, und um genau den verdeckten Rest rollt die Seite, das Ziel bleibt also
 * unter dem Finger.
 */
export function useFokusUnterKopf(tabelle: RefObject<TableRef | null>): void {
  useEffect(() => {
    const wurzel = tabelle.current?.nativeElement;
    if (!wurzel) return;
    const beiFokus = (e: FocusEvent) => {
      const ziel = e.target as HTMLElement;
      if (!ziel.closest('.ant-table-tbody')) return;
      const kopf = wurzel.querySelector('.ant-table-sticky-holder, .ant-table-header');
      if (!kopf) return;
      const versatz = kopfUeberdeckung(ziel.getBoundingClientRect(), kopf.getBoundingClientRect());
      if (versatz < 0) window.scrollBy({ top: versatz, behavior: 'instant' });
    };
    wurzel.addEventListener('focusin', beiFokus);
    return () => wurzel.removeEventListener('focusin', beiFokus);
  }, [tabelle]);
}
