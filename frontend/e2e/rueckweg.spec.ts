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
    const r = await page.request.post(`/api/incidents/${einsatzId}/reports`, {
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
    // Die Seite hat die Adresse übernommen (die Wahl kommt aus ihr), erst dann rollen.
    const richtung = page.locator('.ant-select', {
      has: page.getByRole('combobox', { name: 'Richtung' }),
    });
    await expect(richtung).toContainText('Extern');
    await expect(page.getByText('Lage 0: ruhig, keine Veränderung.')).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 1400));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(1400);
    // Welche Meldung oben im Bild steht und wo: das soll nach dem Zurück wieder so sein. Ändert
    // sich beim Laden die Höhe über der Liste, regelt der Browser die Pixelzahl nach (Scroll
    // Anchoring) und hält denselben Inhalt im Bild; gemessen wird deshalb der Inhalt.
    const obenImBild = () =>
      page.evaluate(() => {
        const karten = [...document.querySelectorAll<HTMLElement>('[data-meldung-id]')];
        const erste = karten.find((k) => k.getBoundingClientRect().bottom > 0);
        return erste
          ? { id: erste.dataset.meldungId, oben: Math.round(erste.getBoundingClientRect().top) }
          : null;
      });
    const vorher = await obenImBild();
    expect(vorher).not.toBeNull();

    // Weg innerhalb der App (Kategorie „Führung“ in der Rail), Zurück über den Browser.
    // Weg über ein neues Laden (Link von außen, Lesezeichen): beim Zurück lädt die Seite neu, und
    // die Liste kommt erst mit den Daten; der Browser allein landete dann oben.
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(page.getByRole('heading', { name: 'ETB', level: 1 })).toBeVisible();
    await page.goBack();

    await expect(page).toHaveURL(/[?&]richtung=extern/);
    await expect(richtung).toContainText('Extern');
    await expect.poll(obenImBild, { timeout: 5_000 }).toEqual(vorher);
    // Gegenaussage: ohne Wiederherstellung stünde die Seite oben.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
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
