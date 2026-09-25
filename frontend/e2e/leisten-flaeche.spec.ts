import { expect, test, type Locator, type Page } from '@playwright/test';
import { beobachteShifts, bericht, ruheShifts, setzeShiftsZurueck } from './cls-kern';

/**
 * Prüflisten-Zeile 12 der Bedien-Leitlinie — „kein Sprung, kein Flächenfraß" — für die
 * angepinnten und schwebenden Leisten (LFH-373).
 *
 * WAS HIER STEHT UND WARUM NICHT IN VITEST: jsdom rechnet kein Layout; eine Leistenhöhe, ein
 * Umbruch oder ein Layout-Shift existieren dort nicht. Gemessen wird mit echten Kästen und dem
 * `layout-shift`-Beobachter aus `cls-kern.ts`.
 *
 * DER DECKEL IST EINE SETZUNG, KEINE NORM: eine angepinnte oder schwebende Leiste belegt im
 * Ruhezustand höchstens die HÄLFTE der Fläche, auf der sie steht (Fensterhöhe für die
 * ETB-Erfassung, Kartenhöhe für die Zeitachse). Entscheidung des Auftraggebers vom 25.09.2026
 * nach der Vorab-Messung (ETB bei 390 × 844 im Handschuh-Betrieb 497 px = 59 %, bei 390 × 600
 * sogar 83 %). Wer die Zahl ändert, ändert Spec (`openspec/changes/lfh-373-…`), diese Datei
 * und die Prüflisten zusammen.
 *
 * CLS IST FÜR EINGABEFOLGEN BLIND: Verschiebungen binnen 500 ms nach einer Eingabe tragen
 * `hadRecentInput` und zählen in keiner CLS-Definition. Der Chip-Umbruch der Erfassung folgt
 * immer einer Eingabe — dort wird deshalb die GEOMETRIE gemessen (Lage der Zeitachsenzeilen
 * vorher/nachher), nicht CLS. CLS misst nur, was ohne Eingabe geschieht: das Laden und eine
 * Fremdänderung, die live eintrifft.
 *
 * MUTATIONSPROBE (25.09.2026, je Fix einzeln zurückgedreht, Test muss rot werden):
 *  - Leiste zurück in die Zeitachsenspalte (`fuss` entfernt) → Deckel-Test ROT (Überstand).
 *  - Feld nicht gestapelt → Deckel-Test ROT. Chip-Zeile bricht um → Chip-Test ROT.
 *  - Zeitleiste ohne Umbruch UND „Abspielen" schrumpft → Zeitachsen-Test ROT.
 *  - ÜBERLEBT, erklärt: nur `abspielenStil` zurück — der Umbruch der Zeitleiste hält
 *    „Abspielen" allein breit, `flexShrink: 0` ist eine Sicherung. Nur `preventScroll` in
 *    `MetaChip` zurück — seit die Leiste als Seitenfuß ganz im Fenster steht, hat der native
 *    Fokus nichts mehr zu rollen; die Sicherung hält `MetaChip.test.tsx`.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const DICHTEN = ['kompakt', 'komfortabel', 'handschuh'] as const;
const FLAECHEN = [
  { name: 'Handschirm', width: 390, height: 844 },
  { name: 'Tablet', width: 1024, height: 768 },
  { name: 'Fükw', width: 1366, height: 768 },
] as const;
/** Deckel: höchstens die Hälfte (siehe Kopfkommentar). Literal, keine Rechnung aus Code. */
const DECKEL = 0.5;
/** CLS-Grenze „gut", https://web.dev/articles/cls — Literal wie in `einsatzauswahl-cls`. */
const CLS_GUT = 0.1;

