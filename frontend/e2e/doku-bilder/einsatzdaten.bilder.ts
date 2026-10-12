import type { APIRequestContext, Page } from '@playwright/test';
import {
  kachelnBeantworten,
  kartenConfigBeantworten,
  vektorStilBeantworten,
} from '../kartenFixture';
import {
  apiAlsAdmin,
  anmelden,
  demoEinsatz,
  einsatzleiterFuellen,
  expect,
  fotografiere,
  fuehrungsstelleOrtFuellen,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Einsatzdaten und Führungsstelle“ (`docs/anwender/kapitel/einsatzdaten.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatzdaten`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   einsatzdaten.png          frontend/src/pages/EinsatzdatenPage.tsx, frontend/src/anzeige/Kartenausschnitt.tsx
 *   einsatzort.png            frontend/src/pages/EinsatzdatenPage.tsx (EinsatzortPaneel), frontend/src/anzeige/Ortsfeld.tsx
 *   fuehrungsstelle.png       frontend/src/pages/EinsatzdatenPage.tsx (FuehrungsstellePaneel)
 *
 * Den Dialog „Führungsstelle für …“ eines Mitglieds zeigt seit LFH-1170 das Kapitel „Rechte im
 * Einsatz“ (`rechte-im-einsatz.bilder.ts`): der Zugriff liegt in den Einstellungen.
 *
 * Füllung (D3): der Demo-Einsatz trägt nur Bezeichnung, Stichwort, Art und Alarmzeit. Einsatzort,
 * Koordinate, Erstmeldung und die eigene Führungsstelle samt Bezeichnung, Standort (LFH-1181),
 * Einsatzleiter (LFH-1199) und zwei einsatzlokalen Sprechgruppen kommen über die API, jeweils nur,
 * wenn sie noch fehlen (ein Lauf aller Kapitel teilt eine Datenbank). Kartengrundlage und
 * Ortssuche ohne Netz: Kacheln aus `e2e/kartenFixture.ts`, die Treffer der Ortssuche per
 * `page.route` (kein Geocoder im Bildlauf).
 */

const KAPITEL = 'einsatzdaten';
const STIL_PFAD = '/api/karte/proxy/9/style.json';
const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';

/** Kartengrundlage des Kartenausschnitts aus der Fixture (docs/anwender/AGENTS.md, „Bilder“). */
async function kartengrundlage(page: Page) {
  await kartenConfigBeantworten(page, {
    online_styles: [{ name: 'Kachel-Fixture', typ: 'vektor', url: STIL_PFAD }],
  });
  await vektorStilBeantworten(page, STIL_PFAD, {
    id: 'fixture',
    kachelVorlage: `${KACHEL_PRAEFIX}{z}/{x}/{y}.pbf`,
    layer: 'strassen',
  });
  await kachelnBeantworten(page, KACHEL_PRAEFIX, 'strassen');
}

/** Treffer der Ortssuche, ohne Geocoder. */
async function ortssuche(page: Page) {
  await page.route(/\/api\/einsaetze\/\d+\/ort-suche\?/, (route) =>
    route.fulfill({
      json: {
        zustand: 'ok',
        treffer: [
          {
            lat: 50.9525,
            lon: 10.2465,
            name: 'Mühlbachstraße 12, Nord, Musterstadt, Landkreis Muster, 12345, Deutschland',
            kurz: 'Mühlbachstraße 12, 12345 Musterstadt',
          },
          {
            lat: 50.9318,
            lon: 10.2711,
            name: 'Mühlbachstraße, Süd, Musterstadt, Landkreis Muster, 12347, Deutschland',
            kurz: 'Mühlbachstraße, 12347 Musterstadt',
          },
        ],
      },
    }),
  );
}

interface Sprechgruppe {
  id: number;
  bezeichnung: string;
  betriebsart: 'TMO' | 'DMO';
}

/** Einsatzlokale Sprechgruppe, angelegt nur, wenn es sie im Einsatz noch nicht gibt. */
async function sprechgruppe(
  api: APIRequestContext,
  einsatzId: number,
  bezeichnung: string,
  betriebsart: 'TMO' | 'DMO',
): Promise<Sprechgruppe> {
  const liste = await api.get(`/api/einsaetze/${einsatzId}/sprechgruppen`);
  expect(liste.ok(), `Sprechgruppen: ${liste.status()}`).toBe(true);
  const vorhanden = ((await liste.json()) as Sprechgruppe[]).find(
    (s) => s.bezeichnung === bezeichnung,
  );
  return (
    vorhanden ??
    fuelle<Sprechgruppe>(api, 'post', `/api/einsaetze/${einsatzId}/sprechgruppen`, {
      bezeichnung,
      betriebsart,
    })
  );
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    const demo = await demoEinsatz(api);
    const id = demo.id;
    const einsatz = await (await api.get(`/api/einsaetze/${id}`)).json();
    if (!einsatz.einsatzort) {
      await fuelle(api, 'patch', `/api/einsaetze/${id}`, {
        einsatzort: 'Musterstadt, Mühlbachstraße 12',
        einsatzort_lat: 50.9525,
        einsatzort_lon: 10.2465,
        meldende_stelle: 'Integrierte Leitstelle Musterstadt',
        sachverhalt:
          'Starkregen seit dem Morgen, Mühlbach über die Ufer getreten. Keller und Straßen im ' +
          'Ortsteil Nord überflutet, Evakuierung einzelner Straßenzüge.',
        anzahl_betroffene_initial: 40,
        naechste_lagebesprechung_at: new Date(Date.now() + 45 * 60_000).toISOString(),
      });
    }
    const sg1 = await sprechgruppe(api, id, 'TMO 311_F_EL', 'TMO');
    const sg2 = await sprechgruppe(api, id, 'DMO 505', 'DMO');
    const fs = await (await api.get(`/api/einsaetze/${id}/fuehrungsstelle`)).json();
    if (!fs.rufname) {
      const fahrzeuge = (await (await api.get(`/api/einsaetze/${id}/fahrzeuge`)).json()) as {
        id: number;
        funkrufname: string;
      }[];
      const elw = fahrzeuge.find((f) => f.funkrufname === 'Musterstadt 11-1') ?? fahrzeuge[0];
      await fuelle(api, 'patch', `/api/einsaetze/${id}/fuehrungsstelle`, {
        rufname: 'Florian Musterstadt 11-1',
        kommunikationsmittel: 'digitalfunk',
        erreichbarkeit: '0561 123 4567',
        sprechgruppe_ids: [sg1.id, sg2.id],
        fahrzeug_ids: elw ? [elw.id] : [],
      });
    }
    await fuehrungsstelleOrtFuellen(api, id);
    await einsatzleiterFuellen(api, demo);
    await api.dispose();
  });

  test('Einsatzdaten mit Kennungen, Kopfleiste und Paneelen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await kartengrundlage(page);
    const ortVorschau = page.waitForResponse((r) => r.url().includes('/ort-vorschau'));
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten`);
    await expect(page.getByRole('region', { name: 'Erstmeldung' })).toBeVisible();
    await ortVorschau;
    await expect(page.getByText('Integrierte Leitstelle Musterstadt')).toBeVisible();
    // Die Ortszeile unter der Koordinate fragt den Server; ohne Netz bleibt sie leer.
    await expect(page.getByText('Ort wird ermittelt …')).toHaveCount(0);
    await fotografiere(page, KAPITEL, 'einsatzdaten');
  });

  test('Paneel „Einsatzort“ mit Treffern der Ortssuche', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await kartengrundlage(page);
    await ortssuche(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten`);
    const paneel = page.getByRole('region', { name: 'Einsatzort' });
    await expect(paneel.getByRole('img', { name: 'Karte: Einsatzort' })).toBeVisible();
    await paneel.getByRole('button', { name: 'Adresse bearbeiten' }).click();
    const feld = paneel.getByRole('textbox', { name: 'Adresse' });
    await feld.fill('Mühlbachstraße');
    await feld.press('Enter');
    await expect(paneel.getByRole('list', { name: 'Treffer' })).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'einsatzort');
  });

  test('Paneel „Eigene Führungsstelle“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten`);
    const paneel = page.getByRole('region', { name: 'Eigene Führungsstelle' });
    await expect(paneel.getByText('Florian Musterstadt 11-1')).toBeVisible();
    await expect(paneel.getByText('ELW 2 Musterstadt')).toBeVisible();
    await expect(paneel.getByText('Max Mustermann')).toBeVisible();
    await expect(paneel.getByText('Musterstadt 11-1', { exact: false }).last()).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'fuehrungsstelle');
  });
});
