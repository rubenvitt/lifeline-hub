import { expect, test, type Page } from '@playwright/test';
import { beobachteShifts, bericht, ruheShifts, type Messung } from './cls-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Kriterium 12 der Prüfliste Einsatztauglichkeit („Kein Sprung unter dem Cursor") für
 * Lage-Dashboard und Führung · Überblick auf dem Handschirm (LFH-629, O1 der Prüfliste zu
 * LFH-606, `docs/superpowers/specs/2026-09-22-lfh-606-pruefliste.md`).
 *
 * Gemessen wird die SEITE, ab der Navigation: die Summe aller `layout-shift`-Einträge ohne
 * Eingabe-Folge (`cls-kern.ts`). Die Summe ist nie kleiner als die CLS nach web.dev, die
 * Zusicherung also strenger als die Metrik.
 *
 * DREI LADEFOLGEN je Seite, weil der Sprung an der Reihenfolge hängt, in der die Abfragen
 * eintreffen. Die erste Messung zu LFH-606 lag bei 0,157–0,168, als nur der Pegel zurückgehalten
 * wurde; ohne Eingriff fiel derselbe Stand unter 0,1. Eine einzelne Folge wäre grün durch Glück.
 *  - `Einsatz zuerst`: der Einsatz kommt sofort, jede andere GET-Abfrage des Einsatzes wartet,
 *    bis die Seite im Ladezustand ruht. Misst Platzhalter → Endzustand jedes Blocks.
 *  - `Einsatz zuletzt`: nur der Einsatz wartet. Misst Ortspfad, Rechtehinweis und alles, was am
 *    Einsatz hängt (Kennzahlreihe, Schreibrecht).
 *  - `natürlich`: ohne Eingriff, wie im Betrieb.
 *
 * DIE URSACHEN, die dieser Spec abriegelt (Messwerte vor dem Fix, 390 px):
 *  - Der Ortspfad „Einsätze › … ›" wird zum Einsatznamen; mit einem langen Namen brach der
 *    Seitentitel in eine zweite Zeile, und alles darunter rückte 22 px (Lage-Dashboard 0,168).
 *  - Paneele im Ladezustand waren anders hoch als im Leerzustand: Lage-Dashboard 162 → 112,
 *    Überblick 81 → 119. Auf dem Handschirm stehen sie untereinander, die Differenzen addieren
 *    sich, und das letzte Paneel wanderte 130–150 px — CLS rechnet die größte Strecke mal der
 *    ganzen bewegten Fläche.
 *  - Der Rechtehinweis des Überblicks erschien für Beobachter über dem schon stehenden Inhalt und
 *    rückte ihn 79 px (0,156).
 *
 * ROLLEN (LFH-435, `e2e/AGENTS.md`): der Überblick zeigt ohne Schreibrecht einen Rechtehinweis
 * und keine Leeraktionen. Gemessen wird deshalb auch als Beobachter; die Vorbedingung (Hinweis
 * steht bzw. fehlt) prüft der Test vor der Zahl.
 *
 * DICHTE (LFH-883): gemessen wird in allen drei Stufen der Staffel. Handschuh ist der
 * Tablet-Kontext und auf 390 px selten, aber dort lagen die Platzhalter am weitesten neben dem
 * Endzustand: das Kennzahlenband wuchs 427 → 454 px, der Paneelkopf „Einsatzabschnitte“ des
 * Überblicks brach erst mit dem Meta um (38 → 52 px), Seiten-CLS 0,074–0,083. Die Stufe kommt
 * als gespeicherte Wahl per `addInitScript` vor jedem Dokument-Script; der Test prüft sie am
 * `data-dichte` der Wurzel, bevor er zählt.
 *
 * HERMETISCH beim Pegel: der Einsatz trägt einen festgelegten Pegel (die Kennzahl erscheint nur
 * dann), die Messung kommt per `page.route` aus einem Literal — der echte Abruf ginge an
 * PEGELONLINE.
 */

