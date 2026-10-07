import { expect, test, type Page } from '@playwright/test';

/**
 * Große Listen (LFH-949): 1 000 Personen in der Datensicht. Im DOM steht nur der Ausschnitt um den
 * Sichtbereich; der Bildlauf der SEITE führt bis zur letzten Person, und die stehende Kopfzeile
 * bleibt dabei unter dem Rahmen stehen. Gerechnet wird in `components/fensterAusschnitt.ts`.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1366, height: 768 };
const MENGE = 1000;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const a = await page.request.post(pfad, { data });
  expect(a.ok(), `${pfad}: ${a.status()} ${await a.text()}`).toBeTruthy();
  return ((await a.json()) as { id: number }).id;
}

const zeilen = (page: Page) => page.locator('tbody tr[data-row-key]');

test('1 000 Personen: Ausschnitt im DOM, Bildlauf bis ans Ende, Kopfzeile steht', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Große Liste ${Date.now()}`,
  });
  // In Bündeln, damit das Säen nicht die Laufzeit des Tests frisst.
  for (let ab = 0; ab < MENGE; ab += 50) {
    await Promise.all(
      Array.from({ length: Math.min(50, MENGE - ab) }, (_, i) =>
        post(page, `/api/einsaetze/${einsatzId}/personen`, { name: `Person ${ab + i + 1}` }),
      ),
    );
  }

  await page.goto(`/einsaetze/${einsatzId}/personen`);
  const tabelle = page.locator('table[aria-rowcount]');
  await expect(tabelle).toHaveAttribute('aria-rowcount', String(MENGE));
  await expect(zeilen(page).first()).toBeVisible();
  // Nur der Ausschnitt: 768 px Sicht plus 2 × 800 px Überhang tragen keine 200 Zeilen.
  expect(await zeilen(page).count()).toBeLessThan(200);

  // Bis ans Ende rollen. Die Höhen sind anfangs geschätzt und werden gemessen; das Ende kann
  // deshalb nachrücken, also so lange, bis die letzte Zeile da ist.
  const letzte = page.locator(`tbody tr[aria-rowindex="${MENGE}"]`);
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(letzte).toBeInViewport({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  expect(await zeilen(page).count()).toBeLessThan(200);

  // Die stehende Kopfzeile ist auch am Ende im Bild und überdeckt die Zeilen nicht.
  const kopf = page.locator('.ant-table-sticky-holder');
  await expect(kopf).toBeInViewport();
  const kopfUnten = (await kopf.boundingBox())!.y + (await kopf.boundingBox())!.height;
  expect((await letzte.boundingBox())!.y).toBeGreaterThanOrEqual(kopfUnten - 1);

  // Und zurück an den Anfang: die erste Zeile kommt wieder.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('tbody tr[aria-rowindex="1"]')).toBeInViewport();
});