// Login-Helfer aus `kernfluss.spec.ts` kopiert — es gibt (noch) kein geteiltes Login-Modul.
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, bezeichnung: string): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(antwort.ok(), `Seeding Einsatz: ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

/** Dichte über localStorage + Neuladen, mit Wache am `<html>` (Muster `gate3-trefflaeche`). */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/** Schriften fertig — sonst kippt der `font-display: swap`-Tausch Vorher/Nachher-Messungen. */
async function schriftenGeladen(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * Klick an die Mitte des Kastens über die Maus, ohne Playwrights Vorab-Rollen.
 *
 * GEMESSEN (LFH-373): `locator.click()` rollt ein Ziel vorher „bei Bedarf" ins Bild — bei
 * einem Knopf in einer `position: sticky`-Fußleiste rollte das die Seite um 390 px, obwohl
 * der Knopf längst sichtbar war. Mit `dispatchEvent` blieb die Seite bei 0: der Sprung war ein
 * Werkzeug-Artefakt, keiner der Anwendung. Wer einen Sprung unter dem Cursor MESSEN will, darf
 * ihn nicht selbst auslösen.
 */
async function klickeWieEinMensch(page: Page, ziel: Locator) {
  await expect(ziel).toBeVisible();
  const kasten = (await ziel.boundingBox())!;
  await page.mouse.click(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2);
}

test('ETB (LFH-373): die Erfassungsleiste belegt höchstens die halbe Fensterhöhe', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Flaeche 373 Nord ${Date.now()}`);
  const gemessen: string[] = [];
  const verstoesse: string[] = [];

  for (const flaeche of FLAECHEN) {
    await page.setViewportSize({ width: flaeche.width, height: flaeche.height });
    for (const dichte of DICHTEN) {
      const lauf = `${flaeche.name} ${flaeche.width}×${flaeche.height}/${dichte}`;
      await page.goto(`/einsaetze/${einsatzId}/etb`);
      await stelleDichte(page, dichte);
      // Ruhezustand: ein Entwurf, keine gesetzten Felder, kein Menü offen.
      const leiste = page.locator('.etb-erfassung-sticky');
      await expect(leiste.getByPlaceholder(/^Inhalt …/)).toBeVisible();
      await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
      await schriftenGeladen(page);

      await page.evaluate(() => window.scrollTo(0, 0));
      const m = await page.evaluate(() => {
        const l = document.querySelector('.etb-erfassung-sticky')!.getBoundingClientRect();
        const karte = document.querySelector('[data-lfh="etb-erfassung"]')!.getBoundingClientRect();
        const feld = document
          .querySelector('.etb-erfassung-sticky textarea')!
          .getBoundingClientRect();
        return {
          leiste: l.height,
          unterkante: l.bottom,
          karte: karte.width,
          feld: feld.width,
          fenster: window.innerHeight,
          breite: document.documentElement.scrollWidth,
          fensterBreite: window.innerWidth,
        };
      });
      const anteil = m.leiste / m.fenster;
      gemessen.push(`${lauf}: ${Math.round(m.leiste)} px = ${Math.round(anteil * 100)} %`);
      if (anteil > DECKEL) {
        verstoesse.push(
          `${lauf}: Leiste ${Math.round(m.leiste)} px > ${DECKEL * 100} % von ${m.fenster}`,
        );
      }
      // Ganz oben auf der Seite ganz im Fenster (LFH-373): in der Zeitachsenspalte konnte die
      // angepinnte Leiste nicht über deren Oberkante steigen und ragte auf dem Handschirm im
      // Handschuh-Betrieb 61 px unter das Fenster — obwohl ihre Höhe den Deckel hielt.
      expect(
        m.unterkante,
        `${lauf}: Leiste ganz oben auf der Seite ganz im Fenster (Unterkante ${Math.round(m.unterkante)})`,
      ).toBeLessThanOrEqual(m.fenster + 0.5);
      expect(m.breite, `${lauf}: das Dokument läuft waagerecht über`).toBeLessThanOrEqual(
        m.fensterBreite,
      );
      if (flaeche.width < 768) {
        // Unter `md` nutzt das Feld die volle Breite der Erfassungskarte (vorher 124 von 366 px,
        // eingezwängt zwischen Typ-Präfix und „Erfassen"). Spiel für Rahmen und Polsterung.
        expect(
          m.feld,
          `${lauf}: Textfeld ${Math.round(m.feld)} px bei ${Math.round(m.karte)} px Karte`,
        ).toBeGreaterThanOrEqual(m.karte - 40);
      }
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
  expect(verstoesse, 'Deckel verletzt').toEqual([]);
});

