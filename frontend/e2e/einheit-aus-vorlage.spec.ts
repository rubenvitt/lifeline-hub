import { expect, test } from '@playwright/test';
import { waehleStehend, zeigtWahl } from './auswahl-kern';
import { anmelden } from './meldebild-kern';
import { seedeVorlage } from './vorlage-kern';

/**
 * Einheit aus Vorlage bilden (LLH-1049), der ganze Weg über die Oberfläche: Dialog „Einheit
 * bilden“ mit Vorlage → Seite mit dem Baum der Vorlage → zwei Personen anhaken → bilden → das
 * Meldebild zeigt den Zug markiert, Staffel und Fahrzeuge aufgeklappt.
 *
 * Abweichung von der Aufgabe: das e2e-Backend läuft ohne Demo-Daten, die Vorlage sät
 * `vorlage-kern.ts` nach dem Muster des Demo-„Sanitätszug Musterstadt“.
 */
test('Einheit aus Vorlage bilden: Dialog → Vorschau → Meldebild (LLH-1049)', async ({ page }) => {
  await anmelden(page);
  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Vorlage ${Date.now()}` },
  });
  expect(neu.ok(), `Seeding Einsatz: ${neu.status()}`).toBeTruthy();
  const einsatzId = ((await neu.json()) as { id: number }).id;
  const v = await seedeVorlage(page);

  await page.goto(`/einsaetze/${einsatzId}/einheiten`);
  await page.getByRole('button', { name: 'Einheit bilden' }).click();
  const dialog = page.getByRole('dialog', { name: 'Einheit bilden' });
  // Suchen statt Scrollen: die Liste ist virtuell, und andere Specs säen org-weit Vorlagen, deren
  // Namen davor sortieren; ohne Suche stünde die Option unterhalb des gerenderten Ausschnitts.
  const vorlage = dialog.getByRole('combobox', { name: 'Vorlage' });
  await vorlage.click();
  await vorlage.fill(v.zug);
  await waehleStehend(page, v.zug);
  await zeigtWahl(vorlage, v.zug);
  // Mit Vorlage fragt der Dialog weder Name noch Typ: die stehen auf der Seite.
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Weiter' }).click();

  await expect(page).toHaveURL(
    new RegExp(`/einsaetze/${einsatzId}/einheiten/aus-vorlage/${v.vorlageId}$`),
  );
  const main = page.getByRole('main');
  await expect(main.getByLabel('Name', { exact: true })).toHaveValue(v.zug);
  for (const f of Object.values(v.fahrzeuge)) {
    await expect(main.getByRole('checkbox', { name: new RegExp(f) })).toBeChecked();
  }
  await expect(main.getByRole('checkbox', { name: new RegExp(v.personen.anna) })).not.toBeChecked();
  await expect(main.getByText('1 Zug, 1 Staffel, 3 Fahrzeuge, 0 Kräfte')).toBeVisible();

  await main.getByRole('checkbox', { name: new RegExp(v.personen.anna) }).click();
  await main.getByRole('checkbox', { name: new RegExp(v.personen.dirk) }).click();
  await expect(main.getByText('1 Zug, 1 Staffel, 3 Fahrzeuge, 2 Kräfte')).toBeVisible();
  await main.getByRole('button', { name: 'Einheit bilden' }).click();

  // Das Meldebild räumt `?einheit=` nach dem Anwenden.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/kraefteuebersicht$`));
  const meldebild = page.getByRole('region', { name: 'Meldebild' });
  const markiert = meldebild.locator('tr.zeile-hervorgehoben');
  await expect(markiert).toHaveCount(1);
  await expect(markiert).toContainText(v.zug);
  // Staffel und Fahrzeuge stehen offen; Dirk steht in der Gruppe „Ohne Fahrzeug“ der Staffel.
  await expect(meldebild.getByText(v.staffel, { exact: true })).toBeVisible();
  for (const f of Object.values(v.fahrzeuge)) {
    await expect(meldebild.getByText(f, { exact: true })).toBeVisible();
  }
  await expect(meldebild.getByRole('row', { name: /Ohne Fahrzeug · 1 Kraft/ })).toBeVisible();
  // Fahrzeuge und Gruppen bleiben zu: Anna (auf RTW 1) und Dirk sind nicht zu sehen.
  await expect(meldebild.getByText(v.personen.anna, { exact: true })).toHaveCount(0);
  await expect(meldebild.getByText(v.personen.dirk, { exact: true })).toHaveCount(0);
});