/**
 * Der „gut"-Schwellwert für CLS am 75. Perzentil (https://web.dev/articles/cls), die Grenze der
 * Bedien-Leitlinie. Als Literal: ein aus dem Produktivcode gelesener Wert prüfte sich selbst.
 */
const CLS_GUT = 0.1;

/**
 * Die Grenze, die der Spec prüft — strenger als {@link CLS_GUT}. Der Anspruch ist „kein Sprung",
 * nicht „knapp unter web.dev" (Muster `einsatzauswahl-cls.spec.ts`): nimmt man einen der Fixes
 * einzeln zurück, landet die Seite bei 0,04–0,10, unter der Leitlinie und trotzdem ein Sprung.
 * Gemessen nach dem Fix: höchstens 0,017, Rest ist der Ortspfad, der vom „…" zum Namen breiter
 * wird. Die Zahl ist eine Setzung; wer sie anhebt, hebt eine Zusicherung an, keine Toleranz.
 */
const HAUS_GRENZE = 0.03;

/** Handschirm der Bedien-Leitlinie (Kontext mobil, ~390 px). */
const HANDSCHIRM = { width: 390, height: 844 };

/** Die Staffel der Bedien-Leitlinie; der Schlüssel ist die gespeicherte Wahl (`theme/dichte.ts`). */
const DICHTEN = ['kompakt', 'komfortabel', 'handschuh'] as const;
type Dichte = (typeof DICHTEN)[number];
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

async function stelleDichte(page: Page, dichte: Dichte) {
  await page.addInitScript(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
}

/**
 * Ein LANGER Einsatzname, wie ihn ein Lagefall trägt: er passt auf 390 px nicht in eine Zeile.
 * Mit ihm brach erst der Titel und dann, auf eigener Zeile, der Ortspfad selbst um.
 */
const NAME_PRAEFIX = 'E2E Lagebild CLS Hochwasser Weser';
const einsatzName = () => `${NAME_PRAEFIX} ${Date.now()}`;

const STATION = '47174d8f-1b8e-4599-8a59-b580dd55bc87';
const PEGEL = [
  {
    id: 1,
    station_uuid: STATION,
    name: 'HANN. MÜNDEN',
    gewaesser: 'WESER',
    reihenfolge: 0,
    messung: { wasserstand_cm: 684, zeitpunkt: new Date().toISOString(), trend_cm_pro_h: 9.2 },
  },
];

async function einsatzAnlegen(page: Page): Promise<string> {
  const r = await page.request.post('/api/einsaetze', { data: { bezeichnung: einsatzName() } });
  expect(r.ok(), `Seeding Einsatz: ${r.status()} ${await r.text()}`).toBeTruthy();
  const id = String(((await r.json()) as { id: number }).id);
  const p = await page.request.put(`/api/einsaetze/${id}/pegel`, {
    data: { stationen: [{ station_uuid: STATION, name: 'HANN. MÜNDEN', gewaesser: 'WESER' }] },
  });
  expect(p.ok(), `Pegel festlegen: ${p.status()} ${await p.text()}`).toBeTruthy();
  return id;
}

type Folge = 'Einsatz zuerst' | 'Einsatz zuletzt' | 'natürlich';
const FOLGEN: Folge[] = ['Einsatz zuerst', 'Einsatz zuletzt', 'natürlich'];

/**
 * Stellt die GET-Abfragen unter `/api/einsaetze/<id>` nach der Folge; der Live-Strom (`/live`)
 * läuft immer durch, er ist kein Datenabruf. Die gehaltenen warten auf `freigeben()`.
 */
async function stelleAbfragen(page: Page, einsatzId: string, folge: Folge) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  let loslassen!: () => void;
  const tor = new Promise<void>((f) => (loslassen = f));
  const kopf = `/api/einsaetze/${einsatzId}`;
  const haelt = (pfad: string) =>
    folge === 'Einsatz zuerst' ? pfad !== kopf : folge === 'Einsatz zuletzt' && pfad === kopf;
  let gehalten = 0;
  await page.route(new RegExp(`/api/einsaetze/${einsatzId}(?:[/?]|$)`), async (route) => {
    const anfrage = route.request();
    const pfad = new URL(anfrage.url()).pathname;
    if (anfrage.method() !== 'GET' || pfad.endsWith('/live')) return route.continue();
    if (haelt(pfad)) {
      gehalten += 1;
      await tor;
    }
    if (pfad === `${kopf}/pegel`) return route.fulfill({ json: PEGEL });
    return route.continue();
  });
  return {
    freigeben: () => {
      // Ohne gehaltene Abfrage mäße die Folge still die natürliche.
      expect(gehalten, `${folge}: gehaltene Abfragen`).toBeGreaterThan(0);
      loslassen();
    },
  };
}