/**
 * ETB (LFH-373, Prüfliste ETB Zeile 12): drei gesetzte Felder auf dem Handschirm im
 * Handschuh-Betrieb — die Leiste bleibt ganz im Bild und unter dem Deckel, nichts springt.
 *
 * DIE PRÄMISSE DER PRÜFLISTE HAT SICH GEDREHT: im Juli stand die Erfassung als angepinnter
 * KOPF über einer Tabelle. Seit dem Neuentwurf ist sie ein angepinnter FUSS. Gemessen vor
 * LFH-373 (390 × 844, handschuh): jeder gesetzte Chip kostete eine eigene Reihe (+81 px), bei
 * drei Chips 578 px (68 %); die Leiste hing in der Zeitachsenspalte (Oberkante 489) und ragte
 * ganz oben 61–166 px unter das Fenster; Tippen in einen Chip rollte die Seite, um die
 * Schreibmarke zu zeigen; die Chip-Eingabe fokussierte per `autoFocus` und rollte die Seite
 * um bis zu 467 px. Behoben: einzeilige, waagerecht rollende Chip-Zeile unter `md`, die
 * Leiste als Fuß der Seitenwurzel (`EinsatzSeite.fuss`), Fokus mit `preventScroll`.
 *
 * GEMESSEN WIRD GEOMETRIE, nicht CLS: jede Bewegung hier folgt einer Eingabe
 * (`hadRecentInput`), CLS wäre blind (Kopfkommentar).
 */
