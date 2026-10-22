import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Filter im Spaltenkopf einer Tabelle (LLH-1086, Spec `tabellen-sortieren-filtern`), geteilt von
 * allen Specs, die über den Kopf filtern. Der Auslöser heißt „<Spalte> filtern“ (gefiltert:
 * „<Spalte> filtern, gefiltert“, `KatalogTabelle`, LLH-1227); das Menü ist antds Filtermenü mit
 * Kästchen je Wert, im Clientmodus mit Zähler („Groß (3)“).
 */

/** Der Auslöser im Kopf der Spalte `spalte`, gefiltert oder nicht. */
export function kopfFilterAusloeser(bereich: Page | Locator, spalte: string): Locator {
  return bereich.getByRole('button', { name: new RegExp(`^${spalte} filtern(, gefiltert)?$`) });
}

/** Das offene Filtermenü. Ein ausblendendes zählt nicht (antd lässt das Portal stehen). */
export function offenesFiltermenue(page: Page): Locator {
  return page.locator(
    '.ant-dropdown:not(.ant-dropdown-hidden):not(.ant-slide-up-leave) .ant-table-filter-dropdown',
  );
}

/**
 * Öffnet den Kopffilter der Spalte, hakt die Werte an (Text am Anfang des Eintrags, der Zähler
 * dahinter zählt nicht mit) und bestätigt. Danach steht der Auslöser als „gefiltert“ da —
 * Vorbedingung, damit ein verlorener Klick hier rot wird.
 */
export async function kopfFilterWaehlen(
  page: Page,
  spalte: string,
  werte: readonly string[],
  bereich: Page | Locator = page,
): Promise<void> {
  await kopfFilterAusloeser(bereich, spalte).click();
  const menue = offenesFiltermenue(page);
  await expect(menue).toBeVisible();
  for (const wert of werte) {
    await menue
      .locator('.ant-dropdown-menu-title-content')
      .filter({ hasText: new RegExp(`^${wert}( \\(\\d+\\))?$`) })
      .click();
  }
  await menue.locator('.ant-table-filter-dropdown-btns .ant-btn-primary').click();
  await expect(
    bereich.getByRole('button', { name: `${spalte} filtern, gefiltert` }),
    `Kopffilter „${spalte}“ ist gesetzt`,
  ).toBeVisible();
}
