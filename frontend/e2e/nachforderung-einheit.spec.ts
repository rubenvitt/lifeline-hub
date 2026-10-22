import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Eine eingetroffene Nachforderung als Einheit übernehmen und in den Bereitstellungsraum ihres
 * Ziels buchen (LLH-1383), Durchstich im Browser: „2× RTW“ mit Ziel BR Nord und Zusage „83-1“,
 * „83-2“ per API bis „Unterwegs“ → „Eintreffen melden“ → „Als Einheit übernehmen“ (Rufnamen und
 * Haken vorbelegt) → „Übernehmen“. Danach stehen beide Einheiten im Einsatz und im Raum, die Karte
 * nennt sie mit Sprung, das Detail der Einheit verweist zurück auf die hervorgehobene Karte.
 * Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

async function post<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

async function get<T>(page: Page, pfad: string): Promise<T> {
  const antwort = await page.request.get(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
  return (await antwort.json()) as T;
}

interface EinheitDraht {
  id: number;
  name: string;
  typ_label?: string | null;
  aktueller_br_id?: number | null;
  nachforderung_id?: number | null;
}

async function seed(page: Page) {
  const { id } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Nachforderung Einheit ${Date.now()}`,
  });
  const einsatzId = String(id);
  const basis = `/api/einsaetze/${einsatzId}`;
  // Der Typ „RTW“ steht im Katalog (Vorbelegung des Typs aus der Art, D4).
  const typen = await get<{ label: string }[]>(page, '/api/einheit-typen');
  if (!typen.some((t) => t.label === 'RTW')) {
    await post(page, '/api/einheit-typen', { label: 'RTW', sortier: 90 });
  }
  const br = await post(page, `${basis}/bereitstellungsraeume`, { bezeichnung: 'Nord' });
  await post(page, `${basis}/bereitstellungsraeume/${br.id}/status`, { status: 'aktiv' });
  const nf = await post(page, `${basis}/nachforderungen`, {
    art: 'RTW',
    anzahl: 2,
    adressat_kategorie: 'leitstelle',
    ziel_br_id: br.id,
  });
  await post(page, `${basis}/nachforderungen/${nf.id}/zusage`, { rufnamen: ['83-1', '83-2'] });
  await post(page, `${basis}/nachforderungen/${nf.id}/status`, { status: 'unterwegs' });
  return { einsatzId, nfId: nf.id, brId: br.id };
}

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test('Eintreffen melden und als Einheit übernehmen mit Ziel BR Nord (LLH-1383)', async ({
  page,
}) => {
  const { einsatzId, nfId, brId } = await seed(page);
  await page.goto(`/einsaetze/${einsatzId}/nachforderungen`);
  const unterwegs = page.locator('[data-lfh="board-spalte"][data-stufe="unterwegs"]');
  await unterwegs
    .locator(`[data-nachforderung-id="${nfId}"]`)
    .getByRole('button', { name: 'Eintreffen melden' })
    .click();

  const eingetroffen = page.locator('[data-lfh="board-spalte"][data-stufe="eingetroffen"]');
  const karte = eingetroffen.locator(`[data-nachforderung-id="${nfId}"]`);
  await karte.getByRole('button', { name: 'Als Einheit übernehmen' }).click();
  const dialog = page.getByRole('dialog', { name: '„RTW“ als Einheit übernehmen' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
  // Vorbelegt: die Rufnamen der Zusage, der Typ aus der Art, der Haken für den Raum.
  await expect(dialog).toContainText('83-1');
  await expect(dialog).toContainText('83-2');
  await expect(dialog.getByRole('checkbox', { name: 'In BR Nord eintragen' })).toBeChecked();
  await expect(dialog.getByText('RTW', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(karte).toContainText('Als Einheit übernommen: 83-1 ↗, 83-2 ↗');
  await expect(karte.getByRole('button', { name: 'Als Material übernehmen' })).toHaveCount(0);

  // Im Einsatz und im Raum, beide mit Herkunft.
  const einheiten = await get<EinheitDraht[]>(page, `/api/einsaetze/${einsatzId}/einheiten`);
  const neu = einheiten.filter((e) => e.nachforderung_id === nfId);
  expect(neu.map((e) => e.name).sort()).toEqual(['83-1', '83-2']);
  for (const e of neu) {
    expect(e.aktueller_br_id).toBe(brId);
    expect(e.typ_label).toBe('RTW');
  }

  // Über den Sprung ins Detail der Einheit und von dort zurück auf die hervorgehobene Karte.
  await karte.getByRole('link', { name: '83-1' }).click();
  const herkunft = page.getByRole('link', { name: `aus Nachforderung #${nfId}` });
  await expect(herkunft).toBeVisible();
  await herkunft.click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/nachforderungen$`));
  await expect(eingetroffen.locator(`[data-nachforderung-id="${nfId}"]`)).toHaveAttribute(
    'data-hervorgehoben',
    'true',
  );
});