const inhalt = (page: Page) => page.locator('[data-lfh="seiten-inhalt"]');
const band = (page: Page) => page.getByRole('group', { name: 'Lage in Zahlen' });

/** Anker des Endzustands: Ortspfad mit Namen, Kennzahlen als Links, kein Ladezeichen mehr. */
async function endzustand(page: Page) {
  await expect(page.locator('[data-lfh="seitenkopf"]')).toContainText(NAME_PRAEFIX);
  await expect(band(page).locator('a[data-lfh="kennzahl"]').first()).toBeVisible();
  await expect(inhalt(page).locator('[aria-busy="true"]')).toHaveCount(0);
}

async function messe(page: Page, pfad: string, einsatzId: string, folge: Folge, dichte: Dichte) {
  const abfragen = await stelleAbfragen(page, einsatzId, folge);
  await page.goto(pfad);
  // Vorbedingung der Zahl: gemessen wird die Stufe, die der Test nennt.
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
  if (folge !== 'natürlich') {
    // Anker des Ladezustands: der Seitenkopf steht. Den Inhalt prüft der Anker nicht — der
    // Überblick zeigt vor dem Einsatz bewusst keinen (`UeberblickPage.tsx`). Dass die Folge
    // wirklich wartete, belegt `freigeben()`.
    await expect(page.locator('[data-lfh="seitenkopf"]')).toBeVisible();
    await ruheShifts(page);
    abfragen.freigeben();
  }
  await endzustand(page);
  return ruheShifts(page);
}

for (const route of ['ueberblick', 'lage-dashboard'] as const) {
  for (const rolle of ['admin', 'beobachter'] as const) {
    for (const dichte of DICHTEN) {
      test(`${route} als ${rolle}, ${dichte}: CLS ≤ ${CLS_GUT} auf ${HANDSCHIRM.width} px`, async ({
        page,
      }) => {
        test.setTimeout(150_000);
        await anmeldenAlsAdmin(page);
        const einsatzId = await einsatzAnlegen(page);
        if (rolle === 'beobachter') {
          await wechsleZuRolle(page, 'beobachter', einsatzId);
        }
        await stelleDichte(page, dichte);
        await beobachteShifts(page);
        await page.setViewportSize(HANDSCHIRM);
        const pfad = `/einsaetze/${einsatzId}/${route}`;

        const werte: string[] = [];
        for (const folge of FOLGEN) {
          const m: Messung = await messe(page, pfad, einsatzId, folge, dichte);
          // Der Rollenzweig ist Vorbedingung der Zahl (LFH-435): ohne ihn mäße der
          // Beobachter-Fall den Admin-Zustand.
          if (route === 'ueberblick') {
            await expect(inhalt(page).getByRole('alert')).toHaveCount(0);
            await expect(page.getByText(/Nur Einsatzleitung und Führungspersonal/)).toHaveCount(
              rolle === 'beobachter' ? 1 : 0,
            );
          }
          werte.push(`${folge}: ${bericht(m)}`);
          expect
            .soft(
              m.summe,
              `${route} als ${rolle}, ${dichte}, ${folge} (Leitlinie ${CLS_GUT}): ${bericht(m)}`,
            )
            .toBeLessThanOrEqual(HAUS_GRENZE);
        }
        test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
      });
    }
  }
}

