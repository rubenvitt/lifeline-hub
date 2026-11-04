import { expect, test, type Page } from '@playwright/test';
import { beobachteShifts, bericht, ruheShifts, setzeShiftsZurueck } from './cls-kern';
import { SUBPIXEL, anmelden, einsatzAnlegen, seedKraeftebaum } from './meldebild-kern';

/**
 * LLH-1479 — der Sammelbanner des Meldebilds hält keine leere Standzeile mehr.
 *
 * Seit LLH-1417 stehen „Spalten“, „Drucken“ und „In Lagebericht übernehmen“ in der Werkzeugzeile
 * der Seite. Die Werkzeugzeile der `Datensicht` trug danach nur noch den Banner und stand fast
 * immer leer da (~40 px Lücke zwischen Seitenzeile und Tabelle). Jetzt steht dort ein klebender
 * Anker ohne Höhe, und der Banner schwebt als Pille über dem Tabellenkopf.
 *
 *  1. Zwischen Seitenzeile und Tabelle liegt nur noch deren Außenabstand, keine Zeile.
 *  2. Erscheint der Banner, verschiebt sich nichts: CLS 0 und der Tabellenkopf bleibt, wo er war.
 *  3. Die Pille liegt über dem Kopf, bleibt beim Rollen unter dem Rahmen stehen und gibt per
 *     Klick den Zufluss frei.
 *
 * Gehalten wird die Sicht über den Mauszeiger auf der Tabelle (Spec `datensicht-zufluss`); die
 * neue Einheit kommt per API und erreicht die Seite über den Live-Strom.
 */

/** Fükw-Hauptgerät, die engste Breite der Seitenzeile (LLH-1417). */
const BREITEN = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
] as const;

/** Kanten in Dokument-Koordinaten, unabhängig von der Scrolllage. */
async function lage(page: Page) {
  return page.evaluate(() => {
    const kante = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { oben: r.top + window.scrollY, unten: r.bottom + window.scrollY, hoehe: r.height };
    };
    return {
      seitenzeile: kante('[data-lfh="meldebild-werkzeuge"]')!,
      anker: kante('[data-lfh="datensicht-werkzeuge"]')!,
      tabelle: kante('section[aria-label="Meldebild"] .ant-table-wrapper')!,
      kopf: kante('section[aria-label="Meldebild"] .ant-table-thead')!,
      pille: kante('[data-lfh="datensicht-banner-pille"] button'),
      abstand: parseFloat(
        getComputedStyle(document.querySelector('[data-lfh="meldebild-werkzeuge"]')!)
          .marginBlockEnd,
      ),
    };
  });
}

for (const viewport of BREITEN) {
  test(`Meldebild ${viewport.width} px: keine leere Bannerzeile, und der Banner verschiebt nichts`, async ({
    page,
  }) => {
    await beobachteShifts(page);
    await page.setViewportSize(viewport);
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Meldebild Banner ${Date.now()}`);
    const b = await seedKraeftebaum(page, einsatzId);
    // Neu navigieren: der Login leitet im selben Dokument weiter (`cls-kern.ts`). Die neue Einheit
    // kommt nur über den Live-Strom, und der Server abonniert erst mit der Antwort auf `/live`
    // (LLH-1317, `e2e/AGENTS.md`): vorher geschrieben, bliebe der Banner aus.
    const strom = page.waitForResponse(
      (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
    );
    await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
    await strom;
    const bereich = page.getByRole('region', { name: 'Meldebild' });
    await expect(bereich.locator(`tr[data-row-key="eh-${b.zug}"]`)).toBeVisible();

    // ── 1. Keine Standzeile: der Anker hat keine Höhe, die Tabelle folgt dem Außenabstand.
    const vorher = await lage(page);
    expect(vorher.anker.hoehe, 'der Anker des Banners trägt Höhe').toBeLessThanOrEqual(SUBPIXEL);
    const luecke = vorher.tabelle.oben - vorher.seitenzeile.unten;
    expect(
      luecke,
      `zwischen Seitenzeile und Tabelle liegen ${luecke}px (Außenabstand ${vorher.abstand}px)`,
    ).toBeLessThanOrEqual(vorher.abstand + SUBPIXEL);

    // ── 2. Halten, Zufluss auslösen, messen.
    const kopf = bereich.locator('.ant-table-thead');
    const kasten = (await bereich.locator('.ant-table-tbody').boundingBox())!;
    await page.mouse.move(kasten.x + kasten.width / 2, kasten.y + 10);
    await ruheShifts(page);
    await setzeShiftsZurueck(page);

    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/einheiten`, {
      data: { name: '2. Zug Musterstadt-Südost' },
    });
    expect(antwort.ok(), `Seeding Einheit: ${antwort.status()}`).toBeTruthy();
    const neu = ((await antwort.json()) as { id: number }).id;

    const banner = page.getByRole('button', { name: /1 neuer Eintrag/ });
    await expect(banner).toBeVisible();
    await expect(bereich.locator(`tr[data-row-key="eh-${neu}"]`)).toHaveCount(0);
    const messung = await ruheShifts(page);
    expect(messung.summe, `der Banner verschiebt Inhalt: ${bericht(messung)}`).toBeLessThanOrEqual(
      0.001,
    );
    const danach = await lage(page);
    expect(
      Math.abs(danach.kopf.oben - vorher.kopf.oben),
      'der Tabellenkopf rückt',
    ).toBeLessThanOrEqual(SUBPIXEL);

    // ── 3. Die Pille liegt über dem Kopf, nicht darüber in einer eigenen Zeile.
    const pille = danach.pille!;
    expect(pille.oben, 'die Pille steht über der Seitenzeile').toBeGreaterThanOrEqual(
      danach.seitenzeile.unten - SUBPIXEL,
    );
    expect(pille.oben, 'die Pille beginnt nicht im Kopf').toBeLessThan(danach.kopf.unten);
    await expect(kopf).toBeVisible();
    // Oben auf dem Stapel: der stehende Kopf (antd-Ebene 19) deckte sie sonst zu.
    const obenauf = await page.evaluate(() => {
      const knopf = document.querySelector('[data-lfh="datensicht-banner-pille"] button')!;
      const r = knopf.getBoundingClientRect();
      return knopf.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(obenauf, 'der Tabellenkopf deckt die Pille').toBe(true);

    // Klick gibt frei: die neue Einheit steht da, der Banner ist weg.
    await banner.click();
    await expect(bereich.locator(`tr[data-row-key="eh-${neu}"]`)).toBeVisible();
    await expect(banner).toHaveCount(0);
  });
}
