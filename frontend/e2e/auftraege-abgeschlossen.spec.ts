import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Abgeschlossene Aufträge seitenweise (LFH-1071, Spec `auftraege-blaettern`): über 100 vollzogene
 * Aufträge lädt „Abgeschlossen" die erste Seite, „Ältere laden" den Rest, und ein Deeplink auf den
 * ältesten holt ihn einzeln, ohne bis zu ihm zu blättern. Als Admin und als Beobachter
 * (`e2e/AGENTS.md`, Rollen): das Board ist ein Lesepfad beider. Ab 51 Aufträgen rendert die
 * Ansicht nur ihren Ausschnitt, gezählt wird deshalb über die Zeile „… von … geladen".
 *
 * Seit oxgob5gk (Liste + Detailpaneel) steht ein gewählter Auftrag zweimal da (Karte und Detail);
 * gesucht wird deshalb über das Auswahlziel bzw. in der Liste. Die Server-Suche (`q`, D9) findet
 * den ältesten, ohne zu blättern.
 */

// 105 Aufträge über die API plus Neuladen und Suche: mehr als die Vorgabe von 30 s.
test.setTimeout(90_000);

const VOLLZOGEN = 105;

async function einsatzMitVollzogenen(
  page: Page,
): Promise<{ einsatzId: string; aeltesterId: number }> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Aufträge blättern ${Date.now()}` },
  });
  expect(r.ok(), `POST /api/einsaetze: ${r.status()} ${await r.text()}`).toBe(true);
  const einsatzId = String(((await r.json()) as { id: number }).id);
  const auftrag = (text: string) => ({
    auftrag_text: text,
    empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EA Nord' }],
  });
  const ids: number[] = [];
  for (let i = 0; i < VOLLZOGEN; i += 1) {
    const angelegt = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
      data: auftrag(`Vollzogen ${i}`),
    });
    expect(angelegt.ok(), `Auftrag ${i}: ${angelegt.status()}`).toBe(true);
    const { id } = (await angelegt.json()) as { id: number };
    const vollzug = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege/${id}/vollzug`, {
      data: { status: 'vollzogen', vollzugsmeldung: 'Erledigt' },
    });
    expect(vollzug.ok(), `Vollzug ${i}: ${vollzug.status()}`).toBe(true);
    ids.push(id);
  }
  // Ein offener daneben: die Vorgabeansicht hat Inhalt.
  const offen = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
    data: auftrag('Noch offen'),
  });
  expect(offen.ok()).toBe(true);
  // Zuerst vollzogen = zuletzt in der Ordnung (gleiche Sekunde: höhere id zuerst).
  return { einsatzId, aeltesterId: ids[0] };
}

async function pruefeBlaettern(
  page: Page,
  einsatzId: string,
  aeltesterId: number,
  vorbedingung?: () => Promise<void>,
) {
  await page.goto(`/einsaetze/${einsatzId}/auftraege`);
  await expect(page.getByRole('button', { name: /: Noch offen$/ })).toBeVisible();
  await vorbedingung?.();

  await page.getByText(`Abgeschlossen (${VOLLZOGEN})`).click();
  await expect(page.getByText(`100 von ${VOLLZOGEN} geladen`)).toBeVisible();
  await page.getByRole('button', { name: 'Ältere laden' }).click();
  await expect(page.getByRole('button', { name: 'Ältere laden' })).toHaveCount(0);

  // Die Suche geht an den Server: sie findet den ältesten auch ohne geladene Seiten.
  await page.reload();
  await page.getByText(`Abgeschlossen (${VOLLZOGEN})`).click();
  await expect(page.getByText(`100 von ${VOLLZOGEN} geladen`)).toBeVisible();
  await page.getByRole('textbox', { name: 'Aufträge durchsuchen' }).fill('Vollzogen 0');
  await expect(page.getByText('Abgeschlossen (1)')).toBeVisible();
  const abgeschlossene = page.getByRole('list', { name: 'Abgeschlossene Aufträge' });
  await expect(abgeschlossene.getByRole('button', { name: /: Vollzogen 0$/ })).toBeVisible();
  await expect(abgeschlossene.getByRole('button', { name: /^Auftrag / })).toHaveCount(1);

  // Deeplink auf den ältesten: einzeln geholt, über der ersten Seite angeheftet.
  await page.goto(`/einsaetze/${einsatzId}/auftraege?auftrag=${aeltesterId}`);
  await expect(page.getByText('Verlinkter Auftrag')).toBeVisible();
  const karte = page.locator(`[data-auftrag-id="${aeltesterId}"]`);
  await expect(karte).toBeVisible();
  await expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
  await expect(karte.getByText('Vollzogen 0', { exact: true })).toBeVisible();
  // Gewählt: das Detail zeigt ihn.
  await expect(
    page.locator('[data-lfh="liste-detail-detail"]').getByText('Vollzogen 0', { exact: true }),
  ).toBeVisible();
}

test.describe('Aufträge: Abgeschlossen seitenweise', () => {
  test('als Admin', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, aeltesterId } = await einsatzMitVollzogenen(page);
    await pruefeBlaettern(page, einsatzId, aeltesterId);
  });

  test('als Beobachter', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, aeltesterId } = await einsatzMitVollzogenen(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    // Vorbedingung des Rollenzweigs: keine Erteilung für den Beobachter.
    await pruefeBlaettern(page, einsatzId, aeltesterId, () =>
      expect(page.getByRole('button', { name: /Auftrag erteilen/ })).toHaveCount(0),
    );
  });
});
