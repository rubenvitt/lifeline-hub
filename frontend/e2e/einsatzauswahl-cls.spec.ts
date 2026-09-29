import { expect, test, type Page, type Route } from '@playwright/test';
import type { EinsatzAnzeige } from '../src/api/types';
import { beobachteShifts, bericht, leseShifts, ruheShifts, setzeShiftsZurueck } from './cls-kern';

/**
 * Kriterium 12 der Prüfliste Einsatztauglichkeit („Kein Sprung unter dem Cursor") an der
 * Einsatzauswahl. Ein Layout-Shift ist eine Geometrie-Aussage und nur im Browser messbar.
 *
 * EIN CLS-WERT ALLEIN IST HIER BLIND: `layout-shift` meldet nur Elemente, die in zwei Frames
 * existieren und sich bewegen. Im Ladezustand ist das Raster das letzte Element (die
 * „Abgeschlossen"-Sektion fehlt noch), eine Höhenänderung verschiebt also nichts, was schon
 * dastand — eine halbierte Skeletthöhe blieb bei der Shift-Summe unsichtbar. Test 1 prüft
 * deshalb zusätzlich den gemessenen Kachelboden in beiden Zuständen.
 *
 * Gemessen werden:
 *  1. Ladewechsel Skelett → Karten bei gleichbleibender Reihenzahl, plus Kachelboden.
 *  2. Ladewechsel ab `SUCHE_AB`: das Suchfeld erscheint ÜBER dem Raster, und das Raster
 *     wächst auf mehrere Reihen — ein echter Shift, der im Budget bleiben muss.
 *  3. Fensterfokus-Refetch mit unveränderten Daten: `refetchOnWindowFocus` ist an der Liste
 *     an, und die `begonnen_at`-Sortierung könnte klickbare Karten umsortieren.
 *
 * SUMME IST NICHT GLEICH CLS: web.dev nimmt das größte Sitzungsfenster, hier wird die Summe
 * aller Shifts ohne `hadRecentInput` gemessen. Die Summe ist nie kleiner — die Zusicherung
 * ist strenger als die Metrik.
 *
 * `page.route` STATT SEEDING: der Shift hängt an der Zahl der Kacheln, und die Suite legt in
 * derselben Datenbank parallel Einsätze an. Interzipiert wird nur `GET /api/einsaetze`; die
 * Vorlage der Antwort kommt aus einem echten `POST` (Feldform aus dem Backend).
 *
 * Bleibt die Seite lange offen, lädt der Vite-Dev-Server sie irgendwann neu; eine Messung
 * über einen Dokumentwechsel mäße die Ladephase des neuen Dokuments. Test 3 riegelt das über
 * die Lauf-Kennung aus `cls-kern.ts` ab.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * Der „gut"-Schwellwert für CLS am 75. Perzentil (https://web.dev/articles/cls). Als
 * Literal: ein aus dem Produktivcode gelesener Wert prüfte sich selbst.
 */
const CLS_GUT = 0.1;

/**
 * Deckel für den Ladewechsel mit Aufbau-Änderung (Test 2): die Hälfte des web.dev-Budgets —
 * ein Zustandswechsel darf nicht mehr verbrauchen, als der ganzen Seite zusteht. Suchfeld und
 * Reihenzuwachs schieben denselben Rasterknoten, eine Aufteilung wäre geschätzt; deshalb eine
 * Zahl für beide Ursachen.
 */
const LADEWECHSEL_DECKEL = CLS_GUT / 2;

/**
 * Obergrenze für Wechsel, die den Seitenaufbau NICHT ändern (Test 1 und 3). Der Anspruch ist
 * „kein Sprung", nicht „knapp unter web.dev" — 0,09 wäre dort grün und trotzdem eine
 * Regression. Die Zahl ist eine Setzung (gemessen ~0,002 durch die `Datenstand`-Zeile im
 * Kopf); wer sie anhebt, hebt eine Zusicherung an, keine Toleranz.
 */
const HAUS_GRENZE = 0.01;

/** `KACHEL_MIN_HOEHE` aus `EinsaetzePage.tsx` als Literal — importiert prüfte er sich selbst. */
const KACHEL_BODEN = 120;

/** Subpixel-Spielraum: `boundingBox()` liefert Fließkomma, Chromium rundet unter Last anders. */
const SUBPIXEL = 0.5;

/** Fükw-Maß aus der Bedien-Leitlinie (A1, Gate 1). */
const FUEKW = { width: 1366, height: 768 };

