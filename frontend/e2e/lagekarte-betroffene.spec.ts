import { expect, test, type Page } from '@playwright/test';

// LFH-648: Ebene „Betroffene" auf der Lagekarte.
//
// Warum im Browser: `LagekartePage.test.tsx` stubbt die Kartenfläche weg, `markerLayer.test.ts`
// arbeitet mit einer Attrappe. Ob Personen wirklich in IHRER Quelle `marker-personen` landen,
// ob sie dort untereinander clustern, statt Kräfte-Marker zu schlucken, und ob ein
// Personen-Donut auffächert, sieht nur ein echter Renderer. Geprüft wird die Quelle
// (`querySourceFeatures`), nicht die Optik.
//
// Als NICHT-Admin: ein Admin ist nie gesperrt (`istModulGesperrt`, Admin-Mindest-Guard im
// Backend). Die Aussage „ohne Modulzugriff keine Personen" wäre als Admin nicht widerlegbar.
// Die geteilte Ansicht trägt die Ebene ausdrücklich EINGESCHALTET — die Zugriffsgrenze muss an
// den Daten sitzen, nicht am Schalter.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  loaded(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  project(ll: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  querySourceFeatures(quelle: string): { properties: Record<string, unknown> | null }[];
}

async function anmeldenAls(page: Page, benutzer: string, passwort: string) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(benutzer);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function abmelden(page: Page) {
  const antwort = await page.request.post('/api/auth/logout');
  expect(antwort.ok(), `Abmelden: ${antwort.status()}`).toBeTruthy();
}

async function senden(
  page: Page,
  methode: 'post' | 'put' | 'patch',
  pfad: string,
  data: unknown,
): Promise<{ id: number }> {
  const antwort = await page.request[methode](pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as { id: number };
}

/** Eigenschaften der Features einer Quelle (Cluster tragen `cluster`/`point_count`). */
async function features(page: Page, quelle: string): Promise<Record<string, unknown>[]> {
  return page.evaluate((q) => {
    const k = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
    if (!k || !k.loaded()) return [];
    return k.querySourceFeatures(q).map((f) => f.properties ?? {});
  }, quelle);
}

/** Zahl der Personen, die eine Quelle trägt — Einzel-Features plus Cluster-Inhalt. */
function personenIn(props: Record<string, unknown>[]): number {
  // querySourceFeatures kann denselben Cluster über mehrere Kacheln liefern → je id einmal.
  const gesehen = new Set<string>();
  let n = 0;
  for (const p of props) {
    const key = p.cluster ? `c${String(p.cluster_id)}` : String(p.schluessel);
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    if (p.cluster) n += Number(p.c_person ?? 0);
    else if (p.typ === 'person') n += 1;
  }
  return n;
}

async function karteBereit(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
}

async function springe(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(
    ({ c, z }) =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.jumpTo({ center: c, zoom: z }),
    { c: center, z: zoom },
  );
}

/** Klick auf die Karte an einer Geokoordinate — WebGL-Layer haben kein DOM-Element. */
async function klickeAuf(page: Page, ll: [number, number]) {
  const p = await page.evaluate((c) => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    const px = k.project(c);
    const r = k.getCanvas().getBoundingClientRect();
    return { x: r.left + px.x, y: r.top + px.y };
  }, ll);
  await page.mouse.click(p.x, p.y);
}

// Ort der Lage: eine Einheit mitten in dreißig Betroffenen; drei weitere Betroffene rund
// 100 km entfernt als kleine Gruppe, die unterhalb der Spider-Grenze (12) auffächert. Der
// Abstand hält die Traube bei Zoom 12 sicher aus den geladenen Kacheln — sonst stünde ihr
// Donut als zweiter DOM-Marker neben dem, der geklickt werden soll.
const MITTE: [number, number] = [9.9937, 53.5511];
const FERN: [number, number] = [11.5, 53.55];

