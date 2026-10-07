import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Meldungen am Handy (LFH-974, Spec `meldungen-handy`): bei 390×844 liegt der Wortlaut der ersten
 * Karte ganz im ersten Schirm, mit und ohne Schreibrecht. Unter `md` steht dafür eine Zeile statt
 * des Kennzahlenbands und „Filter" statt der Richtungs-Segmentleiste; ab `md` (1180, 1440) bleiben
 * Band und Segmentleiste.
 *
 * Gemessen mit `toBeInViewport({ ratio: 1 })` am Wortlaut, nie `toBeVisible()`: sichtbar wäre er
 * auch unter dem Falz.
 *
 * NICHT-PRIVILEGIERT (LFH-435): der Beobachter sieht „Meldung erfassen" nicht — Vorbedingung vor
 * der Messung —, und der Wortlaut steht trotzdem im Bild.
 */

const HANDY = { width: 390, height: 844 };

/**
 * Lang wie eine echte Lagemeldung über Funk, dreizehn Zeilen (rund 290 px) am Handy. Die Länge
 * trägt die Messung (Chromium, 390×844): mit Band und Richtungs-Segmentleiste über der Liste
 * (Stand vor LFH-974) beginnt der Wortlaut gemessen bei 569 px (Beobachter) bzw. 602 px (Admin)
 * und endet unter dem Rand; jetzt beginnt er bei 393 bzw. 426 px.
 */
const WORTLAUT =
  'Deich am Pegel Nord auf etwa 40 Metern durchfeuchtet, erste Sickerstellen an der Landseite. ' +
  'Sandsäcke werden knapp, erbitten zwei Gruppen zur Verstärkung und Nachschub an Säcken. ' +
  'Zufahrt über den Wirtschaftsweg nur noch für Geländewagen, Anfahrt über die Kreisstraße. ' +
  'Zwei Anwohner haben ihre Keller geräumt, Strom im Ortsteil Süd vorsorglich abgeschaltet, ' +
  'Notstrom für das Pumpwerk angefordert. ' +
  'Nächste Meldung in 30 Minuten oder sofort bei Veränderung.';

async function einsatzMitMeldungen(page: Page): Promise<string> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Meldungen Handy ${Date.now()}` },
  });
  expect(r.ok(), `POST /api/einsaetze: ${r.status()} ${await r.text()}`).toBe(true);
  const einsatzId = String(((await r.json()) as { id: number }).id);
  // Die erste Karte trägt den vollen Kopf: Priorität Sofort, Bestätigung offen.
  for (const [inhalt, prioritaet, pflicht] of [
    [WORTLAUT, 'sofort', true],
    ['Lage ruhig, keine Veränderung', 'normal', false],
  ] as const) {
    const angelegt = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen`, {
      data: {
        absender: 'Florian Nord 1',
        empfaenger: 'ELW 1',
        meldeweg: 'funk',
        meldungsart: 'sofortmeldung',
        prioritaet,
        bestaetigung_pflicht: pflicht,
        inhalt,
        ereigniszeit: '2026-10-01 09:00:00',
      },
    });
    expect(angelegt.ok(), `Meldung: ${angelegt.status()} ${await angelegt.text()}`).toBe(true);
  }
  return einsatzId;
}

async function oeffne(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/meldungen`);
  // Inhaltsanker, nie `networkidle` (LFH-385).
  await expect(page.getByText('Lage ruhig, keine Veränderung')).toBeVisible();
}

async function wortlautImErstenSchirm(page: Page) {
  const erste = page.locator('[data-meldung-id]').first();
  await expect(erste.getByText(WORTLAUT)).toBeInViewport({ ratio: 1 });
  // Zeile statt Band, Knopf statt Segmentleiste.
  await expect(page.locator('[data-lfh="meldung-kennzahl-zeile"]')).toBeVisible();
  await expect(page.locator('[data-lfh="kennzahl-wert"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Richtung' })).toHaveCount(0);
}

test.describe('Meldungen am Handy (LFH-974)', () => {
  test('390×844 als Admin: Wortlaut der ersten Karte im ersten Schirm', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzMitMeldungen(page);
    await page.setViewportSize(HANDY);
    await oeffne(page, einsatzId);
    await expect(page.getByRole('button', { name: 'Meldung erfassen' })).toBeVisible();
    await wortlautImErstenSchirm(page);

    // Geklickt, nicht nur sichtbar: der Filter wirkt.
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('menuitem', { name: /Extern/ }).click();
    await expect(page.getByRole('button', { name: 'Filter (1 aktiv)' })).toBeVisible();
    await expect(page.locator('[data-meldung-id]')).toHaveCount(0);
  });

  test('390×844 als Beobachter: Wortlaut der ersten Karte im ersten Schirm', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzMitMeldungen(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await page.setViewportSize(HANDY);
    await oeffne(page, einsatzId);
    // Vorbedingung des Rollenzweigs: keine Erfassung für den Beobachter.
    await expect(page.getByRole('button', { name: 'Meldung erfassen' })).toHaveCount(0);
    await wortlautImErstenSchirm(page);
  });

  for (const breite of [1180, 1440]) {
    test(`${breite} px: Band und Segmentleiste bleiben`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await anmeldenAlsAdmin(page);
      const einsatzId = await einsatzMitMeldungen(page);
      await page.setViewportSize({ width: breite, height: 900 });
      await oeffne(page, einsatzId);
      await expect(page.locator('[data-lfh="kennzahl-wert"]')).toHaveCount(4);
      await expect(page.getByRole('radiogroup', { name: 'Richtung' })).toBeVisible();
      await expect(page.locator('[data-lfh="meldung-kennzahl-zeile"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Filter/ })).toHaveCount(0);
    });
  }
});
