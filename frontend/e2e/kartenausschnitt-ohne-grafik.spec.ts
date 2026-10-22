import { expect, test, type Page } from '@playwright/test';
import { einsatzdatenPfad, evakuierungsbezirkPfad } from '../src/routing/deeplinks';
import { einsatzDialogOeffnen } from './einsatz-kern';
import { api, einsatzAnlegen } from './fernmeldeskizze-kern';
import { ohneWebgl2 } from './kartenFixture';
import { anmeldenOhneStartseite, grundlageOhneNetz, ORT } from './lageplan-kern';
import { ADMIN, ADMIN_PW } from './rollen-kern';

/**
 * Kleine Karten auf einem Gerät ohne WebGL2 (LLH-1370, Nachzug zu LLH-1353): der Kartenausschnitt
 * des Einsatzorts (Einsatzdaten, Anlegedialog der Einsatzliste) und das Kartenbild des
 * Evakuierungsbezirks bauen eigene maplibre-Karten. Statt der Fehlerseite der App steht an Stelle
 * der Karte „Karte auf diesem Gerät nicht darstellbar“, der Rest der Seite bleibt bedienbar.
 *
 * Chromium per Init-Skript (`ohneWebgl2`), Firefox headless ohne Nachbau (`OHNE_WEBGL_SPECS`).
 *
 * Beleg vor dem Fix und Mutationsprobe: ohne `wennDarstellbar` in `Kartenausschnitt.tsx` bzw.
 * `BezirkKartenbild.tsx` zeigen alle drei Fälle „Unexpected Application Error!“, rot (geprobt 21.10.).
 */

const ZUSTAND = 'Karte auf diesem Gerät nicht darstellbar';
const zustand = (page: Page) => page.locator('[data-lfh="karte-nicht-darstellbar"]');

/** Seitenfehler sammeln, WebGL2 abschalten, Grundlage ohne Netz, anmelden über die API. */
async function vorbereiten(page: Page): Promise<Error[]> {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await ohneWebgl2(page);
  await grundlageOhneNetz(page);
  await anmeldenOhneStartseite(page, ADMIN, ADMIN_PW);
  return seitenFehler;
}

/** Vorbedingung: das Gerät hat wirklich kein WebGL2 (Nachbau in Chromium, Firefox selbst). */
async function ohneGrafik(page: Page) {
  expect(
    await page.evaluate(() => document.createElement('canvas').getContext('webgl2') === null),
  ).toBe(true);
}

async function keineFehlerseite(page: Page) {
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
}

test('Einsatzdaten: verorteter Einsatzort ohne Kartengrafik, Paneel bleibt bedienbar', async ({
  page,
}) => {
  const seitenFehler = await vorbereiten(page);
  const id = await einsatzAnlegen(page, `E2E Ausschnitt ohne Grafik ${Date.now()}`);
  const verortet = await page.request.patch(`/api/einsaetze/${id}`, {
    data: { einsatzort: 'Bahnhofstraße 1', einsatzort_lat: ORT.lat, einsatzort_lon: ORT.lon },
  });
  expect(verortet.ok(), `Einsatzort: ${verortet.status()}`).toBe(true);
  await page.goto(einsatzdatenPfad(Number(id)));
  await ohneGrafik(page);

  const paneel = page.getByRole('region', { name: 'Einsatzort' });
  await expect(paneel.locator('[data-lfh="karte-nicht-darstellbar"]')).toHaveText(ZUSTAND);
  await keineFehlerseite(page);
  await expect(paneel.getByRole('img', { name: 'Karte: Einsatzort' })).toHaveCount(0);
  await expect(paneel.locator('canvas')).toHaveCount(0);

  // Das Paneel bleibt: der Sprung zur Lagekarte trägt den Ort.
  await paneel.getByRole('link', { name: /Auf Lagekarte zeigen/ }).click();
  await expect(page).toHaveURL(/\/lagekarte\?.*zentrum=/);

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

test('Einsatzliste: Anlegedialog mit Treffer ohne Kartengrafik, Anlegen geht', async ({ page }) => {
  const seitenFehler = await vorbereiten(page);
  const treffer = {
    lat: ORT.lat,
    lon: ORT.lon,
    name: 'Bahnhofstraße 1, Musterstadt, Landkreis X, Niedersachsen, 12345, Deutschland',
    kurz: 'Bahnhofstraße 1, 12345 Musterstadt',
  };
  await page.route(/\/api\/ort-suche\?/, (route) =>
    route.fulfill({ json: { zustand: 'ok', treffer: [treffer] } }),
  );
  await page.goto('/einsaetze');
  await ohneGrafik(page);

  const dialog = await einsatzDialogOeffnen(page);
  await dialog.getByLabel('Bezeichnung').fill(`E2E Anlegen ohne Grafik ${Date.now()}`);
  const feld = dialog.getByLabel('Einsatzort');
  await feld.fill('Bahnhofstraße 1');
  await feld.press('Enter');
  await dialog
    .getByRole('list', { name: 'Treffer' })
    .getByRole('button', { name: /Bahnhofstraße 1, 12345/ })
    .click();

  await expect(dialog.locator('[data-lfh="karte-nicht-darstellbar"]')).toHaveText(ZUSTAND);
  await keineFehlerseite(page);

  // Der Dialog bleibt bedienbar: Anlegen speichert den Ort samt Koordinate.
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const id = page.url().match(/\/einsaetze\/(\d+)/)![1];
  const einsatz = await page.request.get(`/api/einsaetze/${id}`);
  expect(await einsatz.json()).toEqual(
    expect.objectContaining({ einsatzort_lat: treffer.lat, einsatzort_lon: treffer.lon }),
  );

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

test('Evakuierung: Gebiet des Bezirks ohne Kartengrafik, Sprung bleibt', async ({ page }) => {
  const seitenFehler = await vorbereiten(page);
  const id = await einsatzAnlegen(page, `E2E Bezirk ohne Grafik ${Date.now()}`);
  const a = api(page, id);
  const bezeichnung = 'Uferstraße 12–40';
  const { id: bezirk } = await a.post('evakuierung/bezirke', {
    bezeichnung,
    plan_personen: 120,
    plan_erhebung: 'geschaetzt',
  });
  const [w, o, s, n] = [ORT.lon - 0.002, ORT.lon + 0.002, ORT.lat - 0.001, ORT.lat + 0.001];
  await a.post('zonen', {
    typ: 'evakuierungsbezirk',
    geometrie_typ: 'Polygon',
    geometrie: JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [w, s],
          [o, s],
          [o, n],
          [w, n],
          [w, s],
        ],
      ],
    }),
    evakuierungsbezirk_id: bezirk,
  });
  await page.goto(evakuierungsbezirkPfad(Number(id), bezirk));
  await ohneGrafik(page);

  const gebiet = page.getByRole('region', { name: 'Gebiet' });
  await expect(gebiet.locator('[data-lfh="karte-nicht-darstellbar"]')).toHaveText(ZUSTAND);
  await expect(zustand(page)).toHaveCount(1);
  await keineFehlerseite(page);
  await expect(
    gebiet.getByRole('img', { name: `Karte: Gebiet von Bezirk ${bezeichnung}` }),
  ).toHaveCount(0);

  // Der Rest der Seite bleibt: der Sprung führt auf die Lagekarte mit dem Bezirk.
  await gebiet.getByRole('link', { name: 'Auf Lagekarte öffnen' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/lagekarte`));
  await expect(zustand(page)).toHaveText(ZUSTAND);

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
