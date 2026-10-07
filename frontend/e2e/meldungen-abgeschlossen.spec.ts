import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Abgeschlossene Meldungen seitenweise (LFH-940, Spec `meldungen-blaettern`): über 100 erledigte
 * Meldungen lädt „Abgeschlossen" die erste Seite, „Ältere laden" den Rest, und ein Deeplink auf
 * die älteste holt sie einzeln, ohne bis zu ihr zu blättern. Als Admin und als Beobachter
 * (`e2e/AGENTS.md`, Rollen): die Seite ist ein Lesepfad beider.
 */

const ERLEDIGT = 105;

async function einsatzMitErledigten(
  page: Page,
): Promise<{ einsatzId: string; aeltesteId: number }> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Meldungen blättern ${Date.now()}` },
  });
  expect(r.ok(), `POST /api/einsaetze: ${r.status()} ${await r.text()}`).toBe(true);
  const einsatzId = String(((await r.json()) as { id: number }).id);
  const ids: number[] = [];
  for (let i = 0; i < ERLEDIGT; i += 1) {
    const angelegt = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen`, {
      data: {
        absender: 'Florian Nord 1',
        meldeweg: 'funk',
        inhalt: `Erledigt ${i}`,
        ereigniszeit: '2026-10-01 09:00:00',
      },
    });
    expect(angelegt.ok(), `Meldung ${i}: ${angelegt.status()}`).toBe(true);
    const { id } = (await angelegt.json()) as { id: number };
    const erledigt = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen/${id}/status`, {
      data: { status: 'erledigt' },
    });
    expect(erledigt.ok(), `Status ${i}: ${erledigt.status()}`).toBe(true);
    ids.push(id);
  }
  // Eine offene daneben: die Vorgabeansicht hat Inhalt.
  const offen = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen`, {
    data: {
      absender: 'RTW 2',
      meldeweg: 'funk',
      inhalt: 'Noch offen',
      ereigniszeit: '2026-10-01 10:00:00',
    },
  });
  expect(offen.ok()).toBe(true);
  // Zuerst erledigt = zuletzt in der Ordnung (gleiche Sekunde: höhere id zuerst).
  return { einsatzId, aeltesteId: ids[0] };
}

async function pruefeBlaettern(
  page: Page,
  einsatzId: string,
  aeltesteId: number,
  vorbedingung?: () => Promise<void>,
) {
  await page.goto(`/einsaetze/${einsatzId}/meldungen`);
  await expect(page.getByText('Noch offen')).toBeVisible();
  await vorbedingung?.();
  const karten = page.locator('[data-meldung-id]');

  await page.getByText(`Abgeschlossen (${ERLEDIGT})`).click();
  await expect(karten).toHaveCount(100);
  await expect(page.getByText(`100 von ${ERLEDIGT} geladen`)).toBeVisible();
  await page.getByRole('button', { name: 'Ältere laden' }).click();
  await expect(karten).toHaveCount(ERLEDIGT);
  await expect(page.getByRole('button', { name: 'Ältere laden' })).toHaveCount(0);

  // Deeplink auf die älteste: einzeln geholt, über der ersten Seite angeheftet.
  await page.goto(`/einsaetze/${einsatzId}/meldungen?meldung=${aeltesteId}`);
  await expect(page.getByText('Verlinkte Meldung')).toBeVisible();
  await expect(page.locator(`[data-meldung-id="${aeltesteId}"]`)).toBeVisible();
  await expect(page.getByText('Erledigt 0', { exact: true })).toBeVisible();
  await expect(karten).toHaveCount(101);
}

test.describe('Meldungen: Abgeschlossen seitenweise', () => {
  test('als Admin', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, aeltesteId } = await einsatzMitErledigten(page);
    await pruefeBlaettern(page, einsatzId, aeltesteId);
  });

  test('als Beobachter', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, aeltesteId } = await einsatzMitErledigten(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    // Vorbedingung des Rollenzweigs: keine Erfassung für den Beobachter.
    await pruefeBlaettern(page, einsatzId, aeltesteId, () =>
      expect(page.getByRole('button', { name: 'Meldung erfassen' })).toHaveCount(0),
    );
  });
});
