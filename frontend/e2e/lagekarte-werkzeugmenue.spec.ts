import { expect, test, type Page } from '@playwright/test';
import { oeffneWerkzeugmenue, werkzeugmenue, zeichenwerkzeugeKnopf } from './leisten-kern';
import { STAFFEL, SUBPIXEL, anmelden, einsatzAnlegen, stelleDichte } from './trefflaeche-kern';

/**
 * Werkzeugmenü an der Karte (LLH-1038, Spec `lagekarte-zeichnen`, „Das Werkzeugmenü verdeckt
 * keine Bedienung“): bei 390 px und 768 px steht das offene Menü über den Fuß-Bändern und neben
 * dem Knopfblock, nie darauf; passt es nicht, rollt es in sich. Jeder Eintrag hält die Stufe der
 * Dichte, auch eine Kachel „Zuletzt verwendet“.
 *
 * „Antippbar“ heißt hier: an der Mitte jedes Kartenknopfs und jedes Fuß-Bands liegt kein Teil
 * des Menüs (`elementFromPoint`). Ein Rechteckschnitt allein wäre bei `pointerEvents: none` am
 * Fuß-Rahmen kein Beleg.
 */

/** Eine Kachel „Zuletzt verwendet“: der Startentwurf des Pickers (Formation). */
const ZULETZT = JSON.stringify([{ spec: '{"v":1,"spec":{"kind":"formation"}}' }]);

interface Rechteck {
  x: number;
  y: number;
  width: number;
  height: number;
}

const schneiden = (a: Rechteck, b: Rechteck) =>
  a.x < b.x + b.width - SUBPIXEL &&
  b.x < a.x + a.width - SUBPIXEL &&
  a.y < b.y + b.height - SUBPIXEL &&
  b.y < a.y + a.height - SUBPIXEL;

/** Knopfblock und Fuß-Bänder (ohne das Menü selbst), je mit Namen und Kasten. */
async function bedienteile(page: Page) {
  return page.evaluate(() => {
    const kasten = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const knoepfe = Array.from(document.querySelectorAll('[data-lfh="karten-knoepfe"] button')).map(
      (el) => ({ name: el.getAttribute('aria-label') ?? el.textContent ?? '?', ...kasten(el) }),
    );
    const baender = Array.from(
      document.querySelectorAll('[data-lfh="karten-fuss"] > :not([data-lfh="werkzeugmenue"])'),
    )
      .map((el) => ({ name: (el as HTMLElement).dataset.lfh ?? el.tagName, ...kasten(el) }))
      .filter((b) => b.width > 0 && b.height > 0);
    return [...knoepfe, ...baender];
  });
}

