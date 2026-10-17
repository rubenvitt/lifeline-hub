import { expect, test, type Page } from '@playwright/test';
import { stehend } from './kontrast-kern';
import { anmelden, einsatzAnlegen } from './trefflaeche-kern';

/**
 * Die Schrift des gewählten Tags im Kalender der Zeiteingabe hält den Textboden, Tag ≥ 7 : 1 und
 * Nacht ≥ 5 : 1 (LFH-1068, Spec `farbrollen-kontrast`).
 *
 * GEMESSEN im Dialog „Zeitfenster anlegen“ der Verpflegung (`ZeitraumEingabe`): den Kalender am
 * Beginn öffnen (seit LLH-1070 der Nebenweg neben dem Textfeld, antds `Calendar`), einen Tag
 * wählen. antd färbt den gewählten Tag mit Schrift `colorTextLightSolid` auf `colorPrimary`
 * (= `bedien`); antds globales Weiß lag nachts dort bei 3,22, deshalb setzt
 * `theme/tokens.ts` das Token am `Calendar`. Den früheren Bereich (Tage zwischen Beginn und Ende)
 * gibt es nicht mehr: Beginn und Ende sind zwei Felder mit je eigenem Kalender.
 *
 * Böden als Literale: eine schlechte Palette muss rot werden, statt dass der Spec sie aus dem
 * Produkt übernimmt.
 */

const BODEN = { light: 7, dark: 5 } as const;

const panel = (page: Page) => page.locator('.ant-popover:not(.ant-popover-hidden)');

async function themaSetzen(page: Page, modus: keyof typeof BODEN) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
}

for (const modus of ['light', 'dark'] as const) {
  test(`Kalender der Zeiteingabe: Schrift des gewählten Tags — ${modus}`, async ({ page }) => {
    await themaSetzen(page, modus);
    await anmelden(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    const einsatzId = await einsatzAnlegen(page, `E2E Zeitraum ${Date.now()} ${modus}`);
    await page.goto(`/einsaetze/${einsatzId}/verpflegung`);
    await page
      .locator('[data-lfh="seitenkopf"]')
      .getByRole('button', { name: 'Zeitfenster anlegen', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Zeitfenster anlegen' });
    await dialog
      .getByPlaceholder('Beginn', { exact: true })
      .locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " ant-space-compact ")][1]')
      .getByRole('button', { name: /^Kalender/ })
      .click();

    const p = panel(page);
    await expect(p).toBeVisible();
    // Ein Tag aus der Mitte des angezeigten Monats.
    const tag = p.locator('td.ant-picker-cell-in-view').nth(11);
    await tag.locator('.ant-picker-cell-inner').click();
    await expect(tag, 'Vorbedingung: der Tag ist gewählt').toHaveClass(/ant-picker-cell-selected/);
    // Den Zeiger vom Tag nehmen: gemessen wird die Wahl, nicht der Hover.
    await p.getByRole('textbox', { name: 'Uhrzeit', exact: true }).hover();

    const boden = BODEN[modus];
    const m = await stehend(tag.locator('.ant-picker-cell-inner'), `${modus}/gewählter Tag`);
    expect(m.verhaeltnis, `${modus}/gewählter Tag: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(
      boden,
    );
  });
}
