import { expect, test, type Locator, type Page } from '@playwright/test';
import { randKontrast } from './kontrast-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Stab und Informationstelefon am Handschirm (LFH-978).
 *
 * - **Besetzung (U67):** bei 390 px steht „Besetzung ändern" UNTER dem Inhalt des Sachgebiets,
 *   linksbündig, und der Inhalt nutzt ≥ 90 % der Eintragsbreite. Vorher quetschte der Knopf rechts
 *   die Beschreibung auf rund 190 px, die Seite maß über 5 000 px.
 * - **Sichtung (U69):** die Wertzeile der Vorbereitung bricht bei 390 und 820 px nur an „ · "
 *   um. Gemessen je Teil über die Zeilenkästen eines `Range`: ein Teil auf zwei Zeilen hat zwei
 *   verschiedene Oberkanten. Vorbedingung ist, dass die Zeile überhaupt umbricht, sonst wäre
 *   „kein Teil zerrissen" trivial wahr.
 * - **Notizfeld (U70):** im Informationstelefon trägt das Notizfeld bei 390 px einen sichtbaren
 *   Rahmen, in der Farbe des Anliegen-Selects und ≥ 3 : 1 gegen den Grund der Zeile (WCAG
 *   1.4.11, eingeschwungen über `randKontrast`). Gegenprobe: das eine Feld des ETB bleibt
 *   rahmenlos, dort trägt die Zeile den Rahmen.
 *
 * NICHT-PRIVILEGIERT (LFH-435): der Beobachter hat keinen Knopf (Vorbedingung vor der Messung);
 * gemessen wird, dass sein Inhalt die Zeile füllt und die Sichtung ebenso nur am Trenner bricht.
 *
 * Kein `networkidle` (SSE-Strom), kein Device-Descriptor. Schranken als Literale.
 */

const HANDSCHIRM = { width: 390, height: 844 };
const TABLET_HOCH = { width: 820, height: 1180 };
const FUEKW = { width: 1366, height: 900 };

/** Anteil der Eintragsbreite, den der Inhalt mindestens einnimmt (Ticket: ≥ 90 %). */
const INHALT_ANTEIL = 0.9;
/** WCAG 1.4.11: Rand eines Steuerelements gegen den Grund. */
const RANDBODEN = 3;
/** Subpixel-Spielraum: Chromium rechnet unter Last anders als im Einzellauf. */
const SUBPIXEL = 0.5;

/** Sichtungen der gesäten Betroffenen; „tot" und „unverletzt" erscheinen nur mit Zahl > 0. */
const LANG = ['sk3', 'tot', 'unverletzt'];

async function einsatzAnlegen(page: Page, sichtungen: readonly string[] = LANG): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E 978 Stab schmal ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  const einsatzId = String(((await antwort.json()) as { id: number }).id);
  for (const kategorie of sichtungen) {
    const person = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, {
      data: { antreff_ort: 'Sammelstelle Süd' },
    });
    expect(person.ok(), `Person: ${person.status()} ${await person.text()}`).toBe(true);
    const { id } = (await person.json()) as { id: number };
    const sichtung = await page.request.post(
      `/api/einsaetze/${einsatzId}/personen/${id}/sichtung`,
      { data: { kategorie } },
    );
    expect(sichtung.ok(), `Sichtung ${kategorie}: ${sichtung.status()}`).toBe(true);
  }
  return einsatzId;
}

/** Der Provider liest die gespeicherte Dichte beim Montieren, deshalb vor dem `goto`. */
async function stelleDichte(page: Page, dichte: 'komfortabel') {
  await page.addInitScript((d) => localStorage.setItem('lifeline-hub.dichte', d), dichte);
}

const besetzung = (page: Page) =>
  page.getByRole('region', { name: 'Besetzung S1–S6', exact: true });

/** Die sechs Sachgebietszeilen: jede trägt ihre Werkzeug-Gruppe oder ihren Titel „S…". */
async function sachgebietsTitel(page: Page): Promise<Locator> {
  const titel = besetzung(page).getByRole('heading', { level: 3 });
  await expect(titel).toHaveCount(6);
  return titel;
}

/** Wurzel eines Listeneintrags (`ListenEintrag`) und sein Inhaltsblock, vom Titel aus. */
function eintragVon(titel: Locator) {
  const wurzel = titel.locator('xpath=ancestor::li[1]/*[1]');
  return { wurzel, inhalt: wurzel.locator('xpath=./*[1]') };
}

