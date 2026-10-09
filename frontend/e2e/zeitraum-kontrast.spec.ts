import { expect, test, type Locator, type Page } from '@playwright/test';
import { eingeschwungen, stehend, verhaeltnis } from './kontrast-kern';
import { anmelden, einsatzAnlegen } from './trefflaeche-kern';

/**
 * Die Schrift auf den Bereichszellen der Zeitraumwahl hält den Textboden, Tag ≥ 7 : 1 und Nacht
 * ≥ 5 : 1, auch während der Zeiger das Ende sucht (LFH-1068, Spec `farbrollen-kontrast`).
 *
 * GEMESSEN im Dialog „Zeitfenster anlegen“ der Verpflegung (`ZeitraumEingabe`): Beginn wählen,
 * mit „OK“ bestätigen, dann den Zeiger auf einen späteren Tag legen. rc-picker färbt daraufhin
 *  · den Beginn und die Zelle unter dem Zeiger als Bereichsenden: Schrift `colorTextLightSolid`
 *    auf `colorPrimary` (= `bedien`). antds globales Weiß lag nachts dort bei 3,22;
 *  · die Tage dazwischen als Bereich: Schrift `colorText` auf `cellActiveWithRangeBg`, die antd
 *    als `::before` der Zelle zeichnet (die Auswahlfläche).
 * Die im Ticket vermuteten Tokens `cellHoverWithRangeBg`/`cellRangeBorderColor` liest antd 6.6.5
 * nicht mehr (nur noch in `date-picker/style/token.js` abgeleitet); gemessen wird, was der
 * Browser zeichnet.
 *
 * Den Bereich setzt rc-picker per JavaScript (Klassen `-range-start`, `-in-range`,
 * `-range-end`); der Spec sichert ihn vor der Messung als Vorbedingung zu. Böden als Literale:
 * eine schlechte Palette muss rot werden, statt dass der Spec sie aus dem Produkt übernimmt.
 */

const BODEN = { light: 7, dark: 5 } as const;

type Farbe = [number, number, number, number];

const panel = (page: Page) => page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)');

async function themaSetzen(page: Page, modus: keyof typeof BODEN) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
}

/** Schrift einer Zelle gegen den Bereichsgrund, den antd als `::before` der Zelle zeichnet. Der
 *  Messkern sieht nur Vorfahren, keine Pseudoelemente; deshalb hier eigens gelesen. */
async function aufBereich(
  zelle: Locator,
): Promise<{ text: Farbe; grund: Farbe; verhaeltnis: number }> {
  const innen = zelle.locator('.ant-picker-cell-inner');
  await eingeschwungen(innen);
  const { text, grund } = await zelle.evaluate((td) => {
    const rgb = (wert: string) => {
      const m = /^rgba?\(([^)]+)\)$/.exec(wert);
      if (!m) throw new Error(`Nicht unterstützte Farbe: ${wert}`);
      const t = m[1].split(/[\s,/]+/).map(Number);
      return [t[0], t[1], t[2], t[3] ?? 1];
    };
    const inner = td.querySelector('.ant-picker-cell-inner');
    if (!inner) throw new Error('Zelle ohne Inhalt');
    if (getComputedStyle(inner).backgroundColor !== 'rgba(0, 0, 0, 0)')
      throw new Error(`Inhalt trägt eigene Fläche: ${getComputedStyle(inner).backgroundColor}`);
    return {
      text: rgb(getComputedStyle(inner).color),
      grund: rgb(getComputedStyle(td, '::before').backgroundColor),
    };
  });
  expect(text[3], 'Schrift deckend').toBe(1);
  expect(grund[3], 'Bereichsgrund deckend').toBe(1);
  return {
    text: text as Farbe,
    grund: grund as Farbe,
    verhaeltnis: verhaeltnis(text as Farbe, grund as Farbe),
  };
}

for (const modus of ['light', 'dark'] as const) {
  test(`Zeitraumwahl: Schrift auf den Bereichszellen unter dem Zeiger — ${modus}`, async ({
    page,
  }) => {
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
    await dialog.getByPlaceholder('Beginn', { exact: true }).click();

    const p = panel(page);
    await expect(p).toBeVisible();
    // Tage aus der Mitte des angezeigten Monats: kein Monatswechsel zwischen Beginn und Zeiger.
    const tage = p.locator('.ant-picker-date-panel td.ant-picker-cell-in-view');
    const beginn = tage.nth(9);
    const dazwischen = tage.nth(11);
    const zeiger = tage.nth(13);
    await beginn.click();
    await p.getByRole('button', { name: 'OK', exact: true }).click();
    // antd springt nach „OK“ ins Ende-Feld; das Panel bleibt offen.
    await expect(dialog.getByPlaceholder('Ende', { exact: true })).toBeFocused();
    await zeiger.hover();

    await expect(beginn, 'Vorbedingung: Beginn ist Bereichsanfang').toHaveClass(
      /ant-picker-cell-range-start/,
    );
    await expect(dazwischen, 'Vorbedingung: Tag liegt im Bereich').toHaveClass(
      /ant-picker-cell-in-range/,
    );
    await expect(zeiger, 'Vorbedingung: Zelle unter dem Zeiger ist Bereichsende').toHaveClass(
      /ant-picker-cell-range-end/,
    );
    expect(await zeiger.evaluate((el) => el.matches(':hover')), 'Vorbedingung Zeiger').toBe(true);

    const boden = BODEN[modus];
    for (const [name, zelle] of [
      ['Zelle unter dem Zeiger', zeiger],
      ['Beginn', beginn],
    ] as const) {
      const m = await stehend(zelle.locator('.ant-picker-cell-inner'), `${modus}/${name}`);
      expect(m.verhaeltnis, `${modus}/${name}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(boden);
    }
    const m = await aufBereich(dazwischen);
    expect(m.verhaeltnis, `${modus}/Tag im Bereich: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(
      boden,
    );
  });
}
