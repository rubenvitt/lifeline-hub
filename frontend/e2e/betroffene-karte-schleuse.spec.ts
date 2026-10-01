import { expect, test, type Page } from '@playwright/test';

/**
 * Schleuse der Betroffenen-Karte (LFH-668,
 * `openspec/changes/archive/2026-10-01-lfh-668-betroffenen-karte-schleuse/design.md`): kein Zielwechsel unter dem
 * Zeiger durch fremde Schreibzugriffe. Seeding per `page.request` ist für die Seite ein FREMDER
 * Schreibzugriff — er kommt über den Live-Strom, wie von einer zweiten Stelle.
 *
 * Geprüft wird an der MapLibre-Quelle und am DOM-Donut (`cluster-treffer`), nicht an Pixeln.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1366, height: 768 };
const RUHE_MS = 700;

interface KartenHaken {
  loaded(): boolean;
  triggerRepaint(): void;
  once(ereignis: string, f: () => void): void;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  project(ll: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  querySourceFeatures(quelle: string): {
    properties: Record<string, unknown> | null;
    geometry: { coordinates: [number, number] };
  }[];
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const a = await page.request.post(pfad, { data });
  expect(a.ok(), `${pfad}: ${a.status()} ${await a.text()}`).toBeTruthy();
  return ((await a.json()) as { id: number }).id;
}

/** Karte öffnen und auf einen festen Ausschnitt springen; zurück kommt, wenn sie ruht. */
async function karteBei(page: Page, einsatzId: number, center: [number, number], zoom: number) {
  await page.goto(`/einsaetze/${einsatzId}/personen?ansicht=karte`);
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: KartenHaken }).__lfhKarte),
    undefined,
    { timeout: 60_000 },
  );
  await page.locator('[data-lfh="betroffene-karte"] canvas').scrollIntoViewIfNeeded();
  await page.evaluate(
    ({ center, zoom }) =>
      new Promise<void>((fertig) => {
        const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
        k.once('idle', () => fertig());
        k.jumpTo({ center, zoom });
      }),
    { center, zoom },
  );
}

/** Bis die Karte nach dem letzten Datenstand gezeichnet hat — erst dann sagt „nichts da" etwas. */
async function karteRuht(page: Page) {
  await page.waitForTimeout(RUHE_MS);
  await page.evaluate(
    () =>
      new Promise<void>((fertig) => {
        const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
        k.once('idle', () => fertig());
        k.triggerRepaint();
      }),
  );
}

/** Seitenlage eines Punkts der Karte. */
function seitenlage(page: Page, ll: [number, number]) {
  return page.evaluate((ll) => {
    const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
    const r = k.getCanvas().getBoundingClientRect();
    const p = k.project(ll);
    return { x: r.left + p.x, y: r.top + p.y };
  }, ll);
}

/** Die Einzel-Schlüssel der geclusterten Quelle (ein Bündel trägt keinen). */
function einzelSchluessel(page: Page) {
  return page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
    return [
      ...new Set(
        k
          .querySourceFeatures('marker-cluster')
          .map((f) => f.properties?.schluessel)
          .filter((s): s is string => typeof s === 'string'),
      ),
    ].sort();
  });
}

const banner = (page: Page) =>
  page.locator('[data-lfh="betroffene-karte"] [data-lfh="sammelbanner"]');
const standzeile = (page: Page) => page.locator('[data-lfh="betroffene-karte-stand"]');
// Der Donut trägt seinen Namen am Ring, in `handschuh` an der Hülle `cluster-treffer`.
const donut = (page: Page) => page.getByRole('img', { name: /Personen, dringlichste Sichtung/ });