/**
 * `SUCHE_AB` aus `EinsaetzePage.tsx` als Literal — fällt die Schwelle, erscheint das Suchfeld
 * in Test 1 unerwartet und dessen `toHaveCount(0)`-Wache sagt es laut.
 */
const SUCHE_AB = 8;

/**
 * `staleTime` aus `api/queryClient.ts` als Literal. Ein Fokus auf einer FRISCHEN Query löst
 * keinen Refetch aus — Test 3 muss sie erst altern lassen.
 */
const STALE_TIME = 10_000;

/**
 * Ein Tor, das die interzipierte Listen-Antwort zurückhält, bis der Test sie freigibt. Eine
 * feste Verzögerung ist ein Wettrennen mit der Maschine: unter Last fielen die Skelette vor
 * der Messung aus dem DOM. Mit dem Tor dauert die Skelettphase genau so lange wie die Messung.
 */
function ladeTor(): { tor: Promise<void>; oeffne: () => void } {
  let oeffne!: () => void;
  const tor = new Promise<void>((fertig) => {
    oeffne = fertig;
  });
  return { tor, oeffne };
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/**
 * Legt EINEN echten Einsatz an und gibt die Backend-Antwort als Vorlage zurück — von Hand
 * getippte Pflichtfelder veralteten beim nächsten Backend-Feld still.
 */
async function vorlageHolen(page: Page, bezeichnung: string): Promise<EinsatzAnzeige> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(
    antwort.ok(),
    `Vorlage-Einsatz „${bezeichnung}": ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
  return (await antwort.json()) as EinsatzAnzeige;
}

/**
 * Baut aus der Vorlage eine feste Liste: `aktiv` aktive und `abgeschlossen` abgeschlossene
 * Einsätze. Der abgeschlossene stellt die „Abgeschlossen"-Sektion UNTER das Raster, damit ein
 * Shift dort eine benannte Quelle hat. Die ids liegen hoch, damit sie bei ausgefallener
 * Interception nicht mit echten Datensätzen kollidieren.
 */
function baueListe(
  vorlage: EinsatzAnzeige,
  stempel: number,
  aktiv: number,
  abgeschlossen: number,
): EinsatzAnzeige[] {
  const liste: EinsatzAnzeige[] = [];
  for (let n = 1; n <= aktiv; n += 1) {
    liste.push({
      ...vorlage,
      id: 900_000 + n,
      bezeichnung: `E2E CLS ${stempel} Nr ${n}`,
      status: 'aktiv',
    });
  }
  for (let n = 1; n <= abgeschlossen; n += 1) {
    liste.push({
      ...vorlage,
      id: 950_000 + n,
      bezeichnung: `E2E CLS ${stempel} Abgeschlossen ${n}`,
      status: 'abgeschlossen',
    });
  }
  return liste;
}

/**
 * Interzipiert `GET /api/einsaetze` mit einer festen Antwort und zählt die Abrufe — ohne
 * Zähler wäre „ein Refetch erzeugt keinen Shift" auch grün, wenn kein Refetch stattfand.
 * `POST` trifft dieselbe URL und wird durchgereicht.
 */
async function stelleListe(
  page: Page,
  liste: EinsatzAnzeige[],
  tor?: Promise<void>,
): Promise<{ abrufe: number; zeiten: number[] }> {
  const start = Date.now();
  const zaehler: { abrufe: number; zeiten: number[] } = { abrufe: 0, zeiten: [] };
  await page.route(/\/api\/einsaetze(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    // Das Tor hält die Antwort zurück, solange der Test misst.
    if (tor) await tor;
    await route.fulfill({ json: liste });
    // Gezählt wird NACH dem Ausliefern: am Eintritt gezählt, könnte Test 3 messen, bevor
    // react-query die Antwort verarbeitet hat.
    zaehler.abrufe += 1;
    zaehler.zeiten.push(Date.now() - start);
  });
  return zaehler;
}

/** Anker: der Ladezustand steht (das Raster meldet `aria-busy`). */
async function skelettSteht(page: Page) {
  await expect(page.getByTestId('einsaetze-raster')).toHaveAttribute('aria-busy', 'true');
}

/** Anker: die Daten sind da — `aria-busy` ist weg und die erste Karte trägt ihren Titel. */
async function kartenStehen(page: Page, ersterName: string) {
  const raster = page.getByTestId('einsaetze-raster');
  await expect(raster).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.getByRole('link', { name: ersterName, exact: true })).toHaveCount(1);
}

/**
 * Misst jede Kachel einer Menge gegen den Kachelboden (Untergrenze). `sollZahl` wird auf
 * GLEICHHEIT geprüft: die Fixture stellt die Liste selbst, weniger oder mehr Treffer messen
 * einen Zwischenzustand oder etwas anderes als gedacht.
 */
async function kachelnHaltenBoden(
  page: Page,
  auswahl: string,
  name: string,
  sollZahl: number,
): Promise<number> {
  const kacheln = page.getByTestId('einsaetze-raster').locator(auswahl);
  await expect(kacheln, `${name}: genau ${sollZahl} Kacheln erwartet`).toHaveCount(sollZahl);
  let kleinstes = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sollZahl; i += 1) {
    const kasten = await kacheln.nth(i).boundingBox();
    expect(kasten, `${name} #${i + 1}: kein Kasten messbar`).not.toBeNull();
    expect(
      kasten!.height,
      `${name} #${i + 1} (gemessen ${kasten!.height}px hoch, Soll ≥ ${KACHEL_BODEN})`,
    ).toBeGreaterThanOrEqual(KACHEL_BODEN - SUBPIXEL);
    kleinstes = Math.min(kleinstes, kasten!.height);
  }
  return kleinstes;
}