async function kasten(ziel: Locator, was: string) {
  const b = await ziel.boundingBox();
  expect(b, `${was}: Kasten`).not.toBeNull();
  return b!;
}

/** Jede Sachgebietszeile: der Inhalt nimmt ≥ 90 % der Eintragsbreite ein. */
async function inhaltFuelltZeilen(page: Page, rolle: string) {
  const titel = await sachgebietsTitel(page);
  for (let i = 0; i < 6; i++) {
    const name = (await titel.nth(i).textContent())?.trim() ?? `Zeile ${i}`;
    const { wurzel, inhalt } = eintragVon(titel.nth(i));
    const w = await kasten(wurzel, name);
    const c = await kasten(inhalt, name);
    expect(
      c.width,
      `${rolle}, ${name}: Inhalt ${c.width.toFixed(1)} von ${w.width.toFixed(1)} px`,
    ).toBeGreaterThanOrEqual(w.width * INHALT_ANTEIL);
  }
}

/** Die Wertzeile der Sichtung in der Vorbereitung, erst wenn sie Daten trägt. */
async function sichtungWert(page: Page): Promise<Locator> {
  const wert = page.locator(
    '[data-lfh="vorbereitung-zeile"][data-schluessel="sichtung"] [data-teil="wert"]',
  );
  await expect(wert).toContainText(/ohne\s+Sichtung\s+\d/);
  return wert;
}

/**
 * Zahl der Zeilen der ganzen Wertzeile und je Teil samt folgendem „ ·": verschiedene Oberkanten
 * der Zeilenkästen eines `Range` über den Textknoten.
 */
async function zeilenJeTeil(wert: Locator) {
  return wert.evaluate((el) => {
    const text = el.firstChild;
    if (!(text instanceof Text)) throw new Error('Wertzeile ist kein einzelner Textknoten');
    const zeilen = (start: number, ende: number) => {
      const r = document.createRange();
      r.setStart(text, start);
      r.setEnd(text, ende);
      return new Set(
        [...r.getClientRects()].filter((k) => k.width > 0).map((k) => Math.round(k.top)),
      ).size;
    };
    const inhalt = text.data;
    const trenner = '\u00a0· ';
    const teile: { teil: string; zeilen: number }[] = [];
    let pos = 0;
    const stuecke = inhalt.split(trenner);
    for (const [i, teil] of stuecke.entries()) {
      // Gemessen mit dem folgenden „ ·": auch der Punkt steht nie am Anfang einer Zeile.
      const ende = pos + teil.length + (i < stuecke.length - 1 ? 2 : 0);
      teile.push({ teil, zeilen: zeilen(pos, ende) });
      pos += teil.length + trenner.length;
    }
    return { gesamt: zeilen(0, inhalt.length), teile };
  });
}

async function sichtungBrichtNurAmTrenner(page: Page, was: string) {
  const wert = await sichtungWert(page);
  // Die Umbrüche hängen an der Schriftbreite: erst messen, wenn die Webfonts stehen.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const m = await zeilenJeTeil(wert);
  expect(
    m.gesamt,
    `${was}: Vorbedingung, die Sichtung bricht um ${JSON.stringify(m)}`,
  ).toBeGreaterThan(1);
  for (const { teil, zeilen } of m.teile) {
    expect(zeilen, `${was}: „${teil}" auf ${zeilen} Zeilen ${JSON.stringify(m)}`).toBe(1);
  }
}

