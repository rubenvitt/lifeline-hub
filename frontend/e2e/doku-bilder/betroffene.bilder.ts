import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Betroffene und Sichtung“ (`docs/anwender/kapitel/betroffene.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep betroffene`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   liste.png        frontend/src/pages/PersonenPage.tsx, frontend/src/personen/BetroffenenSeitenleiste.tsx
 *   erfassen.png     frontend/src/personen/PersonErfassungModal.tsx, frontend/src/personen/AufnahmeFelder.tsx
 *   kurzeingabe.png  frontend/src/personen/BetroffeneZeile.tsx
 *   verbleib.png     frontend/src/personen/VerbleibErfassung.tsx
 *
 * Daten: die Betroffenen des Demo-Einsatzes reichen, es wird nichts gefüllt.
 */

const KAPITEL = 'betroffene';

/** Kennung einer Demo-Person über ihren Nachnamen. */
async function personId(page: Page, einsatzId: number, name: string): Promise<number> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/personen`);
  expect(antwort.ok(), `Personen des Demo-Einsatzes: ${antwort.status()}`).toBe(true);
  const personen = (await antwort.json()) as { id: number; name: string | null }[];
  const person = personen.find((p) => p.name === name);
  expect(person, `Demo-Person ${name}`).toBeDefined();
  return person!.id;
}

test.describe(KAPITEL, () => {
  test('Liste der Betroffenen mit Seitenleiste', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personen`);
    await expect(page.getByRole('cell', { name: 'Mustermann, Erika' })).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Lagebild der Betroffenen' }),
    ).toBeVisible();
    await fotografiere(page, KAPITEL, 'liste');
  });

  test('Maske „Betroffene erfassen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personen`);
    await page.getByRole('button', { name: 'Betroffene erfassen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Betroffene erfassen' });
    await dialog
      .locator('#sichtung .ant-tag')
      .filter({ hasText: /^SK II$/ })
      .click();
    await expect(dialog.getByRole('radio', { name: 'SK II', exact: true })).toBeChecked();
    await waehleIn(dialog.getByRole('combobox', { name: 'Geschlecht' }), 'männlich');
    await dialog.getByLabel('Geschätztes Alter (Jahre)').fill('45');
    await dialog.getByLabel('Antreffort').fill('Mühlbachweg 12, Keller');
    await dialog.getByLabel('Antreffort').blur();
    await fotografiere(dialog, KAPITEL, 'erfassen');
  });

  test('Kurzeingabe „/person“ mit erkannten Angaben', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personen`);
    const band = page.locator('[data-lfh="erfassungsband"]');
    const feld = band.getByRole('textbox', { name: 'Kurzeingabe Person' });
    await feld.fill('Kowalski, Anna w 34 sk3 @Turnhalle');
    await expect(band.locator('[data-lfh="erkannt"]')).toContainText('UHS Turnhalle');
    await feld.blur();
    await fotografiere(band, KAPITEL, 'kurzeingabe');
  });

  test('Dialog „Verbleib erfassen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const id = await personId(page, demo.id, 'Vorlage');
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personen/${id}`);
    await page.getByRole('button', { name: 'Verbleib erfassen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Verbleib erfassen' });
    await waehleIn(dialog.getByRole('combobox', { name: 'Art' }), 'Transport');
    await dialog.getByLabel('Ziel').fill('Klinikum Musterstadt');
    await dialog.getByLabel('Transportmittel (RTW/KTW …)').fill('KTW 1');
    await dialog.getByLabel('Transportmittel (RTW/KTW …)').blur();
    await fotografiere(dialog, KAPITEL, 'verbleib');
  });
});
