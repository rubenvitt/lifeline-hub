import { expect, test, type Page } from '@playwright/test';
import {
  api,
  einsatzAnlegen,
  element,
  oeffneSkizze,
  seedeGrund,
  type Grundnetz,
} from './fernmeldeskizze-kern';
import { svgTextKontrast } from './kontrast-kern';
import { pdfAuszug } from './pdf-kern';
import { ADMIN, ADMIN_PW, anmeldenAls } from './rollen-kern';

/**
 * Druck der Fernmeldeskizze (LFH-893 Aufgabe 4.3, Spec „Druck als eigenes Druckstück“): was nur
 * der Browser zeigt. Chromium, Firefox und WebKit prüfen die Mechanik unter Druckmedium
 * (`DRUCK_SPECS`); das PDF (Seitenformat, Umbruch vor der Anlage, ganze Skizze auf Seite 1) gibt
 * es nur in Chromium (`page.pdf()`), der Bericht trägt dafür die Annotation `nur-chromium`.
 *
 * - FORMAT: A3 quer (Vorgabe) und A4 quer über die benannte `@page` des Skizzenblatts; die Anlage
 *   „Funkplan“ beginnt auf einer neuen Seite. Mit gesetztem Filter „Nur Lücken“ gedruckt: im Druck
 *   ist nichts zurückgenommen, keine Bedienung steht da, nichts ragt aus dem Blatt.
 * - GRAUSTUFEN: unter `filter: grayscale(1)` zeigt das Bildschirmfoto die geplante Verbindung
 *   gestrichelt (Wechsel von Strich und Lücke entlang der Linie), die bestehende durchgezogen,
 *   und das Wort „geplant“ steht mit Textkontrast da.
 *
 * Mutationsproben: `page: fernmeldeskizze-a3` in `skizzeDruck.css` weg → Seite 1 ist A4 hoch,
 * rot; `STRICHMUSTER_GEPLANT` weg → keine Wechsel entlang der Linie, rot.
 */

const FUEKW = { width: 1366, height: 768 };
const SUBPIXEL = 0.5;
const MM = 96 / 25.4;
/** Seitenmaße in Punkt, ± 2 pt Rundung von Chromium. */
const A3_QUER = { breite: 1190.55, hoehe: 841.89 };
const A4_QUER = { breite: 841.89, hoehe: 595.28 };

interface Druckseed extends Grundnetz {
  geplant: number;
  bestehend: number;
}

/** Grundnetz, Leitstelle und Polizei an „TMO SL AS“, eine geplante und eine bestehende Verbindung. */
async function seedeDruck(page: Page, einsatzId: string): Promise<Druckseed> {
  const n = await seedeGrund(page, einsatzId);
  const a = api(page, einsatzId);
  const slAs = (await a.post('sprechgruppen', { bezeichnung: 'SL AS', betriebsart: 'TMO' })).id;
  const stelle = async (stellenart: string, bezeichnung: string) => {
    const plan = await a.post<{ id: number; bezeichnung: string }[]>(
      'stab/kommunikationsplan/stellen',
      { stellenart, bezeichnung },
    );
    return plan.find((s) => s.bezeichnung === bezeichnung)!.id;
  };
  const ils = await stelle('leitstelle', 'ILS Musterhausen');
  const polizei = await stelle('behoerde', 'Polizei');
  await a.put(`stab/kommunikationsplan/stellen/${ils}/sprechgruppen/${slAs}`, {
    status: 'bestehend',
  });
  await a.put(`stab/kommunikationsplan/stellen/${polizei}/sprechgruppen/${slAs}`, {
    status: 'geplant',
  });
  const verbindung = async (von: unknown, nach: unknown, art: string, status: string) =>
    (
      await a.post('stab/fernmeldeskizze/verbindungen', {
        von,
        nach,
        art,
        medium: 'leitung',
        status,
      })
    ).id;
  const geplant = await verbindung(
    { art: 'fuehrungsstelle', id: null },
    { art: 'stelle', id: ils },
    'daten',
    'geplant',
  );
  const bestehend = await verbindung(
    { art: 'abschnitt', id: n.ea[2] },
    { art: 'stelle', id: polizei },
    'telefon',
    'bestehend',
  );
  return { ...n, geplant, bestehend };
}