test('Karte: ein Live-Zugang neben dem Marker unter dem Zeiger verschmilzt nicht (LFH-668)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Schleuse ${Date.now()}`,
  });
  const a = await post(page, `/api/einsaetze/${einsatzId}/personen`, {
    name: 'Unter dem Zeiger',
    antreff_lat: 53.0,
    antreff_lon: 8.8,
    sichtung: 'sk2',
  });
  // Zoom 12: rund 11 m Abstand liegen weit innerhalb des Cluster-Radius.
  await karteBei(page, einsatzId, [8.8, 53.0], 12);
  await expect.poll(() => einzelSchluessel(page), { timeout: 20_000 }).toEqual([`person-${a}`]);

  const punkt = await seitenlage(page, [8.8, 53.0]);
  await page.mouse.move(punkt.x, punkt.y);
  await expect(standzeile(page)).toHaveText('Live pausiert');

  const b = await post(page, `/api/einsaetze/${einsatzId}/personen`, {
    name: 'Zugang daneben',
    antreff_lat: 53.0001,
    antreff_lon: 8.8,
  });
  await expect(banner(page)).toContainText('1 neu', { timeout: 15_000 });
  // Die negativen Prüfungen erst, wenn die Karte den neuen Stand gezeichnet HÄTTE.
  await karteRuht(page);
  // Gehalten: A steht als Einzelmarker unter dem Zeiger, kein Donut.
  expect(await einzelSchluessel(page)).toEqual([`person-${a}`]);
  await expect(donut(page)).toHaveCount(0);
  const amZeiger = await page.evaluate(({ x, y }) => {
    const k = (
      window as unknown as {
        __lfhKarte: KartenHaken & {
          queryRenderedFeatures(
            p: [number, number],
          ): { properties: Record<string, unknown> | null }[];
        };
      }
    ).__lfhKarte;
    const r = k.getCanvas().getBoundingClientRect();
    return [
      ...new Set(
        k
          .queryRenderedFeatures([x - r.left, y - r.top])
          .map((f) => f.properties?.schluessel)
          .filter((s): s is string => typeof s === 'string'),
      ),
    ];
  }, punkt);
  expect(amZeiger).toEqual([`person-${a}`]);
  // Das Ziel unter dem Zeiger ist die Karte, kein Donut, der sich darübergeschoben hätte.
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, punkt)).toBe(
    'CANVAS',
  );

  // Verlassen wendet an — und dann verschmelzen beide wirklich (Selbstprobe der Geometrie).
  await page.mouse.move(0, 0);
  await expect(banner(page)).toHaveCount(0);
  await expect(standzeile(page)).toHaveText('Live');
  await expect(donut(page)).toHaveCount(1, { timeout: 15_000 });
  test.info().annotations.push({
    type: 'messwert',
    description: `gehalten: am Zeiger ${amZeiger.join(',')}, Donut 0; nach Verlassen Donut 1 (A ${a}, B ${b})`,
  });
});

