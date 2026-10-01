import { expect, test, type Page } from '@playwright/test';
import { kartenConfigBeantworten } from './kartenFixture';
import { kartenpunktAufSeite } from './karten-pixel-kern';

/**
 * Gültigkeit der DWD-Warnungen auf der Lagekarte (LFH-662, Spec `lagekarte-fachebenen`):
 * eine abgelaufene Warnung zeichnet die Karte nicht, eine angekündigte mit gestrichelter Kontur
 * (eigene Ebene `fachebene-dwd-line-angekuendigt`, `fachebenenLayer.ts`), eine geltende
 * durchgezogen. Der Inspector nennt die angekündigte als „angekündigt · ab …“ und die Schwere mit
 * der amtlichen DWD-Bezeichnung.
 *
 * Hermetisch: die DWD-Antwort kommt aus `page.route` und enthält die abgelaufene Warnung absichtlich
 * — der Server hätte sie entfernt, hier muss der Client (`dwdGueltigkeit.ts`) es tun. Blindstil
 * als Grundlage (`kartenConfigBeantworten` ohne Karten).
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const MITTE: [number, number] = [9.2, 49.4];

/** Achsenparalleles Quadrat um `mitte` mit halber Kantenlänge `halb` in Grad. */
function quadrat([lng, lat]: [number, number], halb: number) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - halb, lat - halb],
        [lng + halb, lat - halb],
        [lng + halb, lat + halb],
        [lng - halb, lat + halb],
        [lng - halb, lat - halb],
      ],
    ],
  };
}

const iso = (versatzMin: number) => new Date(Date.now() + versatzMin * 60_000).toISOString();

/** Drei Warnungen nebeneinander, je 0,004° breit, 0,006° Abstand der Mitten. */
const ORTE = {
  STURM: [MITTE[0] - 0.006, MITTE[1]] as [number, number],
  ABEND: [MITTE[0], MITTE[1]] as [number, number],
  FROST: [MITTE[0] + 0.006, MITTE[1]] as [number, number],
};

async function dwdBeantworten(page: Page) {
  const warnung = (EVENT: keyof typeof ORTE, p: Record<string, string>) => ({
    type: 'Feature',
    geometry: quadrat(ORTE[EVENT], 0.002),
    properties: { EVENT, HEADLINE: `Amtliche Warnung vor ${EVENT}`, ...p },
  });
  await page.route('**/api/karte/fachebenen/dwd**', (route) =>
    route.fulfill({
      json: {
        quelle: 'dwd',
        status: 'ok',
        attribution: 'Datenbasis: Deutscher Wetterdienst',
        abgerufen: new Date().toISOString(),
        features: {
          type: 'FeatureCollection',
          features: [
            // Gilt seit einer Stunde, noch drei Stunden.
            warnung('STURM', { SEVERITY: 'Severe', ONSET: iso(-60), EXPIRES: iso(180) }),
            // Beginnt in drei Stunden — angekündigt.
            warnung('ABEND', { SEVERITY: 'Minor', ONSET: iso(180), EXPIRES: iso(360) }),
            // Seit einer Stunde vorbei — darf nicht gezeichnet werden.
            warnung('FROST', { SEVERITY: 'Moderate', ONSET: iso(-240), EXPIRES: iso(-60) }),
          ],
        },
      },
    }),
  );
}

async function springe(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(
    ([ll, z]) =>
      new Promise<void>((fertig) => {
        const k = (
          window as unknown as {
            __lfhKarte: {
              once(e: string, f: () => void): void;
              jumpTo(o: { center: [number, number]; zoom: number }): void;
            };
          }
        ).__lfhKarte;
        k.once('idle', () => fertig());
        k.jumpTo({ center: ll, zoom: z });
      }),
    [center, zoom] as const,
  );
}

/** Welche Warnungen (EVENT) zeichnet eine Ebene im ganzen Ausschnitt? Sortiert, ohne Doppel. */
async function gezeichnet(page: Page, layer: string): Promise<string[]> {
  return page.evaluate((id) => {
    const k = (
      window as unknown as {
        __lfhKarte: {
          getLayer(id: string): unknown;
          queryRenderedFeatures(o: { layers: string[] }): { properties: { EVENT: string } }[];
        };
      }
    ).__lfhKarte;
    if (!k.getLayer(id)) return [];
    const events = k.queryRenderedFeatures({ layers: [id] }).map((f) => f.properties.EVENT);
    return [...new Set(events)].sort();
  }, layer);
}

test('DWD: abgelaufen fehlt, angekündigt gestrichelt, Inspector nennt „angekündigt“ (LFH-662)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await kartenConfigBeantworten(page, {});
  await dwdBeantworten(page);

  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E 662 DWD ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id } = (await antwort.json()) as { id: number };

  await page.goto(`/einsaetze/${id}/lagekarte`);
  await page.waitForFunction(
    () =>
      Boolean((window as unknown as { __lfhKarte?: { loaded(): boolean } }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
  const kopf = page.locator('section[data-paneel="fachebenen"] button[aria-expanded]').first();
  if ((await kopf.getAttribute('aria-expanded')) === 'false') await kopf.click();
  const schalter = page.getByRole('switch', { name: 'Wetterwarnungen (DWD)' });
  await schalter.click();
  await expect(schalter).toHaveAttribute('aria-checked', 'true');
  await springe(page, MITTE, 14);

  // Fläche: geltend und angekündigt, die abgelaufene fehlt.
  await expect
    .poll(() => gezeichnet(page, 'fachebene-dwd-fill'), { timeout: 20_000 })
    .toEqual(['ABEND', 'STURM']);
  // Jede Warnung hat genau eine Kontur: durchgezogen die geltende, gestrichelt die angekündigte.
  expect(await gezeichnet(page, 'fachebene-dwd-line')).toEqual(['STURM']);
  expect(await gezeichnet(page, 'fachebene-dwd-line-angekuendigt')).toEqual(['ABEND']);

  // Inspector der angekündigten Warnung.
  await page.mouse.move(0, 0);
  const p = await kartenpunktAufSeite(page, ORTE.ABEND);
  await page.mouse.click(p.x, p.y);
  const auswahl = page.locator('[data-lfh="auswahl"]');
  await expect(auswahl).toContainText('angekündigt · ab');
  await expect(auswahl.getByText('Wetterwarnung', { exact: true })).toHaveAttribute(
    'data-rolle',
    'achtung',
  );
  await test.info().attach('dwd-angekuendigt', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await auswahl.scrollIntoViewIfNeeded();
  await test.info().attach('dwd-angekuendigt-inspector', {
    body: await auswahl.screenshot(),
    contentType: 'image/png',
  });

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
