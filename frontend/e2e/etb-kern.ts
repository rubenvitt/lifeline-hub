import { expect, type Page } from '@playwright/test';

/**
 * Adresse des ETB mit eingeblendeten Systemeinträgen (kwc2yszv D6): in der Vorgabe sind sie aus,
 * erst `system=an` zeigt sie. Wer einen Systemeintrag in der Zeitachse prüft, öffnet diese Adresse
 * — auch für eine `toHaveCount(0)`-Prüfung, die sonst schon bestünde, weil er ausgeblendet ist.
 */
export function etbMitSystem(einsatzId: number | string): string {
  return `/einsaetze/${einsatzId}/etb?system=an`;
}

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

/**
 * Setzt das Feld Von der ETB-Erfassung über den Freitext-Eintrag der Vorschlagsliste: eine Meldung
 * braucht einen Absender (Spec `etb-absender-empfaenger`, „Vorbelegung neuer Einträge“: Von leer,
 * Pflicht). Enter übernimmt und springt in den Inhalt (Spec `etb-schnellerfassung-tastatur`).
 */
export async function etbVonSetzen(page: Page, von = 'Florian Süd 1') {
  const feld = page.getByRole('combobox', { name: 'Von', exact: true });
  await feld.fill(von);
  await expect(page.getByTitle(`„${von}“ als Freitext übernehmen`)).toBeVisible();
  await feld.press('Enter');
  await expect(page.getByPlaceholder(/Inhalt/)).toBeFocused();
}