/**
 * Der Kopf des Meldungsstroms ist in jedem Verbindungszustand gleich hoch. Das Wort wechselt mit
 * der Leitung („Verbindung wird aufgebaut" → „live", später „Verbindung unterbrochen"); auf 390 px
 * passte nur „live" neben den Titel, und der Kopf schrumpfte beim Verbinden von 53 auf 38 px.
 * In der Seiten-CLS war das 0,016 — zu wenig für die Grenze, deshalb die Geometrie selbst.
 */
test('Meldungsstrom: der Paneelkopf hält seine Höhe über die Verbindungszustände (390 px)', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await page.setViewportSize(HANDSCHIRM);
  const kopf = page
    .locator('section[data-lfh="paneel"]')
    .filter({ has: page.locator('[data-lfh="strom-live"]') })
    .locator(':scope > div')
    .first();
  const wort = page.locator('[data-lfh="strom-live"]');

  const hoehen: string[] = [];
  const messeKopf = async (soll: RegExp) => {
    await expect(wort).toHaveText(soll);
    const k = await kopf.boundingBox();
    expect(k, 'Paneelkopf ohne Kasten').not.toBeNull();
    hoehen.push(`${(await wort.textContent()) ?? ''}: ${k!.height}`);
    return k!.height;
  };

  await stelleAbfragen(page, einsatzId, 'natürlich');
  await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
  const offen = await messeKopf(/^live$/);
  // Ohne Leitung: der Strom wird abgewiesen, das Wort bleibt beim Aufbau bzw. „unterbrochen".
  await page.route(`**/api/einsaetze/${einsatzId}/live`, (r) => r.abort());
  await page.reload();
  const ohne = await messeKopf(/^Verbindung (wird aufgebaut|unterbrochen)$/);
  test.info().annotations.push({ type: 'messwert', description: hoehen.join(' | ') });
  expect(ohne, hoehen.join(' | ')).toBe(offen);
});

/**
 * Die Zellhöhe des Kennzahlenbandes steht vom ersten Bild an (LFH-883), in jeder Dichte. Die
 * Seiten-CLS sieht das nicht mehr allein: seit Kopfleiste und Ortspfad nicht mehr in dasselbe
 * Bild fallen, blieben die 13 bzw. 16 px, um die eine Reihe in „Handschuh“ wuchs, unter der
 * Hausgrenze. Deshalb die Geometrie selbst, in beiden Ladefolgen, die einen Platzhalter zeigen:
 * `Einsatz zuletzt` (sechs leere Plätze ohne Etikett) und `Einsatz zuerst` (Etiketten, Werte im
 * Ladezustand). Gemessen vor dem Fix in „Handschuh“: 427 → 454 px.
 */
