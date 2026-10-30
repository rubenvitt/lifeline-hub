import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Filter im Spaltenkopf einer Tabelle (LLH-1086, Spec `tabellen-sortieren-filtern`), geteilt von
 * allen Specs, die über den Kopf filtern. Der Auslöser heißt „<Spalte> filtern“ (gefiltert:
 * „<Spalte> filtern, gefiltert“, `KatalogTabelle`, LLH-1227); das Menü ist antds Filtermenü mit
 * Kästchen je Wert, im Clientmodus mit Zähler („Groß (3)“).
 *
 * Wie bei Auswahlliste und Aktionsmenü (`auswahl-kern.ts`, `menue-kern.ts`) wird erst ins stehende
 * Menü geklickt (LLH-1499): Während `ant-slide-up-appear` ist es „nicht stabil“, Playwright
 * scrollt das Dokument, der Kopf klebt, antd legt das Menü neu an, und fällt das zwischen
 * mousedown und mouseup, bleibt das Kästchen leer. „OK“ bestätigte dann eine leere Wahl.
 */

const EINBLENDUNG = /ant-slide-(up|down)-(appear|enter)/;

/** Ein Menü im Portal, ohne ein gerade ausblendendes. */
const OFFEN =
  '.ant-dropdown:not(.ant-dropdown-hidden):not(.ant-slide-up-leave):not(.ant-slide-down-leave)';

/** Der Auslöser im Kopf der Spalte `spalte`, gefiltert oder nicht. */
export function kopfFilterAusloeser(bereich: Page | Locator, spalte: string): Locator {
  return bereich.getByRole('button', { name: new RegExp(`^${spalte} filtern(, gefiltert)?$`) });
}

/** Das offene Filtermenü. Ein ausblendendes zählt nicht (antd lässt das Portal stehen). */
export function offenesFiltermenue(page: Page): Locator {
  return page.locator(`${OFFEN} .ant-table-filter-dropdown`);
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
  await expect(
    page.locator(OFFEN).filter({ has: page.locator('.ant-table-filter-dropdown') }),
  ).not.toHaveClass(EINBLENDUNG);
  for (const wert of werte) {
    const eintrag = menue
      .locator('.ant-dropdown-menu-item')
      .filter({ hasText: new RegExp(`^${wert}( \\(\\d+\\))?$`) });
    await eintrag.locator('.ant-dropdown-menu-title-content').click();
    await expect(eintrag.getByRole('checkbox'), `„${wert}“ ist angehakt`).toBeChecked();
  }
  await menue.locator('.ant-table-filter-dropdown-btns .ant-btn-primary').click();
  await expect(
    bereich.getByRole('button', { name: `${spalte} filtern, gefiltert` }),
    `Kopffilter „${spalte}“ ist gesetzt`,
  ).toBeVisible();
}
