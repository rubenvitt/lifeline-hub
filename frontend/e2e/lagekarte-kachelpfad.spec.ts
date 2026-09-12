import { expect, test, type Page, type Route } from '@playwright/test';

// Der echte Kachel-Pfad der Lagekarte (LFH-356/1) — die Hälfte, die `lagekarte-smoke.spec.ts`
// bewusst NICHT abdeckt.
//
// Warum es diese Datei gibt: der Smoke fährt auf einer frischen Temp-DB ohne konfigurierte
// Basemap, `baueBasemapStyle` fällt auf `blindStyle` zurück (`sources: {}`). Deterministisch und
// schnell — aber es wird dabei NIE eine Kachel geholt. Ungeprüft blieb damit die Kette
// „Style-JSON → substituierte Kachel-URL → `transformRequest` → fetch IM WORKER → Parsen",
// und genau die ist schon einmal gebrochen (LFH-182: root-relative Proxy-URLs ohne
// Dokument-Base im Tile-Worker) und von maplibre 6 angefasst worden (neue Worker-Verdrahtung
// über `setWorkerUrl`).
//
// DIE QUELLE STELLT DER TEST SELBST. Kein Tile-Server, kein Seed, kein Netz: `page.route`
// beantwortet `/api/karte/config` mit einem Online-VEKTOR-View und dessen Style-JSON mit einer
// Vector-Source. Die Kachel-Antwort ist ein LEERER Körper — eine null-Byte-Antwort ist eine
// gültige, leere Mapbox-Vector-Tile, der Worker parst sie also fehlerfrei statt einen
// Tile-Error zu werfen (gemessen: `isSourceLoaded('fixture')` true). Und `page.route` greift
// auch für die Anfragen des maplibre-WORKERS (gemessen: 4 von 4 Kacheln abgefangen) — das war
// die offene Frage aus dem Ticket („Route-Stub oder Fixture-Backend").
//
// VEKTOR, NICHT RASTER, und das ist keine Geschmacksfrage: Raster-Kacheln lädt maplibre auf dem
// Hauptthread. Nur eine Vector-Source schickt die Anfrage durch den Worker — also durch die
// Bruchstelle, um die es geht.
//
// DIE TRAGENDE ZUSICHERUNG IST DER MITSCHNITT, NICHT DIE NETZ-WIRKUNG (gemessen, und es
// korrigiert die naheliegende Annahme des Tickets): mit ENTFERNTEM `transformRequest` in
// `Kartenflaeche.tsx` lief dieser Fixture-Lauf unverändert durch — 4 Kachel-Anfragen, alle
// absolut, `map.loaded()` true. maplibre 6 fetcht im Worker über `new Request(url)`, und das
// löst eine root-relative URL gegen `self.location` des Worker-Skripts auf; das liegt
// same-origin, es kommt dasselbe heraus. Ein Test, der nur „eine Kachel wurde geholt" prüft,
// wäre also grün, ohne dass `absolutiereProxyAnfrage` je liefe — er könnte nicht rot werden.
// Deshalb trägt die Zusicherung `window.__lfhKartenAnfragen` (DEV-Haken neben `__lfhKarte`,
// Begründung dort): sie zeigt Eingabe UND Ausgabe des Seams. Mutationsproben:
// `transformRequest` entfernt → Liste leer → rot; `absolutiereProxyAnfrage` auf Durchreiche
// gestellt → `aus === ein` → rot.
//
// Die Netz-Assertionen bleiben daneben stehen, weil sie etwas ANDERES belegen: dass die
// absolutierte URL wirklich abgesetzt und die Antwort vom Worker verarbeitet wurde. Bei totem
// Worker (gemessen im Smoke) bliebe die Quelle ungeladen.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Root-relative Kachel-Vorlage wie sie das Backend liefert (`/api/karte/proxy/…`, LFH-182). */
const KACHEL_VORLAGE = '/api/karte/proxy/9/tile/{z}/{x}/{y}.pbf';
const STIL_PFAD = '/api/karte/proxy/9/style.json';
/** Präfix der substituierten Kachel-URLs — ohne Platzhalter, so wie MapLibre sie anfragt. */
const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';

/** Ausschnitt des DEV-Mitschnitts aus `Kartenflaeche.tsx`. Bewusst hier nachgebildet statt aus
 *  `src/` importiert: der Spec-Ordner bindet nicht gegen die Anwendung. */
interface KartenAnfrage {
  ein: string;
  aus: string;
}

