import { expect, test, type Locator, type Page } from '@playwright/test';
import { einsatzdatenPfad, stabPfad, ueberblickPfad } from '../src/routing/deeplinks';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * LFH-961 — eine leere Spur im Fugenraster zeigt `flaeche`, keine graue Kachel in `linie`, und
 * zwischen belegten Zellen bleibt die Fuge 1 px.
 *
 * Vor dem Fix lag `linie` als Grund unter dem ganzen Raster (`kennzahlenbandStil`,
 * `datenrasterStil`). Fünf Kennzahlen in zwei Spalten (Überblick, 390 px) oder vier Kopfangaben in
 * drei Spalten (Einsatzdaten, 820/1180 px) ließen eine Restspur frei, und dort schien der Grund
 * flächig durch. Jetzt ist der Grund `flaeche`, und jede Zelle zeichnet ihre Fuge als Umriss
 * (`components/instrument/fugenraster.ts`, Regel in `theme/sprache.css`).
 *
 * GEMESSEN AM PIXEL, nicht am Stil: ein Grund in `flaeche` ohne Fuge bestünde eine Stilprüfung
 * und sähe aus wie eine Fläche ohne Raster. Deshalb zwei Proben je Raster: die Mitte der
 * Restspur muss `flaeche` tragen, die Lücke zwischen zwei Nachbarn `linie`, und 2 px daneben
 * liegt schon die Zelle. Mutationsproben: `background: rollen.linie` zurück macht die Restspur
 * rot, die Regel `[data-fugenraster] > *` entfernt macht die Fuge rot.
 *
 * Der Stab hat nach dem Fix KEINE Restspur mehr (zwei Spalten statt drei, „Letzte“ läuft breit);
 * dort ist die Spaltenzahl die Aussage.
 *
 * ROLLEN (LFH-435, `e2e/AGENTS.md`): jede Seite auch als Beobachter. Die Kopfangaben der
 * Einsatzdaten sind ohne Schreibrecht Text statt Knopf, der Überblick zeigt gesperrte Kennzahlen
 * mit „—“; die Raster bleiben dieselben, die Vorbedingung (Inhaltsanker steht) gilt für beide.
 */

type Rgb = [number, number, number];

interface Probe {
  x: number;
  y: number;
}

interface Vermessung {
  /** Spaltenzahl laut `grid-template-columns`. */
  spalten: number;
  /** Mitte der Restspur rechts der letzten Zelle; `null`, wenn die letzte Reihe voll ist. */
  rest: Probe | null;
  /** Lücke zwischen den ersten beiden Zellen einer Reihe, dazu je ein Punkt 2 px innerhalb. */
  fuge: { luecke: Probe; links: Probe; rechts: Probe } | null;
}

/** Misst das Raster im Browser: Spalten, Restspur und die erste Fuge (Seitenkoordinaten). */
function vermesse(raster: Locator): Promise<Vermessung> {
  return raster.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const innenRechts = r.right - el.clientLeft;
    const zellen = Array.from(el.children).map((k) => k.getBoundingClientRect());
    const spalten = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
    const letzte = zellen[zellen.length - 1];
    const rest =
      innenRechts - letzte.right > 4
        ? {
            x: Math.floor((letzte.right + 1 + innenRechts) / 2),
            y: Math.floor(letzte.top + letzte.height / 2),
          }
        : null;
    let fuge: Vermessung['fuge'] = null;
    for (let i = 0; i + 1 < zellen.length && fuge == null; i++) {
      const a = zellen[i];
      const b = zellen[i + 1];
      if (Math.abs(a.top - b.top) > 0.5) continue;
      const y = Math.floor(a.top + Math.min(a.height, b.height) / 2);
      fuge = {
        luecke: { x: Math.floor((a.right + b.left) / 2), y },
        links: { x: Math.floor(a.right) - 3, y },
        rechts: { x: Math.ceil(b.left) + 2, y },
      };
    }
    return { spalten, rest, fuge };
  });
}

