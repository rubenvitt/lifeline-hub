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
 * der Funkplan-Nachweis wird rot.
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
  await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte?ansicht=organigramm`);
  // Der Zeiger darf nicht über dem Organigramm ruhen: die Schleuse hielte den Kopf mit dem Stand
  // beim Betreten (LFH-867), wie in `fuehrungsorganisation-kern.ts:oeffneOrganigramm`.
  await page.mouse.move(0, 0);
  await expect(organigramm(page).getByRole('link', { name: 'EA Nord' })).toBeVisible();
  await expect(organigramm(page).getByRole('group', { name: 'Einsatzleitung' })).toContainText(
    'BI Krause (extern)',
  );

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
