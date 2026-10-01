import { expect, test, type Page } from '@playwright/test';

// Ebene „Betroffene" auf der Lagekarte. Ob Personen in IHRER Quelle `marker-personen` landen,
// dort untereinander clustern statt Kräfte-Marker zu schlucken, und ob ein Personen-Donut
// auffächert, sieht nur ein echter Renderer (die Unit-Tests stubben die Kartenfläche).
// Geprüft wird die Quelle (`querySourceFeatures`), nicht die Optik.
//
// Als NICHT-Admin: ein Admin ist nie gesperrt, „ohne Modulzugriff keine Personen" wäre als
// Admin nicht widerlegbar. Die geteilte Ansicht trägt die Ebene EINGESCHALTET — die
// Zugriffsgrenze muss an den Daten sitzen, nicht am Schalter.

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

// Eine Einheit mitten in dreißig Betroffenen; drei weitere rund 100 km entfernt als kleine
// Gruppe unter der Spider-Grenze (12). Der Abstand hält die ferne Traube bei Zoom 12 aus den
// geladenen Kacheln — sonst stünde ihr Donut als zweiter DOM-Marker daneben.
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
      betreuungsstelle: true,
    },
  });
  // Ohne `system_rolle`/`org_rolle` gilt „keiner"/„keine" — ein Mitglied ohne Sonderrechte.
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
  // … als Cluster, nicht als dreißig lose Punkte (sonst prüfte der Test kein Clustering).
  // Gewartet: direkt nach dem Sprung kann die Quelle die Punkte noch ungeclustert tragen.
  await expect
    .poll(async () => (await features(page, 'marker-personen')).some((p) => p.cluster), {
      timeout: 30_000,
    })
    .toBe(true);
  // Die Einheit mitten in der Traube bleibt ein Einzel-Feature ihrer eigenen Quelle — kein
  // Personen-Cluster hat sie geschluckt. Eigenes Warten: die Kräfte-Quelle füllt sich
  // unabhängig und war unter Last beim Lesen noch leer.
  await expect
    .poll(async () => (await features(page, 'marker-cluster')).map((p) => p.schluessel), {
      timeout: 30_000,
    })
    .toContain(`einheit-${einheitId}`);
  const kraefte = await features(page, 'marker-cluster');
  expect(kraefte.some((p) => p.cluster)).toBe(false);
  expect(personenIn(kraefte)).toBe(0);
  // Legende steht bei eingeschalteter Ebene.
  await expect(page.getByRole('list', { name: 'Sichtungslegende' })).toBeVisible();
  // Personen-Cluster sind WebGL-Layer UNTER den Kräften, kein DOM-Donut — hier also keiner.
  await expect(page.locator('.maplibregl-marker')).toHaveCount(0);
  // Und die Einheit mitten in der Traube bleibt anwählbar: der Klick gehört dem Zeichen
  // obenauf, nicht dem Cluster darunter.
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
        // Verschiedene Schlüssel zählen: ein Punkt nahe einer Kachelkante kommt über mehrere
        // Kacheln.
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

