import { expect, test, type Page } from '@playwright/test';

/**
 * Prüflisten-Zeile 12 der Bedien-Leitlinie — „kein Sprung, kein Flächenfraß" — für die
 * angepinnten und schwebenden Leisten (LFH-373).
 *
 * WAS HIER STEHT UND WARUM NICHT IN VITEST: jsdom rechnet kein Layout; eine Leistenhöhe, ein
 * Umbruch oder ein Layout-Shift existieren dort nicht. Gemessen wird mit echten Kästen und dem
 * `layout-shift`-Beobachter aus `cls-kern.ts`.
 *
 * DER DECKEL IST EINE SETZUNG, KEINE NORM: eine angepinnte oder schwebende Leiste belegt im
 * Ruhezustand höchstens die HÄLFTE der Fläche, auf der sie steht (Fensterhöhe für die
 * ETB-Erfassung, Kartenhöhe für die Zeitachse). Entscheidung des Auftraggebers vom 25.09.2026
 * nach der Vorab-Messung (ETB bei 390 × 844 im Handschuh-Betrieb 497 px = 59 %, bei 390 × 600
 * sogar 83 %). Wer die Zahl ändert, ändert Spec (`openspec/changes/lfh-373-…`), diese Datei
 * und die Prüflisten zusammen.
 *
 * CLS IST FÜR EINGABEFOLGEN BLIND: Verschiebungen binnen 500 ms nach einer Eingabe tragen
 * `hadRecentInput` und zählen in keiner CLS-Definition. Der Chip-Umbruch der Erfassung folgt
 * immer einer Eingabe — dort wird deshalb die GEOMETRIE gemessen (Lage der Zeitachsenzeilen
 * vorher/nachher), nicht CLS. CLS misst nur, was ohne Eingabe geschieht: das Laden und eine
 * Fremdänderung, die live eintrifft.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const DICHTEN = ['kompakt', 'komfortabel', 'handschuh'] as const;
const FLAECHEN = [
  { name: 'Handschirm', width: 390, height: 844 },
  { name: 'Tablet', width: 1024, height: 768 },
  { name: 'Fükw', width: 1366, height: 768 },
] as const;
/** Deckel: höchstens die Hälfte (siehe Kopfkommentar). Literal, keine Rechnung aus Code. */
const DECKEL = 0.5;

// Login-Helfer aus `kernfluss.spec.ts` kopiert — es gibt (noch) kein geteiltes Login-Modul.
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, bezeichnung: string): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(antwort.ok(), `Seeding Einsatz: ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

/** Dichte über localStorage + Neuladen, mit Wache am `<html>` (Muster `gate3-trefflaeche`). */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/** Schriften fertig — sonst kippt der `font-display: swap`-Tausch Vorher/Nachher-Messungen. */
async function schriftenGeladen(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

test('ETB (LFH-373): die Erfassungsleiste belegt höchstens die halbe Fensterhöhe', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Flaeche 373 Nord ${Date.now()}`);
  const gemessen: string[] = [];
  const verstoesse: string[] = [];

  for (const flaeche of FLAECHEN) {
    await page.setViewportSize({ width: flaeche.width, height: flaeche.height });
    for (const dichte of DICHTEN) {
      const lauf = `${flaeche.name} ${flaeche.width}×${flaeche.height}/${dichte}`;
      await page.goto(`/einsaetze/${einsatzId}/etb`);
      await stelleDichte(page, dichte);
      // Ruhezustand: ein Entwurf, keine gesetzten Felder, kein Menü offen.
      const leiste = page.locator('.etb-erfassung-sticky');
      await expect(leiste.getByPlaceholder(/^Inhalt …/)).toBeVisible();
      await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
      await schriftenGeladen(page);

      const m = await page.evaluate(() => {
        const l = document.querySelector('.etb-erfassung-sticky')!.getBoundingClientRect();
        const karte = document.querySelector('[data-lfh="etb-erfassung"]')!.getBoundingClientRect();
        const feld = document
          .querySelector('.etb-erfassung-sticky textarea')!
          .getBoundingClientRect();
        return {
          leiste: l.height,
          karte: karte.width,
          feld: feld.width,
          fenster: window.innerHeight,
          breite: document.documentElement.scrollWidth,
          fensterBreite: window.innerWidth,
        };
      });
      const anteil = m.leiste / m.fenster;
      gemessen.push(`${lauf}: ${Math.round(m.leiste)} px = ${Math.round(anteil * 100)} %`);
      if (anteil > DECKEL) {
        verstoesse.push(
          `${lauf}: Leiste ${Math.round(m.leiste)} px > ${DECKEL * 100} % von ${m.fenster}`,
        );
      }
      expect(m.breite, `${lauf}: das Dokument läuft waagerecht über`).toBeLessThanOrEqual(
        m.fensterBreite,
      );
      if (flaeche.width < 768) {
        // Unter `md` nutzt das Feld die volle Breite der Erfassungskarte (vorher 124 von 366 px,
        // eingezwängt zwischen Typ-Präfix und „Erfassen"). Spiel für Rahmen und Polsterung.
        expect(
          m.feld,
          `${lauf}: Textfeld ${Math.round(m.feld)} px bei ${Math.round(m.karte)} px Karte`,
        ).toBeGreaterThanOrEqual(m.karte - 40);
      }
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
  expect(verstoesse, 'Deckel verletzt').toEqual([]);
});
