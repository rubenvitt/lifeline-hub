import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';
import { STAFFEL, haeltStufe, stelleDichte } from './trefflaeche-kern';

/**
 * LFH-900 — der Sammelbanner im Paneel „Meldungsstrom“ des Lage-Dashboards kostet keine Höhe
 * (Prüfliste Kriterium 12, „kein Sprung unter dem Cursor“; Bedien-Leitlinie: der Banner soll einen
 * Sprung verhindern, nicht selbst einen auslösen).
 *
 * Vor dem Fix stand der Banner im Fluss über der Liste: trifft ein ETB-Eintrag live ein, wurde das
 * Paneel um die Bannerhöhe (≈ 34 px in `kompakt`) höher, die Paneelreihe wuchs mit, und das Band
 * „Führungsstand“ darunter rutschte nach unten (gemessen bei 1440 × 900: Unterkante der Reihe
 * y = 349 → 383). Jetzt liegt er als Überlagerung mit Nullhöhe über dem Listenkopf.
 *
 * Gemessen wird in DOKUMENT-Koordinaten (`top + scrollY`): auf 390 px steht der Meldungsstrom
 * unter dem Falz, und das Scrollen zum Banner verschöbe jede Viewport-Koordinate.
 *  - die oberste gezeigte Zeile des Stroms bleibt, wo sie war — sie läge sonst unter dem Cursor;
 *  - das Band „Führungsstand“ bleibt, wo es war — der Sprung aus dem Ticket.
 *
 * DICHTE: alle drei Stufen. Der Banner ist in `handschuh` am höchsten (Knopf 72 px), und der
 * Knopf „anzeigen“ hält die Trefffläche der Stufe; geklickt wird er, nicht nur gesehen
 * (`e2e/AGENTS.md`, LFH-355).
 *
 * ROLLEN (LFH-435): kein Durchgang als Beobachter. Das Inventar führt das Lage-Dashboard als nicht
 * rollenabhängig; der Banner hat keinen Rollenzweig.
 */

const BREITEN = [
  { width: 1200, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
] as const;

/**
 * Drei Einträge vor dem Laden: der Strom ist dann das höchste Paneel der Reihe, und sein Wachsen
 * schiebt die Reihe. Mit einem leeren Strom zöge die Seite die Wassermarke nach und zeigte den
 * neuen Eintrag direkt, ohne Banner (`meldungsstrom.ts`, `wassermarkeNachziehen`).
 */
const VORHER = 3;

async function seedeEintrag(page: Page, einsatzId: number, inhalt: string) {
  const r = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
    data: { typ: 'meldung', inhalt, von: 'ELW 1', an: 'Leitstelle' },
  });
  expect(r.ok(), `Seeding ETB-Eintrag: ${r.status()} ${await r.text()}`).toBeTruthy();
}

/** Oberkante im Dokument, unabhängig von der Scrolllage. */
const oben = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

const strom = (page: Page) => page.getByRole('region', { name: 'Meldungsstrom' });

for (const viewport of BREITEN) {
  for (const { dichte, soll } of STAFFEL) {
    test(`Lage-Dashboard ${viewport.width} px, ${dichte}: der Sammelbanner verschiebt nichts`, async ({
      page,
    }) => {
      await anmeldenAlsAdmin(page);
      const r = await page.request.post('/api/einsaetze', {
        data: { bezeichnung: `E2E Sammelbanner Meldungsstrom ${Date.now()}` },
      });
      expect(r.ok(), `Seeding Einsatz: ${r.status()} ${await r.text()}`).toBeTruthy();
      const { id: einsatzId } = (await r.json()) as { id: number };
      for (let n = 1; n <= VORHER; n += 1) {
        await seedeEintrag(page, einsatzId, `Lagemeldung ${n}: Pegel steigt weiter`);
      }

      await page.setViewportSize(viewport);
      await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
      await stelleDichte(page, dichte);

      const zeilen = strom(page).locator('li[data-lfd-nr]');
      await expect(zeilen).toHaveCount(VORHER);
      await expect(page.locator('[data-lfh="seiten-inhalt"] [aria-busy="true"]')).toHaveCount(0);
      // Der neue Eintrag kommt über den Live-Strom; ohne offene Leitung käme er nie an.
      await expect(strom(page).locator('[data-lfh="strom-live"]')).toHaveText('live');

      const fuehrungsstand = page.getByRole('group', { name: 'Führungsstand' });
      const ersteZeile = zeilen.first();
      const vorher = { zeile: await oben(ersteZeile), band: await oben(fuehrungsstand) };

      await seedeEintrag(page, einsatzId, 'Lagemeldung neu: Deich bei km 12 durchfeuchtet');
      const banner = strom(page).locator('[data-lfh="sammelbanner"]');
      await expect(banner).toContainText('1 neuer Eintrag');
      // Zurückgehalten, nicht eingeschoben: die Liste zeigt weiter die alten Einträge.
      await expect(zeilen).toHaveCount(VORHER);

      const nachher = { zeile: await oben(ersteZeile), band: await oben(fuehrungsstand) };
      test.info().annotations.push({
        type: 'messwert',
        description:
          `${viewport.width} px, ${dichte}: oberste Zeile y ${vorher.zeile} → ${nachher.zeile}, ` +
          `Führungsstand y ${vorher.band} → ${nachher.band}`,
      });
      expect.soft(nachher.zeile, 'oberste Zeile des Stroms nach dem Banner').toBe(vorher.zeile);
      expect.soft(nachher.band, 'Band „Führungsstand“ nach dem Banner').toBe(vorher.band);

      // Bedienbar: Trefffläche der Stufe, und der Klick gibt den Eintrag frei.
      const anzeigen = banner.getByRole('button', { name: 'anzeigen' });
      await anzeigen.scrollIntoViewIfNeeded();
      await expect(anzeigen).toBeInViewport();
      await haeltStufe(anzeigen, soll, `„anzeigen“ in ${dichte}`);
      await anzeigen.click();
      await expect(banner).toHaveCount(0);
      await expect(zeilen).toHaveCount(VORHER + 1);
      await expect(zeilen.first()).toContainText('Deich bei km 12');
    });
  }
}