for (const dichte of DICHTEN) {
  test(`Lage-Dashboard, ${dichte}: das Kennzahlenband hält seine Höhe vom Platzhalter bis zu den Daten (390 px)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await stelleDichte(page, dichte);
    await page.setViewportSize(HANDSCHIRM);

    const hoehen: string[] = [];
    for (const folge of ['Einsatz zuletzt', 'Einsatz zuerst'] as const) {
      const abfragen = await stelleAbfragen(page, einsatzId, folge);
      await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
      await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
      // Vorbedingung: das Band steht im Ladezustand, mit geladener Schrift.
      await expect(band(page).locator('[aria-busy="true"]').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const vorher = (await band(page).boundingBox())?.height ?? Number.NaN;
      abfragen.freigeben();
      await endzustand(page);
      const nachher = (await band(page).boundingBox())?.height ?? Number.NaN;
      const messwert = `${folge}: ${vorher.toFixed(1)} → ${nachher.toFixed(1)}`;
      hoehen.push(messwert);
      expect.soft(Math.abs(nachher - vorher), `${dichte}, ${messwert}`).toBeLessThanOrEqual(1);
    }
    test.info().annotations.push({ type: 'messwert', description: hoehen.join(' | ') });
  });
}

/**
 * Der Paneelkopf „Einsatzabschnitte“ im Überblick bricht auf 390 px um, sobald sein Meta „0
 * Abschnitte · 0 Einheiten“ neben dem Titel steht (38 → 52 px). Das Meta kam erst mit den Daten;
 * der Kopf hält seinen Umbruch jetzt schon im Ladezustand (LFH-883). Das Paneel steht unter dem
 * ersten Bildschirm, die Seiten-CLS sieht seinen Sprung nicht — deshalb die Geometrie.
 */
for (const dichte of DICHTEN) {
  test(`Überblick, ${dichte}: der Paneelkopf „Einsatzabschnitte“ hält seine Höhe über das Laden (390 px)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await stelleDichte(page, dichte);
    await page.setViewportSize(HANDSCHIRM);

    const abfragen = await stelleAbfragen(page, einsatzId, 'Einsatz zuerst');
    await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    const paneel = page
      .locator('section[data-lfh="paneel"]')
      .filter({ has: page.getByRole('heading', { name: 'Einsatzabschnitte' }) });
    const kopf = paneel.locator(':scope > div').first();
    // Vorbedingung: das Paneel lädt noch.
    await expect(paneel.locator('[aria-busy="true"]').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const vorher = (await kopf.boundingBox())?.height ?? Number.NaN;
    abfragen.freigeben();
    await expect(paneel.getByText('0 Abschnitte · 0 Einheiten')).toBeVisible();
    const nachher = (await kopf.boundingBox())?.height ?? Number.NaN;
    const messwert = `${vorher.toFixed(1)} → ${nachher.toFixed(1)}`;
    test.info().annotations.push({ type: 'messwert', description: messwert });
    expect(Math.abs(nachher - vorher), messwert).toBeLessThanOrEqual(1);
  });
}

/**
 * Der Einsatzname in der Kopfleiste erscheint, ohne dass sich seine Zelle bewegt (LFH-883): beim
 * Laden hält die Spinnerzelle die Höhe des Umschalters und ein leerer Platz die Breite des
 * Statuspunkts. Vorher rückte die Zelle mit dem Einsatz 12 px nach oben und 11 px nach rechts,
 * im selben Bild wie der Ortspfad der Seite; zusammen lag das bei 0,02 Seiten-CLS in jeder
 * Dichte — unter der Hausgrenze, deshalb die Geometrie.
 */
for (const dichte of DICHTEN) {
  test(`Kopfleiste, ${dichte}: die Zelle des Einsatznamens steht beim Laden schon an ihrem Platz (390 px)`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await stelleDichte(page, dichte);
    await page.setViewportSize(HANDSCHIRM);

    const abfragen = await stelleAbfragen(page, einsatzId, 'Einsatz zuletzt');
    await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    const zelle = page.locator('[data-lfh="kopf-einsatzname"]');
    // Vorbedingung: der Einsatz lädt noch, der Name steht nicht.
    await expect(zelle).toBeVisible();
    await expect(zelle.getByRole('button')).toHaveCount(0);
    const vorher = await zelle.boundingBox();
    abfragen.freigeben();
    await expect(zelle.getByRole('button', { name: new RegExp(NAME_PRAEFIX) })).toBeVisible();
    const nachher = await zelle.boundingBox();
    const messwert = `x${vorher?.x}/y${vorher?.y}/h${vorher?.height} → x${nachher?.x}/y${nachher?.y}/h${nachher?.height}`;
    test.info().annotations.push({ type: 'messwert', description: messwert });
    expect(nachher?.x, messwert).toBe(vorher?.x);
    expect(nachher?.y, messwert).toBe(vorher?.y);
    expect(nachher?.height, messwert).toBe(vorher?.height);
  });
}
