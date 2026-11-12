import { expect, test } from '@playwright/test';
import { anmeldenPerApi } from './anmelde-kern';
import { ADMIN, ADMIN_PW } from './rollen-kern';

/**
 * Nachweis für `anmelde-kern.ts` (LLH-1665): Die Anmeldung über die API lädt die Anmeldeseite
 * nie, liefert dieselbe Nachbedingung wie der frühere Formularweg und hält bei einem Konto ohne
 * Sitzung sofort an. Die Suite verlässt sich in rund 1.300 Aufrufen darauf.
 */

test('mit Startseite steht die Einsatzliste mit dem angemeldeten Admin, ohne dass /login geladen wurde', async ({
  page,
}) => {
  const geladen: string[] = [];
  page.on('request', (anfrage) => {
    if (anfrage.isNavigationRequest() && anfrage.frame() === page.mainFrame()) {
      geladen.push(new URL(anfrage.url()).pathname);
    }
  });

  await anmeldenPerApi(page, ADMIN, ADMIN_PW);

  await expect(page).toHaveURL(/\/einsaetze$/);
  await expect(page.getByRole('button', { name: 'Benutzermenü' })).toBeVisible();
  expect(geladen, 'genau eine Ladung: die Einsatzliste, nie die Anmeldeseite').toEqual([
    '/einsaetze',
  ]);
});

test('ohne Startseite lädt die Anmeldung keine Seite, und das erste goto zeigt die Sitzung', async ({
  page,
}) => {
  await anmeldenPerApi(page, ADMIN, ADMIN_PW, { startseite: false });
  expect(page.url(), 'keine Navigation durch die Anmeldung').toBe('about:blank');

  await page.goto('/einsaetze');
  await expect(page).toHaveURL(/\/einsaetze$/);
  await expect(page.getByRole('button', { name: 'Benutzermenü' })).toBeVisible();
});

test('ein Konto unter Änderungszwang hält bei der Anmeldung an, nicht erst auf der nächsten Seite', async ({
  page,
}) => {
  await anmeldenPerApi(page, ADMIN, ADMIN_PW, { startseite: false });
  const benutzername = `e2e-zwang-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const passwort = 'e2e-zwang-passwort-123';
  // Ohne Erstwechsel (`konto-anlegen.ts` absichtlich nicht): das Konto steht unter Änderungszwang.
  const angelegt = await page.request.post('/api/benutzer', {
    data: { anzeigename: 'E2E Zwang', benutzername, passwort },
  });
  expect(angelegt.ok(), `Konto: ${angelegt.status()} ${await angelegt.text()}`).toBe(true);
  await page.request.post('/api/auth/logout');

  await expect(anmeldenPerApi(page, benutzername, passwort)).rejects.toThrow(/Sitzung erwartet/);
  expect(page.url(), 'die Anmeldung hat keine Seite geladen').toBe('about:blank');
});
