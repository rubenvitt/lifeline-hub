import { request, type Page } from '@playwright/test';
import { totpCode } from '../totp-kern';
import { KONTEXTE, anmelden, expect, fotografiere, test, uhrAnhalten } from './kern';
import { kontoAnlegen } from '../konto-anlegen';

/**
 * Bilder des Kapitels „Profil und Sicherheit“ (`docs/anwender/kapitel/profil-sicherheit.md`,
 * LFH-1129).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep profil-sicherheit`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   profil.png          frontend/src/pages/ProfilPage.tsx
 *   zweiter-faktor.png  frontend/src/pages/ProfilPage.tsx, auth/TotpPasswortDialog.tsx
 *   anmeldungen.png     frontend/src/auth/SitzungsListe.tsx
 *
 * Jedes Bild mit einer eigenen, frischen Person statt des Admins: Zweitfaktor, Passwortwechsel
 * und „Alle anderen beenden“ träfen sonst die Anmeldung, mit der alle übrigen Bilder entstehen.
 */

const KAPITEL = 'profil-sicherheit';

const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/18.0 Mobile/15E148 Safari/604.1';
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';

interface Person {
  benutzername: string;
  passwort: string;
}

/** Legt als Admin eine Person ohne Rollen an und meldet die Seite als diese Person an. */
async function alsNeuePerson(page: Page, anzeigename: string, benutzername: string) {
  await anmelden(page);
  const person: Person = { benutzername, passwort: 'doku-passwort-123' };
  await kontoAnlegen(page.request, { anzeigename, ...person });
  expect((await page.request.post('/api/auth/logout')).ok()).toBe(true);
  await anmelden(page, person);
  return person;
}

