import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';
import { einsatzPerApi } from './einsatz-kern';

/**
 * Der Einsatzname hat Vorrang in der Kopfleiste (LLH-1726, Spec `kopfleiste`).
 *
 * Vorher stand bei 1280 px vom Namen „ÜBUN…“ (50 von 198 px), im Handschuh-Betrieb bei 1180 px
 * „ÜBUNG – Sta…“: Ruhewörter („Benachrichtigung erlaubt“, „Ton bereit“), die Wortmarke und eine
 * Wachstumsquote 3 : 1 gegen die Suche nahmen ihm den Platz. Gemessen wird am Namen selbst: er
 * ist ungekürzt, wenn sein Text in EINER Zeile liegt. Gekürzt bricht er an beliebiger Stelle in
 * weitere Zeilen, die `-webkit-line-clamp: 1` verbirgt; gezählt werden die Zeilen über die
 * Rechtecke des Textknotens (`scrollHeight` meldet bei `line-clamp` nur die sichtbare Zeile).
 */

const NAME = 'ÜBUNG – Starkregen Musterstadt';
const LANG = `${NAME}, Deichverteidigung Abschnitt West mit Nachbarkreis, Lage 3 und Rückfall`;

/** Ruhezustand nachgebildet: Benachrichtigung erlaubt, Ton bereit (wie `kopfzeile-schmal`). */
async function ruhezustand(page: Page, dichte: 'kompakt' | 'komfortabel' | 'handschuh') {
  await page.addInitScript((stufe: string) => {
    localStorage.setItem('lifeline-hub.dichte', stufe);
    class ErlaubteBenachrichtigung {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
    }
    Object.defineProperty(window, 'Notification', {
      value: ErlaubteBenachrichtigung,
      configurable: true,
    });
    const AC = window.AudioContext;
    if (AC) {
      Object.defineProperty(AC.prototype, 'state', { configurable: true, get: () => 'running' });
      AC.prototype.resume = () => Promise.resolve();
    }
  }, dichte);
}

/** Der Namenstext im Wechsler und ob er gekürzt ist. */
async function nameMasse(page: Page) {
  const text = page.locator('[data-lfh="kopf-einsatzname"] button span').first();
  await expect(text).toBeVisible();
  return text.evaluate((el) => {
    const bereich = document.createRange();
    bereich.selectNodeContents(el);
    const zeilen = new Set(Array.from(bereich.getClientRects()).map((r) => Math.round(r.top))).size;
    return {
      gekuerzt: zeilen > 1,
      zeilen,
      breite: el.getBoundingClientRect().width,
      schrift: getComputedStyle(el).fontSize,
    };
  });
}

async function oeffne(page: Page, name: string) {
  await anmeldenAlsAdmin(page);
  const id = await einsatzPerApi(page, name);
  await page.goto(`/einsaetze/${id}/einsatzdaten`);
  await expect(page.locator('[data-lfh="kopf-sync"]')).toHaveAttribute('data-zustand', 'verbunden');
  return id;
}

for (const fall of [
  { viewport: { width: 1280, height: 800 }, dichte: 'kompakt' },
  { viewport: { width: 1180, height: 820 }, dichte: 'handschuh' },
] as const) {
  test(`${fall.viewport.width} px ${fall.dichte}: der Name steht ungekürzt in der Stufe kartentitel, Ruhezustände ohne Wort`, async ({
    page,
  }) => {
    await page.setViewportSize(fall.viewport);
    await ruhezustand(page, fall.dichte);
    await oeffne(page, NAME);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', fall.dichte);

    const masse = await nameMasse(page);
    expect(masse.gekuerzt, `Name gekürzt (Breite ${masse.breite} px)`).toBe(false);
    // Stufe `kartentitel` (15 px) in jeder Dichte, seit die Schriftgrößen aus der festen Skala
    // kommen (Spec `schriftstufen`, Einsatzwechsler 16 → `kartentitel`); als Literal, sonst prüfte
    // der Wert sich selbst.
    expect(masse.schrift).toBe('15px');

    // Ruhezustände ohne Wort: der Kopf trägt weder „Ton bereit“ noch „Benachrichtigung“ noch SYNC.
    const kopf = page.locator('header');
    await expect(kopf).not.toContainText('Ton bereit');
    await expect(kopf).not.toContainText('Benachrichtigung');
    await expect(kopf).not.toContainText('SYNC');
    // Unter 1600 px keine Wortmarke (Spec `app-marke`).
    await expect(kopf.getByRole('link', { name: 'lifeline-hub' })).toHaveCount(0);
  });
}

