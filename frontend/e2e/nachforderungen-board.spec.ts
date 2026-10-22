import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Status-Board der Nachforderungen (LLH-1078, Spec `nachforderungen-board`), Durchstich im
 * Browser: drei offene Nachforderungen in drei Stufen stehen ab `md` in ihrer Spalte; „Zusage
 * erfassen“ trägt die Karte nach „Zugesagt“, ohne dass die übrigen springen, und „Rückgängig“
 * zurück. Am Handy (390 px) eine Segmentleiste der Stufen mit Zahl, ohne waagrechten Überlauf.
 * Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

async function post<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

/** Drei Nachforderungen: eine angefordert, eine zugesagt, eine unterwegs. */
async function seed(page: Page) {
  const { id } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Nachforderungen Board ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${id}/nachforderungen`;
  const anlegen = (art: string, bezeichnung: string) =>
    post(page, basis, { art, bezeichnung, adressat_kategorie: 'leitstelle' });
  const rtw = await anlegen('RTW', 'RTW Turnhalle');
  const seg = await anlegen('SEG', 'SEG Betreuung');
  const pumpen = await anlegen('Tauchpumpe', 'Pumpen Keller');
  await post(page, `${basis}/${seg.id}/status`, { status: 'zugesagt' });
  for (const status of ['zugesagt', 'unterwegs']) {
    await post(page, `${basis}/${pumpen.id}/status`, { status });
  }
  return { einsatzId: String(id), rtw: rtw.id, seg: seg.id, pumpen: pumpen.id };
}

const spalte = (page: Page, stufe: string) =>
  page.locator(`[data-lfh="board-spalte"][data-stufe="${stufe}"]`);

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test('drei offene in drei Spalten; Zusage erfassen trägt die Karte weiter, Rückgängig zurück', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { einsatzId, rtw, seg, pumpen } = await seed(page);
  await page.goto(`/einsaetze/${einsatzId}/nachforderungen`);
  await expect(page.getByRole('heading', { level: 1, name: 'Nachforderungen' })).toBeVisible();
  await expect(page.getByText('3 offen · 1 unterwegs')).toBeVisible();

  const karte = (nfId: number) => page.locator(`[data-nachforderung-id="${nfId}"]`);
  await expect(
    spalte(page, 'angefordert').locator(`[data-nachforderung-id="${rtw}"]`),
  ).toBeVisible();
  await expect(spalte(page, 'zugesagt').locator(`[data-nachforderung-id="${seg}"]`)).toBeVisible();
  await expect(
    spalte(page, 'unterwegs').locator(`[data-nachforderung-id="${pumpen}"]`),
  ).toBeVisible();
  await expect(spalte(page, 'eingetroffen')).toContainText('keine');
  await expect(
    spalte(page, 'abgelehnt').getByRole('button', { name: /Abgelehnt/ }),
  ).toHaveAttribute('aria-expanded', 'false');

  // Die übrigen Karten stehen nach dem Absenden, wo sie standen. „Zusage erfassen“ öffnet das
  // Formular an der Karte (LLH-1097 D10); Enter im Mengenfeld sagt die ganze Anzahl zu.
  const vorher = await karte(pumpen).boundingBox();
  await karte(rtw).getByRole('button', { name: 'Zusage erfassen' }).click();
  await karte(rtw).getByRole('spinbutton', { name: 'Zugesagt' }).press('Enter');
  await expect(spalte(page, 'zugesagt').locator(`[data-nachforderung-id="${rtw}"]`)).toBeVisible();
  await expect(karte(rtw)).toBeFocused();
  expect(await karte(pumpen).boundingBox()).toEqual(vorher);
  await expect(spalte(page, 'angefordert')).toContainText('keine');

  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(
    spalte(page, 'angefordert').locator(`[data-nachforderung-id="${rtw}"]`),
  ).toBeVisible();
});

test('am Handy eine Segmentleiste der Stufen mit Zahl, ohne waagrechten Überlauf', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { einsatzId, rtw, pumpen } = await seed(page);
  await page.goto(`/einsaetze/${einsatzId}/nachforderungen`);
  const leiste = page.getByRole('tablist', { name: 'Stufe' });
  await expect(leiste.getByRole('tab', { name: 'Angefordert 1' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator(`[data-nachforderung-id="${rtw}"]`)).toBeVisible();
  await expect(page.locator(`[data-nachforderung-id="${pumpen}"]`)).toHaveCount(0);
  await leiste.getByRole('tab', { name: 'Unterwegs 1' }).click();
  await expect(page.locator(`[data-nachforderung-id="${pumpen}"]`)).toBeVisible();
  const ueberhang = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(ueberhang).toBeLessThanOrEqual(1);
});

test('Teilzusage teilt in zwei Karten; Zurückziehen über das Menü (LLH-1097)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { id } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Nachforderung Zusage ${Date.now()}`,
  });
  const nf = await post(page, `/api/einsaetze/${id}/nachforderungen`, {
    art: 'RTW',
    anzahl: 2,
    bezeichnung: 'RTW Teilzusage',
    adressat_kategorie: 'leitstelle',
  });
  await page.goto(`/einsaetze/${id}/nachforderungen`);
  const karte = page.locator(`[data-nachforderung-id="${nf.id}"]`);
  await karte.getByRole('button', { name: 'Zusage erfassen' }).click();
  const menge = karte.getByRole('spinbutton', { name: 'Zugesagt' });
  await expect(menge).toHaveValue('2');
  await menge.fill('1');
  const wer = karte.getByRole('combobox', { name: 'Wer' });
  await wer.fill('83-1');
  await wer.press('Enter');
  await karte.getByRole('button', { name: 'Zusage erfassen' }).click();

  const zugesagt = spalte(page, 'zugesagt').locator(`[data-nachforderung-id="${nf.id}"]`);
  await expect(zugesagt).toContainText('1 von 2 zugesagt');
  await expect(zugesagt).toContainText('Wer: 83-1');
  const rest = spalte(page, 'angefordert').locator('[data-nachforderung-id]', {
    hasText: 'Rest einer Teilzusage',
  });
  await expect(rest).toContainText('1× RTW');

  await rest.getByRole('button', { name: /^Aktionen zu Nachforderung / }).click();
  await page.getByRole('menuitem', { name: 'Zurückziehen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nachforderung zurückziehen' });
  await dialog.getByRole('textbox').fill('nicht mehr benötigt');
  await dialog.getByRole('button', { name: 'Zurückziehen' }).click();
  await expect(spalte(page, 'angefordert')).toContainText('keine');
  await spalte(page, 'zurueckgezogen')
    .getByRole('button', { name: /^Zurückgezogen/ })
    .click();
  await expect(spalte(page, 'zurueckgezogen')).toContainText('Zurückgezogen');
  await expect(spalte(page, 'zurueckgezogen')).toContainText('nicht mehr benötigt');
});
