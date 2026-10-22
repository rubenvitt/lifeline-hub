import { expect, test, type Page } from '@playwright/test';
import { FUEKW } from './fuehrungsorganisation-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Meldung und Lage aus dem ETB legen den Vorgang im Meldungseingang an (LLH-1037, Specs
 * `meldungseingang`, `etb-schnellerfassung-tastatur`). Ein über die Oberfläche erfasster Eintrag
 * vom Typ „Lage“ trägt danach „Meldung #n ↗“, der Verweis öffnet die Meldung hervorgehoben
 * (`data-hervorgehoben`, nicht die URL: `useQueryParamSelektion` räumt den Parameter). Mit „Nur
 * protokollieren“ entsteht keine Meldung; ohne Netz entsteht sie beim Abspielen.
 */

async function einsatzPerApi(page: Page, bezeichnung: string): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(antwort.ok(), `Einsatz anlegen: ${antwort.status()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

async function lagemeldungenText(page: Page, einsatzId: number): Promise<string> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/lage/meldungen`);
  expect(antwort.ok(), `Lagemeldungen: ${antwort.status()}`).toBe(true);
  return antwort.text();
}

async function zumEtb(page: Page, einsatzId: number) {
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByPlaceholder(/Inhalt/)).toBeVisible();
}

async function lageErfassen(page: Page, inhalt: string) {
  const feld = page.getByPlaceholder(/Inhalt/);
  await feld.pressSequentially(`/lage ${inhalt}`);
  await expect(page.getByRole('checkbox', { name: 'Nur protokollieren' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAlsAdmin(page);
});

test('Lage aus dem ETB wird Lagemeldung, der Verweis öffnet sie hervorgehoben', async ({
  page,
}) => {
  const einsatz = await einsatzPerApi(page, `E2E ETB-Meldungseingang ${Date.now()}`);
  await zumEtb(page, einsatz);

  await lageErfassen(page, 'Wasser im Keller sinkt');
  await expect(page.getByRole('checkbox', { name: 'Nur protokollieren' })).not.toBeChecked();
  await page.getByPlaceholder(/Inhalt/).press('Enter');

  const zeile = page
    .getByRole('region', { name: 'Einsatztagebuch' })
    .getByTestId('etb-ereigniszeile')
    .filter({ hasText: 'Wasser im Keller sinkt' });
  await expect(zeile).toHaveCount(1);
  const verweis = zeile.getByRole('link', { name: /^Meldung #\d+$/ });
  await expect(verweis).toBeVisible();
  expect(await lagemeldungenText(page, einsatz)).toContain('Wasser im Keller sinkt');

  await verweis.click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatz}/meldungen(\\?|$)`));
  await expect(page.locator('[data-hervorgehoben="true"]')).toContainText(
    'Wasser im Keller sinkt',
  );
});

test('mit „Nur protokollieren“ entsteht keine Meldung', async ({ page }) => {
  const einsatz = await einsatzPerApi(page, `E2E ETB nur protokollieren ${Date.now()}`);
  await zumEtb(page, einsatz);

  await lageErfassen(page, 'Mitschrift Lagebesprechung');
  const schalter = page.getByRole('checkbox', { name: 'Nur protokollieren' });
  await schalter.check();
  await page.getByPlaceholder(/Inhalt/).press('Enter');

  const zeile = page
    .getByRole('region', { name: 'Einsatztagebuch' })
    .getByTestId('etb-ereigniszeile')
    .filter({ hasText: 'Mitschrift Lagebesprechung' });
  await expect(zeile).toHaveCount(1);
  await expect(zeile.getByRole('link', { name: /^Meldung #\d+$/ })).toHaveCount(0);
  expect(await lagemeldungenText(page, einsatz)).not.toContain('Mitschrift Lagebesprechung');
});

test('ohne Netz erfasste Lage wird beim Abspielen Lagemeldung', async ({ page, context }) => {
  const einsatz = await einsatzPerApi(page, `E2E ETB-Meldungseingang offline ${Date.now()}`);
  await zumEtb(page, einsatz);

  await context.setOffline(true);
  try {
    await lageErfassen(page, 'Deich hält, Pegel fällt');
    await page.getByPlaceholder(/Inhalt/).press('Enter');
    await expect(page.locator('.etb-ausstehend')).toContainText('Deich hält, Pegel fällt');
  } finally {
    await context.setOffline(false);
  }

  await expect
    .poll(() => lagemeldungenText(page, einsatz), { timeout: 20_000 })
    .toContain('Deich hält, Pegel fällt');
  await expect(
    page
      .getByRole('region', { name: 'Einsatztagebuch' })
      .getByTestId('etb-ereigniszeile')
      .filter({ hasText: 'Deich hält, Pegel fällt' })
      .getByRole('link', { name: /^Meldung #\d+$/ }),
  ).toBeVisible();
});