test('Karte: ein aufgefächertes Bündel bleibt bei einer Sichtungsänderung offen (LFH-668)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', { bezeichnung: `E2E Spider ${Date.now()}` });
  const ids: number[] = [];
  for (const i of [0, 1]) {
    ids.push(
      await post(page, `/api/einsaetze/${einsatzId}/personen`, {
        name: `Paar ${i}`,
        antreff_lat: 53.0 + i * 0.0001,
        antreff_lon: 8.8,
        sichtung: 'sk3',
      }),
    );
  }
  // `handschuh`: die 72-px-Hülle wird beim Inhaltswechsel neu gebaut und muss durchlässig
  // bleiben (D5), sonst klappte der Tipp auf das Blatt den Spider zu. Erst die Stufe, dann die
  // Karte: `?ansicht=karte` wird nach dem ersten Laden geräumt.
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await karteBei(page, einsatzId, [8.8, 53.00005], 12);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  const huelle = page.locator('[data-lfh="cluster-treffer"]');
  await expect(huelle).toHaveCount(1, { timeout: 20_000 });
  const k = (await huelle.boundingBox())!;
  const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };
  await page.mouse.click(mitte.x, mitte.y);

  const blaetter = () =>
    page.evaluate(() => {
      const kh = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
      const r = kh.getCanvas().getBoundingClientRect();
      const je = new Map<string, { schluessel: string; kurz: string; x: number; y: number }>();
      for (const f of kh.querySourceFeatures('spider-leaves')) {
        const s = String(f.properties?.schluessel ?? '');
        const p = kh.project(f.geometry.coordinates);
        je.set(s, {
          schluessel: s,
          kurz: String(f.properties?.kurzzeichen ?? ''),
          x: Math.round(r.left + p.x),
          y: Math.round(r.top + p.y),
        });
      }
      return [...je.values()].sort((a, b) => a.schluessel.localeCompare(b.schluessel));
    });
  await expect.poll(async () => (await blaetter()).length, { timeout: 10_000 }).toBe(2);
  const vorher = await blaetter();
  expect(vorher.map((b) => b.kurz)).toEqual(['III', 'III']);

  // Die Maus bleibt, wo sie geklickt hat (im Bereich). Live: die Sichtung des ersten Blatts.
  const ziel = ids[0];
  await post(page, `/api/einsaetze/${einsatzId}/personen/${ziel}/sichtung`, { kategorie: 'sk1' });
  await expect
    .poll(async () => (await blaetter()).find((b) => b.schluessel === `person-${ziel}`)?.kurz, {
      timeout: 15_000,
    })
    .toBe('I');
  const nachher = await blaetter();
  // Offen und an derselben Stelle.
  expect(nachher.map(({ schluessel, x, y }) => ({ schluessel, x, y }))).toEqual(
    vorher.map(({ schluessel, x, y }) => ({ schluessel, x, y })),
  );
  // Getippt wird INNERHALB der Hülle (30 px vom Mittelpunkt, Hülle 36), auf den Blattkreis:
  // trifft das die neu gebaute Hülle statt des Blatts, klappt der Spider zu.
  const blatt = nachher.find((b) => b.schluessel === `person-${ziel}`)!;
  const dx = blatt.x - mitte.x;
  const dy = blatt.y - mitte.y;
  const d = Math.hypot(dx, dy);
  expect(d).toBeGreaterThan(36);
  expect(d - 30).toBeLessThan(13);
  await page.mouse.click(mitte.x + (dx / d) * 30, mitte.y + (dy / d) * 30);
  await expect(page).toHaveURL(new RegExp(`/personen/${ziel}$`));
});

for (const breite of [
  { name: '390 px', groesse: { width: 390, height: 844 } },
  { name: '1366 px', groesse: FUEKW },
]) {
  test(`Karte: der Sammelbanner verschiebt die Karte nicht (${breite.name}, LFH-668)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(breite.groesse);
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: { v: number; t: number; eingabe: boolean }[] };
      w.__cls = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as unknown as {
          value: number;
          startTime: number;
          hadRecentInput: boolean;
        }[])
          w.__cls.push({ v: e.value, t: e.startTime, eingabe: e.hadRecentInput });
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await anmelden(page);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E Banner ${Date.now()}`,
    });
    await post(page, `/api/einsaetze/${einsatzId}/personen`, {
      name: 'Da',
      antreff_lat: 53.0,
      antreff_lon: 8.8,
    });
    await karteBei(page, einsatzId, [8.8, 53.0], 10);
    const karte = page.locator('[data-lfh="betroffene-karte"] canvas');
    // Ein Punkt, an dem WIRKLICH die Karte liegt: bei 390 px liegt die Mitte unter dem Bild, und
    // der obere Rand kann je nach Scrollstand unter der stehenden Kopfleiste stecken.
    const punkt = await page.evaluate(() => {
      const c = document.querySelector('[data-lfh="betroffene-karte"] canvas')!;
      const r = c.getBoundingClientRect();
      const x = r.left + r.width / 2;
      for (let y = Math.max(r.top, 0) + 10; y < Math.min(r.bottom, innerHeight); y += 10) {
        if (document.elementFromPoint(x, y) === c) return { x, y: y + 20 };
      }
      return null;
    });
    expect(punkt, 'sichtbarer Punkt auf der Karte').not.toBeNull();
    await page.mouse.move(punkt!.x, punkt!.y);
    await expect(standzeile(page)).toHaveText('Live pausiert');
    await page.waitForTimeout(RUHE_MS);
    const y0 = (await karte.boundingBox())!.y;
    const m = await page.evaluate(() => performance.now());

    await post(page, `/api/einsaetze/${einsatzId}/personen`, {
      name: 'Weit weg',
      antreff_lat: 53.05,
      antreff_lon: 8.9,
    });
    await expect(banner(page)).toContainText('1 neu', { timeout: 15_000 });
    await page.waitForTimeout(RUHE_MS);
    const y1 = (await karte.boundingBox())!.y;
    await page.mouse.move(0, 0);
    await expect(banner(page)).toHaveCount(0);
    await page.waitForTimeout(RUHE_MS);
    const y2 = (await karte.boundingBox())!.y;
    const cls = await page.evaluate(
      (m) =>
        (window as unknown as { __cls: { v: number; t: number; eingabe: boolean }[] }).__cls
          .filter((e) => e.t >= m && !e.eingabe)
          .reduce((s, e) => s + e.v, 0),
      m,
    );
    test.info().annotations.push({
      type: 'messwert',
      description: `${breite.name}: Karte y ${y0.toFixed(1)} → ${y1.toFixed(1)} (Banner) → ${y2.toFixed(1)} (weg), CLS-Beitrag ${cls.toFixed(4)}`,
    });
    expect(Math.abs(y1 - y0), 'Banner erscheint').toBeLessThanOrEqual(0.5);
    expect(Math.abs(y2 - y0), 'Banner verschwindet').toBeLessThanOrEqual(0.5);
    expect(cls).toBe(0);
  });
}

