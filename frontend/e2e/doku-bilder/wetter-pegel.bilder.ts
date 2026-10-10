import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Wetter und Pegel“ (`docs/anwender/kapitel/wetter-pegel.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep wetter-pegel`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   wetter-pegel.png     frontend/src/pages/WetterPegelPage.tsx,
 *                        frontend/src/wetter/PegelPaneel.tsx, frontend/src/wetter/WetterPaneele.tsx
 *   warnung-offen.png    frontend/src/wetter/WetterPaneele.tsx (WarnungenPaneel)
 *   unwetter-hinweis.png frontend/src/einsatz/AlarmZentrale.tsx,
 *                        frontend/src/wetter/useUnwetterHinweis.ts
 *   pegel-festlegen.png  frontend/src/pages/einstellungen/EinsatzPegel.tsx
 *   pegel-prognose.png   frontend/src/pages/einstellungen/PegelPrognoseModal.tsx
 *
 * HERMETISCH wie `e2e/wetter-pegel.spec.ts`: Pegel, Verlauf, Wetter, Stationsliste und
 * PEGELONLINE-Vorhersage kommen per `page.route` aus Literalen in der Wire-Form von
 * `api/types.generated.ts`. Sonst ginge das Backend an PEGELONLINE und Bright Sky, und jedes Bild
 * zeigte das Wetter des Lauftags. Station „MUSTERSTADT“ am „MÜHLBACH“ passt zum Demo-Szenario
 * (`src/demo/szenario.rs`); die Werte sind ausgedacht und maßvoll.
 */

const KAPITEL = 'wetter-pegel';
const MIN = 60_000;
const vor = (ms: number) => new Date(Date.now() - ms).toISOString();
const nach = (ms: number) => new Date(Date.now() + ms).toISOString();
/** Prognose-Zeitpunkte speichert der Server als UTC ohne Zone (`YYYY-MM-DD HH:MM:SS`). */
const ohneZone = (iso: string) => iso.slice(0, 19).replace('T', ' ');

const UUID_MUSTERSTADT = '7d4b2c1e-5a3f-4e8b-9c6d-1f2a3b4c5d6e';
const UUID_OBERDORF = '2e8f6a4c-1b3d-4f5e-8a7b-9c0d1e2f3a4b';

const PEGEL = [
  {
    id: 1,
    station_uuid: UUID_MUSTERSTADT,
    name: 'MUSTERSTADT',
    gewaesser: 'MÜHLBACH',
    reihenfolge: 0,
    messung: { wasserstand_cm: 312, zeitpunkt: vor(10 * MIN), trend_cm_pro_h: 4.5 },
    prognose: {
      hoechststand_cm: 335,
      zeitpunkt: ohneZone(nach(5 * 60 * MIN)),
      gesetzt_at: ohneZone(vor(20 * MIN)),
    },
  },
  {
    id: 2,
    station_uuid: UUID_OBERDORF,
    name: 'OBERDORF',
    gewaesser: 'MÜHLBACH',
    reihenfolge: 1,
    messung: { wasserstand_cm: 188, zeitpunkt: vor(10 * MIN), trend_cm_pro_h: 0.4 },
  },
];

/** 24 h im Viertelstundentakt: langsamer Anstieg, zuletzt flacher. */
const VERLAUF = [
  {
    pegel_id: 1,
    punkte: Array.from({ length: 96 }, (_, i) => ({
      zeitpunkt: vor((95 - i) * 15 * MIN),
      wasserstand_cm: Math.round(205 + 107 * Math.sin((i / 95) * (Math.PI / 2))),
    })),
  },
  {
    pegel_id: 2,
    punkte: Array.from({ length: 96 }, (_, i) => ({
      zeitpunkt: vor((95 - i) * 15 * MIN),
      wasserstand_cm: Math.round(150 + 38 * (i / 95)),
    })),
  },
];

const WETTER = {
  ort: { name: 'Musterstadt', kreis: 'Landkreis Musterland', land: 'Niedersachsen' },
  warnungen: {
    zustand: 'ok',
    abgerufen_at: vor(4 * MIN),
    daten: [
      {
        stufe: 'maessig',
        ereignis: 'DAUERREGEN',
        ueberschrift: 'Amtliche WARNUNG vor DAUERREGEN',
        beschreibung:
          'Es tritt Dauerregen auf. Dabei werden Niederschlagsmengen zwischen 25 l/m² und ' +
          '40 l/m² erwartet.',
        handlungsempfehlung:
          'Achten Sie auf ansteigende Wasserstände an Bächen und Flüssen sowie auf ' +
          'überflutete Straßen.',
        beginn: vor(3 * 60 * MIN),
        ende: nach(9 * 60 * MIN),
      },
      {
        stufe: 'schwer',
        ereignis: 'HEFTIGER STARKREGEN',
        ueberschrift: 'Amtliche UNWETTERWARNUNG vor HEFTIGEM STARKREGEN',
        beschreibung:
          'Es tritt heftiger Starkregen mit Niederschlagsmengen um 30 l/m² pro Stunde auf.',
        handlungsempfehlung: 'Halten Sie Abflüsse frei und meiden Sie Unterführungen.',
        beginn: nach(3 * 60 * MIN),
        ende: nach(6 * 60 * MIN),
      },
    ],
  },
  vorhersage: {
    zustand: 'ok',
    abgerufen_at: vor(12 * MIN),
    daten: {
      station: 'MUSTERSTADT',
      entfernung_m: 3800,
      stunden: Array.from({ length: 25 }, (_, i) => ({
        zeitpunkt: new Date(
          Math.floor(Date.now() / 3_600_000) * 3_600_000 + i * 3_600_000,
        ).toISOString(),
        temperatur_c: 14 - Math.abs(12 - i) * 0.3,
        niederschlag_mm: i >= 3 && i <= 6 ? 8.5 : 1.2,
        niederschlag_wahrscheinlichkeit: i >= 3 && i <= 6 ? 90 : 60,
        wind_kmh: 18,
        boeen_kmh: i >= 3 && i <= 6 ? 52 : 34,
        windrichtung_grad: 240,
      })),
    },
  },
  aktuell: {
    zustand: 'ok',
    abgerufen_at: vor(6 * MIN),
    daten: {
      gemessen_at: vor(20 * MIN),
      station: { name: 'Musterstadt', entfernung_m: 3800 },
      symbol: 'regen',
      temperatur_c: 13.6,
      taupunkt_c: 12.9,
      luftfeuchte_prozent: 95,
      luftdruck_hpa: 1004.2,
      sicht_m: 6000,
      bewoelkung_prozent: 100,
      wind_kmh: 18,
      windrichtung_grad: 240,
      boeen_kmh: 37,
      niederschlag_mm: 2.4,
      ergaenzt: [],
    },
  },
};

const STATIONEN = {
  quelle: 'pegelonline',
  status: 'ok',
  attribution: 'WSV',
  features: {
    type: 'FeatureCollection',
    features: [
      ['MUSTERSTADT', UUID_MUSTERSTADT, 12.4],
      ['OBERDORF', UUID_OBERDORF, 4.1],
      ['UNTERWEHR', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', 21.7],
    ].map(([titel, uuid, km]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [9.6, 52.4] },
      properties: { titel, kategorie: 'pegel', uuid, gewaesser: 'MÜHLBACH', km },
    })),
  },
};

