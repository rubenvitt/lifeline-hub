import { expect, test } from '@playwright/test';
import { anmelden, einsatzAnlegen, organigramm, post } from './fuehrungsorganisation-kern';

/**
 * Einsatzleiter an der eigenen Führungsstelle (LFH-1199, Spec `einsatz-fuehrungsstelle`): über
 * die Oberfläche setzen und übergeben, danach zeigen Kopfleiste, Organigramm und Funkplan denselben
 * Namen, und das ETB trägt genau einen Übergabe-Eintrag. Die Einzelregeln (Statuscodes, gleiche
 * Wahl, Schwärzung) pinnen `tests/einsatz_fuehrungsstelle.rs` und die Vitest-Suiten; hier steht
 * der Weg durch Browser, Server und Live-Strom.
 *
 * Mutationsprobe: in `stab/funkplan.ts:fuehrungsstelleZeile` `leitung: { art: 'leer' }` setzen →
 * der Funkplan-Nachweis wird rot. In `HaengenderBaum.tsx` `gezeigterKopf` ohne `kopfLaedt` →
 * der Organigramm-Kopf bleibt auf „Leitung: lädt“ (LLH-1166).
 */

test('Einsatzleiter setzen und übergeben: ein Name überall, eine Übergabe im ETB', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Einsatzleiter ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
  const paneel = page.getByRole('region', { name: 'Eigene Führungsstelle' });

  async function waehle(name: string, ausloeser: string) {
    await paneel.getByRole('button', { name: ausloeser }).click();
    await paneel.getByRole('combobox', { name: 'Einsatzleiter' }).fill(name);
    await page.getByText(`„${name}“ als externen Einsatzleiter übernehmen`).click();
    await paneel.getByRole('button', { name: 'Einsatzleiter speichern' }).click();
    await expect(paneel.getByRole('button', { name: 'Einsatzleiter bearbeiten' })).toContainText(
      `${name} (extern)`,
    );
  }

  await waehle('KBM Weber', 'Einsatzleiter eintragen');
  await waehle('BI Krause', 'Einsatzleiter bearbeiten');

  const kopf = page.getByRole('group', { name: 'Einsatzleitung' });
  await expect(kopf).toHaveText(/BI Krause \(extern\)/);

  await post(page, einsatzId, 'abschnitte', { name: 'EA Nord' });
  // Die Führungsstelle antwortet erst, wenn der Zeiger über dem Organigramm ruht: die Schleuse
  // (LFH-867) hält die Knoten, lässt den ladenden Kopf aber zu Daten werden (LLH-1166).
  let antworten = () => {};
  const freigabe = new Promise<void>((r) => (antworten = r));
  const fsPfad = `**/api/einsaetze/${einsatzId}/fuehrungsstelle`;
  await page.route(fsPfad, async (route) => {
    await freigabe;
    await route.continue();
  });
  await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte?ansicht=organigramm`);
  const bild = organigramm(page);
  const wurzel = bild.getByRole('group', { name: 'Einsatzleitung' });
  await bild.getByRole('link', { name: 'EA Nord' }).hover();
  await expect(bild.locator('[data-lfh="org-stand"]')).toHaveText('Live pausiert');
  await expect(wurzel).toContainText('Leitung: lädt');
  antworten();
  await expect(wurzel).toContainText('BI Krause (extern)');
  await expect(bild.locator('[data-lfh="org-stand"]')).toHaveText('Live pausiert');
  await page.unroute(fsPfad);

  await page.goto(`/einsaetze/${einsatzId}/fernmeldewesen`);
  await expect(page.locator('tr[data-row-key="fs"]')).toContainText('BI Krause (extern)');

  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
  expect(antwort.ok()).toBeTruthy();
  const inhalte = ((await antwort.json()) as { inhalt: string }[])
    .map((e) => e.inhalt)
    .filter((i) => i.includes('Einsatzleitung'));
  expect(inhalte.sort()).toEqual([
    'Einsatzleitung übernommen: KBM Weber (extern)',
    'Übergabe der Einsatzleitung von KBM Weber (extern) an BI Krause (extern)',
  ]);
});
