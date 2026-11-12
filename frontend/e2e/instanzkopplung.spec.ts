import { expect, test } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Instanzkopplung (LLH-1490, Specs `instanz-kopplung` und `org-admin-unterschrift`): die Seite
 * in der Verwaltung an einer Instanz. Die Kopplung zweier Instanzen selbst prüft
 * `tests/instanz_kopplung.rs` mit zwei echten Servern; hier steht, was der Admin sieht und dass
 * „Code ausstellen“ ohne Unterschriftsschlüssel gesperrt ist und sagt, warum. Das e2e-Backend
 * läuft ohne Passkeys (`--webauthn-rp-id` fehlt), darum nennt die Sperre genau das.
 */
test('Instanzkopplung: Identität sichtbar, Code ausstellen gesperrt mit Grund', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  await page.goto('/admin/einstellungen/instanzkopplung');

  const fingerabdruck = page.locator('[data-lfh="instanz-fingerabdruck"]');
  await expect(fingerabdruck).toHaveText(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  await expect(page.getByText('Noch keine Kopplung')).toBeVisible();

  const knopf = page.locator('[data-lfh="instanz-code-ausstellen"]');
  await expect(knopf).toBeDisabled();
  await expect(page.locator('[data-lfh="instanz-sperre"]')).toHaveText(
    /Passkeys sind an dieser Instanz nicht eingerichtet/,
  );

  // „Code einlösen“ ist auch ohne Passkeys zu öffnen: einlösen braucht keinen eigenen Schlüssel.
  await page.locator('[data-lfh="instanz-code-einloesen"]').click();
  await expect(page.getByLabel('Kopplungscode')).toBeVisible();
});

/**
 * Direktkopplung vor Ort (LLH-1497, Specs `instanz-kopplung` und `instanz-entdeckung`): ohne
 * Passkeys ist auch „Code vor Ort“ gesperrt. Das e2e-Backend läuft ohne `--lan-entdeckung`, die
 * Liste sagt darum „aus“; eine gefundene Instanz geben wir über die Route vor, und ein Klick
 * übernimmt ihre Adresse ins Feld.
 */
test('Instanzkopplung vor Ort: Code gesperrt, Im Netz suchen übernimmt die Adresse', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  await page.goto('/admin/einstellungen/instanzkopplung');
  await expect(page.locator('[data-lfh="instanz-fingerabdruck"]')).toBeVisible();
  await expect(page.locator('[data-lfh="instanz-code-vor-ort"]')).toBeDisabled();

  await page.locator('[data-lfh="instanz-code-einloesen"]').click();
  const dialog = page.getByRole('dialog', { name: 'Code einlösen' });
  await dialog.locator('[data-lfh="instanz-im-netz-suchen"]').click();
  await expect(dialog.locator('[data-lfh="instanz-im-netz-aus"]')).toContainText(
    'LAN-Entdeckung ist aus',
  );

  await page.route('**/api/admin/instanz/lan', (route) =>
    route.fulfill({
      json: {
        aus: false,
        gefunden: [
          {
            kennung: 'k-elw2',
            name: 'ELW 2',
            fingerabdruck: 'AB12-CD34',
            protokoll: 3,
            adressen: ['https://10.0.0.2:8443'],
            gekoppelt: false,
          },
        ],
      },
    }),
  );
  await dialog.locator('[data-lfh="instanz-im-netz-suchen"]').click();
  await expect(dialog.locator('[data-lfh="instanz-im-netz-name"]')).toHaveText('ELW 2');
  await dialog.locator('[data-lfh="instanz-im-netz-waehlen"]').click();
  await expect(dialog.getByLabel('Adresse der anderen Instanz')).toHaveValue(
    'https://10.0.0.2:8443',
  );
});
