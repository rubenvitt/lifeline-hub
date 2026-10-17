import { expect, type Page } from '@playwright/test';

/**
 * Klappt jede Bündelzeile der ETB-Zeitachse auf (LLH-1106): drei und mehr aufeinanderfolgende
 * Systemeinträge stehen sonst als eine Zeile „n Systemeinträge · … · anzeigen“, ihr Text ist
 * nicht im DOM. Wer den Wortlaut eines Systemeintrags prüft — auch, dass etwas NICHT darin
 * steht —, ruft das nach dem Laden des ETB auf; sonst bestünde eine `toHaveCount(0)`-Prüfung
 * schon, weil der Text zugeklappt ist.
 */
export async function systemBuendelAufklappen(page: Page) {
  const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
  // Erst, wenn die Liste steht: eine Zeile oder ein Bündel ist da.
  await expect(
    zeitachse
      .locator('[data-testid="etb-ereigniszeile"], [data-testid="etb-buendelzeile"]')
      .first(),
  ).toBeVisible();
  const zu = zeitachse.locator('[data-testid="etb-buendelzeile"] button[aria-expanded="false"]');
  while ((await zu.count()) > 0) {
    await zu.first().click();
  }
}
