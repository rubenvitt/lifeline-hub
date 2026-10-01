import { expect, test, type Page } from '@playwright/test';
import { kachelnBeantworten, kartenConfigBeantworten } from './kartenFixture';
import { kartenpunktAufSeite, messeKante, type KantenStrahl } from './karten-pixel-kern';

/**
 * Kontur der Fachebenen-Punkte gegen den Kartengrund (LFH-600, Prüfliste Kriterium 5, WCAG
 * 1.4.11 ≥ 3 : 1). Die Punkte tragen eine Doppelkante, weiß 2 px am Zeichen und schwarz 2 px
 * darunter (`fachebenenLayer.ts`). Gemessen wird aus Pixeln (`karten-pixel-kern.ts`).
 *
 * GRUNDLAGEN: blind und offline je hell und dunkel, dazu Online-Stile mit festen Gründen, denn die
 * echten Online-Karten sind Fremdstile, die e2e nicht laden darf (hermetisch). Weiß und Schwarz
 * sind die Extreme, `#f5f5f3` und `#0f1115` der hellste und dunkelste Flächenton der eigenen
 * Palette (`basemapStil.ts`) — als Literale, sonst prüfte der Test die Palette gegen sich selbst.
 *
 * Die Füllfarbe gegen den Grund steht als Messwert in der Anmerkung, nicht als Schwelle: sie
 * darf auf einem gleichfarbigen Grund verschwinden, die Kontur nicht.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const THEMA_SCHLUESSEL = 'lifeline-hub.theme';

/** Die Probepunkte, je weit genug auseinander (0,01° ≈ 470 px bei Zoom 16). */
const PUNKTE = [
  { name: 'Pegel (Ebenenfarbe)', key: 'pegelonline', radius: 5, props: {}, ort: [9.2, 49.4] },
  {
    name: 'Hochwasser kein Hochwasser',
    key: 'hochwasser',
    radius: 4,
    props: { klasse: 'kein_hochwasser' },
    ort: [9.21, 49.4],
  },
  {
    name: 'Hochwasser sehr groß',
    key: 'hochwasser',
    radius: 9,
    props: { klasse: 'sehr_gross' },
    ort: [9.22, 49.4],
  },
  {
    name: 'KRITIS Einzelobjekt',
    key: 'kritis',
    radius: 5,
    props: { kategorie: 'krankenhaus' },
    ort: [9.23, 49.4],
  },
] as const;

const SCHALTER: Record<string, string> = {
  pegelonline: 'Pegel / Hochwasser',
  hochwasser: 'Hochwasser-Meldeklassen (LHP)',
  kritis: 'KRITIS / sensible Objekte',
};

/** Rand weiß von r bis r + 2, Kante schwarz von r + 2 bis r + 4; die Mitte der Füllung bei 0. */
const strahl = (r: number): KantenStrahl => ({
  rand: [r, r + 2],
  kante: [r + 2, r + 4],
  fuellung: 0,
});

type Grundlage =
  | { art: 'blind'; modus: 'light' | 'dark' }
  | { art: 'offline'; modus: 'light' | 'dark' }
  | { art: 'online'; grund: string };

const GRUNDLAGEN: Grundlage[] = [
  { art: 'blind', modus: 'light' },
  { art: 'blind', modus: 'dark' },
  { art: 'offline', modus: 'light' },
  { art: 'offline', modus: 'dark' },
  { art: 'online', grund: '#ffffff' },
  { art: 'online', grund: '#000000' },
  { art: 'online', grund: '#f5f5f3' },
  { art: 'online', grund: '#0f1115' },
];

const name = (g: Grundlage) => (g.art === 'online' ? `online ${g.grund}` : `${g.art} ${g.modus}`);
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function grundlageStellen(page: Page, g: Grundlage) {
  if (g.art === 'online') {
    const stil = `/api/karte/proxy/77/grund-${g.grund.slice(1)}/style.json`;
    await kartenConfigBeantworten(page, {
      online_styles: [{ name: `Grund ${g.grund}`, typ: 'vektor', url: stil }],
    });
    await page.route(`**${stil}`, (route) =>
      route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'grund', type: 'background', paint: { 'background-color': g.grund } }],
        },
      }),
    );
  } else if (g.art === 'offline') {
    const praefix = '/api/karte/offline/88/tiles/';
    await kartenConfigBeantworten(page, {
      offline_regionen: [
        {
          karte_id: 88,
          name: 'Fixture-Region',
          tiles_url: `${praefix}{z}/{x}/{y}?v=1`,
          format: 'vektor',
          maxzoom: 14,
        },
      ],
    });
    await kachelnBeantworten(page, praefix, 'strassen');
  } else {
    // Weder Online- noch Offline-Karte: die Lagekarte fällt auf den Blindstil.
    await kartenConfigBeantworten(page, {});
  }
  const modus = g.art === 'online' ? 'light' : g.modus;
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEMA_SCHLUESSEL, modus]);
}

