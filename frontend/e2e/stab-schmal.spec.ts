import { expect, test, type Locator, type Page } from '@playwright/test';
import { randKontrast } from './kontrast-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';
import { rechteHinweisSteht } from './trefflaeche-kern';

/**
 * Lagebesprechung und Informationstelefon am Handschirm (LFH-978). Die Kacheln der Stab-Seite
 * (U67) sind mit dem Modul Stab entfallen (i6k6mzed, design.md D1).
 *
 * - **Sichtung (U69):** die Wertzeile der Vorbereitung bricht bei 390 und 820 px nur an „ · "
 *   um. Die Vorbereitung steht seit LLH-1111 auf der Seite Lagebesprechung. Gemessen je Teil
 *   über die Zeilenkästen eines `Range`: ein Teil auf zwei Zeilen hat zwei
 *   verschiedene Oberkanten. Vorbedingung ist, dass die Zeile überhaupt umbricht, sonst wäre
 *   „kein Teil zerrissen" trivial wahr.
 * - **Notizfeld (U70):** im Informationstelefon trägt das Notizfeld bei 390 px einen sichtbaren
 *   Rahmen, in der Farbe des Anliegen-Selects und ≥ 3 : 1 gegen den Grund der Zeile (WCAG
 *   1.4.11, eingeschwungen über `randKontrast`). Gegenprobe: das eine Feld des ETB bleibt
 *   rahmenlos, dort trägt die Zeile den Rahmen.
 *
 * NICHT-PRIVILEGIERT (LFH-435): beim Beobachter steht der Rechte-Hinweis (Vorbedingung vor der
 * Messung); gemessen wird, dass die Sichtung ebenso nur am Trenner bricht.
 *
 * Kein `networkidle` (SSE-Strom), kein Device-Descriptor. Schranken als Literale.
 */

const HANDSCHIRM = { width: 390, height: 844 };
const TABLET_HOCH = { width: 820, height: 1180 };
const FUEKW = { width: 1366, height: 900 };

/** WCAG 1.4.11: Rand eines Steuerelements gegen den Grund. */
const RANDBODEN = 3;

/** Sichtungen der gesäten Betroffenen; „tot" und „unverletzt" erscheinen nur mit Zahl > 0. */
const LANG = ['sk3', 'tot', 'unverletzt'];

async function einsatzAnlegen(page: Page, sichtungen: readonly string[] = LANG): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E 978 Handschirm ${Date.now()}` },
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

test.describe('Lagebesprechung am Handschirm (LFH-978)', () => {
  test('Admin, 390 px: Sichtung der Lagebesprechung bricht nur am Trenner', async ({ page }) => {
    await page.setViewportSize(HANDSCHIRM);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await page.goto(`/einsaetze/${einsatzId}/lagebesprechung`);
    await sichtungBrichtNurAmTrenner(page, 'Admin, 390 px');
  });

  test('Beobachter, 390 px: Sichtung wie beim Admin', async ({ page }) => {
    await page.setViewportSize(HANDSCHIRM);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await page.goto(`/einsaetze/${einsatzId}/lagebesprechung`);
    // Vorbedingung des Rollenzweigs: der Rechte-Hinweis steht.
    await rechteHinweisSteht(page);
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
      await page.goto(`/einsaetze/${einsatzId}/infotelefon`);
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
