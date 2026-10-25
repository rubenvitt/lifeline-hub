import { expect, test } from '@playwright/test';
import { waehleStehend, zeigtWahl } from './auswahl-kern';
import { anmelden } from './meldebild-kern';
import { seedeVorlage, seedeVorlagenMaterial } from './vorlage-kern';

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

/**
 * LLH-1261: Material der Vorlage kommt beim Bilden mit. Die Staffel trägt 50 Wolldecken an der
 * Einheit und einen Rucksack auf RTW 1; beide sind vorgehakt, liegen danach am richtigen Ort, und
 * der eine ETB-Eintrag nennt sie.
 */
test('Einheit aus Vorlage bilden: Material am richtigen Ort, ein ETB-Eintrag (LLH-1261)', async ({
  page,
}) => {
  await anmelden(page);
  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Vorlagen-Material ${Date.now()}` },
  });
  expect(neu.ok(), `Seeding Einsatz: ${neu.status()}`).toBeTruthy();
  const einsatzId = ((await neu.json()) as { id: number }).id;
  const v = await seedeVorlage(page, 'm');
  const m = await seedeVorlagenMaterial(page, v);

  await page.goto(`/einsaetze/${einsatzId}/einheiten/aus-vorlage/${v.vorlageId}`);
  const main = page.getByRole('main');
  const decken = main.getByRole('checkbox', { name: new RegExp(`50× ${m.decken}`) });
  const rucksack = main.getByRole('checkbox', { name: new RegExp(`1× ${m.rucksack}`) });
  await expect(decken).toBeChecked();
  await expect(rucksack).toBeChecked();
  await expect(main.getByText('1 Zug, 1 Staffel, 3 Fahrzeuge, 0 Kräfte, 2 Material')).toBeVisible();
  await main.getByRole('button', { name: 'Einheit bilden' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/kraefteuebersicht$`));

  const einheiten = (await (
    await page.request.get(`/api/einsaetze/${einsatzId}/einheiten`)
  ).json()) as { id: number; name: string }[];
  const staffel = einheiten.find((e) => e.name === v.staffel);
  expect(staffel, 'Staffel gebildet').toBeTruthy();
  const fahrzeuge = (await (
    await page.request.get(`/api/einsaetze/${einsatzId}/fahrzeuge`)
  ).json()) as { id: number; funkrufname: string }[];
  const rtw1 = fahrzeuge.find((f) => f.funkrufname === v.fahrzeuge.rtw1);
  const posten = (await (
    await page.request.get(`/api/einsaetze/${einsatzId}/material`)
  ).json()) as {
    bezeichnung: string;
    menge: number;
    einheit_id?: number | null;
    einsatz_fahrzeug_id?: number | null;
  }[];
  const p = (name: string) => posten.find((x) => x.bezeichnung === name);
  expect(p(m.decken)).toMatchObject({ menge: 50, einheit_id: staffel!.id });
  expect(p(m.rucksack)).toMatchObject({ menge: 1, einsatz_fahrzeug_id: rtw1!.id });

  const etb = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
  const inhalte = ((await etb.json()) as { inhalt: string }[]).map((x) => x.inhalt);
  const gebildet = inhalte.filter((i) => i.includes('aus Vorlage'));
  expect(gebildet).toHaveLength(1);
  expect(gebildet[0]).toContain(`Material: 50× ${m.decken}, 1× ${m.rucksack}`);
});