test('1024 px kompakt, langer Name: erst schrumpft die Suche auf die Lupe, dann kürzt der Name', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await ruhezustand(page, 'kompakt');
  await oeffne(page, LANG);

  const kopf = page.locator('header');
  const suche = kopf.getByRole('button', { name: 'Suchen' });
  await expect(suche).toBeVisible();
  // Vom Suchfeld bleibt die Lupe: Hinweistext und Kürzel sind weg, die Trefffläche hält 48 px.
  await expect(suche.locator('.kopf-suchfeld-text').first()).toBeHidden();
  const lupe = await suche.boundingBox();
  expect(lupe!.width).toBeGreaterThanOrEqual(48);
  expect(lupe!.width).toBeLessThan(80);
  // Erst jetzt kürzt der Name.
  expect((await nameMasse(page)).gekuerzt).toBe(true);
  // Und der Kopf läuft dabei nicht waagerecht über (Gate 1).
  const ueber = await kopf.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(ueber).toBeLessThanOrEqual(0);
});

test('1440 px kompakt, kurzer Name: die Suche zeigt ihren Hinweistext', async ({ page }) => {
  // Gegenprobe zum Fall darüber: ein grünes „Text weg“ belegte sonst nichts.
  await page.setViewportSize({ width: 1440, height: 900 });
  await ruhezustand(page, 'kompakt');
  await oeffne(page, NAME);
  const suche = page.locator('header').getByRole('button', { name: 'Suchen' });
  await expect(suche).toContainText('Modul, Einheit');
  await expect(suche.locator('kbd')).toBeVisible();
});

test.describe('Tablet mit Finger', () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });

  test('das Suchfeld zeigt kein Tastenkürzel', async ({ page }) => {
    await ruhezustand(page, 'komfortabel');
    await oeffne(page, NAME);
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    const suche = page.locator('header').getByRole('button', { name: 'Suchen' });
    await expect(suche).toBeVisible();
    await expect(suche.locator('kbd')).toHaveCount(0);
    await expect(suche).toHaveAttribute('aria-keyshortcuts', /K$/);
  });
});

/**
 * Am Handy mit „Ton blockiert“ (ohne Bediengeste meldet headless Chromium nach der Frist
 * „blockiert“) und drei ungelesenen Eingängen: die Plakette überdeckt das Wort nicht und nimmt
 * keine Breite. Die Zahl kommt aus einer umgeschriebenen Verlaufsantwort, damit kein zweites
 * Konto Meldungen säen muss.
 */
test('390 px: die Zählplakette überdeckt „Ton blockiert“ nicht und nimmt keine Breite', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Benachrichtigung erlaubt, Ton gesperrt: `resume()` antwortet nie, nach der Frist
  // (`ALARM_TON_FRIST_MS`) meldet die Alarmzentrale „Ton blockiert“.
  await page.addInitScript(() => {
    class ErlaubteBenachrichtigung {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
    }
    Object.defineProperty(window, 'Notification', {
      value: ErlaubteBenachrichtigung,
      configurable: true,
    });
    const AC = window.AudioContext;
    if (AC) {
      Object.defineProperty(AC.prototype, 'state', { configurable: true, get: () => 'suspended' });
      AC.prototype.resume = () => new Promise<void>(() => {});
    }
  });
  let ungelesen = 0;
  await page.route('**/api/incidents/*/notifications', async (route) => {
    const antwort = await route.fetch();
    const json = (await antwort.json()) as { ungelesen: number };
    await route.fulfill({ response: antwort, json: { ...json, ungelesen } });
  });
  await anmeldenAlsAdmin(page);
  const id = await einsatzPerApi(page, NAME);

  async function messe() {
    await page.goto(`/einsaetze/${id}/einsatzdaten`);
    const ziel = page.getByRole('button', { name: /^Alarmzentrale: Ton blockiert/ });
    await expect(ziel).toBeVisible({ timeout: 10_000 });
    await expect(ziel).toContainText('Ton blockiert');
    return ziel;
  }

  ungelesen = 3;
  const mit = await messe();
  await expect(mit).toHaveAccessibleName('Alarmzentrale: Ton blockiert, 3 Eingänge ungelesen');
  const plakette = mit.locator('[data-lfh="eingaenge-zahl"]');
  await expect(plakette).toHaveText('3');
  const p = (await plakette.boundingBox())!;
  const wort = (await mit.getByText('Ton blockiert').boundingBox())!;
  const ueberlappt =
    Math.min(p.x + p.width, wort.x + wort.width) > Math.max(p.x, wort.x) &&
    Math.min(p.y + p.height, wort.y + wort.height) > Math.max(p.y, wort.y);
  expect(ueberlappt, `Plakette ${JSON.stringify(p)} über Wort ${JSON.stringify(wort)}`).toBe(false);
  // Keine Breite: die Hülle aus Symbol und Plakette ist so breit wie das Symbol allein. Im
  // selben Bild gemessen; zwei Seitenaufrufe unterscheiden sich um Schriftlade-Pixel.
  const huelle = plakette.locator('xpath=..');
  const symbol = (await huelle.locator('svg').boundingBox())!;
  expect((await huelle.boundingBox())!.width).toBeCloseTo(symbol.width, 0);
});
