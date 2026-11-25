import { expect, test, type Page } from '@playwright/test';
import { kopfFilterWaehlen } from './kopffilter-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Rückweg über den Ortspfad (LLH-1997, `frontend/AGENTS.md`, Deeplink-Muster, „Ortspfad zur Liste
 * über `ListenRueckweg`“), an der Vorbildseite Schäden (Filter in der Adresse, LLH-1086).
 *
 * Kam man von der Liste, ist der Ortspfad ein Schritt zurück im Verlauf: die Liste steht mit ihrem
 * Filter wieder da, und der Verlauf wächst nicht (`history.state.idx` wie vor dem Öffnen). Der
 * Rückweg aus der Sitzung (`listenGedaechtnis`) könnte den Filter auch herstellen, deshalb prüft
 * die Spec den Verlaufsindex, nicht nur die Adresse. Direkt geöffnet führt der Ortspfad per PUSH
 * auf die Liste. Die Rollposition stellt beim Zurück `RollWiederherstellung` her (LLH-1826).
 */

async function einsatzMitSchaeden(page: Page): Promise<string> {
  const r = await page.request.post('/api/incidents', {
    data: { bezeichnung: `E2E Ortspfad ${Date.now()}` },
  });
  expect(r.ok(), `POST /api/incidents: ${r.status()} ${await r.text()}`).toBe(true);
  const einsatzId = String(((await r.json()) as { id: number }).id);
  for (const s of [
    { ausmass: 'gering', ort: 'Bachstraße 1' },
    { ausmass: 'gross', ort: 'Deichweg 2' },
  ]) {
    const a = await page.request.post(`/api/incidents/${einsatzId}/damages`, {
      data: { typ: 'sachschaden', ...s },
    });
    expect(a.ok(), `POST schaeden: ${a.status()} ${await a.text()}`).toBe(true);
  }
  return einsatzId;
}

const verlaufsIndex = (page: Page) =>
  page.evaluate(() => (window.history.state as { idx?: number } | null)?.idx ?? -1);

const ortspfadZurListe = (page: Page) =>
  page.locator('.lfh-seitenkopf__pfad').getByRole('link', { name: 'Schäden' });

test.describe('Ortspfad der Detailseite', () => {
  test.setTimeout(90_000);

  test('führt zurück auf die gefilterte Liste, von der man kam', async ({ page }) => {
    await anmeldenAlsAdmin(page, { startseite: false });
    const einsatzId = await einsatzMitSchaeden(page);
    await page.goto(`/einsaetze/${einsatzId}/schaeden`);
    await kopfFilterWaehlen(page, 'Ausmaß', ['groß']);
    await expect(page).toHaveURL(/[?&]f\.ausmass=gross(&|$)/);
    await expect(page.getByText('Bachstraße 1')).toHaveCount(0);
    const indexListe = await verlaufsIndex(page);

    await page.getByText('Deichweg 2').click();
    await expect(page).toHaveURL(/\/schaeden\/\d+$/);

    await ortspfadZurListe(page).click();
    await expect(page).toHaveURL(/\/schaeden\?.*f\.ausmass=gross/);
    await expect(page.getByText('Deichweg 2')).toBeVisible();
    await expect(page.getByText('Bachstraße 1')).toHaveCount(0);
    expect(await verlaufsIndex(page)).toBe(indexListe);
  });

  test('führt direkt geöffnet auf die Liste mit ihrer Vorgabe', async ({ page }) => {
    await anmeldenAlsAdmin(page, { startseite: false });
    const einsatzId = await einsatzMitSchaeden(page);
    const liste = await page.request.get(`/api/incidents/${einsatzId}/damages`);
    const [erster] = (await liste.json()) as { id: number }[];

    await page.goto(`/einsaetze/${einsatzId}/schaeden/${erster.id}`);
    const indexDetail = await verlaufsIndex(page);
    await expect(ortspfadZurListe(page)).toHaveAttribute(
      'href',
      `/einsaetze/${einsatzId}/schaeden`,
    );

    await ortspfadZurListe(page).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/schaeden$`));
    await expect(page.getByText('Bachstraße 1')).toBeVisible();
    expect(await verlaufsIndex(page)).toBe(indexDetail + 1);
  });

  test('stellt nach dem Zurück auch die Rollposition wieder her', async ({ page }) => {
    await anmeldenAlsAdmin(page, { startseite: false });
    const einsatzId = await einsatzMitSchaeden(page);
    for (let i = 0; i < 40; i++) {
      const a = await page.request.post(`/api/incidents/${einsatzId}/damages`, {
        data: { typ: 'sachschaden', ausmass: 'gross', ort: `Uferweg ${i + 10}` },
      });
      expect(a.ok(), `POST schaeden: ${a.status()}`).toBe(true);
    }
    await page.goto(`/einsaetze/${einsatzId}/schaeden?f.ausmass=gross`);
    // Die Liste rendert beim ersten Anzeigen stückweise (LLH-1974): erst rollen, wenn alle 41
    // Zeilen (40 Uferwege und der Deichweg) stehen.
    const zeilen = page.locator('.ant-table-tbody tr[data-row-key]');
    await expect(zeilen).toHaveCount(41);
    await page.mouse.wheel(0, 900);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    const gerollt = await page.evaluate(() => window.scrollY);

    const zeile = zeilen.nth(25);
    await zeile.click();
    await expect(page).toHaveURL(/\/schaeden\/\d+$/);
    await ortspfadZurListe(page).click();
    await expect(page).toHaveURL(/f\.ausmass=gross/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(gerollt - 40);
  });
});
