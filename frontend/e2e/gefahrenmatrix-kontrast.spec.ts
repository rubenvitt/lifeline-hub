import { expect, test, type Page } from '@playwright/test';
import { musterKontrast } from './kontrast-kern';

/**
 * LLH-1090: eine nicht anwendbare Zelle der Gefahrenmatrix trägt keinen Text mehr, sondern eine
 * Schraffur (zweiter Kanal Muster statt Wort, WCAG 1.4.1). Das Muster ist eine Grafik, die man
 * zum Verstehen braucht: seine Linien halten gegen den Grund der Zelle ≥ 3 : 1 (WCAG 1.4.11), am
 * Tag und in der Nacht, in der Matrix und im Feld der Legende. Boden als Literal.
 */
const BODEN = 3;
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page, modus: 'light' | 'dark') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<{ id: number }> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: Schraffur „nicht anwendbar“ in Matrix und Legende hält 3 : 1`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 1090 ${modus} ${Date.now()}`,
    });
    await post(page, `/api/einsaetze/${einsatzId}/zonen`, {
      typ: 'gefahrengebiet',
      geometrie_typ: 'Polygon',
      geometrie: JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [10.0, 50.0],
            [10.01, 50.0],
            [10.01, 50.01],
            [10.0, 50.01],
            [10.0, 50.0],
          ],
        ],
      }),
      label: 'Schraffur',
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

    await page.goto(`/einsaetze/${einsatzId}/gefahren`);
    await page.mouse.move(0, 0);
    const kacheln = page.getByRole('img', { name: /: nicht anwendbar$/ });
    await expect(kacheln).toHaveCount(7);
    // Kein Text, kein Knopf in der Zelle.
    const kachel = page.getByRole('img', { name: 'Atemgifte × Sachwerte: nicht anwendbar' });
    await expect(kachel).toHaveText('');
    await expect(kachel.locator('xpath=ancestor::td[1]').getByRole('button')).toHaveCount(0);
    // Die übrigen 58 Zellen tragen den Strich der Vorgabe „keine“.
    await expect(page.getByRole('button', { name: /^Bewertung .*: keine$/ })).toHaveCount(58);

    const legende = page
      .getByRole('note', { name: 'Legende der Matrix' })
      .locator('[data-lfh="legende-schraffur"]');
    for (const [ziel, name] of [
      [kachel, 'Matrixzelle'],
      [legende, 'Legende'],
    ] as const) {
      await expect(async () => {
        const m = await musterKontrast(ziel);
        expect(m.verhaeltnis, `${modus} ${name}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(
          BODEN,
        );
      }).toPass({ timeout: 10_000 });
    }
  });
}
