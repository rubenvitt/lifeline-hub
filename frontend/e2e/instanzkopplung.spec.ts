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
