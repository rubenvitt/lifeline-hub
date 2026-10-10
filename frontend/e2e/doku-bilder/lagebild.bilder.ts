import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Lagebild“ (`docs/anwender/kapitel/lagebild.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep lagebild`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   lagebild.png          frontend/src/pages/lage-dashboard/LageDashboardPage.tsx,
 *                         frontend/src/pages/lage-dashboard/LagePaneele.tsx
 *   meldungsstrom-neu.png frontend/src/pages/lage-dashboard/LagePaneele.tsx (MeldungsstromPaneel)
 */

const KAPITEL = 'lagebild';

test.describe(KAPITEL, () => {
  test('Lagebild des Demo-Einsatzes', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lage-dashboard`);
    await expect(page.locator('[data-lfh="gefahrenzeile"]').first()).toBeVisible();
    await expect(page.locator('[data-sichtung]').first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Jüngste Einträge' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'lagebild');
    // Ablauf weiter: aus einem Paneel ins Modul.
    await page
      .getByRole('region', { name: 'Gefahrenmatrix' })
      .getByRole('button', { name: 'Gefahren' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/gefahren`));
  });

  test('Meldungsstrom mit Sammelbanner für neue Einträge', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lage-dashboard`);
    const strom = page.getByRole('region', { name: 'Meldungsstrom' });
    await expect(page.getByRole('list', { name: 'Jüngste Einträge' })).toBeVisible();
    // Zwei neue Einträge, während die Seite offen ist: der Strom schiebt sie nicht ein, sondern
    // kündigt sie an.
    for (const inhalt of [
      'Pegel Mühlbach: Wasserstand stagniert seit 30 Minuten.',
      'UHS Turnhalle meldet freie Kapazität für vier Patienten.',
    ]) {
      await fuelle(page, 'post', `/api/einsaetze/${demo.id}/etb`, {
        typ: 'meldung',
        inhalt,
        von: 'Abschnitt Sanitätsdienst',
        an: 'ELW 1',
        meldeweg: 'funk',
      });
    }
    await expect(page.getByText('2 neue Einträge')).toBeVisible();
    await fotografiere(strom, KAPITEL, 'meldungsstrom-neu');
    await strom.getByRole('button', { name: 'anzeigen' }).click();
    await expect(page.getByText('2 neue Einträge')).toBeHidden();
    await expect(
      strom.getByText('UHS Turnhalle meldet freie Kapazität für vier Patienten.'),
    ).toBeVisible();
  });
});
