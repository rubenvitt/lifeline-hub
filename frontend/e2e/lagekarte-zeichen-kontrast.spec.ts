import { expect, test, type Page } from '@playwright/test';
import { kartenConfigBeantworten } from './kartenFixture';
import { kartenpunktAufSeite } from './karten-pixel-kern';
import { einsatzAnlegen } from './fernmeldeskizze-kern';
import { FUEKW, anmelden, post } from './fuehrungsorganisation-kern';

/**
 * Zeichenkontrast auf der Lagekarte im Nachtbetrieb (LLH-1141, WCAG 1.4.11 ≥ 3 : 1): jedes
 * taktische Zeichen steht auf der hellen Unterlage (`zeichen/unterlage.ts`), sein Umriss hält
 * gegen die Unterlage und die Unterlage gegen den Kartengrund. Muster: „Zeichenkontrast“ der
 * Fernmeldeskizze (`fernmeldeskizze-ausstattung.spec.ts`), hier aus Pixeln der Kartenleinwand,
 * weil WebGL keine berechneten Stile hat (Kern wie `karten-pixel-kern.ts`). Der Einsatz entsteht
 * über die API: der Test prüft den Anlegedialog nicht (`e2e/AGENTS.md`, LFH-1114).
 *
 * Grundlage ist der Blindstil im Nachtbetrieb (`kartenConfigBeantworten` ohne Karten): ein
 * einfarbiger Grund `#0f1115`, der dunkelste Ton der eigenen Palette. Gemessen wird bei Zoom 11,
 * unter `BESCHRIFTUNG_AB_ZOOM`, damit keine Plakette im Ausschnitt steht; die Marker liegen
 * 0,1° auseinander (rund 145 px) und bündeln deshalb nicht.
 *
 * Messung je Zeichen in einem 80-px-Ausschnitt um den Kartenpunkt: Grund ist die Ecke oben links
 * (weit außerhalb des 34-px-Zeichens und des Statusrings), Unterlage das hellste und Umriss das
 * dunkelste Pixel im Quadrat des Zeichens. Ohne Unterlage ist das hellste Pixel eines Zeichens
 * ohne Organisation der Kartengrund selbst (der schwarze Umriss steht auf Durchsichtigem), die
 * Paarung Unterlage gegen Grund fällt auf rund 1 : 1, der Test wird rot. Ein Zeichen mit
 * Organisationsfarbe hielte auch ohne Unterlage; deshalb ist ein Zeichen ohne Organisation
 * (Einsatzort, freies Zeichen „Formation“) Vorbedingung.
 *
 * Mutationsprobe (22.10.2026): ohne `legeAufUnterlage` in `zeichneKartenZeichen` messen Einsatzort
 * und freies Zeichen Unterlage 1,00 und Umriss 1,10, der Test wird rot; mit Unterlage hält jedes
 * Zeichen 18,9 : 1 gegen den Grund und der Umriss 4,0 (Schaden, rot) bis 20 : 1.
 */

const THEMA_SCHLUESSEL = 'lifeline-hub.theme';
const BREITE = 49.35;
const LAENGE = 9.0;
const ZOOM = 11;
/** Halbe Kante des Zeichens auf der Karte (`ZEICHEN_KARTEN_PX` 34), ein Pixel Kantenglättung weg. */
const HALB = 16;

interface Probe {
  name: string;
  ort: readonly [number, number];
  /** Ohne Organisationsfarbe: schwarzer Umriss ohne Fläche, der eigentliche Prüffall. */
  ohneOrganisation: boolean;
}

const ort = (i: number) => [LAENGE + i * 0.1, BREITE] as const;

