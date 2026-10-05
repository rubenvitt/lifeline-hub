import { expect, test, type Locator, type Page } from '@playwright/test';
import { beobachteShifts, bericht, ruheShifts, setzeShiftsZurueck } from './cls-kern';
import { ADMIN, ADMIN_PW, wechsleZuRolle } from './rollen-kern';
import { SUBPIXEL, ZIELABSTAND } from './trefflaeche-kern';

/**
 * Prüflisten-Zeile 12 der Bedien-Leitlinie — „kein Sprung, kein Flächenfraß" — für die
 * angepinnten und schwebenden Leisten, gemessen mit echten Kästen und dem
 * `layout-shift`-Beobachter aus `cls-kern.ts`.
 *
 * DER DECKEL IST EINE SETZUNG DES AUFTRAGGEBERS, KEINE NORM: eine angepinnte oder schwebende
 * Leiste belegt im Ruhezustand höchstens die HÄLFTE der Fläche, auf der sie steht
 * (Fensterhöhe für die ETB-Erfassung, Kartenhöhe für die Zeitachse). Wer die Zahl ändert,
 * ändert Spec, diese Datei und die Prüflisten zusammen.
 *
 * CLS IST FÜR EINGABEFOLGEN BLIND: Verschiebungen binnen 500 ms nach einer Eingabe tragen
 * `hadRecentInput`. Der Chip-Umbruch der Erfassung folgt immer einer Eingabe — dort wird die
 * GEOMETRIE gemessen. CLS misst nur das Laden und eine live eintreffende Fremdänderung.
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
 * Klick an die Mitte des Kastens über die Maus, ohne Playwrights Vorab-Rollen:
 * `locator.click()` rollt „bei Bedarf" ins Bild und verschob die Seite bei einem Knopf in einer
 * sticky Fußleiste um 390 px — ein Werkzeug-Artefakt. Wer einen Sprung MESSEN will, darf ihn
 * nicht selbst auslösen.
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
      // Ganz oben auf der Seite ganz im Fenster: ein `sticky; bottom: 0` steigt nie über die
      // Oberkante seines Elternblocks, deshalb hängt die Leiste an der Seitenwurzel.
      expect(
        m.unterkante,
        `${lauf}: Leiste ganz oben auf der Seite ganz im Fenster (Unterkante ${Math.round(m.unterkante)})`,
      ).toBeLessThanOrEqual(m.fenster + 0.5);
      expect(m.breite, `${lauf}: das Dokument läuft waagerecht über`).toBeLessThanOrEqual(
        m.fensterBreite,
      );
      if (flaeche.width < 768) {
        // Unter `md` nutzt das Feld die volle Breite der Erfassungskarte; Spiel für Rahmen und
        // Polsterung.
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
 * ETB: drei gesetzte Felder auf dem Handschirm im Handschuh-Betrieb — die Leiste bleibt ganz im
 * Bild und unter dem Deckel, nichts springt. Getragen von der einzeiligen, waagerecht rollenden
 * Chip-Zeile unter `md`, der Leiste als Fuß der Seitenwurzel und Fokus mit `preventScroll`.
 * Gemessen wird Geometrie, nicht CLS (jede Bewegung folgt einer Eingabe).
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
  // Vorbedingung: die Seite MUSS rollen können — sonst wäre „nichts springt" trivial wahr.
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
    // Im Handschuh-Betrieb liegt eine Option im internen Bildlauf des Menüs. Gerollt wird NUR
    // das Menü (`scrollTop`); `scrollIntoView` rollte auch die Seite.
    await option.evaluate((el) => {
      const menue = el.closest('[data-slash-menu]') as HTMLElement;
      const m = menue.getBoundingClientRect();
      const o = el.getBoundingClientRect();
      if (o.bottom > m.bottom) menue.scrollTop += o.bottom - m.bottom;
      if (o.top < m.top) menue.scrollTop -= m.top - o.top;
    });
    await klickeWieEinMensch(page, option);
    // Die Anwendung fokussiert die Chip-Eingabe selbst; getippt wird per Tastatur, weil
    // `fill()` ebenfalls vorab ins Bild rollt.
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
  // 2 px Spiel: die Chips sind etwas höher als der Knopf „Feld". Ohne einzeilige Zeile kostete
  // jeder Chip eine eigene Reihe.
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
 * Bedienziele der ausgeklappten Zeitachse (LFH-899): der kleinste Abstand zwischen zwei Zielen und
 * die Zahl der Reihen. Ziele sind die Knöpfe, die Auswahl, der Schieber und sein Griff; Griff und
 * Schieber gegeneinander zählen nicht (der Griff liegt auf der Schiene). Abstand zweier Kästen =
 * Lücke auf der trennenden Achse, 0 bei Überlappung. Reihen = Gruppen gleicher Mittellage der
 * Knöpfe und der Auswahl.
 */
