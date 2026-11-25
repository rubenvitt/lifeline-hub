import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Großbild für Lagebild und Lagebesprechung (LLH-1747, Spec `grossbild-ansicht`): nur der Browser
 * zeigt Geometrie, also misst diese Spec hier, was jsdom nicht kann.
 *
 * - LESBAR AUS DER ENTFERNUNG: bei 1920 × 1080 jede führende Zahl ≥ 72 px, jeder Text ≥ 28 px.
 * - MITWACHSEN OHNE BILDLAUF: bei 1920 × 1080 und 1280 × 720 rollt nichts, und kein Block schneidet
 *   seinen Inhalt unten ab.
 * - ALARMZEILE (LLH-1931): das Großbild des Lagebilds trägt „Was brennt“ der Seite oben, in Alarmrolle
 *   und im Großbild-Maß; das Großbild der Lagebesprechung trägt keine.
 * - AUSSTIEG, zwei Wege getrennt: das Lagebild läuft im Element-Vollbild, und dessen Ende (wie Esc im
 *   Vollbild, das der Browser selbst nimmt) beendet das Großbild; in der Lagebesprechung beendet die
 *   Taste Esc es über den Tastenhörer der Hülle.
 */

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

/**
 * Drei Betroffene, eine davon vermisst, und ein überfälliger Auftrag: genug, damit Band, Sichtung
 * und die Vorbereitung der Lagebesprechung Werte tragen. Den Alarmton im Großbild des Lagebilds
 * tragen die Kennzahl „Vermisste“ und die Alarmzeile („1 vermisst“, „1 Auftrag überfällig“); die
 * Kennzahl „Aufträge offen“ zeigt nur der Überblick (LLH-1743).
 */
async function seed(page: Page): Promise<string> {
  const einsatzId = String(
    await post(page, '/api/incidents', { bezeichnung: `E2E Großbild ${Date.now()}` }),
  );
  const basis = `/api/incidents/${einsatzId}`;
  for (const name of ['Albers', 'Brandt']) await post(page, `${basis}/persons`, { name });
  await post(page, `${basis}/persons`, { name: 'Claasen', status: 'vermisst' });
  await post(page, `${basis}/tasks`, {
    auftrag_text: 'Deich sichern',
    empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'Abschnitt Nord' }],
    frist_at: '2026-06-01 10:00:00',
  });
  return einsatzId;
}

/** Kleinste Schrift aller Elemente mit eigenem Text in der Fläche. */
function smallestFontSize(flaeche: Locator): Promise<number> {
  return flaeche.evaluate((wurzel) => {
    let kleinste = Infinity;
    for (const el of wurzel.querySelectorAll<HTMLElement>('*')) {
      if (el.closest('svg')) continue;
      const eigenerText = [...el.childNodes].some(
        (k) => k.nodeType === Node.TEXT_NODE && (k.textContent ?? '').trim() !== '',
      );
      if (!eigenerText) continue;
      kleinste = Math.min(kleinste, parseFloat(getComputedStyle(el).fontSize));
    }
    return kleinste;
  });
}

/** Kleinste Schrift der führenden Zahlen: jede Zahl einer Kennzahl und jede Zahl einer Zeile. */
function smallestNumberSize(flaeche: Locator): Promise<number> {
  return flaeche.evaluate((wurzel) => {
    const zahlen = [...wurzel.querySelectorAll<HTMLElement>('[data-lfh="gross-zahl"]')].filter(
      (z) => /\d/.test(z.textContent ?? ''),
    );
    if (zahlen.length === 0) throw new Error('keine Zahl im Großbild');
    return Math.min(...zahlen.map((z) => parseFloat(getComputedStyle(z).fontSize)));
  });
}

/** Rollt die Fläche, oder schneidet ein Block seinen Inhalt unten ab? */
function findOverflow(flaeche: Locator): Promise<string[]> {
  return flaeche.evaluate((wurzel) => {
    const befunde: string[] = [];
    if (wurzel.scrollHeight > wurzel.clientHeight + 1) befunde.push('Fläche rollt');
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      befunde.push('Dokument breiter als das Fenster');
    for (const b of wurzel.querySelectorAll<HTMLElement>('section, [role="group"]')) {
      if (b.scrollHeight > b.clientHeight + 1) {
        befunde.push(`${b.getAttribute('aria-label')}: ${b.scrollHeight} > ${b.clientHeight}`);
      }
    }
    return befunde;
  });
}