async function seede(page: Page, einsatzId: string): Promise<Probe[]> {
  const basis = `/api/einsaetze/${einsatzId}`;
  const pruefe = async (was: string, antwort: Awaited<ReturnType<Page['request']['patch']>>) =>
    expect(antwort.ok(), `${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();

  await pruefe(
    'Einsatzort',
    await page.request.patch(basis, {
      data: { einsatzort_lat: ort(0)[1], einsatzort_lon: ort(0)[0] },
    }),
  );

  const einheit = await post(page, einsatzId, 'einheiten', { name: 'Gruppe ohne Organisation' });
  await pruefe(
    'Einheit verorten',
    await page.request.patch(`${basis}/einheiten/${einheit}/position`, {
      data: { lat: ort(1)[1], lon: ort(1)[0] },
    }),
  );

  const fahrzeug = await post(page, einsatzId, 'fahrzeuge', {
    adhoc: { funkrufname: 'Fahrzeug Kontrast' },
  });
  await pruefe(
    'Fahrzeug verorten',
    await page.request.patch(`${basis}/fahrzeuge/${fahrzeug}/position`, {
      data: { lat: ort(2)[1], lon: ort(2)[0] },
    }),
  );

  await post(page, einsatzId, 'schaeden', {
    typ: 'sachschaden',
    ausmass: 'katastrophal',
    ort: 'Schaden Kontrast',
    lat: ort(3)[1],
    lon: ort(3)[0],
  });

  const uhs = await post(page, einsatzId, 'uhs', {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Kontrast',
  });
  await pruefe(
    'UHS verorten',
    await page.request.patch(`${basis}/uhs/${uhs}`, { data: { lat: ort(4)[1], lon: ort(4)[0] } }),
  );

  await post(page, einsatzId, 'freie-zeichen', {
    lat: ort(5)[1],
    lon: ort(5)[0],
    zeichen_spec: JSON.stringify({ v: 1, spec: { kind: 'formation' } }),
  });

  return [
    { name: 'Einsatzort', ort: ort(0), ohneOrganisation: true },
    { name: 'Einheit', ort: ort(1), ohneOrganisation: false },
    { name: 'Fahrzeug', ort: ort(2), ohneOrganisation: false },
    { name: 'Schaden', ort: ort(3), ohneOrganisation: false },
    { name: 'UHS', ort: ort(4), ohneOrganisation: false },
    { name: 'freies Zeichen', ort: ort(5), ohneOrganisation: true },
  ];
}

async function springe(page: Page, center: readonly [number, number]) {
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
    [center, ZOOM] as const,
  );
}

/** Steht am Kartenpunkt ein gezeichnetes Zeichen, und welches Bild trägt es? */
async function bildAm(page: Page, ll: readonly [number, number]) {
  return page.evaluate((ziel) => {
    const k = (
      window as unknown as {
        __lfhKarte: {
          project(ll: [number, number]): { x: number; y: number };
          queryRenderedFeatures(
            p: [number, number],
            o: { layers: string[] },
          ): { properties: { icon?: string } }[];
        };
      }
    ).__lfhKarte;
    const p = k.project([ziel[0], ziel[1]]);
    const treffer = k.queryRenderedFeatures([p.x, p.y], {
      layers: ['marker-symbol', 'marker-einsatzort-symbol'],
    });
    return treffer[0]?.properties.icon ?? null;
  }, ll);
}

interface ZeichenMessung {
  grund: string;
  unterlage: string;
  umriss: string;
  /** Unterlage gegen Kartengrund. */
  unterlageGrund: number;
  /** Umriss gegen Unterlage. */
  umrissUnterlage: number;
}

async function messeZeichen(page: Page, mitte: { x: number; y: number }): Promise<ZeichenMessung> {
  const png = await page.screenshot({
    clip: { x: mitte.x - 40, y: mitte.y - 40, width: 80, height: 80 },
  });
  return page.evaluate(
    async ([b64, halb]) => {
      const bild = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${b64}`)).blob(),
      );
      const c = document.createElement('canvas');
      c.width = bild.width;
      c.height = bild.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bild, 0, 0);
      const px = (x: number, y: number) =>
        Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
      const lum = ([r, g, b]: number[]) => {
        const l = [r, g, b].map((n) => {
          const t = n / 255;
          return t <= 0.04045 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4;
        });
        return l[0] * 0.2126 + l[1] * 0.7152 + l[2] * 0.0722;
      };
      const k = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const grund = px(2, 2);
      let hell = grund;
      let dunkel = grund;
      let hellL = -1;
      let dunkelL = 2;
      for (let y = 40 - halb; y <= 40 + halb; y++) {
        for (let x = 40 - halb; x <= 40 + halb; x++) {
          const p = px(x, y);
          const l = lum(p);
          if (l > hellL) [hell, hellL] = [p, l];
          if (l < dunkelL) [dunkel, dunkelL] = [p, l];
        }
      }
      const rgb = (p: number[]) => `rgb(${p.join(', ')})`;
      return {
        grund: rgb(grund),
        unterlage: rgb(hell),
        umriss: rgb(dunkel),
        unterlageGrund: k(hellL, lum(grund)),
        umrissUnterlage: k(dunkelL, hellL),
      };
    },
    [png.toString('base64'), HALB] as const,
  );
}

