import { expect, test, type Page } from '@playwright/test';
import { beobachteShifts, bericht, ruheShifts, type Messung } from './cls-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Seiten-CLS des Führungsüberblicks, während „Offene Vorgänge“ seine Listen nachlädt (LLH-1145,
 * Paneel `pages/fuehrung/OffeneVorgaengePaneel.tsx`). `lagebild-cls-schmal.spec.ts` misst den
 * Überblick mit einem leeren Einsatz: dort steht in jedem Abschnitt „keine“, so hoch wie die
 * Ladezeile. Mit Vorgängen wächst ein Abschnitt beim Eintreffen seiner Liste von einer Zeile auf
 * bis zu drei, und alles darunter rückt — das misst dieser Spec.
 *
 * DIE URSACHE (LLH-1430, Messwerte vor dem Fix): jeder Abschnitt zeigte beim Laden eine Zeile
 * „wird abgerufen“ und wuchs mit der Liste auf zwei oder drei Einträge. Breit stehen die Abschnitte
 * untereinander in der rechten Spalte, und die Paneelreihe darunter wanderte um die Summe:
 * Seiten-CLS 0,050–0,068 bei 1440 px, in beiden Ladefolgen und Rollen. Seither hält der Ladezustand
 * so viele Zeilen in fester Höhe, wie der Modulzähler Einträge erwarten lässt (`ladeZeilen` an
 * `ListenAbschnitt`), und der Körper des Überblicks wartet auf den Zähler; nach dem Fix 0,0000 bis
 * 0,0004. Auf 390 px steht das Paneel unter dem ersten Bildschirm, die Seiten-CLS sah dort nur
 * 0,009–0,010.
 *
 * GESÄT wird so, dass vier Abschnitte Einträge zeigen (Meldungen, Aufträge, Nachforderungen je drei
 * bzw. zwei, Erinnerungen zwei, nur „bald“) und Ablösungen „keine“. Ohne Alarm: keine Frist
 * überschritten — ein Alarm brächte Ton und Toast, die nichts zur Messung beitragen. Bewusst OHNE
 * Einheiten: eine Ablösung braucht eine, und das Paneel „Einsatzabschnitte“ darüber wächst dann
 * selbst beim Laden (Platzhalter → Block „Ohne Abschnitt“, auf 390 px rund 140 px, Seiten-CLS
 * ≈ 0,03 allein). Das ist ein eigener Sprung außerhalb dieses Paneels.
 *
 * ZWEI LADEFOLGEN, Muster `lagebild-cls-schmal.spec.ts`: der Sprung hängt daran, was zuerst kommt.
 *  - `Listen zuletzt`: die fünf Listen warten, bis die Seite im Ladezustand ruht (jeder Abschnitt
 *    zeigt seine Platzhalter). Misst Platzhalter → Einträge.
 *  - `natürlich`: ohne Eingriff. Der Modulzähler kommt mit dem Rahmen, vor den Listen der Seite.
 * Kommt der Zähler NACH den Listen, kennt der Ladezustand die Zahl nicht und bleibt bei einer Zeile;
 * diese Folge misst der Spec nicht, sie ist die Grenze des Platzhalters.
 *
 * Gemessen wird breit und auf dem Handschirm, als Admin und als Beobachter (LFH-435,
 * `e2e/AGENTS.md`): der Beobachter sieht über dem Inhalt einen Rechtehinweis, die Vorbedingung
 * prüft der Test vor der Zahl.
 */

/** Dieselbe Hausgrenze wie `lagebild-cls-schmal.spec.ts` — eine Setzung, keine Toleranz. */
const HAUS_GRENZE = 0.03;

const ANSICHTEN = {
  breit: { width: 1440, height: 900 },
  schmal: { width: 390, height: 844 },
} as const;

const NAME_PRAEFIX = 'E2E Überblick Vorgänge CLS';

/** Wie viele Zeilen jeder Abschnitt nach dem Säen zeigt (höchstens drei). */
const ERWARTET = {
  meldung: 3,
  auftrag: 3,
  nachforderung: 2,
  erinnerung: 2,
  abloesung: 0,
} as const;

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

async function einsatzMitVorgaengen(page: Page): Promise<string> {
  const einsatzId = String(
    await post(page, '/api/einsaetze', { bezeichnung: `${NAME_PRAEFIX} ${Date.now()}` }),
  );
  const basis = `/api/einsaetze/${einsatzId}`;
  const jetzt = Date.now();
  // Drahtformat des Servers: UTC ohne Zonenkennung, sekundengenau.
  const inMin = (min: number) =>
    new Date(jetzt + min * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  for (const [absender, inhalt] of [
    ['Florian Nord 1', 'Deich bei km 12 durchfeuchtet, Sandsäcke angefordert'],
    ['RTW 2', 'Patient an UHS Süd übergeben'],
    ['Florian Süd 3', 'Pumpe am Schöpfwerk ausgefallen, Ersatz unterwegs'],
  ]) {
    await post(page, `${basis}/meldungen`, {
      absender,
      meldeweg: 'funk',
      inhalt,
      ereigniszeit: inMin(-5),
    });
  }
  for (const [text, an, fristMin] of [
    ['Deichabschnitt 3 erkunden und Lage melden', 'EA Nord', 90],
    ['Sandsackfüllstelle am Bauhof einrichten', 'EA Süd', 120],
    ['Verpflegung für die Nachtschicht anfordern', 'S4', 180],
  ] as const) {
    await post(page, `${basis}/auftraege`, {
      auftrag_text: text,
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: an }],
      frist_at: inMin(fristMin),
    });
  }
  for (const bezeichnung of ['RTW', 'Pumpe 5000 l/min']) {
    await post(page, `${basis}/nachforderungen`, {
      art: 'Fahrzeug',
      bezeichnung,
      adressat_kategorie: 'leitstelle',
    });
  }
  // „bald“: im 30-min-Fenster des Abschnitts, aber noch nicht fällig (kein Alarm).
  for (const [titel, min] of [
    ['Lagemeldung an die Leitstelle', 10],
    ['Pegelstand Hann. Münden abfragen', 20],
  ] as const) {
    await post(page, `${basis}/erinnerungen`, { titel, faellig_at: inMin(min) });
  }
  return einsatzId;
}

