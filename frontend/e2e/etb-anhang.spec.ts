import { expect, test, type Page } from '@playwright/test';

/**
 * ETB-Anhänge Ende zu Ende (LFH-117): Datei wählen → Text → Enter → der Eintrag steht mit
 * Download-Verweis in der Zeitachse → der Klick lädt die Datei über die ETB-Route.
 *
 * Dazu die zwei Sperren, die nur im echten Stack zusammen stehen: der Pfad eines Anhangs
 * aus Einsatz A ist über Einsatz B 404, und die generische, modul-lose Route
 * `/anhaenge/{aid}` liefert einen ETB-Anhang nicht aus. Und offline: „Anhang" ist gesperrt,
 * ein Text-Eintrag geht trotzdem in die Queue.
 *
 * Bedienbarkeit wird per KLICK belegt, nicht per `toBeVisible()` (CLAUDE.md, LFH-355):
 * „Anhang" öffnet den Dateidialog über `filechooser`, der Verweis löst ein `download` aus.
 *
 * SEEDING PER `page.request`: die Session ist Cookie-basiert, `page.request` teilt den
 * Cookie-Jar des Kontexts.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1366, height: 768 };
const JPG = Buffer.from('JPEGDATEN-LFH-117');

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzPerApi(page: Page, bezeichnung: string): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(antwort.ok(), `Einsatz anlegen: ${antwort.status()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

async function zumEtb(page: Page, einsatzId: number) {
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByPlaceholder(/Inhalt/)).toBeVisible();
}

test('erfasst einen Eintrag mit Anhang und lädt ihn über die ETB-Route', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzA = await einsatzPerApi(page, `E2E ETB-Anhang ${Date.now()}`);
  await zumEtb(page, einsatzA);

  // „Anhang" öffnet den Dateidialog — der Klick selbst ist der Beleg der Bedienbarkeit.
  const [waehler] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Anhang', exact: true }).click(),
  ]);
  expect(waehler.isMultiple()).toBe(true);
  await waehler.setFiles({ name: 'Lagefoto Süd.jpg', mimeType: 'image/jpeg', buffer: JPG });
  const liste = page.getByRole('list', { name: 'Gewählte Anhänge' });
  await expect(liste).toContainText('Lagefoto Süd.jpg');

  const feld = page.getByPlaceholder(/Inhalt/);
  await feld.fill('Foto der Schadenstelle');
  await feld.press('Enter');

  const verweis = page
    .locator('[data-lfh="etb-zeitachse"]')
    .getByRole('link', { name: /^Lagefoto Süd\.jpg, .*, Anhang zu Nr\. 1 herunterladen$/ });
  await expect(verweis).toBeVisible();
  await expect(liste, 'nach dem Erfassen ist die Liste leer').toHaveCount(0);

  const [download] = await Promise.all([page.waitForEvent('download'), verweis.click()]);
  expect(download.suggestedFilename()).toBe('Lagefoto Süd.jpg');

  const href = await verweis.getAttribute('href');
  const treffer = href?.match(/^\/api\/einsaetze\/(\d+)\/etb\/(\d+)\/anhaenge\/(\d+)$/);
  expect(treffer, `Download-Pfad unter dem ETB-Präfix: ${href}`).not.toBeNull();
  const [, , eintragId, anhangId] = treffer!;

  // Derselbe Anhang über einen zweiten Einsatz: 404.
  const einsatzB = await einsatzPerApi(page, `E2E ETB-Anhang B ${Date.now()}`);
  const fremd = await page.request.get(
    `/api/einsaetze/${einsatzB}/etb/${eintragId}/anhaenge/${anhangId}`,
  );
  expect(fremd.status()).toBe(404);

  // Die generische Route liefert einen ETB-Anhang nicht aus.
  const generisch = await page.request.get(`/api/einsaetze/${einsatzA}/anhaenge/${anhangId}`);
  expect(generisch.status()).toBe(404);

  // Gegenprobe: über die ETB-Route kommt die Datei.
  const richtig = await page.request.get(href!);
  expect(richtig.status()).toBe(200);
  expect(Buffer.from(await richtig.body())).toEqual(JPG);
});

test('ohne Netz ist „Anhang" gesperrt, ein Text-Eintrag landet als ausstehend', async ({
  page,
  context,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatz = await einsatzPerApi(page, `E2E ETB-Anhang offline ${Date.now()}`);
  await zumEtb(page, einsatz);

  await context.setOffline(true);
  try {
    await expect(page.getByRole('button', { name: 'Anhang', exact: true })).toBeDisabled();
    await expect(
      page.getByText('Anhänge brauchen eine Verbindung. Der Text lässt sich trotzdem erfassen.'),
    ).toBeVisible();

    const feld = page.getByPlaceholder(/Inhalt/);
    await feld.fill('Funkmeldung ohne Netz');
    await feld.press('Enter');
    const ausstehend = page.locator('.etb-ausstehend');
    await expect(ausstehend).toContainText('Funkmeldung ohne Netz');
    await expect(ausstehend).toContainText('wird gesendet');
  } finally {
    await context.setOffline(false);
  }
});
