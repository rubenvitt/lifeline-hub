import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Tiere“ (`docs/anwender/kapitel/tiere.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep tiere`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   liste.png         frontend/src/pages/TierePage.tsx
 *   erfassen.png      frontend/src/pages/TierePage.tsx
 *   abschliessen.png  frontend/src/pages/TiereDetailPage.tsx
 *
 * Daten: der Demo-Einsatz hat keine Tiere. Vier kommen per API dazu (D3): eines mit einer
 * betroffenen Person als Halter, eines vermisst, eines abgeschlossen.
 */

const KAPITEL = 'tiere';

interface Tier {
  id: number;
  rufname: string | null;
}

/** Legt die Tiere einmal je Lauf an (die Datenbank gilt für alle Tests eines Laufs). */
async function tiereAnlegen(page: Page, einsatzId: number): Promise<Tier[]> {
  const basis = `/api/einsaetze/${einsatzId}/tiere`;
  const vorhanden = (await (await page.request.get(basis)).json()) as Tier[];
  if (vorhanden.length > 0) return vorhanden;
  const personen = (await (
    await page.request.get(`/api/einsaetze/${einsatzId}/personen`)
  ).json()) as { id: number; name: string | null }[];
  const halter = personen.find((p) => p.name === 'Mustermann')!;
  await fuelle(page, 'post', basis, {
    spezies: 'hund',
    rufname: 'Bello',
    rasse_beschreibung: 'Labrador-Mischling',
    farbe_beschreibung: 'schwarz',
    kennzeichnung: 'Chip',
    halter_person_id: halter.id,
    antreff_ort: 'Mühlbachweg 12',
  });
  await fuelle(page, 'post', basis, {
    status: 'vermisst',
    spezies: 'katze',
    rufname: 'Minka',
    rasse_beschreibung: 'Europäisch Kurzhaar',
    farbe_beschreibung: 'grau getigert',
    halter_kontakt: 'über Betreuungsstelle',
    antreff_ort: 'Mühlbachweg 20',
  });
  await fuelle(page, 'post', basis, {
    spezies: 'grosstier',
    rasse_beschreibung: 'Haflinger, zwei Pferde',
    antreff_ort: 'Weide am Mühlbach',
  });
  const kaninchen = await fuelle<Tier>(page, 'post', basis, {
    spezies: 'kleintier',
    rufname: 'Hoppel',
    rasse_beschreibung: 'Zwergkaninchen',
    antreff_ort: 'Mühlbachweg 7, Keller',
  });
  await fuelle(page, 'post', `${basis}/${kaninchen.id}/status`, {
    status: 'abgeschlossen',
    abschluss_grund: 'uebergabe_tierheim',
    abschluss_ziel: 'Tierheim Musterstadt',
  });
  return (await (await page.request.get(basis)).json()) as Tier[];
}

test.describe(KAPITEL, () => {
  test('Liste der Tiere in der Sicht „Alle“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await tiereAnlegen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/tiere`);
    await page.getByRole('radio', { name: 'Alle', exact: true }).click();
    await expect(page.getByText('Hoppel').first()).toBeVisible();
    await expect(page.getByText('Bello').first()).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, 'liste');
  });

  test('Dialog „Tier erfassen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/tiere`);
    await page.getByRole('button', { name: 'Tier erfassen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Tier erfassen' });
    await waehleIn(dialog.getByRole('combobox', { name: 'Spezies' }), 'Katze');
    await dialog.getByLabel('Rufname').fill('Felix');
    await dialog.getByLabel('Antreffort').fill('Mühlbachweg 14, Dachboden');
    await dialog.getByRole('button', { name: 'Weitere Angaben' }).click();
    await dialog.getByLabel('Rasse / Beschreibung').fill('Hauskatze');
    await dialog.getByLabel('Notiz').fill('verängstigt, Transportbox nötig');
    await dialog.getByLabel('Notiz').blur();
    await fotografiere(dialog, KAPITEL, 'erfassen');
  });

  test('Dialog „Tier abschließen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const tiere = await tiereAnlegen(page, demo.id);
    const bello = tiere.find((t) => t.rufname === 'Bello')!;
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/tiere/${bello.id}`);
    await page.getByRole('button', { name: 'Abschließen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Tier abschließen' });
    await waehleIn(dialog.getByRole('combobox', { name: 'Abschlussgrund' }), 'Übergabe an Halter');
    await dialog.getByLabel('Ziel').fill('Halterin R-001, Betreuungsstelle Gesamtschule');
    await dialog.getByLabel('Ziel').blur();
    await fotografiere(dialog, KAPITEL, 'abschliessen');
  });
});