/** Liest die Farben der Proben aus einem Bildschirmfoto (im Browser dekodiert). */
async function pixel(page: Page, proben: Probe[]): Promise<Rgb[]> {
  const png = await page.screenshot();
  return page.evaluate(
    async ([b64, ps]) => {
      const bild = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${b64}`)).blob(),
      );
      const c = document.createElement('canvas');
      c.width = bild.width;
      c.height = bild.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bild, 0, 0);
      return ps.map(
        (p) =>
          Array.from(ctx.getImageData(p.x, p.y, 1, 1).data.slice(0, 3)) as [number, number, number],
      );
    },
    [png.toString('base64'), proben] as const,
  );
}

/** Die Rollenfarbe als RGB, aus der Variablen des laufenden Themas. */
function rolle(page: Page, name: 'linie' | 'flaeche'): Promise<Rgb> {
  return page.evaluate((n) => {
    const c = document.createElement('div');
    c.style.color = `var(--lfh-${n})`;
    document.body.appendChild(c);
    const [r, g, b] = getComputedStyle(c).color.match(/\d+/g)!.map(Number);
    c.remove();
    return [r, g, b] as [number, number, number];
  }, name);
}

const gleich = (a: Rgb, b: Rgb) => a.every((v, i) => Math.abs(v - b[i]) <= 2);

/** Restspur in `flaeche`, Fuge in `linie` und 1 px breit. */
async function pruefeRaster(page: Page, raster: Locator, restErwartet: boolean) {
  const [linie, flaeche] = [await rolle(page, 'linie'), await rolle(page, 'flaeche')];
  expect(gleich(linie, flaeche), 'linie und flaeche wären nicht unterscheidbar').toBe(false);
  const v = await vermesse(raster);
  if (restErwartet) {
    expect(v.rest, 'keine Restspur — das Gate mäße nichts; Layout geändert?').not.toBeNull();
  }
  expect(v.fuge, 'keine zwei Zellen nebeneinander').not.toBeNull();
  const proben = [v.fuge!.luecke, v.fuge!.links, v.fuge!.rechts, ...(v.rest ? [v.rest] : [])];
  const [luecke, links, rechts, rest] = await pixel(page, proben);
  expect(gleich(luecke, linie), `Fuge ${luecke} statt linie ${linie}`).toBe(true);
  expect(gleich(links, linie), `Fuge breiter als 1 px (links ${links})`).toBe(false);
  expect(gleich(rechts, linie), `Fuge breiter als 1 px (rechts ${rechts})`).toBe(false);
  if (rest) {
    expect(gleich(rest, linie), `Restspur in linie ${rest}`).toBe(false);
    expect(gleich(rest, flaeche), `Restspur ${rest} statt flaeche ${flaeche}`).toBe(true);
  }
  return v;
}

async function einsatzAnlegen(page: Page): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Fugenraster ${Date.now()}` },
  });
  expect(r.ok(), `Einsatz anlegen: ${r.status()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

const ROLLEN = ['admin', 'beobachter'] as const;

/** Meldet als Admin an, legt den Einsatz an und wechselt bei Bedarf auf den Beobachter. */
async function vorbereiten(page: Page, rolleName: (typeof ROLLEN)[number]): Promise<number> {
  await anmeldenAlsAdmin(page);
  const id = await einsatzAnlegen(page);
  if (rolleName === 'beobachter') await wechsleZuRolle(page, 'beobachter', String(id));
  return id;
}

for (const rolleName of ROLLEN) {
  test(`Überblick 390 px (${rolleName}): Restspur im Band „Lage in Zahlen“ ist Fläche`, async ({
    page,
  }) => {
    const id = await vorbereiten(page, rolleName);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ueberblickPfad(id));
    const band = page.getByRole('group', { name: 'Lage in Zahlen' });
    await expect(band.getByText('Einsatzabschnitte', { exact: true })).toBeVisible();
    await expect(band.locator('[aria-busy="true"]')).toHaveCount(0);
    const v = await pruefeRaster(page, band, true);
    expect(v.spalten).toBe(2);
  });

  for (const breite of [820, 1180]) {
    test(`Einsatzdaten ${breite} px (${rolleName}): Restspur neben „Einsatzleitung“ ist Fläche`, async ({
      page,
    }) => {
      const id = await vorbereiten(page, rolleName);
      await page.setViewportSize({ width: breite, height: 900 });
      await page.goto(einsatzdatenPfad(id));
      const kopf = page.locator('[data-fugenraster]').filter({ hasText: 'Einsatzleitung' });
      await expect(kopf.getByText('Einsatzstichwort', { exact: true })).toBeVisible();
      await pruefeRaster(page, kopf, true);
    });
  }

  for (const breite of [820, 1440]) {
    test(`Stab ${breite} px (${rolleName}): Stand der Lagebesprechung ohne leere Spur`, async ({
      page,
    }) => {
      const id = await vorbereiten(page, rolleName);
      await page.setViewportSize({ width: breite, height: 900 });
      await page.goto(stabPfad(id));
      const raster = page.getByLabel('Stand der Lagebesprechung');
      await expect(raster.getByText('noch keine', { exact: true })).toBeVisible();
      const v = await pruefeRaster(page, raster, false);
      expect(v.spalten).toBe(2);
      expect(v.rest, 'die letzte Reihe des Stands ist voll').toBeNull();
      // „noch keine“ steht einmal; die Historie wiederholt es nicht.
      await expect(page.getByText('Noch keine Lagebesprechung abgeschlossen')).toHaveCount(0);
    });
  }
}
