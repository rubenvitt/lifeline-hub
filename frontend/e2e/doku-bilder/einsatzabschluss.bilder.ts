import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Einsatz abschließen und Einsatzbericht“
 * (`docs/anwender/kapitel/einsatzabschluss.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatzabschluss`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   bericht-bloecke.png       frontend/src/druck/einsatzbericht/Auswahlleiste.tsx
 *   abschluss-rueckfrage.png  frontend/src/pages/EinsatzdatenPage.tsx (EinsatzAbschluss)
 *
 * Der Demo-Einsatz wird nie abgeschlossen: die Rückfrage bleibt offen, andere Kapitel brauchen
 * ihn laufend.
 */

const KAPITEL = 'einsatzabschluss';

test.describe(KAPITEL, () => {
  test('Einsatzbericht mit der Auswahl der Blöcke', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten/bericht`);
    const bloecke = page.getByRole('region', { name: 'Blöcke' });
    await expect(bloecke.getByRole('checkbox', { name: 'Stammdaten' })).toBeChecked();
    await bloecke.getByText('Anlage Einheiten mit Einsatzzeiten').click();
    await expect(
      bloecke.getByRole('checkbox', { name: 'Anlage Einheiten mit Einsatzzeiten' }),
    ).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Einsatzbericht', exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(bloecke, KAPITEL, 'bericht-bloecke');
  });

  test('Rückfrage „Einsatz abschließen?“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten`);
    const abschluss = page.getByRole('region', { name: 'Einsatzabschluss' });
    await abschluss.getByRole('button', { name: 'Einsatz abschließen' }).click();
    const rueckfrage = page.locator('.ant-popover').filter({ hasText: 'Einsatz abschließen?' });
    await expect(
      rueckfrage.getByRole('button', { name: 'Einsatz endgültig abschließen' }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(rueckfrage, KAPITEL, 'abschluss-rueckfrage');
  });
});