const VORHERSAGE = {
  vorhersage: {
    abschaetzung: false,
    erstellt: vor(45 * MIN),
    hoechststand_cm: 338,
    zeitpunkt: nach(6 * 60 * MIN),
  },
};

/** Siehe `lagebild.bilder.ts`: der Testbrowser meldet Benachrichtigungen sonst als gesperrt. */
async function benachrichtigungErlaubt(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
  });
}

/**
 * Stellt alle externen Daten auf die Literale oben; Schreibwege gehen an den Server. Ohne
 * `pegelListe` liest die Seite die festgelegten Pegel vom Server (für einen Schreibweg, dessen
 * Kennungen der Server vergibt).
 */
async function stelle(page: Page, einsatzId: number, pegelListe = true) {
  if (pegelListe)
    await page.route(`**/api/einsaetze/${einsatzId}/pegel`, (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: PEGEL }) : route.continue(),
    );
  await page.route(`**/api/einsaetze/${einsatzId}/pegel/verlauf`, (route) =>
    route.fulfill({ json: VERLAUF }),
  );
  await page.route(`**/api/einsaetze/${einsatzId}/pegel/*/vorhersage`, (route) =>
    route.fulfill({ json: VORHERSAGE }),
  );
  await page.route(`**/api/einsaetze/${einsatzId}/wetter`, (route) =>
    route.fulfill({ json: WETTER }),
  );
  await page.route('**/api/karte/fachebenen/pegelonline*', (route) =>
    route.fulfill({ json: STATIONEN }),
  );
}

async function vorbereiten(page: Page, pegelListe = true): Promise<number> {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await stelle(page, demo.id, pegelListe);
  await uhrAnhalten(page);
  return demo.id;
}