interface MapHaken {
  getStyle(): { sources?: Record<string, unknown> } | undefined;
  isSourceLoaded(id: string): boolean;
  loaded(): boolean;
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Einsatz über die API anlegen — kürzer und unempfindlicher als der Klickweg, und der Name
 *  trägt KEINEN Modulnamen: die Kommandopalette durchsucht Module und Einsätze in derselben
 *  Optionsliste, ein „…Lagekarte…" ließe command-palette.spec.ts strict-mode-verletzen. */
async function einsatzAnlegen(page: Page): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Kachelpfad ${Date.now()}` },
  });
  expect(antwort.ok(), `POST /api/einsaetze: ${antwort.status()} ${await antwort.text()}`).toBe(
    true,
  );
  return ((await antwort.json()) as { id: number }).id;
}

test('Lagekarte: Kachel-Pfad — absolutiereProxyAnfrage läuft, der Worker holt und parst', async ({
  page,
}) => {
  // Vorbedingung als Zusicherung, nicht als Annahme: die Fixture MUSS root-relativ sein, sonst
  // prüft der Test die Absolutierung nicht mehr — und niemand würde es merken.
  expect(KACHEL_VORLAGE.startsWith('/'), 'Kachel-Vorlage muss root-relativ sein').toBe(true);
  expect(KACHEL_VORLAGE.startsWith('//'), 'protokoll-relativ ist ausgenommen (LFH-182)').toBe(
    false,
  );

  const seitenFehler: Error[] = [];
  page.on('pageerror', (fehler) => seitenFehler.push(fehler));

  /** Die URLs, mit denen der Worker die Kacheln tatsächlich angefragt hat. */
  const kachelAnfragen: string[] = [];
  await page.route('**/api/karte/config', (route: Route) =>
    route.fulfill({
      json: {
        karten_bau_verfuegbar: false,
        offline_regionen: [],
        offline_verfuegbar: false,
        // Ein Online-View macht `defaultModus` zu 'online' (basemapAuswahl.ts) — damit
        // konstruiert die Karte direkt mit dem Kachel-Style statt mit blindStyle.
        online_styles: [{ name: 'Kachel-Fixture', typ: 'vektor', url: STIL_PFAD }],
      },
    }),
  );
  await page.route(`**${STIL_PFAD}`, (route: Route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {
          fixture: { type: 'vector', tiles: [KACHEL_VORLAGE], minzoom: 0, maxzoom: 14 },
        },
        layers: [
          { id: 'fixture-grund', type: 'background', paint: { 'background-color': '#e8e8e8' } },
          // Ohne einen Layer AUF der Source fragt MapLibre keine Kachel an.
          { id: 'fixture-linien', type: 'line', source: 'fixture', 'source-layer': 'strassen' },
        ],
      },
    }),
  );
  await page.route(`**${KACHEL_PRAEFIX}**`, (route: Route) => {
    kachelAnfragen.push(route.request().url());
    // Leerer Körper = gültige leere Vector-Tile → der Worker parst statt zu fehlern.
    return route.fulfill({
      status: 200,
      contentType: 'application/x-protobuf',
      body: Buffer.alloc(0),
    });
  });

  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);

  await expect(page.getByTestId('kartenflaeche')).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);

  // (1) AK „absolutiereProxyAnfrage wird nachweislich ausgeführt": der Seam hat für eine
  //     KACHEL-URL gelaufen, und er hat sie absolutiert. Geprüft wird das Paar ein→aus, nicht
  //     bloß die Anwesenheit eines Eintrags — eine Durchreiche wäre sonst nicht unterscheidbar.
  const erwarteteHerkunft = new URL(page.url()).origin;
  await expect
    .poll(
      () =>
        page.evaluate((praefix) => {
          const liste =
            (window as unknown as { __lfhKartenAnfragen?: KartenAnfrage[] }).__lfhKartenAnfragen ??
            [];
          const kacheln = liste.filter((a) => a.ein.startsWith(praefix));
          if (kacheln.length === 0)
            return `keine Kachel-Anfrage im Mitschnitt (${liste.length} Einträge insgesamt: ${liste
              .map((a) => a.ein)
              .join(', ')})`;
          return JSON.stringify(kacheln[0]);
        }, KACHEL_PRAEFIX),
      {
        timeout: 20_000,
        message:
          'transformRequest lief für keine Kachel — Verdacht: die Option fehlt an der Map, ' +
          'oder die Karte kam nie zum Kachel-Laden',
      },
    )
    .not.toContain('keine Kachel-Anfrage');

  const mitschnitt: KartenAnfrage[] = await page.evaluate(
    () =>
      (window as unknown as { __lfhKartenAnfragen?: KartenAnfrage[] }).__lfhKartenAnfragen ?? [],
  );
  const kachelSeam = mitschnitt.filter((a) => a.ein.startsWith(KACHEL_PRAEFIX));
  expect(kachelSeam.length).toBeGreaterThan(0);
  for (const anfrage of kachelSeam) {
    // Die eigentliche Aussage: root-relativ rein, absolut gegen die Origin raus.
    expect(anfrage.aus, `Kachel-URL nicht absolutiert: ${anfrage.ein}`).toBe(
      erwarteteHerkunft + anfrage.ein,
    );
  }

  // (2) Die absolutierte URL wurde auch wirklich abgesetzt — mit genau dieser Origin.
  expect(kachelAnfragen.length, 'keine Kachel-Anfrage am Netz angekommen').toBeGreaterThan(0);
  for (const url of kachelAnfragen) {
    expect(url.startsWith(`${erwarteteHerkunft}${KACHEL_PRAEFIX}`), `Kachel-URL: ${url}`).toBe(
      true,
    );
    // Platzhalter müssen substituiert sein: eine percent-kodierte `%7Bz%7D` ist der Fehler,
    // gegen den `absolutiereProxyAnfrage` bewusst auf String-Konkatenation statt `new URL()`
    // setzt (basemapStil.ts) — MapLibre substituiert sie dann nie und holte 0 Kacheln.
    expect(url).not.toContain('%7B');
    expect(url).not.toContain('{');
  }

  // (3) Und der Worker hat die Antwort VERARBEITET. Das ist der Teil, den keine URL-Prüfung
  //     zeigt: bei totem Worker bleibt die Quelle ungeladen, während Canvas und Controls
  //     unverändert dastehen (im Smoke gemessen).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          if (!map) return 'kein Karten-Handle (window.__lfhKarte fehlt)';
          if (!map.getStyle()?.sources?.fixture) return 'Fixture-Quelle fehlt im Style';
          if (!map.isSourceLoaded('fixture')) return 'Fixture-Quelle ungeladen';
          return map.loaded() ? 'geladen' : 'map.loaded() ist false';
        }),
      {
        timeout: 20_000,
        message: 'Kachel-Quelle wird nie fertig — Verdacht: der maplibre-Worker antwortet nicht',
      },
    )
    .toBe('geladen');

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