// Die unsichtbare Trefferzone der Kräftemarker liegt in der Mal-Reihenfolge ÜBER den
// Personen-Clustern. Zählte sie als „oberstes Feature", nähme eine Einheit knapp neben einem
// Cluster diesem den Tipp weg. Gemessen in `handschuh` (Radius 36) mit der Einheit rund 34 px
// neben der Clustermitte: die Mitte liegt in ihrer Zone, aber nicht unter ihrem Zeichen.
test('Betroffene (LFH-711): die Trefferzone einer Einheit daneben nimmt dem Personen-Cluster den Tipp nicht', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmeldenAls(page, ADMIN, PW);
  const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Zonenlage ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}`;
  const ort: [number, number] = [8.4, 52.0];
  for (let i = 0; i < 3; i++) {
    await senden(page, 'post', `${basis}/personen`, {
      antreff_lat: ort[1] + i * 0.0002,
      antreff_lon: ort[0],
    });
  }
  const mitte: [number, number] = [ort[0], ort[1] + 0.0002];
  const { id: einheitId } = await senden(page, 'post', `${basis}/einheiten`, { name: 'Zug Rand' });
  // Rund 34 px östlich bei Zoom 12 — unten nachgemessen und nachgestellt.
  await senden(page, 'patch', `${basis}/einheiten/${einheitId}/position`, {
    lat: mitte[1],
    lon: mitte[0] + 0.0117,
  });
  const ansichten = (await (await page.request.get(`${basis}/karten-ansichten`)).json()) as {
    id: number;
    ist_standard: boolean;
  }[];
  const standard = ansichten.find((a) => a.ist_standard)!;
  await senden(page, 'patch', `${basis}/karten-ansichten/${standard.id}`, {
    layer_sichtbar: { einheit: true, person: true },
  });

  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  await karteBereit(page);
  await springe(page, mitte, 12);
  await expect
    .poll(async () => (await features(page, 'marker-personen')).some((p) => p.cluster), {
      timeout: 30_000,
    })
    .toBe(true);
  await expect
    .poll(async () => (await features(page, 'marker-cluster')).map((p) => p.schluessel), {
      timeout: 30_000,
    })
    .toContain(`einheit-${einheitId}`);
  // Zoom so, dass die Einheit 30 px neben der Clustermitte steht: in der Zone (Radius 36), ihr
  // Zeichen (halbe Kante 17) aber nicht über der Mitte. Bis Zoom 14 bleibt die Gruppe ein Cluster.
  const zoom = await page.evaluate(
    ({ a, b }) => {
      const k = (window as unknown as { __lfhKarte: MapHaken & { getZoom(): number } }).__lfhKarte;
      const pa = k.project(a);
      const pb = k.project(b);
      return k.getZoom() + Math.log2(30 / Math.hypot(pa.x - pb.x, pa.y - pb.y));
    },
    { a: mitte, b: [mitte[0] + 0.0117, mitte[1]] as [number, number] },
  );
  expect(zoom, 'die Dreiergruppe muss geclustert bleiben').toBeLessThanOrEqual(14);
  await springe(page, mitte, zoom);
  await expect
    .poll(async () => (await features(page, 'marker-personen')).some((p) => p.cluster), {
      timeout: 30_000,
    })
    .toBe(true);

  // Vorbedingungen am Klickpunkt: die Zone der Einheit liegt DARÜBER (sonst prüfte der Test
  // nichts), ihr Zeichen nicht (sonst gehörte der Tipp zu Recht der Einheit).
  const amPunkt = (ebenen: string[]) =>
    page.evaluate(
      ({ c, ids }) => {
        const k = (
          window as unknown as {
            __lfhKarte: MapHaken & {
              queryRenderedFeatures(p: [number, number], o: { layers: string[] }): unknown[];
            };
          }
        ).__lfhKarte;
        const p = k.project(c);
        return k.queryRenderedFeatures([p.x, p.y], { layers: ids }).length;
      },
      { c: mitte, ids: ebenen },
    );
  await expect.poll(() => amPunkt(['personen-cluster-kreis']), { timeout: 15_000 }).toBe(1);
  expect(await amPunkt(['marker-treffer']), 'die Zone der Einheit deckt die Clustermitte').toBe(1);
  expect(await amPunkt(['marker-symbol', 'marker-label']), 'kein Zeichen an der Mitte').toBe(0);

  await klickeAuf(page, mitte);
  await expect
    .poll(
      async () =>
        new Set(
          (await features(page, 'spider-leaves'))
            .map((p) => String(p.schluessel))
            .filter((s) => s.startsWith('person-')),
        ).size,
      { timeout: 15_000 },
    )
    .toBe(3);
  await expect(page.locator('[data-lfh="auswahl"]').getByText('Zug Rand')).toHaveCount(0);
});

// LFH-668, D5 (`openspec/changes/archive/2026-10-01-lfh-668-betroffenen-karte-schleuse/design.md`): auf der Lagekarte
// gibt es keine Schleuse, der Spider-Schutz der Kartenfläche gilt aber auch hier. Eine reine
// Inhaltsänderung (Sichtung) lässt ein aufgefächertes Bündel offen, ein Zugang klappt es zu.
test('Betroffene (LFH-668): ein aufgefächertes Bündel überlebt eine Sichtungsänderung, ein Zugang klappt es zu', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmeldenAls(page, ADMIN, PW);
  const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Spider Lage ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}`;
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    ids.push(
      (
        await senden(page, 'post', `${basis}/personen`, {
          antreff_lat: FERN[1] + i * 0.0002,
          antreff_lon: FERN[0],
          sichtung: 'sk3',
        })
      ).id,
    );
  }
  const ansichten = (await (await page.request.get(`${basis}/karten-ansichten`)).json()) as {
    id: number;
    ist_standard: boolean;
  }[];
  await senden(
    page,
    'patch',
    `${basis}/karten-ansichten/${ansichten.find((a) => a.ist_standard)!.id}`,
    {
      layer_sichtbar: { einsatzort: true, person: true },
    },
  );
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await karteBereit(page);
  await springe(page, FERN, 12);
  await expect
    .poll(async () => (await features(page, 'marker-personen')).some((p) => p.cluster), {
      timeout: 30_000,
    })
    .toBe(true);

  const blaetter = async () => {
    const je = new Map<string, string>();
    for (const p of await features(page, 'spider-leaves')) {
      const s = String(p.schluessel ?? '');
      if (s.startsWith('person-')) je.set(s, String(p.kurzzeichen ?? ''));
    }
    return Object.fromEntries([...je.entries()].sort());
  };
  await klickeAuf(page, [FERN[0], FERN[1] + 0.0002]);
  await expect.poll(async () => Object.keys(await blaetter()).length, { timeout: 15_000 }).toBe(3);
  expect(Object.values(await blaetter())).toEqual(['III', 'III', 'III']);

  // Reine Inhaltsänderung: offen, das Blatt zeigt die neue Sichtung.
  await senden(page, 'post', `${basis}/personen/${ids[0]}/sichtung`, { kategorie: 'sk1' });
  await expect
    .poll(async () => (await blaetter())[`person-${ids[0]}`], { timeout: 15_000 })
    .toBe('I');
  expect(Object.keys(await blaetter())).toHaveLength(3);

  // Zugang in der Traube: Menge geändert → der Spider klappt zu.
  await senden(page, 'post', `${basis}/personen`, {
    antreff_lat: FERN[1] + 0.0001,
    antreff_lon: FERN[0],
  });
  await expect.poll(async () => Object.keys(await blaetter()).length, { timeout: 15_000 }).toBe(0);
});
