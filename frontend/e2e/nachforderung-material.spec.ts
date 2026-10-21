import { expect, test, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Material aus einer eingetroffenen Nachforderung übernehmen (LLH-1226 Teil II), Durchstich im
 * Browser: Nachforderung per API absetzen und bis „Eingetroffen“ schalten → „Als Material
 * übernehmen“ → Gerät, Ort wählen → „Übernehmen“; die Karte zeigt den Posten, das ETB die
 * Herkunft. Zweiter Weg „Weiteren Posten übernehmen“. Danach führt der Verweis an der
 * Materialzeile zurück auf die hervorgehobene Karte. Gewartet wird auf Inhaltsanker, nie auf
 * `networkidle` (LFH-385).
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
  const verweis = liste.getByRole('link', { name: `aus Nachforderung: ${BEDARF}` });
  await expect(verweis).toHaveCount(2);
  await verweis.first().click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/nachforderungen$`));
  await expect(eingetroffen.locator(`[data-nachforderung-id="${nfId}"]`)).toHaveAttribute(
    'data-hervorgehoben',
    'true',
  );
});
