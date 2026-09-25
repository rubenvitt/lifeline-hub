import { expect, test, type Locator, type Page } from '@playwright/test';

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