test('ETB (LFH-373): drei gesetzte Felder — Leiste ganz im Bild und unter dem Deckel, nichts springt', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Flaeche 373 Chip ${Date.now()}`);
  for (let n = 1; n <= 12; n += 1) {
    const eintrag = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: {
        typ: 'meldung',
        inhalt: `Probe ${n}: Lage unverändert`,
        von: 'ELW 1',
        an: 'Leitstelle',
      },
    });
    expect(eintrag.ok(), await eintrag.text()).toBeTruthy();
  }
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await stelleDichte(page, 'handschuh');
  const zeilen = page
    .getByRole('region', { name: 'Einsatztagebuch' })
    .getByTestId('etb-ereigniszeile');
  await expect(zeilen).toHaveCount(12);
  await schriftenGeladen(page);
  await page.evaluate(() => window.scrollTo(0, 0));

  const lageDerZeilen = () =>
    zeilen.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().y * 2) / 2));
  const leistenKasten = () =>
    page.evaluate(() => {
      const r = document.querySelector('.etb-erfassung-sticky')!.getBoundingClientRect();
      return { hoehe: r.height, unterkante: r.bottom, fenster: window.innerHeight };
    });
  const vorher = await lageDerZeilen();
  const kastenVorher = await leistenKasten();
  // Vorbedingung (Review LFH-373): die Seite MUSS rollen können — sonst bliebe scrollY 0, was
  // immer Fokus oder Tippen tun, und „nichts springt" wäre trivial wahr.
  const reserve = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(reserve, 'Vorbedingung: die Seite hat eine Bildlaufreserve').toBeGreaterThan(200);

  const leiste = page.locator('.etb-erfassung-sticky');
  for (const [feld, wert] of [
    ['Von', 'Florian Nord 1'],
    ['An', 'Einsatzleitung Süd'],
    ['Veranlassung', 'Lage an die Leitstelle gemeldet'],
  ] as const) {
    await klickeWieEinMensch(page, leiste.getByRole('button', { name: 'Feld', exact: true }));
    const option = page
      .locator('[data-slash-menu]')
      .getByRole('option', { name: feld, exact: true });
    // Im Handschuh-Betrieb (72 px je Option, Menü höchstens 280 px) liegt eine Option im
    // internen Bildlauf des Menüs. Gerollt wird NUR das Menü, wie es eine Person mit dem Finger
    // täte — `scrollTop` am Menü, nicht `scrollIntoView` (das rollte auch die Seite).
    await option.evaluate((el) => {
      const menue = el.closest('[data-slash-menu]') as HTMLElement;
      const m = menue.getBoundingClientRect();
      const o = el.getBoundingClientRect();
      if (o.bottom > m.bottom) menue.scrollTop += o.bottom - m.bottom;
      if (o.top < m.top) menue.scrollTop -= m.top - o.top;
    });
    await klickeWieEinMensch(page, option);
    // Die Anwendung fokussiert die Chip-Eingabe selbst; getippt wird per Tastatur, weil
    // `fill()` ebenfalls vorab ins Bild rollt (siehe `klickeWieEinMensch`).
    await expect(leiste.getByLabel(feld, { exact: true })).toBeFocused();
    await page.keyboard.type(wert);
    await page.keyboard.press('Enter');
    await expect(leiste.getByRole('button', { name: `Aktionen zu ${feld}` })).toBeVisible();
  }

  const zeile = leiste.locator('[data-lfh="etb-erfassung"] > div').last();
  const rollt = await zeile.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(rollt, 'Vorbedingung: die Chips füllen die Zeile, sie rollt waagerecht').toBe(true);

  const kastenNachher = await leistenKasten();
  expect(
    await page.evaluate(() => window.scrollY),
    'weder Fokus noch Tippen rollen die Seite',
  ).toBe(0);
  expect(await lageDerZeilen(), 'die Zeilen der Zeitachse stehen an derselben Stelle').toEqual(
    vorher,
  );
  // 2 px Spiel: gemessen wuchs die Leiste mit drei Chips um 1,2 px (Zeilenhöhe der Chips
  // gegenüber dem Knopf „Feld"). Ohne einzeilige Zeile waren es 158 px — eine Reihe je Chip.
  expect(
    kastenNachher.hoehe - kastenVorher.hoehe,
    `die Leiste wächst mit den Chips nicht (${Math.round(kastenVorher.hoehe)} → ${Math.round(kastenNachher.hoehe)} px)`,
  ).toBeLessThanOrEqual(2);
  expect(
    kastenNachher.hoehe,
    `mit drei Chips unter dem Deckel (${Math.round(kastenNachher.hoehe)} px)`,
  ).toBeLessThanOrEqual(kastenNachher.fenster * DECKEL);
  expect(kastenNachher.unterkante, 'ganz im Fenster').toBeLessThanOrEqual(
    kastenNachher.fenster + 0.5,
  );
  await expect(leiste.getByPlaceholder(/^Inhalt …/)).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    'das Dokument läuft nicht waagerecht über',
  ).toBeLessThanOrEqual(390);
  test.info().annotations.push({
    type: 'messwert',
    description: `Leiste ${Math.round(kastenVorher.hoehe)} → ${Math.round(kastenNachher.hoehe)} px, Unterkante ${Math.round(kastenNachher.unterkante)} von ${kastenNachher.fenster}`,
  });
});

/**
 * Lagekarte (LFH-373, Prüfliste Lagekarte Zeile 12 und Zeile 2): die ausgeklappte Zeitachse
 * belegt höchstens die halbe Kartenhöhe, kein Kind ragt aus dem Band, das Band bleibt in der
 * Kartenspalte, und „Abspielen" hält die kurze Achse.
 *
 * GEMESSEN VOR LFH-373: bei 390 px im Handschuh-Betrieb schrumpfte „Abspielen" als Flex-Kind
 * auf 17 × 72 px; nach der Einrückung des Fußes vor die Knopfspalte (Gruppe 5) ragte das
 * Bezeichnungsfeld mit festen 180 px über den Bandrand und fing die Klicks auf die
 * Kartenknöpfe ab. Behoben über `sichernFeldStil`, `zeitleisteStil`, `abspielenStil`.
 *
 * Handschirm mit AUSGEBLENDETER Leiste (die Vorgabe unter `md`). Mit eingeblendeter Leiste
 * bleibt die Karte nur rund 337 px hoch; dort gilt nicht der Deckel, sondern „Band in der
 * Kartenspalte, kein Kind über dem Rand" — und die Nicht-Überschneidung mit dem Knopfblock,
 * die `fokus-verdeckung.spec.ts` misst.
 */
test('Lagekarte (LFH-373): die Zeitachse belegt höchstens die halbe Karte und läuft nicht über', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Flaeche 373 Ost ${Date.now()}`);
  for (const bezeichnung of ['Stand A', 'Stand B']) {
    const stand = await page.request.post(`/api/einsaetze/${einsatzId}/lage-snapshots`, {
      data: { bezeichnung },
    });
    expect(stand.ok(), await stand.text()).toBeTruthy();
  }
  const SOLL = { kompakt: 30, komfortabel: 48, handschuh: 72 } as const;
  const gemessen: string[] = [];
  const verstoesse: string[] = [];

  for (const lage of [
    { name: 'Fükw', width: 1366, height: 768, leiste: false, deckel: true },
    { name: 'Tablet', width: 1024, height: 768, leiste: false, deckel: true },
    { name: 'Handschirm', width: 390, height: 844, leiste: false, deckel: true },
    { name: 'Handschirm mit Leiste', width: 390, height: 844, leiste: true, deckel: false },
  ]) {
    await page.setViewportSize({ width: lage.width, height: lage.height });
    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await page.evaluate(() => localStorage.setItem('lfh:lagekarte:zeitachse-eingeklappt', '0'));
    for (const dichte of DICHTEN) {
      const lauf = `${lage.name}/${dichte}`;
      await stelleDichte(page, dichte);
      await expect(
        page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas'),
      ).toHaveCount(1, { timeout: 60_000 });
      if (lage.leiste) await page.getByRole('button', { name: 'Leiste einblenden' }).click();
      const band = page.locator('[data-lfh="zeitachse"]');
      await expect(band.getByRole('button', { name: 'Stand A' })).toBeVisible();
      await schriftenGeladen(page);

      const m = await page.evaluate(() => {
        const b = document.querySelector('[data-lfh="zeitachse"]')!;
        const r = b.getBoundingClientRect();
        const k = document.querySelector('[data-lfh="kartenspalte"]')!.getBoundingClientRect();
        const raus = Array.from(b.querySelectorAll('button, input, .ant-slider'))
          .map((el) => el.getBoundingClientRect())
          .filter((e) => e.width > 0 && (e.right > r.right + 0.5 || e.left < r.left - 0.5)).length;
        return {
          band: r.height,
          karte: k.height,
          raus,
          inSpalte:
            r.left >= k.left - 0.5 &&
            r.right <= k.right + 0.5 &&
            r.top >= k.top - 0.5 &&
            r.bottom <= k.bottom + 0.5,
          ueberlauf: b.scrollWidth - b.clientWidth,
        };
      });
      const anteil = m.band / m.karte;
      gemessen.push(
        `${lauf}: ${Math.round(m.band)}/${Math.round(m.karte)} px = ${Math.round(anteil * 100)} %`,
      );
      expect(m.raus, `${lauf}: Knöpfe/Felder über den Bandrand`).toBe(0);
      expect(m.ueberlauf, `${lauf}: das Band läuft waagerecht über`).toBeLessThanOrEqual(1);
      expect(m.inSpalte, `${lauf}: das Band steht in der Kartenspalte`).toBe(true);
      if (lage.deckel && anteil > DECKEL) {
        verstoesse.push(
          `${lauf}: Band ${Math.round(m.band)} px > ${DECKEL * 100} % von ${Math.round(m.karte)}`,
        );
      }
      const abspielen = (await band.getByRole('button', { name: 'Abspielen' }).boundingBox())!;
      expect(
        Math.min(abspielen.width, abspielen.height),
        `${lauf}: „Abspielen" ${abspielen.width}×${abspielen.height}, kurze Achse Soll ≥ ${SOLL[dichte]}`,
      ).toBeGreaterThanOrEqual(SOLL[dichte] - 0.5);
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
  expect(verstoesse, 'Deckel verletzt').toEqual([]);
});