/** Druck wie die Person: „Drucken / als PDF“ löst `beforeprint` aus (`emulateMedia` feuert es nicht). */
async function drucke(page: Page) {
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-lfh="druck-anlage"]')).toBeVisible();
}

function erzeugtPdf(page: Page): boolean {
  return page.context().browser()?.browserType().name() === 'chromium';
}

function nurChromium(was: string) {
  test.info().annotations.push({ type: 'nur-chromium', description: was });
}

async function vorbereiten(page: Page, format: 'A3 quer' | 'A4 quer') {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Druck ${format} ${Date.now()}`);
  const n = await seedeDruck(page, einsatzId);
  await oeffneSkizze(page, einsatzId, element(page, `vb-${n.geplant}`));
  // Spec-Szenario: mit gesetztem Filter „Nur Lücken“ gedruckt.
  await page
    .getByRole('radiogroup', { name: 'Ebenen' })
    .getByRole('radio', { name: 'Nur Lücken' })
    .click();
  await expect(element(page, `vb-${n.geplant}`), 'Vorbedingung: Filter greift').toHaveAttribute(
    'data-zurueck',
    'true',
  );
  const papier = page.getByRole('radiogroup', { name: 'Papierformat' });
  await papier.getByRole('radio', { name: format }).click();
  await expect(papier.getByRole('radio', { name: format })).toBeChecked();
  return { einsatzId, n };
}

for (const fall of [
  { format: 'A3 quer', klasse: 'lfh-skizze-druck-a3', mass: A3_QUER, svgMaxMm: 205 },
  { format: 'A4 quer', klasse: 'lfh-skizze-druck-a4', mass: A4_QUER, svgMaxMm: 120 },
] as const) {
  test(`Druck ${fall.format}: ganze Skizze auf Seite 1 ohne Filter und Bedienung, Anlage ab neuer Seite, nichts ragt heraus`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { n } = await vorbereiten(page, fall.format);
    await drucke(page);

    const lage = await page.evaluate(() => {
      const blatt = document.querySelector('[data-lfh="funkplan-blatt"]')!;
      const wurzel = document.querySelector('.funkplan-print-root')!.getBoundingClientRect();
      const svg = blatt.querySelector('[data-lfh="skizze-flaeche"] svg')!;
      const s = svg.getBoundingClientRect();
      const teile = Array.from(svg.querySelectorAll('g[data-key]')).map((g) =>
        g.getBoundingClientRect(),
      );
      const anlage = document.querySelector('[data-lfh="druck-anlage"]')!;
      const sichtbar = (sel: string) =>
        Array.from(document.querySelectorAll(sel)).some((e) => e.getClientRects().length > 0);
      return {
        klasse: blatt.className,
        zurueck: svg.querySelectorAll('[opacity]').length,
        bedienung: sichtbar('.lfh-skizze-bedienung') || sichtbar('[data-lfh="skizze-paneel"]'),
        svg: { links: s.left, rechts: s.right, oben: s.top, unten: s.bottom, hoehe: s.height },
        wurzelRechts: wurzel.right,
        teileAusserhalb: teile.filter(
          (r) =>
            r.width > 0 &&
            (r.left < s.left - 0.5 ||
              r.right > s.right + 0.5 ||
              r.top < s.top - 0.5 ||
              r.bottom > s.bottom + 0.5),
        ).length,
        teile: teile.length,
        umbruch: getComputedStyle(anlage).breakBefore,
        kopf: blatt.querySelector('[data-lfh="druckkopf"]')?.textContent ?? '',
        anlageTitel: anlage.querySelector('h2')?.textContent ?? '',
      };
    });
    test.info().annotations.push({
      type: 'messwert',
      description: `${fall.format}: Skizze ${Math.round(lage.svg.rechts - lage.svg.links)}×${Math.round(lage.svg.hoehe)} px, ${lage.teile} Elemente`,
    });
    expect(lage.klasse, 'Klasse des Papierformats am Blatt').toContain(fall.klasse);
    expect(lage.kopf, 'Druckkopf „Fernmeldeskizze“').toContain('Fernmeldeskizze');
    expect(lage.zurueck, 'im Druck ist nichts zurückgenommen (kein Filter)').toBe(0);
    expect(lage.bedienung, 'keine Bedienung im Druck').toBe(false);
    expect(lage.teileAusserhalb, 'jedes Element liegt in der Skizze').toBe(0);
    expect(lage.svg.rechts, 'die Skizze ragt nicht aus der Druckwurzel').toBeLessThanOrEqual(
      lage.wurzelRechts + SUBPIXEL,
    );
    expect(lage.svg.hoehe, `Skizze höchstens ${fall.svgMaxMm} mm hoch`).toBeLessThanOrEqual(
      fall.svgMaxMm * MM + SUBPIXEL,
    );
    expect(lage.umbruch, 'Anlage ab neuer Seite').toBe('page');
    expect(lage.anlageTitel).toBe('Anlage: Funkplan');
    await expect(
      page.locator(
        `[data-lfh="skizze-flaeche"] g[data-key="vb-${n.geplant}"] [data-teil="geplant"]`,
      ),
    ).toHaveText('geplant');

    if (!erzeugtPdf(page)) {
      nurChromium(`${fall.format}: Seitenformat, Umbruch und ganze Skizze im PDF`);
      await page.emulateMedia({ media: null });
      return;
    }
    const auszug = await pdfAuszug(
      await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true }),
    );
    const [erste, ...rest] = auszug;
    test.info().annotations.push({
      type: 'messwert',
      description: `${fall.format}: ${auszug.length} Seiten, ${auszug.map((s) => `${Math.round(s.breite)}×${Math.round(s.hoehe)} pt`).join(', ')}`,
    });
    expect(Math.abs(erste.breite - fall.mass.breite), `Seite 1 ist ${fall.format}`).toBeLessThan(2);
    expect(Math.abs(erste.hoehe - fall.mass.hoehe), `Seite 1 ist ${fall.format}`).toBeLessThan(2);
    for (const wort of [
      'Fernmeldeskizze',
      'Taktische Fernmeldeskizze',
      'ILS Musterhausen',
      '1. Zug',
      'geplant',
    ]) {
      expect(erste.text, `Seite 1 trägt „${wort}“`).toContain(wort);
    }
    expect(erste.text, 'die Anlage steht nicht auf Seite 1').not.toContain('Anlage: Funkplan');
    // Die Lücken folgen der Skizze im Blatt (quer), die Anlage beginnt eine eigene Seite.
    const anlage = rest.findIndex((s) => s.text.includes('Anlage: Funkplan'));
    expect(anlage, 'die Anlage folgt').toBeGreaterThanOrEqual(0);
    expect(rest[anlage].text, 'die Anlage beginnt ihre Seite').toMatch(
      /^Seite \d+ von \d+ Anlage: Funkplan/,
    );
    expect(
      [erste, ...rest.slice(0, anlage)].map((s) => s.text).join(' '),
      'die Lücken stehen vor der Anlage',
    ).toContain('Sprechgruppen mit nur einem Teilnehmer');
    await page.emulateMedia({ media: null });
  });
}

test.describe('Graustufen', () => {
  // Doppelte Auflösung: die Linie ist im Druckmaßstab knapp ein Pixel breit.
  test.use({ deviceScaleFactor: 2 });

  test('Graustufen: geplant gestrichelt mit dem Wort, bestehend durchgezogen', async ({ page }) => {
    test.setTimeout(90_000);
    const { n } = await vorbereiten(page, 'A3 quer');
    await drucke(page);
    await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' });

    // Entlang jeder Linie: Endpunkte am Bildschirm (ohne Stellenzeichen an den Enden und ohne
    // die Artmarke in der Mitte), dann je Pixel die Helligkeit im Graustufenfoto.
    const strecken = await page.evaluate(
      (keys) =>
        keys.map((key) => {
          const linie = document.querySelector(
            `[data-lfh="skizze-flaeche"] g[data-key="${key}"] [data-teil="linie"]`,
          ) as SVGLineElement;
          const m = linie.getScreenCTM()!;
          const punkt = (x: number, y: number) => {
            const p = new DOMPoint(x, y).matrixTransform(m);
            return { x: p.x, y: p.y };
          };
          const a = punkt(linie.x1.baseVal.value, linie.y1.baseVal.value);
          const b = punkt(linie.x2.baseVal.value, linie.y2.baseVal.value);
          return { key, a, b };
        }),
      [`vb-${n.geplant}`, `vb-${n.bestehend}`],
    );
    const foto = (await page.screenshot({ fullPage: true })).toString('base64');
    const profile = await page.evaluate(
      async ({ foto, strecken }) => {
        const bild = new Image();
        bild.src = `data:image/png;base64,${foto}`;
        await bild.decode();
        const leinwand = document.createElement('canvas');
        leinwand.width = bild.naturalWidth;
        leinwand.height = bild.naturalHeight;
        const ctx = leinwand.getContext('2d')!;
        ctx.drawImage(bild, 0, 0);
        const faktor = bild.naturalWidth / document.documentElement.scrollWidth;
        const sx = window.scrollX;
        const sy = window.scrollY;
        return strecken.map(({ key, a, b }) => {
          const laenge = Math.hypot(b.x - a.x, b.y - a.y);
          const schritte = Math.floor(laenge * faktor);
          const werte: number[] = [];
          // 20 % bis 40 % der Strecke: weg vom Stellenzeichen, vor der Artmarke in der Mitte.
          for (let i = Math.floor(schritte * 0.2); i < schritte * 0.4; i++) {
            const t = i / schritte;
            const x = Math.round((a.x + sx + (b.x - a.x) * t) * faktor);
            const y = Math.round((a.y + sy + (b.y - a.y) * t) * faktor);
            // Dunkelster Wert quer zur Linie (± 2 px), damit Kantenglättung nicht täuscht.
            let dunkel = 255;
            for (let d = -2; d <= 2; d++) {
              const px = ctx.getImageData(x, y + d, 1, 1).data;
              const r = px[0];
              const g = px[1];
              const bl = px[2];
              if (Math.abs(r - g) > 2 || Math.abs(g - bl) > 2) throw new Error('nicht grau');
              dunkel = Math.min(dunkel, r);
            }
            werte.push(dunkel);
          }
          return { key, werte };
        });
      },
      { foto, strecken },
    );
    const wechsel = (werte: number[]) => {
      const min = Math.min(...werte);
      const max = Math.max(...werte);
      if (max - min < 60) return { wechsel: 0, min, max };
      const schwelle = (min + max) / 2;
      let n2 = 0;
      for (let i = 1; i < werte.length; i++) {
        if (werte[i - 1] < schwelle !== werte[i] < schwelle) n2 += 1;
      }
      return { wechsel: n2, min, max };
    };
    const [geplant, bestehend] = profile.map((p) => ({ key: p.key, ...wechsel(p.werte) }));
    test.info().annotations.push({
      type: 'messwert',
      description: `Graustufen: geplant ${geplant.wechsel} Wechsel (${geplant.min}–${geplant.max}), bestehend ${bestehend.wechsel} Wechsel (${bestehend.min}–${bestehend.max})`,
    });
    expect(
      geplant.wechsel,
      'geplant: Strich und Lücke wechseln entlang der Linie',
    ).toBeGreaterThanOrEqual(4);
    expect(geplant.min, 'geplant: der Strich ist dunkel').toBeLessThan(128);
    expect(bestehend.wechsel, 'bestehend: durchgezogen').toBe(0);
    expect(bestehend.max, 'bestehend: die Linie ist durchgehend dunkel').toBeLessThan(128);

    const wort = page.locator(
      `[data-lfh="skizze-flaeche"] g[data-key="vb-${n.geplant}"] [data-teil="geplant"]`,
    );
    await expect(wort).toHaveText('geplant');
    const k = await svgTextKontrast(wort);
    expect(k.verhaeltnis, 'das Wort „geplant“ ist lesbar').toBeGreaterThanOrEqual(4.5);
    await page.emulateMedia({ media: null });
  });
});
