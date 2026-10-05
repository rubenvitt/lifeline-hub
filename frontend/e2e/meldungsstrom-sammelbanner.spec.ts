import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';
import { STAFFEL, haeltStufe, stelleDichte } from './trefflaeche-kern';

/**
 * LFH-900 — der Sammelbanner im Paneel „Meldungsstrom“ des Lage-Dashboards kostet keine Höhe
 * (Prüfliste Kriterium 12, „kein Sprung unter dem Cursor“; Bedien-Leitlinie: der Banner soll einen
 * Sprung verhindern, nicht selbst einen auslösen).
 *
 * Vor dem Fix stand der Banner im Fluss über der Liste: trifft ein ETB-Eintrag live ein, wurde das
 * Paneel um die Bannerhöhe höher (gemessen 38 / 60 / 88 px je Dichte), die Paneelreihe wuchs mit, und das Band
 * „Führungsstand“ darunter rutschte nach unten (gemessen bei 1440 × 900: Unterkante der Reihe
 * y = 349 → 383). Jetzt liegt er als Überlagerung über dem Listenkopf.
 *
 * Gemessen wird in DOKUMENT-Koordinaten (`top + scrollY`): auf 390 px steht der Meldungsstrom
 * unter dem Falz, und das Scrollen zum Banner verschöbe jede Viewport-Koordinate.
 *  - die oberste gezeigte Zeile des Stroms bleibt, wo sie war — sie läge sonst unter dem Cursor;
 *  - das Band „Führungsstand“ bleibt, wo es war — der Sprung aus dem Ticket;
 *  - der Banner bleibt im Paneel, und nach „anzeigen“ steht der Fokus auf der Liste.
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
 *
 * Dazu der knappste Fall: EIN Eintrag in `handschuh`. Die Zeile (≈ 70 px) ist dort niedriger als
 * der Banner (88 px); ohne Mindesthöhe der Liste ragte er über das Paneel und auf 390 px über die
 * Links des Bands „Führungsstand“.
 */
const FAELLE = [
  ...BREITEN.flatMap((viewport) => STAFFEL.map((stufe) => ({ viewport, ...stufe, vorher: 3 }))),
  ...[BREITEN[1], BREITEN[3]].map((viewport) => ({ viewport, ...STAFFEL[2], vorher: 1 })),
];

async function seedeEintrag(page: Page, einsatzId: number, inhalt: string) {
  const r = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
    data: { typ: 'meldung', inhalt, von: 'ELW 1', an: 'Leitstelle' },
  });
  expect(r.ok(), `Seeding ETB-Eintrag: ${r.status()} ${await r.text()}`).toBeTruthy();
}

/** Ober- bzw. Unterkante im Dokument, unabhängig von der Scrolllage. */
const oben = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
const unten = (l: Locator) =>
  l.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);

const strom = (page: Page) => page.getByRole('region', { name: 'Meldungsstrom' });

for (const { viewport, dichte, soll, vorher: anzahl } of FAELLE) {
  test(`Lage-Dashboard ${viewport.width} px, ${dichte}, ${anzahl} ${anzahl === 1 ? 'Eintrag' : 'Einträge'}: der Sammelbanner verschiebt nichts`, async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const r = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E Sammelbanner Meldungsstrom ${Date.now()}` },
    });
    expect(r.ok(), `Seeding Einsatz: ${r.status()} ${await r.text()}`).toBeTruthy();
    const { id: einsatzId } = (await r.json()) as { id: number };
    for (let n = 1; n <= anzahl; n += 1) {
      await seedeEintrag(page, einsatzId, `Lagemeldung ${n}: Pegel steigt weiter`);
    }

    await page.setViewportSize(viewport);
    await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
    await stelleDichte(page, dichte);

    const zeilen = strom(page).locator('li[data-lfd-nr]');
    await expect(zeilen).toHaveCount(anzahl);
    await expect(page.locator('[data-lfh="seiten-inhalt"] [aria-busy="true"]')).toHaveCount(0);
    // Der neue Eintrag kommt über den Live-Strom; ohne offene Leitung käme er nie an.
    await expect(strom(page).locator('[data-lfh="strom-live"]')).toHaveText('live');
    // Ein später Schriftwechsel verschöbe die Zeilen ohne Banner (Muster `gate1-ueberlauf`).
    await page.evaluate(() => document.fonts.ready);

    const fuehrungsstand = page.getByRole('group', { name: 'Führungsstand' });
    const ersteZeile = zeilen.first();
    const davor = { zeile: await oben(ersteZeile), band: await oben(fuehrungsstand) };

    await seedeEintrag(page, einsatzId, 'Lagemeldung neu: Deich bei km 12 durchfeuchtet');
    const banner = strom(page).locator('[data-lfh="sammelbanner"]');
    await expect(banner).toContainText('1 neuer Eintrag');
    // Zurückgehalten, nicht eingeschoben: die Liste zeigt weiter die alten Einträge.
    await expect(zeilen).toHaveCount(anzahl);

    const danach = { zeile: await oben(ersteZeile), band: await oben(fuehrungsstand) };
    const ueberstand = (await unten(banner)) - (await unten(strom(page)));
    test.info().annotations.push({
      type: 'messwert',
      description:
        `${viewport.width} px, ${dichte}, ${anzahl}: oberste Zeile y ${davor.zeile} → ` +
        `${danach.zeile}, Führungsstand y ${davor.band} → ${danach.band}, ` +
        `Banner-Unterkante ${ueberstand} px über der Paneelunterkante`,
    });
    expect.soft(danach.zeile, 'oberste Zeile des Stroms nach dem Banner').toBe(davor.zeile);
    expect.soft(danach.band, 'Band „Führungsstand“ nach dem Banner').toBe(davor.band);
    // Die Überlagerung bleibt im Paneel: sie verdeckt nichts außerhalb des Meldungsstroms.
    expect.soft(ueberstand, 'Banner ragt über das Paneel hinaus').toBeLessThanOrEqual(0);

    // Bedienbar: Trefffläche der Stufe, und der Klick gibt den Eintrag frei.
    const anzeigen = banner.getByRole('button', { name: 'anzeigen' });
    await anzeigen.scrollIntoViewIfNeeded();
    await expect(anzeigen).toBeInViewport();
    await haeltStufe(anzeigen, soll, `„anzeigen“ in ${dichte}`);
    await anzeigen.click();
    await expect(banner).toHaveCount(0);
    await expect(zeilen).toHaveCount(anzahl + 1);
    await expect(zeilen.first()).toContainText('Deich bei km 12');
    // Der Knopf ist mit dem Banner weg; der Fokus fällt nicht auf `body`.
    await expect(strom(page).getByRole('list', { name: 'Jüngste Einträge' })).toBeFocused();
  });
}
