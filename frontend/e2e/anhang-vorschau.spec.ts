import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FOTO_JPEG } from './bildFixture';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Bildvorschau an Anhängen im Browser (LFH-759, Spec `anhang-vorschau`): das Vorschaubild vom
 * Server an einem Schadenfoto, die Großansicht in der App (Escape, Fokus zurück) und die
 * HEIC-Vorschau, die der Browser selbst dekodiert (Worker + WASM). Keine Anfrage lädt das
 * Original. Als Beobachter, denn die Vorschau hängt an keiner Rolle.
 *
 * Geklickt, nicht nur `toBeVisible`. Kein `networkidle` (SSE-Strom).
 */
const FUEKW = { width: 1280, height: 900 };
const HEIC = readFileSync(join(process.cwd(), 'src/heic/__fixtures__/hochkant.heic'));

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.goto('/einsaetze');
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

async function schadenMitFoto(page: Page, einsatzId: string): Promise<number> {
  const schaden = await page.request.post(`/api/einsaetze/${einsatzId}/schaeden`, {
    data: { typ: 'sachschaden', ausmass: 'gering', ort: 'Hauptstr. 1' },
  });
  expect(schaden.ok(), await schaden.text()).toBeTruthy();
  const schadenId = (await schaden.json()).id as number;
  for (const name of ['dach.jpg', 'giebel.jpg']) {
    const antwort = await page.request.post(
      `/api/einsaetze/${einsatzId}/schaeden/${schadenId}/anhaenge`,
      { multipart: { datei: { name, mimeType: 'image/jpeg', buffer: FOTO_JPEG } } },
    );
    expect(antwort.status(), await antwort.text()).toBe(201);
  }
  return schadenId;
}

async function etbEintragMitHeic(page: Page, einsatzId: string) {
  const anhang = await page.request.post(`/api/einsaetze/${einsatzId}/etb/anhaenge`, {
    multipart: { datei: { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: HEIC } },
  });
  expect(anhang.status(), await anhang.text()).toBe(201);
  const aid = (await anhang.json())[0].id as number;
  const eintrag = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
    data: {
      typ: 'meldung',
      von: 'ELW 1',
      an: 'Leitstelle',
      inhalt: 'Foto vom Dach',
      anhang_ids: [aid],
    },
  });
  expect(eintrag.status(), await eintrag.text()).toBe(201);
}

/** Wartet, bis das Bild wirklich dekodiert ist, und liefert seine natürlichen Maße. */
async function geladeneMasse(page: Page, selektor: string) {
  const img = page.locator(selektor);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  return img.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]);
}

test('Vorschau und Großansicht eines Schadenfotos, HEIC aus dem ETB, nie das Original', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  const anfragen: string[] = [];
  page.on('request', (r) => anfragen.push(r.url()));

  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Vorschau ${Date.now()}`);
  const schadenId = await schadenMitFoto(page, einsatzId);
  await etbEintragMitHeic(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  // ── 1 · Vorschaubild vom Server ─────────────────────────────────────────────────────
  await page.goto(`/einsaetze/${einsatzId}/schaeden/${schadenId}`);
  const paneel = page.getByRole('region', { name: 'Fotos und Dateien' });
  // Neueste zuerst: `giebel.jpg` steht oben, `dach.jpg` darunter.
  const knopf = paneel.getByRole('button', { name: /^Vorschau: giebel\.jpg, Schaden / });
  await expect(knopf).toBeVisible();
  const kachel = await geladeneMasse(page, '[data-lfh="anhang-vorschau"] img >> nth=0');
  expect(kachel[0]).toBeGreaterThan(0);
  // Der Download-Verweis daneben ist unverändert.
  await expect(paneel.getByRole('link', { name: /^dach\.jpg, / })).toHaveAttribute(
    'href',
    new RegExp(`/schaeden/${schadenId}/anhaenge/\\d+/datei$`),
  );

  // ── 2 · Großansicht in der App, Blättern, Escape, Fokus zurück ──────────────────────
  await knopf.click();
  const ansicht = page.locator('.ant-image-preview');
  await expect(ansicht).toBeVisible();
  const gross = ansicht.locator('img.ant-image-preview-img');
  await expect(gross).toHaveAttribute('src', /fassung=grossansicht$/);
  await expect.poll(() => gross.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(64);
  const erste = await gross.getAttribute('src');
  await page.keyboard.press('ArrowRight');
  await expect(gross).not.toHaveAttribute('src', erste!);
  await page.keyboard.press('Escape');
  await expect(ansicht).toBeHidden();
  await expect(knopf).toBeFocused();

  // Bis hier war kein HEIC zu sehen: weder Decoder-Modul noch Worker noch WASM sind geladen.
  expect(anfragen.filter((u) => /libheif|heicWorker|dekodiereHeic/.test(u))).toEqual([]);

  // ── 3 · HEIC, auf dem Gerät dekodiert ───────────────────────────────────────────────
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const heicKnopf = page.getByRole('button', { name: /^Vorschau: IMG_0001\.HEIC, Anhang zu Nr\./ });
  await expect(heicKnopf).toBeVisible({ timeout: 30_000 });
  const heicImg = heicKnopf.locator('img');
  await expect(heicImg).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => heicImg.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
  const [breite, hoehe] = await heicImg.evaluate((i: HTMLImageElement) => [
    i.naturalWidth,
    i.naturalHeight,
  ]);
  expect(hoehe, 'Drehung aus irot angewendet: hochkant').toBeGreaterThan(breite);

  expect(
    anfragen.some((u) => /libheif.*\.wasm/.test(u)),
    'der Decoder kam erst jetzt',
  ).toBe(true);
  expect(anfragen.filter((u) => u.includes('fassung=original'))).toEqual([]);
});
