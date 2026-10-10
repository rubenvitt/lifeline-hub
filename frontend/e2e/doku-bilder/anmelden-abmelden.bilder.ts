import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Anmelden und Abmelden“ (`docs/anwender/kapitel/anmelden-abmelden.md`),
 * Muster für die übrigen Bilder-Specs (LFH-1128).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep anmelden-abmelden`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   anmeldeseite.png    frontend/src/pages/LoginPage.tsx
 *   benutzermenue.png   frontend/src/components/BenutzerMenu.tsx
 *   geraet-koppeln.png  frontend/src/pages/einstellungen/EinsatzGeraete.tsx
 */

const KAPITEL = 'anmelden-abmelden';

test.describe(KAPITEL, () => {
  test('Anmeldeseite', async ({ page }) => {
    await uhrAnhalten(page);
    await page.goto('/login');
    const karte = page.locator('.login-karte');
    await expect(karte.getByLabel('Benutzername')).toBeVisible();
    await karte.getByLabel('Benutzername').fill('m.muster');
    await karte.getByLabel('Passwort').fill('geheim-und-lang');
    // Der Fokus stünde sonst im Passwortfeld (Fokusring und Cursor im Bild).
    await karte.getByLabel('Passwort').blur();
    await fotografiere(karte, KAPITEL, 'anmeldeseite');
  });

  test('Benutzermenü mit „Abmelden“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/einsaetze');
    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    const menue = page.getByRole('menu');
    await expect(menue.getByRole('menuitem', { name: 'Abmelden' })).toBeVisible();
    await fotografiere(menue, KAPITEL, 'benutzermenue');
  });

  test('Dialog „Gerät koppeln“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const uhs = await page.request.get(`/api/einsaetze/${demo.id}/uhs`);
    expect(uhs.ok(), `UHS des Demo-Einsatzes: ${uhs.status()}`).toBe(true);
    const [erste] = (await uhs.json()) as { bezeichnung: string }[];
    expect(erste, 'der Demo-Einsatz hat eine UHS').toBeDefined();

    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/geraete`);
    await page.getByRole('button', { name: 'Gerät koppeln' }).click();
    const dialog = page.getByRole('dialog', { name: 'Gerät koppeln' });
    await waehleIn(dialog.getByRole('combobox', { name: 'Ansicht' }), 'UHS-Tablet');
    await waehleIn(dialog.getByRole('combobox', { name: 'Unfallhilfsstelle' }), erste.bezeichnung);
    await dialog.getByLabel('Gerätebezeichnung').fill('Tablet Aufnahme');
    await dialog.getByLabel('Gerätebezeichnung').blur();
    await fotografiere(dialog, KAPITEL, 'geraet-koppeln');
  });
});
