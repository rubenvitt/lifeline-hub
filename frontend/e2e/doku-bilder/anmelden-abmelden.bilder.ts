import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Anmelden und Abmelden“ (`docs/anwender/kapitel/anmelden-abmelden.md`),
 * Muster für die übrigen Bilder-Specs (LFH-1128).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep anmelden-abmelden`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   anmeldeseite.png    frontend/src/pages/LoginPage.tsx
 *   benutzermenue.png   frontend/src/components/BenutzerMenu.tsx
 *   geraet-koppeln.png  frontend/src/pages/einstellungen/EinsatzGeraete.tsx
 *   passwort-festlegen.png  frontend/src/pages/LoginPage.tsx,
 *                           frontend/src/auth/NeuesPasswortFelder.tsx
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

  test('Stufe „Neues Passwort festlegen“', async ({ page }) => {
    // Ein frisch angelegtes Konto steht unter Änderungszwang (LFH-1121): wie nach einem
    // Einmalpasswort führt die erste Anmeldung in die Stufe. Der Admin legt an und meldet ab.
    await anmelden(page);
    const person = { benutzername: 'n.beispiel', passwort: 'anfangs-passwort-123' };
    const liste = await page.request.get('/api/benutzer');
    const vorhanden = ((await liste.json()) as { benutzername: string }[]).some(
      (b) => b.benutzername === person.benutzername,
    );
    if (!vorhanden) {
      await fuelle(page, 'post', '/api/benutzer', { anzeigename: 'Nora Beispiel', ...person });
    }
    expect((await page.request.post('/api/auth/logout')).ok()).toBe(true);

    await uhrAnhalten(page);
    await page.goto('/login');
    const karte = page.locator('.login-karte');
    await karte.getByLabel('Benutzername').fill(person.benutzername);
    await karte.getByLabel('Passwort').fill(person.passwort);
    await karte.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(karte.getByText('Neues Passwort festlegen')).toBeVisible();
    await karte.getByLabel('Neues Passwort', { exact: true }).fill('eigenes-passwort-1');
    await karte.getByLabel('Neues Passwort wiederholen').fill('eigenes-passwort-1');
    // Der Fokus stünde sonst im Feld (Fokusring und Cursor im Bild).
    await karte.getByLabel('Neues Passwort wiederholen').blur();
    await fotografiere(karte, KAPITEL, 'passwort-festlegen');
  });
});
