import type { Locator } from '@playwright/test';

/**
 * Überstandsmessung der Leisten-Gates, geteilt von `lagekarte-leiste-dichte.spec.ts` (Admin und
 * Beobachter) und `pegel-pruefliste.spec.ts` (Fachebenen-Inspector). Wer einen Überstand misst,
 * nimmt ihn von hier statt einer Kopie — Muster `rollen-kern.ts`.
 *
 * STRUKTURUNABHÄNGIG: jedes Element unter `paneel`, das rechts aus ihm ragt. Ein Griff nach
 * einem bestimmten Kind (etwa dem Namensteil neben dem Schalter) hinge an der heutigen
 * Zeilenstruktur.
 *
 * Gemessen werden Elemente UND Textzeilen: ein Block-`div` bleibt so breit wie sein Elternteil,
 * auch wenn sein Text (`white-space: nowrap`) darüber hinausläuft — die Elementkästen allein
 * sähen das nicht (Mutationsprobe LFH-821, 146 px Überstand bei grünem Test). Jede Textzeile
 * misst `Range.getClientRects()`.
 *
 * Gezählt wird nur, was SICHTBAR hinausragt: `Range.getClientRects()` liefert die gelegte Zeile,
 * auch wo ein Vorfahr sie abschneidet. Ein bewusst gekürzter Name (antds `ellipsis`, „…“ mit
 * Tooltip) liegt so 8 px über dem Rand und ist doch im Kasten. Deshalb endet eine Textzeile am
 * rechten Rand des nächsten klippenden Vorfahren (`overflow-x` nicht `visible`) unterhalb von
 * `paneel`; ragt dieser Vorfahr selbst hinaus, meldet ihn die Elementmessung.
 */

/** Subpixel-Spielraum: Chromium liefert Fließkomma und rundet unter Last anders. */
const SUBPIXEL = 0.5;

/** Was rechts aus `paneel` ragt, als lesbare Befunde; leer heißt: nichts ragt hinaus. */
export function ueberstaende(paneel: Locator): Promise<string[]> {
  return paneel.evaluate((el, toleranz) => {
    const rand = el.getBoundingClientRect().right + toleranz;
    const befunde = [...el.querySelectorAll<HTMLElement>('*')]
      .filter((kind) => {
        const k = kind.getBoundingClientRect();
        return k.width > 0 && k.right > rand;
      })
      .map(
        (kind) =>
          `${kind.innerText.split('\n')[0] || kind.tagName} (+${Math.round(kind.getBoundingClientRect().right - rand)} px)`,
      );
    const gang = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const bereich = document.createRange();
    for (let t = gang.nextNode(); t; t = gang.nextNode()) {
      if (!t.textContent?.trim()) continue;
      bereich.selectNodeContents(t);
      let rechts = Math.max(...[...bereich.getClientRects()].map((r) => r.right));
      for (let v = t.parentElement; v && v !== el; v = v.parentElement) {
        if (getComputedStyle(v).overflowX !== 'visible')
          rechts = Math.min(rechts, v.getBoundingClientRect().right);
      }
      if (rechts > rand)
        befunde.push(`Text „${t.textContent.trim()}" (+${Math.round(rechts - rand)} px)`);
    }
    return befunde;
  }, SUBPIXEL);
}
