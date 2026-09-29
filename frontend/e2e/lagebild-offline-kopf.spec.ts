import { expect, test, type Page } from '@playwright/test';

/**
 * Offline-Kennzeichnung im Seitenkopf bei 390 px (LFH-723, design.md D7, Aufgabe 6.3).
 *
 * Ohne Verbindung wird aus „Stand 14:32" die Anzeige „Stand 14:32 · offline" — zehn Zeichen
 * mehr in einer Gruppe, die LFH-373 auf dem Handschirm gerade erst auf EINE eigene Zeile
 * gebracht hat (gemessen: ein Umbruch dort schob alles darunter 22 px). Geprüft wird deshalb
 * der Kopf selbst: seine Höhe ändert sich beim Wechsel auf offline nicht, die Datenstand-Zeile
 * bleibt einzeilig und im Fenster.
 *
 * WAS BEWUSST NICHT gemessen wird: die Lage des Inhalts UNTER dem Kopf. Offline blendet die
 * Betriebszeile (`LiveStatusBanner`) global ein — der Inhalt rückt also absichtlich, und eine
 * Messung dort maße den Banner, nicht die Kennzeichnung.
 *
 * Kein Service Worker nötig: `context.setOffline(true)` schaltet `navigator.onLine` samt
 * `offline`-Ereignis auch im Dev-Server um, und die Kennzeichnung hängt allein daran.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

test('Offline-Kennzeichnung (LFH-723): der Seitenkopf bleibt bei 390 px, wie er ist', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await anmelden(page);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Offline Kopf 723 ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id } = (await antwort.json()) as { id: number };
  const eintrag = await page.request.post(`/api/einsaetze/${id}/etb`, {
    data: { typ: 'meldung', inhalt: 'Lage unverändert', von: 'ELW 1', an: 'Leitstelle' },
  });
  expect(eintrag.ok(), await eintrag.text()).toBeTruthy();

  const gemessen: string[] = [];
  for (const route of [
    { name: 'ETB', pfad: `/einsaetze/${id}/etb` },
    { name: 'Betroffene', pfad: `/einsaetze/${id}/personen` },
    { name: 'Lagekarte', pfad: `/einsaetze/${id}/lagekarte` },
  ]) {
    for (const dichte of ['kompakt', 'handschuh'] as const) {
      await page.goto(route.pfad);
      await stelleDichte(page, dichte);
      const kopf = page.locator('[data-lfh="seitenkopf"]').first();
      const stand = kopf.getByText(/^Stand \d\d:\d\d$/);
      await expect(stand).toBeVisible({ timeout: 30_000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const vorher = (await kopf.boundingBox())!;
      const standVorher = (await stand.boundingBox())!;

      await context.setOffline(true);
      const offline = kopf.getByText(/^Stand \d\d:\d\d · offline$/);
      await expect(offline).toBeVisible();
      const nachher = (await kopf.boundingBox())!;
      const standNachher = (await offline.boundingBox())!;
      await context.setOffline(false);

      const name = `${route.name}/${dichte}`;
      gemessen.push(
        `${name}: Kopf ${vorher.height}→${nachher.height} px, Stand ${standVorher.width}→${standNachher.width} px`,
      );
      // Der Kopf wächst nicht: kein Umbruch der Meta-Gruppe.
      expect(nachher.height, name).toBe(vorher.height);
      // Die Datenstand-Zeile bleibt einzeilig und im Fenster.
      expect(standNachher.height, name).toBe(standVorher.height);
      expect(standNachher.x + standNachher.width, name).toBeLessThanOrEqual(390);
      await expect(kopf.getByText(/^Stand \d\d:\d\d$/)).toBeVisible();
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});
