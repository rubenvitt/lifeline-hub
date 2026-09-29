import { expect, test, type Locator, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Die Lagekarten-Leiste trägt den mitwachsenden Kippschalter (im Handschuh 72 × 144 px, siehe
 * `switchMasse`). Die Leiste ist fest 300 px breit; die Schalterzeile bricht deshalb um
 * (`leistenZeileStil`/`namensteilStil` in `Sidebar.tsx`), statt Namen auf „…" zu kürzen oder
 * aus der Leiste zu ragen. Kompakt und komfortabel stehen mit, damit die Umbruchregel dort
 * keine Zeile bricht, die in eine passte.
 *
 * Nicht gemessen: „Weitere platzieren" (nur im Platzier-Modus, `Space wrap`) — dort bricht das
 * Wort unter den Schalter.
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
 * Boden für die sichtbare Namensbreite, als Literal: 8em bei 13,5 px Schrift sind 108 px,
 * darunter bricht der Name um.
 */
const NAMENSBODEN = 100;

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
    // Vorbedingung: ohne Zeilen wäre die Überstandsliste leer und der Test grün.
    await expect(schalter.first()).toBeVisible();
    expect(await schalter.count(), 'mindestens die neun Bestandsebenen').toBeGreaterThanOrEqual(9);
    /**
     * STRUKTURUNABHÄNGIG gemessen: jedes Element im Paneel, das rechts hinausragt. Ein Griff
     * nach dem Namensteil als Geschwister des Schalters hinge an der heutigen Zeilenstruktur.
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

/** Elemente eines Paneels, die rechts aus ihm ragen — strukturunabhängig (s. o.). */
function ueberstaende(paneel: Locator) {
  return paneel.evaluate((el, toleranz) => {
    const rand = el.getBoundingClientRect().right + toleranz;
    return [...el.querySelectorAll<HTMLElement>('*')]
      .filter((kind) => {
        const k = kind.getBoundingClientRect();
        return k.width > 0 && k.right > rand;
      })
      .map(
        (kind) =>
          `${kind.innerText.split('\n')[0] || kind.tagName} (+${Math.round(kind.getBoundingClientRect().right - rand)} px)`,
      );
  }, SUBPIXEL);
}

const SOLL = { kompakt: 30, komfortabel: 48, handschuh: 72 } as const;

/**
 * LFH-435, Nur-Lese-Zweig der Leiste: ohne Schreibrecht trägt die Bildzeile statt des
 * Aktionsmenüs einen direkten Zentrieren-Knopf, der Name ist nicht umbenennbar, der
 * Deckkraft-Schieber gesperrt und „Bild hochladen" fehlt (`Sidebar.tsx`, `darfSchreiben`). Die
 * Zeile ist damit anders gebaut als beim Admin: der Name bleibt lesbar, nichts ragt aus der
 * Leiste, und das verbleibende Ziel hält die Stufe.
 *
 * Nicht erreicht: die Aktion „Als maßgeblichen Pegel festlegen" im Fachebenen-Inspector
 * (`FachebenenInspector.tsx`) — der erscheint erst mit einem gewählten Pegel auf der Karte,
 * also nur mit externen Lagedaten.
 */
for (const dichte of ['kompakt', 'komfortabel', 'handschuh'] as const) {
  test(`Lagekarten-Leiste, Stufe ${dichte}: Schalterzeilen bleiben in der Leiste (Beobachter)`, async ({
    page,
  }) => {
    await anmelden(page);
    // Gesät (samt Bild) als Admin; der Beobachter darf nicht hochladen.
    const einsatzId = await einsatzMitBild(page, `Leiste lesend ${dichte} ${Date.now()}`);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await page.setViewportSize(TABLET);
    await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
      DICHTE_SCHLUESSEL,
      dichte,
    ] as const);
    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    for (const kennung of ['fachebenen', 'bilder']) {
      const kopf = page.locator(`section[data-paneel="${kennung}"] button[aria-expanded]`).first();
      if ((await kopf.getAttribute('aria-expanded')) === 'false') await kopf.click();
      await expect(kopf).toHaveAttribute('aria-expanded', 'true');
    }

    // ── VORBEDINGUNGEN: der Nur-Lese-Zweig der Bildzeile steht. Positiver Anker zuerst.
    const bilder = page.locator('section[data-paneel="bilder"]');
    const zentrieren = bilder.getByRole('button', { name: `${BILDNAME} zentrieren` });
    await expect(
      zentrieren,
      'Vorbedingung: ohne Schreibrecht steht der Zentrieren-Knopf direkt',
    ).toBeVisible();
    await expect(
      bilder.getByRole('button', { name: `Aktionen zu ${BILDNAME}` }),
      'Vorbedingung: ohne Schreibrecht kein Aktionsmenü an der Bildzeile',
    ).toHaveCount(0);
    await expect(
      bilder.getByRole('button', { name: /Bild hochladen/ }),
      'Vorbedingung: ohne Schreibrecht kein Upload',
    ).toHaveCount(0);
    await expect(
      bilder.locator('.ant-slider-disabled'),
      'Vorbedingung: der Deckkraft-Schieber ist gesperrt',
    ).toHaveCount(1);
    await expect(
      page.locator('section[data-paneel="zeichnen"]'),
      'Vorbedingung: ohne Schreibrecht kein Zeichnen-Paneel',
    ).toHaveCount(0);

    // ── Fachebenen: keine Beschriftung ragt aus der Leiste (wie beim Admin) ─────────
    const fachebenen = page.locator('section[data-paneel="fachebenen"]');
    const schalter = fachebenen.getByRole('switch');
    await expect(schalter.first()).toBeVisible();
    expect(await schalter.count(), 'mindestens die neun Bestandsebenen').toBeGreaterThanOrEqual(9);
    expect(await ueberstaende(fachebenen), `Elemente ragen aus der Leiste (${dichte})`).toEqual([]);

    // ── Bild-Hintergründe: der Name bleibt lesbar, nichts ragt hinaus ───────────────
    const name = bilder.locator('.ant-typography', { hasText: /Lageplan/ }).first();
    await expect(name).toBeVisible();
    const breite = (await name.boundingBox())!.width;
    expect(
      breite,
      `Bildname sichtbar breit (${dichte}, gemessen ${breite}px)`,
    ).toBeGreaterThanOrEqual(NAMENSBODEN);
    expect(await ueberstaende(bilder), `Bildzeile ragt aus der Leiste (${dichte})`).toEqual([]);

    // ── Trefffläche des verbleibenden Ziels der Bildzeile ────────────────────────────
    const kasten = (await zentrieren.boundingBox())!;
    expect(
      kasten.height,
      `Zentrieren-Knopf ${kasten.width}×${kasten.height}, Höhe Soll ≥ ${SOLL[dichte]}`,
    ).toBeGreaterThanOrEqual(SOLL[dichte] - SUBPIXEL);
    test.info().annotations.push({
      type: 'messwert',
      description: `Beobachter, Bildname in ${dichte}: ${Math.round(breite)}px breit, Zentrieren ${Math.round(kasten.width)}×${Math.round(kasten.height)}px`,
    });
  });
}