async function zeitachsenZiele(page: Page): Promise<{ abstand: number; reihen: number }> {
  return page.evaluate(() => {
    const band = document.querySelector('[data-lfh="zeitachse"]')!;
    const ziele = Array.from(
      band.querySelectorAll<HTMLElement>('button, .ant-select, .ant-slider, .ant-slider-handle'),
    )
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((z) => z.r.width > 0 && z.r.height > 0);
    let abstand = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ziele.length; i += 1) {
      for (let j = i + 1; j < ziele.length; j += 1) {
        const [a, b] = [ziele[i], ziele[j]];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const dx = Math.max(b.r.left - a.r.right, a.r.left - b.r.right, 0);
        const dy = Math.max(b.r.top - a.r.bottom, a.r.top - b.r.bottom, 0);
        abstand = Math.min(abstand, Math.max(dx, dy));
      }
    }
    const mitten = ziele
      .filter((z) => z.el.matches('button, .ant-select'))
      .map((z) => z.r.top + z.r.height / 2)
      .sort((a, b) => a - b);
    let reihen = 0;
    let letzte = Number.NEGATIVE_INFINITY;
    for (const y of mitten) {
      if (y - letzte > 2) reihen += 1;
      letzte = y;
    }
    return { abstand, reihen };
  });
}

