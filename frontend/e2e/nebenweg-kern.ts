import { expect, type Locator, type Page } from '@playwright/test';
import { ruhigeHoehe } from './trefflaeche-kern';

/**
 * Ein Nebenweg des Seitenkopfs (Drucken, CSV, Listenzugriffe, Sprung ins ETB …) steht je nach
 * Breite und Stufe als Knopf im Kopf oder im Menü hinter „Weitere“ (`nebenwegeImMenue` in
 * `components/EinsatzSeite.tsx`, LFH-963 und LLH-1786): Knopf nur in `kompakt` ab `md`.
 *
 * Wer den WEG prüft (Druck, Export), nimmt {@link nebenwegWaehlen}; wer die GESTALT prüft (Knopf
 * oder Menü in einer bestimmten Lage), fragt ausdrücklich nach dem einen oder dem anderen.
 */

/** Der Auslöser „Weitere“ im Seitenkopf, über seinen zugänglichen Namen (nennt die Seite). */
export function weitereAusloeser(page: Page, name: string): Locator {
  return page
    .locator('[data-lfh="seitenkopf-aktionen"]')
    .getByRole('button', { name, exact: true });
}

/** Der Eintrag im offenen Menü „Weitere“. */
export function weitereEintrag(page: Page, label: string | RegExp): Locator {
  return page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden)')
    .getByRole('menuitem', { name: label, exact: typeof label === 'string' });
}

/**
 * Öffnet „Weitere“ und liefert den Eintrag `label`, sichtbar und ausgezoomt: antd öffnet das Menü
 * mit einer Skalierung, und ein Maß davor fiele zu klein aus (gemessen 43 statt 48 px).
 */
export async function weitereOeffnen(
  page: Page,
  ausloeser: string,
  label: string | RegExp,
): Promise<Locator> {
  await weitereAusloeser(page, ausloeser).click();
  const eintrag = weitereEintrag(page, label);
  await expect(eintrag).toBeVisible();
  await ruhigeHoehe(eintrag, `Menüeintrag ${String(label)}`);
  return eintrag;
}

/**
 * Wählt den Nebenweg `label`, gleich ob er als Knopf (Link mit Knopfgestalt oder Knopf) im Kopf
 * steht oder hinter `ausloeser` im Menü. Für Specs, die den Weg prüfen, nicht die Gestalt.
 */
export async function nebenwegWaehlen(page: Page, ausloeser: string, label: string): Promise<void> {
  const kopf = page.locator('[data-lfh="seitenkopf-aktionen"]');
  const knopf = kopf
    .getByRole('link', { name: label, exact: true })
    .or(kopf.getByRole('button', { name: label, exact: true }));
  const menue = weitereAusloeser(page, ausloeser);
  await expect(knopf.or(menue).first()).toBeVisible();
  if ((await knopf.count()) > 0) {
    await knopf.first().click();
    return;
  }
  await (await weitereOeffnen(page, ausloeser, label)).click();
}
