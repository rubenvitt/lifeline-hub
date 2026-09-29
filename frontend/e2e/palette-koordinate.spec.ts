import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Sprungpalette — die zwei Wege, deren Wirkung erst im Browser sichtbar ist:
 *
 * 1. Koordinatensprung: ob die ECHTE Karte danach auf der Stelle steht, hängt an MapLibre und
 *    am Zusammenspiel von Anflug und Startansicht — gemessen wird der Kartenmittelpunkt über
 *    den DEV-Haken `window.__lfhKarte`, nicht die URL.
 * 2. ETB-Sammeltreffer: die Zahl der Zählroute muss zur gefilterten ETB-Seite passen.
 *
 * Seeding per `page.request`; kein `networkidle` (SSE-Strom).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.setTimeout(120_000);

/** Die Stelle, auf die gesprungen wird — weit weg vom Einsatzort, damit ein Anflug messbar ist. */
const ZIEL = { lat: 52.52194, lon: 13.41321 };
/** Der Einsatzort, auf dem die Karte ohne Sprung stünde. */
const ORT = { lat: 48.13743, lon: 11.57549 };

type MapHaken = { getCenter(): { lng: number; lat: number } };

function paletteInput(page: Page): Locator {
  return page.getByPlaceholder(/Suchen: Module/);
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

async function zumModul(page: Page, id: string, modul: string) {
  await page.goto(`/einsaetze/${id}/${modul}`);
  await expect(page.locator('header').first()).toBeVisible();
}

async function suche(page: Page, begriff: string) {
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await paletteInput(page).fill(begriff);
}

test('eine getippte Koordinate springt auf die Lagekarte, und die Karte steht dort', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Koordinate ${Date.now()}`);

  // Einsatzort setzen: sonst wäre „die Karte steht auf dem Ziel" von „stand schon da" nicht
  // sicher zu trennen. Der Kopf-PATCH ist ein VOLLERSATZ (`KopfdatenUpdate`).
  const e = (await (await page.request.get(`/api/einsaetze/${einsatzId}`)).json()) as Record<
    string,
    unknown
  >;
  const patch = await page.request.patch(`/api/einsaetze/${einsatzId}`, {
    data: {
      bezeichnung: e.bezeichnung,
      stichwort: e.stichwort ?? null,
      einsatzart: e.einsatzart,
      leitstellen_nr: e.leitstellen_nr ?? null,
      einsatzort: 'München',
      einsatzort_lat: ORT.lat,
      einsatzort_lon: ORT.lon,
      meldende_stelle: e.meldende_stelle ?? null,
      sachverhalt: e.sachverhalt ?? null,
      anzahl_betroffene_initial: e.anzahl_betroffene_initial ?? null,
      begonnen_at: e.begonnen_at,
    },
  });
  expect(patch.ok(), await patch.text()).toBeTruthy();

  await zumModul(page, einsatzId, 'etb');
  await suche(page, `${ZIEL.lat}, ${ZIEL.lon}`);

  // Die Kartenzeile steht OBEN und ist vorausgewählt — ein Enter genügt.
  const erste = page.getByRole('option').first();
  await expect(erste).toContainText('Auf Lagekarte zeigen');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lagekarte$`));
  await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
    1,
  );
  // Der Anflug ist animiert und die Startansicht lädt parallel — gepollt, bis der Mittelpunkt
  // steht. Gewänne die Startansicht, stünde die Karte in München.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          if (!map) return null;
          const c = map.getCenter();
          return { lat: c.lat, lon: c.lng };
        }),
      { timeout: 20_000, message: 'Karte steht nicht auf der getippten Koordinate' },
    )
    .toEqual({ lat: expect.closeTo(ZIEL.lat, 3), lon: expect.closeTo(ZIEL.lon, 3) });
});

test('der ETB-Sammeltreffer nennt die Trefferzahl und springt auf die gefilterte Seite', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Sammeltreffer ${Date.now()}`);

  // Sequentiell: `lfd_nr` wird per MAX+1 vergeben.
  for (const inhalt of ['Deich Nord durchfeuchtet', 'Sandsäcke an den Deich', 'Lage ruhig']) {
    const r = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: { typ: 'meldung', inhalt },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }

  await zumModul(page, einsatzId, 'personen');
  await suche(page, 'deich');

  const sammel = page.getByRole('option', { name: 'Alle Einträge zu „deich“' });
  await expect(sammel).toBeVisible();
  await expect(sammel.locator('[id$="-kontext"]')).toHaveText('ETB · 2 Treffer');
  await sammel.click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb\\?q=deich$`));
  await expect(page.getByPlaceholder('Volltextsuche')).toHaveValue('deich');
  // Die Zahl war keine eigene Meinung: die Seite zeigt genau diese zwei Einträge.
  await expect(page.getByText('Deich Nord durchfeuchtet')).toBeVisible();
  await expect(page.getByText('Sandsäcke an den Deich')).toBeVisible();
  await expect(page.getByText('Lage ruhig')).toHaveCount(0);
});
