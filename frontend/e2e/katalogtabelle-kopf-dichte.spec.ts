import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmelden, FUEKW, stelleDichte, SUBPIXEL, ZIELABSTAND } from './trefflaeche-kern';

/**
 * Kopfwerkzeuge der `KatalogTabelle` nach Dichte (LLH-1227, Bedien-Leitlinie Kriterium 2,
 * Befund der Prüfliste LLH-1042): Suche und Spaltenschalter standen 3 / 5 / 7 px auseinander,
 * der Spaltenfilter-Auslöser blieb in jeder Stufe 20 × 23 px und lag nicht in der Tab-Folge.
 *
 * Gemessen an der Benutzerliste (Suche, Spaltenschalter und Statusfilter, eine Zeile hat sie
 * immer: der Harness-Admin). Das Primitiv trägt alles; jede andere `KatalogTabelle` mit
 * `filters` erbt es. jsdom rechnet kein Layout, deshalb hier.
 */

/** Die Stufen mit Bildschirm: kompakt am Fükw, die groben Stufen am Führungs-Tablet. */
const STUFEN = [
  { dichte: 'kompakt', viewport: FUEKW, boden: 24 },
  { dichte: 'komfortabel', viewport: { width: 1024, height: 768 }, boden: 48 },
  { dichte: 'handschuh', viewport: { width: 1024, height: 768 }, boden: 72 },
] as const;

type Kasten = { x: number; y: number; width: number; height: number };

/** Kleinster Abstand zweier Rechtecke (0 bei Überlappung), waagerecht und senkrecht. */
function abstand(a: Kasten, b: Kasten): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
  return Math.hypot(dx, dy);
}

async function kasten(ziel: Locator, name: string): Promise<Kasten> {
  await expect(ziel, `${name}: genau ein Knoten`).toHaveCount(1);
  const k = await ziel.boundingBox();
  expect(k, `${name}: kein Kasten messbar`).not.toBeNull();
  return k!;
}

async function oeffneBenutzer(page: Page) {
  await page.goto('/admin/benutzer');
  await expect(page.locator('tr.ant-table-row').first()).toBeVisible();
}

const kopf = (page: Page) => page.locator('.ant-table-thead').first();
const ausloeser = (page: Page) => kopf(page).locator('.ant-table-filter-trigger');

for (const { dichte, viewport, boden } of STUFEN) {
  test.describe(`Katalogtabelle · Kopfwerkzeuge in ${dichte}`, () => {
    test.use({ viewport });

    test('Suche und Spaltenschalter halten Abstand, der Filter-Auslöser hält die Stufe', async ({
      page,
    }) => {
      await anmelden(page);
      await oeffneBenutzer(page);
      await stelleDichte(page, dichte);
      await expect(page.locator('tr.ant-table-row').first()).toBeVisible();

      const werkzeuge = page.locator('[data-lfh="katalog-werkzeuge"]');
      const suche = await kasten(werkzeuge.locator('.ant-input-search'), 'Suche');
      const schalter = await kasten(
        werkzeuge.getByRole('button', { name: /— Benutzer$/ }),
        'Spaltenschalter',
      );
      const soll = ZIELABSTAND[dichte];
      if (soll != null) {
        expect(
          abstand(suche, schalter),
          `Suche ↔ Spalten in ${dichte} (Soll ≥ ${soll} px)`,
        ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
      }

      const filter = await kasten(ausloeser(page), 'Filter-Auslöser „Status“');
      expect(
        Math.min(filter.width, filter.height),
        `Filter-Auslöser ${filter.width}×${filter.height} px, kurze Achse Soll ≥ ${boden}`,
      ).toBeGreaterThanOrEqual(boden - SUBPIXEL);

      // Kein anderes Bedienziel im Kopf steht näher als der Zielabstand: sortierbare Kopfzellen
      // (die ganze Zelle ist das Ziel) und weitere Auslöser. Die eigene Kopfzelle zählt nicht,
      // sie umschließt den Auslöser.
      if (soll != null) {
        const nachbarn = await kopf(page).evaluate((thead) => {
          const eigen = thead.querySelector('.ant-table-filter-trigger')!;
          const eigeneZelle = eigen.closest('th');
          return [...thead.querySelectorAll<HTMLElement>('th[tabindex], [role="button"]')]
            .filter((z) => z !== eigen && z !== eigeneZelle && !z.contains(eigen))
            .map((z) => {
              const r = z.getBoundingClientRect();
              return {
                name: z.textContent ?? '',
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
              };
            });
        });
        for (const n of nachbarn) {
          expect(
            abstand(filter, n),
            `Filter-Auslöser ↔ „${n.name}“ in ${dichte} (Soll ≥ ${soll} px)`,
          ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
        }
      }
    });
  });
}

test.describe('Katalogtabelle · Spaltenfilter per Tastatur', () => {
  test.use({ viewport: FUEKW });

  test('der Auslöser liegt in der Tab-Folge, zeigt den Fokus und öffnet mit Enter', async ({
    page,
  }) => {
    await anmelden(page);
    await oeffneBenutzer(page);

    // Vom Suchfeld aus vorwärts tabben, bis der Auslöser den Fokus hat: der Weg, den ein
    // Tastaturnutzer nimmt, kein `focus()` von außen.
    await page.getByPlaceholder('Name oder Benutzername').focus();
    const ziel = ausloeser(page);
    let erreicht = false;
    for (let schritt = 0; schritt < 40 && !erreicht; schritt += 1) {
      await page.keyboard.press('Tab');
      erreicht = await ziel.evaluate((k) => k === document.activeElement);
    }
    expect(erreicht, 'der Filter-Auslöser liegt in der Tab-Folge').toBe(true);
    await expect(ziel).toHaveAccessibleName('Status filtern');

    // Fokus sichtbar: ein Umriss in Bedienblau, nicht „kein Umriss“. Gepollt: antd legt
    // `transition: all` auf den Auslöser, der Ring blendet über `motionDurationSlow` ein.
    const bedien = await page.evaluate(() => {
      const p = document.createElement('div');
      p.style.color = getComputedStyle(document.documentElement).getPropertyValue('--lfh-bedien');
      document.body.append(p);
      const wert = getComputedStyle(p).color;
      p.remove();
      return wert;
    });
    await expect
      .poll(
        () =>
          ziel.evaluate((k) => {
            const s = getComputedStyle(k);
            return `${s.outlineStyle} ${parseFloat(s.outlineWidth)} ${s.outlineColor}`;
          }),
        { message: 'Fokusring am Filter-Auslöser: 2 px durchgezogen in `bedien`' },
      )
      .toBe(`solid 2 ${bedien}`);

    const menue = page.locator(
      '.ant-dropdown:not(.ant-dropdown-hidden) .ant-table-filter-dropdown',
    );
    await page.keyboard.press('Enter');
    await expect(menue).toBeVisible();
    // Die Kopfzelle daneben sortiert nicht mit (der Hörer hält das Ereignis an).
    await expect(kopf(page).locator('th[aria-sort]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(menue).toBeHidden();
    await expect(ziel, 'Escape gibt den Fokus an den Auslöser zurück').toBeFocused();
  });
});
