import { expect, test, type Locator, type Page } from '@playwright/test';
import { randKontrast } from './kontrast-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Stab, Lagebesprechung und Informationstelefon am Handschirm (LFH-978).
 *
 * - **Kacheln (U67, LLH-1124):** bei 390 px stehen die sechs Kacheln S1–S6 untereinander, jede
 *   nimmt ≥ 90 % der Inhaltsbreite ein, und die Seite läuft nicht waagerecht über. „Besetzung
 *   ändern“ steht im Kopf der Kachel, nicht neben ihrem Inhalt. Vorher (Liste) quetschte der Knopf
 *   rechts die Beschreibung auf rund 190 px.
 * - **Sichtung (U69):** die Wertzeile der Vorbereitung bricht bei 390 und 820 px nur an „ · "
 *   um. Die Vorbereitung steht seit LLH-1111 auf der Seite Lagebesprechung, nicht mehr im Stab. Gemessen je Teil über die Zeilenkästen eines `Range`: ein Teil auf zwei Zeilen hat zwei
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

/** Die sechs Kacheln S1–S6 (LLH-1124): je ein Paneel, benannt nach Kennung und Label. */
async function kacheln(page: Page): Promise<Locator> {
  const k = page.getByRole('region', { name: /^S\d · / });
  await expect(k).toHaveCount(6);
  return k;
}

async function kasten(ziel: Locator, was: string) {
  const b = await ziel.boundingBox();
  expect(b, `${was}: Kasten`).not.toBeNull();
  return b!;
}

/**
 * Jede Kachel: untereinander (eine Spalte), ≥ 90 % der Breite des Rasters, und die Seite läuft
 * nicht waagerecht über.
 */
async function kachelnFuellenDieSpalte(page: Page, rolle: string) {
  const k = await kacheln(page);
  const raster = await kasten(k.first().locator('xpath=..'), `${rolle}: Raster`);
  let obenVorher = -Infinity;
  for (let i = 0; i < 6; i++) {
    const name = `${rolle}, Kachel ${i + 1}`;
    const b = await kasten(k.nth(i), name);
    expect(
      b.width,
      `${name}: ${b.width.toFixed(1)} von ${raster.width.toFixed(1)} px`,
    ).toBeGreaterThanOrEqual(raster.width * INHALT_ANTEIL);
    expect(b.y, `${name}: unter der vorigen`).toBeGreaterThan(obenVorher);
    obenVorher = b.y;
  }
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement!.scrollWidth,
    clientWidth: document.scrollingElement!.clientWidth,
  }));
  expect(scrollWidth, `${rolle}: kein waagerechter Überlauf`).toBeLessThanOrEqual(
    clientWidth + SUBPIXEL,
  );
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
    // Trenner mit beliebigem Leerzeichen vor dem Punkt: so zeigt auch ein Rückfall auf normale
    // Leerzeichen, WELCHER Teil reißt.
    const teile: { teil: string; zeilen: number }[] = [];
    let pos = 0;
    for (const t of [...inhalt.matchAll(/[ \u00a0]· /g), null]) {
      const teilEnde = t ? t.index : inhalt.length;
      // Gemessen mit dem folgenden „ ·": auch der Punkt steht nie am Anfang einer Zeile.
      teile.push({
        teil: inhalt.slice(pos, teilEnde),
        zeilen: zeilen(pos, t ? teilEnde + 2 : teilEnde),
      });
      pos = teilEnde + 3;
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

test.describe('Stab und Lagebesprechung am Handschirm (LFH-978)', () => {
  test('Admin, 390 px: Kacheln untereinander ohne Überlauf, Sichtung der Lagebesprechung bricht nur am Trenner', async ({
    page,
  }) => {
    await page.setViewportSize(HANDSCHIRM);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    // Eine lange Besetzung: sie bricht in der Kachel um, statt abgeschnitten zu werden (Review
    // LLH-1124, design.md D1).
    const lang = 'Integrierte Leitstelle Musterstadt (rückwärtige Führungsunterstützung)';
    const besetzt = await page.request.put(`/api/einsaetze/${einsatzId}/stab/besetzung/s6`, {
      data: { besetzung_art: 'rueckwaertig', bezeichnung: lang },
    });
    expect(besetzt.ok(), `Besetzung: ${besetzt.status()}`).toBe(true);
    await page.goto(`/einsaetze/${einsatzId}/stab`);
    const s6 = page.getByRole('region', { name: /^S6 · / });
    const chip = s6.getByText(lang, { exact: false });
    await expect(chip).toBeVisible();
    const kb = await kasten(s6, 'Kachel S6');
    const cb = await kasten(chip, 'Chip S6');
    expect(cb.x + cb.width, 'Chip S6 in der Kachel').toBeLessThanOrEqual(
      kb.x + kb.width + SUBPIXEL,
    );
    expect(
      await chip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      'Chip S6 nicht abgeschnitten',
    ).toBe(true);

    const k = await kacheln(page);
    // „Besetzung ändern“ steht im Kopf jeder Kachel, innerhalb ihrer Breite.
    for (let i = 0; i < 6; i++) {
      const knopf = k.nth(i).getByRole('button', { name: /^Besetzung ändern – / });
      await expect(knopf).toHaveCount(1);
      const b = await kasten(k.nth(i), `Kachel ${i + 1}`);
      const kb = await kasten(knopf, `Knopf ${i + 1}`);
      expect(kb.x + kb.width, `Kachel ${i + 1}: Knopf in der Kachel`).toBeLessThanOrEqual(
        b.x + b.width + SUBPIXEL,
      );
    }
    await kachelnFuellenDieSpalte(page, 'Admin');

    const hoehe = await page.evaluate(() => document.scrollingElement!.scrollHeight);
    await test.info().attach('scrollHeight.json', {
      body: JSON.stringify({ breite: HANDSCHIRM.width, scrollHeight: hoehe }),
      contentType: 'application/json',
    });

    await page.goto(`/einsaetze/${einsatzId}/lagebesprechung`);
    await sichtungBrichtNurAmTrenner(page, 'Admin, 390 px');
  });

  test('Beobachter, 390 px: ohne Knopf füllen die Kacheln die Spalte, Sichtung wie beim Admin', async ({
    page,
  }) => {
    await page.setViewportSize(HANDSCHIRM);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await page.goto(`/einsaetze/${einsatzId}/stab`);

    await kacheln(page);
    await expect(
      page.getByRole('button', { name: /^Besetzung ändern/ }),
      'Vorbedingung: ohne Schreibrecht kein „Besetzung ändern"',
    ).toHaveCount(0);
    await kachelnFuellenDieSpalte(page, 'Beobachter');
    await page.goto(`/einsaetze/${einsatzId}/lagebesprechung`);
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
    await page.goto(`/einsaetze/${einsatzId}/lagebesprechung`);
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
      // Unter `md` startet die Leiste eingeklappt (LFH-1067): der Fokus klappt sie auf, ein Text
      // hält sie offen, wenn der Fokus sie für die Messung verlässt.
      await zeile.getByRole('combobox', { name: 'Anliegen' }).focus();
      await notiz.fill('Keller');
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
