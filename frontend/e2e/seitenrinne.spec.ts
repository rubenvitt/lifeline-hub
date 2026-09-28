import { expect, test, type Page } from '@playwright/test';

/**
 * Die Seitenrinne im Browser: dass sie WIRKT, ist nur hier messbar (die Verdrahtung bewacht
 * `src/theme/seitenrinne.guard.test.ts`). Kein Device-Descriptor; gemessen wird punktgenau der
 * eigene Beitrag, nicht `body.scrollWidth`.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

test('Seitenrinne: 24 px am Fükw-Schirm, 12 px auf 390 px', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Rinne ${Date.now()}`);

  // BEIDE Layouts: `/einsaetze` hängt an der Ebene-1-Shell, die Modulseite am
  // Einsatz-Workspace — Geschwister, die einzeln umgestellt werden könnten.
  for (const route of ['/einsaetze', `/einsaetze/${einsatzId}/etb`]) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(route);
    const content = page.locator('.ant-layout-content');
    // Genau ein Rahmen — sonst wäre eine grüne Zusicherung grün durch Nichtstun.
    await expect(content, route).toHaveCount(1);
    await expect(content, route).toHaveCSS('padding-left', '24px');
    await expect(content, route).toHaveCSS('padding-right', '24px');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(content, route).toHaveCSS('padding-left', '12px');
    await expect(content, route).toHaveCSS('padding-right', '12px');
  }
});

test.describe('Seitenrinne auf dem Handschirm', () => {
  test('Seitenrinne: die ETB-Erfassungsleiste deckt die Content-Spalte randlos', async ({
    page,
  }) => {
    // Anmelden und Anlegen am breiten Schirm: gemessen wird die Rinne, nicht die Einsatzliste.
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Rinne mobil ${Date.now()}`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(page.getByPlaceholder('Inhalt …')).toBeVisible();

    const content = (await page.locator('.ant-layout-content').boundingBox())!;
    const leiste = (await page.locator('.etb-erfassung-sticky').boundingBox())!;
    const karte = (await page.locator('.etb-erfassung-card').boundingBox())!;

    // Der negative Außenrand zieht die Leiste randlos über die Rinne …
    expect(Math.abs(leiste.x - content.x), 'linke Kante').toBeLessThanOrEqual(1);
    expect(Math.abs(leiste.width - content.width), 'Breite').toBeLessThanOrEqual(1);
    // … und ihr eigener Innenrand nimmt dieselbe Rinne wieder auf, sodass ihr Text auf einer
    // Flucht mit dem Seiteninhalt steht.
    expect(Math.abs(karte.x - (content.x + 12)), 'Innenrand auf der Rinne').toBeLessThanOrEqual(1);
  });
});