async function fachebenenBeantworten(page: Page) {
  for (const key of Object.keys(SCHALTER)) {
    await page.route(`**/api/karte/fachebenen/${key}**`, (route) =>
      route.fulfill({
        json: {
          quelle: key,
          status: 'ok',
          attribution: `© Probe ${key}`,
          abgerufen: new Date().toISOString(),
          features: {
            type: 'FeatureCollection',
            features: PUNKTE.filter((p) => p.key === key).map((p) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: p.ort },
              properties: { titel: p.name, ...p.props },
            })),
          },
        },
      }),
    );
  }
}

async function springe(page: Page, center: readonly [number, number], zoom: number) {
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
        k.jumpTo({ center: [ll[0], ll[1]], zoom: z });
      }),
    [center, zoom] as const,
  );
}

/** Zeichnet die Karte den Punkt? `queryRenderedFeatures` sieht nur Platziertes. */
async function gezeichnet(page: Page, key: string, ll: readonly [number, number]) {
  return page.evaluate(
    ([k, ziel]) => {
      const karte = (
        window as unknown as {
          __lfhKarte: {
            project(ll: [number, number]): { x: number; y: number };
            queryRenderedFeatures(p: [number, number], o: { layers: string[] }): unknown[];
          };
        }
      ).__lfhKarte;
      const p = karte.project([ziel[0], ziel[1]]);
      return karte.queryRenderedFeatures([p.x, p.y], { layers: [`fachebene-${k}-circle`] }).length;
    },
    [key, ll] as const,
  );
}

async function setzeKante(page: Page, key: string, sichtbar: boolean) {
  await page.evaluate(
    ([k, an]) =>
      new Promise<void>((fertig) => {
        const karte = (
          window as unknown as {
            __lfhKarte: {
              once(e: string, f: () => void): void;
              setLayoutProperty(id: string, n: string, v: string): void;
              triggerRepaint(): void;
            };
          }
        ).__lfhKarte;
        karte.once('idle', () => fertig());
        karte.setLayoutProperty(`fachebene-${k}-kante`, 'visibility', an ? 'visible' : 'none');
        karte.triggerRepaint();
      }),
    [key, sichtbar] as const,
  );
}

for (const g of GRUNDLAGEN) {
  test(`Fachebenen-Punkte: Kontur ≥ 3 : 1 gegen den Grund (${name(g)})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    const seitenFehler: Error[] = [];
    page.on('pageerror', (f) => seitenFehler.push(f));
    await grundlageStellen(page, g);
    await fachebenenBeantworten(page);

    await page.goto('/login');
    await page.getByLabel('Benutzername').fill(ADMIN);
    await page.getByLabel('Passwort').fill(PW);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/einsaetze/);
    const antwort = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E 600 Kontrast ${Date.now()}` },
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
    for (const schalter of Object.values(SCHALTER)) {
      const knopf = page.getByRole('switch', { name: schalter });
      if ((await knopf.getAttribute('aria-checked')) !== 'true') await knopf.click();
      await expect(knopf).toHaveAttribute('aria-checked', 'true');
    }
    // Die Maus aus der Karte: ein Mauszeiger im Ausschnitt verfälschte die Pixel.
    await page.mouse.move(0, 0);

    const werte: string[] = [];
    for (const p of PUNKTE) {
      await springe(page, p.ort, 16);
      await expect
        .poll(() => gezeichnet(page, p.key, p.ort), {
          message: `${p.name}: Punkt gezeichnet (${name(g)})`,
          timeout: 20_000,
        })
        .toBe(1);
      const m = await messeKante(page, await kartenpunktAufSeite(page, p.ort), strahl(p.radius));
      if (g.art === 'online') {
        // Vorbedingung: gemessen wird wirklich gegen den gestellten Grund.
        expect(m.grund, `${p.name}: Grund (${name(g)})`).toBe(rgb(g.grund));
      }
      expect(m.beste, `${p.name} auf ${name(g)}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(3);
      werte.push(
        `${p.name}: Kontur ${m.beste.toFixed(2)} (weiß ${m.rand.toFixed(2)}, schwarz ${m.kante.toFixed(2)}), Füllung ${m.fuellung?.toFixed(2)} gegen ${m.grund}`,
      );
    }

    if (g.art === 'online' && g.grund === '#ffffff') {
      // Selbstprobe: ohne schwarze Kante trägt auf Weiß nur der weiße Rand — die Messung muss das
      // als unzureichend erkennen, sonst wäre sie grün durch Nichtstun.
      const p = PUNKTE[0];
      await springe(page, p.ort, 16);
      await setzeKante(page, p.key, false);
      const ohne = await messeKante(page, await kartenpunktAufSeite(page, p.ort), strahl(p.radius));
      expect(ohne.beste, `ohne Kante: ${JSON.stringify(ohne)}`).toBeLessThan(3);
      await setzeKante(page, p.key, true);
      werte.push(`Selbstprobe ohne Kante: ${ohne.beste.toFixed(2)}`);
    }

    test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
    expect(seitenFehler.map((f) => f.message)).toEqual([]);
  });
}