/** Einsatz mit zwei Gefahrengebieten per API (`POST …/zonen`, ohne WebGL). */
async function matrixEinsatz(
  page: Page,
  bezeichnung: string,
): Promise<{ id: number; gid: number }> {
  const id = await einsatzAnlegen(page, bezeichnung);
  for (const [i, label] of ['Sektor Sprung 1', 'Sektor Sprung 2'].entries()) {
    const x = 10 + i / 20;
    const zone = await page.request.post(`/api/einsaetze/${id}/zonen`, {
      data: {
        typ: 'gefahrengebiet',
        geometrie_typ: 'Polygon',
        geometrie: JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [x, 50],
              [x + 0.01, 50],
              [x + 0.01, 50.01],
              [x, 50.01],
              [x, 50],
            ],
          ],
        }),
        label,
      },
    });
    expect(zone.ok(), await zone.text()).toBeTruthy();
  }
  const gebiete = (await (
    await page.request.get(`/api/einsaetze/${id}/gefahrengebiete`)
  ).json()) as {
    id: number;
    label: string;
  }[];
  return { id, gid: gebiete.find((g) => g.label === 'Sektor Sprung 1')!.id };
}

/**
 * Laden ohne Sprung (LFH-373, Prüflisten Zeile 12): ETB, Lagekarte und Gefahrenmatrix auf dem
 * Handschirm. Summe der Verschiebungen OHNE vorherige Eingabe ab dem Laden bis zur Ruhe.
 *
 * Der Beobachter lebt je Dokument (`cls-kern.ts`); `stelleDichte` lädt neu, gemessen wird also
 * genau das Laden in der gewählten Stufe. VORBEDINGUNG je Route ist ein Inhaltsanker — ohne
 * ihn wäre „kein Sprung" auch für eine Seite wahr, die noch im Ladezustand steht.
 *
 * DAS RENNEN WIRD ERZWUNGEN, nicht abgewartet (gemessen im Gate-Lauf 25.09.2026): im ETB sprang
 * die Seite nur, wenn Liste oder Zählung NACH dem ersten Bild eintrafen — in einem von fünf bis
 * acht Läufen. Dann schoben die Zeilen die Bilanz aus dem Bild (0,22) oder die Meta brach den
 * Seitenkopf um (0,19). Der Durchgang `verzoegert` hält beide Antworten 1,5 s zurück; ohne ihn
 * wäre der Test grün durch Zufall. Die Verzögerung greift nur auf die API-Pfade, nie auf das
 * Dokument (`/einsaetze/…/etb` ist auch die Seitenadresse).
 */
