import { expect, request, test } from '@playwright/test';
import { oeffneMenue } from './menue-kern';
import { anmeldenAlsAdmin, benutzerAnlegen } from './rollen-kern';
import { zweitenFaktorEinrichten } from './totp-kern';

/*
 * LFH-1122 — der Admin setzt den zweiten Faktor einer Person in der Benutzerverwaltung zurück.
 *
 * Wer das Telefon mit der Authenticator-App verliert, kommt ohne Wiederherstellungscode nicht mehr
 * hinein. Geprüft wird der ganze Weg gegen den Server: die Aktion steht nur bei aktivem zweiten
 * Faktor, fragt zurück, beendet die Anmeldungen der Person, und danach genügt das Passwort.
 */

test('ein Admin setzt den zweiten Faktor einer Person zurück', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const person = await benutzerAnlegen(page, 'beobachter', 'E2E Telefon weg');
  const ohne = await benutzerAnlegen(page, 'beobachter', 'E2E Ohne Faktor');
  const baseURL = test.info().project.use.baseURL;

  // Die Person meldet sich an einem eigenen Gerät an und richtet den zweiten Faktor ein.
  const geraet = await request.newContext({ baseURL });
  const login = { benutzername: person.benutzername, passwort: person.passwort };
  expect((await geraet.post('/api/auth/login', { data: login })).ok()).toBe(true);
  await zweitenFaktorEinrichten(geraet, person.passwort);
  // Vorbedingung: ab jetzt fragt die Anmeldung mit Passwort nach dem Code.
  const vorher = await request.newContext({ baseURL });
  const mitFaktor = await vorher.post('/api/auth/login', { data: login });
  expect(await mitFaktor.json()).toEqual({ mfa_erforderlich: 'totp' });
  await vorher.dispose();

  await page.goto('/admin/benutzer');
  const suche = page.getByPlaceholder('Name oder Benutzername');

  // Ohne aktiven zweiten Faktor gibt es nichts zurückzusetzen.
  await suche.fill(ohne.benutzername);
  const ohneMenue = await oeffneMenue(
    page,
    page.getByRole('button', {
      name: `Aktionen zu Benutzer E2E Ohne Faktor (@${ohne.benutzername})`,
    }),
  );
  await expect(ohneMenue.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
  await expect(ohneMenue.getByRole('menuitem', { name: /Zweiten Faktor/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await suche.fill(person.benutzername);
  const ausloeser = page.getByRole('button', {
    name: `Aktionen zu Benutzer E2E Telefon weg (@${person.benutzername})`,
  });
  const menue = await oeffneMenue(page, ausloeser);
  await menue.getByRole('menuitem', { name: 'Zweiten Faktor zurücksetzen …' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Zweiten Faktor von E2E Telefon weg zurücksetzen?',
  });
  await expect(dialog).toBeVisible();
  // Die Anfrage wird angehalten: solange sie läuft, schließt nichts die Rückfrage, auch Escape
  // nicht. Sonst käme eine Ablehnung unsichtbar an (LFH-1077).
  let freigeben: () => void = () => {};
  const freigabe = new Promise<void>((fertig) => (freigeben = fertig));
  await page.route('**/api/benutzer/*/totp/reset', async (route) => {
    await freigabe;
    await route.continue();
  });
  await dialog.getByRole('button', { name: 'Zweiten Faktor zurücksetzen' }).click();
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  freigeben();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Zweiter Faktor von E2E Telefon weg zurückgesetzt')).toBeVisible();

  // Die laufende Anmeldung der Person ist beendet …
  expect((await geraet.get('/api/auth/me')).status()).toBe(401);
  await geraet.dispose();
  // … und das Passwort allein meldet wieder an.
  const nachher = await request.newContext({ baseURL });
  const ohneFaktor = await nachher.post('/api/auth/login', { data: login });
  expect(ohneFaktor.ok()).toBe(true);
  expect(await ohneFaktor.json()).toMatchObject({
    benutzername: person.benutzername,
    totp_aktiviert: false,
  });
  await nachher.dispose();

  // Die Liste ist neu geladen: die Aktion steht nicht mehr im Menü.
  const danach = await oeffneMenue(page, ausloeser);
  await expect(danach.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
  await expect(danach.getByRole('menuitem', { name: /Zweiten Faktor/ })).toHaveCount(0);
});
