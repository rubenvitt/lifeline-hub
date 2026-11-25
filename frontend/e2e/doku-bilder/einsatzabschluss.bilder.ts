import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Einsatz abschließen und Einsatzbericht“
 * (`docs/anwender/kapitel/einsatzabschluss.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatzabschluss`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   bericht-bloecke.png   frontend/src/druck/einsatzbericht/Auswahlleiste.tsx
 *   abschluss-dialog.png  frontend/src/pages/einsatzdaten/EinsatzAbschlussDialog.tsx
 *                         (ListenAbschnitt aus components/instrument/ListenPaneel.tsx)
 *   wieder-oeffnen.png    frontend/src/pages/einsatzdaten/EinsatzWiedereroeffnenDialog.tsx
 *
 * Der Demo-Einsatz wird nie abgeschlossen: der Abschlussdialog bleibt offen, andere Kapitel
 * brauchen ihn laufend. Das Wiederöffnen zeigt ein eigener, über die API angelegter und
 * abgeschlossener Einsatz.
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

  test('Dialog „Einsatz abschließen“ mit den offenen Punkten', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten`);
    const abschluss = page.getByRole('region', { name: 'Einsatzabschluss' });
    await abschluss.getByRole('button', { name: 'Einsatz abschließen…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Einsatz abschließen' });
    await expect(dialog.getByRole('region', { name: 'Kräfte' })).toBeVisible();
    await dialog.getByRole('textbox', { name: /Zur Bestätigung/ }).fill(demo.bezeichnung);
    await expect(
      dialog.getByRole('button', { name: 'Einsatz abschließen', exact: true }),
    ).toBeEnabled();
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(dialog, KAPITEL, 'abschluss-dialog');
  });

  test('Dialog „Einsatz wieder öffnen“', async ({ page }) => {
    await anmelden(page);
    const einsatz = await fuelle<{ id: number }>(page, 'post', '/api/incidents', {
      bezeichnung: 'Ölspur B 27',
    });
    await fuelle(page, 'post', `/api/incidents/${einsatz.id}/close`);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${einsatz.id}/einsatzdaten`);
    const abschluss = page.getByRole('region', { name: 'Einsatzabschluss' });
    await abschluss.getByRole('button', { name: 'Einsatz wieder öffnen…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Einsatz wieder öffnen' });
    await dialog
      .getByRole('textbox', { name: 'Grund' })
      .fill('Versehentlich abgeschlossen, Nachalarmierung läuft noch');
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(dialog, KAPITEL, 'wieder-oeffnen');
  });
});
