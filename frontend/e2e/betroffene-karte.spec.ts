import { expect, test, type Page } from '@playwright/test';

// LFH-613 (Aufgabe 5.4): Kartenansicht der Betroffenen.
//
// Warum im Browser: `personenKarte.test.ts` prüft die Marker-AUSWAHL rein, ohne WebGL. Ob
// die Marker tatsächlich in der MapLibre-Quelle landen — lazy geladenes Bündel,
// Startausschnitt aus dem Rahmen um die Personen, Clustering der Quelle —, sieht nur ein
// echter Renderer. Geprüft wird die Quelle (`querySourceFeatures`), nicht die Optik.
//
// Die zwei verorteten Personen liegen rund 140 km auseinander. Der Startausschnitt rahmt
// beide, sie stehen also an entgegengesetzten Rändern des Bildes und weit über dem
// Cluster-Radius auseinander — sonst trüge die Quelle nur einen Cluster-Punkt ohne
// `schluessel`, und der Test prüfte das Clustering statt der Marker.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  loaded(): boolean;
  querySourceFeatures(quelle: string): { properties: Record<string, unknown> | null }[];
}

interface PersonZeile {
  id: number;
  antreff_lat?: number | null;
  antreff_lon?: number | null;
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

async function personen(page: Page, einsatzId: number): Promise<PersonZeile[]> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/personen`);
  expect(antwort.ok(), `Personenliste: ${antwort.status()}`).toBeTruthy();
  return (await antwort.json()) as PersonZeile[];
}

/** Die Marker-Schlüssel, die die Quelle gerade trägt (Cluster-Punkte haben keinen). */
async function schluesselInQuelle(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
    if (!k || !k.loaded()) return [];
    return k
      .querySourceFeatures('marker-cluster')
      .map((f) => f.properties?.schluessel)
      .filter((s): s is string => typeof s === 'string');
  });
}

test('Betroffene mit Koordinate stehen als Marker auf der Karte, die Lücke wird gezählt', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmelden(page);

  // Der Name enthält keinen Modulnamen (siehe `lagekarte-smoke.spec.ts`: die Palette sucht
  // Module und Einsätze gemeinsam).
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Fundorte ${Date.now()}`,
  });
  const mitKoordinate = await post(page, `/api/einsaetze/${einsatzId}/personen`, {
    name: 'Albers',
    antreff_lat: 53.5511,
    antreff_lon: 9.9937,
  });
  const ohneKoordinate = await post(page, `/api/einsaetze/${einsatzId}/personen`, {
    name: 'Brandt',
  });

  // Zweiter Weg: die Schnellerfassungszeile `/person` mit dem Kürzel `#lat/lon`. Die
  // Koordinate muss im SELBEN Anlege-POST mitgehen — geprüft am Serverstand, nicht an der
  // Anzeige.
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  const zeile = page.getByRole('textbox', { name: 'Kurzeingabe Person' });
  await zeile.fill('Claasen, Carla #52.2691/9.1342');
  await zeile.press('Enter');
  await expect(zeile).toHaveValue('', { timeout: 20_000 });

  let ausZeile = 0;
  await expect
    .poll(
      async () => {
        const liste = await personen(page, einsatzId);
        const neu = liste.find((p) => p.id !== mitKoordinate && p.id !== ohneKoordinate);
        ausZeile = neu?.id ?? 0;
        return neu ? [neu.antreff_lat, neu.antreff_lon] : null;
      },
      { timeout: 20_000 },
    )
    .toEqual([52.2691, 9.1342]);
  expect(ausZeile).toBeGreaterThan(0);

  // Ansicht „Karte" über die Segmentleiste; MapLibre lädt erst jetzt (eigenes Bündel).
  await page
    .getByRole('radiogroup', { name: 'Ansicht' })
    .getByRole('radio', { name: 'Karte' })
    .click();
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );

  // Die Quelle füllt sich asynchron (GeoJSON-Worker); darauf warten, nicht schlafen.
  await expect
    .poll(async () => (await schluesselInQuelle(page)).sort(), { timeout: 30_000 })
    .toEqual(expect.arrayContaining([`person-${mitKoordinate}`, `person-${ausZeile}`]));
  const schluessel = await schluesselInQuelle(page);
  expect(schluessel).not.toContain(`person-${ohneKoordinate}`);

  // Die Lücke wird GESAGT: genau die eine Person ohne Koordinate.
  await expect(page.locator('[data-lfh="betroffene-karte-ohne-koordinate"]')).toHaveText(
    '1 Person ohne Koordinate — nicht auf der Karte',
  );
});

