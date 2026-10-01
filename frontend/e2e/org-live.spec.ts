import { expect, test, type Page } from '@playwright/test';
import { einsaetzePfad, ueberblickPfad } from '../src/routing/deeplinks';

/**
 * Einsatzliste und Stammdaten sind live (LFH-734): was ein anderer Schirm anlegt oder abschließt,
 * erscheint ohne Neuladen und ohne Fokuswechsel — außerhalb eines Einsatzes über den Org-Strom
 * `/api/live`, im Einsatz über dessen eigenen Strom.
 *
 * Der „andere Schirm" schreibt über die API derselben Sitzung; was hier zählt, ist der Weg über
 * den Live-Strom in die offene Seite. Die Seite wartet auf die Antwort des Stroms, BEVOR
 * geschrieben wird: der Server abonniert vor dem ersten Byte. Kein `networkidle` (LFH-385).
 *
 * Mutationsprobe (LFH-734, 7.2): `einsatzliste` aus `ORG_STREAM_EVENTS` genommen → die ersten
 * beiden Tests rot.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, bezeichnung: string): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(antwort.ok()).toBeTruthy();
  return (await antwort.json()).id as number;
}

/** Öffnet `pfad` und wartet, bis der Live-Strom `strompfad` steht. */
async function oeffnenMitStrom(page: Page, pfad: string, strompfad: string) {
  const strom = page.waitForResponse((r) => r.url().endsWith(strompfad) && r.status() === 200);
  await page.goto(pfad);
  await strom;
}

test('LFH-734: ein neu angelegter Einsatz erscheint in der offenen Einsatzliste', async ({
  page,
}) => {
  await anmelden(page);
  await oeffnenMitStrom(page, einsaetzePfad(), '/api/live');
  const bezeichnung = `E2E Org-live Liste ${Date.now()}`;
  await expect(page.getByText(bezeichnung)).toHaveCount(0);

  await einsatzAnlegen(page, bezeichnung);

  await expect(page.getByText(bezeichnung)).toBeVisible();
});

test('LFH-734: im Einsatz verliert der Switcher einen anderswo abgeschlossenen Einsatz', async ({
  page,
}) => {
  await anmelden(page);
  const jetzt = Date.now();
  const hier = `E2E Org-live hier ${jetzt}`;
  const dort = `E2E Org-live dort ${jetzt}`;
  const hierId = await einsatzAnlegen(page, hier);
  const dortId = await einsatzAnlegen(page, dort);
  await oeffnenMitStrom(page, ueberblickPfad(hierId), `/api/einsaetze/${hierId}/live`);

  await page.locator(`button[title="${hier}"]`).click();
  await expect(page.getByRole('menuitem', { name: dort })).toBeVisible();

  const abschluss = await page.request.post(`/api/einsaetze/${dortId}/abschliessen`);
  expect(abschluss.ok()).toBeTruthy();

  await expect(page.getByRole('menuitem', { name: dort })).toHaveCount(0);
});

test('LFH-734: eine anderswo angelegte Person erscheint in der offenen Personal-Verwaltung', async ({
  page,
}) => {
  await anmelden(page);
  await oeffnenMitStrom(page, '/admin/stammdaten/personal', '/api/live');
  const name = `E2E Org-live Person ${Date.now()}`;
  await expect(page.getByText(name)).toHaveCount(0);

  const antwort = await page.request.post('/api/personal', { data: { name } });
  expect(antwort.ok()).toBeTruthy();

  await expect(page.getByText(name)).toBeVisible();
});