/**
 * Lagekarte: die ausgeklappte Zeitachse belegt höchstens die halbe Kartenhöhe, kein Kind ragt
 * aus dem Band, das Band bleibt in der Kartenspalte, und „Abspielen" hält die kurze Achse.
 *
 * Handschirm mit AUSGEBLENDETER Leiste (Vorgabe unter `md`). Mit eingeblendeter Leiste ist die
 * Karte zu niedrig für den Deckel; dort gilt „Band in der Kartenspalte, kein Kind über dem
 * Rand" und die Nicht-Überschneidung mit dem Knopfblock (`fokus-verdeckung.spec.ts`).
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
    // Die Kartenleiste merkt ihre Wahl je Breitenklasse und überlebt das Neuladen — die
    // Vorbedingung wird deshalb gesetzt, nicht geklickt.
    await page.evaluate((offen) => {
      localStorage.setItem('lfh:lagekarte:zeitachse-eingeklappt', '0');
      localStorage.removeItem('lfh:lagekarte:leiste-offen:ab-lg');
      if (offen) localStorage.setItem('lfh:lagekarte:leiste-offen:unter-lg', '1');
      else localStorage.removeItem('lfh:lagekarte:leiste-offen:unter-lg');
    }, lage.leiste);
    for (const dichte of DICHTEN) {
      const lauf = `${lage.name}/${dichte}`;
      await stelleDichte(page, dichte);
      await expect(
        page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas'),
      ).toHaveCount(1, { timeout: 60_000 });
      if (lage.leiste) {
        await expect(page.getByRole('complementary', { name: 'Kartenleiste' })).toBeVisible();
      }
      const band = page.locator('[data-lfh="zeitachse"]');
      // Die Auswahl steht erst, wenn die Stände geladen sind (LFH-899: keine Stand-Knöpfe mehr).
      await expect(band.getByRole('combobox', { name: 'Stand' })).toBeVisible();
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
      // LFH-899: zwei Gruppen, höchstens zwei Reihen; im Handschuh ≥ 16 px zwischen den Zielen.
      const ziele = await zeitachsenZiele(page);
      gemessen.push(`${lauf}: ${ziele.reihen} Reihen, Zielabstand ${Math.round(ziele.abstand)} px`);
      expect(ziele.reihen, `${lauf}: Reihen der Zeitachse`).toBeLessThanOrEqual(2);
      const sollAbstand = ZIELABSTAND[dichte];
      if (sollAbstand != null) {
        expect(ziele.abstand, `${lauf}: kleinster Abstand zwischen Zielen`).toBeGreaterThanOrEqual(
          sollAbstand - SUBPIXEL,
        );
      }
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
 * Laden ohne Sprung: ETB, Lagekarte und Gefahrenmatrix auf dem Handschirm — Summe der
 * Verschiebungen ohne vorherige Eingabe vom Laden bis zur Ruhe. Je Route ein Inhaltsanker,
 * sonst wäre „kein Sprung" auch im Ladezustand wahr.
 *
 * DAS RENNEN WIRD ERZWUNGEN, nicht abgewartet: im ETB sprang die Seite nur, wenn Liste oder
 * Zählung NACH dem ersten Bild eintrafen — selten. Der Durchgang `verzoegert` hält beide
 * Antworten 1,5 s zurück, nur auf den API-Pfaden (`/einsaetze/…/etb` ist auch die
 * Seitenadresse).
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
 * Fremdänderung einer Matrixzelle: eine live eintreffende Bewertung färbt die Zelle um, ohne
 * die Tabelle zu verschieben. Vorbedingung: die Zelle trägt danach wirklich die neue
 * `data-warnstufe`, sonst bewiese „kein Sprung" nichts. Gemessen ab dem Ruhezustand; die
 * Änderung kommt über `page.request` und läuft über den Live-Strom wie eine fremde.
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

/**
 * LFH-435 — die ETB-Erfassungsleiste hat KEINEN Beobachter-Durchgang: ohne Schreibrecht
 * rendert `EtbPage` sie gar nicht, es gibt keine Fläche zu deckeln. Den Nur-Lese-ETB misst
 * Gate 1 (`gate1-ueberlauf.spec.ts`) auf Überlauf, mit der fehlenden Leiste als Vorbedingung.
 */

/**
 * LFH-435, Nur-Lese-Zweig der Lagekarte: der Beobachter sieht die Zeitachse ohne „Stand
 * sichern" (`SnapshotLeiste`, `darfSichern`) und die Leiste ohne „Zeichnen", Platzier- und
 * Einsatzort-Aktionen (`Sidebar.tsx`, `darfSchreiben`). Das Band ist dadurch anders gebaut; es muss
 * dieselben Zusagen halten wie beim Admin. Handschirm mit ausgeblendeter und eingeblendeter
 * Leiste — nur eingeblendet sind die Leistenaktionen als abwesend prüfbar.
 */