test.describe('Stab am Handschirm (LFH-978)', () => {
  test('Admin, 390 px: „Besetzung ändern" unter dem Inhalt, Sichtung bricht nur am Trenner', async ({
    page,
  }) => {
    await page.setViewportSize(HANDSCHIRM);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await page.goto(`/einsaetze/${einsatzId}/stab`);

    const knoepfe = besetzung(page).getByRole('button', { name: /^Besetzung ändern – / });
    await expect(knoepfe).toHaveCount(6);
    const titel = await sachgebietsTitel(page);
    for (let i = 0; i < 6; i++) {
      const name = (await titel.nth(i).textContent())?.trim() ?? `Zeile ${i}`;
      const { inhalt } = eintragVon(titel.nth(i));
      const c = await kasten(inhalt, name);
      const k = await kasten(knoepfe.nth(i), name);
      expect(k.y, `${name}: Knopf unter dem Inhalt`).toBeGreaterThanOrEqual(
        c.y + c.height - SUBPIXEL,
      );
      expect(Math.abs(k.x - c.x), `${name}: Knopf linksbündig mit dem Inhalt`).toBeLessThan(1);
    }
    await inhaltFuelltZeilen(page, 'Admin');
    await sichtungBrichtNurAmTrenner(page, 'Admin, 390 px');

    const hoehe = await page.evaluate(() => document.scrollingElement!.scrollHeight);
    await test.info().attach('scrollHeight.json', {
      body: JSON.stringify({ breite: HANDSCHIRM.width, scrollHeight: hoehe }),
      contentType: 'application/json',
    });
  });

  test('Beobachter, 390 px: ohne Knopf füllt der Inhalt die Zeile, Sichtung wie beim Admin', async ({
    page,
  }) => {
    await page.setViewportSize(HANDSCHIRM);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await page.goto(`/einsaetze/${einsatzId}/stab`);

    await sachgebietsTitel(page);
    await expect(
      besetzung(page).getByRole('button', { name: /^Besetzung ändern/ }),
      'Vorbedingung: ohne Schreibrecht kein „Besetzung ändern"',
    ).toHaveCount(0);
    await inhaltFuelltZeilen(page, 'Beobachter');
    await sichtungBrichtNurAmTrenner(page, 'Beobachter, 390 px');
  });

  /**
   * Das Führungs-Tablet läuft in `komfortabel` (frontend/AGENTS.md, Bedien-Leitlinie). Dort riss
   * die Zeile ohne Betroffene vorher in „… ohne" / „Sichtung 0" (gemessen bei 820 px; in
   * `kompakt` passte sie in eine Zeile).
   */
  test('Tablet hoch, 820 px: Sichtung bricht nur am Trenner', async ({ page }) => {
    await page.setViewportSize(TABLET_HOCH);
    await stelleDichte(page, 'komfortabel');
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, []);
    await page.goto(`/einsaetze/${einsatzId}/stab`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'komfortabel');
    await sichtungBrichtNurAmTrenner(page, 'Admin, 820 px, komfortabel');
  });
});

test.describe('Informationstelefon am Handschirm (LFH-978)', () => {
  for (const modus of ['light', 'dark'] as const) {
    test(`Notizfeld trägt einen Rahmen wie das Anliegen — ${modus}`, async ({ page }) => {
      await page.setViewportSize(HANDSCHIRM);
      await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
      await anmeldenAlsAdmin(page);
      const einsatzId = await einsatzAnlegen(page, []);
      await page.goto(`/einsaetze/${einsatzId}/stab/infotelefon`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

      const zeile = page.locator('.lfh-schnellerfassung');
      const notiz = zeile.getByRole('textbox', { name: 'Notiz', exact: true });
      await expect(notiz).toBeVisible();
      // Den Rand zeichnet die Hülle des Feldes (der Zähler steht als Suffix darin).
      const traeger = zeile
        .locator('.ant-input-affix-wrapper')
        .filter({ has: page.getByRole('textbox', { name: 'Notiz', exact: true }) });
      await expect(traeger).toHaveCount(1);
      const anliegen = zeile.locator('.ant-select').filter({
        has: page.getByRole('combobox', { name: 'Anliegen' }),
      });
      await expect(anliegen).toHaveCount(1);

      await page.mouse.move(0, 0);
      await notiz.evaluate((el) => (el as HTMLElement).blur());
      await expect(async () => {
        const n = await randKontrast(traeger, 'top');
        const a = await randKontrast(anliegen, 'top');
        const name = `${modus}: Notiz ${JSON.stringify(n)} · Anliegen ${JSON.stringify(a)}`;
        expect(n.rand, `${name}: Randfarbe wie das Anliegen`).toEqual(a.rand);
        expect(n.gegenAussen, name).toBeGreaterThanOrEqual(RANDBODEN);
      }).toPass({ timeout: 10_000 });
    });
  }

  test('Gegenprobe: das Feld des ETB bleibt rahmenlos', async ({ page }) => {
    await page.setViewportSize(FUEKW);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, []);
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    const feld = page.locator('.lfh-schnellerfassung .lfh-schnellerfassung__feld textarea');
    await expect(feld).toBeVisible();
    await expect(feld).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  });
});
