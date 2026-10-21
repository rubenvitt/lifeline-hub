import { expect, test, type Page } from '@playwright/test';

/**
 * LLH-1069: Evakuierungsbezirk mit Gebiet anlegen. Im Anlegedialog „Fläche zeichnen“ → die
 * Lagekarte öffnet im Zeichenmodus mit dem Bezirk als Bezug, die gespeicherte Fläche ist ihm
 * zugeordnet, „Zurück zu Bezirk …“ führt auf seine Seite, und die Übersicht bietet „Auf Karte
 * zeigen“. Gegen den echten Server, damit Zuordnung und Flächenzahl echt entstehen. Dazu ein Link
 * auf einen fremden Bezirk: kein Zeichenmodus, Parameter weg.
 */

const BEZIRK = 'Lindenstraße 1–20';

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

async function karteBereit(page: Page) {
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();
  return canvas;
}

test('Bezirk mit Fläche anlegen: zeichnen, zuordnen, zurück zum Bezirk', async ({ page }) => {
  test.setTimeout(120_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await anmelden(page);
  const { id: einsatzId } = await senden(page, '/api/einsaetze', {
    bezeichnung: `E2E Bezirk-Gebiet ${Date.now()}`,
  });

  // Anlegen mit der vorgewählten Gebietswahl „Fläche zeichnen“.
  await page.goto(`/einsaetze/${einsatzId}/evakuierung`);
  await page.getByRole('button', { name: 'Evakuierungsbezirk anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
  await dialog.getByLabel('Bezeichnung').fill(BEZIRK);
  await dialog.getByLabel('Plangröße (Personen)').fill('85');
  await expect(dialog.getByRole('radio', { name: 'Fläche zeichnen' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();

  // Karte im Zeichenmodus, Typ Evakuierungsbezirk mit Bezug; der Auftrag ist aus der Adresse.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lagekarte$`));
  const canvas = await karteBereit(page);
  await expect(page.getByText(`Bezirk ${BEZIRK} · Fläche`)).toBeVisible();
  // Eine Fläche je Auftrag: keine Serie.
  await expect(page.getByRole('switch', { name: 'Weitere zeichnen' })).toHaveCount(0);
  // Erst zeichnen, wenn terra-draw bereit ist: sonst gehen die ersten Klicks an die Karte.
  await expect(page.locator('[data-lfh="zeichnen-punkte"]')).toHaveText('0 Punkte');
  await expect(canvas).toHaveCSS('cursor', 'crosshair');
  await expect(page).not.toHaveURL(/zeichnen=/);

  // Alle Punkte über der Mitte: darunter liegt die Zeichnen-Steuerung im Kartenfuß.
  const box = (await canvas.boundingBox())!;
  const setze = (dx: number, dy: number) =>
    page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await setze(-120, -140);
  await setze(120, -140);
  await setze(120, -40);
  await expect(page.locator('[data-lfh="zeichnen-punkte"]')).toHaveText('3 Punkte');
  await page.getByRole('button', { name: 'Abschließen' }).click();
  const anfrage = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith(`/api/einsaetze/${einsatzId}/zonen`),
  );
  await page.getByRole('button', { name: 'Speichern' }).click();
  const body = (await anfrage).postDataJSON() as {
    typ: string;
    label?: string;
    evakuierungsbezirk_id?: number;
  };
  expect(body.typ).toBe('evakuierungsbezirk');
  expect(body.label).toBe(BEZIRK);
  expect(body.evakuierungsbezirk_id).toEqual(expect.any(Number));
  const bezirkId = body.evakuierungsbezirk_id!;

  // Rückmeldung mit dem Rückweg zum Bezirk.
  await expect(page.getByText(`Gebiet für Bezirk ${BEZIRK} gespeichert`)).toBeVisible();
  await page.getByRole('button', { name: `Zurück zu Bezirk ${BEZIRK}` }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/evakuierung/${bezirkId}$`));
  await expect(page.getByRole('link', { name: 'Weitere Teilfläche zeichnen' })).toBeVisible();
  await expect(page.getByText('Kein Gebiet auf der Lagekarte')).toHaveCount(0);

  // Der Server trägt die Zuordnung.
  const r = await page.request.get(`/api/einsaetze/${einsatzId}/evakuierung`);
  const { bezirke } = (await r.json()) as { bezirke: { id: number; flaechen: number }[] };
  expect(bezirke.find((b) => b.id === bezirkId)).toMatchObject({ flaechen: 1 });

  // Die Übersicht bietet jetzt „Auf Karte zeigen“ am Bezirk.
  await page.goto(`/einsaetze/${einsatzId}/evakuierung`);
  await page.getByRole('button', { name: `Aktionen zu Bezirk ${BEZIRK}` }).click();
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  await expect(menue.getByRole('menuitem', { name: 'Auf Karte zeigen' })).toBeVisible();
  await expect(menue.getByRole('menuitem', { name: 'Weitere Teilfläche zeichnen' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Ein Link auf einen Bezirk, den es im Einsatz nicht gibt: kein Zeichenmodus, Parameter weg.
  await page.goto(
    `/einsaetze/${einsatzId}/lagekarte?zeichnen=evakuierungsbezirk&bezirk=${bezirkId + 9999}`,
  );
  await karteBereit(page);
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lagekarte$`));
  await expect(page.getByRole('button', { name: 'Abschließen' })).toHaveCount(0);

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
