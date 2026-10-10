import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Aufbewahrung“ (`docs/anwender/kapitel/aufbewahrung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep aufbewahrung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   frist-aendern.png  frontend/src/aufbewahrung/FristPaneel.tsx
 *   uebersicht.png     frontend/src/aufbewahrung/AufbewahrungUebersicht.tsx
 *   loeschersuchen.png frontend/src/aufbewahrung/SchwaerzungsantragDialog.tsx,
 *                      frontend/src/aufbewahrung/Loeschersuchen.tsx
 *
 * Füllung (D3): die Demo-Daten tragen keinen abgeschlossenen Einsatz. Die Spec legt zwei kleine
 * Einsätze an und schließt sie ab, einen mit Frist, einen ohne. Der Demo-Einsatz bleibt
 * unverändert: am Dialog „Aufbewahrungsfrist ändern“ wird nichts gespeichert.
 */

const KAPITEL = 'aufbewahrung';

const MIT_FRIST = 'Brandsicherheitswache Stadtfest';
const OHNE_FRIST = 'Sanitätsdienst Stadtlauf';

interface Einsatz {
  id: number;
  bezeichnung: string;
  einsatznummer_intern: string | null;
}

/** Legt die beiden abgeschlossenen Einsätze an, falls sie in diesem Lauf noch fehlen. */
async function abgeschlosseneEinsaetze(page: Page): Promise<Record<string, Einsatz>> {
  const liste = await page.request.get('/api/einsaetze');
  expect(liste.ok(), `Einsatzliste: ${liste.status()}`).toBe(true);
  const vorhanden = (await liste.json()) as Einsatz[];
  const ergebnis: Record<string, Einsatz> = {};
  for (const bezeichnung of [MIT_FRIST, OHNE_FRIST]) {
    let einsatz = vorhanden.find((e) => e.bezeichnung === bezeichnung);
    if (!einsatz) {
      einsatz = await fuelle<Einsatz>(page, 'post', '/api/einsaetze', {
        bezeichnung,
        einsatzart: 'realeinsatz',
      });
      if (bezeichnung === MIT_FRIST) {
        const frist = new Date(Date.now() + 180 * 24 * 3600 * 1000);
        frist.setUTCHours(22, 0, 0, 0);
        await fuelle(page, 'put', `/api/einsaetze/${einsatz.id}/aufbewahrungsfrist`, {
          retention_bis: frist.toISOString(),
          bestaetigt: true,
        });
      }
      await fuelle(page, 'post', `/api/einsaetze/${einsatz.id}/abschliessen`);
    }
    ergebnis[bezeichnung] = einsatz;
  }
  return ergebnis;
}

test.describe(KAPITEL, () => {
  test('Dialog „Aufbewahrungsfrist ändern“ am Einsatz', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/aufbewahrung`);
    const paneel = page.getByRole('region', { name: 'Aufbewahrungsfrist' });
    await paneel.getByRole('button', { name: 'Frist ändern' }).click();
    const dialog = page.getByRole('dialog', { name: 'Aufbewahrungsfrist ändern' });
    await expect(dialog.getByLabel('Unbegrenzt aufbewahren')).toBeVisible();
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(dialog, KAPITEL, 'frist-aendern');
  });

  test('Übersicht „Aufbewahrung“', async ({ page }) => {
    await anmelden(page);
    await abgeschlosseneEinsaetze(page);
    await uhrAnhalten(page);
    await page.goto('/admin/aufbewahrung');
    const tabelle = page.locator('.ant-table-wrapper');
    await expect(tabelle.getByText(MIT_FRIST)).toBeVisible();
    await expect(tabelle.getByText(OHNE_FRIST)).toBeVisible();
    await fotografiere(tabelle, KAPITEL, 'uebersicht');
  });

  test('Löschersuchen für einen Einsatz', async ({ page }) => {
    await anmelden(page);
    const einsaetze = await abgeschlosseneEinsaetze(page);
    const einsatz = einsaetze[MIT_FRIST];
    await uhrAnhalten(page);
    await page.goto(`/admin/aufbewahrung/${einsatz.id}`);
    await page.getByRole('button', { name: 'Einsatz sofort schwärzen' }).click();
    const dialog = page.getByRole('dialog', { name: /^Löschersuchen: Einsatz/ });
    await dialog.getByLabel('Aktenzeichen des Löschersuchens').fill('DS-2026-017');
    await dialog.getByLabel('Aktenzeichen des Löschersuchens').blur();
    await expect(dialog.getByRole('button', { name: 'Einsatz schwärzen lassen' })).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'loeschersuchen');
  });
});
