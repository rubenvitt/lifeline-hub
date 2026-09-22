import { expect, test, type Page } from '@playwright/test';

// LFH-622: Namensplaketten an den Markern und Mono-Glyphen vom eigenen Glyphen-Server.
//
// Warum im Browser: `markerLayer.test.ts` prüft die Layer-SPEZIFIKATION gegen eine
// Attrappe. Ob MapLibre die Plaketten tatsächlich setzt (Kollision, Mindestzoom,
// `icon-text-fit` mit wechselnden Ankern) und ob der Server den Mono-Fontstack wirklich
// ausliefert, sieht nur ein echter Renderer. Der zweite Punkt ist die stille Falle: der
// Fontstack-Name steht einmal in `plakette.ts` (`PLAKETTEN_MONO`) und einmal als Ordner
// unter `assets/karten/fonts/`. Wird nur einer umbenannt, antwortet der Server 404, und
// MapLibre zeichnet in einer lokalen Systemschrift weiter — kein Fehlerbild, nur Warnungen
// in der Konsole. Deshalb prüft dieser Test den Status der Glyphen-Antwort, nicht die Optik.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  loaded(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  setStyle(s: unknown, o?: { diff: boolean }): void;
  getLayer(id: string): unknown;
  getLayoutProperty(layer: string, name: string): unknown;
  queryRenderedFeatures(o: { layers: string[] }): unknown[];
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

const MITTE: [number, number] = [8.8, 53.0775];

/** Ein Einsatz mit drei verorteten Einheiten, je rund 2,7 km auseinander. Das Clustering
 *  rechnet bei Zoom 11,5 mit der ganzzahligen Stufe 11: dort liegen die Einheiten knapp
 *  60 px auseinander, über dem Cluster-Radius von 45 px. So misst „keine Plakette unter
 *  Zoom 12" den Mindestzoom und nicht das Clustering; bei 12,5 bleiben alle drei samt
 *  Plakette im Bild (je rund 165 px Abstand). Der Name
 *  enthält keinen Modulnamen (siehe `lagekarte-smoke.spec.ts`: die Palette sucht beides). */
async function einsatzMitEinheiten(page: Page): Promise<{ einsatzId: number; ersteId: number }> {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Plaketten ${Date.now()}`,
  });
  let ersteId = 0;
  for (const [i, name] of ['Deichwache Nord', 'Deichwache Süd', 'Pumpenzug Mitte'].entries()) {
    const id = await post(page, `/api/einsaetze/${einsatzId}/einheiten`, { name });
    if (i === 0) ersteId = id;
    const antwort = await page.request.patch(
      `/api/einsaetze/${einsatzId}/einheiten/${id}/position`,
      { data: { lat: MITTE[1] + (i - 1) * 0.002, lon: MITTE[0] + (i - 1) * 0.04 } },
    );
    expect(antwort.ok(), `Position ${name}: ${await antwort.text()}`).toBeTruthy();
  }
  return { einsatzId, ersteId };
}

async function plakettenBeiZoom(page: Page, zoom: number): Promise<number> {
  await page.evaluate(
    ([center, z]) => {
      const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
      k.jumpTo({ center: center as [number, number], zoom: z as number });
    },
    [MITTE, zoom] as const,
  );
  // Platzvergabe läuft asynchron nach dem Rendern; erst warten, bis sie sich gesetzt hat.
  await page.waitForFunction(() =>
    (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.loaded(),
  );
  await page.waitForTimeout(500);
  return page.evaluate(
    () =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.queryRenderedFeatures({
        layers: ['marker-label'],
      }).length,
  );
}

test('Marker tragen ihre Namensplakette erst ab Zoom 12, offline in Mono', async ({ page }) => {
  await anmelden(page);
  const { einsatzId, ersteId } = await einsatzMitEinheiten(page);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte?.loaded()),
  );

  // Mindestzoom als Paar knapp um die Schwelle: darunter keine Plakette, darüber alle drei.
  expect(await plakettenBeiZoom(page, 11.5)).toBe(0);
  await expect.poll(() => plakettenBeiZoom(page, 12.5)).toBe(3);

  // Offline-Glyphen: die e2e-DB hat keine Basiskarte (Blindstil ohne `glyphs`). Ein
  // Hintergrundstil MIT dem eigenen Glyphen-Server stellt die Offline-Lage her. Der
  // `setStyle` von außen wischt die Marker-Layer, stößt aber die Re-Anlage der Seite nicht
  // an (die hängt an ihrem eigenen Stilwechsel). Das tut die nächste Datenänderung: eine
  // leicht verschobene Position kommt über den Live-Strom zurück und legt die Marker-Layer
  // auf dem neuen Stil an — mit der Schrift, die `plakettenSchrift` für ihn wählt.
  const glyphen = page.waitForResponse((r) =>
    decodeURIComponent(r.url()).includes('/api/karte/offline/fonts/JetBrains Mono Regular/'),
  );
  await page.evaluate(() => {
    (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.setStyle(
      {
        version: 8,
        glyphs: '/api/karte/offline/fonts/{fontstack}/{range}.pbf',
        sources: {},
        layers: [{ id: 'hintergrund', type: 'background', paint: { 'background-color': '#111' } }],
      },
      { diff: false },
    );
  });
  const verschoben = await page.request.patch(
    `/api/einsaetze/${einsatzId}/einheiten/${ersteId}/position`,
    { data: { lat: MITTE[1] - 0.002 + 0.00001, lon: MITTE[0] - 0.04 } },
  );
  expect(verschoben.ok()).toBeTruthy();
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.getLayer('marker-label')),
  );
  expect(
    await page.evaluate(() =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.getLayoutProperty(
        'marker-label',
        'text-font',
      ),
    ),
  ).toEqual(['JetBrains Mono Regular']);
  await expect.poll(() => plakettenBeiZoom(page, 12.5)).toBe(3);
  expect((await glyphen).status()).toBe(200);
});
