import { expect, test, type Locator, type Page } from '@playwright/test';
import { einsatzdatenPfad } from '../src/routing/deeplinks';
import {
  anmeldenAlsAdmin,
  benutzerAnlegen,
  mitgliedEintragen,
  wechsleZuRolle,
} from './rollen-kern';

/**
 * LFH-964 — die Einsatzdaten passen am Handy (390 px) in den Bildschirm.
 *
 * Vor dem Fix maß die Seite bei 390 px `scrollWidth 436 / innerWidth 436`: der Layout-Viewport
 * war aufgeweitet, der Browser stellte verkleinert dar. Ursachen waren das Zweispalten-Raster
 * der Lagedaten, das unter `md` nicht stapelte, die „… eintragen“-Knöpfe ohne Umbruch und die
 * Zugriffstabelle mit vier Spalten, deren Inhalt bis 606 px reichte.
 *
 * WARUM GEGEN 390 UND NICHT GEGEN `innerWidth`: Mit `<meta viewport>` weitet der Browser bei
 * Überlauf den Layout-Viewport auf; `innerWidth` wächst mit, und `scrollWidth <= innerWidth`
 * wäre grün, während die Seite verkleinert erscheint. Gemessen wird deshalb gegen die feste
 * Gerätebreite, dazu die rechte Kante jedes Knopfs und des Paneelrahmens.
 *
 * TABELLE: `document.scrollWidth` sieht einen Überlauf im Scrollcontainer der Tabelle nicht
 * (`frontend/AGENTS.md`, Fließende Spalte). Deshalb liegt „Entfernen“ der Zeile ohne Scrollen im
 * Viewport und wird ANGEKLICKT (LFH-355): die Rückfrage öffnet sich.
 *
 * ROLLEN (LFH-435): als Admin (Einsatzleitung, mit Aktion) und als Führungspersonal (Rolle
 * gesperrt, keine Aktion). Die Vorbedingung des Rollenzweigs steht vor der Messung.
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

const lagedaten = (page: Page) => page.getByRole('region', { name: 'Lagedaten' });

/** Unter `md` steht das Etikett ÜBER dem Wert, nicht daneben. */
async function gestapelt(page: Page) {
  const etikett = lagedaten(page).locator('dt', { hasText: 'Nächste Lagebesprechung' });
  const knopf = lagedaten(page).getByRole('button', { name: 'Nächste Lagebesprechung eintragen' });
  const [e, k] = [(await etikett.boundingBox())!, (await knopf.boundingBox())!];
  expect(k.y, 'Wert unter dem Etikett').toBeGreaterThanOrEqual(e.y + e.height - 1);
}
const zugriff = (page: Page) => page.getByRole('region', { name: 'Zugriff' });

test.describe('LFH-964 Einsatzdaten am Handy', () => {
  test.use({ viewport: { width: BREITE, height: 844 } });

  test('Admin: Lagedaten stapeln, „eintragen“ bricht um, „Entfernen“ ist ohne Wischen erreichbar', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page);
    const kollege = await benutzerAnlegen(page, 'fuehrungspersonal', 'Kollegin Mitglied');
    await mitgliedEintragen(page, String(id), kollege.id, 'beobachter');
    await page.goto(einsatzdatenPfad(id));

    // Ansicht: die leeren Lagedaten tragen ihre „… eintragen“-Knöpfe.
    const eintragen = lagedaten(page).getByRole('button', { name: /eintragen$/ });
    await expect(eintragen.first()).toBeVisible();
    await gestapelt(page);
    await keinQuerlauf(page, [lagedaten(page), ...(await eintragen.all())], 'Ansicht');

    // Zugriff: Name, Rolle und „Entfernen“ der Zeile ohne seitliches Scrollen.
    const zeile = zugriff(page).getByRole('row').filter({ hasText: 'Kollegin Mitglied' });
    const rolle = zeile.getByRole('combobox');
    const entfernen = zeile.getByRole('button', { name: 'Entfernen' });
    await keinQuerlauf(page, [zugriff(page), rolle, entfernen], 'Zugriff');
    await entfernen.click();
    await expect(page.getByText('Mitglied entfernen?')).toBeVisible();
    await page.keyboard.press('Escape');

    // Bearbeiten-Modus: auch das Vollformular läuft nicht über.
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    await expect(page.getByText('Einsatzdaten bearbeiten', { exact: true })).toBeVisible();
    await keinQuerlauf(page, [], 'Bearbeiten');
  });

  test('Führungspersonal: Rolle gesperrt, keine Aktion — die Seite läuft trotzdem nicht über', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page);
    await wechsleZuRolle(page, 'fuehrungspersonal', String(id));
    await page.goto(einsatzdatenPfad(id));

    await expect(
      lagedaten(page)
        .getByRole('button', { name: /eintragen$/ })
        .first(),
    ).toBeVisible();
    // Vorbedingung des Rollenzweigs: Rolle gesperrt, kein „Entfernen“.
    await expect(zugriff(page).getByRole('combobox').first()).toBeDisabled();
    await expect(zugriff(page).getByRole('button', { name: 'Entfernen' })).toHaveCount(0);
    await gestapelt(page);
    await keinQuerlauf(
      page,
      [
        lagedaten(page),
        zugriff(page),
        ...(await zugriff(page).getByRole('combobox').all()),
        ...(await lagedaten(page)
          .getByRole('button', { name: /eintragen$/ })
          .all()),
      ],
      'Führungspersonal',
    );
  });
});
