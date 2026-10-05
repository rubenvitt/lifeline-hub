import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Modulwechsel mit laufendem Werkzeug (LFH-943, Spec `lagekarte-ressourcen`): Wer misst oder
 * zeichnet und ohne „Beenden“ über die Rail ins ETB wechselt, sieht das ETB — nicht „Unexpected
 * Application Error“. Die Ursache war die Abbaureihenfolge: die Karte wurde vor den terra-draw-
 * Controllern entfernt, deren `stop()` dann auf eine fehlende Quelle schrieb und den Cleanup
 * abbrach (`lagekarte/AGENTS.md`, „Zeichnen und Messen“).
 *
 * Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385). Messen braucht kein
 * Schreibrecht und läuft deshalb zusätzlich als Beobachter (LFH-435).
 */

const FUEKW = { width: 1440, height: 900 };
const HANDSCHIRM = { width: 390, height: 844 };

async function einsatzAnlegen(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(`E2E Modulwechsel ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

async function lagekarteOeffnen(page: Page, einsatzId: string): Promise<Locator> {
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();
  // Die Karte steht (Style angewandt): erst dann legt terra-draw seine Quellen an.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __lfhKarte?: { isStyleLoaded(): boolean } }
          ).__lfhKarte?.isStyleLoaded() ?? false,
      ),
    )
    .toBe(true);
  return canvas;
}

/** Punkt über der Kartenmitte; darunter liegt die Steuerung im Kartenfuß. */
async function setzePunkt(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** Über die Navigation ins ETB — in der App, kein `goto`: nur so hängt die Lagekarte aus. */
async function railZumEtb(page: Page, schmal: boolean) {
  if (schmal) {
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    const nav = page.getByRole('dialog').getByRole('navigation', { name: 'Einsatz-Navigation' });
    const kopf = nav.getByRole('button', { name: 'Erfassung' });
    if ((await kopf.getAttribute('aria-expanded')) !== 'true') await kopf.click();
    await nav.getByRole('button', { name: /^ETB(,|$)/ }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Kategorien' })
      .getByRole('button', { name: 'Erfassung' })
      .click();
    // Der Rail-Sprung führt auf das erste Modul der Kategorie; der Klick im Panel macht das Ziel
    // unabhängig von der Reihenfolge.
    await page
      .getByRole('button', { name: /^ETB(,|$)/ })
      .first()
      .click();
  }
}

async function etbSteht(page: Page, seitenFehler: Error[]) {
  await expect(page).toHaveURL(/\/etb$/);
  await expect(page.getByRole('heading', { name: 'Einsatztagebuch' })).toBeVisible();
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
}

function fehlerSammeln(page: Page): Error[] {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  return seitenFehler;
}

test.describe('Lagekarte: Modulwechsel mit laufendem Werkzeug (LFH-943)', () => {
  test.use({ viewport: FUEKW });

  test('Messen läuft, ein Punkt gesetzt → Rail ins ETB', async ({ page }) => {
    const seitenFehler = fehlerSammeln(page);
    await anmeldenAlsAdmin(page);
    const canvas = await lagekarteOeffnen(page, await einsatzAnlegen(page));

    await page.getByRole('button', { name: 'Messen' }).click();
    await expect(page.locator('[data-lfh="mess-steuerung"]')).toBeVisible();
    await setzePunkt(page, canvas, -80, -120);
    await setzePunkt(page, canvas, 80, -120);
    // Vorbedingung: die Messung läuft wirklich (terra-draw hat Punkte).
    await expect(page.locator('[data-lfh="messwert"]')).toContainText(/\d.*\s(m|km)\b/);

    await railZumEtb(page, false);
    await etbSteht(page, seitenFehler);
  });

  test('Gefahrengebiet zeichnen läuft, ein Punkt gesetzt → Rail ins ETB', async ({ page }) => {
    const seitenFehler = fehlerSammeln(page);
    await anmeldenAlsAdmin(page);
    const canvas = await lagekarteOeffnen(page, await einsatzAnlegen(page));

    await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
    await setzePunkt(page, canvas, -100, -120);
    await expect(page.locator('[data-lfh="zeichnen-punkte"]')).toHaveText('1 Punkt');

    await railZumEtb(page, false);
    await etbSteht(page, seitenFehler);
  });

  test('Abschnittsfläche zeichnen läuft, ein Punkt gesetzt → Rail ins ETB', async ({ page }) => {
    const seitenFehler = fehlerSammeln(page);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    const angelegt = await page.request.post(`/api/einsaetze/${einsatzId}/abschnitte`, {
      data: { name: 'EA Modulwechsel' },
    });
    expect(angelegt.ok(), `Abschnitt: ${angelegt.status()}`).toBe(true);
    const canvas = await lagekarteOeffnen(page, einsatzId);

    await page.getByRole('button', { name: 'Fläche zeichnen' }).click();
    await setzePunkt(page, canvas, -100, -120);
    await expect(page.locator('[data-lfh="zeichnen-punkte"]')).toHaveText('1 Punkt');

    await railZumEtb(page, false);
    await etbSteht(page, seitenFehler);
  });
});

// Messen braucht kein Schreibrecht: der Beobachter erreicht denselben Abbau.
for (const [name, viewport] of [
  ['Handschirm 390', HANDSCHIRM],
  ['Fükw 1440', FUEKW],
] as const) {
  test.describe(`Lagekarte: Modulwechsel als Beobachter, ${name} (LFH-943)`, () => {
    test.use({ viewport });

    test('Messen läuft → Navigation ins ETB', async ({ page }) => {
      const seitenFehler = fehlerSammeln(page);
      await anmeldenAlsAdmin(page);
      const einsatzId = await einsatzAnlegen(page);
      await wechsleZuRolle(page, 'beobachter', einsatzId);
      const canvas = await lagekarteOeffnen(page, einsatzId);
      // Vorbedingung des Rollenzweigs: der Beobachter darf nicht zeichnen.
      await expect(page.getByRole('button', { name: 'Gefahrengebiet zeichnen' })).toHaveCount(0);

      await page.getByRole('button', { name: 'Messen' }).click();
      await expect(page.locator('[data-lfh="mess-steuerung"]')).toBeVisible();
      await setzePunkt(page, canvas, -80, -120);
      await setzePunkt(page, canvas, 80, -120);
      await expect(page.locator('[data-lfh="messwert"]')).toContainText(/\d.*\s(m|km)\b/);

      await railZumEtb(page, viewport.width < 992);
      await etbSteht(page, seitenFehler);
    });
  });
}