/** Liegt an der Mitte eines Kastens ein Teil des Menüs? */
async function menueUnterMitte(page: Page, r: Rechteck) {
  return page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-lfh="werkzeugmenue"]'),
    [r.x + r.width / 2, r.y + r.height / 2] as const,
  );
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]) {
  test.describe(`Werkzeugmenü bei ${viewport.width} px (LLH-1038)`, () => {
    test.use({ viewport, hasTouch: true });

    test('verdeckt weder Knopfblock noch Fuß-Bänder, jeder Eintrag hält die Stufe', async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const fehler: Error[] = [];
      page.on('pageerror', (f) => fehler.push(f));
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E Werkzeugmenü ${Date.now()}`);
      await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
      await page.evaluate(
        ([z]) => {
          // Zeitachse ausgeklappt: erst dann stehen im Fuß Bänder, die das Menü verdecken könnte.
          localStorage.setItem('lfh:lagekarte:zeitachse-eingeklappt', '0');
          localStorage.setItem('lfh:lagekarte:zeichen-zuletzt-v2', z);
        },
        [ZULETZT] as const,
      );
      const gemessen: string[] = [];

      for (const { dichte, soll } of STAFFEL) {
        await stelleDichte(page, dichte);
        await expect(
          page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas'),
        ).toHaveCount(1, { timeout: 60_000 });
        await expect(page.locator('[data-lfh="zeitachse"]')).toBeVisible();
        const leisteVorher = await page.locator('#lagekarte-leiste').isVisible();

        const menue = await oeffneWerkzeugmenue(page, true);
        // Positiver Anker: beide Gruppen und die Kachel stehen, bevor gemessen wird.
        await expect(menue.getByRole('group', { name: 'Flächen und Linien' })).toBeVisible();
        await expect(
          menue.getByRole('group', { name: 'Zuletzt verwendet' }).getByRole('button'),
        ).toHaveCount(1);
        // „Zeichenwerkzeuge“ ändert die Leiste nicht.
        expect(await page.locator('#lagekarte-leiste').isVisible()).toBe(leisteVorher);

        // ── Nichts verdeckt ────────────────────────────────────────────────────────────
        const menueKasten = (await menue.boundingBox())!;
        const teile = await bedienteile(page);
        expect(
          teile.some((t) => t.name === 'zeitachse'),
          'Vorbedingung: die Zeitachse steht im Fuß',
        ).toBe(true);
        expect(teile.length, 'Vorbedingung: Knopfblock gemessen').toBeGreaterThanOrEqual(4);
        for (const t of teile) {
          expect(schneiden(menueKasten, t), `${dichte}: Menü überdeckt ${t.name}`).toBe(false);
          expect(await menueUnterMitte(page, t), `${dichte}: ${t.name} nicht antippbar`).toBe(
            false,
          );
        }
        // Das Menü steht ganz im Bild.
        await expect(menue).toBeInViewport({ ratio: 1 });

        // ── Jeder Eintrag hält die Stufe; was nicht passt, rollt das Menü ──────────────
        const eintraege = menue.getByRole('button');
        // Sechs Zonentypen, sechs Zusatzformen, eine Kachel und „Weitere …“.
        await expect(eintraege).toHaveCount(14);
        let kleinstes = Number.POSITIVE_INFINITY;
        for (let i = 0; i < 14; i += 1) {
          const e = eintraege.nth(i);
          await e.scrollIntoViewIfNeeded();
          const k = (await e.boundingBox())!;
          expect(k.height, `${dichte}: Eintrag #${i + 1} ${k.height}px`).toBeGreaterThanOrEqual(
            soll - SUBPIXEL,
          );
          // Gerollt bleibt der Eintrag innerhalb des Menüs (rollt in sich, nicht die Seite).
          const m = (await menue.boundingBox())!;
          expect(k.y, `${dichte}: Eintrag #${i + 1} über dem Menü`).toBeGreaterThanOrEqual(
            m.y - SUBPIXEL,
          );
          expect(k.y + k.height, `${dichte}: Eintrag #${i + 1} unter dem Menü`).toBeLessThanOrEqual(
            m.y + m.height + SUBPIXEL,
          );
          kleinstes = Math.min(kleinstes, k.height);
        }
        gemessen.push(
          `${dichte}: Menü ${Math.round(menueKasten.height)}px, Eintrag ≥ ${kleinstes}`,
        );

        // ── Esc schließt, der Fokus steht am Knopf ─────────────────────────────────────
        await page.keyboard.press('Escape');
        await expect(werkzeugmenue(page)).toHaveCount(0);
        await expect(zeichenwerkzeugeKnopf(page)).toBeFocused();
        await expect(zeichenwerkzeugeKnopf(page)).toHaveAttribute('aria-expanded', 'false');
      }

      test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
      expect(fehler.map((f) => f.message)).toEqual([]);
    });

    test('ein Tipp neben das Menü schließt es, ohne zu zeichnen', async ({ page }) => {
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E Werkzeugmenü Außen ${Date.now()}`);
      await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
      const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
      await expect(canvas).toHaveCount(1, { timeout: 60_000 });
      const menue = await oeffneWerkzeugmenue(page, true);
      const karte = (await canvas.boundingBox())!;
      const m = (await menue.boundingBox())!;
      // Ein Punkt freier Karte: unter dem Menü, sonst links daneben. Frei heißt: dort liegt die
      // Leinwand der Karte, kein Band, kein Knopf, kein Menü.
      const kandidaten = [
        { x: m.x + m.width / 2, y: m.y + m.height + 24 },
        { x: karte.x + 20, y: m.y + m.height / 2 },
      ];
      const frei = await page.evaluate(
        (ps) => ps.map((p) => document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS'),
        kandidaten,
      );
      const punkt = kandidaten.find((_, i) => frei[i]);
      expect(punkt, 'Vorbedingung: freie Karte neben dem Menü').toBeDefined();
      await page.touchscreen.tap(punkt!.x, punkt!.y);
      await expect(werkzeugmenue(page)).toHaveCount(0);
      await expect(page.locator('[data-lfh="zeichnen-steuerung"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Abschließen' })).toHaveCount(0);
    });
  });
}