test('Einsatzauswahl: der Ladewechsel Skelett → Karten hält den Kachelboden und verschiebt nichts', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await beobachteShifts(page);
  await anmelden(page);

  const stempel = Date.now();
  const vorlage = await vorlageHolen(page, `E2E CLS ${stempel} Vorlage A`);

  // ZWEI aktive Einsätze: mit der Anlegen-Kachel füllen sie dieselbe EINE Reihe wie die drei
  // Skelette — der Fall, den `KACHEL_MIN_HOEHE` zusichert.
  const liste = baueListe(vorlage, stempel, 2, 1);
  const { tor, oeffne } = ladeTor();
  await stelleListe(page, liste, tor);

  // Eigene Navigation nach dem Login, sonst teilte sich die Messung das Dokument mit der Maske.
  await page.goto('/einsaetze');

  await skelettSteht(page);
  // Die drei Skelettkacheln stehen unbedingt und STILL, solange das Tor zu ist.
  const skelettHoehe = await kachelnHaltenBoden(page, '.lfh-einsatzkachel', 'Skelett-Kachel', 3);

  // Das Suchfeld darf hier NICHT erscheinen, sonst mäße dieser Test den Einschub aus Test 2 mit.
  expect(liste.filter((e) => e.status === 'aktiv').length).toBeLessThan(SUCHE_AB);
  oeffne();
  await kartenStehen(page, liste[0].bezeichnung);
  await expect(page.getByLabel('Einsätze durchsuchen')).toHaveCount(0);
  const kartenHoehe = await kachelnHaltenBoden(page, '.lfh-einsatzkachel', 'Einsatzkarte', 2);
  // Der Knoten unter dem Raster muss wirklich stehen, sonst hat ein Shift dort keine Quelle.
  await expect(page.getByRole('link', { name: liste[2].bezeichnung, exact: true })).toHaveCount(1);

  const messung = await ruheShifts(page);
  test.info().annotations.push({
    type: 'messwert',
    description: `Skelett-Kachel ${skelettHoehe}px, Einsatzkarte ${kartenHoehe}px (Boden ${KACHEL_BODEN}) | ${bericht(messung)}`,
  });

  expect(messung.summe, `Ladewechsel gegen web.dev: ${bericht(messung)}`).toBeLessThanOrEqual(
    CLS_GUT,
  );
  expect(
    messung.summe,
    `Ladewechsel gegen die Hausgrenze: ${bericht(messung)}`,
  ).toBeLessThanOrEqual(HAUS_GRENZE);
});

test('Einsatzauswahl: der Ladewechsel mit Suchfeld und drei Rasterreihen bleibt im CLS-Budget', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await beobachteShifts(page);
  await anmelden(page);

  const stempel = Date.now();
  const vorlage = await vorlageHolen(page, `E2E CLS ${stempel} Vorlage B`);

  // Genau `SUCHE_AB` aktive Einsätze: das Suchfeld erscheint über dem Raster, und das Raster
  // wächst um Reihen. Ein ECHTER Shift — der Test belegt, dass er im Budget bleibt.
  const liste = baueListe(vorlage, stempel, SUCHE_AB, 1);
  const { tor, oeffne } = ladeTor();
  await stelleListe(page, liste, tor);

  await page.goto('/einsaetze');
  // Auch hier das Tor: sonst träfe die Antwort unter Last vor dem `aria-busy`-Anker ein.
  await skelettSteht(page);
  oeffne();
  await kartenStehen(page, liste[0].bezeichnung);
  await expect(page.getByLabel('Einsätze durchsuchen')).toHaveCount(1);

  const messung = await ruheShifts(page);
  test.info().annotations.push({ type: 'messwert', description: bericht(messung) });

  expect(messung.summe, `Ladewechsel gegen web.dev: ${bericht(messung)}`).toBeLessThanOrEqual(
    CLS_GUT,
  );
  expect(
    messung.summe,
    `Ladewechsel gegen den Zustandswechsel-Deckel: ${bericht(messung)}`,
  ).toBeLessThanOrEqual(LADEWECHSEL_DECKEL);
});

