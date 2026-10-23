import { expect, test, type Locator, type Page } from '@playwright/test';
import { einsatzdatenPfad } from '../src/routing/deeplinks';
import { einsatzDialogOeffnen } from './einsatz-kern';
import { kachelnBeantworten, kartenConfigBeantworten } from './kartenFixture';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * LFH-1175, Spec `ortsfeld` und `einsatzdaten-bearbeitung`: den Einsatzort über die Ortssuche
 * erfassen — in den Einsatzdaten (Paneel „Einsatzort“) und im Dialog „Neuen Einsatz anlegen“.
 * LLH-1108: Vorschau mit Nadel und Ort-Zeile am Feld, Nadel ziehen, „Auf Karte wählen“ ohne Netz.
 * LLH-1376: Ortsname als Vorschlag auch beim Anlegen, über die Ort-Vorschau der Organisation.
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

/** Ortsname der Rückwärtssuche; weicht vom Treffer ab, damit ein Vorschlag sichtbar wird. */
const ORTSNAME = 'Marktplatz 3, 12345 Musterstadt';

/**
 * Fängt beide Such-Einstiege des Ortsfelds und die Ort-Vorschau ab; zählt die Suchtexte mit.
 * Die Ort-Vorschau rechnet die Peilung sonst echt, fragt für den Ortsnamen aber den Geocoder.
 */
async function geocoder(page: Page) {
  const anfragen: string[] = [];
  const antwort = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    anfragen.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    await route.fulfill({ json: { zustand: 'ok', treffer: [TREFFER] } });
  };
  await page.route(/\/api\/einsaetze\/\d+\/ort-suche\?/, antwort);
  await page.route(/\/api\/ort-suche\?/, antwort);
  await page.route(/\/api\/einsaetze\/\d+\/ort-vorschau\?/, (route) =>
    route.fulfill({
      json: {
        ortsname: ORTSNAME,
        peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'UHS Nord' },
      },
    }),
  );
  // Ohne Einsatz (LLH-1376): nur der Ortsname, keine Peilung.
  await page.route(/\/api\/ort-vorschau\?/, (route) =>
    route.fulfill({ json: { ortsname: ORTSNAME } }),
  );
  return anfragen;
}

/** Zieht die Nadel mit der Maus 60 px nach rechts (schrittweise, ein `dragTo` zöge nicht). */
async function nadelZiehen(page: Page, nadel: Locator) {
  const kasten = (await nadel.boundingBox())!;
  const x = kasten.x + kasten.width / 2;
  const y = kasten.y + kasten.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 5 });
  await page.mouse.move(x + 60, y, { steps: 5 });
  await page.mouse.up();
}

