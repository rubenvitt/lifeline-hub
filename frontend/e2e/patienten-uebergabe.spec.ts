import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Patientenverbleib mit Übergabe (LLH-1332, Change `y4l621ih-patientenverbleib-uebergabe`, Specs
 * `patienten-uebergabe`, `betroffene-lagedaten`, `sichtungsboard`) im Browser gegen das echte
 * Backend: ein Eigentransport mit einem Fahrzeug aus dem Einsatz ist „unterwegs“ und bleibt in der
 * Liste; die quittierte Übergabe schließt ab, die Person verschwindet aus Liste und Board und kommt
 * mit „Abgeschlossene zeigen“ zurück. Dazu das Board am Handy und am Fükw ohne seitlichen
 * Bildlauf.
 *
 * Kein `networkidle` (SSE-Strom); gewartet wird auf Inhaltsanker.
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

async function seedePerson(page: Page, einsatzId: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, { data });
  expect(antwort.ok(), `Seeding Person: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

async function seedeFahrzeug(page: Page, einsatzId: string, funkrufname: string) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/fahrzeuge`, {
    data: { adhoc: { funkrufname } },
  });
  expect(antwort.ok(), `Seeding Fahrzeug: ${antwort.status()}`).toBeTruthy();
}

/** Seitlicher Überlauf der Seite in Pixeln (0 heißt: kein seitlicher Bildlauf). */
async function seitlicherUeberlauf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test('Eigentransport ist unterwegs, die quittierte Übergabe schließt ab', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Übergabe ${Date.now()}`);
  await seedeFahrzeug(page, einsatzId, '1/83-1');
  const personId = await seedePerson(page, einsatzId, {
    name: 'Übergabetest',
    sichtung: 'sk2',
  });

  // Verbleib im Patientenkopf: Transport mit dem Fahrzeug aus dem Einsatz.
  await page.goto(`/einsaetze/${einsatzId}/personen/${personId}`);
  const kopf = page.getByRole('region', { name: 'Patientenkopf' });
  await kopf.getByRole('button', { name: 'Verbleib erfassen' }).click();
  const paneel = page.getByRole('region', { name: 'Verbleib erfassen' });
  await paneel.getByRole('combobox', { name: 'Art' }).click();
  await page.getByTitle('Transport', { exact: true }).click();
  await paneel.getByRole('combobox', { name: /Rettungsmittel/ }).fill('1/83');
  await page.getByTitle('1/83-1').click();
  await expect(paneel).toContainText('Eigentransport');
  await paneel.getByLabel('Ziel').fill('KH Mitte');
  await paneel.getByRole('button', { name: 'Verbleib erfassen' }).click();
  await expect(kopf).toContainText('Eigentransport → KH Mitte (1/83-1)');

  // Unterwegs: die Person bleibt in der Liste.
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await expect(page.getByText('Übergabetest')).toBeVisible();
  await expect(page.getByText('Abgeschlossene zeigen (0)')).toBeVisible();

  // Übergabe quittieren im Kopf.
  await page.goto(`/einsaetze/${einsatzId}/personen/${personId}`);
  await kopf.getByRole('button', { name: 'Übergabe quittieren' }).click();
  const uebergabe = page.getByRole('region', { name: 'Übergabe quittieren' });
  await expect(uebergabe.getByLabel('Ziel')).toHaveValue('KH Mitte');
  await uebergabe.getByRole('button', { name: 'Übergabe quittieren' }).click();
  await expect(kopf).toContainText('übergeben → KH Mitte (1/83-1)');

  // Abgeschlossen: weg aus Liste und Board, mit dem Schalter wieder da.
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  const schalter = page.getByRole('checkbox', { name: 'Abgeschlossene zeigen (1)' });
  await expect(schalter).toBeVisible();
  await expect(page.getByText('Übergabetest')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Sichtungsraster' }).click();
  await expect(page.getByTestId('sichtungsboard')).toBeVisible();
  await expect(page.getByText('Übergabetest')).toHaveCount(0);
  await schalter.check();
  await expect(page.getByTestId('board-karte').filter({ hasText: 'Übergabetest' })).toBeVisible();
});

test('Sichtungsboard am Handy und am Fükw ohne seitlichen Bildlauf', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Board ${Date.now()}`);
  for (const [name, sichtung] of [
    ['Rotmann, Rita', 'sk1'],
    ['Gelbig, Gustav', 'sk2'],
    ['Grünwald-Langname, Gerlinde-Mareike', 'sk3'],
  ] as const) {
    await seedePerson(page, einsatzId, { name, sichtung });
  }

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/einsaetze/${einsatzId}/personen?ansicht=raster`);
    const board = page.getByTestId('sichtungsboard');
    await expect(board.getByTestId('board-karte')).toHaveCount(3);
    expect(await seitlicherUeberlauf(page), `${viewport.width} px: kein seitlicher Bildlauf`).toBe(
      0,
    );
    // Alle Kategorien stehen, auch leere.
    await expect(board.getByTestId('board-spalte')).toHaveCount(7);
  }
});
