import { expect, test, type Page } from '@playwright/test';

/**
 * LLH-1034: „Evakuierung" ist ein eigenes Modul neben „Betreuung". Ein alter Link auf einen
 * Bezirk unter `…/betreuung?bezirk=<id>` führt über die Evakuierung auf die Detailseite des
 * Bezirks (LLH-1076); das Modulpanel führt „Evakuierung" direkt vor „Betreuung".
 *
 * Gegen den echten Server: die Umleitung hängt am Router, die Detailseite an den echten
 * Bezirksdaten.
 */

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function senden<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `POST ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

test('alter Bezirkslink unter Betreuung führt auf die Detailseite des Bezirks', async ({
  page,
}) => {
  await anmelden(page);
  const { id: einsatzId } = await senden(page, '/api/einsaetze', {
    bezeichnung: `E2E Evakuierungsmodul ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}/evakuierung`;
  await senden(page, `${basis}/bezirke`, {
    bezeichnung: 'Deichweg 1–9',
    plan_personen: 120,
    plan_erhebung: 'gezaehlt',
  });
  const { id: bezirkId } = await senden(page, `${basis}/bezirke`, {
    bezeichnung: 'Hafenviertel',
    plan_personen: 1210,
    plan_erhebung: 'geschaetzt',
  });

  await page.goto(`/einsaetze/${einsatzId}/betreuung?bezirk=${bezirkId}`);
  // Betreuung → Evakuierung → Detailseite, jeweils mit `replace`.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/evakuierung/${bezirkId}$`));
  await expect(page.getByRole('heading', { level: 1, name: /Bezirk Hafenviertel/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Bezirk in Zahlen' })).toBeVisible();

  // Zurück über die Brotkrume: die Übersicht mit dem Band aller Bezirke.
  await page.locator('.ant-breadcrumb').getByRole('link', { name: 'Evakuierung' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/evakuierung$`));
  await expect(page.getByRole('group', { name: 'Räumung in Zahlen' })).toBeVisible();

  // Modulpanel: „Evakuierung" mit dem Zähler der aktiven Bezirke, direkt über „Betreuung".
  const evakuierung = page.getByRole('button', {
    name: 'Evakuierung, 2 aktive Evakuierungsbezirke',
  });
  const betreuung = page.getByRole('button', { name: /^Betreuung(,|$)/ });
  await expect(evakuierung).toBeVisible();
  await expect(betreuung).toBeVisible();
  const oben = (await evakuierung.boundingBox())!.y;
  expect(oben).toBeLessThan((await betreuung.boundingBox())!.y);
});
