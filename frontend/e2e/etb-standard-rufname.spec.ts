import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Standard-Rufname und Von/An-Pflicht im ETB (LFH-894, Spec `etb-absender-empfaenger`). Der
 * Admin trägt für den ganzen Lauf einen Standard (`globale-vorbereitung.ts`); die Abfrage sieht
 * deshalb nur eine frisch angelegte Person.
 */

async function einsatzAnlegen(page: Page): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Rufname ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz anlegen: ${antwort.status()}`).toBe(true);
  return String(((await antwort.json()) as { id: number }).id);
}

function abfrage(page: Page) {
  return page.getByRole('group', { name: 'Mit welchem Rufnamen schreibst du ins ETB?' });
}

test('ohne Standard fragt das ETB, hält den Eintrag auf und sendet danach mit dem Rufnamen', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  await expect(abfrage(page)).toBeVisible();
  const feld = page.getByPlaceholder('Inhalt …');
  const inhalt = `Pegel steigt ${Date.now()}`;

  // Die Pflicht: ohne Rufnamen geht nichts an den Server, der Text bleibt stehen.
  const gesendet: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/api/einsaetze/${einsatzId}/etb`)) {
      gesendet.push(r.url());
    }
  });
  await feld.fill(inhalt);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  await expect(page.getByText('Von fehlt: Rufname oben festlegen oder /von setzen.')).toBeVisible();
  expect(gesendet).toEqual([]);
  await expect(feld).toHaveValue(inhalt);

  await abfrage(page).getByRole('combobox', { name: 'Rufname für Von und An' }).fill('Florian 4/1');
  await abfrage(page).getByRole('button', { name: 'Übernehmen' }).click();
  await expect(abfrage(page)).toHaveCount(0);
  await expect(page.getByText('Von: Florian 4/1')).toBeVisible();
  await expect(page.getByText('An: Florian 4/1')).toBeVisible();

  const antwort = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/api/einsaetze/${einsatzId}/etb`),
  );
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  const eintrag = await antwort;
  expect(eintrag.status()).toBe(201);
  expect(await eintrag.json()).toMatchObject({ inhalt, von: 'Florian 4/1', an: 'Florian 4/1' });
  const zeile = page.getByTestId('etb-ereigniszeile').filter({ hasText: inhalt });
  await expect(zeile).toContainText('Florian 4/1 → Florian 4/1');

  // Der Standard liegt am Server: nach dem Neuladen keine Abfrage, die Chips stehen wieder.
  await page.reload();
  await expect(page.getByText('Von: Florian 4/1')).toBeVisible();
  await expect(abfrage(page)).toHaveCount(0);
});

test('als Beobachter keine Abfrage', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  // Vorbedingung: die Seite steht, die Erfassung fehlt (kein Schreibrecht).
  await expect(page.getByRole('heading', { name: 'Einsatztagebuch' })).toBeVisible();
  await expect(page.getByPlaceholder('Inhalt …')).toHaveCount(0);
  await expect(page.getByRole('group', { name: /Rufnamen/ })).toHaveCount(0);
});
