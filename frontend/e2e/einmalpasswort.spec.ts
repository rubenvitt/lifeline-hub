import { expect, test } from '@playwright/test';
import { anmeldenAls, anmeldenAlsAdmin, benutzerAnlegen } from './rollen-kern';

/*
 * LFH-1121 — Passwort vergessen: die Administration vergibt ein Einmalpasswort.
 *
 * Über die Oberfläche: der Admin vergibt es im Dialog „Benutzer bearbeiten“, die bisherige
 * Anmeldung der Person endet, und mit dem Einmalpasswort kommt sie erst nach „Neues Passwort
 * festlegen“ auf die Einsatzliste. Danach meldet das eigene Passwort direkt an.
 */

test('Einmalpasswort vergeben, anmelden, eigenes Passwort festlegen', async ({ page, browser }) => {
  await anmeldenAlsAdmin(page);
  const person = await benutzerAnlegen(page, 'beobachter', 'E2E Vergessen');

  // Die Person ist auf ihrem Gerät angemeldet.
  const kontext = await browser.newContext();
  const geraet = await kontext.newPage();
  await anmeldenAls(geraet, person.benutzername, person.passwort);

  // Der Admin vergibt das Einmalpasswort.
  await page.goto('/admin/benutzer');
  await page.getByPlaceholder('Name oder Benutzername').fill(person.benutzername);
  const zeile = page.getByRole('row').filter({ hasText: `@${person.benutzername}` });
  await zeile.getByRole('button', { name: 'Bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Benutzer bearbeiten' });
  await dialog.getByRole('button', { name: 'Einmalpasswort vergeben' }).click();
  await page
    .locator('.ant-popconfirm')
    .getByRole('button', { name: 'Einmalpasswort vergeben' })
    .click();
  const anzeige = dialog.getByText(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  await expect(anzeige).toBeVisible();
  const einmalpasswort = (await anzeige.textContent())!;

  // Die bisherige Anmeldung der Person ist beendet.
  await expect
    .poll(async () => (await geraet.request.get('/api/auth/me')).status(), { timeout: 15_000 })
    .toBe(401);

  // Mit dem Einmalpasswort erst „Neues Passwort festlegen“, dann die Einsatzliste.
  await geraet.goto('/login');
  await geraet.getByLabel('Benutzername').fill(person.benutzername);
  await geraet.getByLabel('Passwort').fill(einmalpasswort);
  await geraet.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(geraet.getByText('Neues Passwort festlegen')).toBeVisible();
  await expect(geraet).toHaveURL(/\/login/);
  await geraet.getByLabel('Neues Passwort', { exact: true }).fill('eigenes-passwort-1');
  await geraet.getByLabel('Neues Passwort wiederholen').fill('eigenes-passwort-1');
  await geraet.getByRole('button', { name: 'Passwort festlegen' }).click();
  await expect(geraet).toHaveURL(/\/einsaetze/);

  // Das eigene Passwort meldet danach direkt an, das Einmalpasswort nicht mehr.
  const neu = await geraet.request.post('/api/auth/login', {
    data: { benutzername: person.benutzername, passwort: 'eigenes-passwort-1' },
  });
  expect((await neu.json()) as { benutzername?: string }).toMatchObject({
    benutzername: person.benutzername,
  });
  const alt = await geraet.request.post('/api/auth/login', {
    data: { benutzername: person.benutzername, passwort: einmalpasswort },
  });
  expect(alt.status()).toBe(401);
  await kontext.close();
});
