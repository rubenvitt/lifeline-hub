import { expect, test, type Page } from '@playwright/test';

// Zeichnet die Lagekarte ohne Netz ihre Ebenen? (LFH-723, design.md D9, Aufgabe 7.2)
//
// `lagebild-offline.spec.ts` belegt am Prod-Bundle, dass die Daten der Karte nach einem
// Offline-Neuladen wieder da sind (Kopfzahl, Datenstand). Ob MapLibre daraus ohne Netz auch
// ZEICHNET, sieht dort niemand: der Prod-Bundle trägt den Haken `__lfhKarte` nicht. Hier, im
// Dev-Server, wird die Karte deshalb OHNE Netz neu aufgebaut — per Navigation innerhalb der
// App, weil ein Neuladen ohne Service Worker gar keine Seite brächte — und ihre Marker-Quelle
// gelesen. Die Daten kommen dabei aus dem Speicher; das ist dieselbe Lage wie nach der
// Wiederherstellung, der Unterschied ist allein, wer sie in den Cache gelegt hat.
//
// Zwei Stile, weil ein Offline-Stil anders scheitern kann als der Blindstil der e2e-DB: der
// Offline-Stil lädt Glyphen und Sprite vom eigenen Server. Die e2e-DB hat keine Basiskarte,
// die Seite baut ihre Karte also im Blindstil. Die zweite Hälfte setzt deshalb einen Stil mit
// Glyphen und Sprite vom (jetzt unerreichbaren) Server und prüft, dass er ohne Netz FERTIG
// lädt — daran hängt das Anlegen der Marker-Ebenen (`style.load`). Die Ebenen selbst legt die
// Seite nur nach ihrem EIGENEN Stilwechsel neu an, nicht nach einem `setStyle` von außen
// (gemessen, dieselbe Lage wie in `lagekarte-marker-plaketten.spec.ts`); dort weiter zu
// prüfen, maße den Testaufbau, nicht die Karte.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface KartenHaken {
  loaded(): boolean;
  isStyleLoaded(): boolean;
  getLayer(id: string): unknown;
  querySourceFeatures(quelle: string): { properties: Record<string, unknown> | null }[];
  setStyle(s: unknown, o?: { diff: boolean }): void;
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

/** Marker-Schlüssel der Quelle; leer, solange die Karte nicht steht. */
async function schluessel(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte?: KartenHaken }).__lfhKarte;
    if (!k || !k.isStyleLoaded()) return [];
    return k
      .querySourceFeatures('marker-cluster')
      .map((f) => f.properties?.schluessel)
      .filter((s): s is string => typeof s === 'string');
  });
}

/** Navigation innerhalb der App (Data Router hört auf `popstate`), ohne Dokument-Abruf. */
async function innerhalbNavigieren(page: Page, pfad: string) {
  await page.evaluate((ziel) => {
    window.history.pushState({}, '', ziel);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, pfad);
}

test('Lagekarte (LFH-723): ohne Netz neu aufgebaut, zeichnet sie ihre Marker', async ({ page }) => {
  test.setTimeout(120_000);
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Funkloch Karte ${Date.now()}`,
  });
  const einheit = await post(page, `/api/einsaetze/${einsatzId}/einheiten`, {
    name: 'Offline-Probe Zug',
  });
  const position = await page.request.patch(
    `/api/einsaetze/${einsatzId}/einheiten/${einheit}/position`,
    { data: { lat: 53.0775, lon: 8.8 } },
  );
  expect(position.ok(), await position.text()).toBeTruthy();

  // Online: Karte steht, der Marker ist in der Quelle — die Vorbedingung, gegen die „offline"
  // überhaupt etwas aussagt.
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  const marker = `einheit-${einheit}`;
  await expect.poll(() => schluessel(page), { timeout: 60_000 }).toContain(marker);

  // Netz weg, Karte verlassen und ohne Netz neu aufbauen.
  await page.context().setOffline(true);
  await innerhalbNavigieren(page, `/einsaetze/${einsatzId}/etb`);
  await expect(page.getByTestId('kartenflaeche')).toHaveCount(0);
  await innerhalbNavigieren(page, `/einsaetze/${einsatzId}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche')).toBeVisible();
  await expect.poll(() => schluessel(page), { timeout: 60_000 }).toContain(marker);

  // Offline-Stil mit Glyphen und Sprite vom (jetzt unerreichbaren) eigenen Server: er muss
  // ohne Netz fertig laden. Gegenkontrolle, dass der Server wirklich unerreichbar ist — sonst
  // wäre „lädt fertig" auch mit erreichbarem Server wahr. Die Sprite-Anfrage selbst ist hier
  // nicht beobachtbar (gemessen): MapLibre holt sie im Worker, `page.on('requestfailed')`
  // sieht sie nicht, und der DEV-Mitschnitt `__lfhKartenAnfragen` ist nach 40 Kacheln voll.
  expect(
    await page.evaluate(() =>
      fetch('/api/health', { cache: 'no-store' }).then(
        () => 'beantwortet',
        () => 'scheitert',
      ),
    ),
  ).toBe('scheitert');
  await page.evaluate(() => {
    (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte.setStyle(
      {
        version: 8,
        glyphs: '/api/karte/offline/fonts/{fontstack}/{range}.pbf',
        sprite: '/api/karte/offline/sprites/basemap',
        sources: {},
        layers: [{ id: 'hintergrund', type: 'background', paint: { 'background-color': '#111' } }],
      },
      { diff: false },
    );
  });
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte.isStyleLoaded(),
        ),
      { timeout: 30_000, message: 'Offline-Stil lädt ohne Netz nie fertig' },
    )
    .toBe(true);
  await page.context().setOffline(false);
});