async function einsatzAnlegenApi(page: Page, ort: Record<string, unknown> = {}): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Einsatzort ${Date.now()}`, ...ort },
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
  // Vorschau am Feld (LLH-1108): Nadel und Ort-Zeile; der Text stammt aus dem Treffer, also
  // kein Vorschlag.
  const vorschau = paneel(page).getByRole('group', { name: 'Karte: Einsatzort' });
  await expect(vorschau.getByRole('button', { name: 'Einsatzort' })).toBeVisible();
  await expect(paneel(page).getByText(`${ORTSNAME} · `, { exact: false })).toBeVisible();
  await expect(paneel(page).getByRole('button', { name: 'Als Adresse übernehmen' })).toHaveCount(0);
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
  await expect(dialog.getByRole('group', { name: 'Karte: Einsatzort' })).toBeVisible();

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

test('Einsatz anlegen: Nadel ziehen schlägt den Ortsnamen vor, ohne Einsatz und ohne Peilung', async ({
  page,
}) => {
  await geocoder(page);
  await anmeldenAlsAdmin(page);
  const dialog = await einsatzDialogOeffnen(page);
  await dialog.getByLabel('Bezeichnung').fill(`E2E Anlegen Nadel ${Date.now()}`);
  // Nach der Wahl heißen auch Karte und Nadel „Einsatzort“: das Feld über seine Rolle.
  const feld = dialog.getByRole('textbox', { name: 'Einsatzort' });
  await feld.fill('Bahnhofstraße 1');
  await feld.press('Enter');
  await dialog
    .getByRole('list', { name: 'Treffer' })
    .getByRole('button', { name: /Bahnhofstraße 1, 12345/ })
    .click();
  const nadel = dialog
    .getByRole('group', { name: 'Karte: Einsatzort' })
    .getByRole('button', { name: 'Einsatzort' });
  await expect(nadel).toBeVisible();
  // Der Text stammt aus dem Treffer: noch kein Vorschlag.
  await expect(dialog.getByRole('button', { name: 'Als Adresse übernehmen' })).toHaveCount(0);

  await nadelZiehen(page, nadel);
  await expect(feld).toHaveValue(TREFFER.kurz);
  await expect(dialog.getByText(ORTSNAME, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Als Adresse übernehmen' }).click();
  await expect(feld).toHaveValue(ORTSNAME);

  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const id = Number(page.url().match(/\/einsaetze\/(\d+)/)![1]);
  const e = await einsatzLesen(page, id);
  expect(e.einsatzort).toBe(ORTSNAME);
  expect(e.einsatzort_lon!).toBeGreaterThan(TREFFER.lon);
});

test('Einsatzdaten: Nadel ziehen berichtigt die Koordinate, der Ortsname kommt als Vorschlag', async ({
  page,
}) => {
  await geocoder(page);
  await anmeldenAlsAdmin(page);
  const id = await einsatzAnlegenApi(page, {
    einsatzort: 'Hinter der Halle',
    einsatzort_lat: TREFFER.lat,
    einsatzort_lon: TREFFER.lon,
  });
  await page.goto(einsatzdatenPfad(id));
  await paneel(page).getByRole('button', { name: 'Adresse bearbeiten' }).click();
  const vorschau = paneel(page).getByRole('group', { name: 'Karte: Einsatzort' });
  const nadel = vorschau.getByRole('button', { name: 'Einsatzort' });
  await expect(nadel).toBeVisible();

  await nadelZiehen(page, nadel);

  // Der Text bleibt; der Ortsname der neuen Stelle steht als Vorschlag da.
  await expect(paneel(page).getByRole('textbox', { name: 'Adresse' })).toHaveValue(
    'Hinter der Halle',
  );
  await paneel(page).getByRole('button', { name: 'Als Adresse übernehmen' }).click();
  await expect(paneel(page).getByRole('textbox', { name: 'Adresse' })).toHaveValue(ORTSNAME);
  await paneel(page).getByRole('button', { name: 'Adresse speichern' }).click();

  await expect
    .poll(async () => {
      const e = await einsatzLesen(page, id);
      return e.einsatzort === ORTSNAME && e.einsatzort_lon! > TREFFER.lon;
    })
    .toBe(true);
  const e = await einsatzLesen(page, id);
  // Nach rechts gezogen: Osten, gleiche Breite (bis auf Rundung des Zugs).
  expect(e.einsatzort_lat!).toBeCloseTo(TREFFER.lat, 3);
});

test('Einsatzdaten: ohne Netz „Auf Karte wählen“ mit Offline-Karte, gespeichert wieder online', async ({
  page,
  context,
}) => {
  await geocoder(page);
  // Kartengrundlage aus der Fixture: nur eine Offline-Region, keine Online-Karte.
  await kartenConfigBeantworten(page, {
    offline_regionen: [
      {
        karte_id: 1,
        name: 'Fixture',
        tiles_url: '/api/karten/1/tiles/{z}/{x}/{y}.pbf',
        format: 'vektor',
        maxzoom: 14,
      },
    ],
  });
  await kachelnBeantworten(page, '/api/karten/1/tiles/', 'strassen');
  await anmeldenAlsAdmin(page);
  const id = await einsatzAnlegenApi(page);
  await page.goto(einsatzdatenPfad(id));
  await paneel(page).getByRole('button', { name: 'Adresse eintragen' }).click();
  const feld = paneel(page).getByRole('textbox', { name: 'Adresse' });
  await feld.fill('Waldweg hinter Sportplatz');
  await expect(paneel(page).getByRole('button', { name: 'Auf Karte wählen' })).toBeVisible();

  await context.setOffline(true);
  await expect(paneel(page).getByText('Adresssuche ohne Netz nicht verfügbar')).toBeVisible();
  await expect(paneel(page).getByRole('button', { name: 'Ort suchen' })).toBeDisabled();

  await paneel(page).getByRole('button', { name: 'Auf Karte wählen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Einsatzort auf Karte wählen' });
  await expect(dialog.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  const karte = dialog.getByRole('application', { name: 'Karte: Einsatzort' });
  await expect(karte.locator('canvas')).toBeVisible();
  await karte.click({ position: { x: 120, y: 90 } });
  await expect(karte.getByLabel('Einsatzort', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog).toBeHidden();

  // Der Text bleibt, die Vorschau steht.
  await expect(feld).toHaveValue('Waldweg hinter Sportplatz');
  await expect(
    paneel(page).getByRole('group', { name: 'Karte: Einsatzort' }).getByRole('button', {
      name: 'Einsatzort',
    }),
  ).toBeVisible();

  await context.setOffline(false);
  await paneel(page).getByRole('button', { name: 'Adresse speichern' }).click();
  await expect.poll(async () => (await einsatzLesen(page, id)).einsatzort_lat).not.toBeNull();
  expect((await einsatzLesen(page, id)).einsatzort).toBe('Waldweg hinter Sportplatz');
});

test.describe('Handy 390 px', () => {
  const BREITE = 390;
  test.use({ viewport: { width: BREITE, height: 844 } });

  async function keinQuerlauf(page: Page, kaesten: Locator[], wo: string) {
    const breite = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(breite, `${wo}: documentElement.scrollWidth`).toBeLessThanOrEqual(BREITE);
    for (const k of kaesten) {
      const b = await k.boundingBox();
      expect(b, `${wo}: ohne Kasten`).not.toBeNull();
      expect(b!.x + b!.width, `${wo}: rechte Kante`).toBeLessThanOrEqual(BREITE);
    }
  }

  // LFH-435: die Bearbeitung hängt am Schreibrecht, gemessen wird auch nicht-privilegiert.
  for (const rolle of ['admin', 'fuehrungspersonal'] as const) {
    test(`${rolle}: Paneel Einsatzort mit offener Suche und Koordinate läuft nicht über`, async ({
      page,
    }) => {
      await geocoder(page);
      await anmeldenAlsAdmin(page);
      const id = await einsatzAnlegenApi(page);
      if (rolle === 'fuehrungspersonal') await wechsleZuRolle(page, rolle, String(id));
      await page.goto(einsatzdatenPfad(id));
      // Vorbedingung des Rollenzweigs: die Zeile ist bedienbar, kein „Nur Ansicht“.
      await expect(paneel(page).getByRole('button', { name: 'Adresse eintragen' })).toBeVisible();

      await paneel(page).getByRole('button', { name: 'Adresse eintragen' }).click();
      const feld = paneel(page).getByRole('textbox', { name: 'Adresse' });
      await feld.fill('Bahnhofstraße 1');
      await feld.press('Enter');
      const treffer = paneel(page).getByRole('list', { name: 'Treffer' });
      await expect(treffer).toBeVisible();
      await keinQuerlauf(
        page,
        [paneel(page), treffer, paneel(page).getByRole('button', { name: 'Ort suchen' })],
        'Adresse mit Treffern',
      );
      // Nach der Wahl: Vorschau mit Nadel, Ort-Zeile und „Auf Karte wählen“ (LLH-1108).
      await treffer.getByRole('button', { name: /Bahnhofstraße 1, 12345/ }).click();
      const vorschau = paneel(page).getByRole('group', { name: 'Karte: Einsatzort' });
      await expect(vorschau.getByRole('button', { name: 'Einsatzort' })).toBeVisible();
      await keinQuerlauf(
        page,
        [
          paneel(page),
          vorschau,
          paneel(page).getByText(`${ORTSNAME} · `, { exact: false }),
          paneel(page).getByRole('button', { name: 'Auf Karte wählen' }),
        ],
        'Adresse mit Vorschau',
      );
      await paneel(page).getByRole('button', { name: 'Bearbeitung von Adresse abbrechen' }).click();

      await paneel(page).getByRole('button', { name: 'Koordinate eintragen' }).click();
      await paneel(page).getByRole('textbox', { name: 'Koordinate' }).fill('53.07750, 8.81000');
      await keinQuerlauf(
        page,
        [paneel(page), paneel(page).getByRole('button', { name: 'Koordinate speichern' })],
        'Koordinate in Bearbeitung',
      );
    });
  }
});
