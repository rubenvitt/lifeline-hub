import { expect, test, type Page } from '@playwright/test';
import {
  kachelnBeantworten,
  kartenConfigBeantworten,
  vektorKachel,
  vektorStilBeantworten,
} from './kartenFixture';

// Der echte Kachel-Pfad der Lagekarte — die Hälfte, die `lagekarte-smoke.spec.ts` (ohne
// Basemap, `blindStyle`) nicht abdeckt: „Style-JSON → substituierte Kachel-URL →
// `transformRequest` → fetch IM WORKER → Parsen". Genau diese Kette brach schon einmal
// (root-relative Proxy-URLs ohne Dokument-Base im Tile-Worker, LFH-182).
//
// DIE QUELLE STELLT DER TEST SELBST: `page.route` beantwortet `/api/karte/config` mit einem
// Online-VEKTOR-View, dessen Style-JSON und die Kacheln (33 Bytes Protobuf, `KACHEL_HEX`,
// gebaut in `kartenFixture.ts`).
// `page.route` greift auch für die Anfragen des maplibre-Workers. VEKTOR, weil maplibre
// Raster-Kacheln auf dem Hauptthread lädt — nur eine Vector-Source geht durch den Worker.
//
// DIE TRAGENDE ZUSICHERUNG IST DER MITSCHNITT `window.__lfhKartenAnfragen` (Eingabe UND
// Ausgabe von `absolutiereProxyAnfrage`): maplibre 6 löst eine root-relative URL im Worker
// gegen `self.location` auf, das liegt same-origin — ein Test auf „eine Kachel wurde geholt"
// bliebe also auch ohne `transformRequest` grün. Die Netz-Assertionen belegen daneben, dass die
// absolutierte URL abgesetzt wurde.
//
// „GELESEN" HEISST DEKODIERT (`querySourceFeatures`), nicht `loaded()`: eine gescheiterte
// Kachel gilt als `errored` und zählt wie geladen, der Fehler kommt als `error`-Event statt
// als `pageerror`.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Root-relative Kachel-Vorlage wie sie das Backend liefert (`/api/karte/proxy/…`). */
const KACHEL_VORLAGE = '/api/karte/proxy/9/tile/{z}/{x}/{y}.pbf';
const STIL_PFAD = '/api/karte/proxy/9/style.json';
/** Präfix der substituierten Kachel-URLs — ohne Platzhalter, so wie MapLibre sie anfragt. */
const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';
/** Name des Layers IM Kachel-Körper; muss zum `source-layer` des Fixture-Styles passen. */
const KACHEL_LAYER = 'strassen';

/**
 * Die Kachel-Bytes baut `vektorKachel` (`kartenFixture.ts`, Aufbau dort Byte für Byte). Gepinnt
 * sind sie hier als Hex: ändert sich der Bau, merkt es dieser Test, nicht erst ein fremder.
 */
const KACHEL_HEX =
  '1a1f7802' +
  '0a08' +
  '737472617373656e' + // 'strassen'
  '120e0801180222080900000ac801c801' +
  '288020';

/** Ausschnitt des DEV-Mitschnitts aus `Kartenflaeche.tsx`, nachgebildet statt importiert:
 *  der Spec-Ordner bindet nicht gegen die Anwendung. */
interface KartenAnfrage {
  ein: string;
  aus: string;
}

interface MapHaken {
  getStyle(): { sources?: Record<string, unknown> } | undefined;
  isSourceLoaded(id: string): boolean;
  loaded(): boolean;
  querySourceFeatures(id: string, optionen: { sourceLayer: string }): unknown[];
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Einsatz über die API. Kein Modulname im Namen: die Kommandopalette durchsucht Module und
 *  Einsätze gemeinsam. */
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
  // Vorbedingung: die Fixture MUSS root-relativ sein, sonst prüft der Test die Absolutierung
  // nicht mehr.
  expect(KACHEL_VORLAGE.startsWith('/'), 'Kachel-Vorlage muss root-relativ sein').toBe(true);
  expect(KACHEL_VORLAGE.startsWith('//'), 'protokoll-relativ ist ausgenommen (LFH-182)').toBe(
    false,
  );

  const seitenFehler: Error[] = [];
  page.on('pageerror', (fehler) => seitenFehler.push(fehler));

  // Die Fixture MUSS die gepinnten 33 Bytes liefern (s. `KACHEL_HEX`).
  expect(vektorKachel(KACHEL_LAYER).toString('hex')).toBe(KACHEL_HEX);
  expect(vektorKachel(KACHEL_LAYER).length).toBe(33);

  await kartenConfigBeantworten(page, {
    online_styles: [{ name: 'Kachel-Fixture', typ: 'vektor', url: STIL_PFAD }],
  });
  await vektorStilBeantworten(page, STIL_PFAD, {
    id: 'fixture',
    kachelVorlage: KACHEL_VORLAGE,
    layer: KACHEL_LAYER,
  });
  /** Die URLs, mit denen der Worker die Kacheln tatsächlich angefragt hat. */
  const kachelAnfragen = await kachelnBeantworten(page, KACHEL_PRAEFIX, KACHEL_LAYER);

  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);

  await expect(page.getByTestId('kartenflaeche')).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);

  // (1) Der Seam lief für eine KACHEL-URL und hat sie absolutiert — geprüft wird das Paar
  //     ein→aus, sonst wäre eine Durchreiche nicht unterscheidbar.
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

  // (2) Die absolutierte URL wurde wirklich abgesetzt. GEWARTET: der Mitschnitt entsteht auf
  //     dem Hauptthread, bevor der Worker-Fetch abgeht.
  await expect
    .poll(() => kachelAnfragen.length, {
      timeout: 20_000,
      message: 'keine Kachel-Anfrage am Netz angekommen',
    })
    .toBeGreaterThan(0);
  // Momentaufnahme: die Liste wächst weiter, während darüber iteriert wird.
  for (const url of [...kachelAnfragen]) {
    expect(url.startsWith(`${erwarteteHerkunft}${KACHEL_PRAEFIX}`), `Kachel-URL: ${url}`).toBe(
      true,
    );
    // Platzhalter müssen substituiert sein: ein percent-kodiertes `%7Bz%7D` substituierte
    // MapLibre nie (deshalb String-Konkatenation statt `new URL()` in `basemapStil.ts`).
    expect(url).not.toContain('%7B');
    expect(url).not.toContain('{');
  }

  // (3) Der Worker hat die Antwort GELESEN: tragend ist das DEKODIERTE MERKMAL, nicht
  //     `loaded()` (s. `kartenFixture.ts`).
  await expect
    .poll(
      () =>
        page.evaluate((kachelLayer) => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          if (!map) return 'kein Karten-Handle (window.__lfhKarte fehlt)';
          if (!map.getStyle()?.sources?.fixture) return 'Fixture-Quelle fehlt im Style';
          if (!map.isSourceLoaded('fixture')) return 'Fixture-Quelle ungeladen';
          if (!map.loaded()) return 'map.loaded() ist false';
          const merkmale = map.querySourceFeatures('fixture', { sourceLayer: kachelLayer }).length;
          if (merkmale === 0)
            return 'Quelle geladen, aber KEIN dekodiertes Merkmal — Kachel nicht geparst';
          return 'dekodiert';
        }, KACHEL_LAYER),
      {
        timeout: 20_000,
        message:
          'Kachel wird nie gelesen — Verdacht: der maplibre-Worker antwortet nicht, ' +
          'oder die Kachel-Bytes sind nicht dekodierbar',
      },
    )
    .toBe('dekodiert');

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
