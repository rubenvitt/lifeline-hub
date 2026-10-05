import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Hilfen der Fernmeldeskizzen-Specs (LFH-893), geteilt von `fernmeldeskizze.spec.ts` und
 * `fernmeldeskizze-druck.spec.ts` — Muster `rollen-kern.ts`: wer einen Helfer braucht, nimmt ihn
 * von hier statt einer Kopie.
 */

export const FS_RUF = 'Florian Musterstadt 10/1';

export async function einsatzAnlegen(page: Page, bezeichnung: string): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(antwort.ok(), `Einsatz: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return String(((await antwort.json()) as { id: number }).id);
}

export function api(page: Page, einsatzId: string) {
  const basis = `/api/einsaetze/${einsatzId}`;
  const pruefe = async (was: string, antwort: Awaited<ReturnType<Page['request']['get']>>) => {
    expect(antwort.ok(), `${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
    return antwort;
  };
  return {
    async post<T = { id: number }>(pfad: string, data: unknown): Promise<T> {
      const a = await pruefe(`POST ${pfad}`, await page.request.post(`${basis}/${pfad}`, { data }));
      return (await a.json()) as T;
    },
    async put(pfad: string, data?: unknown) {
      await pruefe(`PUT ${pfad}`, await page.request.put(`${basis}/${pfad}`, { data }));
    },
    async patch(pfad: string, data: unknown) {
      await pruefe(`PATCH ${pfad}`, await page.request.patch(`${basis}/${pfad}`, { data }));
    },
    async get<T>(pfad: string): Promise<T> {
      const a = await pruefe(`GET ${pfad}`, await page.request.get(`${basis}/${pfad}`));
      return (await a.json()) as T;
    },
  };
}

export const flaeche = (page: Page) =>
  page.getByRole('group', { name: 'Fernmeldeskizze', exact: true });
export const element = (page: Page, key: string) =>
  page.locator(`[data-lfh="skizze-element"][data-key="${key}"]`);
export const paneel = (page: Page) => page.locator('[data-lfh="skizze-paneel"]');
export const skizzenPfad = (einsatzId: string) =>
  `/einsaetze/${einsatzId}/stab/funkplan?ansicht=skizze`;

/**
 * Öffnet die Skizze und wartet auf den Live-Strom (sonst verpasst ein Test, der danach eine
 * Änderung erwartet, das Ereignis) und auf einen Datenanker. Der Zeiger geht in die Ruhestellung
 * oben links: steht er über der Fläche, hält die ruhige Fläche (D4) das Layout fest.
 */
export async function oeffneSkizze(
  page: Page,
  einsatzId: string,
  anker: Locator,
  { zeiger = true }: { zeiger?: boolean } = {},
) {
  const strom = page.waitForResponse(
    (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
  );
  await page.goto(skizzenPfad(einsatzId));
  if (zeiger) await page.mouse.move(0, 0);
  await strom;
  await expect(anker).toBeVisible();
}

/** Linke obere Ecke des Platzes (erstes `rect` des Elements) in Skizzeneinheiten. */
export async function lage(el: Locator): Promise<{ x: number; y: number }> {
  return el.evaluate((g) => {
    const r = g.querySelector(':scope > rect')!;
    return { x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')) };
  });
}

/** Mitte eines Knotens in Bildschirmpunkten. */
export async function mitte(ziel: Locator): Promise<{ x: number; y: number }> {
  const k = (await ziel.boundingBox())!;
  return { x: k.x + k.width / 2, y: k.y + k.height / 2 };
}

/**
 * Holt die Fläche ganz ins Bild: über ihr stehen Druckkopf und Lücken-Paneel, am Fükw liegt sie
 * unter dem Falz. Zeigerkoordinaten gelten im Fenster, ein Zug außerhalb träfe nichts.
 */
export async function flaecheInsBild(page: Page) {
  await page
    .locator('[data-lfh="skizze-flaeche"]')
    .evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest' }));
}

/** Ein Zug mit echten Zeigerereignissen in Schritten (dnd-kit startet erst nach 6 px). */
export async function ziehe(
  page: Page,
  von: { x: number; y: number },
  nach: { x: number; y: number },
) {
  await page.mouse.move(von.x, von.y);
  await page.mouse.down();
  await page.mouse.move(von.x + 10, von.y + 10, { steps: 4 });
  await page.mouse.move(nach.x, nach.y, { steps: 12 });
  await page.mouse.up();
}

/** Schlüssel aller Stichleitungen (`sg-<id>~<stelle>`), sortiert. */
export async function stiche(page: Page): Promise<string[]> {
  return page
    .locator('[data-lfh="skizze-element"][data-key*="~"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-key')!).sort());
}

export interface Grundnetz {
  bnBos: number;
  f314: number;
  ea: number[];
  zug: number;
}

/**
 * Führungsstelle und drei Abschnitte an „TMO BN_BOS“, „EA 2“ zusätzlich an „DMO 314_F*“ (damit
 * die Schiene steht); mit `zug` der „1. Zug“ unter „EA 1“ an „TMO BN_BOS“.
 */
export async function seedeGrund(
  page: Page,
  einsatzId: string,
  { zug = true } = {},
): Promise<Grundnetz> {
  const a = api(page, einsatzId);
  const bnBos = (await a.post('sprechgruppen', { bezeichnung: 'BN_BOS', betriebsart: 'TMO' })).id;
  const f314 = (await a.post('sprechgruppen', { bezeichnung: '314_F*', betriebsart: 'DMO' })).id;
  await a.patch('fuehrungsstelle', { rufname: FS_RUF, sprechgruppe_ids: [bnBos] });
  const ea: number[] = [];
  for (const [i, name] of [
    'Einsatzabschnitt Nord',
    'Einsatzabschnitt Süd',
    'Einsatzabschnitt Mitte',
  ].entries()) {
    ea.push(
      (
        await a.post('abschnitte', {
          name,
          kurzbezeichnung: `EA ${i + 1}`,
          sprechgruppe_ids: i === 1 ? [bnBos, f314] : [bnBos],
        })
      ).id,
    );
  }
  const zugId = zug
    ? (
        await a.post('einheiten', {
          name: '1. Zug',
          funkrufname: 'Florian 1/1',
          abschnitt_id: ea[0],
          sprechgruppe_ids: [bnBos],
        })
      ).id
    : 0;
  return { bnBos, f314, ea, zug: zugId };
}
