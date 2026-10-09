import { expect, test, type Locator, type Page } from '@playwright/test';
import { stehendeAuswahl } from './auswahl-kern';
import { stehend } from './kontrast-kern';
import { anlegen, anmelden, einsatzAnlegen } from './trefflaeche-kern';

/**
 * Die Schrift auf der Auswahlfläche hält den Textboden, Tag ≥ 7 : 1 und Nacht ≥ 5 : 1, in Ruhe
 * und unter dem Zeiger (LFH-984, Spec `farbrollen-kontrast`). Die Auswahlfläche ist die Rolle
 * `auswahlFlaeche`; vorher leitete antd sie aus `bedien` ab (Tag `#b9c1c4`, Nacht `#253a4e`), und
 * der gewählte Eintrag der Statuswahl schrieb in `bedien`: 4,68 bzw. 3,64. Gerechnet steht
 * dasselbe in `src/theme/auswahlKontrast.test.ts`; hier zählt, was der Browser zeichnet.
 *
 * GEMESSEN:
 *  · Statuswahl: der gewählte Eintrag im Menü „Status von NDR 1 · Evakuierte ändern“ (Presse S5,
 *    Medienkontakt per API), in Ruhe und unter dem Zeiger. Die Fläche wechselt unter dem Zeiger
 *    bewusst nicht (design.md E3), gemessen wird trotzdem beides.
 *  · Auswahlliste: die gewählte Option „Realeinsatz“ der Einsatzart im Dialog „Neuer Einsatz“,
 *    ruhend (Zeiger auf „Übung“) und aktiv (Zeiger auf ihr selbst).
 *
 * Ruhe und Zeiger sehen gleich aus; deshalb sichert der Spec den Zustand vor jeder Messung als
 * Vorbedingung zu (`-active` setzt antd per JavaScript), sonst bestünde eine Zeigermessung auch
 * ohne Zeiger.
 *
 * Böden und die erwartete Fläche stehen als Literale: eine schlechte Palette muss rot werden,
 * statt dass der Spec sie aus dem Produkt übernimmt. Dass der Grund die Auswahlfläche IST, sichert
 * der Spec nach dem Kontrastwert zu (eine Regression scheitert so zuerst am Befund).
 */

const MODI = {
  light: { boden: 7, auswahlFlaeche: [0xdb, 0xe7, 0xf5, 1] },
  dark: { boden: 5, auswahlFlaeche: [0x08, 0x17, 0x2b, 1] },
} as const;

async function haelt(
  ziel: Locator,
  modus: keyof typeof MODI,
  name: string,
): Promise<Awaited<ReturnType<typeof stehend>>> {
  const { boden, auswahlFlaeche } = MODI[modus];
  const m = await stehend(ziel, name);
  expect(m.verhaeltnis, `${name}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(boden);
  expect(m.grund, `${name}: Grund ist die Auswahlfläche`).toEqual(auswahlFlaeche);
  return m;
}

async function themaSetzen(page: Page, modus: keyof typeof MODI) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
}

for (const modus of ['light', 'dark'] as const) {
  test.describe(`Schrift auf der Auswahlfläche — ${modus}`, () => {
    test.beforeEach(async ({ page }) => {
      await themaSetzen(page, modus);
    });

    test('Statuswahl: gewählter Eintrag in Ruhe und unter dem Zeiger', async ({ page }) => {
      await anmelden(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const einsatzId = await einsatzAnlegen(page, `E2E Auswahl ${Date.now()} ${modus}`);
      await anlegen(
        page,
        einsatzId,
        'stab/medienkontakte',
        { art: 'anfrage', medium: 'NDR 1', thema: 'Evakuierte' },
        'Medienkontakt',
      );
      await page.goto(`/einsaetze/${einsatzId}/stab/presse`);
      await page.getByRole('button', { name: 'Status von NDR 1 · Evakuierte ändern' }).click();

      const gewaehlt = page.locator(
        '.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item-selected',
      );
      await expect(gewaehlt, 'Vorbedingung: genau ein gewählter Eintrag').toHaveCount(1);
      // Das Menü öffnet mit dem Fokus auf dem gewählten Eintrag (aktiv). Für die Ruhe liegt der
      // Zeiger auf einem ANDEREN Eintrag; erst dann wandert die Aktivmarke.
      await page
        .locator(
          '.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item:not(.ant-dropdown-menu-item-selected)',
        )
        .first()
        .hover();
      await expect(gewaehlt, 'Vorbedingung Ruhe').not.toHaveClass(/ant-dropdown-menu-item-active/);
      expect(await gewaehlt.evaluate((el) => el.matches(':hover')), 'Vorbedingung Ruhe').toBe(
        false,
      );
      await haelt(gewaehlt, modus, `${modus}/Statuswahl, Ruhe`);
      await gewaehlt.hover();
      await expect
        .poll(() => gewaehlt.evaluate((el) => el.matches(':hover')), 'Vorbedingung Zeiger')
        .toBe(true);
      await expect(gewaehlt, 'Vorbedingung Zeiger').toHaveClass(/ant-dropdown-menu-item-active/);
      await haelt(gewaehlt, modus, `${modus}/Statuswahl, Zeiger`);
    });

    test('Auswahlliste: gewählte Option der Einsatzart', async ({ page }) => {
      await anmelden(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
      await page.getByRole('combobox', { name: 'Einsatzart' }).click();

      const liste = await stehendeAuswahl(page);
      const gewaehlt = liste.locator('.ant-select-item-option-selected');
      await expect(gewaehlt, 'Vorbedingung: genau eine gewählte Option').toHaveCount(1);
      await expect(gewaehlt).toHaveText('Realeinsatz');
      // Beim Öffnen macht rc-select die gewählte Option zur aktiven. Für die Ruhe liegt der Zeiger
      // deshalb auf einer ANDEREN Option.
      await liste.locator('.ant-select-item-option').filter({ hasText: 'Übung' }).hover();
      await expect(gewaehlt, 'Vorbedingung Ruhe').not.toHaveClass(/ant-select-item-option-active/);
      await haelt(gewaehlt, modus, `${modus}/Einsatzart, gewählt`);
      await gewaehlt.hover();
      await expect(gewaehlt, 'Vorbedingung Zeiger').toHaveClass(/ant-select-item-option-active/);
      await haelt(gewaehlt, modus, `${modus}/Einsatzart, gewählt und aktiv`);
    });
  });
}
