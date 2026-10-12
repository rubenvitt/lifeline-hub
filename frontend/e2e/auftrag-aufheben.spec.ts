import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Auftrag aufheben und berichtigen (LLH-1098, Spec `auftrag-aufheben-berichtigen`): erteilen,
 * über das Menü im Detail mit Grund aufheben (Change oxgob5gk: Handlungen stehen im Detail, nicht
 * an der Karte), danach steht er unter „Abgeschlossen“ mit Etikett und Grund. Berichtigen vor der ersten Quittung schreibt die Anordnung „… geändert: …“ ins ETB.
 * Als Beobachter fehlen beide Handlungen (`e2e/AGENTS.md`, Rollen).
 */

/** Das Detailpaneel des gewählten Auftrags (`components/ListeDetail.tsx`). */
const detail = (page: Page) => page.locator('[data-lfh="liste-detail-detail"]');

async function einsatzMitAuftrag(page: Page): Promise<{ einsatzId: string; nr: number }> {
  const e = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Auftragsrücknahme ${Date.now()}` },
  });
  expect(e.ok(), `POST /api/einsaetze: ${e.status()} ${await e.text()}`).toBe(true);
  const einsatzId = String(((await e.json()) as { id: number }).id);
  const a = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
    data: {
      auftrag_text: 'Sandsäcke zum Deich bringen',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'Logistiktrupp' }],
    },
  });
  expect(a.ok(), `POST …/auftraege: ${a.status()}`).toBe(true);
  return { einsatzId, nr: ((await a.json()) as { lfd_nr: number }).lfd_nr };
}

test.describe('Auftrag aufheben und berichtigen', () => {
  test('aufheben mit Grund, danach unter „Abgeschlossen“', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, nr } = await einsatzMitAuftrag(page);
    await page.goto(`/einsaetze/${einsatzId}/auftraege`);
    await expect(detail(page).getByText('Sandsäcke zum Deich bringen')).toBeVisible();

    await page.getByRole('button', { name: `Aktionen zu Auftrag #${nr}` }).click();
    await page.getByRole('menuitem', { name: 'Auftrag aufheben' }).click();
    const dialog = page.getByRole('dialog', { name: `Auftrag #${nr} aufheben` });
    await dialog.getByLabel('Grund').fill('Material kommt vom Bauhof');
    await dialog.getByRole('button', { name: 'Auftrag aufheben' }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByText('Abgeschlossen (1)').click();
    const karte = page.locator('[data-auftrag-id]');
    await expect(karte.getByText('Aufgehoben', { exact: true })).toBeVisible();
    await expect(detail(page).getByText('Grund: Material kommt vom Bauhof')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quittieren' })).toHaveCount(0);
  });

  test('berichtigen schreibt die Änderung ins ETB', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, nr } = await einsatzMitAuftrag(page);
    await page.goto(`/einsaetze/${einsatzId}/auftraege`);
    await page.getByRole('button', { name: `Aktionen zu Auftrag #${nr}` }).click();
    await page.getByRole('menuitem', { name: 'Berichtigen' }).click();
    const dialog = page.getByRole('dialog', { name: `Auftrag #${nr} berichtigen` });
    await dialog.getByLabel('Auftrag / Was').fill('Sandsäcke zum Deich Nord bringen');
    await dialog.getByRole('button', { name: 'Berichtigung speichern' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(detail(page).getByText('Sandsäcke zum Deich Nord bringen')).toBeVisible();

    const etb = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
    const inhalte = ((await etb.json()) as { inhalt: string }[]).map((x) => x.inhalt);
    expect(inhalte).toContain(
      `Auftrag #${nr} geändert: Auftragstext „Sandsäcke zum Deich Nord bringen“.`,
    );
  });

  test('als Beobachter ohne Aufheben und Berichtigen', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, nr } = await einsatzMitAuftrag(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await page.goto(`/einsaetze/${einsatzId}/auftraege`);
    // Vorbedingung: der Rollenzweig steht (Detail da, Quittieren fehlt).
    await expect(detail(page).getByText('Sandsäcke zum Deich bringen')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quittieren' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Aktionen zu Auftrag #${nr}` })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Auftrag aufheben', exact: true })).toHaveCount(
      0,
    );
  });
});
