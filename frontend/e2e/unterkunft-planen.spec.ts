import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Unterkunftsrechner an der Betreuungsstelle (LLH-1520, Spec `unterkunftsrechner`): aus dem
 * Paneel „Unterkunft“ in „Unterkunft planen“, eine Halle eintragen, die Plätze als Kapazität
 * übernehmen und den Bedarf als Nachforderungen anlegen. Ein Richtwert des Einsatzes aus den
 * Einsatz-Einstellungen ändert das Ergebnis. Geklickt, nicht nur sichtbar (`e2e/AGENTS.md`).
 */

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

const STELLE = 'Sporthalle Deichweg';

async function saeStelle(page: Page): Promise<{ einsatzId: number; stelleId: number }> {
  const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `Unterkunft ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}/betreuung`;
  const { id: stelleId } = await senden(page, 'post', `${basis}/stellen`, {
    bezeichnung: STELLE,
    art: 'notunterkunft',
    kapazitaet_personen: 30,
  });
  return { einsatzId, stelleId };
}

async function halleEintragen(page: Page) {
  const raum = page.getByRole('group', { name: 'Raum 1' });
  await raum.getByLabel('Länge Raum 1 (m)').fill('20');
  await raum.getByLabel('Breite Raum 1 (m)').fill('10');
}

test('Stelle → Unterkunft planen → Kapazität übernehmen und Nachforderungen anlegen', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { einsatzId, stelleId } = await saeStelle(page);

  await page.goto(`/einsaetze/${einsatzId}/betreuung/${stelleId}`);
  const paneel = page.getByRole('region', { name: 'Unterkunft', exact: true });
  await expect(paneel).toContainText('Kapazität 30');
  await paneel.getByRole('button', { name: /Unterkunft planen/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/einsaetze/${einsatzId}/betreuung/${stelleId}/unterkunft$`),
  );

  await halleEintragen(page);
  // 200 m² zu 4 m² je Person.
  await page.getByRole('button', { name: 'Kapazität übernehmen · 50 Plätze', exact: true }).click();
  await expect(page.getByText(`Kapazität ${STELLE}: 50 Plätze`)).toBeVisible();
  await expect(page.getByText('entspricht der Kapazität', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Nachforderungen anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Nachforderungen für ${STELLE}` });
  await dialog.getByRole('button', { name: '4 Nachforderungen anlegen', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`4 Nachforderungen für ${STELLE} angelegt`)).toBeVisible();

  await page.getByRole('link', { name: STELLE, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/betreuung/${stelleId}$`));
  const bedarf = page.getByRole('region', { name: 'Bedarf', exact: true });
  await expect(bedarf.getByRole('link', { name: '50× Feldbetten', exact: true })).toBeVisible();
  await expect(bedarf).toContainText('4 offen');
  await expect(paneel).toContainText('Kapazität 50');
});

test('Einsatz-Einstellungen → Unterkunft: ein Richtwert des Einsatzes ändert das Ergebnis', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { einsatzId, stelleId } = await saeStelle(page);

  await page.goto(`/einsaetze/${einsatzId}/einstellungen/unterkunft`);
  const feld = page.getByRole('spinbutton', { name: 'Schlaffläche je Person (m²)' });
  await feld.fill('5');
  await feld.press('Enter');
  const zeile = page.locator('[data-schluessel="flaeche_je_person_m2"]');
  await expect(zeile).toContainText('Einsatz · 4 m² (Vorgabe)');

  await page.goto(`/einsaetze/${einsatzId}/betreuung/${stelleId}/unterkunft`);
  await halleEintragen(page);
  // 200 m² zu 5 m² je Person.
  await expect(
    page.getByRole('button', { name: 'Kapazität übernehmen · 40 Plätze', exact: true }),
  ).toBeEnabled();
  await page.getByRole('tab', { name: 'Richtwerte' }).click();
  await expect(zeile).toContainText('5 m²');
});
