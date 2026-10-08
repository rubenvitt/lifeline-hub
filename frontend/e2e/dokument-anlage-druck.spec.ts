import { expect, test, type Page } from '@playwright/test';
import { api, einsatzAnlegen, seedeGrund } from './fernmeldeskizze-kern';
import { pdfAuszug } from './pdf-kern';
import { ADMIN, ADMIN_PW, anmeldenAls } from './rollen-kern';

/**
 * Fernmeldeskizze als Bild-Anlage am Befehl (LFH-1028), was nur der Browser zeigt: die Skizze
 * wird im Browser zum PNG (Schriften, Farben, Maße), die Freigabe friert die Anlage ein, und der
 * Druck setzt sie hinter den Text auf ein eigenes Blatt A4 quer. Chromium, Firefox und WebKit
 * prüfen Aufnahme und Mechanik unter Druckmedium (`DRUCK_SPECS`); das PDF (Seitenformat, Bild auf
 * dem Anlagenblatt) gibt es nur in Chromium.
 *
 * Mutationsproben: `page: dokument-anlage` in `dokumentAnlagen.css` weg → das Anlagenblatt ist A4
 * hoch, rot; das Bild dort als `display: block` → Überschrift und Bild auf zwei Blättern, rot;
 * Grund der Aufnahme dunkel statt `farbenHell.flaeche` → Anteil heller Bildpunkte unter der
 * Schwelle, rot.
 */

const FUEKW = { width: 1366, height: 768 };
/** Seitenmaße in Punkt, ± 2 pt Rundung von Chromium. */
const A4_QUER = { breite: 841.89, hoehe: 595.28 };
const A4_HOCH = { breite: 595.28, hoehe: 841.89 };

async function befehlEntwurf(page: Page, einsatzId: string): Promise<number> {
  const a = api(page, einsatzId);
  const { id } = await a.post('befehle', { vorlage: 'befehl_lad', titel: 'Befehl mit Skizze' });
  await a.patch(`befehle/${id}`, {
    abschnitte: ['lage', 'auftrag', 'durchfuehrung'].map((schluessel) => ({
      schluessel,
      text: `Text ${schluessel}`,
    })),
  });
  return id;
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
}

