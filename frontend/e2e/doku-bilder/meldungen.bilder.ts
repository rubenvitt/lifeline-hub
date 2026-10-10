import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Meldungen“ (`docs/anwender/kapitel/meldungen.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep meldungen`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   meldungen-liste.png    frontend/src/pages/MeldungenPage.tsx, frontend/src/meldungen/MeldungKarte.tsx
 *   meldung-erfassen.png   frontend/src/meldungen/MeldungFormular.tsx
 */

const KAPITEL = 'meldungen';

/** Öffnet die Meldungen des Demo-Einsatzes und wartet auf die Kennzahlen und die erste Karte. */
async function meldungenOeffnen(page: Page) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/meldungen`);
  await expect(page.getByRole('button', { name: 'Meldung erfassen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sichten' }).first()).toBeVisible();
}

test.describe(KAPITEL, () => {
  test('Meldungen mit Kennzahlen und offenen Karten', async ({ page }) => {
    await meldungenOeffnen(page);
    await fotografiere(page, KAPITEL, 'meldungen-liste');
  });

  test('Formular „Neue Meldung erfassen“ als Sofortmeldung', async ({ page }) => {
    await meldungenOeffnen(page);
    await page.getByRole('button', { name: 'Meldung erfassen' }).click();
    const paneel = page.getByRole('region', { name: 'Neue Meldung erfassen' });
    await paneel.getByRole('button', { name: 'Sofortmeldung' }).click();
    await paneel
      .getByLabel('Inhalt / Wortlaut')
      .fill('Gasgeruch im Keller Lindenstraße 6, Bewohner verlassen das Haus.');
    await paneel.getByLabel('Absender').fill('Florian Musterstadt 2/1');
    await paneel.getByPlaceholder('z. B. ELW 1, S3').fill('ELW 1');
    await paneel.getByRole('button', { name: /^Weitere Angaben/ }).click();
    await expect(paneel.getByLabel('Bestätigungsfrist in Minuten')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(paneel, KAPITEL, 'meldung-erfassen');
  });
});
