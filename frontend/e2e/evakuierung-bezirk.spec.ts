import { expect, test, type Page } from '@playwright/test';

/**
 * LLH-1076: Detailseite eines Evakuierungsbezirks. Aus der Übersicht über den Kennungs-Link auf
 * die Seite, dort Stand melden, Räumung weiterschalten und die Plangröße in der Ansicht
 * bearbeiten — gegen den echten Server, damit Kennzahlen, ETB-Folgen und PATCH echt laufen.
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

test('Bezirk: aus der Übersicht auf die Detailseite, melden, räumen, bearbeiten', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmelden(page);
  const { id: einsatzId } = await senden(page, '/api/einsaetze', {
    bezeichnung: `E2E Bezirk-Detail ${Date.now()}`,
  });
  const { id: bezirkId } = await senden(page, `/api/einsaetze/${einsatzId}/evakuierung/bezirke`, {
    bezeichnung: 'Uferstraße 12–40',
    plan_personen: 640,
    plan_erhebung: 'geschaetzt',
  });

  await page.goto(`/einsaetze/${einsatzId}/evakuierung`);
  await page.getByRole('link', { name: 'Uferstraße 12–40' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/evakuierung/${bezirkId}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: /Bezirk Uferstraße 12–40/ }),
  ).toBeVisible();
  const band = page.getByRole('group', { name: 'Bezirk in Zahlen' });
  await expect(band).toContainText('keine Meldung');
  // Ohne Fläche: Leerzustand in Worten, kein Sprung auf die Karte.
  await expect(page.getByText('Kein Gebiet auf der Lagekarte')).toBeVisible();

  // Stand melden → die Kennzahl steigt, der Anteil folgt.
  await page.getByRole('button', { name: 'Stand melden', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Stand melden: Uferstraße 12–40' });
  await dialog.getByLabel('Evakuiert gesamt (Personen)').fill('320');
  await dialog.getByRole('button', { name: 'Melden' }).click();
  await expect(band).toContainText('320');
  await expect(band).toContainText('50 %');

  // Räumung: angeordnet → läuft über den Knopf im Kopf.
  await page.getByRole('button', { name: 'Räumung beginnen' }).click();
  await expect(page.getByRole('button', { name: 'Als geräumt melden' })).toBeVisible();

  // Plangröße in der Ansicht bearbeiten.
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const plan = page.getByLabel('Plangröße (Personen)');
  await plan.fill('800');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
  await expect(band).toContainText('40 %');

  // Der Server trägt beides.
  const r = await page.request.get(`/api/einsaetze/${einsatzId}/evakuierung`);
  const { bezirke } = (await r.json()) as {
    bezirke: { id: number; raeumung: string; plan_personen: number }[];
  };
  expect(bezirke.find((b) => b.id === bezirkId)).toMatchObject({
    raeumung: 'laeuft',
    plan_personen: 800,
  });

  // Handy (390 px): die Seite läuft nicht waagerecht über, die Primäraktion bleibt im Bild.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(band).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stand melden', exact: true })).toBeInViewport();
  const ueber = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(ueber, 'waagerechter Überlauf in px').toBeLessThanOrEqual(1);
});