async function openGrossbild(page: Page, pfad: string, anker: Locator): Promise<Locator> {
  await page.goto(pfad);
  await expect(anker).toBeVisible();
  await page.getByRole('button', { name: 'Großbild', exact: true }).click();
  const flaeche = page.locator('[data-lfh="grossbild"]');
  await expect(flaeche).toBeVisible();
  return flaeche;
}

for (const fenster of [
  { breite: 1920, hoehe: 1080 },
  { breite: 1280, hoehe: 720 },
]) {
  test.describe(`Großbild bei ${fenster.breite} × ${fenster.hoehe}`, () => {
    test.use({ viewport: { width: fenster.breite, height: fenster.hoehe } });
    const anteil = fenster.breite / 1920;

    test('Lagebild: Großbild-Größen, kein Bildlauf, Ende des Vollbilds führt zurück', async ({
      page,
    }) => {
      await anmeldenAlsAdmin(page, { startseite: false });
      const einsatzId = await seed(page);
      const flaeche = await openGrossbild(
        page,
        `/einsaetze/${einsatzId}/lage-dashboard`,
        page.locator('[data-lfh="kennzahl"]').filter({ hasText: 'Betroffene' }).first(),
      );
      const band = flaeche.getByRole('group', { name: 'Lage in Zahlen' });
      await expect(band.locator('[data-lfh="gross-kennzahl"][data-zustand="daten"]')).toHaveCount(
        6,
      );
      await expect(flaeche.getByRole('region', { name: 'Sichtung' })).toContainText('3 erfasst');
      const vermisste = band
        .locator('[data-lfh="gross-kennzahl"]')
        .filter({ hasText: 'Vermisste' });
      await expect(vermisste).toHaveAttribute('data-ton', 'alarm');
      // Zweiter Kanal neben der Farbe: die Kante (Innenschatten), 6 px bei 1920.
      expect(await vermisste.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/inset/);

      // Alarmzeile der Seite ganz oben, ohne Sprung (LLH-1931).
      const alarm = flaeche.getByRole('status', { name: 'Was brennt' });
      for (const [art, text] of [
        ['vermisst', '1 vermisst'],
        ['auftrag', '1 Auftrag überfällig'],
      ]) {
        const eintrag = alarm.locator(`[data-lfh="alarm-eintrag"][data-art="${art}"]`);
        await expect(eintrag).toHaveText(text);
        await expect(eintrag).toHaveAttribute('data-ton', 'alarm');
      }
      await expect(alarm.getByRole('link')).toHaveCount(0);
      const [alarmUnten, bandOben] = await Promise.all([
        alarm.evaluate((el) => el.getBoundingClientRect().bottom),
        band.evaluate((el) => el.getBoundingClientRect().top),
      ]);
      expect(alarmUnten).toBeLessThanOrEqual(bandOben);

      expect(await smallestFontSize(flaeche)).toBeGreaterThanOrEqual(28 * anteil - 0.5);
      expect(await smallestNumberSize(flaeche)).toBeGreaterThanOrEqual(72 * anteil - 0.5);
      expect(await findOverflow(flaeche)).toEqual([]);

      // Das Großbild läuft im Vollbild der Fläche; endet das Vollbild, endet das Großbild.
      expect(await flaeche.evaluate((el) => document.fullscreenElement === el)).toBe(true);
      await page.evaluate(() => document.exitFullscreen());
      await expect(flaeche).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: 'Lagebild' })).toBeVisible();
    });

    test('Lagebesprechung: Großbild-Größen, kein Bildlauf, Esc führt zurück', async ({ page }) => {
      await anmeldenAlsAdmin(page, { startseite: false });
      const einsatzId = await seed(page);
      const flaeche = await openGrossbild(
        page,
        `/einsaetze/${einsatzId}/lagebesprechung`,
        page.locator('[data-lfh="vorbereitung-zeile"][data-schluessel="auftraege"]'),
      );
      const vorbereitung = flaeche.getByRole('region', { name: 'Vorbereitung' });
      await expect(vorbereitung).toContainText('Aufträge offen');
      await expect(vorbereitung).not.toContainText('Quelle');
      // Die Seite Lagebesprechung trägt keine Alarmzeile, ihr Großbild auch nicht (LLH-1931).
      await expect(flaeche.locator('[data-lfh="alarm-zeile"]')).toHaveCount(0);

      expect(await smallestFontSize(flaeche)).toBeGreaterThanOrEqual(28 * anteil - 0.5);
      expect(await smallestNumberSize(flaeche)).toBeGreaterThanOrEqual(72 * anteil - 0.5);
      expect(await findOverflow(flaeche)).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(flaeche).toHaveCount(0);
    });
  });
}
