import { expect, test, type Page } from '@playwright/test';

/**
 * Die Zelle der Gefahrenmatrix ist EIN Auslöser (Dropdown), kein 5-Wege-Segmentcontrol — das
 * Breitenbudget im Fükw trägt keins. Gemessen: auf dem Führungs-Tablet (komfortabel) ist jede
 * bedienbare Zelle ≥ 44 px hoch. Im Fükw (kompakt) sind 30 px die Staffel, kein Mangel.
 */
test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

const DICHTE = 'lifeline-hub.dichte';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Subpixel-Toleranz: Chromium rechnet unter Last anders. */
const SUBPIXEL = 0.5;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

test('jede Matrix-Zelle misst auf dem Tablet mindestens 44 px', async ({ page }) => {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
    DICHTE,
    'komfortabel',
  ] as const);
  await anmelden(page);
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill('C12 Matrix');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)/)![1];

  // Gefahrengebiet über die API. `geometrie` ist ein GeoJSON-STRING, dessen `type` zu
  // `geometrie_typ` passen muss ('Polygon', großgeschrieben).
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/zonen`, {
    data: {
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
      label: 'C12 Gebiet',
    },
  });
  expect(antwort.ok(), `Zone anlegen: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();

  await page.goto(`/einsaetze/${einsatzId}/gefahren`);
  // Die Seite wählt das erste Gefahrengebiet automatisch, die Matrix erscheint direkt.
  const zellen = page.getByRole('button', { name: /^Bewertung / });
  await expect(zellen.first()).toBeVisible();
  const n = await zellen.count();
  // 13 Gefahrentypen × 5 Schutzobjekte = 65, davon 58 bedienbar; der Rest ist `n. a.` ohne
  // Knopf.
  expect(n).toBeGreaterThanOrEqual(58);
  for (let i = 0; i < n; i += 1) {
    const zelle = zellen.nth(i);
    const name = (await zelle.getAttribute('aria-label')) ?? `Zelle ${i}`;
    // `expect.poll`: die Dichte-Staffel greift erst nach dem Mount von
    // `ConfigProvider`/`ThemeModeProvider` — sonst mäße man vor dem endgültigen Layout.
    await expect
      .poll(async () => (await zelle.boundingBox())?.height ?? 0, {
        message: `${name}: Soll ≥ 44 px hoch`,
      })
      .toBeGreaterThanOrEqual(44 - SUBPIXEL);
  }
});
