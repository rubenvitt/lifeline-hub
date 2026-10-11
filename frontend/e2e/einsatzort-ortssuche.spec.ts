import { expect, test, type Page } from '@playwright/test';
import { einsatzdatenPfad } from '../src/routing/deeplinks';
import { einsatzDialogOeffnen } from './einsatz-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * LFH-1175, Spec `ortsfeld` und `einsatzdaten-bearbeitung`: den Einsatzort über die Ortssuche
 * erfassen — in den Einsatzdaten (Paneel „Einsatzort“) und im Dialog „Neuen Einsatz anlegen“.
 *
 * Der Geocoder wird nie gefragt: `page.route` fängt die Ortssuche am Frontend ab (Muster
 * `lagekarte-ortssuche.spec.ts`). Gespeichert wird echt, über das e2e-Backend; der Kartenausschnitt
 * zeigt die Nadel auf der Kartengrundlage, die das Backend liefert (ohne Kacheln der Blindstil).
 */

const TREFFER = {
  lat: 53.0775,
  lon: 8.81,
  name: 'Bahnhofstraße 1, Musterstadt, Landkreis X, Niedersachsen, 12345, Deutschland',
  kurz: 'Bahnhofstraße 1, 12345 Musterstadt',
};

/** Fängt beide Such-Einstiege des Ortsfelds ab; zählt die Suchtexte mit. */
async function geocoder(page: Page) {
  const anfragen: string[] = [];
  const antwort = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    anfragen.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    await route.fulfill({ json: { zustand: 'ok', treffer: [TREFFER] } });
  };
  await page.route(/\/api\/einsaetze\/\d+\/ort-suche\?/, antwort);
  await page.route(/\/api\/ort-suche\?/, antwort);
  return anfragen;
}

async function einsatzAnlegenApi(page: Page): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Einsatzort ${Date.now()}` },
  });
  expect(r.ok(), `Einsatz anlegen: ${r.status()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

async function einsatzLesen(page: Page, id: number) {
  const r = await page.request.get(`/api/einsaetze/${id}`);
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as {
    einsatzort: string | null;
    einsatzort_lat: number | null;
    einsatzort_lon: number | null;
  };
}

const paneel = (page: Page) => page.getByRole('region', { name: 'Einsatzort' });

test('Einsatzdaten: Einsatzort suchen, Treffer wählen, speichern — Ausschnitt mit Nadel', async ({
  page,
}) => {
  const anfragen = await geocoder(page);
  await anmeldenAlsAdmin(page);
  const id = await einsatzAnlegenApi(page);
  await page.goto(einsatzdatenPfad(id));

  await expect(paneel(page).getByText('Nicht verortet')).toBeVisible();
  await paneel(page).getByRole('button', { name: 'Adresse eintragen' }).click();
  const feld = paneel(page).getByRole('textbox', { name: 'Adresse' });
  await feld.fill('Bahnhofstraße 1');
  await feld.press('Enter');
  const treffer = paneel(page).getByRole('list', { name: 'Treffer' });
  await treffer.getByRole('button', { name: /Bahnhofstraße 1, 12345 Musterstadt/ }).click();
  expect(anfragen).toEqual(['Bahnhofstraße 1']);
  await paneel(page).getByRole('button', { name: 'Adresse speichern' }).click();

  // Gespeichert sind Adresse und Koordinate (ein PATCH), der Ausschnitt zeigt die Nadel.
  const ausschnitt = paneel(page).getByRole('img', { name: 'Karte: Einsatzort' });
  await expect(ausschnitt).toBeVisible();
  await expect(ausschnitt.getByLabel('Einsatzort')).toBeVisible();
  await expect
    .poll(() => einsatzLesen(page, id))
    .toEqual(
      expect.objectContaining({
        einsatzort: TREFFER.kurz,
        einsatzort_lat: TREFFER.lat,
        einsatzort_lon: TREFFER.lon,
      }),
    );
  // Kopfleiste zeigt die Kurzadresse, der Sprung führt zur Lagekarte um den Ort.
  await expect(page.getByText(TREFFER.kurz).first()).toBeVisible();
  await paneel(page)
    .getByRole('link', { name: /Auf Lagekarte zeigen/ })
    .click();
  await expect(page).toHaveURL(/\/lagekarte\?.*zentrum=/);
});

test('Einsatz anlegen: Einsatzort mit Treffer — Ausschnitt im Dialog, Koordinate gespeichert', async ({
  page,
}) => {
  const anfragen = await geocoder(page);
  await anmeldenAlsAdmin(page);
  const dialog = await einsatzDialogOeffnen(page);
  await dialog.getByLabel('Bezeichnung').fill(`E2E Anlegen mit Ort ${Date.now()}`);
  const feld = dialog.getByLabel('Einsatzort');
  await feld.fill('Bahnhofstraße 1');
  // Enter im Ortsfeld sucht und legt nicht an: der Dialog bleibt offen.
  await feld.press('Enter');
  await dialog
    .getByRole('list', { name: 'Treffer' })
    .getByRole('button', { name: /Bahnhofstraße 1, 12345/ })
    .click();
  expect(anfragen).toEqual(['Bahnhofstraße 1']);
  await expect(dialog.getByRole('img', { name: 'Karte: Einsatzort' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const id = Number(page.url().match(/\/einsaetze\/(\d+)/)![1]);
  expect(await einsatzLesen(page, id)).toEqual(
    expect.objectContaining({
      einsatzort: TREFFER.kurz,
      einsatzort_lat: TREFFER.lat,
      einsatzort_lon: TREFFER.lon,
    }),
  );
});

test.describe('Handy 390 px', () => {
  const BREITE = 390;
  test.use({ viewport: { width: BREITE, height: 844 } });

  test('Paneel Einsatzort mit offener Suche läuft nicht über', async ({ page }) => {
    await geocoder(page);
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegenApi(page);
    await page.goto(einsatzdatenPfad(id));
    await paneel(page).getByRole('button', { name: 'Adresse eintragen' }).click();
    const feld = paneel(page).getByRole('textbox', { name: 'Adresse' });
    await feld.fill('Bahnhofstraße 1');
    await feld.press('Enter');
    const treffer = paneel(page).getByRole('list', { name: 'Treffer' });
    await expect(treffer).toBeVisible();

    const breite = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(breite, 'documentElement.scrollWidth').toBeLessThanOrEqual(BREITE);
    for (const k of [
      paneel(page),
      treffer,
      paneel(page).getByRole('button', { name: 'Ort suchen' }),
    ]) {
      const b = await k.boundingBox();
      expect(b).not.toBeNull();
      expect(b!.x + b!.width, 'rechte Kante').toBeLessThanOrEqual(BREITE);
    }
  });
});
