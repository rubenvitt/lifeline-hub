import { expect, test, type Page } from '@playwright/test';
import { einsatzdatenPfad } from '../src/routing/deeplinks';

/**
 * Eigene Führungsstelle als Ort (LFH-1181, Spec `einsatz-fuehrungsstelle`) im echten Browser:
 * Art, Bezeichnung und Standort „wie Einsatzort“ zeilenweise speichern, am Stand des Servers
 * geprüft; dasselbe bei 390 px, wo das Paneel unter der Etikettspalte stapelt.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmeldenUndAnlegen(page: Page): Promise<number> {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Führungsstelle ${Date.now()}` },
  });
  expect(antwort.ok()).toBeTruthy();
  const id = (await antwort.json()).id as number;
  const ort = await page.request.patch(`/api/einsaetze/${id}`, {
    data: { einsatzort: 'Industriestraße 4', einsatzort_lat: 52.103, einsatzort_lon: 9.356 },
  });
  expect(ort.ok()).toBeTruthy();
  return id;
}

async function fuehrungsstelle(page: Page, id: number): Promise<Record<string, unknown>> {
  return (await (await page.request.get(`/api/einsaetze/${id}/fuehrungsstelle`)).json()) as Record<
    string,
    unknown
  >;
}

for (const breite of [1366, 390]) {
  test(`LFH-1181: Art, Bezeichnung und Standort „wie Einsatzort“ speichern (${breite} px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: breite, height: 900 });
    const id = await anmeldenUndAnlegen(page);
    await page.goto(einsatzdatenPfad(id));
    const paneel = page.getByRole('region', { name: 'Eigene Führungsstelle' });

    await paneel.getByRole('radio', { name: 'ortsfest' }).click();
    await expect.poll(async () => (await fuehrungsstelle(page, id)).art).toBe('ortsfest');
    // Ortsfest: die Führungsfahrzeuge stehen eingeklappt mit ihrer Anzahl.
    await expect(paneel.getByRole('button', { name: /kein Führungsfahrzeug/ })).toBeVisible();

    await paneel.getByRole('button', { name: 'Bezeichnung eintragen', exact: true }).click();
    const bezeichnung = paneel.getByRole('textbox', { name: 'Bezeichnung', exact: true });
    await bezeichnung.fill('TEL Rathaus');
    await bezeichnung.press('Enter');
    await expect
      .poll(async () => (await fuehrungsstelle(page, id)).bezeichnung)
      .toBe('TEL Rathaus');

    await paneel.getByRole('button', { name: 'Standort eintragen', exact: true }).click();
    await paneel.getByRole('button', { name: 'wie Einsatzort', exact: true }).click();
    await paneel.getByRole('button', { name: 'Standort speichern', exact: true }).click();
    await expect
      .poll(async () => fuehrungsstelle(page, id))
      .toMatchObject({
        standort_adresse: 'Industriestraße 4',
        standort_lat: 52.103,
        standort_lon: 9.356,
      });

    // Nach dem Neuladen steht alles aus dem Server da.
    await page.reload();
    await expect(
      paneel.getByRole('button', { name: 'Standort bearbeiten', exact: true }),
    ).toBeVisible();
    await expect(paneel.getByText('TEL Rathaus')).toBeVisible();
    await expect(paneel.getByRole('radio', { name: 'ortsfest' })).toBeChecked();
    // Kein waagerechter Überlauf der Seite.
    const ueber = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(ueber).toBeLessThanOrEqual(0);
  });
}