test('Laden ohne Sprung (LFH-373): ETB, Lagekarte und Gefahrenmatrix auf dem Handschirm', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await beobachteShifts(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await anmelden(page);
  const { id: matrixId } = await matrixEinsatz(page, `Flaeche 373 Sprung ${Date.now()}`);
  for (let n = 1; n <= 8; n += 1) {
    const eintrag = await page.request.post(`/api/einsaetze/${matrixId}/etb`, {
      data: {
        typ: 'meldung',
        inhalt: `Probe ${n}: Lage unverändert`,
        von: 'ELW 1',
        an: 'Leitstelle',
      },
    });
    expect(eintrag.ok(), await eintrag.text()).toBeTruthy();
  }

  const ROUTEN = [
    {
      name: 'ETB',
      pfad: `/einsaetze/${matrixId}/etb`,
      verzoegern: /\/api\/einsaetze\/\d+\/etb(\?|$|\/zaehler)/,
      anker: async () =>
        // 8 gesäte Meldungen + 2 Systemeinträge der beiden angelegten Gefahrengebiete.
        expect(
          page.getByRole('region', { name: 'Einsatztagebuch' }).getByTestId('etb-ereigniszeile'),
        ).toHaveCount(10),
    },
    {
      name: 'Lagekarte',
      pfad: `/einsaetze/${matrixId}/lagekarte`,
      anker: async () =>
        expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
          1,
          { timeout: 60_000 },
        ),
    },
    {
      name: 'Gefahrenmatrix',
      pfad: `/einsaetze/${matrixId}/gefahren`,
      anker: async () => {
        await expect(page.getByRole('button', { name: /^Bewertung / })).toHaveCount(58);
        await expect(page.getByRole('heading', { name: /Sektor Sprung 1/ })).toBeVisible();
      },
    },
  ];
  const gemessen: string[] = [];
  for (const route of ROUTEN) {
    const verzoegern = 'verzoegern' in route ? route.verzoegern : undefined;
    for (const dichte of ['kompakt', 'handschuh'] as const) {
      for (const lauf of verzoegern ? (['direkt', 'verzoegert'] as const) : (['direkt'] as const)) {
        await page.goto(route.pfad);
        if (lauf === 'verzoegert') {
          await page.route(verzoegern!, async (anfrage) => {
            await new Promise((fertig) => setTimeout(fertig, 1500));
            await anfrage.continue().catch(() => {});
          });
        }
        await stelleDichte(page, dichte);
        await route.anker();
        await schriftenGeladen(page);
        const messung = await ruheShifts(page);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        const name = `${route.name}/${dichte}${lauf === 'verzoegert' ? '/verzögert' : ''}`;
        gemessen.push(`${name}: ${bericht(messung)}`);
        expect(messung.summe, `${name}: ${bericht(messung)}`).toBeLessThanOrEqual(CLS_GUT);
      }
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

/**
 * Fremdänderung einer Matrixzelle (LFH-373, Prüfliste Gefahrenmatrix Zeile 12): eine Bewertung,
 * die live eintrifft, färbt die Zelle um, ohne die Tabelle zu verschieben.
 *
 * VORBEDINGUNG: die Zelle trägt danach wirklich die neue `data-warnstufe` — sonst wäre „kein
 * Sprung" auch dann wahr, wenn das Live-Ereignis nie ankam. Gemessen wird ab dem Ruhezustand
 * (`setzeShiftsZurueck`), die Ladephase zählt nicht mit. Die Änderung kommt über
 * `page.request` (Präzedenz: `abloesung-zufluss.spec.ts`); dass sie vom selben Benutzer stammt,
 * ändert am Weg über den Live-Strom und das Nachladen der Matrix nichts.
 */
test('Fremdänderung (LFH-373): eine live eintreffende Bewertung verschiebt die Matrix nicht', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await beobachteShifts(page);
  await anmelden(page);
  const { id, gid } = await matrixEinsatz(page, `Flaeche 373 Fremd ${Date.now()}`);
  const gemessen: string[] = [];
  for (const flaeche of [
    { width: 390, height: 844 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(flaeche);
    await page.goto(`/einsaetze/${id}/gefahren`);
    await expect(page.getByRole('button', { name: /^Bewertung / })).toHaveCount(58);
    await schriftenGeladen(page);
    await ruheShifts(page);
    const tabelle = page.locator('.gefahren-matrix');
    const vorher = (await tabelle.boundingBox())!;
    await setzeShiftsZurueck(page);

    const stufe = flaeche.width < 768 ? 'akut' : 'hoch';
    const antwort = await page.request.put(
      `/api/einsaetze/${id}/gefahrengebiete/${gid}/matrix/bewertung`,
      { data: { gefahrentyp: 'atemgifte', schutzobjekt: 'menschen', warnstufe: stufe } },
    );
    expect(antwort.ok(), await antwort.text()).toBeTruthy();
    const zelle = page.locator('td', {
      has: page.getByRole('button', { name: /^Bewertung Atemgifte × Menschen/ }),
    });
    await expect(zelle).toHaveAttribute('data-warnstufe', stufe);

    const messung = await ruheShifts(page);
    const nachher = (await tabelle.boundingBox())!;
    const lauf = `${flaeche.width}×${flaeche.height}`;
    gemessen.push(
      `${lauf}: ${bericht(messung)}, Tabelle ${Math.round(vorher.y)} → ${Math.round(nachher.y)}`,
    );
    expect(nachher.y, `${lauf}: die Tabelle steht an derselben Stelle`).toBeCloseTo(vorher.y, 0);
    expect(messung.summe, `${lauf}: ${bericht(messung)}`).toBeLessThanOrEqual(CLS_GUT);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});
