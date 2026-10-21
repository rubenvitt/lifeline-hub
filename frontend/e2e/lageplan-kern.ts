import { expect, type APIResponse, type Page } from '@playwright/test';
import { api, einsatzAnlegen } from './fernmeldeskizze-kern';
import {
  kachelnBeantworten,
  kartenConfigBeantworten,
  vektorStilBeantworten,
} from './kartenFixture';
import { pngMitMassen } from './pdf-kern';

/**
 * Hilfen der Lageplan-Specs (LLH-1051): `lagekarte-druck.spec.ts` und
 * `lagekarte-lageplan-anlage.spec.ts`. Eine eigene Kartengrundlage ohne Netz
 * (`kartenFixture.ts`), ein Einsatz mit Einheit, Gefahrenzone samt Warnstufe und einer
 * Abschnittsfläche, deren Modul ausgeblendet ist.
 */

/** Um diesen Punkt liegt alles, im Startausschnitt. */
export const ORT = { lat: 49.3519, lon: 9.1457 };

const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';
const KACHEL_LAYER = 'strassen';
export const GRUNDLAGE = { name: 'Fixture Lageplan', stil: '/api/karte/proxy/9/lp/style.json' };

/** Grundlage beantworten; `kacheln: false` lässt jede Kachel scheitern (fehlende Kacheln). */
export async function grundlageOhneNetz(page: Page, { kacheln = true } = {}) {
  await kartenConfigBeantworten(page, {
    online_styles: [{ name: GRUNDLAGE.name, typ: 'vektor', url: GRUNDLAGE.stil }],
  });
  await vektorStilBeantworten(page, GRUNDLAGE.stil, {
    id: 'fixture-lp',
    kachelVorlage: `${KACHEL_PRAEFIX}{z}/{x}/{y}.pbf`,
    layer: KACHEL_LAYER,
  });
  if (kacheln) await kachelnBeantworten(page, KACHEL_PRAEFIX, KACHEL_LAYER);
  else await page.route(`**${KACHEL_PRAEFIX}**`, (route) => route.fulfill({ status: 404 }));
}

function rechteck(dLon: number, dLat: number, versatzLon = 0) {
  const w = ORT.lon + versatzLon - dLon;
  const o = ORT.lon + versatzLon + dLon;
  const s = ORT.lat - dLat;
  const n = ORT.lat + dLat;
  return {
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
  };
}

/**
 * Anmelden über die API, ohne die Startseite zu laden: die erste Seite des Tests ist dann die
 * Lagekarte. Über das Formular landete die Anmeldung auf der Einsatzliste, und der Wechsel zur
 * Lagekarte per `goto` brach deren Abrufe ab, solange sie noch liefen (Einsatzliste,
 * Demo-Status, Stichwort-Vorschläge, Org-Strom samt Sitzungsprobe). WebKit meldet jeden so
 * abgebrochenen Abruf als Konsolenfehler der Seite („… due to access control checks.“), und
 * Playwright reicht den in WebKit als `pageerror` weiter: Die Specs, die Seitenfehler sammeln,
 * wurden rot, sobald die Einsatzliste langsamer aufbaute als das Seeding dauerte (CI).
 */
export async function anmeldenOhneStartseite(page: Page, benutzername: string, passwort: string) {
  const antwort = await page.request.post('/api/auth/login', { data: { benutzername, passwort } });
  expect(antwort.ok(), `Anmelden ${benutzername}: ${antwort.status()}`).toBe(true);
}

/** Bis zu drei Versuche bei 503 (SQLite-Schreibkonflikt unter parallelen Workern). */
async function mitWiederholung(anfrage: () => Promise<APIResponse>): Promise<APIResponse> {
  let antwort = await anfrage();
  for (let versuch = 1; versuch < 3 && antwort.status() === 503; versuch++) {
    await new Promise((fertig) => setTimeout(fertig, 300 * versuch));
    antwort = await anfrage();
  }
  return antwort;
}

