import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * LFH-644: Kein Kurzetikett der IconRail ist breiter als die Rail. „ERFASSUNG“ (9 px Versalien,
 * Sperrung .06em) stand breiter als die 60-px-Spalte und verlor links den ersten Buchstaben
 * (Befund 9 der Hellmodus-Prüfliste LFH-618).
 *
 * ZWEI Messungen je Etikett, weil jede allein eine Lücke hat:
 * - `scrollWidth <= clientWidth` (Akzeptanzkriterium) trägt nur, solange das Etikett auf die
 *   Zielbreite begrenzt ist (`maxWidth: '100%'` in `IconRail.tsx`) — ohne die Grenze ist es
 *   immer genau so breit wie sein Text, und die Messung wäre stets grün.
 * - Der Kasten des Etiketts liegt in der Innenfläche der Rail (ohne Haarlinie). Das hält auch,
 *   wenn jemand die Grenze entfernt.
 *
 * Rollenunabhängig: `kategorien` ist eine statische Liste, die Rail zeigt sie jeder Rolle gleich.
 * Gemessen in beiden Modi (die Rail ist in beiden dunkel, die Schrift dieselbe — der Durchgang
 * belegt das, statt es anzunehmen) und in jeder Stufe: in `handschuh` wächst die Rail, die
 * Schrift nicht, also sind `kompakt`/`komfortabel` (60 px) die engen Fälle.
 */

const BREITEN = [1440, 1024] as const;
const MODI = ['dark', 'light'] as const;
const STUFEN = ['kompakt', 'komfortabel', 'handschuh'] as const;

/** `boundingBox()` liefert Fließkomma; ein zufällig rotes Gate wird abgeschaltet statt befolgt. */
const SUBPIXEL = 0.5;

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

for (const stufe of STUFEN) {
  test(`Stufe ${stufe}: jedes Rail-Etikett passt in die Rail (1440/1024, beide Modi)`, async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, `LFH-644 Rail ${stufe} ${Date.now()}`);

    for (const modus of MODI) {
      await page.evaluate(
        ([m, s]) => {
          localStorage.setItem('lifeline-hub.theme', m);
          localStorage.setItem('lifeline-hub.dichte', s);
        },
        [modus, stufe] as const,
      );
      for (const breite of BREITEN) {
        await page.setViewportSize({ width: breite, height: 900 });
        await page.goto(`/einsaetze/${einsatzId}/etb`);
        await expect(page.locator('html')).toHaveAttribute('data-dichte', stufe);
        await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

        const rail = page.getByRole('navigation', { name: 'Kategorien' });
        await expect(rail).toBeVisible();
        const etiketten = rail.locator('[data-lfh="rail-etikett"]');
        // Sechs Ziele in EINER Landmarke (`IconRail.tsx`); weniger hieße, die Messung griffe ins Leere.
        await expect(etiketten).toHaveCount(6);
        // Webfont abwarten: mit der Ersatzschrift wäre die Breite eine andere.
        await page.evaluate(() => document.fonts.ready);

        const messung = await rail.evaluate((nav) => {
          const navKasten = nav.getBoundingClientRect();
          const stil = getComputedStyle(nav);
          const innenLinks = navKasten.left + parseFloat(stil.borderLeftWidth);
          const innenRechts = navKasten.right - parseFloat(stil.borderRightWidth);
          return Array.from(nav.querySelectorAll<HTMLElement>('[data-lfh="rail-etikett"]')).map(
            (el) => {
              const k = el.getBoundingClientRect();
              return {
                text: el.textContent ?? '',
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                links: k.left - innenLinks,
                rechts: innenRechts - k.right,
              };
            },
          );
        });

        for (const e of messung) {
          const ort = `${breite}px ${modus} ${stufe} „${e.text}“`;
          expect
            .soft(
              e.scrollWidth,
              `${ort}: scrollWidth ${e.scrollWidth} > clientWidth ${e.clientWidth}`,
            )
            .toBeLessThanOrEqual(e.clientWidth);
          expect.soft(e.links, `${ort}: ragt links aus der Rail`).toBeGreaterThanOrEqual(-SUBPIXEL);
          expect
            .soft(e.rechts, `${ort}: ragt rechts aus der Rail`)
            .toBeGreaterThanOrEqual(-SUBPIXEL);
        }
      }
    }
  });
}