test('Einsatzauswahl: ein Fensterfokus-Refetch mit unveränderten Daten verschiebt nichts', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await beobachteShifts(page);
  await anmelden(page);

  const stempel = Date.now();
  const vorlage = await vorlageHolen(page, `E2E CLS ${stempel} Vorlage C`);
  const liste = baueListe(vorlage, stempel, SUCHE_AB, 1);
  // Ohne Tor: der Ladeanteil wird unten per Zurücksetzen aus der Messung genommen.
  const zaehler = await stelleListe(page, liste);

  await page.goto('/einsaetze');
  await kartenStehen(page, liste[0].bezeichnung);
  const ladephase = await ruheShifts(page);

  // Die Query muss erst altern, sonst ignoriert react-query das Fokus-Ereignis.
  await page.waitForTimeout(STALE_TIME + 500);

  // Erst jetzt zurücksetzen: was ab hier gemeldet wird, gehört zum Refetch.
  await setzeShiftsZurueck(page);

  // Der `Datenstand`-Titel trägt Sekunden und ist nach dem Warten garantiert ein anderer,
  // sobald die Antwort gerendert ist — der Anker, der dem Zähler fehlt. Nur das
  // `title`-Attribut ändert sich, der Anker verschiebt also selbst nichts.
  const datenstand = page.locator('[aria-label^="Datenstand "]');
  await expect(datenstand).toHaveCount(1);
  const standVorher = await datenstand.getAttribute('title');
  expect(standVorher, 'der Datenstand muss vor dem Refetch einen Titel tragen').not.toBeNull();

  // RELATIV gezählt und der Stand erst HIER genommen: ein Abruf im Wartefenster hätte den
  // Zähler sonst schon auf den Zielwert gehoben.
  const abrufeVorher = zaehler.abrufe;
  expect(abrufeVorher, 'vor dem Refetch mindestens der Erstabruf').toBeGreaterThanOrEqual(1);
  const laufVorher = (await leseShifts(page)).lauf;

  // Das Warten wird VOR dem Auslöser aufgesetzt, sonst ginge die Antwort verloren. Bleibt
  // der Refetch aus, stirbt der Test hier.
  const antwort = page.waitForResponse(
    (r) => /\/api\/einsaetze(\?|$)/.test(r.url()) && r.request().method() === 'GET',
  );

  // react-querys `focusManager` hängt an `visibilitychange`; es von Hand zu feuern ist die
  // deterministische Fassung des Fensterwechsels (`bringToFront` ist headless unzuverlässig).
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await antwort;

  await expect
    .poll(() => zaehler.abrufe, {
      message: 'der Fensterfokus muss einen zusätzlichen Abruf auslösen',
    })
    .toBeGreaterThanOrEqual(abrufeVorher + 1);
  // Erst mit dem neuen Titel ist die Antwort im DOM — sonst endete die Ruhemessung womöglich
  // vor dem Re-Render, bei Sollwert 0 ein stiller Falsch-Grün.
  await expect(datenstand).not.toHaveAttribute('title', standVorher!);

  const nachRefetch = await ruheShifts(page);
  // Ein Refetch tauscht Daten, kein Dokument. Lud die Seite neu, mäße der frische
  // Akkumulator die Ladephase — ein Messfehler, der sich als solcher melden muss.
  expect(
    nachRefetch.lauf,
    'zwischen Reset und Messung darf das Dokument nicht neu geladen haben',
  ).toBe(laufVorher);
  test.info().annotations.push({
    type: 'messwert',
    description:
      `Ladephase ${bericht(ladephase)} | nach Refetch ${bericht(nachRefetch)} | ` +
      `Abrufe bei ${zaehler.zeiten.join(', ')} ms (davon ${abrufeVorher} vor dem Fokus)`,
  });

  // Bei unveränderten Daten darf die `begonnen_at`-Sortierung nichts umsortieren —
  // react-query teilt die Struktur und rendert identisch.
  expect(
    nachRefetch.summe,
    `Refetch ohne Datenänderung: ${bericht(nachRefetch)}`,
  ).toBeLessThanOrEqual(HAUS_GRENZE);
});