test('Zeichenkontrast: jedes taktische Zeichen hält auf der Lagekarte im Nachtbetrieb 3 : 1 gegen seinen Grund', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  // Weder Online- noch Offline-Karte: die Lagekarte fällt auf den Blindstil.
  await kartenConfigBeantworten(page, {});
  await page.addInitScript(([s, v]) => localStorage.setItem(s, v), [THEMA_SCHLUESSEL, 'dark']);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kartenzeichen ${Date.now()}`);
  const proben = await seede(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForFunction(
    () =>
      Boolean((window as unknown as { __lfhKarte?: { loaded(): boolean } }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
  // Die Maus aus der Karte: ein Zeiger im Ausschnitt verfälschte die Pixel.
  await page.mouse.move(0, 0);

  const werte: string[] = [];
  const befunde: string[] = [];
  for (const p of proben) {
    await springe(page, p.ort);
    // Vorbedingung: das Zeichen ist gezeichnet, und zwar als Bild mit Unterlage.
    await expect
      .poll(() => bildAm(page, p.ort), {
        message: `${p.name}: Zeichen gezeichnet`,
        timeout: 20_000,
      })
      .toMatch(/^ez\|unterlage\|/);
    const m = await messeZeichen(page, await kartenpunktAufSeite(page, p.ort));
    // Vorbedingung: gemessen wird wirklich gegen den dunklen Kartengrund des Blindstils.
    expect(m.grund, `${p.name}: Kartengrund`).toBe('rgb(15, 17, 21)');
    werte.push(
      `${p.name}: Unterlage ${m.unterlageGrund.toFixed(2)} gegen Grund, Umriss ${m.umrissUnterlage.toFixed(2)} gegen Unterlage (${m.umriss} auf ${m.unterlage} auf ${m.grund})`,
    );
    if (m.unterlageGrund < 3) befunde.push(`${p.name}: Unterlage ${m.unterlageGrund.toFixed(2)}`);
    if (m.umrissUnterlage < 3) befunde.push(`${p.name}: Umriss ${m.umrissUnterlage.toFixed(2)}`);
  }
  test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
  await page.screenshot({ path: test.info().outputPath('lagekarte-zeichen-nacht.png') });

  expect(proben.some((p) => p.ohneOrganisation)).toBe(true);
  expect(befunde, 'Zeichen unter 3 : 1 im Nachtbetrieb').toEqual([]);
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

test('Tagbetrieb: die Zeichen der Lagekarte tragen keine Unterlage', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await kartenConfigBeantworten(page, {});
  await page.addInitScript(([s, v]) => localStorage.setItem(s, v), [THEMA_SCHLUESSEL, 'light']);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kartenzeichen Tag ${Date.now()}`);
  const proben = await seede(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.waitForFunction(
    () =>
      Boolean((window as unknown as { __lfhKarte?: { loaded(): boolean } }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
  for (const p of proben) {
    await springe(page, p.ort);
    await expect
      .poll(() => bildAm(page, p.ort), {
        message: `${p.name}: Zeichen gezeichnet`,
        timeout: 20_000,
      })
      .toMatch(/^ez\|(?!unterlage\|)/);
  }
});