/**
 * Organisationslogo mit denselben Bytes wie `druck-fluss.spec.ts` (97 × 41 px): ein Upsert, kein
 * Wechsel für einen parallel laufenden Logo-Fall. Die Organisation ist global, das Logo bleibt.
 */
export async function logoSetzen(page: Page) {
  const antwort = await mitWiederholung(() =>
    page.request.post('/api/organisation/logo', {
      multipart: {
        datei: { name: 'logo.png', mimeType: 'image/png', buffer: pngMitMassen(97, 41) },
      },
    }),
  );
  expect(antwort.ok(), await antwort.text()).toBe(true);
}

/** `anzahl` weitere Gefahrenzonen „Zone 1“ … um den Ort: jede steht als eigene Legendenzeile. */
export async function zonenAnlegen(page: Page, einsatzId: string, anzahl: number) {
  const a = api(page, einsatzId);
  for (let i = 1; i <= anzahl; i++) {
    await a.post('zonen', {
      typ: 'gefahrengebiet',
      geometrie_typ: 'Polygon',
      geometrie: JSON.stringify(rechteck(0.0004, 0.0003, -0.004 + (i % 8) * 0.001)),
      label: `Zone ${i}`,
    });
  }
}

/**
 * Einsatz mit einer verorteten Einheit, einer Gefahrenzone „Brandstelle“ mit Warnstufe „hoch“ und
 * einer Abschnittsfläche. Das Modul Einsatzabschnitte ist ausgeblendet: die Fläche besteht, ist
 * aber gesperrt — sie darf weder auf der Karte noch in der Legende stehen.
 */
export async function einsatzMitLage(page: Page, bezeichnung: string): Promise<string> {
  const einsatzId = await einsatzAnlegen(page, bezeichnung);
  const a = api(page, einsatzId);
  const { id: einheit } = await a.post('einheiten', { name: 'LF Lageplan' });
  await a.patch(`einheiten/${einheit}/position`, { lat: ORT.lat, lon: ORT.lon + 0.001 });
  await a.post('zonen', {
    typ: 'gefahrengebiet',
    geometrie_typ: 'Polygon',
    geometrie: JSON.stringify(rechteck(0.002, 0.001, -0.002)),
    label: 'Brandstelle',
  });
  const gebiete = await a.get<{ id: number; label: string }[]>('gefahrengebiete');
  const gid = gebiete.find((g) => g.label === 'Brandstelle')!.id;
  await a.put(`gefahrengebiete/${gid}/matrix/bewertung`, {
    gefahrentyp: 'atemgifte',
    schutzobjekt: 'menschen',
    warnstufe: 'hoch',
  });
  const { id: abschnitt } = await a.post('abschnitte', { name: 'Deich Lageplan' });
  await a.patch(`abschnitte/${abschnitt}/flaeche`, {
    flaeche_geojson: JSON.stringify(rechteck(0.002, 0.001, 0.003)),
  });
  await a.put('modul-overrides/einsatzabschnitte', { sichtbar: false, benoetigte_rolle: null });
  return einsatzId;
}

/** Was die Specs vom Testhaken `window.__lfhKarte` brauchen — nachgebildet, nicht importiert. */
interface MapHaken {
  isStyleLoaded(): boolean;
  getSource(id: string): unknown;
  querySourceFeatures(id: string): unknown[];
}

/** Lagekarte öffnen und warten, bis Grundlage, Einheit und Zone gezeichnet sind. */
export async function lagekarteBereit(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
    1,
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          if (!map?.isStyleLoaded()) return false;
          const hat = (id: string) => !!map.getSource(id) && map.querySourceFeatures(id).length > 0;
          return hat('zonen') && hat('marker-cluster');
        }),
      { timeout: 20_000, message: 'Lagekarte nicht bereit (Zone, Einheit)' },
    )
    .toBe(true);
}
