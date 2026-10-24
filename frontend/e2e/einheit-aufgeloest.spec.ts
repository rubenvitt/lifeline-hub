import { expect, test, type Page } from '@playwright/test';
import { systemBuendelAufklappen } from './etb-kern';
import { anmelden, einsatzAnlegen } from './trefflaeche-kern';

/**
 * Aufgelöste Einheit lesend öffnen (LLH-1266, Change `oq1yp0k5-aufgeloeste-einheit-lesend`, Specs
 * `einheit-ansicht` und `etb-vorgaenge`) am echten Backend: die Einheit mit einer Person wird
 * aufgelöst, der Eintrag der Auflösung im ETB führt über „Einheit «Name»“ in ihre lesende Ansicht,
 * und die nennt die letzte Besatzung ohne ein einziges Bedienelement.
 */

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

test.beforeEach(async ({ page }) => {
  await anmelden(page);
});

test('Sprung aus dem ETB-Eintrag der Auflösung in die lesende Ansicht', async ({ page }) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 1266 Aufgelöst ${Date.now()}`);
  const basis = `/api/einsaetze/${einsatzId}`;
  const einheitId = await post(page, `${basis}/einheiten`, { name: 'Florian 1' });
  // Ein Mitglied ist eine Spur: die Einheit bleibt als aufgelöst stehen, statt gelöscht zu werden.
  const epId = await post(page, `${basis}/personal`, { adhoc: { name: 'Anna Beck' } });
  const zuordnung = await page.request.put(`${basis}/einheiten/${einheitId}/personal/${epId}`);
  expect(zuordnung.ok(), await zuordnung.text()).toBe(true);
  const aufloesen = await page.request.delete(`${basis}/einheiten/${einheitId}`);
  expect(aufloesen.ok(), await aufloesen.text()).toBe(true);

  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await systemBuendelAufklappen(page);
  const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
  const eintrag = zeitachse
    .locator('[data-testid="etb-ereigniszeile"]')
    .filter({ hasText: 'Einheit «Florian 1» aufgelöst' });
  await eintrag.getByRole('link', { name: 'Einheit «Florian 1»' }).click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/einheiten/${einheitId}$`));
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Florian 1', level: 1 })).toBeVisible();
  await expect(main.getByRole('region', { name: 'Kopfdaten' })).toContainText('Aufgelöst');
  // Inhaltsanker vor der Abwesenheit: die Besatzung steht, und kein Paneel lädt noch (eine
  // ladende Zeitachse zeigte ihren Knopf erst danach).
  await expect(
    main.getByRole('region', { name: 'Letzte Besatzung' }).getByRole('link', { name: 'Anna Beck' }),
  ).toBeVisible();
  await expect(main.getByRole('region', { name: 'Zeitachse' })).toBeVisible();
  await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(main.getByRole('button')).toHaveCount(0);
  await expect(main.getByRole('textbox')).toHaveCount(0);
  await expect(main.getByRole('combobox')).toHaveCount(0);
});
