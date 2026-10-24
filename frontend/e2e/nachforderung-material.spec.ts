import { expect, test, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Material aus einer eingetroffenen Nachforderung übernehmen (LLH-1226 Teil II), Durchstich im
 * Browser: Nachforderung per API absetzen und bis „Eingetroffen“ schalten → „Als Material
 * übernehmen“ → Gerät, Ort wählen → „Übernehmen“; die Karte zeigt den Posten, das ETB die
 * Herkunft. Zweiter Weg „Weiteren Posten übernehmen“. Danach führt der Verweis an der
 * Materialzeile zurück auf die hervorgehobene Karte. Dazu der Weg für schon erfasstes Material:
 * „Erfassten Posten zuordnen …“ (LLH-1259); „Material ↗“ springt dann auf den Posten (LLH-1260).
 * Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

const BEDARF = '3 Tauchpumpen für Keller Hauptstraße';

async function post<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

async function etbInhalte(page: Page, einsatzId: string): Promise<string[]> {
  const etb = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
  return ((await etb.json()) as { inhalt: string }[]).map((x) => x.inhalt);
}

async function seed(page: Page) {
  const { id } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Nachforderung Material ${Date.now()}`,
  });
  const einsatzId = String(id);
  const basis = `/api/einsaetze/${einsatzId}`;
  await post(page, `${basis}/einheiten`, { name: 'Staffel A' });
  const nf = await post(page, `${basis}/nachforderungen`, {
    art: 'Tauchpumpe',
    bezeichnung: BEDARF,
    anzahl: 3,
    adressat_kategorie: 'leitstelle',
  });
  for (const status of ['zugesagt', 'unterwegs', 'eingetroffen']) {
    await post(page, `${basis}/nachforderungen/${nf.id}/status`, { status });
  }
  return { einsatzId, nfId: nf.id };
}

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test('eingetroffene Tauchpumpen als Material übernehmen, ergänzen und über den Verweis zurück (LLH-1226)', async ({
  page,
}) => {
  const { einsatzId, nfId } = await seed(page);
  await page.goto(`/einsaetze/${einsatzId}/nachforderungen`);
  // Das Board (LLH-1078) zeigt die eingetroffene Karte in ihrer Spalte, ohne Umschalten.
  const eingetroffen = page.locator('[data-lfh="board-spalte"][data-stufe="eingetroffen"]');
  const karte = eingetroffen.locator(`[data-nachforderung-id="${nfId}"]`);
  await expect(karte).toContainText(BEDARF);

  // Erste Übernahme: vorbelegt mit Menge 3 als Verbrauchsgut; die Person führt ein Gerät.
  await karte.getByRole('button', { name: 'Als Material übernehmen' }).click();
  const dialog = page.getByRole('dialog', { name: '„Tauchpumpe“ als Material übernehmen' });
  // Erst nach der Zoom-Animation eingeben: sonst fängt der aufgehende Dialog den Klick ab.
  await expect(dialog).toBeVisible();
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
  await expect(dialog.getByRole('spinbutton', { name: 'Menge' })).toHaveValue('3');
  await expect(dialog.getByRole('radio', { name: 'Verbrauchsgut' })).toBeChecked();
  await dialog.getByRole('radio', { name: 'Gerät' }).click();
  await expect(dialog.getByRole('spinbutton', { name: 'Menge' })).toHaveValue('1');
  await waehleIn(dialog.getByRole('combobox', { name: 'Ort' }), 'Staffel A');
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(karte).toContainText('Tauchpumpe · 1 · Staffel A');
  await expect(karte).toContainText('übernommen 1 von 3');
  await expect
    .poll(() => etbInhalte(page, einsatzId))
    .toContain(
      `Material «Tauchpumpe» (×1) disponiert, Ort Einheit «Staffel A», aus Nachforderung «${BEDARF}»`,
    );

  // Zweiter Weg: bewusst ergänzen, Menge ist der Rest.
  await karte.getByRole('button', { name: 'Weiteren Posten übernehmen' }).click();
  const weiter = page.getByRole('dialog', { name: 'Weiteren Posten „Tauchpumpe“ übernehmen' });
  await expect(weiter).toBeVisible();
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
  await expect(weiter.getByRole('spinbutton', { name: 'Menge' })).toHaveValue('2');
  await weiter.getByRole('radio', { name: 'Gerät' }).click();
  await weiter.getByRole('button', { name: 'Weiteren Posten übernehmen' }).click();
  await expect(weiter).toHaveCount(0);
  await expect(karte).toContainText('Tauchpumpe · 1 · ohne Ort');
  await expect(karte).toContainText('übernommen 2 von 3');

  // In die Materialliste und über den Verweis zurück auf die hervorgehobene Karte.
  await karte.getByRole('link', { name: 'Material' }).click();
  const liste = page.getByRole('region', { name: 'Material im Einsatz', exact: true });
  // Der Verweis nennt die Nachforderung mit Kurzname und Details (LLH-1089).
  const verweis = liste.getByRole('link', {
    name: `aus Nachforderung: 3× Tauchpumpe — ${BEDARF}`,
  });
  await expect(verweis).toHaveCount(2);
  await verweis.first().click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/nachforderungen$`));
  await expect(eingetroffen.locator(`[data-nachforderung-id="${nfId}"]`)).toHaveAttribute(
    'data-hervorgehoben',
    'true',
  );
});

