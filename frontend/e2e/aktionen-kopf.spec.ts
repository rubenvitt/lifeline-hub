import { expect, test, type Page } from '@playwright/test';
import { anmelden, einsatzAnlegen, stelleDichte } from './trefflaeche-kern';

/**
 * Der Kopf „Aktionen“ der Menüspalte steht in jeder Dichte in einer Zeile (LLH-2083). Seit dem
 * Schriftboden (Augenbraue 11 px, LLH-2044) brach er als „AKTIONE / N“ um: der Tabellenkopf trug
 * eine eigene, breitere Sperrung, und `menueSpaltenBreite` rechnete nur mit der Grundschrift.
 * Gemessen an der Fahrzeugliste (Menüspalte mit `menueSpaltenBreite`).
 */

const STUFEN = [
  { dichte: 'kompakt', viewport: { width: 1366, height: 768 } },
  { dichte: 'komfortabel', viewport: { width: 1024, height: 768 } },
  { dichte: 'handschuh', viewport: { width: 1024, height: 768 } },
] as const;

/** Zeilen des Kopftexts: verschiedene Oberkanten der Textrechtecke im Kopf. */
async function kopfZeilen(page: Page, name: string): Promise<number> {
  return page.evaluate((kopf) => {
    const th = [...document.querySelectorAll('thead th')].find(
      (t) => (t.textContent ?? '').trim().toLowerCase() === kopf.toLowerCase(),
    );
    if (!th) return -1;
    const bereich = document.createRange();
    bereich.selectNodeContents(th);
    const oben = new Set([...bereich.getClientRects()].map((r) => Math.round(r.top)));
    return oben.size;
  }, name);
}

for (const { dichte, viewport } of STUFEN) {
  test(`Kopf „Aktionen“ einzeilig (${dichte})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Aktionen-Kopf ${dichte} ${Date.now()}`);
    const fahrzeug = await page.request.post(`/api/incidents/${einsatzId}/vehicles`, {
      data: { adhoc: { funkrufname: 'Rotkreuz Musterstadt 1/83-1', kennzeichen: 'MU-RK 831' } },
    });
    expect(fahrzeug.ok(), `Seeding Fahrzeug: ${fahrzeug.status()}`).toBeTruthy();
    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    await stelleDichte(page, dichte);
    await expect(page.locator('tr.ant-table-row').first()).toBeVisible();
    expect(await kopfZeilen(page, 'Aktionen'), `${dichte}: Zeilen im Kopf „Aktionen“`).toBe(1);
  });
}
