import { expect, test } from '@playwright/test';
import {
  A4_DRUCKBREITE,
  ABSCHNITT,
  SUBPIXEL,
  anmelden,
  einsatzAnlegen,
  oeffneOrganigramm,
  organigramm,
  seedeGross,
} from './fuehrungsorganisation-kern';

/**
 * Druck der Führungsorganisation (LFH-626): was nur der Browser zeigt. Chromium, Firefox und
 * WebKit prüfen die Mechanik unter Druckmedium (`DRUCK_SPECS`, LFH-915); ein PDF erzeugt diese
 * Spec nicht, sie braucht deshalb keinen Chromium-Zweig.
 *
 * - DRUCKPFAD bei A4-Breite (680 px): ein zugeklappter Abschnitt ist nach dem Druckknopf offen
 *   (`beforeprint` selbst ausgelöst, `emulateMedia` feuert es nicht), Druckkopf
 *   „Führungsorganisation“, zwei Spalten, kein Knoten ragt aus der Druckwurzel, Werkzeugzeile,
 *   Umschalter und Klappziele sind aus.
 *
 * Mutationsprobe (Prüfliste LFH-626): `organigrammPrint.css` ohne Ausblenden der Klappziele →
 * Druckpfad rot. Die festen zwei Druckspalten sind bei A4 (680 px) mit 300 px Mindestbreite
 * ohnehin zwei; die Regel sichert nur gegen eine spätere Änderung von `SPALTE_MIN_PX` ab.
 */

test('Druckpfad bei A4-Breite: alles offen, zwei Spalten, nichts ragt heraus', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Druck ${Date.now()}`);
  await seedeGross(page, einsatzId);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await oeffneOrganigramm(page, einsatzId);

  // Einen Abschnitt zuklappen: der Druck muss ihn wieder öffnen.
  await organigramm(page)
    .getByRole('button', { name: `Unterstellte von ${ABSCHNITT}` })
    .click();
  await expect(organigramm(page).getByRole('link', { name: 'Gruppe Deich' })).toHaveCount(0);

  // `window.print` als Stub, der wie der Browser synchron `beforeprint` feuert.
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: 'Drucken / als PDF' }).click();
  await page.emulateMedia({ media: 'print' });

  await expect(organigramm(page).getByRole('link', { name: 'Gruppe Deich' })).toHaveCount(1);
  const lage = await page.evaluate(() => {
    const wurzel = document.querySelector('.organigramm-print-root')!.getBoundingClientRect();
    const knotenRechts = Math.max(
      ...Array.from(document.querySelectorAll('[data-lfh="org-knoten"]')).map(
        (k) => k.getBoundingClientRect().right,
      ),
    );
    return {
      wurzelRechts: wurzel.right,
      knotenRechts,
      spalten: new Set(
        Array.from(document.querySelectorAll('[data-lfh="org-spalte"]')).map((s) =>
          Math.round(s.getBoundingClientRect().left),
        ),
      ).size,
      werkzeuge: getComputedStyle(document.querySelector('.organigramm-no-print')!).display,
      umschalter: getComputedStyle(document.querySelector('[role="radiogroup"]')!).display,
      klappen: getComputedStyle(document.querySelector('[data-lfh="org-klappen"]')!).display,
      kopf: document
        .querySelector('.organigramm-print-root')!
        .textContent!.includes('Führungsorganisation'),
    };
  });
  expect(lage.werkzeuge, 'Werkzeugzeile im Druck aus').toBe('none');
  expect(lage.umschalter, 'Umschalter im Druck aus').toBe('none');
  expect(lage.klappen, 'Klappziele im Druck aus').toBe('none');
  expect(lage.kopf, 'Druckkopf „Führungsorganisation“').toBe(true);
  expect(lage.spalten, 'A4: zwei feste Spalten').toBe(2);
  expect(
    lage.knotenRechts,
    `kein Knoten über der Druckwurzel (Knoten ${lage.knotenRechts}px, Wurzel ${lage.wurzelRechts}px)`,
  ).toBeLessThanOrEqual(lage.wurzelRechts + SUBPIXEL);
  await page.emulateMedia({ media: null });
});
