import { expect, test, type Locator, type Page } from '@playwright/test';
import { einsatzdatenPfad } from '../src/routing/deeplinks';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * LFH-964 — die Einsatzdaten passen am Handy (390 px) in den Bildschirm.
 *
 * Vor dem Fix maß die Seite bei 390 px `scrollWidth 436 / innerWidth 436`: der Layout-Viewport
 * war aufgeweitet, der Browser stellte verkleinert dar. Ursachen waren das Zweispalten-Raster
 * der Angaben, das unter `md` nicht stapelte, und die „… eintragen“-Knöpfe ohne Umbruch. Die
 * Zugriffstabelle, die damals mitmaß, liegt seit LFH-1170 in den Einstellungen
 * (`einstellungen-schmal.spec.ts`).
 *
 * WARUM GEGEN 390 UND NICHT GEGEN `innerWidth`: Mit `<meta viewport>` weitet der Browser bei
 * Überlauf den Layout-Viewport auf; `innerWidth` wächst mit, und `scrollWidth <= innerWidth`
 * wäre grün, während die Seite verkleinert erscheint. Gemessen wird deshalb gegen die feste
 * Gerätebreite, dazu die rechte Kante jedes Knopfs und des Paneelrahmens.
 *
 * ROLLEN (LFH-435): als Admin (mit „… eintragen“ und dem Auslöser „Weitere“) und als
 * Führungspersonal. Die Vorbedingung des Rollenzweigs steht vor der Messung.
 */

const BREITE = 390;

async function einsatzAnlegen(page: Page): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Einsatzdaten schmal ${Date.now()}` },
  });
  expect(r.ok(), `Einsatz anlegen: ${r.status()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

/** Kein Querlauf: Dokument und alle übergebenen Kästen enden bei 390 px. */
async function keinQuerlauf(page: Page, kaesten: Locator[], wo: string) {
  const breite = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(breite, `${wo}: documentElement.scrollWidth`).toBeLessThanOrEqual(BREITE);
  for (const k of kaesten) {
    const b = await k.boundingBox();
    expect(b, `${wo}: ohne Kasten`).not.toBeNull();
    expect(b!.x + b!.width, `${wo}: rechte Kante`).toBeLessThanOrEqual(BREITE);
  }
}

const paneel = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const PANEELE = ['Einsatz', 'Einsatzort', 'Erstmeldung', 'Eigene Führungsstelle'];

/**
 * Unter `md` steht das Etikett ÜBER dem Wert, nicht daneben. Gemessen an der Leitstellen-Nr., die
 * ein neuer Einsatz leer trägt; die Zeile „Nächste Lagebesprechung“ ist entfallen (LLH-1111).
 */
async function gestapelt(page: Page) {
  const einsatz = paneel(page, 'Einsatz');
  const etikett = einsatz.locator('dt', { hasText: 'Leitstellen-Nr.' });
  const knopf = einsatz.getByRole('button', { name: 'Leitstellen-Nr. eintragen' });
  const [e, k] = [(await etikett.boundingBox())!, (await knopf.boundingBox())!];
  expect(k.y, 'Wert unter dem Etikett').toBeGreaterThanOrEqual(e.y + e.height - 1);
}

/** Die Paneele stehen untereinander (eine Spalte unter `xl`). */
async function untereinander(page: Page) {
  const kaesten = await Promise.all(PANEELE.map((n) => paneel(page, n).boundingBox()));
  for (let i = 1; i < kaesten.length; i++) {
    expect(kaesten[i]!.y, `${PANEELE[i]} unter ${PANEELE[i - 1]}`).toBeGreaterThanOrEqual(
      kaesten[i - 1]!.y + kaesten[i - 1]!.height - 1,
    );
  }
}

test.describe('LFH-964 Einsatzdaten am Handy', () => {
  test.use({ viewport: { width: BREITE, height: 844 } });

  test('Admin: Paneele stapeln, „eintragen“ bricht um, die Nebenwege stehen hinter „Weitere“', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page);
    await page.goto(einsatzdatenPfad(id));

    // Ansicht: die leeren Angaben tragen ihre „… eintragen“-Knöpfe.
    const eintragen = page.locator('main').getByRole('button', { name: /eintragen$/ });
    await expect(eintragen.first()).toBeVisible();
    await gestapelt(page);
    await untereinander(page);
    await keinQuerlauf(
      page,
      [...PANEELE.map((n) => paneel(page, n)), ...(await eintragen.all())],
      'Ansicht',
    );

    // Die Nebenwege (Einsatzbericht, Zugriff) liegen unter `md` hinter EINEM Auslöser.
    const weitere = page.getByRole('button', { name: 'Weitere Aktionen zu den Einsatzdaten' });
    await expect(weitere).toBeVisible();
    await keinQuerlauf(page, [weitere], 'Kopf');
  });

  test('Führungspersonal: die Seite läuft ebenso nicht über', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page);
    await wechsleZuRolle(page, 'fuehrungspersonal', String(id));
    await page.goto(einsatzdatenPfad(id));

    // Vorbedingung des Rollenzweigs: Führungspersonal bearbeitet die Angaben.
    await expect(
      paneel(page, 'Erstmeldung')
        .getByRole('button', { name: /eintragen$/ })
        .first(),
    ).toBeVisible();
    await gestapelt(page);
    await keinQuerlauf(
      page,
      [
        ...PANEELE.map((n) => paneel(page, n)),
        ...(await page
          .locator('main')
          .getByRole('button', { name: /eintragen$/ })
          .all()),
      ],
      'Führungspersonal',
    );
  });
});
