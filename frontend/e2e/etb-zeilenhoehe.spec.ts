import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Die Zeilenhöhe der ETB-Zeitachse in `kompakt` als Layout-Gate (LFH-958, Spec
 * `etb-zeitachse-darstellung`).
 *
 * Ein einzeiliger Eintrag mit Verfasser samt Funktion („… · EL“) und Meldeweg ist höchstens
 * 56 px hoch: Verfasser und Weg stehen in der Metazeile, das Menü in der Kopfzeile. Bei
 * 1440 × 900 stehen zwischen Filter- und Erfassungsleiste mindestens 9 Einträge ganz im Bild.
 * Als Admin und als Beobachter (`e2e/AGENTS.md`, LFH-435): das Menü ⋮ hängt an der Rolle, beim
 * Beobachter fehlt die Erfassungsleiste.
 */

test.setTimeout(120_000);

const HOECHSTENS = 56;
const MINDESTENS_IM_BILD = 9;
const ANZAHL = 30;

const BREITEN = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

async function saeen(page: Page): Promise<string> {
  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Zeilenhöhe ${Date.now()}` },
  });
  expect(neu.ok(), `Einsatz: ${neu.status()}`).toBe(true);
  const einsatzId = String(((await neu.json()) as { id: number }).id);
  for (let n = 1; n <= ANZAHL; n += 1) {
    const a = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: {
        typ: 'meldung',
        inhalt: `Pegel Messstelle ${n} unverändert`,
        von: 'ELW 1',
        an: 'Leitstelle',
        meldeweg: 'funk',
      },
    });
    expect(a.ok(), `Seeding: ${a.status()} ${await a.text()}`).toBe(true);
  }
  return einsatzId;
}

async function misst(page: Page, einsatzId: string, rolle: string) {
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'kompakt'));
  for (const breite of BREITEN) {
    const wo = `${rolle} ${breite.width}×${breite.height}`;
    await page.setViewportSize(breite);
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
    const zeilen = page.getByTestId('etb-ereigniszeile');
    await expect(zeilen).toHaveCount(ANZAHL);
    const erste = zeilen.first();
    // Vorbedingung: Verfasser mit Funktion und Meldeweg stehen wirklich in der Zeile.
    await expect(erste.locator('[data-lfh="verfasser"]')).toContainText('· EL');
    await expect(erste).toContainText('Funk');

    const hoehen = await zeilen.evaluateAll((alle) =>
      alle.slice(0, 10).map((z) => z.getBoundingClientRect().height),
    );
    for (const h of hoehen) {
      expect(h, `${wo}: Zeilenhöhe`).toBeLessThanOrEqual(HOECHSTENS);
    }

    if (breite.width !== 1440) continue;
    const imBild = await page.evaluate(() => {
      const leiste = document.querySelector('#etb-filterleiste')!.getBoundingClientRect();
      const erfassung = document.querySelector('.etb-erfassung-sticky');
      const unten = erfassung ? erfassung.getBoundingClientRect().top : window.innerHeight;
      return [...document.querySelectorAll('[data-testid="etb-ereigniszeile"]')].filter((z) => {
        const r = z.getBoundingClientRect();
        return r.top >= leiste.bottom && r.bottom <= unten;
      }).length;
    });
    expect(imBild, `${wo}: Einträge zwischen den Leisten`).toBeGreaterThanOrEqual(
      MINDESTENS_IM_BILD,
    );
  }
}

test('kompakte Zeile: höchstens 56 px, mindestens 9 Einträge im Bild (Admin)', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await saeen(page);
  await misst(page, einsatzId, 'admin');
});

test('kompakte Zeile: höchstens 56 px, mindestens 9 Einträge im Bild (Beobachter)', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await saeen(page);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  // Vorbedingung des Rollenzweigs: ohne Schreibrecht keine Erfassung.
  await expect(page.getByTestId('etb-ereigniszeile')).toHaveCount(ANZAHL);
  await expect(page.getByRole('button', { name: 'Erfassen', exact: true })).toHaveCount(0);
  await misst(page, einsatzId, 'beobachter');
});