test('vorhandenen Posten einer eingetroffenen Nachforderung zuordnen: die Karte zählt ihn, die Rücknahme ist gesperrt (LLH-1259)', async ({
  page,
}) => {
  const { einsatzId, nfId } = await seed(page);
  const basis = `/api/einsaetze/${einsatzId}`;
  // Das Material stand schon von Hand im Einsatz, bevor die Nachforderung eintraf.
  const posten = await post(page, `${basis}/material`, {
    adhoc: { bezeichnung: 'Tauchpumpe THW' },
    menge: 1,
  });
  await page.goto(`/einsaetze/${einsatzId}/nachforderungen`);
  const eingetroffen = page.locator('[data-lfh="board-spalte"][data-stufe="eingetroffen"]');
  const karte = eingetroffen.locator(`[data-nachforderung-id="${nfId}"]`);
  await expect(karte).toContainText(BEDARF);

  await karte.getByRole('button', { name: 'Erfassten Posten zuordnen …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Erfassten Posten „Tauchpumpe“ zuordnen' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
  await waehleIn(dialog.getByRole('combobox', { name: 'Posten' }), 'Tauchpumpe THW · 1 · ohne Ort');
  const antwort = page.waitForResponse(
    (r) =>
      r.url().endsWith(`${basis}/material/${posten.id}/nachforderung`) &&
      r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Zuordnen' }).click();
  expect((await antwort).status()).toBe(200);
  await expect(dialog).toHaveCount(0);

  // Die Karte zählt den Posten wie eine Übernahme; kein zweiter Posten ist entstanden.
  await expect(karte).toContainText('Tauchpumpe THW · 1 · ohne Ort');
  await expect(karte).toContainText('übernommen 1 von 3');
  await expect(karte.getByRole('button', { name: 'Weiteren Posten übernehmen' })).toBeVisible();
  const material = await page.request.get(`${basis}/material`);
  expect(((await material.json()) as unknown[]).length).toBe(1);
  await expect
    .poll(() => etbInhalte(page, einsatzId))
    .toContain(`Material «Tauchpumpe THW» (×1) mit Nachforderung «${BEDARF}» verknüpft`);

  // Die Rücknahme auf „Unterwegs“ ist gesperrt, wie nach einer Übernahme.
  const ruecknahme = await page.request.post(`${basis}/nachforderungen/${nfId}/status`, {
    data: { status: 'unterwegs' },
  });
  expect(ruecknahme.status()).toBe(422);
  expect(await ruecknahme.json()).toMatchObject({
    error: 'Aus der Nachforderung ist Material übernommen',
  });
  await page.reload();
  await expect(eingetroffen.locator(`[data-nachforderung-id="${nfId}"]`)).toContainText(
    'übernommen 1 von 3',
  );

  // Ein Posten im Einsatz: „Material ↗“ springt auf seine Zeile und hebt sie hervor (LLH-1260).
  await karte.getByRole('link', { name: 'Material' }).click();
  const zeile = page
    .getByRole('region', { name: 'Material im Einsatz', exact: true })
    .locator(`[data-row-key="${posten.id}"]`);
  await expect(zeile).toHaveClass(/zeile-hervorgehoben/);
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/material$`));
});
