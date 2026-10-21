import type { Locator, Page } from '@playwright/test';
import {
  kachelnBeantworten,
  kartenConfigBeantworten,
  vektorStilBeantworten,
} from '../kartenFixture';
import {
  anmelden,
  demoEinsatz,
  expect,
  fuehrungsstelleOrtFuellen,
  fuelle,
  uhrAnhalten,
} from './kern';

/**
 * Lagekarte des Demo-Einsatzes für die Bilder-Specs, die sie zeigen: `lagekarte.bilder.ts` und
 * das Lageplan-Blatt in `drucken-export.bilder.ts`. Eine eigene Datei, weil Playwright keine
 * Testdatei aus einer anderen importieren lässt; so zeigen beide Kapitel dieselbe Lage.
 *
 * Kartengrundlage aus `e2e/kartenFixture.ts` (kein Netz): eine Vektorkarte mit grauem Grund und
 * einer Linie je Kachel. Die Lageobjekte darauf sind die des Demo-Einsatzes; die Demo verortet nur
 * Zonen und die Betreuungsstelle, der Lauf setzt den Einsatzort, vier Einheiten und den
 * Bereitstellungsraum dazu (Koordinaten im Gebiet des Szenarios, `src/demo/szenario.rs`).
 */

const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';
const KACHEL_LAYER = 'strassen';
export const GRUNDKARTE = {
  name: 'Grundkarte',
  stil: '/api/karte/proxy/9/a/style.json',
  quelle: 'grund',
};

/** Einheiten des Demo-Szenarios und ihr Ort (lon, lat) für das Bild. */
const EINHEITEN_ORT: Record<string, [number, number]> = {
  'Sanitätszug Musterstadt': [10.2478, 50.9562],
  Rettungsstaffel: [10.2512, 50.9546],
  Betreuungsgruppe: [10.2593, 50.9592],
  Logistiktrupp: [10.2546, 50.9581],
};

/** Bereitstellungsraum des Demo-Szenarios und sein Ort (lon, lat) für das Bild. */
const BR_NAME = 'Parkplatz Stadion Nord';
const BR_ORT: [number, number] = [10.2445, 50.9585];

/** Verortet Einsatzort und Einheiten über die API, wie es „Platzieren“ täte. */
async function lageVerorten(page: Page, einsatzId: number) {
  await fuelle(page, 'patch', `/api/einsaetze/${einsatzId}`, {
    einsatzort_lat: 50.9571,
    einsatzort_lon: 10.2525,
  });
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/einheiten`);
  expect(antwort.ok()).toBe(true);
  const einheiten = (await antwort.json()) as { id: number; name: string }[];
  for (const [name, [lon, lat]] of Object.entries(EINHEITEN_ORT)) {
    const einheit = einheiten.find((e) => e.name === name);
    expect(einheit, `Demo-Einheit „${name}“ fehlt`).toBeTruthy();
    await fuelle(page, 'patch', `/api/einsaetze/${einsatzId}/einheiten/${einheit!.id}/position`, {
      lat,
      lon,
    });
  }
  // Der Demo-Bereitstellungsraum steht mit seinem Raumzeichen auf der Karte (LLH-1107).
  const raeume = await page.request.get(`/api/einsaetze/${einsatzId}/bereitstellungsraeume`);
  expect(raeume.ok()).toBe(true);
  const raum = ((await raeume.json()) as { id: number; bezeichnung: string }[]).find(
    (r) => r.bezeichnung === BR_NAME,
  );
  expect(raum, `Demo-Bereitstellungsraum „${BR_NAME}“ fehlt`).toBeTruthy();
  await fuelle(page, 'patch', `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${raum!.id}`, {
    lat: BR_ORT[1],
    lon: BR_ORT[0],
  });
}

/**
 * Meldet an, verortet die Demo-Lage, öffnet die Lagekarte des Demo-Einsatzes auf der
 * Fixture-Grundlage und wartet auf den Stil. Gibt die Leinwand zurück.
 */
export async function oeffneKarte(page: Page): Promise<Locator> {
  await kartenConfigBeantworten(page, {
    online_styles: [{ name: GRUNDKARTE.name, typ: 'vektor', url: GRUNDKARTE.stil }],
  });
  await vektorStilBeantworten(page, GRUNDKARTE.stil, {
    id: GRUNDKARTE.quelle,
    kachelVorlage: `${KACHEL_PRAEFIX}{z}/{x}/{y}.pbf`,
    layer: KACHEL_LAYER,
  });
  await kachelnBeantworten(page, KACHEL_PRAEFIX, KACHEL_LAYER);
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await lageVerorten(page, demo.id);
  // Die eigene Führungsstelle steht als Befehlsstelle neben der Einsatzstelle (LFH-1181).
  await fuehrungsstelleOrtFuellen(page, demo.id);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/lagekarte`);
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __lfhKarte?: { isStyleLoaded(): boolean } }
          ).__lfhKarte?.isStyleLoaded() ?? false,
      ),
    )
    .toBe(true);
  return canvas;
}