interface SpiderHaken extends MapHaken {
  project(ll: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  once(ereignis: string, f: () => void): void;
  getSource(id: string): { _data?: unknown } | undefined;
  querySourceFeatures(quelle: string): {
    properties: Record<string, unknown> | null;
    geometry: { type: string; coordinates: [number, number] };
  }[];
}

// Review LFH-650 (Befund „hoch"): in `handschuh` legt der Cluster-Donut eine 72-px-Hülle
// (Radius 36) um den Ring; die aufgefächerten Blätter liegen ab 40 px, ihr gezeichneter Kreis
// beginnt bei 27 px. Die Hülle fing den Tipp auf den inneren Teil eines Blatts ab und klappte
// den Spider zu. Gemessen wird GENAU dieser Punkt: 30 px vom Mittelpunkt in Richtung Blatt —
// innerhalb der alten Hülle UND innerhalb des gezeichneten Blattkreises.
test('Handschuh: ein Tipp auf den inneren Teil eines aufgefächerten Blatts öffnet die Person, statt den Spider zu schließen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Spider ${Date.now()}`,
  });
  const ids: number[] = [];
  for (const i of [0, 1]) {
    ids.push(
      await post(page, `/api/einsaetze/${einsatzId}/personen`, {
        name: `Paar ${i}`,
        antreff_lat: 53.0 + i * 0.0001,
        antreff_lon: 8.8,
        sichtung: 'sk2',
      }),
    );
  }
  // Erst die Stufe setzen, DANN die Karte aufrufen: `?ansicht=karte` wird nach dem ersten
  // Laden aus der URL geräumt, ein Neuladen danach landete in der Zeilenansicht.
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await page.goto(`/einsaetze/${einsatzId}/personen?ansicht=karte`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  // Nur auf die Instanz warten, nicht auf `loaded()`: der Startausschnitt rahmt zwei Punkte
  // im Abstand von rund 11 m und springt dabei auf einen extremen Zoom; ohne Kachelquelle blieb
  // `loaded()` dort gemessen stehen. Bereit ist die Karte nach dem EIGENEN Sprung (`idle`).
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte),
    undefined,
    { timeout: 60_000 },
  );
  await page.locator('[data-lfh="betroffene-karte"] canvas').scrollIntoViewIfNeeded();
  // Zoom 12: beide Personen (rund 11 m auseinander) bilden sicher einen Cluster.
  await page.evaluate(
    () =>
      new Promise<void>((fertig) => {
        const k = (window as unknown as { __lfhKarte: SpiderHaken }).__lfhKarte;
        k.once('idle', () => fertig());
        k.jumpTo({ center: [8.8, 53.00005], zoom: 12 });
      }),
  );
  const huelle = page.locator('[data-lfh="cluster-treffer"]');
  await expect(huelle).toHaveCount(1, { timeout: 20_000 });
  const kasten = (await huelle.boundingBox())!;
  expect(kasten.width).toBeGreaterThanOrEqual(71.5);
  const mitte = { x: kasten.x + kasten.width / 2, y: kasten.y + kasten.height / 2 };
  await page.mouse.click(mitte.x, mitte.y);

  // Die aufgefächerten Blätter aus der Spider-Quelle, auf die Seite projiziert.
  let blaetter: { id: number; x: number; y: number }[] = [];
  await expect
    .poll(
      async () => {
        blaetter = await page.evaluate(() => {
          const k = (window as unknown as { __lfhKarte: SpiderHaken }).__lfhKarte;
          const r = k.getCanvas().getBoundingClientRect();
          // `querySourceFeatures` liefert ein Merkmal je Kachel, die es berührt — gemessen
          // dreifach; je Schlüssel zählt eins.
          const je = new Map<string, { id: number; x: number; y: number }>();
          for (const f of k.querySourceFeatures('spider-leaves')) {
            const s = String(f.properties?.schluessel ?? '');
            const p = k.project(f.geometry.coordinates);
            je.set(s, { id: Number(s.replace('person-', '')), x: r.left + p.x, y: r.top + p.y });
          }
          return [...je.values()];
        });
        return blaetter.length;
      },
      { timeout: 10_000 },
    )
    .toBe(2);

  const blatt = blaetter[0];
  const dx = blatt.x - mitte.x;
  const dy = blatt.y - mitte.y;
  const d = Math.hypot(dx, dy);
  // Selbstprobe der Geometrie: das Blatt liegt außerhalb der Ringmitte, der Messpunkt
  // (30 px) innerhalb der Hülle (36) UND innerhalb des gezeichneten Blattkreises (Kante 13).
  expect(d).toBeGreaterThan(36);
  expect(d - 30).toBeLessThan(13);
  await page.mouse.click(mitte.x + (dx / d) * 30, mitte.y + (dy / d) * 30);
  await expect(page).toHaveURL(new RegExp(`/personen/${blatt.id}$`));
  expect(ids).toContain(blatt.id);
});
