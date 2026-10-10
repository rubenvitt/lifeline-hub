import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Drucken und Export“ (`docs/anwender/kapitel/drucken-export.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep drucken-export`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   etb-druckansicht.png   frontend/src/pages/EtbDruckPage.tsx, frontend/src/etb/EtbDruckTabelle.tsx
 *   listen-druckansicht.png  frontend/src/druck/ListenDruckSeite.tsx, frontend/src/pages/PersonenDruckPage.tsx,
 *                          frontend/src/components/druck/Druckkopf.tsx
 */

const KAPITEL = 'drucken-export';

/** Öffnet eine Druckansicht und wartet, bis Druckkopf, Tabelle und Druckknopf stehen. */
async function druckansichtOeffnen(page: Page, modul: 'etb' | 'personen') {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/${modul}/druck`);
  await expect(page.locator('[data-lfh="druckkopf"]')).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drucken / als PDF' })).toBeEnabled();
}

test.describe(KAPITEL, () => {
  test('Druckansicht des Einsatztagebuchs', async ({ page }) => {
    await druckansichtOeffnen(page, 'etb');
    await fotografiere(page, KAPITEL, 'etb-druckansicht');
  });

  test('Druckansicht der Betroffenenliste mit Protokollhinweis', async ({ page }) => {
    await druckansichtOeffnen(page, 'personen');
    await expect(page.getByText('Zugriff wird protokolliert.')).toBeVisible();
    await fotografiere(page, KAPITEL, 'listen-druckansicht');
  });
});