/**
 * Die angekündigte Unwetterwarnung löst beim ersten Laden den Hinweis der AlarmZentrale aus. Er
 * läge über dem Pegel bzw. dem Paneel; er hat ein eigenes Bild.
 */
async function unwetterHinweisSchliessen(page: Page) {
  const hinweis = page.locator('.ant-notification-notice').filter({ hasText: 'Unwetterwarnung' });
  await hinweis.locator('.ant-notification-notice-close').click();
  await expect(hinweis).toHaveCount(0);
}

test.describe(KAPITEL, () => {
  test('Seite Wetter und Pegel', async ({ page }) => {
    await benachrichtigungErlaubt(page);
    const id = await vorbereiten(page);
    await page.goto(`/einsaetze/${id}/wetter-pegel`);
    await expect(page.locator('[data-lfh="pegel-zeile"]')).toHaveCount(2);
    await expect(page.getByLabel('Vorhersage je drei Stunden')).toBeVisible();
    await unwetterHinweisSchliessen(page);
    await fotografiere(page, KAPITEL, 'wetter-pegel');
    // Ablauf weiter: vom Seitenkopf zu den maßgeblichen Pegeln.
    await page.getByRole('button', { name: 'Pegel festlegen' }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/einstellungen/pegel`));
  });

  test('Hinweis auf eine neue Unwetterwarnung', async ({ page }) => {
    const id = await vorbereiten(page);
    await page.goto(`/einsaetze/${id}/ueberblick`);
    const hinweis = page.locator('.ant-notification-notice').filter({ hasText: 'Unwetterwarnung' });
    await expect(hinweis.getByRole('button', { name: 'Öffnen' })).toBeVisible();
    await fotografiere(hinweis, KAPITEL, 'unwetter-hinweis');
    await hinweis.getByRole('button', { name: 'Öffnen' }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/wetter-pegel$`));
  });

  test('Warnung mit Beschreibung und Handlungsempfehlung', async ({ page }) => {
    const id = await vorbereiten(page);
    await page.goto(`/einsaetze/${id}/wetter-pegel`);
    const paneel = page.getByRole('region', { name: 'Warnungen (DWD)' });
    await paneel
      .getByRole('button', { name: /^Beschreibung und Handlungsempfehlung zu Dauerregen/i })
      .click();
    await expect(paneel.getByText('Handlungsempfehlung', { exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(paneel, KAPITEL, 'warnung-offen');
    await paneel.getByRole('button', { name: /^Beschreibung ausblenden/ }).click();
    await expect(paneel.getByText('Handlungsempfehlung', { exact: true })).toBeHidden();
  });

  test('Maßgebliche Pegel in den Einstellungen', async ({ page }) => {
    const id = await vorbereiten(page);
    await page.goto(`/einsaetze/${id}/einstellungen/pegel`);
    const paneel = page.getByRole('region', { name: 'Maßgebliche Pegel' });
    await expect(paneel.locator('[data-lfh="leitpegel"]')).toBeVisible();
    await expect(paneel.locator('[data-lfh="pegel-prognose"]')).toBeVisible();
    await unwetterHinweisSchliessen(page);
    await fotografiere(paneel, KAPITEL, 'pegel-festlegen');
    await waehleIn(
      paneel.getByRole('combobox', { name: 'Station wählen' }),
      'UNTERWEHR · MÜHLBACH · km 21,7',
    );
    await paneel.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText('Pegel gespeichert')).toBeVisible();
  });

  test('Dialog Prognose', async ({ page }) => {
    const id = await vorbereiten(page, false);
    await fuelle(page, 'put', `/api/einsaetze/${id}/pegel`, {
      stationen: PEGEL.map((p) => ({
        station_uuid: p.station_uuid,
        name: p.name,
        gewaesser: p.gewaesser,
      })),
    });
    await page.goto(`/einsaetze/${id}/einstellungen/pegel`);
    await unwetterHinweisSchliessen(page);
    await page.getByRole('button', { name: 'Aktionen zu Pegel MUSTERSTADT' }).click();
    await page.getByRole('menuitem', { name: 'Prognose erfassen …' }).click();
    const dialog = page.getByRole('dialog', { name: 'Prognose — MUSTERSTADT' });
    const vorschlag = dialog.locator('[data-lfh="pegel-vorhersage"]');
    await vorschlag.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(dialog.getByLabel('Erwarteter Höchststand (m)')).toHaveValue('3,38');
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'pegel-prognose');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Prognose gespeichert')).toBeVisible();
    await expect(page.locator('[data-lfh="pegel-prognose"]')).toBeVisible();
  });
});