test('Betroffene: eigene Cluster-Quelle, Kräfte bleiben einzeln, ohne Modulzugriff nichts', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const LAUF = Date.now();
  const NUTZER = `e2e-betroffene-${LAUF}`;
  const NUTZER_PW = 'e2e-betroffene-pw-123';

  // ── Aufbau als Admin ────────────────────────────────────────────────────────────────
  await anmeldenAls(page, ADMIN, PW);
  // Kein Modulname im Einsatznamen (die Palette sucht Module und Einsätze gemeinsam).
  const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Fundlage ${LAUF}`,
  });
  const basis = `/api/einsaetze/${einsatzId}`;
  const { id: einheitId } = await senden(page, 'post', `${basis}/einheiten`, { name: 'Zug Mitte' });
  await senden(page, 'patch', `${basis}/einheiten/${einheitId}/position`, {
    lat: MITTE[1],
    lon: MITTE[0],
  });
  for (let i = 0; i < 30; i++) {
    await senden(page, 'post', `${basis}/personen`, {
      // Streuung von wenigen Metern: bei Zoom 13 eine Traube, nie ein einzelner Punkt.
      antreff_lat: MITTE[1] + (i % 6) * 0.0002,
      antreff_lon: MITTE[0] + Math.floor(i / 6) * 0.0002,
      sichtung: i % 2 ? 'sk2' : 'sk3',
    });
  }
  for (let i = 0; i < 3; i++) {
    await senden(page, 'post', `${basis}/personen`, {
      antreff_lat: FERN[1] + i * 0.0002,
      antreff_lon: FERN[0],
    });
  }
  // Die geteilte Standardansicht trägt die Ebene EINGESCHALTET.
  const ansichten = (await (await page.request.get(`${basis}/karten-ansichten`)).json()) as {
    id: number;
    ist_standard: boolean;
  }[];
  const standard = ansichten.find((a) => a.ist_standard)!;
  await senden(page, 'patch', `${basis}/karten-ansichten/${standard.id}`, {
    layer_sichtbar: {
      einsatzort: true,
      uhs: true,
      schaden: true,
      einheit: true,
      fahrzeug: true,
      fuehrung: true,
      abschnitt: true,
      zone: true,
      lagemeldung: true,
      freies_zeichen: true,
      person: true,
    },
  });
  // Ohne `system_rolle`/`org_rolle` fällt das Backend auf „keiner"/„keine" zurück — ein
  // gewöhnliches Mitglied ohne Sonderrechte.
  const { id: nutzerId } = await senden(page, 'post', '/api/benutzer', {
    anzeigename: `E2E Betroffene ${LAUF}`,
    benutzername: NUTZER,
    passwort: NUTZER_PW,
  });
  await senden(page, 'put', `${basis}/mitglieder/${nutzerId}`, {
    einsatz_rolle: 'fuehrungspersonal',
  });
  await abmelden(page);

  // ── Mit Zugriff ────────────────────────────────────────────────────────────────────────
  await anmeldenAls(page, NUTZER, NUTZER_PW);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await karteBereit(page);
  await expect(page.getByRole('switch', { name: 'Betroffene' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await springe(page, MITTE, 13);

  // Alle 30 Personen der Traube stecken in `marker-personen` …
  await expect
    .poll(async () => personenIn(await features(page, 'marker-personen')), { timeout: 30_000 })
    .toBe(30);
  // … als Cluster, nicht als dreißig lose Punkte (Vorbedingung: sonst prüfte der Test kein
  // Clustering, sondern nur die Zuordnung).
  expect((await features(page, 'marker-personen')).some((p) => p.cluster)).toBe(true);
  // Die Einheit steht mitten in der Traube und bleibt trotzdem ein Einzel-Feature ihrer
  // eigenen Quelle — kein Personen-Cluster hat sie geschluckt.
  const kraefte = await features(page, 'marker-cluster');
  expect(kraefte.map((p) => p.schluessel)).toContain(`einheit-${einheitId}`);
  expect(kraefte.some((p) => p.cluster)).toBe(false);
  expect(personenIn(kraefte)).toBe(0);
  // Legende steht bei eingeschalteter Ebene.
  await expect(page.getByRole('list', { name: 'Sichtungslegende' })).toBeVisible();
  // Personen-Cluster sind WebGL-Layer UNTER den Kräften, kein DOM-Donut über dem Canvas:
  // hier gibt es nur Personen-Cluster und eine einzelne Einheit, also keinen Donut.
  await expect(page.locator('.maplibregl-marker')).toHaveCount(0);
  // Und die Einheit mitten in der Traube bleibt anwählbar — der Klick gehört dem Zeichen
  // obenauf, nicht dem Personen-Cluster darunter (Review-Befund: ein DOM-Donut fing ihn ab).
  const ausgewaehlt = page.locator('[data-paneel="ausgewaehlt"]');
  await expect(async () => {
    await klickeAuf(page, MITTE);
    await expect(ausgewaehlt.getByText('Zug Mitte')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press('Escape');

  // Die ferne Dreiergruppe fächert per Klick auf ihren Cluster-Kreis auf.
  await springe(page, FERN, 12);
  await expect
    .poll(async () => (await features(page, 'marker-personen')).some((p) => p.cluster), {
      timeout: 30_000,
    })
    .toBe(true);
  await klickeAuf(page, [FERN[0], FERN[1] + 0.0002]);
  await expect
    .poll(
      async () =>
        // Verschiedene Schlüssel zählen: eine ungeclusterte Quelle liefert einen Punkt nahe
        // einer Kachelkante über mehrere Kacheln (gemessen: 10 Treffer für 3 Personen).
        new Set(
          (await features(page, 'spider-leaves'))
            .map((p) => String(p.schluessel))
            .filter((s) => s.startsWith('person-')),
        ).size,
      { timeout: 15_000 },
    )
    .toBe(3);
  await abmelden(page);

  // ── Ohne Zugriff: Modul „Personen" im Einsatz ausgeblendet ──────────────────────────────
  await anmeldenAls(page, ADMIN, PW);
  await senden(page, 'put', `${basis}/modul-overrides/personen`, {
    sichtbar: false,
    benoetigte_rolle: null,
  });
  await abmelden(page);

  await anmeldenAls(page, NUTZER, NUTZER_PW);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await karteBereit(page);
  await springe(page, MITTE, 13);
  // Vorbedingung: die Kräfte-Quelle ist geladen — sonst wäre „keine Personen" trivial.
  await expect
    .poll(async () => (await features(page, 'marker-cluster')).map((p) => p.schluessel), {
      timeout: 30_000,
    })
    .toContain(`einheit-${einheitId}`);
  expect(personenIn(await features(page, 'marker-personen'))).toBe(0);
  expect(personenIn(await features(page, 'marker-cluster'))).toBe(0);
  await expect(page.getByRole('switch', { name: 'Schäden' })).toBeVisible();
  await expect(page.getByRole('switch', { name: /Betroffene/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Betroffene/ })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Sichtungslegende' })).toHaveCount(0);
});
