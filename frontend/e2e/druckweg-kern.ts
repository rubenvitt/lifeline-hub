import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Wählt einen Druckeinstieg im Kopf (LLH-1836, `frontend/src/druck/AGENTS.md`, „Wortlaut und
 * Platz der Druckeinstiege“): ab `md` ein Knopf bzw. Link, darunter ein Eintrag im Menü „Weitere“.
 * Die Druck-Specs laufen auf A4-Breite (680 px), also meist über das Menü; die Hilfe nimmt beide
 * Wege, damit eine Spec über mehrere Breiten denselben Aufruf nutzt.
 *
 * `weitere` ist der zugängliche Name des Auslösers („Weitere Aktionen zum Meldebild“), `in` grenzt
 * auf ein Paneel ein (Objektkopf).
 */
export async function waehleDruckweg(
  page: Page,
  {
    name = 'Drucken / als PDF',
    weitere,
    in: bereich,
  }: { name?: string; weitere: string | RegExp; in?: Locator },
): Promise<void> {
  const ort = bereich ?? page;
  const direkt = ort
    .getByRole('button', { name, exact: true })
    .or(ort.getByRole('link', { name, exact: true }));
  const ausloeser = ort.getByRole('button', {
    name: weitere,
    ...(typeof weitere === 'string' ? { exact: true } : {}),
  });
  await expect(direkt.or(ausloeser).first()).toBeVisible();
  if (await direkt.first().isVisible()) {
    await direkt.first().click();
    return;
  }
  await ausloeser.click();
  await page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')
    .getByRole('menuitem', { name, exact: true })
    .click();
}
