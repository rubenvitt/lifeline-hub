import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';
import { einsatzPerApi } from './einsatz-kern';

/**
 * Ansicht, Filter und Rollposition überleben den Rückweg (LLH-1826, Entwurf
 * `docs/superpowers/specs/2026-11-19-yht1wcsw-ansicht-filter-rueckweg-design.md`). Ein Ablauf über
 * zwei Seiten mit dem Zurück des Browsers: das zeigt nur der Browser (`e2e/AGENTS.md`). Die Logik
 * je Seite prüfen die Vitests der Seiten, den Wiederhersteller `RollWiederherstellung.test.tsx`.
 */

test.setTimeout(90_000);

/** Genug Meldungen, dass die Liste deutlich über 1400 px hinaus reicht. */
const MELDUNGEN = 40;

async function einsatzMitMeldungen(page: Page): Promise<string> {
  const einsatzId = await einsatzPerApi(page, `E2E Rückweg ${Date.now()}`);
  for (let i = 0; i < MELDUNGEN; i += 1) {
    const r = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen`, {
      data: {
        absender: `Abschnitt ${i}`,
        meldeweg: 'funk',
        inhalt: `Lage ${i}: ruhig, keine Veränderung.`,
        meldungsart: 'lagemeldung',
        richtung: 'extern',
        ereigniszeit: '2026-10-01 09:30:00',
      },
    });
    expect(r.ok(), `Meldung ${i}: ${r.status()} ${await r.text()}`).toBe(true);
  }
  return einsatzId;
}

test.describe('Rückweg (LLH-1826)', () => {
  test.beforeEach(async ({ page }) => {
    await anmeldenAlsAdmin(page, { startseite: false });
  });

  test('Meldungen „Extern“ und die Rollposition überleben Weg und Zurück', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const einsatzId = await einsatzMitMeldungen(page);
    await page.goto(`/einsaetze/${einsatzId}/meldungen`);
    await expect(page.getByText('Lage 0: ruhig, keine Veränderung.')).toBeVisible();

    await page.getByRole('combobox', { name: 'Richtung' }).click();
    await page.getByTitle('Extern', { exact: true }).click();
    await expect(page).toHaveURL(/[?&]richtung=extern/);

    await page.evaluate(() => window.scrollTo(0, 1400));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(1400);

    // Weg innerhalb der App (Kategorie „Führung“ in der Rail), Zurück über den Browser.
    await page.getByRole('link', { name: 'Führung', exact: true }).click();
    await expect(page).not.toHaveURL(/\/meldungen/);
    await page.goBack();

    await expect(page).toHaveURL(/[?&]richtung=extern/);
    await expect(
      page.locator('.ant-select', { has: page.getByRole('combobox', { name: 'Richtung' }) }),
    ).toContainText('Extern');
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1398);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBeLessThanOrEqual(1402);
  });

  test('Betroffene im Sichtungsraster überleben Weg und Zurück', async ({ page }) => {
    const einsatzId = await einsatzPerApi(page, `E2E Rückweg Betroffene ${Date.now()}`);
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await page.getByRole('radio', { name: 'Sichtungsraster' }).click();
    await expect(page).toHaveURL(/[?&]ansicht=raster/);
    await expect(
      page.getByRole('region', { name: 'Betroffene nach Sichtungskategorie' }),
    ).toBeVisible();

    await page.goto(`/einsaetze/${einsatzId}/meldungen`);
    await page.goBack();

    await expect(page).toHaveURL(/[?&]ansicht=raster/);
    await expect(page.getByRole('radio', { name: 'Sichtungsraster' })).toBeChecked();
    await expect(
      page.getByRole('region', { name: 'Betroffene nach Sichtungskategorie' }),
    ).toBeVisible();
  });
});
