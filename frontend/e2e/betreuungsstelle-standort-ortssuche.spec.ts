import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * LLH-1121, Spec `ortsfeld` und `betreuung-lagekarte`: der Standort einer Betreuungsstelle kommt
 * beim Anlegen über die Ortssuche. Ein gewählter Treffer verortet die Stelle, die Lagekarte zeigt
 * ihren Marker — ohne den Umweg „Auf Karte verorten“.
 *
 * Der Geocoder wird nie gefragt: `page.route` fängt Ortssuche und Ort-Vorschau am Frontend ab
 * (Muster `einsatzort-ortssuche.spec.ts`). Angelegt wird echt, über das e2e-Backend; geprüft wird
 * die Marker-Quelle der Karte (`querySourceFeatures`, Muster `lagekarte-betreuung.spec.ts`).
 */

interface MapHaken {
  loaded(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  querySourceFeatures(quelle: string): { properties: Record<string, unknown> | null }[];
}

const ORT: [number, number] = [9.356, 52.103];

const TREFFER = {
  lat: 52.105,
  lon: 9.36,
  name: 'Sportplatzweg 3, Musterstadt, Landkreis X, Niedersachsen, 12345, Deutschland',
  kurz: 'Sportplatzweg 3, 12345 Musterstadt',
};

async function geocoder(page: Page) {
  const anfragen: string[] = [];
  await page.route(/\/api\/einsaetze\/\d+\/ort-suche\?/, async (route) => {
    anfragen.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    await route.fulfill({ json: { zustand: 'ok', treffer: [TREFFER] } });
  });
  await page.route(/\/api\/einsaetze\/\d+\/ort-vorschau\?/, (route) =>
    route.fulfill({ json: { ortsname: TREFFER.kurz, peilung: null } }),
  );
  return anfragen;
}

async function senden(page: Page, methode: 'post' | 'patch', pfad: string, data?: unknown) {
  const antwort = await page.request[methode](pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as { id: number };
}

async function schluessel(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
    if (!k || !k.loaded()) return [];
    return k
      .querySourceFeatures('marker-cluster')
      .map((f) => String((f.properties ?? {}).schluessel));
  });
}

test.use({ viewport: { width: 1366, height: 768 } });

test('Betreuungsstelle anlegen: gewählter Standort verortet, Marker auf der Lagekarte', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const anfragen = await geocoder(page);
  await anmeldenAlsAdmin(page);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Standort ${Date.now()}`,
  });
  await senden(page, 'patch', `/api/einsaetze/${e}`, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });

  await page.goto(`/einsaetze/${e}/betreuung`);
  await page.getByRole('button', { name: 'Betreuungsstelle anlegen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Betreuungsstelle anlegen' });
  await dialog.getByLabel('Bezeichnung').fill('NU Sporthalle');
  await dialog.getByRole('button', { name: /Weitere Angaben/ }).click();
  const standort = dialog.getByRole('textbox', { name: 'Standort' });
  await standort.fill('Sportplatzweg 3');
  // Enter im Ortsfeld sucht und legt nicht an: der Dialog bleibt offen.
  await standort.press('Enter');
  await dialog
    .getByRole('list', { name: 'Treffer' })
    .getByRole('button', { name: /Sportplatzweg 3, 12345/ })
    .click();
  expect(anfragen).toEqual(['Sportplatzweg 3']);
  await expect(standort).toHaveValue(TREFFER.kurz);
  await expect(dialog.getByRole('group', { name: 'Karte: Standort' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).toBeHidden();

  // Gespeichert sind Standort und Koordinate.
  const uebersicht = (await (await page.request.get(`/api/einsaetze/${e}/betreuung`)).json()) as {
    stellen: { id: number; bezeichnung: string; standort?: string; lat?: number; lon?: number }[];
  };
  const stelle = uebersicht.stellen.find((s) => s.bezeichnung === 'NU Sporthalle')!;
  expect(stelle).toEqual(
    expect.objectContaining({ standort: TREFFER.kurz, lat: TREFFER.lat, lon: TREFFER.lon }),
  );

  // Die Lagekarte zeigt den Marker der Stelle.
  await page.goto(`/einsaetze/${e}/lagekarte`);
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
  await page.evaluate(
    (c) =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.jumpTo({ center: c, zoom: 15 }),
    [TREFFER.lon, TREFFER.lat] as [number, number],
  );
  await expect
    .poll(() => schluessel(page), { timeout: 30_000 })
    .toContain(`betreuungsstelle-${stelle.id}`);
});
