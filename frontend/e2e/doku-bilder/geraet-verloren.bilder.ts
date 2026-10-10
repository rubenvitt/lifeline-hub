import { request } from '@playwright/test';
import { anmelden, expect, fotografiere, test, uhrAnhalten } from './kern';
import { kontoAnlegen } from '../konto-anlegen';

/**
 * Bilder des Kapitels „Gerät verloren“ (`docs/anwender/kapitel/geraet-verloren.md`, LFH-1129).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep geraet-verloren`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   anmeldungen-einer-person.png  frontend/src/pages/BenutzerPage.tsx, auth/SitzungsListe.tsx
 *
 * Eigene Person statt des Admins: „Alle beenden“ träfe sonst die Anmeldung dieses Laufs.
 */

const KAPITEL = 'geraet-verloren';

const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/18.0 Mobile/15E148 Safari/604.1';
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';

test.describe(KAPITEL, () => {
  test('Anmeldungen einer Person in der Verwaltung', async ({ page }) => {
    await anmelden(page);
    const person = { benutzername: 'm.beispiel', passwort: 'doku-passwort-123' };
    await kontoAnlegen(page.request, { anzeigename: 'Max Beispiel', ...person });
    // Zwei Geräte der Person: das verlorene Tablet und ein Arbeitsplatzrechner.
    const baseURL = test.info().project.use.baseURL;
    const geraete = [];
    for (const userAgent of [IPAD, FIREFOX_WINDOWS]) {
      const api = await request.newContext({ baseURL, userAgent });
      expect((await api.post('/api/auth/login', { data: person })).ok()).toBe(true);
      geraete.push(api);
    }

    await uhrAnhalten(page);
    await page.goto('/admin/benutzer');
    await page.getByPlaceholder('Name oder Benutzername').fill(person.benutzername);
    const zeile = page.getByRole('row').filter({ hasText: `@${person.benutzername}` });
    await zeile.getByRole('button', { name: 'Anmeldungen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Anmeldungen · Max Beispiel' });
    const liste = dialog.locator('[data-lfh="sitzungsliste"]');
    await expect(liste.locator('[data-lfh="sitzung"]')).toHaveCount(2);
    await expect(liste.getByText('Safari · iPadOS')).toBeVisible();
    await expect(liste.getByText('Firefox · Windows')).toBeVisible();
    await expect(liste.getByRole('button', { name: 'Alle beenden' })).toBeVisible();
    await fotografiere(dialog, KAPITEL, 'anmeldungen-einer-person');

    // Nachgeklickt: erst das Tablet allein, dann (nach erneuter Anmeldung dort) „Alle beenden“.
    await liste.getByRole('button', { name: 'Anmeldung Safari · iPadOS beenden' }).click();
    await expect(liste.getByText('Safari · iPadOS')).toHaveCount(0);
    expect((await geraete[0].get('/api/auth/me')).status()).toBe(401);
    expect((await geraete[1].get('/api/auth/me')).ok()).toBe(true);
    // Mit einer Anmeldung steht nur noch ihr eigener Knopf da.
    await expect(liste.getByRole('button', { name: 'Alle beenden' })).toHaveCount(0);
    const schliessen = dialog
      .locator('.ant-modal-footer')
      .getByRole('button', { name: 'Schließen' });
    await schliessen.click();
    await expect(dialog).toBeHidden();

    expect((await geraete[0].post('/api/auth/login', { data: person })).ok()).toBe(true);
    // Neu laden: der Dialog zeigt sonst die zwischengespeicherte Liste von eben.
    await page.reload();
    await page.getByPlaceholder('Name oder Benutzername').fill(person.benutzername);
    await zeile.getByRole('button', { name: 'Anmeldungen' }).click();
    await expect(liste.locator('[data-lfh="sitzung"]')).toHaveCount(2);
    await liste.getByRole('button', { name: 'Alle beenden' }).click();
    await expect(dialog.getByText('Keine Anmeldungen')).toBeVisible();
    for (const api of geraete) expect((await api.get('/api/auth/me')).status()).toBe(401);
    await schliessen.click();
    await expect(dialog).toBeHidden();

    // Deaktivieren ohne Rückfrage, Reaktivieren an derselben Stelle.
    await zeile.getByRole('button', { name: 'Deaktivieren' }).click();
    await expect(zeile.getByRole('button', { name: 'Reaktivieren' })).toBeVisible();
    expect((await geraete[1].post('/api/auth/login', { data: person })).ok()).toBe(false);
    await zeile.getByRole('button', { name: 'Reaktivieren' }).click();
    await expect(zeile.getByRole('button', { name: 'Deaktivieren' })).toBeVisible();
    expect((await geraete[1].post('/api/auth/login', { data: person })).ok()).toBe(true);
    for (const api of geraete) await api.dispose();
  });
});
