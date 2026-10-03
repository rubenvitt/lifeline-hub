import { expect, test, type Page } from '@playwright/test';

/**
 * Korrigierbares Zeichnen und Eigenposition an der echten Karte. Vitest belegt Adapter und
 * Verdrahtung mit einem terra-draw-Mock; hier: dass `undoRedo.modeLevel` GENAU einen Punkt
 * zurücknimmt, dass terra-draw Escape nicht mehr selbst verwirft, und dass die Eigenposition
 * an einer echten MapLibre-Karte landet und einen Grundlagenwechsel übersteht.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  getStyle(): { sources?: Record<string, unknown>; layers?: { id: string }[] } | undefined;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBounds(): { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number };
  isMoving(): boolean;
}

/** Punkt und Kreis der Eigenposition stehen auf der Karte (Quelle trägt Daten). */
function eigenpositionGezeichnet(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
    const q = map?.getStyle()?.sources?.['eigenposition'] as
      { data?: { features?: unknown[] } } | undefined;
    return q?.data?.features?.length ?? 0;
  });
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Name ohne Modulnamen — die Kommandopalette sucht Module und Einsätze gemeinsam. */
async function lagekarteOeffnen(page: Page, suche = '') {
  await anmelden(page);
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(`E2E Korrektur ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const eid = Number(page.url().match(/\/einsaetze\/(\d+)/)![1]);
  await page.goto(`/einsaetze/${eid}/lagekarte${suche}`);
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();
  return { eid, canvas };
}

test('Zeichnen: Punkt zurück nimmt genau einen Punkt, Esc ist zweistufig', async ({ page }) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const { eid, canvas } = await lagekarteOeffnen(page);

  await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
  const zaehler = page.locator('[data-lfh="zeichnen-punkte"]');
  const zurueck = page.getByRole('button', { name: 'Letzten Punkt zurück' });
  await expect(zaehler).toHaveText('0 Punkte');
  await expect(zurueck).toBeDisabled();
  await expect(canvas).toHaveCSS('cursor', 'crosshair');

  // Alle Punkte ÜBER der Mitte: darunter liegt die Zeichnen-Steuerung im Kartenfuß.
  const box = (await canvas.boundingBox())!;
  const punkt = (dx: number, dy: number) => ({
    x: box.x + box.width / 2 + dx,
    y: box.y + box.height / 2 + dy,
  });
  const setze = async (dx: number, dy: number) => {
    const p = punkt(dx, dy);
    await page.mouse.click(p.x, p.y);
  };

  await setze(-120, -140);
  await setze(120, -140);
  await setze(120, -40);
  await expect(zaehler).toHaveText('3 Punkte');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeEnabled();

  await zurueck.click();
  await expect(zaehler).toHaveText('2 Punkte');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeDisabled();

  // Der Beleg an terra-draw selbst: neuer dritter Punkt, abschließen, speichern — die Fläche
  // hat drei Ecken. Hätte terra-draw nichts zurückgenommen, wären es vier.
  await setze(-120, -40);
  await expect(zaehler).toHaveText('3 Punkte');
  await page.getByRole('button', { name: 'Abschließen' }).click();
  const anfrage = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith(`/api/einsaetze/${eid}/zonen`),
  );
  await page.getByRole('button', { name: 'Speichern' }).click();
  const body = (await anfrage).postDataJSON() as { geometrie: string };
  const ring = (JSON.parse(body.geometrie) as { coordinates: number[][][] }).coordinates[0];
  expect(ring).toHaveLength(4);

  // Serie steht per Vorgabe an: es geht direkt mit der nächsten Figur weiter.
  await expect(page.getByText('1 gespeichert')).toBeVisible();
  await setze(-60, -140);
  await setze(60, -140);
  await expect(zaehler).toHaveText('2 Punkte');

  // Erste Stufe — mit dem Fokus auf einem Knopf der Steuerung, nicht auf dem Canvas, wo
  // terra-draws eigenes Esc die Taste nie gesehen hätte.
  await zurueck.focus();
  await page.keyboard.press('Escape');
  await expect(zaehler).toHaveText('0 Punkte');
  await expect(page.locator('.ant-message')).toContainText('Zeichnung verworfen');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();

  // Nach dem Verwerfen zeichnet der Modus weiter.
  await setze(-60, -100);
  await expect(zaehler).toHaveText('1 Punkt');

  // Esc mit dem Fokus auf der Karte: auch hier genau EINE Stufe. Dass terra-draw die Taste
  // abgegeben hat (`cancel: null`), belegt dieser Schritt nicht — das pinnt `zeichnen.test.ts`.
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(zaehler).toHaveText('0 Punkte');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();

  // Zweite Stufe: ohne Figur endet das Zeichnen (in der Serie wie „Fertig").
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeHidden();

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

test.describe('Eigenposition', () => {
  const POSITION = { latitude: 52.3759, longitude: 9.732, accuracy: 35 };
  test.use({ geolocation: POSITION, permissions: ['geolocation'] });

  test('zeigt den eigenen Standort, fliegt einmal hin und schickt ihn nirgends hin', async ({
    page,
  }) => {
    const seitenFehler: Error[] = [];
    page.on('pageerror', (f) => seitenFehler.push(f));
    const anfragen: string[] = [];
    page.on('request', (r) => anfragen.push(`${r.url()} ${r.postData() ?? ''}`));
    await lagekarteOeffnen(page);

    const quelleDa = () =>
      page.evaluate(() => {
        const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
        return Boolean(map?.getStyle()?.sources?.['eigenposition']);
      });
    const mitte = () =>
      page.evaluate(() => {
        const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte!;
        return map.getCenter();
      });

    // Vor dem Einschalten legt die Karte keine Ebene an.
    expect(await quelleDa()).toBe(false);

    // localhost ist ein sicherer Kontext: der Knopf steht frei.
    const knopf = page.getByRole('button', { name: 'Eigenposition' });
    await expect(knopf).not.toHaveAttribute('aria-disabled', 'true');
    await knopf.click();
    await expect(knopf).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(quelleDa, { timeout: 10_000 }).toBe(true);
    await expect
      .poll(
        async () => {
          const m = await mitte();
          return (
            Math.abs(m.lng - POSITION.longitude) < 0.01 &&
            Math.abs(m.lat - POSITION.latitude) < 0.01
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    // LFH-766: genaue Ortung zoomt nicht näher als die übrigen Kartenziele (Zoom 15).
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.isMoving()),
      )
      .toBe(false);
    expect(
      await page.evaluate(() =>
        (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.getZoom(),
      ),
    ).toBeLessThanOrEqual(15.001);

    // Grundlagenwechsel (`setStyle` mit `diff: false`) wirft eigene Quellen weg — die
    // Eigenposition muss danach wieder stehen. Grenze: „Hell" ändert auch die Bedienfarbe, dann
    // legt schon der Farb-Effekt die Ebene neu an; welcher Weg sie zurückholt, trennt der
    // Schritt nicht.
    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    await page.getByRole('menuitem', { name: /Hell/ }).click();
    await expect.poll(quelleDa, { timeout: 10_000 }).toBe(true);

    // Nichts davon ging an den Server.
    const breite = String(POSITION.latitude);
    const laenge = String(POSITION.longitude);
    expect(anfragen.filter((a) => a.includes(breite) || a.includes(laenge))).toEqual([]);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(breite);

    // Ausschalten räumt den Punkt: die Quelle bleibt, ist aber leer.
    await knopf.click();
    await expect(knopf).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte!;
          const q = map.getStyle()?.sources?.['eigenposition'] as
            { data?: { features?: unknown[] } } | undefined;
          return q?.data?.features?.length ?? -1;
        }),
      )
      .toBe(0);

    expect(seitenFehler.map((f) => f.message)).toEqual([]);
  });
});

test.describe('Eigenposition: Anflug an die Genauigkeit (LFH-766)', () => {
  // WLAN-Ortung am Fükw: 2 km Unschärfe.
  const GROB = { latitude: 52.3759, longitude: 9.732, accuracy: 2000 };
  test.use({ geolocation: GROB, permissions: ['geolocation'] });

  test('erster Standort mit 2 km Genauigkeit: der Kreis steht vollständig im Bild', async ({
    page,
  }) => {
    const seitenFehler: Error[] = [];
    page.on('pageerror', (f) => seitenFehler.push(f));
    await lagekarteOeffnen(page);
    await page.getByRole('button', { name: 'Eigenposition' }).click();
    await expect.poll(() => eigenpositionGezeichnet(page), { timeout: 10_000 }).toBeGreaterThan(0);

    // Rahmen des Kreises unabhängig vom Code gerechnet: 2 km in Grad Breite bzw. Länge.
    const dLat = (GROB.accuracy / 6_371_008.8) * (180 / Math.PI);
    const dLon = dLat / Math.cos((GROB.latitude * Math.PI) / 180);
    const kreisImBild = () =>
      page.evaluate(
        ({ lat, lon, dLat, dLon }) => {
          const map = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
          if (map.isMoving()) return false;
          const b = map.getBounds();
          return (
            b.getWest() <= lon - dLon &&
            b.getEast() >= lon + dLon &&
            b.getSouth() <= lat - dLat &&
            b.getNorth() >= lat + dLat
          );
        },
        { lat: GROB.latitude, lon: GROB.longitude, dLat, dLon },
      );
    await expect.poll(kreisImBild, { timeout: 10_000 }).toBe(true);
    // …und eingerahmt, nicht bloß von der Übersicht mit umfasst: Mitte am Standort, der Kreis füllt
    // das Bild (2 km Radius bei 1280×720 ≈ Zoom 13–14, die Übersicht steht bei Zoom 5).
    const ansicht = await page.evaluate(() => {
      const map = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
      return { mitte: map.getCenter(), zoom: map.getZoom() };
    });
    expect(Math.abs(ansicht.mitte.lat - GROB.latitude)).toBeLessThan(0.005);
    expect(Math.abs(ansicht.mitte.lng - GROB.longitude)).toBeLessThan(0.005);
    expect(ansicht.zoom).toBeGreaterThan(12);
    expect(ansicht.zoom).toBeLessThan(15);
    expect(seitenFehler.map((f) => f.message)).toEqual([]);
  });

  test('beim Zeichnen am eigenen Standort liegt die Zeichnung über dem Punkt', async ({
    page,
    context,
  }) => {
    const { canvas } = await lagekarteOeffnen(page);
    await page.getByRole('button', { name: 'Eigenposition' }).click();
    await expect.poll(() => eigenpositionGezeichnet(page), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.isMoving()),
      )
      .toBe(false);

    await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
    const zaehler = page.locator('[data-lfh="zeichnen-punkte"]');
    // Mitten im Genauigkeitskreis, über der Bildmitte (darunter liegt die Steuerung im Fuß).
    const box = (await canvas.boundingBox())!;
    for (const [dx, dy] of [
      [-30, -60],
      [30, -60],
    ]) {
      await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    }
    await expect(zaehler).toHaveText('2 Punkte');

    // Ein neuer Standort während des Zeichnens zieht die Eigenposition nach — aber nicht über die
    // Zeichnung.
    await context.setGeolocation({ latitude: 52.3761, longitude: 9.7322, accuracy: 2000 });
    const folge = () =>
      page.evaluate(() => {
        const map = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
        const ids = (map.getStyle()?.layers ?? []).map((l) => l.id);
        const q = map.getStyle()?.sources?.['eigenposition'] as
          | { data?: { features?: { geometry: { type: string; coordinates: number[] } }[] } }
          | undefined;
        const punkt = q?.data?.features?.find((f) => f.geometry.type === 'Point');
        return {
          nachgefuehrt: punkt?.geometry.coordinates[1] === 52.3761,
          eigenposition: ids.flatMap((id, i) => (id.startsWith('eigenposition-') ? [i] : [])),
          ersteZeichnung: ids.findIndex((id) => id.startsWith('td-')),
        };
      });
    await expect.poll(async () => (await folge()).nachgefuehrt, { timeout: 10_000 }).toBe(true);
    const stand = await folge();
    // Alle vier Ebenen (Kreis, Rand, Kante, Punkt) stehen — sonst wäre „darunter“ leer wahr.
    expect(stand.eigenposition).toHaveLength(4);
    expect(stand.ersteZeichnung).toBeGreaterThanOrEqual(0);
    expect(Math.max(...stand.eigenposition)).toBeLessThan(stand.ersteZeichnung);
  });

  test('Karte vor dem ersten Standort verschoben: kein Anflug, der Punkt erscheint', async ({
    page,
  }) => {
    // Ortung, die erst auf Freigabe des Tests meldet — wie ein GPS-Kaltstart, nur steuerbar.
    await page.addInitScript(() => {
      const geo = navigator.geolocation;
      const echt = geo.watchPosition.bind(geo);
      let frei = false;
      const warten: (() => void)[] = [];
      (window as unknown as { __ortungFreigeben: () => void }).__ortungFreigeben = () => {
        frei = true;
        for (const f of warten.splice(0)) f();
      };
      geo.watchPosition = (ok, fehler, optionen) =>
        echt(
          (p) => {
            if (frei) ok(p);
            else warten.push(() => ok(p));
          },
          fehler,
          optionen,
        );
    });
    const { canvas } = await lagekarteOeffnen(page);
    await page.getByRole('button', { name: 'Eigenposition' }).click();

    // Die Einsatzkraft zieht die Karte, bevor der Standort da ist.
    const box = (await canvas.boundingBox())!;
    const mx = box.x + box.width / 2;
    const my = box.y + box.height / 2 - 60;
    await page.mouse.move(mx, my);
    await page.mouse.down();
    await page.mouse.move(mx + 120, my + 40, { steps: 8 });
    await page.mouse.up();
    const karte = () =>
      page.evaluate(() => {
        const map = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
        return { bewegt: map.isMoving(), mitte: map.getCenter(), zoom: map.getZoom() };
      });
    await expect.poll(async () => (await karte()).bewegt).toBe(false);
    const vorher = await karte();

    await page.evaluate(() =>
      (window as unknown as { __ortungFreigeben: () => void }).__ortungFreigeben(),
    );
    await expect.poll(() => eigenpositionGezeichnet(page), { timeout: 10_000 }).toBeGreaterThan(0);
    // Der Anflug liefe im selben Zug an, in dem der Punkt erscheint: jetzt stünde die Karte in
    // Bewegung oder anderswo.
    const nachher = await karte();
    expect(nachher.bewegt).toBe(false);
    expect(nachher.mitte.lng).toBeCloseTo(vorher.mitte.lng, 6);
    expect(nachher.mitte.lat).toBeCloseTo(vorher.mitte.lat, 6);
    expect(nachher.zoom).toBeCloseTo(vorher.zoom, 6);
  });
});

/**
 * Zeichnen per Link (LFH-825): der Kaltstart über `?zeichnen=` (voller Seitenaufruf wie ein neuer
 * Tab aus der Sprungpalette) landet im Zeichenmodus der echten Karte, räumt die Adresse, und Esc
 * ohne Punkt beendet den Modus (LFH-712).
 */
test('Zeichnen per Link: ?zeichnen=gefahrengebiet startet den Modus und räumt', async ({
  page,
}) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const { canvas } = await lagekarteOeffnen(page, '?zeichnen=gefahrengebiet');

  await expect(page.getByText('Gefahrengebiet · Fläche')).toBeVisible();
  await expect(page.locator('[data-lfh="zeichnen-punkte"]')).toHaveText('0 Punkte');
  await expect(canvas).toHaveCSS('cursor', 'crosshair');
  await expect(page).not.toHaveURL(/zeichnen=/);

  // Der Wechsel vom Blindstil auf den Style der Ansicht hat die Zeichnung nicht zerlegt: Punkte
  // landen bei terra-draw (D6).
  const box = (await canvas.boundingBox())!;
  for (const [dx, dy] of [
    [-120, -140],
    [120, -140],
    [120, -40],
  ]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  }
  await expect(page.locator('[data-lfh="zeichnen-punkte"]')).toHaveText('3 Punkte');
  // Die Zeichnung liegt wie beim Start über das Paneel ÜBER Zonen und Abschnitten: gestartet vor
  // dem Neuaufbau der App-Ebenen läge sie direkt über dem Hintergrund (Review zu D6).
  const ebenen = await page.evaluate(() =>
    ((window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.getStyle()?.layers ?? []).map(
      (l) => l.id,
    ),
  );
  const ersteZeichnung = ebenen.findIndex((id) => id.startsWith('td-zone-'));
  expect(ersteZeichnung).toBeGreaterThanOrEqual(0);
  for (const id of ['abschnitte-fill', 'zonen-fill', 'zonen-label']) {
    expect(ebenen.indexOf(id), `${id} fehlt`).toBeGreaterThanOrEqual(0);
    expect(ebenen.indexOf(id), `${id} liegt über der Zeichnung`).toBeLessThan(ersteZeichnung);
  }

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeHidden();
  expect(seitenFehler).toEqual([]);
});