type Folge = 'Listen zuletzt' | 'natürlich';
const FOLGEN: Folge[] = ['Listen zuletzt', 'natürlich'];

/** Die Listen der fünf Abschnitte, ohne Unterpfade (`/nachforderungen/arten` gehört nicht dazu). */
const LISTEN = ['meldungen', 'auftraege', 'nachforderungen', 'erinnerungen', 'abloesungen'];

/** Hält die GET-Abfragen der Folge zurück, bis `freigeben()` sie loslässt. */
async function stelleAbfragen(page: Page, einsatzId: string, folge: Folge) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  let loslassen!: () => void;
  const tor = new Promise<void>((f) => (loslassen = f));
  const kopf = `/api/einsaetze/${einsatzId}`;
  const gehaltenePfade = folge === 'Listen zuletzt' ? LISTEN.map((l) => `${kopf}/${l}`) : [];
  let gehalten = 0;
  await page.route(new RegExp(`/api/einsaetze/${einsatzId}/`), async (route) => {
    const anfrage = route.request();
    const pfad = new URL(anfrage.url()).pathname;
    if (anfrage.method() === 'GET' && gehaltenePfade.includes(pfad)) {
      gehalten += 1;
      await tor;
    }
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

const vorgaenge = (page: Page) => page.locator('[data-lfh="offene-vorgaenge"]');

/** Jeder Abschnitt zeigt seine gesäten Zeilen, ein leerer „keine“. */
async function zeilenStehen(page: Page) {
  for (const [art, anzahl] of Object.entries(ERWARTET)) {
    await expect(vorgaenge(page).locator(`[data-lfh="vorgang-${art}"]`)).toHaveCount(anzahl);
  }
  await expect(
    vorgaenge(page).locator('[data-lfh="vorgaenge-abloesungen"] [data-lfh="abschnitt-keine"]'),
  ).toBeVisible();
}

/** Anker des Endzustands: Ortspfad mit Namen, alle Zeilen, Zahlen, kein Ladezeichen im Inhalt. */
async function endzustand(page: Page) {
  await expect(page.locator('[data-lfh="seitenkopf"]')).toContainText(NAME_PRAEFIX);
  await zeilenStehen(page);
  await expect(vorgaenge(page).locator('[data-lfh="abschnitt-zahl"]').first()).not.toHaveText('—');
  await expect(page.locator('[data-lfh="seiten-inhalt"] [aria-busy="true"]')).toHaveCount(0);
}

async function messe(page: Page, einsatzId: string, folge: Folge): Promise<Messung> {
  const abfragen = await stelleAbfragen(page, einsatzId, folge);
  await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
  if (folge === 'Listen zuletzt') {
    // Vorbedingung: alle fünf Abschnitte laden, die Zahlen aus dem Modulzähler stehen schon.
    await expect(vorgaenge(page).locator('section [aria-busy="true"]')).toHaveCount(LISTEN.length);
    await expect(
      vorgaenge(page).locator('[data-lfh="vorgaenge-meldungen"] [data-lfh="abschnitt-zahl"]'),
    ).toHaveText(String(ERWARTET.meldung));
    await ruheShifts(page);
    abfragen.freigeben();
  }
  await endzustand(page);
  return ruheShifts(page);
}

for (const [ansicht, groesse] of Object.entries(ANSICHTEN)) {
  for (const rolle of ['admin', 'beobachter'] as const) {
    test(`Überblick ${ansicht} als ${rolle}: CLS ≤ ${HAUS_GRENZE}, während „Offene Vorgänge“ nachlädt (${groesse.width} px)`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await anmeldenAlsAdmin(page);
      const einsatzId = await einsatzMitVorgaengen(page);
      if (rolle === 'beobachter') {
        await wechsleZuRolle(page, 'beobachter', einsatzId);
      }
      await beobachteShifts(page);
      await page.setViewportSize(groesse);

      const werte: string[] = [];
      for (const folge of FOLGEN) {
        const m = await messe(page, einsatzId, folge);
        // Der Rollenzweig ist Vorbedingung der Zahl (LFH-435).
        await expect(
          page.getByText('nur Einsatzleitung und Führungspersonal', { exact: true }),
        ).toHaveCount(rolle === 'beobachter' ? 1 : 0);
        werte.push(`${folge}: ${bericht(m)}`);
        expect
          .soft(m.summe, `${ansicht} als ${rolle}, ${folge}: ${bericht(m)}`)
          .toBeLessThanOrEqual(HAUS_GRENZE);
      }
      test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
    });
  }
}
