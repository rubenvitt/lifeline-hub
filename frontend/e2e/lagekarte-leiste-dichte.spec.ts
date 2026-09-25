import { expect, test, type Page } from '@playwright/test';

/**
 * Die Lagekarten-Leiste trägt den gewachsenen Kippschalter (LFH-380).
 *
 * Seit `switchMasse` (`theme/tokens.ts`) folgt der Schalter der Staffel und ist im Handschuh
 * 72 × 144 px. Die Leiste ist fest 300 px breit, nach der Polsterung des Klapppaneels bleiben
 * rund 247. VOR der Umbruchregel (`leistenZeileStil`/`namensteilStil` in `Sidebar.tsx`)
 * gemessen, am Führungs-Tablet mit 1024 px:
 *
 *   - der Bildname stand bei 19 px und zeigte nur noch „…" — der Name lebte allein im
 *     `aria-label`;
 *   - „Wetterwarnungen (DWD)" ragte 16 px, „Energieanlagen" 3 px aus der Leiste.
 *
 * Kompakt und komfortabel passten schon vorher; sie stehen hier mit, damit die Umbruchregel
 * dort keine Zeile bricht, die vorher in eine passte (die Bildzeile hielt komfortabel 107 px
 * Namensbreite in einer Zeile).
 *
 * Nicht gemessen: der Schalter „Weitere platzieren" (nur im laufenden Platzier-Modus sichtbar,
 * `Space wrap`) — dort bricht das Wort unter den Schalter, statt aus der Leiste zu ragen.
 */

const TABLET = { width: 1024, height: 768 };
const SUBPIXEL = 0.5;
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const BILDNAME = 'Lageplan Hallenbad Nordost';
/** 1 × 1-PNG: der Upload verlangt ein echtes Bild, die Geometrie ist hier gleichgültig. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Boden für die sichtbare Namensbreite. Handgeschriebenes Literal: 8em bei 13,5 px Schrift
 * sind 108 px, darunter bricht der Name um. Der Bestand vor LFH-380 lag bei 19 px (Handschuh).
 */
const NAMENSBODEN = 100;

// Login-/Anlege-Helfer kopiert — es gibt kein geteiltes e2e-Hilfsmodul (gleichlautend in den
// Bestands-Specs vermerkt).
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzMitBild(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)/)![1];
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/karte/hintergrundbilder`, {
    multipart: {
      datei: { name: 'plan.png', mimeType: 'image/png', buffer: PNG },
      ecken: JSON.stringify([
        [9.9, 52.3],
        [9.91, 52.3],
        [9.91, 52.29],
        [9.9, 52.29],
      ]),
      name: BILDNAME,
    },
  });
  expect(antwort.ok(), `Seeding Bild: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return einsatzId;
}

for (const dichte of ['kompakt', 'komfortabel', 'handschuh'] as const) {
  test(`Lagekarten-Leiste, Stufe ${dichte}: Schalterzeilen bleiben in der Leiste`, async ({
    page,
  }) => {
    await anmelden(page);
    const einsatzId = await einsatzMitBild(page, `Leiste ${dichte} ${Date.now()}`);
    await page.setViewportSize(TABLET);
    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
      DICHTE_SCHLUESSEL,
      dichte,
    ] as const);
    await page.reload();
    // Wache: trennt „Zeile zu schmal" von „Stufe gar nicht angekommen".
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    for (const kennung of ['fachebenen', 'bilder']) {
      const kopf = page.locator(`section[data-paneel="${kennung}"] button[aria-expanded]`).first();
      if ((await kopf.getAttribute('aria-expanded')) === 'false') await kopf.click();
      await expect(kopf).toHaveAttribute('aria-expanded', 'true');
    }

    // ── Fachebenen: keine Beschriftung ragt aus der Leiste ──────────────────────────
    const fachebenen = page.locator('section[data-paneel="fachebenen"]');
    const schalter = fachebenen.getByRole('switch');
    // Vorbedingung: ohne Zeilen wäre die Überstandsliste unten leer und der Test grün.
    await expect(schalter.first()).toBeVisible();
    expect(await schalter.count(), 'mindestens die neun Bestandsebenen').toBeGreaterThanOrEqual(9);
    /**
     * Gemessen wird STRUKTURUNABHÄNGIG: jedes Element im Paneel, das rechts über das Paneel
     * hinausragt. Ein Griff nach dem Namensteil als Geschwister des Schalters hinge an der
     * heutigen Zeilenstruktur — auf der früheren (antd-`Space` mit einer Hülle je Kind) liefe
     * er ins Leere, und die Gegenprobe wäre rot aus dem falschen Grund (gemessen: Timeout).
     */
    const ueberstand = await fachebenen.evaluate((paneel, toleranz) => {
      const rand = paneel.getBoundingClientRect().right + toleranz;
      return [...paneel.querySelectorAll<HTMLElement>('*')]
        .filter((el) => {
          const k = el.getBoundingClientRect();
          return k.width > 0 && k.right > rand;
        })
        .map(
          (el) =>
            `${el.innerText.split('\n')[0] || el.tagName} (+${Math.round(el.getBoundingClientRect().right - rand)} px)`,
        );
    }, SUBPIXEL);
    expect(ueberstand, `Elemente ragen aus der Leiste (${dichte})`).toEqual([]);

    // ── Bild-Hintergründe: der Name bleibt lesbar ───────────────────────────────────
    const bilder = page.locator('section[data-paneel="bilder"]');
    const name = bilder.locator('.ant-typography', { hasText: /Lageplan/ }).first();
    await expect(name).toBeVisible();
    const breite = (await name.boundingBox())!.width;
    expect(
      breite,
      `Bildname sichtbar breit (${dichte}, gemessen ${breite}px)`,
    ).toBeGreaterThanOrEqual(NAMENSBODEN);
    test.info().annotations.push({
      type: 'messwert',
      description: `Bildname in ${dichte}: ${Math.round(breite)}px breit`,
    });
  });
}
