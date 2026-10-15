import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Material am Ort (LLH-1225 Teil II), Durchstich im Browser: derselbe Baustein an UHS, Einheit,
 * Fahrzeug und Bereitstellungsraum, ein Schreibweg. Ein Posten der Einheit wird im UHS-Reiter
 * zugeordnet (die Einheit-Ansicht zeigt ihn nicht mehr, das ETB nennt alt und neu), Decken an der
 * UHS ausgegeben, ein Stromerzeuger auf ein Fahrzeug geladen (Block „Beladung“ und Meldebild),
 * Material im geplanten Bereitstellungsraum zugeordnet und gelöst. Gewartet wird auf
 * Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

async function post<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

async function etbInhalte(page: Page, einsatzId: number): Promise<string[]> {
  const etb = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
  return ((await etb.json()) as { inhalt: string }[]).map((x) => x.inhalt);
}

async function seed(page: Page) {
  const { id: einsatzId } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Material am Ort ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}`;
  const einheit = await post(page, `${basis}/einheiten`, { name: 'Staffel A' });
  const fahrzeug = await post(page, `${basis}/fahrzeuge`, { adhoc: { funkrufname: 'Florian 1' } });
  const zuordnung = await page.request.put(
    `${basis}/einheiten/${einheit.id}/fahrzeug/${fahrzeug.id}`,
  );
  expect(zuordnung.ok(), `Fahrzeug zuordnen: ${await zuordnung.text()}`).toBe(true);
  const uhs = await post(page, `${basis}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'Turnhalle',
  });
  const br = await post(page, `${basis}/bereitstellungsraeume`, { bezeichnung: 'BR Nord' });
  await post(page, `${basis}/material`, {
    adhoc: { bezeichnung: 'Trage' },
    einheit_id: einheit.id,
  });
  await post(page, `${basis}/material`, { adhoc: { bezeichnung: 'Stromerzeuger' } });
  await post(page, `${basis}/material`, { adhoc: { bezeichnung: 'Lichtmast' } });
  await post(page, `${basis}/material`, {
    adhoc: { bezeichnung: 'Wolldecke' },
    menge: 20,
    art: 'verbrauchsgut',
    uhs_id: uhs.id,
  });
  return { einsatzId, einheitId: einheit.id, uhsId: uhs.id, brId: br.id };
}

const zeile = (page: Page, bezeichnung: string) =>
  page.locator('[data-lfh="material-am-ort-zeile"]').filter({ hasText: bezeichnung });

/**
 * Wählt im Auswahlfeld „Material zuordnen“ einen Posten. Geklickt wird der sichtbare Eintrag (sein
 * `title` ist das Etikett); antds `role="option"` liegt in einer unsichtbaren Zugänglichkeitsliste.
 */
async function zuordnen(bereich: Locator, page: Page, etikett: string) {
  await bereich.getByRole('combobox', { name: 'Material zuordnen' }).click();
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .and(page.getByTitle(etikett, { exact: true }))
    .click();
}

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test('UHS-Reiter: Posten der Einheit zuordnen und Decken ausgeben; Einheit und ETB folgen (LLH-1225)', async ({
  page,
}) => {
  const s = await seed(page);
  await page.goto(`/einsaetze/${s.einsatzId}/unfallhilfsstellen/${s.uhsId}`);
  await expect(zeile(page, 'Wolldecke')).toContainText('20');
  const main = page.locator('main');

  // Zuordnen von einem anderen Ort: das Etikett nennt ihn, ein PATCH hängt um.
  await zuordnen(main, page, 'Trage · 1 · Staffel A');
  await expect(page.getByText('Trage zugeordnet')).toBeVisible();
  await expect(zeile(page, 'Trage')).toBeVisible();

  // Ausgeben an der UHS: die Zeile nennt den Rest.
  await zeile(page, 'Wolldecke').getByRole('button', { name: 'Wolldecke ausgeben' }).click();
  const ausgeben = page.getByRole('dialog', { name: 'Wolldecke ausgeben' });
  await ausgeben.getByRole('spinbutton', { name: 'Menge ausgeben' }).fill('5');
  await ausgeben.getByRole('button', { name: 'Ausgeben' }).click();
  await expect(ausgeben).toHaveCount(0);
  await expect(zeile(page, 'Wolldecke')).toContainText('15 von 20 übrig');

  await page.goto(`/einsaetze/${s.einsatzId}/einheiten/${s.einheitId}`);
  const paneel = page.getByRole('region', { name: 'Material' });
  await expect(paneel.getByText('Kein Material', { exact: true })).toBeVisible();
  await expect(zeile(page, 'Trage')).toHaveCount(0);
  await expect
    .poll(async () => (await etbInhalte(page, s.einsatzId)).join('\n'))
    .toMatch(/«Trage».*Einheit «Staffel A» → UHS «Turnhalle»/);
});

test('Fahrzeug: Stromerzeuger laden – Block „Beladung“ und Meldebild „Beladung · 1 Posten“ (LLH-1225)', async ({
  page,
}) => {
  const s = await seed(page);
  await page.goto(`/einsaetze/${s.einsatzId}/fahrzeuge`);
  await page.getByRole('button', { name: 'Besatzung zu Florian 1' }).click();
  const block = page.locator('[data-lfh="beladung-block"]');
  await expect(block.getByText('Keine Beladung')).toBeVisible();
  await zuordnen(block, page, 'Stromerzeuger · 1');
  await expect(zeile(page, 'Stromerzeuger')).toBeVisible();
  await expect(block).toContainText('1 Posten');

  await page.goto(`/einsaetze/${s.einsatzId}/kraefteuebersicht`);
  await page.getByRole('radio', { name: 'alles', exact: true }).click();
  const beladung = page.locator('main tr').filter({ hasText: /^Beladung/ });
  await expect(beladung).toHaveCount(1);
  await expect(beladung).toContainText(/Beladung\s*· 1 Posten/);
  await expect(page.locator('main tr').filter({ hasText: 'Stromerzeuger' })).toHaveCount(1);
});

test('Bereitstellungsraum: im geplanten Raum zuordnen und lösen (LLH-1225)', async ({ page }) => {
  const s = await seed(page);
  await page.goto(`/einsaetze/${s.einsatzId}/bereitstellungsraeume/${s.brId}`);
  const sektion = page.getByTestId('br-material');
  await expect(sektion.getByText('Kein Material', { exact: true })).toBeVisible();
  await zuordnen(sektion, page, 'Lichtmast · 1');
  await expect(zeile(page, 'Lichtmast')).toBeVisible();
  await zeile(page, 'Lichtmast').getByRole('button', { name: 'Lichtmast lösen' }).click();
  await expect(page.getByText('Lichtmast gelöst')).toBeVisible();
  await expect(zeile(page, 'Lichtmast')).toHaveCount(0);
  await expect(sektion.getByText('Kein Material', { exact: true })).toBeVisible();
});
