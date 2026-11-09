import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Kontextmenü eines Datensatzes (LLH-1596, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/archive/2026-11-08-om9oxxiq-kontextmenue-baustein/design.md`) im echten Browser: Rechtsklick,
 * Umschalt+F10 und langer Druck öffnen an einer Zeile der Datensicht dasselbe wie Primärknopf und
 * ⋮-Menü; auf dem Titel-Link bleibt das Browsermenü. Gewartet wird auf Inhaltsanker, nie auf
 * `networkidle` (LFH-385).
 */

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

async function einsatzMitMaterial(page: Page): Promise<number> {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Kontextmenü ${Date.now()}`,
  });
  await post(page, `/api/einsaetze/${einsatzId}/material`, {
    adhoc: { bezeichnung: 'Stromerzeuger' },
    menge: 4,
  });
  return einsatzId;
}

const offenesMenue = (page: Page) =>
  page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
const kontextMenue = (page: Page) =>
  page.locator(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label="Weitere Aktionen zu Stromerzeuger"]',
  );
const eintraegeVon = (menue: Locator) => menue.getByRole('menuitem').allInnerTexts();

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test.describe('am Fükw-Rechner (Tabelle)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Rechtsklick zeigt Primäraktion und ⋮-Einträge aus einer Quelle; Escape schließt', async ({
    page,
  }) => {
    const einsatzId = await einsatzMitMaterial(page);
    await page.goto(`/einsaetze/${einsatzId}/material`);
    const zeile = page.getByRole('row').filter({ hasText: 'Stromerzeuger' });
    await expect(zeile).toBeVisible();

    // Die Quelle: das ⋮-Menü derselben Zeile.
    await zeile.getByRole('button', { name: 'Weitere Aktionen zu Stromerzeuger' }).click();
    await expect(offenesMenue(page)).toBeVisible();
    const punkte = await eintraegeVon(offenesMenue(page));
    expect(punkte.length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(offenesMenue(page)).toHaveCount(0);

    // Rechtsklick in die Zeile, nicht auf einen Link oder Knopf.
    await zeile.getByText('Stromerzeuger', { exact: true }).click({ button: 'right' });
    await expect(kontextMenue(page)).toBeVisible();
    expect(await eintraegeVon(kontextMenue(page))).toEqual(['Aus dem Einsatz nehmen', ...punkte]);
    await expect(
      kontextMenue(page).getByRole('menuitem', { name: 'Aus dem Einsatz nehmen' }),
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(kontextMenue(page)).toHaveCount(0);
  });

  test('ein Eintrag im Kontextmenü wirkt wie im ⋮-Menü', async ({ page }) => {
    const einsatzId = await einsatzMitMaterial(page);
    await page.goto(`/einsaetze/${einsatzId}/material`);
    const zeile = page.getByRole('row').filter({ hasText: 'Stromerzeuger' });
    await zeile.getByText('Stromerzeuger', { exact: true }).click({ button: 'right' });
    await kontextMenue(page).getByRole('menuitem', { name: 'Menge ändern …' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(kontextMenue(page)).toHaveCount(0);
  });
});

test.describe('Titel-Link und Tastatur (Personen, Tabelle)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function einsatzMitPerson(page: Page): Promise<number> {
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E Kontextmenü Personen ${Date.now()}`,
    });
    await post(page, `/api/einsaetze/${einsatzId}/personen`, {
      name: 'Kontext',
      vorname: 'Karla',
      antreff_ort: 'Sammelstelle Nord',
    });
    return einsatzId;
  }

  test('Rechtsklick auf den Titel-Link öffnet kein eigenes Menü, Umschalt+F10 dort schon', async ({
    page,
  }) => {
    const einsatzId = await einsatzMitPerson(page);
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    const zeile = page.getByRole('row').filter({ hasText: 'Kontext' });
    const link = zeile.getByRole('link').first();
    await expect(link).toBeVisible();

    // Das Browsermenü zeigt Playwright nicht; belegt wird, dass die Seite es nicht verhindert.
    const verhindert = await link.evaluate((el) => {
      const ereignis = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
      });
      el.dispatchEvent(ereignis);
      return ereignis.defaultPrevented;
    });
    expect(verhindert).toBe(false);
    await expect(offenesMenue(page)).toHaveCount(0);

    await link.focus();
    await page.keyboard.press('Shift+F10');
    const menue = offenesMenue(page);
    await expect(menue).toBeVisible();
    await expect(menue.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menue).toHaveCount(0);
    await expect(link).toBeFocused();
  });
});

test.describe('am Tablet (Karte, Touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('langer Druck öffnet das Menü; das Abheben schließt es nicht', async ({ page }) => {
    const einsatzId = await einsatzMitMaterial(page);
    await page.goto(`/einsaetze/${einsatzId}/material`);
    const karte = page
      .locator('[data-lfh="datensicht-karte"]')
      .filter({ hasText: 'Stromerzeuger' });
    await expect(karte).toBeVisible();
    const box = (await karte.getByText('Stromerzeuger', { exact: true }).boundingBox())!;
    const punkt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const url = page.url();

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: punkt.x, y: punkt.y, id: 0, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await page.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await expect(kontextMenue(page)).toBeVisible();
    // Nach dem Nachlauf des Riegels steht es noch, und die Seite ist nicht weitergesprungen.
    await page.waitForTimeout(600);
    await expect(kontextMenue(page)).toBeVisible();
    expect(page.url()).toBe(url);
    await expect(kontextMenue(page).getByRole('menuitem').first()).toHaveText(
      'Aus dem Einsatz nehmen',
    );
  });
});
