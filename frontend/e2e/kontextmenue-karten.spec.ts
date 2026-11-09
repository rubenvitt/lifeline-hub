import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Kontextmenü an Karten und Chat (LLH-1598, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/g11xq51l-kontextmenue-karten/design.md`) im echten Browser: Rechtsklick auf
 * eine Meldung zeigt ihre Knöpfe vor den Einträgen des ⋮, Umschalt+F10 auf einem Knopf der Karte
 * öffnet dasselbe Menü, und ein langer Druck auf eine Chat-Nachricht öffnet ihr Menü, ohne dass
 * das Abheben es schließt. Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

async function einsatzMitMeldung(page: Page): Promise<number> {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Kontextmenü Karten ${Date.now()}`,
  });
  await post(page, `/api/einsaetze/${einsatzId}/meldungen`, {
    absender: 'Abschnitt Nord',
    meldeweg: 'funk',
    inhalt: 'Deich am Pegel instabil',
    meldungsart: 'lagemeldung',
    ereigniszeit: '2026-10-01 09:30:00',
  });
  return einsatzId;
}

const offenesMenue = (page: Page) =>
  page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
const eintraegeVon = (menue: Locator) => menue.getByRole('menuitem').allInnerTexts();

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test.describe('Meldungskarte am Fükw-Rechner', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Rechtsklick zeigt die Knöpfe vor den Einträgen des ⋮; Umschalt+F10 auf einem Knopf ebenso', async ({
    page,
  }) => {
    const einsatzId = await einsatzMitMeldung(page);
    await page.goto(`/einsaetze/${einsatzId}/meldungen`);
    const karte = page.locator('[data-meldung-id]').filter({ hasText: 'Deich am Pegel instabil' });
    await expect(karte).toBeVisible();

    // Die Quelle: sichtbare Knöpfe und das ⋮-Menü derselben Karte.
    const sichten = karte.getByRole('button', { name: 'Sichten' });
    await expect(sichten).toBeVisible();
    const ausloeser = karte.getByRole('button', { name: /^Aktionen zu Meldung/ });
    await ausloeser.click();
    await expect(offenesMenue(page)).toBeVisible();
    const punkte = await eintraegeVon(offenesMenue(page));
    expect(punkte.length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(offenesMenue(page)).toHaveCount(0);

    // Rechtsklick auf den Wortlaut, nicht auf einen Link oder Knopf.
    await karte.getByText('Deich am Pegel instabil').click({ button: 'right' });
    const menue = offenesMenue(page);
    await expect(menue).toBeVisible();
    expect(await eintraegeVon(menue)).toEqual(['Sichten', ...punkte]);
    await expect(menue.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menue).toHaveCount(0);

    // Tastatur: Fokus auf einem Knopf der Karte, Umschalt+F10; Escape gibt ihn zurück.
    await sichten.focus();
    await page.keyboard.press('Shift+F10');
    await expect(offenesMenue(page)).toBeVisible();
    await expect(offenesMenue(page).getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(offenesMenue(page)).toHaveCount(0);
    await expect(sichten).toBeFocused();
  });
});

test.describe('Chat am Handy (Touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('langer Druck auf eine Nachricht öffnet ihr Menü; das Abheben schließt es nicht', async ({
    page,
  }) => {
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E Kontextmenü Chat ${Date.now()}`,
    });
    const kanaele = await page.request.get(`/api/einsaetze/${einsatzId}/chat/kanaele`);
    expect(kanaele.ok(), `Kanäle: ${kanaele.status()}`).toBe(true);
    const kanalId = ((await kanaele.json()) as { id: number }[])[0].id;
    await post(page, `/api/einsaetze/${einsatzId}/chat/kanaele/${kanalId}/nachrichten`, {
      inhalt: 'Bitte Lagebild aktualisieren',
    });

    await page.goto(`/einsaetze/${einsatzId}/chat`);
    const text = page.getByText('Bitte Lagebild aktualisieren');
    await expect(text).toBeVisible();
    const box = (await text.boundingBox())!;
    const punkt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: punkt.x, y: punkt.y, id: 0, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await page.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const menue = page.locator(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label^="Aktionen zu Nachricht von"]',
    );
    await expect(menue).toBeVisible();
    // Nach dem Nachlauf des Riegels steht es noch.
    await page.waitForTimeout(600);
    await expect(menue).toBeVisible();
    expect(await eintraegeVon(menue)).toEqual(
      expect.arrayContaining(['Zu ETB', 'Bearbeiten', 'Löschen']),
    );
  });
});
