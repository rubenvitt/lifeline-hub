import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Zoom frei, kein Fokus-Zoom (LLH-2043, `frontend/AGENTS.md`, Bedien-Leitlinie): der Viewport
 * sperrt den Zoom nicht, und auf grobem Zeiger tragen Eingabefelder 16 px Schrift, weil iOS beim
 * Fokus in jedes Feld darunter hineinzoomt. Vitest hält Wert und Regel (`theme/zoomFrei.guard`,
 * `theme/rollen.guard`); erst hier meldet ein Browser selbst die Zeigerart und rechnet die
 * Kaskade, auch gegen antds eigene Größen und gegen Inline-Stile.
 */

const groesse = (ort: Locator) => ort.evaluate((el) => getComputedStyle(el).fontSize);

/** Setzt ein Feld mit Inline-Größe und die beiden Anzeigeteile eines antd-Select ins Dokument:
 *  die Regel muss sie treffen, wo immer ein Baustein sie hinsetzt. */
async function setzeProbe(page: Page) {
  await page.evaluate(() => {
    const huelle = document.createElement('div');
    huelle.id = 'zoom-probe';
    huelle.innerHTML = [
      '<input data-probe="inline" style="font-size: 14px" />',
      '<span class="ant-select-selection-item" data-probe="wert">Wert</span>',
      '<span class="ant-select-selection-placeholder" data-probe="platzhalter">Bitte wählen</span>',
      '<input type="checkbox" data-probe="kaestchen" style="font-size: 13px" />',
    ].join('');
    document.body.append(huelle);
  });
}

test.describe('Touch 390 × 844', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    // Vorbedingung: der Browser meldet den groben Zeiger wirklich, und die Dichte folgt ihm.
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'komfortabel');
  });

  test('der Viewport lässt den Zoom zu', async ({ page }) => {
    const inhalt = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(inhalt).toBe('width=device-width, initial-scale=1.0');
  });

  test('Eingabefelder tragen 16 px, der Knopf bleibt in der Dichte-Grundschrift', async ({
    page,
  }) => {
    await expect.poll(() => groesse(page.getByLabel('Benutzername'))).toBe('16px');
    expect(await groesse(page.getByLabel('Passwort'))).toBe('16px');
    expect(await groesse(page.getByRole('button', { name: 'Anmelden', exact: true }))).toBe('15px');
  });

  test('die Feldhöhe bleibt die Steuerhöhe der Dichte', async ({ page }) => {
    const feld = page.getByLabel('Benutzername');
    await expect(feld).toBeVisible();
    const hoehe = (await feld.boundingBox())?.height ?? 0;
    // Das Feld selbst, nicht seine Hülle: 16 px Schrift passen in die 48 px von `komfortabel`.
    expect(hoehe).toBeLessThanOrEqual(49);
  });

  test('auch Inline-Größen und antds Select-Anzeige weichen, Kästchen nicht', async ({ page }) => {
    await setzeProbe(page);
    const probe = (name: string) => page.locator(`[data-probe="${name}"]`);
    expect(await groesse(probe('inline'))).toBe('16px');
    expect(await groesse(probe('wert'))).toBe('16px');
    expect(await groesse(probe('platzhalter'))).toBe('16px');
    expect(await groesse(probe('kaestchen'))).toBe('13px');
  });
});

test.describe('Desktop, feiner Zeiger', () => {
  test('Eingabefelder bleiben in der Dichte-Grundschrift', async ({ page }) => {
    await page.goto('/login');
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(false);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
    await expect.poll(() => groesse(page.getByLabel('Benutzername'))).toBe('13.5px');
    await setzeProbe(page);
    expect(await groesse(page.locator('[data-probe="inline"]'))).toBe('14px');
  });
});
