import { request } from '@playwright/test';
import { anmelden, expect, fotografiere, test, uhrAnhalten } from './kern';
import { kontoAnlegen } from '../konto-anlegen';

/**
 * Bilder des Kapitels „Benutzer“ (`docs/anwender/kapitel/benutzer.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep benutzer`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   benutzerliste.png     frontend/src/pages/BenutzerPage.tsx
 *   benutzer-anlegen.png  frontend/src/pages/BenutzerPage.tsx
 *   anmeldungen.png       frontend/src/pages/BenutzerPage.tsx, frontend/src/auth/SitzungsListe.tsx
 *   einmalpasswort.png    frontend/src/pages/BenutzerPage.tsx,
 *                         frontend/src/auth/EinmalpasswortVergeben.tsx,
 *                         frontend/src/components/KopierbarerText.tsx
 *
 * Füllung (D3): eine Person „Kim Beispiel“ mit zwei Anmeldungen, damit Liste und Anmeldungen
 * etwas zeigen. Die Demo-Daten legen keine Benutzer an.
 */

const KAPITEL = 'benutzer';
const PERSON = { anzeigename: 'Kim Beispiel', benutzername: 'k.beispiel' };
const PASSWORT = 'beispiel-passwort-123';

/** Legt die Person an, falls es sie in diesem Lauf noch nicht gibt. */
async function personAnlegen(page: Parameters<typeof anmelden>[0]): Promise<number> {
  const liste = await page.request.get('/api/benutzer');
  expect(liste.ok(), `Benutzerliste: ${liste.status()}`).toBe(true);
  const vorhanden = ((await liste.json()) as { id: number; benutzername: string }[]).find(
    (b) => b.benutzername === PERSON.benutzername,
  );
  if (vorhanden) return vorhanden.id;
  const neu = await kontoAnlegen(page.request, {
    ...PERSON,
    passwort: PASSWORT,
    org_rolle: 'fuehrungskraft',
  });
  return neu.id;
}

test.describe(KAPITEL, () => {
  test('Liste „Benutzer“', async ({ page }) => {
    await anmelden(page);
    await personAnlegen(page);
    await uhrAnhalten(page);
    await page.goto('/admin/benutzer');
    const tabelle = page.locator('.ant-table-wrapper');
    await expect(tabelle.getByText('Kim Beispiel')).toBeVisible();
    await fotografiere(tabelle, KAPITEL, 'benutzerliste');
  });

  test('Dialog „Neuen Benutzer anlegen“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/benutzer');
    await page.getByRole('button', { name: 'Benutzer anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Neuen Benutzer anlegen' });
    await dialog.getByLabel('Anzeigename').fill('Alex Muster');
    await dialog.getByLabel('Benutzername').fill('a.muster');
    await dialog.getByLabel('Passwort').fill('anfangs-passwort-123');
    await dialog.getByText('Weitere Angaben').click();
    await expect(dialog.getByLabel('Org-Rolle')).toBeVisible();
    await dialog.getByLabel('Passwort').blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'benutzer-anlegen');
  });

  test('Dialog „Anmeldungen“ einer Person', async ({ page }) => {
    await anmelden(page);
    await personAnlegen(page);
    // Zwei Anmeldungen der Person aus eigenen Kontexten (je ein Gerät).
    const kontexte = [];
    for (const kennung of [
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    ]) {
      const api = await request.newContext({
        baseURL: test.info().project.use.baseURL,
        userAgent: kennung,
      });
      const login = await api.post('/api/auth/login', {
        data: { benutzername: PERSON.benutzername, passwort: PASSWORT },
      });
      expect(login.ok(), `Anmeldung ${PERSON.benutzername}: ${login.status()}`).toBe(true);
      kontexte.push(api);
    }
    try {
      await uhrAnhalten(page);
      await page.goto('/admin/benutzer');
      const zeile = page.getByRole('row').filter({ hasText: 'Kim Beispiel' });
      await zeile.getByRole('button', { name: 'Anmeldungen' }).click();
      const dialog = page.getByRole('dialog', { name: 'Anmeldungen · Kim Beispiel' });
      await expect(dialog.getByRole('button', { name: 'Alle beenden' })).toBeVisible();
      await page.mouse.move(0, 0);
      await fotografiere(dialog, KAPITEL, 'anmeldungen');
    } finally {
      for (const api of kontexte) await api.dispose();
    }
  });

  // Zuletzt: das Einmalpasswort beendet die Anmeldungen der Person und ersetzt ihr Passwort.
  test('Einmalpasswort im Dialog „Benutzer bearbeiten“', async ({ page }) => {
    await anmelden(page);
    await personAnlegen(page);
    // Ein fester Wert statt des zufälligen: das Bild soll nicht je Lauf ein anderes zeigen.
    await page.route('**/api/benutzer/*/einmalpasswort', (route) =>
      route.fulfill({ json: { einmalpasswort: 'kx7m-p4qr-9tzw' } }),
    );
    await uhrAnhalten(page);
    await page.goto('/admin/benutzer');
    const zeile = page.getByRole('row').filter({ hasText: 'Kim Beispiel' });
    await zeile.getByRole('button', { name: 'Bearbeiten' }).click();
    const dialog = page.getByRole('dialog', { name: 'Benutzer bearbeiten' });
    await dialog.getByRole('button', { name: 'Einmalpasswort vergeben' }).click();
    await page
      .locator('.ant-popconfirm')
      .getByRole('button', { name: 'Einmalpasswort vergeben' })
      .click();
    await expect(dialog.getByText('kx7m-p4qr-9tzw')).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'einmalpasswort');
  });
});