test.describe(KAPITEL, () => {
  test('Profilseite', async ({ page }) => {
    await alsNeuePerson(page, 'Lena Hoffmann', 'l.hoffmann');
    await uhrAnhalten(page);
    // Fükw-Breite, aber nur so hoch wie die drei Abschnitte: darunter ist die Seite leer.
    await page.setViewportSize({ width: KONTEXTE.fuekw.width, height: 660 });
    // Über das Benutzermenü, wie im Kapitel beschrieben.
    await page.goto('/einsaetze');
    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    await page.getByRole('menuitem', { name: 'Profil' }).click();
    await expect(page).toHaveURL(/\/profil$/);
    const konto = page.getByRole('region', { name: 'Konto' });
    await expect(konto).toContainText('Lena Hoffmann');
    await expect(konto).toContainText('l.hoffmann');
    await expect(konto).toContainText('Benutzer');
    const sicherheit = page.getByRole('region', { name: 'Sicherheit' });
    await expect(sicherheit.getByRole('button', { name: 'Passwort ändern' })).toBeVisible();
    await expect(
      sicherheit.getByRole('button', { name: 'Zweiten Faktor einrichten' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-lfh="sitzungsliste"]').getByText('dieses Gerät'),
    ).toBeVisible();
    await fotografiere(page, KAPITEL, 'profil');
  });

  test('Zweiten Faktor einrichten', async ({ page }) => {
    const person = await alsNeuePerson(page, 'Jonas Becker', 'j.becker');
    await uhrAnhalten(page);
    await page.goto('/profil');
    const sicherheit = page.getByRole('region', { name: 'Sicherheit' });
    await sicherheit.getByRole('button', { name: 'Zweiten Faktor einrichten' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zweiten Faktor einrichten' });
    await dialog.getByLabel('Aktuelles Passwort').fill(person.passwort);
    await dialog.getByRole('button', { name: 'Weiter' }).click();
    await expect(dialog).toBeHidden();

    await expect(sicherheit.getByText('QR-Code scannen')).toBeVisible();
    const schluesselZeile = sicherheit.getByText(/Schlüssel zur manuellen Eingabe:/);
    await expect(schluesselZeile).toBeVisible();
    const schluessel = (await schluesselZeile.locator('code').textContent())?.trim() ?? '';
    expect(schluessel).toMatch(/^[A-Z2-7]+=*$/);
    // Ohne Fokus im Codefeld (kein Fokusring im Bild).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(sicherheit, KAPITEL, 'zweiter-faktor');

    // Nachgeklickt: der Code aus der „App“ (hier gerechnet) bestätigt mit der sechsten Ziffer.
    const feld = sicherheit.getByLabel('Code aus deiner Authenticator-App');
    await feld.click();
    await page.keyboard.type(totpCode(schluessel));
    await expect(sicherheit.getByText('Wiederherstellungscodes jetzt sichern')).toBeVisible();
    await expect(sicherheit.locator('pre')).toHaveText(/^(\S+\n){9}\S+$/);
    await expect(sicherheit.getByRole('button', { name: 'Codes kopieren' })).toBeVisible();
    await expect(sicherheit.getByText('Zweiter Faktor aktiv')).toBeVisible();
    await expect(sicherheit.getByRole('button', { name: 'Zweiten Faktor einrichten' })).toHaveCount(
      0,
    );
  });

  test('Passwort ändern', async ({ page }) => {
    const person = await alsNeuePerson(page, 'Mia Wagner', 'm.wagner');
    await uhrAnhalten(page);
    await page.goto('/profil');
    await page
      .getByRole('region', { name: 'Sicherheit' })
      .getByRole('button', { name: 'Passwort ändern' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Passwort ändern' });
    await dialog.getByLabel('Bisheriges Passwort').fill(person.passwort);
    await dialog.getByLabel('Neues Passwort', { exact: true }).fill('kurz');
    await dialog.getByLabel('Neues Passwort wiederholen').fill('kurz');
    await dialog.getByRole('button', { name: 'Passwort ändern' }).click();
    await expect(dialog.getByText('Mindestens 8 Zeichen')).toBeVisible();
    await dialog.getByLabel('Neues Passwort', { exact: true }).fill('neues-passwort-456');
    await dialog.getByLabel('Neues Passwort wiederholen').fill('neues-passwort-456');
    await dialog.getByRole('button', { name: 'Passwort ändern' }).click();
    await expect(
      page.getByText('Passwort geändert. Andere Anmeldungen dieses Kontos sind beendet.'),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  test('Anmeldungen auf anderen Geräten', async ({ page }) => {
    const person = await alsNeuePerson(page, 'Tim Schulz', 't.schulz');
    // Zwei weitere Geräte derselben Person: Tablet und Arbeitsplatzrechner.
    const baseURL = test.info().project.use.baseURL;
    const geraete = [];
    for (const userAgent of [IPAD, FIREFOX_WINDOWS]) {
      const api = await request.newContext({ baseURL, userAgent });
      const antwort = await api.post('/api/auth/login', { data: person });
      expect(antwort.ok(), `Anmeldung ${userAgent}: ${antwort.status()}`).toBe(true);
      geraete.push(api);
    }
    await uhrAnhalten(page);
    await page.goto('/profil');
    const anmeldungen = page.getByRole('region', { name: 'Anmeldungen' });
    const liste = anmeldungen.locator('[data-lfh="sitzungsliste"]');
    await expect(liste.locator('[data-lfh="sitzung"]')).toHaveCount(3);
    await expect(liste.getByText('dieses Gerät')).toBeVisible();
    await expect(liste.getByText('Safari · iPadOS')).toBeVisible();
    await expect(liste.getByText('Firefox · Windows')).toBeVisible();
    await expect(liste.getByRole('button', { name: 'Alle anderen beenden' })).toBeVisible();
    await fotografiere(anmeldungen, KAPITEL, 'anmeldungen');

    // Nachgeklickt: „Beenden“ wirkt ohne Rückfrage, das Gerät verliert den Zugriff.
    await liste.getByRole('button', { name: 'Anmeldung Safari · iPadOS beenden' }).click();
    await expect(liste.getByText('Safari · iPadOS')).toHaveCount(0);
    expect((await geraete[0].get('/api/auth/me')).status()).toBe(401);
    // Bei nur noch einem fremden Gerät steht „Alle anderen beenden“ nicht mehr da.
    await expect(liste.getByRole('button', { name: 'Alle anderen beenden' })).toHaveCount(0);
    for (const api of geraete) await api.dispose();
  });
});
