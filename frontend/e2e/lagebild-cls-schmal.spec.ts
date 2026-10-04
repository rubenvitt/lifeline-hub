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
  // Die Modulfreigaben gehören wie der Kopf zum Rahmen: bis sie antworten, wartet der Modulwächter
  // (LFH-888) und die Seite rendert noch nicht. Gehalten werden die Abfragen der Seite.
  const rahmen = (pfad: string) => pfad === kopf || pfad === `${kopf}/modul-freigaben`;
  const haelt = (pfad: string) =>
    folge === 'Einsatz zuerst' ? !rahmen(pfad) : folge === 'Einsatz zuletzt' && pfad === kopf;
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

async function messe(page: Page, pfad: string, einsatzId: string, folge: Folge) {
  const abfragen = await stelleAbfragen(page, einsatzId, folge);
  await page.goto(pfad);
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
    test(`${route} als ${rolle}: CLS ≤ ${CLS_GUT} auf ${HANDSCHIRM.width} px`, async ({ page }) => {
      test.setTimeout(150_000);
      await anmeldenAlsAdmin(page);
      const einsatzId = await einsatzAnlegen(page);
      if (rolle === 'beobachter') {
        await wechsleZuRolle(page, 'beobachter', einsatzId);
      }
      await beobachteShifts(page);
      await page.setViewportSize(HANDSCHIRM);
      const pfad = `/einsaetze/${einsatzId}/${route}`;

      const werte: string[] = [];
      for (const folge of FOLGEN) {
        const m: Messung = await messe(page, pfad, einsatzId, folge);
        // Der Rollenzweig ist Vorbedingung der Zahl (LFH-435): ohne ihn mäße der Beobachter-Fall
        // den Admin-Zustand.
        if (route === 'ueberblick') {
          await expect(inhalt(page).getByRole('alert')).toHaveCount(0);
          await expect(page.getByText(/Nur Einsatzleitung und Führungspersonal/)).toHaveCount(
            rolle === 'beobachter' ? 1 : 0,
          );
        }
        werte.push(`${folge}: ${bericht(m)}`);
        expect
          .soft(m.summe, `${route} als ${rolle}, ${folge} (Leitlinie ${CLS_GUT}): ${bericht(m)}`)
          .toBeLessThanOrEqual(HAUS_GRENZE);
      }
      test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
    });
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
