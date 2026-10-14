import { expect, test, type Locator, type Page } from '@playwright/test';
import { offeneAuswahl, waehleStehend } from './auswahl-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Kräfte gesammelt disponieren (LLH-1100, Spec `kraefte-disposition`), Durchstich im Browser:
 * eine Gruppe Stamm-Personen in einem Absenden in Einheit und Fahrzeug, zwei Stamm-Fahrzeuge in
 * eine Einheit. Belegt wird es auf der Seite und im Meldebild (Kräftebaum, LLH-1025): die
 * Personen stehen als Besatzung unter dem Fahrzeug, die Fahrzeuge unter der Einheit.
 * Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

const LAUF = Date.now();

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

async function einsatzMitEinheit(page: Page, einheit: string) {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Sammel-Disposition ${LAUF}`,
  });
  const einheitId = await post(page, `/api/einsaetze/${einsatzId}/einheiten`, { name: einheit });
  return { einsatzId, einheitId };
}

/**
 * Wählt im Feld `feld` des Dialogs die Option `wert`, mit `suche` vorher eingetippt. Eine
 * Mehrfachauswahl bleibt nach der Wahl offen und deckte das nächste Feld zu: ein Klick auf den
 * Dialogtitel schließt sie, wie es auch ein Mensch täte.
 */
async function waehle(dialog: Locator, feld: string, wert: string, suche?: string) {
  const eingabe = dialog.getByRole('combobox', { name: feld });
  await eingabe.click();
  if (suche) await eingabe.fill(suche);
  await waehleStehend(dialog.page(), wert);
  await dialog.locator('.ant-modal-title').click();
  await expect(offeneAuswahl(dialog.page())).toHaveCount(0);
}

test('Personal disponieren: drei Personen in einem Absenden in Einheit und auf Fahrzeug', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { einsatzId, einheitId } = await einsatzMitEinheit(page, 'Rettungsstaffel');
  const basis = `/api/einsaetze/${einsatzId}`;
  const efId = await post(page, `${basis}/fahrzeuge`, {
    adhoc: { funkrufname: `Sammel ${LAUF} 83-1`, fahrzeugtyp: 'RTW' },
  });
  const zuordnung = await page.request.put(`${basis}/einheiten/${einheitId}/fahrzeug/${efId}`);
  expect(zuordnung.ok(), await zuordnung.text()).toBe(true);
  const namen = ['Anna', 'Bernd', 'Carla'].map((v) => `Sammel ${LAUF} ${v}`);
  for (const [i, name] of namen.entries()) {
    await post(page, '/api/personal', { name, personalnummer: `S${LAUF}-${i}` });
  }

  await page.goto(`/einsaetze/${einsatzId}/personal`);
  await expect(page.getByText('Noch kein Personal disponiert')).toBeVisible();
  await page.getByRole('button', { name: 'Personal disponieren' }).click();
  const dialog = page.getByRole('dialog', { name: 'Personal disponieren' });
  for (const [i, name] of namen.entries()) {
    await waehle(dialog, 'Personen', `${name} (S${LAUF}-${i})`, name);
  }
  await waehle(dialog, 'In Einheit', 'Rettungsstaffel');
  await waehle(dialog, 'Auf Fahrzeug', `Sammel ${LAUF} 83-1 (RTW)`);
  await dialog.getByRole('button', { name: 'Disponieren' }).click();

  await expect(
    page.locator('.ant-message-notice').filter({ hasText: '3 Kräfte disponiert' }),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  const region = page.getByRole('region', { name: 'Personal im Einsatz', exact: true });
  for (const name of namen) await expect(region.getByText(name)).toBeVisible();

  // Im Meldebild sitzen alle drei unter dem Fahrzeug, das Fahrzeug unter der Einheit.
  const eps = (await (await page.request.get(`${basis}/personal`)).json()) as {
    id: number;
    name: string;
  }[];
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  const bereich = page.getByRole('region', { name: 'Meldebild' });
  const zeile = (key: string) => bereich.locator(`tr[data-row-key="${key}"]`);
  await expect(zeile(`eh-${einheitId}`)).toBeVisible();
  await page.getByRole('radio', { name: 'alles', exact: true }).click();
  await expect(zeile(`ef-${efId}`)).toHaveClass(/ant-table-row-level-1/);
  for (const ep of eps.filter((e) => namen.includes(e.name))) {
    await expect(zeile(`ep-${ep.id}`)).toHaveClass(/ant-table-row-level-2/);
  }
  expect(eps.filter((e) => namen.includes(e.name))).toHaveLength(3);
  await expect(bereich.locator('tr[data-row-key^="ofz-"]')).toHaveCount(0);
});

test('Fahrzeuge disponieren: zwei Fahrzeuge in einem Absenden in eine Einheit', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { einsatzId, einheitId } = await einsatzMitEinheit(page, 'Sanitätszug');
  const funkrufnamen = ['83-1', '83-2'].map((n) => `Sammel ${LAUF} ${n}`);
  for (const funkrufname of funkrufnamen) {
    await post(page, '/api/fahrzeuge', { funkrufname, fahrzeugtyp: 'KTW' });
  }

  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
  await page.getByRole('button', { name: 'Fahrzeuge disponieren' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fahrzeuge disponieren' });
  for (const funkrufname of funkrufnamen) {
    await waehle(dialog, 'Fahrzeuge', `${funkrufname} (KTW)`, funkrufname);
  }
  await waehle(dialog, 'In Einheit', 'Sanitätszug');
  await dialog.getByRole('button', { name: 'Disponieren' }).click();

  await expect(
    page.locator('.ant-message-notice').filter({ hasText: '2 Fahrzeuge disponiert' }),
  ).toBeVisible();
  const region = page.getByRole('region', { name: 'Fahrzeuge im Einsatz', exact: true });
  for (const funkrufname of funkrufnamen) await expect(region.getByText(funkrufname)).toBeVisible();

  const efs = (await (await page.request.get(`/api/einsaetze/${einsatzId}/fahrzeuge`)).json()) as {
    id: number;
    einheit_id: number | null;
  }[];
  expect(efs).toHaveLength(2);
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  const bereich = page.getByRole('region', { name: 'Meldebild' });
  await expect(bereich.locator(`tr[data-row-key="eh-${einheitId}"]`)).toBeVisible();
  await page.getByRole('radio', { name: 'alles', exact: true }).click();
  for (const ef of efs) {
    expect(ef.einheit_id).toBe(einheitId);
    await expect(bereich.locator(`tr[data-row-key="ef-${ef.id}"]`)).toHaveClass(
      /ant-table-row-level-1/,
    );
  }
});
