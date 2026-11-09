import { expect, test } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Stammdaten vom Hub (LLH-1493, Spec `stammdaten-verteilung`): eine übernommene Zeile ist am ELW
 * nur lesbar, eine Ergänzung vor Ort trägt „nur hier“ und bleibt bearbeitbar. Das e2e-Backend hat
 * keine zweite Instanz; die Herkunft kommt deshalb per `page.route`. Dass der Server selbst mit
 * 409 sperrt, prüft `tests/instanz_stammdaten.rs` mit zwei echten Instanzen.
 */
test('Stammdaten vom Hub: Zeile gesperrt mit Grund, Ergänzung vor Ort bearbeitbar', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const anlegen = async (funkrufname: string) => {
    const antwort = await page.request.post('/api/fahrzeuge', { data: { funkrufname } });
    expect(antwort.ok()).toBe(true);
    return ((await antwort.json()) as { id: number }).id;
  };
  const stempel = Date.now();
  const hubId = await anlegen(`Hub ${stempel}`);
  await anlegen(`Geliehen ${stempel}`);
  await page.route('**/api/instanz/stammdaten/herkunft', (route) =>
    route.fulfill({
      json: {
        quelle: 'Hub DRK Landesverband',
        vom_hub: { fahrzeug: [String(hubId)] },
        admins_ohne_passkey: [],
      },
    }),
  );
  await page.goto('/admin/stammdaten/fahrzeuge');

  const hub = page.getByRole('row').filter({ hasText: `Hub ${stempel}` });
  await expect(hub.getByText('vom Hub')).toBeVisible();
  await expect(hub.getByText('Wird am Hub gepflegt')).toBeVisible();
  await expect(hub.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);

  const lokal = page.getByRole('row').filter({ hasText: `Geliehen ${stempel}` });
  await expect(lokal.getByText('nur hier')).toBeVisible();
  await lokal.getByRole('button', { name: 'Bearbeiten' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
