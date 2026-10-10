import { expect, test, type Page } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';

/**
 * Druck der Hilfe (LFH-1096, Spec `anwenderdoku`): die Mappe einer Lesergruppe, ohne Anmeldung.
 * Chromium, Firefox und WebKit prüfen die Mechanik unter Druckmedium (`DRUCK_SPECS`).
 *
 * - Ohne Sitzung druckt der Knopf sofort (kein Organisationskopf).
 * - Auf Papier stehen nur Druckkopf und Kapitel; Kopf und Kapitelliste der Seite sind weg.
 * - Jedes weitere Kapitel beginnt auf einer neuen Seite, das erste nicht.
 *
 * - Bilder (LFH-1128) sind höchstens so breit wie der Satzspiegel und brechen nicht.
 *
 * Mutationsprobe: die Regel `druck-kapitel + druck-kapitel` in `druck/druck.css` entfernen → rot;
 * dort `img` aus der Umbruchliste `:is(p, ul, ol, …)` nehmen → rot.
 */

/**
 * Ein PNG, breiter als jede Seite (graue Fläche, ohne Bibliothek). Ersetzt im Test jedes Bild der
 * Hilfe: die echten Bildschirmfotos sind oft schmaler als der Satzspiegel und belegten die Grenze
 * nicht.
 */
function breitesPng(breite: number, hoehe: number): Buffer {
  const stueck = (typ: string, daten: Buffer) => {
    const kopf = Buffer.alloc(4);
    kopf.writeUInt32BE(daten.length);
    const name = Buffer.from(typ, 'ascii');
    const pruef = Buffer.alloc(4);
    pruef.writeUInt32BE(crc32(Buffer.concat([name, daten])));
    return Buffer.concat([kopf, name, daten, pruef]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 0; // Graustufen
  const zeile = Buffer.alloc(1 + breite, 0x99);
  zeile[0] = 0; // Filter „keiner“
  const roh = Buffer.concat(Array.from({ length: hoehe }, () => zeile));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    stueck('IHDR', ihdr),
    stueck('IDAT', deflateSync(roh)),
    stueck('IEND', Buffer.alloc(0)),
  ]);
}

const BREITES_BILD = breitesPng(3000, 400);

async function druckeStub(page: Page) {
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
}

test('Mappe der Gruppe „Alle“: nur Kapitel auf Papier, jedes weitere ab neuer Seite', async ({
  page,
}) => {
  await page.goto('/hilfe');
  const kapitel = page.locator('[data-lfh="druck-kapitel"]');
  await expect(kapitel.first()).toBeVisible();
  const anzahl = await kapitel.count();
  expect(anzahl, 'die Mappe hat mehr als ein Kapitel').toBeGreaterThan(1);

  await druckeStub(page);
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });

  const lage = await page.evaluate(() => {
    const anzeige = (sel: string) => getComputedStyle(document.querySelector(sel)!).display;
    const kapitel = Array.from(document.querySelectorAll('[data-lfh="druck-kapitel"]'));
    return {
      kopf: anzeige('.hilfe-kopf'),
      navi: anzeige('.hilfe-navi'),
      druckkopf: anzeige('.hilfe-druckkopf'),
      umbrueche: kapitel.map((k) => getComputedStyle(k).breakBefore),
    };
  });
  expect(lage.kopf, 'Seitenkopf im Druck aus').toBe('none');
  expect(lage.navi, 'Kapitelliste im Druck aus').toBe('none');
  expect(lage.druckkopf, 'Druckkopf im Druck da').not.toBe('none');
  expect(lage.umbrueche[0], 'erstes Kapitel ohne Umbruch').not.toBe('page');
  for (const [i, umbruch] of lage.umbrueche.slice(1).entries()) {
    expect(umbruch, `Kapitel ${i + 2} beginnt auf neuer Seite`).toBe('page');
  }
});

test('Bilder im Druck: höchstens Satzspiegelbreite, nie über einen Seitenumbruch', async ({
  page,
}) => {
  // Nur Bildabrufe: im Dev-Server ist `…png?url` zugleich ein Modul (`hilfe/bilder.ts`).
  await page.route(/\.png(\?.*)?$/, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ contentType: 'image/png', body: BREITES_BILD })
      : route.fallback(),
  );
  await page.goto('/hilfe/anmelden-abmelden');
  const bild = page.locator('[data-lfh="druckwurzel"] img.hilfe-bild').first();
  await bild.scrollIntoViewIfNeeded();
  await expect
    .poll(() => bild.evaluate((b: HTMLImageElement) => b.naturalWidth), {
      message: 'das breite Bild lädt nicht',
    })
    .toBe(3000);

  await druckeStub(page);
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });

  const lage = await bild.evaluate((b) => {
    const wurzel = b.closest('[data-lfh="druckwurzel"]')!;
    return {
      bild: b.getBoundingClientRect().width,
      wurzel: wurzel.getBoundingClientRect().width,
      bildBruch: getComputedStyle(b).breakInside,
      absatzBruch: getComputedStyle(b.parentElement!).breakInside,
    };
  });
  expect(lage.bild, 'Bild breiter als der Satzspiegel').toBeLessThanOrEqual(lage.wurzel);
  expect(lage.bild, 'Bild verschwunden').toBeGreaterThan(0);
  expect(lage.bildBruch, 'Bild bricht nicht').toBe('avoid');
  expect(lage.absatzBruch, 'Absatz um das Bild bricht nicht').toBe('avoid');
});
