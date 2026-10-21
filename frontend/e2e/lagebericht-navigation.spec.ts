import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Verlassen-Schutz am Lagebericht-Entwurf (LLH-1351): dieselbe Rückfrage wie im Befehl
 * (`befehl-navigation.spec.ts`), derselbe Baustein `entwurf/EntwurfNavigationSchutz.tsx`.
 * Seeding per `page.request`, geprüft wird die Oberfläche. Die Speicherfehler kommen aus
 * `page.route`, damit die Fassung ohne Zeitannahme offen bleibt.
 */

test.setTimeout(90_000);

const TITEL = 'Lagebericht Navigation';

async function vorbereiten(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  const einsatzId = await einsatzAnlegen(page, `E2E Lagebericht-Blocker ${Date.now()}`);
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/lageberichte`, {
    data: { vorlage: 'lagebeurteilung', titel: TITEL },
  });
  expect(antwort.ok(), await antwort.text()).toBe(true);
  const berichtId = (await antwort.json()).id as number;
  const api = `/api/einsaetze/${einsatzId}/lageberichte/${berichtId}`;
  const liste = `/einsaetze/${einsatzId}/lageberichte`;
  const detail = `${liste}/${berichtId}`;
  return { api, liste, detail };
}

test('Speicherfehler hält die Brotkrume; Speichern und weiter persistiert vor der Navigation', async ({
  page,
}) => {
  const { api, liste, detail } = await vorbereiten(page);
  let fehler = true;
  await page.route(`**${api}`, async (route) => {
    if (route.request().method() === 'PATCH' && fehler) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Speichern vorübergehend nicht möglich"}',
      });
    } else await route.continue();
  });
  await page.goto(detail);
  await page.getByLabel('Titel', { exact: true }).fill('Gesicherte neue Fassung');
  await page.locator('.ant-breadcrumb').getByRole('link', { name: 'Lageberichte' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(detail);
  // Der abgelehnte Blur-Autosave steht im Dialog, nicht hinter seiner Maske.
  await expect(dialog.getByText('Speichern vorübergehend nicht möglich')).toBeVisible();
  const speichern = dialog.getByRole('button', { name: 'Speichern und weiter', exact: true });
  await expect(speichern).not.toHaveClass(/ant-btn-loading/);
  fehler = false;
  await speichern.click();
  await expect(page).toHaveURL(liste);
  const gespeichert = await page.request.get(api);
  expect(gespeichert.ok()).toBe(true);
  expect((await gespeichert.json()).titel).toBe('Gesicherte neue Fassung');
});

test('Browser-Zurück: Bleiben behält die Fassung, Verwerfen führt den zweiten Versuch aus', async ({
  page,
}) => {
  const { api, liste, detail } = await vorbereiten(page);
  await page.goto(liste);
  await page
    .getByRole('region', { name: 'In Arbeit' })
    .getByRole('link', { name: TITEL, exact: true })
    .click();
  await expect(page).toHaveURL(detail);
  await page.route(`**${api}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Offline"}',
      });
    } else await route.continue();
  });
  await page.getByLabel('Titel', { exact: true }).fill('Offene Fassung');
  await page.evaluate(() => window.history.back());
  const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' });
  await expect(dialog).toBeVisible();
  // KEIN `exact: true` an „Speichern und weiter": antds `loading` ändert den zugänglichen Namen,
  // und genau jetzt kann der Blur-Autosave laufen (Begründung in `befehl-navigation.spec.ts`).
  for (const name of ['Verwerfen', 'Bleiben', 'Speichern und weiter']) {
    await expect(dialog.getByRole('button', { name: new RegExp(`${name}$`) })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Bleiben', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(detail);
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Offene Fassung');
  await page.evaluate(() => window.history.back());
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page).toHaveURL(liste);
  // Verworfen heißt: der Server hat die Fassung nie bekommen.
  const stand = await page.request.get(api);
  expect((await stand.json()).titel).toBe(TITEL);
});