test.describe('Touch (LFH-668)', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('Karte: Bündel antippen hält, Tipp auf die leere Karte klappt zu und gibt frei', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await anmelden(page);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E Touch ${Date.now()}`,
    });
    for (const i of [0, 1]) {
      await post(page, `/api/einsaetze/${einsatzId}/personen`, {
        name: `Paar ${i}`,
        antreff_lat: 53.0 + i * 0.0001,
        antreff_lon: 8.8,
        // Mit Sichtung trägt der Donut seinen Namen (`role="img"`).
        sichtung: 'sk3',
      });
    }
    await karteBei(page, einsatzId, [8.8, 53.00005], 12);
    // Die Maus bleibt aus dem Spiel: nach dem Login steht sie auf (0, 0).
    await page.mouse.move(0, 0);
    await expect(standzeile(page)).toHaveText('Live');
    await expect(donut(page)).toHaveCount(1, { timeout: 20_000 });
    const k = (await donut(page).boundingBox())!;
    await page.touchscreen.tap(k.x + k.width / 2, k.y + k.height / 2);

    const blaetter = () =>
      page.evaluate(() => {
        const kh = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
        return new Set(kh.querySourceFeatures('spider-leaves').map((f) => f.properties?.schluessel))
          .size;
      });
    await expect.poll(blaetter, { timeout: 10_000 }).toBe(2);
    // Das aufgefächerte Bündel hält (onSpiderOffen), ohne Zeiger.
    await expect(standzeile(page)).toHaveText('Live pausiert');
    await post(page, `/api/einsaetze/${einsatzId}/personen`, {
      name: 'Zugang',
      antreff_lat: 53.00015,
      antreff_lon: 8.8,
    });
    await expect(banner(page)).toContainText('1 neu', { timeout: 15_000 });
    await karteRuht(page);
    expect(await blaetter()).toBe(2);

    // Tipp auf leere Karte: klappt zu, und der Fokus, den der Tipp dem Canvas gibt, hält NICHT.
    const leer = await page.evaluate(() => {
      const kh = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
      const r = kh.getCanvas().getBoundingClientRect();
      return { x: r.left + 40, y: r.top + r.height / 2 };
    });
    await page.touchscreen.tap(leer.x, leer.y);
    await expect(standzeile(page)).toHaveText('Live', { timeout: 10_000 });
    await expect(banner(page)).toHaveCount(0);
    await expect(donut(page)).toHaveAccessibleName(/^3 Personen/, { timeout: 15_000 });
  });
});