test('Fernmeldeskizze als Anlage: Bild aus dem Browser, eingefroren mit der Freigabe, gedruckt auf eigenem Blatt A4 quer', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Anlage ${Date.now()}`);
  await seedeGrund(page, einsatzId);
  const befehlId = await befehlEntwurf(page, einsatzId);
  const pfad = `/einsaetze/${einsatzId}/auftraege/befehle/${befehlId}`;

  await page.goto(pfad);
  await page.getByRole('button', { name: 'Fernmeldeskizze anfügen' }).click();
  const anker = page.getByRole('link', { name: 'Anlage 1: Fernmeldeskizze herunterladen' });
  await expect(anker).toBeVisible({ timeout: 30_000 });
  // Die Aufnahme hängt nur für ihre Dauer im DOM.
  await expect(page.locator('[data-lfh="skizzen-aufnahme"]')).toHaveCount(0);

  // Das Bild: ein PNG in der längsten Kante 2400 px, Papiergrund mit gezeichneter Skizze.
  const bild = await page.evaluate(
    async (href) => {
      const antwort = await fetch(href);
      const blob = await antwort.blob();
      const b = await createImageBitmap(blob);
      const leinwand = new OffscreenCanvas(b.width, b.height);
      const k = leinwand.getContext('2d')!;
      k.drawImage(b, 0, 0);
      const { data } = k.getImageData(0, 0, b.width, b.height);
      let hell = 0;
      let dunkel = 0;
      for (let i = 0; i < data.length; i += 4) {
        const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (y > 240) hell++;
        else if (y < 80) dunkel++;
      }
      const n = data.length / 4;
      return {
        typ: blob.type,
        breite: b.width,
        hoehe: b.height,
        hell: hell / n,
        dunkel: dunkel / n,
      };
    },
    (await anker.getAttribute('href'))!,
  );
  test.info().annotations.push({
    type: 'messwert',
    description: `Bild ${bild.breite}×${bild.hoehe} px, hell ${(bild.hell * 100).toFixed(1)} %, dunkel ${(bild.dunkel * 100).toFixed(2)} %`,
  });
  expect(bild.typ).toBe('image/png');
  expect(Math.max(bild.breite, bild.hoehe), 'längste Kante').toBe(2400);
  expect(bild.hell, 'Papiergrund, auch im Nachtbetrieb').toBeGreaterThan(0.7);
  expect(bild.dunkel, 'die Skizze ist gezeichnet').toBeGreaterThan(0.002);

  // Freigeben friert die Anlage ein: kein Entfernen, kein Anfügen mehr.
  await api(page, einsatzId).post(`befehle/${befehlId}/freigeben`, {});
  await page.reload();
  await expect(anker).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Anlage 1: Fernmeldeskizze entfernen/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fernmeldeskizze anfügen' })).toHaveCount(0);

  await drucke(page);
  const blatt = page.locator('[data-lfh="druckwurzel"] [data-lfh="druck-anlage"]');
  await expect(blatt).toBeVisible();
  await expect(blatt.getByRole('heading', { level: 2 })).toHaveText(
    /^Anlage 1: Fernmeldeskizze, Stand \d{6}[A-Z]{3}\d{4}$/,
  );
  const lage = await blatt.evaluate((el) => {
    const img = el.querySelector('img')!;
    const r = img.getBoundingClientRect();
    const wurzel = document.querySelector('[data-lfh="druckwurzel"]')!.getBoundingClientRect();
    return {
      geladen: img.complete && img.naturalWidth > 0,
      umbruch: getComputedStyle(el).breakBefore,
      rechts: r.right,
      wurzelRechts: wurzel.right,
      paneel: Array.from(document.querySelectorAll('[data-lfh="dokument-anlage-zeile"]')).some(
        (z) => z.getClientRects().length > 0,
      ),
    };
  });
  expect(lage.geladen, 'das Bild ist zum Druck geladen').toBe(true);
  expect(lage.umbruch, 'Anlage ab neuer Seite').toBe('page');
  expect(lage.rechts, 'das Bild ragt nicht aus der Druckwurzel').toBeLessThanOrEqual(
    lage.wurzelRechts + 0.5,
  );
  expect(lage.paneel, 'das Paneel ist Bedienung, nicht Papier').toBe(false);

  if (page.context().browser()?.browserType().name() !== 'chromium') {
    test.info().annotations.push({
      type: 'nur-chromium',
      description: 'Seitenformat und Bild des Anlagenblatts im PDF',
    });
    await page.emulateMedia({ media: null });
    return;
  }
  const seiten = await pdfAuszug(
    await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true }),
  );
  test.info().annotations.push({
    type: 'messwert',
    description: seiten
      .map((s) => `${Math.round(s.breite)}×${Math.round(s.hoehe)} pt, ${s.bilder.length} Bilder`)
      .join(' · '),
  });
  const [erste] = seiten;
  expect(Math.abs(erste.breite - A4_HOCH.breite), 'der Befehl steht hoch').toBeLessThan(2);
  const anlage = seiten.findIndex((s) => s.text.includes('Anlage 1: Fernmeldeskizze'));
  expect(anlage, 'die Anlage hat ein eigenes Blatt').toBeGreaterThan(0);
  const s = seiten[anlage];
  expect(Math.abs(s.breite - A4_QUER.breite), 'das Anlagenblatt ist A4 quer').toBeLessThan(2);
  expect(Math.abs(s.hoehe - A4_QUER.hoehe), 'das Anlagenblatt ist A4 quer').toBeLessThan(2);
  expect(
    s.bilder.some((b) => Math.max(b.breite, b.hoehe) === 2400),
    'das Bild steht in voller Auflösung auf dem Anlagenblatt',
  ).toBe(true);
  expect(
    seiten
      .slice(0, anlage)
      .map((x) => x.text)
      .join(' '),
  ).toContain('Text durchfuehrung');
  await page.emulateMedia({ media: null });
});
