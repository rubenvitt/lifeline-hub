import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, benutzerAnlegen, mitgliedEintragen, wechsleZu } from './rollen-kern';

/**
 * Kräfte-Zeitachse (LFH-552), Durchstich im Browser: ein Nachtrag auf der Einheit-Detailseite
 * erscheint als Dauer in der Spalte „Im Einsatz“ im Meldebild.
 *
 * Gemessen in zwei Rollen (LFH-435, `rollen-kern.ts`): Führungspersonal trägt nach (Schreibzweig),
 * ein Beobachter liest das Meldebild und findet den Nachtrag gesperrt sichtbar mit Grund
 * (Lesezweig). Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

async function seedeEinheit(page: Page): Promise<{ einsatzId: string; einheitId: number }> {
  const einsatz = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Zeitachse ${Date.now()}` },
  });
  expect(einsatz.ok(), await einsatz.text()).toBe(true);
  const einsatzId = String(((await einsatz.json()) as { id: number }).id);
  const einheit = await page.request.post(`/api/einsaetze/${einsatzId}/einheiten`, {
    data: { name: 'Zeitachsenzug' },
  });
  expect(einheit.ok(), await einheit.text()).toBe(true);
  return { einsatzId, einheitId: ((await einheit.json()) as { id: number }).id };
}

function zeitachsePaneel(page: Page) {
  return page
    .getByRole('main')
    .locator('[data-lfh="paneel"]')
    .filter({ has: page.getByRole('heading', { name: 'Zeitachse', exact: true }) });
}

test('Nachtrag an der Einheit wird zur Einsatzdauer im Meldebild — Schreib- und Lesezweig', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { einsatzId, einheitId } = await seedeEinheit(page);
  const schreiber = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Zeitachse FP');
  await mitgliedEintragen(page, einsatzId, schreiber.id, 'fuehrungspersonal');
  const leser = await benutzerAnlegen(page, 'beobachter', 'E2E Zeitachse B');
  await mitgliedEintragen(page, einsatzId, leser.id, 'beobachter');

  // ── Schreibzweig: Führungspersonal trägt das Eintreffen nach ──
  await wechsleZu(page, schreiber);
  await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
  const paneel = zeitachsePaneel(page);
  await expect(paneel.getByText(/Noch keine Ereignisse/)).toBeVisible();
  await paneel.getByRole('button', { name: 'Nachtragen' }).click();
  const dialog = page.getByRole('dialog', { name: /Zeitachse nachtragen/ });
  await dialog.getByRole('combobox', { name: 'Ereignis' }).click();
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title="Eintreffen"]')
    .click();
  // Der Zeitpunkt ist mit „jetzt" vorbelegt.
  await dialog.getByRole('button', { name: 'Nachtragen' }).click();
  await expect(dialog).toBeHidden();
  await expect(paneel.locator('[data-lfh="zeitachse-ereignis"]')).toHaveCount(1);
  await expect(paneel.locator('[data-lfh="kraft-dauer"]')).toContainText('seit Eintreffen');

  // ── Lesezweig: Beobachter sieht die Dauer und den gesperrten Nachtrag ──
  await wechsleZu(page, leser);
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  const zelle = page.locator('[data-lfh="im-einsatz"]').first();
  await expect(zelle).toHaveText(/^\d+ min, seit Eintreffen/);
  await expect(zelle).toHaveAttribute('title', /^seit Eintreffen /);

  await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
  const lesePaneel = zeitachsePaneel(page);
  await expect(lesePaneel.locator('[data-lfh="zeitachse-ereignis"]')).toHaveCount(1);
  const knopf = lesePaneel.getByRole('button', { name: 'Nachtragen' });
  await expect(knopf).toBeDisabled();
  await expect(lesePaneel).toContainText('Schreibrecht');
});