test('Lagekarte (LFH-373): die Zeitachse belegt höchstens die halbe Karte und läuft nicht über (Beobachter)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Flaeche 435 Ost ${Date.now()}`);
  // Gesät als Admin; der Beobachter darf keine Stände sichern.
  for (const bezeichnung of ['Stand A', 'Stand B']) {
    const stand = await page.request.post(`/api/einsaetze/${einsatzId}/lage-snapshots`, {
      data: { bezeichnung },
    });
    expect(stand.ok(), await stand.text()).toBeTruthy();
  }
  await wechsleZuRolle(page, 'beobachter', String(einsatzId));
  const SOLL = { kompakt: 30, komfortabel: 48, handschuh: 72 } as const;
  const gemessen: string[] = [];
  const verstoesse: string[] = [];

  for (const lage of [
    { name: 'Handschirm', width: 390, height: 844, leiste: false, deckel: true },
    { name: 'Handschirm mit Leiste', width: 390, height: 844, leiste: true, deckel: false },
  ]) {
    await page.setViewportSize({ width: lage.width, height: lage.height });
    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await page.evaluate((offen) => {
      localStorage.setItem('lfh:lagekarte:zeitachse-eingeklappt', '0');
      localStorage.removeItem('lfh:lagekarte:leiste-offen:ab-lg');
      if (offen) localStorage.setItem('lfh:lagekarte:leiste-offen:unter-lg', '1');
      else localStorage.removeItem('lfh:lagekarte:leiste-offen:unter-lg');
    }, lage.leiste);
    for (const dichte of DICHTEN) {
      const lauf = `${lage.name}/${dichte}`;
      await stelleDichte(page, dichte);
      await expect(
        page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas'),
      ).toHaveCount(1, { timeout: 60_000 });
      const band = page.locator('[data-lfh="zeitachse"]');
      // Positiver Anker im Band zuerst, dann die Abwesenheit.
      await expect(band.getByRole('button', { name: 'Abspielen' })).toBeVisible();
      await expect(
        band.getByRole('button', { name: /Stand sichern/ }),
        `${lauf}: Vorbedingung: ohne Schreibrecht kein „Stand sichern"`,
      ).toHaveCount(0);
      await expect(band.getByLabel('Snapshot-Bezeichnung')).toHaveCount(0);
      if (lage.leiste) {
        const leiste = page.getByRole('complementary', { name: 'Kartenleiste' });
        await expect(leiste).toBeVisible();
        // Positiver Nachbar: ohne ihn wäre eine zugeklappte oder leere Leiste „aktionslos".
        await expect(leiste.locator('section[data-paneel="verortet"]')).toBeVisible();
        await expect(
          leiste.locator('section[data-paneel="zeichnen"]'),
          `${lauf}: Vorbedingung: ohne Schreibrecht kein Zeichnen-Paneel`,
        ).toHaveCount(0);
        // Der Admin trägt hier „Platzieren" am unverorteten Einsatzort.
        await expect(
          leiste.getByRole('button', { name: /^(Platzieren|Verschieben)$/ }),
          `${lauf}: Vorbedingung: ohne Schreibrecht keine Platzier-Aktion`,
        ).toHaveCount(0);
      }
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
      // LFH-899: zwei Gruppen, höchstens zwei Reihen; im Handschuh ≥ 16 px zwischen den Zielen.
      const ziele = await zeitachsenZiele(page);
      gemessen.push(`${lauf}: ${ziele.reihen} Reihen, Zielabstand ${Math.round(ziele.abstand)} px`);
      expect(ziele.reihen, `${lauf}: Reihen der Zeitachse`).toBeLessThanOrEqual(2);
      const sollAbstand = ZIELABSTAND[dichte];
      if (sollAbstand != null) {
        expect(ziele.abstand, `${lauf}: kleinster Abstand zwischen Zielen`).toBeGreaterThanOrEqual(
          sollAbstand - SUBPIXEL,
        );
      }
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
  expect(verstoesse, 'Deckel verletzt').toEqual([]);
});

/**
 * LFH-435, Nur-Lese-Zweig der Gefahrenmatrix: der Beobachter sieht über der Matrix den Hinweis
 * „Nur Lesezugriff" (`GefahrenPage.tsx`) und gesperrte Zellen. Der Hinweis kommt beim Admin
 * nicht vor — er darf die Matrix weder beim Laden noch bei einer live eintreffenden Bewertung
 * verschieben und die Seite nicht verbreitern. Gemessen wie in den beiden Admin-Tests oben; die
 * Fremdänderung schreibt ein Admin in einem EIGENEN Kontext, denn `page.request` ist nach dem
 * Wechsel der Beobachter.
 */
test('Gefahrenmatrix (LFH-373): Hinweis über der Matrix — Laden ohne Sprung, Fremdänderung verschiebt nicht (Beobachter)', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await beobachteShifts(page);
  await anmelden(page);
  const { id, gid } = await matrixEinsatz(page, `Flaeche 435 Matrix ${Date.now()}`);
  await wechsleZuRolle(page, 'beobachter', String(id));
  const schreiber = await browser.newContext();
  try {
    const login = await schreiber.request.post('/api/auth/login', {
      data: { benutzername: ADMIN, passwort: ADMIN_PW },
    });
    expect(login.ok(), `Admin-Kontext: ${login.status()}`).toBeTruthy();

    const gemessen: string[] = [];
    const tabelle = page.locator('.gefahren-matrix');
    const hinweis = page.getByRole('alert').filter({ hasText: /Nur Lesezugriff/ });
    /** Anker und Vorbedingung, je Aufruf der Seite. */
    const nurLesenSteht = async (lauf: string) => {
      await expect(page.getByRole('button', { name: /^Bewertung / })).toHaveCount(58);
      await expect(page.getByRole('heading', { name: /Sektor Sprung 1/ })).toBeVisible();
      await expect(
        hinweis,
        `${lauf}: Vorbedingung: der Hinweis „Nur Lesezugriff" steht`,
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^Bewertung Atemgifte × Menschen/ }),
        `${lauf}: Vorbedingung: die Zellen sind gesperrt`,
      ).toBeDisabled();
      const lage = await page.evaluate(() => {
        const h = [...document.querySelectorAll('[role="alert"]')]
          .find((el) => el.textContent?.includes('Nur Lesezugriff'))!
          .getBoundingClientRect();
        const t = document.querySelector('.gefahren-matrix')!.getBoundingClientRect();
        return {
          hinweisUnten: h.bottom,
          matrixOben: t.top,
          ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(lage.hinweisUnten, `${lauf}: der Hinweis steht ÜBER der Matrix`).toBeLessThanOrEqual(
        lage.matrixOben + 0.5,
      );
      expect(lage.ueberlauf, `${lauf}: die Seite läuft nicht waagerecht über`).toBeLessThanOrEqual(
        1,
      );
    };

    // ── Laden ohne Sprung (Handschirm), wie „Laden ohne Sprung" oben.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const dichte of ['kompakt', 'handschuh'] as const) {
      await page.goto(`/einsaetze/${id}/gefahren`);
      await stelleDichte(page, dichte);
      await nurLesenSteht(`Laden/${dichte}`);
      await schriftenGeladen(page);
      const messung = await ruheShifts(page);
      const name = `Gefahrenmatrix/${dichte}`;
      gemessen.push(`${name}: ${bericht(messung)}`);
      expect(messung.summe, `${name}: ${bericht(messung)}`).toBeLessThanOrEqual(CLS_GUT);
    }

    // ── Fremdänderung, wie „Fremdänderung" oben.
    for (const [flaeche, stufe] of [
      [{ width: 390, height: 844 }, 'akut'],
      [{ width: 1366, height: 768 }, 'hoch'],
    ] as const) {
      await page.setViewportSize(flaeche);
      const lauf = `${flaeche.width}×${flaeche.height}`;
      await page.goto(`/einsaetze/${id}/gefahren`);
      await nurLesenSteht(lauf);
      await schriftenGeladen(page);
      await ruheShifts(page);
      const vorher = (await tabelle.boundingBox())!;
      await setzeShiftsZurueck(page);

      const antwort = await schreiber.request.put(
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
      gemessen.push(
        `${lauf}: ${bericht(messung)}, Tabelle ${Math.round(vorher.y)} → ${Math.round(nachher.y)}`,
      );
      expect(nachher.y, `${lauf}: die Tabelle steht an derselben Stelle`).toBeCloseTo(vorher.y, 0);
      expect(messung.summe, `${lauf}: ${bericht(messung)}`).toBeLessThanOrEqual(CLS_GUT);
    }
    test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
  } finally {
    await schreiber.close();
  }
});
