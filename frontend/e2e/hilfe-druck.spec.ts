import { expect, test, type Page } from '@playwright/test';

/**
 * Druck der Hilfe (LFH-1096, Spec `anwenderdoku`): die Mappe einer Lesergruppe, ohne Anmeldung.
 * Chromium, Firefox und WebKit prüfen die Mechanik unter Druckmedium (`DRUCK_SPECS`).
 *
 * - Ohne Sitzung druckt der Knopf sofort (kein Organisationskopf).
 * - Auf Papier stehen nur Druckkopf und Kapitel; Kopf und Kapitelliste der Seite sind weg.
 * - Jedes weitere Kapitel beginnt auf einer neuen Seite, das erste nicht.
 *
 * Mutationsprobe: die Regel `druck-kapitel + druck-kapitel` in `druck/druck.css` entfernen → rot.
 */

async function druckeStub(page: Page) {
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
}

test('Mappe der Gruppe „Alle“: nur Kapitel auf Papier, jedes weitere ab neuer Seite', async ({
  page,
}) => {
  await page.goto('/hilfe');
  const kapitel = page.locator('[data-lfh="druck-kapitel"]');
  await expect(kapitel.first()).toBeVisible();
  const anzahl = await kapitel.count();
  expect(anzahl, 'die Mappe hat mehr als ein Kapitel').toBeGreaterThan(1);

  await druckeStub(page);
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });

  const lage = await page.evaluate(() => {
    const anzeige = (sel: string) => getComputedStyle(document.querySelector(sel)!).display;
    const kapitel = Array.from(document.querySelectorAll('[data-lfh="druck-kapitel"]'));
    return {
      kopf: anzeige('.hilfe-kopf'),
      navi: anzeige('.hilfe-navi'),
      druckkopf: anzeige('.hilfe-druckkopf'),
      umbrueche: kapitel.map((k) => getComputedStyle(k).breakBefore),
    };
  });
  expect(lage.kopf, 'Seitenkopf im Druck aus').toBe('none');
  expect(lage.navi, 'Kapitelliste im Druck aus').toBe('none');
  expect(lage.druckkopf, 'Druckkopf im Druck da').not.toBe('none');
  expect(lage.umbrueche[0], 'erstes Kapitel ohne Umbruch').not.toBe('page');
  for (const [i, umbruch] of lage.umbrueche.slice(1).entries()) {
    expect(umbruch, `Kapitel ${i + 2} beginnt auf neuer Seite`).toBe('page');
  }
});
