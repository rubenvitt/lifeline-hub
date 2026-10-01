import { expect, test, type Page } from '@playwright/test';

/**
 * LFH-601: Die Statusmarke einer Fachebene („offline“, „keine Daten“) steht einzeilig, auch
 * neben einer Ebene mit Geltungszeile. Ohne `whiteSpace: 'nowrap'` an der Marke (`Sidebar.tsx`,
 * Fachebenen-Paneel) nahm die Spalte aus Name und Geltungszeile ihr den Platz, und das Wort brach
 * als „offli / ne“ um. „offline“ ist dort der einzige Hinweis, dass die Ebene leer ist, weil die
 * Quelle fehlt — ein zerrissenes Wort liest sich schlecht. jsdom rechnet kein Layout, deshalb hier.
 *
 * Gemessen wird an jeder Zeile, die die Marke zeigt; bbox-abhängige Ebenen zeigen bei zu weitem
 * Ausschnitt statt ihrer „näher heranzoomen“ und fallen dann heraus. Die drei Ebenen mit
 * Geltungszeile ohne bbox (Luftqualität, Strahlung, Autobahn) sind Pflicht.
 *
 * Eng wird es in „komfortabel“: in „kompakt“ bleibt der Marke Platz, in „handschuh“ bricht der
 * Namensteil unter den breiten Schalter und hat die volle Leiste. Mutationsprobe (01.10.2026):
 * ohne `nowrap` sind nur die beiden komfortabel-Tests rot.
 *
 * Hermetisch: jede Fachebene antwortet mit dem gewünschten Zustand aus `page.route`.
 */

const TABLET = { width: 1024, height: 768 };
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
/** Ebenen mit Geltungszeile, deren Marke nicht vom Kartenausschnitt abhängt (`fachebenen.ts`). */
const MIT_GELTUNG = ['autobahn', 'luftqualitaet', 'odl'];

const MARKE = { offline: 'offline', leer: 'keine Daten' } as const;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatz(page: Page, bezeichnung: string): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(antwort.ok(), `Seeding Einsatz: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

for (const zustand of ['offline', 'leer'] as const) {
  for (const dichte of ['kompakt', 'komfortabel', 'handschuh'] as const) {
    test(`Fachebenen-Paneel, Stufe ${dichte}: „${MARKE[zustand]}“ steht einzeilig`, async ({
      page,
    }) => {
      await page.route('**/api/karte/fachebenen/**', (route) => {
        const quelle = new URL(route.request().url()).pathname.split('/').pop();
        return route.fulfill({
          json: {
            quelle,
            status: zustand,
            attribution: '',
            features: { type: 'FeatureCollection', features: [] },
          },
        });
      });
      await page.addInitScript(
        ([schluessel, wert]) => window.localStorage.setItem(schluessel, wert),
        [DICHTE_SCHLUESSEL, dichte] as const,
      );
      await anmelden(page);
      const einsatzId = await einsatz(page, `Statusmarke ${zustand} ${dichte} ${Date.now()}`);
      await page.setViewportSize(TABLET);
      await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
      // Wache: trennt „Marke bricht um“ von „Stufe gar nicht angekommen“.
      await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

      const fachebenen = page.locator('section[data-paneel="fachebenen"]');
      const kopf = fachebenen.locator('button[aria-expanded]').first();
      if ((await kopf.getAttribute('aria-expanded')) === 'false') await kopf.click();
      await expect(kopf).toHaveAttribute('aria-expanded', 'true');

      const schalter = fachebenen.getByRole('switch');
      await expect(schalter.first()).toBeVisible();
      for (const s of await schalter.all()) {
        if ((await s.getAttribute('aria-checked')) !== 'true') await s.click();
      }

      // Vorbedingung: die Pflichtebenen zeigen ihre Marke. Ohne sie wäre die Messliste leer und
      // der Test grün.
      for (const key of MIT_GELTUNG) {
        const zeile = fachebenen.locator(`[data-fachebene="${key}"]`);
        await expect(
          zeile.locator('.ant-typography', { hasText: MARKE[zustand] }),
          `Vorbedingung: ${key} zeigt „${MARKE[zustand]}“`,
        ).toBeVisible();
        await expect(
          // Jede Geltungszeile setzt ihre Einschränkung mit Gedankenstrich ab (`fachebenen.ts`).
          zeile.locator('.ant-typography', { hasText: '—' }),
          `Vorbedingung: ${key} trägt eine Geltungszeile`,
        ).toBeVisible();
      }

      /**
       * Gemessen wird die Höhe gegen die Zeilenhöhe: die Marke ist im Flex-Container ein
       * Flex-Element und bleibt auch umgebrochen EIN Rechteck — `getClientRects()` sähe nichts.
       */
      const messung = await fachebenen.evaluate((paneel, wort) => {
        return [...paneel.querySelectorAll<HTMLElement>('[data-fachebene]')].flatMap((zeile) => {
          const marke = [...zeile.querySelectorAll<HTMLElement>('.ant-typography')].find(
            (el) => el.textContent?.trim() === wort,
          );
          if (!marke) return [];
          const zeilenhoehe = parseFloat(getComputedStyle(marke).lineHeight);
          return [
            {
              key: zeile.dataset.fachebene!,
              hoehe: marke.getBoundingClientRect().height,
              zeilenhoehe,
            },
          ];
        });
      }, MARKE[zustand]);

      expect(messung.map((m) => m.key)).toEqual(expect.arrayContaining(MIT_GELTUNG));
      // Wache: ein `line-height: normal` ergäbe NaN, und jeder Vergleich damit wäre still grün.
      for (const m of messung) {
        expect(m.zeilenhoehe, `Zeilenhöhe der Marke an ${m.key}`).toBeGreaterThan(0);
      }
      const umgebrochen = messung
        .filter((m) => m.hoehe > m.zeilenhoehe * 1.5)
        .map((m) => `${m.key} (${Math.round(m.hoehe)} px bei ${m.zeilenhoehe} px Zeilenhöhe)`);
      expect(umgebrochen, `„${MARKE[zustand]}“ bricht um (${dichte})`).toEqual([]);
      test.info().annotations.push({
        type: 'messwert',
        description: `${dichte}/${zustand}: ${messung.length} Marken gemessen`,
      });
    });
  }
}
