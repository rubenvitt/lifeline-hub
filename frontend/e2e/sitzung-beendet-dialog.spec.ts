import { expect, request, test } from '@playwright/test';
import { anmeldenOhneStartseite } from './lageplan-kern';
import { ADMIN, ADMIN_PW } from './rollen-kern';

/*
 * LLH-1770 — Sitzung beendet: Anmeldung als Dialog über der Seite, das offene Formular bleibt.
 *
 * Eine halb erfasste Meldung, dann endet die Sitzung an der App vorbei (Logout aus einem eigenen
 * Anfragekontext mit demselben Cookie, wie ein serverseitiger Ablauf). Die Seite bemerkt es bei
 * der nächsten Prüfung (Tab wieder sichtbar) und legt „Sitzung beendet“ darüber. Nach der
 * Anmeldung derselben Person steht der Text noch im Formular und lässt sich senden.
 */

test('die halb erfasste Meldung übersteht das Sitzungsende', async ({ page, baseURL }) => {
  await anmeldenOhneStartseite(page, ADMIN, ADMIN_PW);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Sitzung beendet ${Date.now()}` },
  });
  expect(angelegt.ok(), `Einsatz anlegen: ${angelegt.status()}`).toBe(true);
  const einsatzId = String(((await angelegt.json()) as { id: number }).id);

  await page.goto(`/einsaetze/${einsatzId}/meldungen`);
  await page.getByRole('button', { name: 'Meldung erfassen' }).click();
  const formular = page.getByRole('region', { name: 'Neue Meldung erfassen' });
  await expect(formular).toBeVisible();
  const inhalt = `Deich Nord durchfeuchtet ${Date.now()}`;
  await formular.getByLabel('Absender').fill('Florian Nord 1');
  await formular.getByLabel('Inhalt / Wortlaut').fill(inhalt);

  const fremd = await request.newContext({
    baseURL,
    storageState: await page.context().storageState(),
  });
  const aus = await fremd.post('/api/auth/logout');
  expect(aus.status(), await aus.text()).toBe(204);
  await fremd.dispose();

  // Der Tab wird wieder sichtbar: der AuthProvider prüft die Sitzung und findet keine.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const dialog = page.getByRole('dialog', { name: 'Sitzung beendet' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Eingaben auf dieser Seite bleiben erhalten.');
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/meldungen`));
  await expect(dialog.getByLabel('Benutzername')).toHaveValue(ADMIN);

  await dialog.getByLabel('Passwort').fill(ADMIN_PW);
  await dialog.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(formular.getByLabel('Inhalt / Wortlaut')).toHaveValue(inhalt);
  await expect(formular.getByLabel('Absender')).toHaveValue('Florian Nord 1');

  await formular.getByRole('button', { name: 'Meldung erfassen' }).click();
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`/api/einsaetze/${einsatzId}/meldungen`);
        const liste = (await r.json()) as { inhalt: string }[];
        return liste.some((m) => m.inhalt === inhalt);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});
