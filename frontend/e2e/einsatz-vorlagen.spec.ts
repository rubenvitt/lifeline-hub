import { expect, test, type Page } from '@playwright/test';
import { zeigtWahl, waehleIn } from './auswahl-kern';
import { einsatzDialogOeffnen } from './einsatz-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * LLH-1375, Spec `einsatz-vorlagen`: Einsatz-Vorlagen der Organisation. Die Startliste bringt
 * jede Organisation mit (Migration 0234, `bootstrap_admin`); „MANV“ blendet unter anderem „Stab“
 * aus und zeigt „Unfallhilfsstellen“.
 *
 * Gegen den echten Server: die Ausblendung schreibt `anlegen_tx` als eigene Einsatzwerte, das
 * Modulpanel liest sie über die Modulfreigaben. Die Specs teilen sich die e2e-Organisation; die
 * Startliste bleibt deshalb unverändert, und ein eigenes Stichwort wird danach wieder gelöscht.
 */

/** Fükw: ab `xl` steht das Modulpanel offen. */
const FUEKW = { width: 1366, height: 768 };

const panel = (page: Page) => page.locator('[data-lfh="modul-panel"]');

async function vorlageId(page: Page, bezeichnung: string): Promise<number> {
  const r = await page.request.get('/api/einsatz-vorlagen');
  expect(r.ok(), `Vorlagen: ${r.status()}`).toBe(true);
  const vorlagen = (await r.json()) as { id: number; bezeichnung: string }[];
  const treffer = vorlagen.find((v) => v.bezeichnung === bezeichnung);
  expect(treffer, `Vorbedingung: Startliste enthält „${bezeichnung}“`).toBeDefined();
  return treffer!.id;
}

test('Einsatz mit Vorlage „MANV“: das Modulpanel zeigt „Unfallhilfsstellen“, nicht „Stab“', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAlsAdmin(page);
  await page.goto('/einsaetze');

  const dialog = await einsatzDialogOeffnen(page);
  await dialog.getByLabel('Bezeichnung').fill(`E2E Vorlage MANV ${Date.now()}`);
  const module = dialog.getByRole('combobox', { name: 'Module' });
  await zeigtWahl(module, 'Alle Module');
  await waehleIn(module, 'MANV');
  // Die Vorlage belegt die Einsatzart vor (Startliste: „Realeinsatz“).
  await zeigtWahl(dialog.getByRole('combobox', { name: 'Einsatzart' }), 'Realeinsatz');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)/)![1];

  // Startseite Führung · Überblick: „Stab“ gehört zur Führung und ist ausgeblendet.
  await expect(panel(page).getByRole('button', { name: /^Überblick/ })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: /^Stab/ })).toHaveCount(0);

  // „Unfallhilfsstellen“ steht unter Erfassung und bleibt sichtbar.
  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen`);
  await expect(panel(page).getByRole('button', { name: /^Unfallhilfsstellen/ })).toBeVisible();

  // Ein Einsatz ohne Vorlage zeigt „Stab“ weiter (Gegenprobe zur Ausblendung).
  const ohne = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E ohne Vorlage ${Date.now()}` },
  });
  expect(ohne.ok(), `Einsatz ohne Vorlage: ${ohne.status()}`).toBe(true);
  await page.goto(`/einsaetze/${((await ohne.json()) as { id: number }).id}/ueberblick`);
  await expect(panel(page).getByRole('button', { name: /^Stab/ })).toBeVisible();
});

test('ein gekoppeltes Stichwort stellt im Anlegedialog seine Vorlage ein', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const stichwort = `E2E-MANV-${Date.now()}`;
  const angelegt = await page.request.post('/api/stichwort-vorschlaege', {
    data: { text: stichwort },
  });
  expect(angelegt.ok(), `Stichwort: ${angelegt.status()}`).toBe(true);
  const vorschlagId = ((await angelegt.json()) as { id: number }).id;
  try {
    // Koppeln über die Stammdaten, wie ein Admin es tut.
    await page.goto('/admin/stammdaten/stichworte');
    await waehleIn(page.getByRole('combobox', { name: `Vorlage zu ${stichwort}` }), 'MANV');
    const manvId = await vorlageId(page, 'MANV');
    await expect
      .poll(async () => {
        const r = await page.request.get('/api/stichwort-vorschlaege');
        const liste = (await r.json()) as { id: number; vorlage_id?: number | null }[];
        return liste.find((v) => v.id === vorschlagId)?.vorlage_id ?? null;
      })
      .toBe(manvId);

    await page.goto('/einsaetze');
    const dialog = await einsatzDialogOeffnen(page);
    const module = dialog.getByRole('combobox', { name: 'Module' });
    await zeigtWahl(module, 'Alle Module');
    await dialog.getByRole('combobox', { name: 'Stichwort' }).fill(stichwort);
    await zeigtWahl(module, 'MANV');
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  } finally {
    await page.request.delete(`/api/stichwort-vorschlaege/${vorschlagId}`);
  }
});
