import { expect, test, type Page } from '@playwright/test';

/**
 * Ablösung: eine FREMD angelegte Schicht verschiebt keine Karte, bis das Sammelbanner
 * bedient wird (LFH-647, Prüfliste LFH-635 Kriterium 12, WCAG 3.2.5).
 *
 * WARUM HIER UND NICHT NUR IN VITEST: `AbloesungPage.test.tsx` belegt, dass die Karte
 * zurückgehalten wird und dass das Banner in der Werkzeugzeile steht, die es vorher schon gab.
 * Ob das Banner diese Zeile beim Erscheinen HÖHER macht — und damit alle Karten doch nach
 * unten schiebt —, rechnet jsdom nicht. Genau das passiert, wenn Banner oder Segmentleiste
 * umbrechen, also bei 390 px und in den höheren Dichtestufen; deshalb drei Kontexte.
 *
 * DIE FREMDE SCHICHT KOMMT OBEN AN. Gesät sind zwei Schichten mit 6 h Rhythmus, die fremde
 * bekommt 30 min — die Server-Ordnung nach Fälligkeit stellt sie VOR die gezeigten. Landete
 * sie unten, verschöbe sich auch ohne Schleuse nichts, und der Test bewiese nichts.
 *
 * „FREMD" heißt hier: am Frontend vorbei per API angelegt. Die Seite erkennt eigene
 * Neuzugänge an den Antworten ihrer eigenen Aufrufe; ein `page.request.post` ist keiner.
 * Die Karte erreicht die Seite über das Live-Ereignis `abloesung`, wie im Betrieb.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const SUBPIXEL = 0.5;

const KONTEXTE = [
  { name: 'Fükw', viewport: { width: 1366, height: 768 }, dichte: 'kompakt' },
  { name: 'Führungs-Tablet', viewport: { width: 1024, height: 768 }, dichte: 'handschuh' },
  { name: 'mobil', viewport: { width: 390, height: 844 }, dichte: 'komfortabel' },
] as const;

// Helfer wie in `gate3-trefflaeche.spec.ts` — es gibt (noch) kein geteiltes e2e-Hilfsmodul.
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

for (const kontext of KONTEXTE) {
  test(`Ablösung (${kontext.name}, ${kontext.dichte}): fremde Schicht wartet hinter dem Banner, keine Karte verschiebt sich`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(kontext.viewport);
    await anmelden(page);

    const neu = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E Zufluss ${kontext.name} ${Date.now()}` },
    });
    expect(neu.ok(), `Seeding Einsatz: ${neu.status()}`).toBeTruthy();
    const einsatzId = ((await neu.json()) as { id: number }).id;
    const post = async (pfad: string, data: unknown, was: string) => {
      const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
      expect(
        antwort.ok(),
        `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
      ).toBeTruthy();
      return (await antwort.json()) as { id: number };
    };
    const abschnitt = await post('abschnitte', { name: 'Deichwache Nord' }, 'Abschnitt');
    const einheit = async (name: string) =>
      (await post('einheiten', { name, abschnitt_id: abschnitt.id }, name)).id;
    for (const name of ['Florian Nord 1', 'Florian Nord 2']) {
      await post('abloesungen', { einheit_id: await einheit(name), rhythmus_minuten: 360 }, name);
    }
    const fremdeEinheit = await einheit('Florian Süd 9');

    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await stelleDichte(page, kontext.dichte);

    const karten = page.locator('[data-lfh="abloesung-karte"]');
    const zeile = page.locator('[data-lfh="abloesung-werkzeugzeile"]');
    const banner = page.locator('[data-lfh="sammelbanner"]');
    await expect(karten).toHaveCount(2);
    await expect(banner).toHaveCount(0);

    const vorher = {
      erste: await karten.first().getAttribute('aria-label'),
      oben: (await karten.first().boundingBox())!.y,
      zeile: (await zeile.boundingBox())!.height,
    };

    // Fremd angelegt, mit kürzerem Rhythmus → fällig vor den beiden gezeigten.
    await post(
      'abloesungen',
      { einheit_id: fremdeEinheit, rhythmus_minuten: 30 },
      'fremde Schicht',
    );

    await expect(banner).toBeVisible();
    await expect(banner).toContainText('1 neue Schicht');
    // Der Kopf zählt die zurückgehaltene mit: die Zahl lügt nicht, nur die Karte wartet.
    await expect(page.getByText(/^3 laufend · \d fällig$/)).toBeVisible();

    const nachher = {
      erste: await karten.first().getAttribute('aria-label'),
      oben: (await karten.first().boundingBox())!.y,
      zeile: (await zeile.boundingBox())!.height,
    };
    await expect(karten).toHaveCount(2);
    expect(nachher.erste, 'die oberste Karte bleibt dieselbe').toBe(vorher.erste);
    expect(
      Math.abs(nachher.zeile - vorher.zeile),
      `Werkzeugzeile vorher ${vorher.zeile}px, mit Banner ${nachher.zeile}px`,
    ).toBeLessThanOrEqual(SUBPIXEL);
    expect(
      Math.abs(nachher.oben - vorher.oben),
      `oberste Karte vorher y=${vorher.oben}, mit Banner y=${nachher.oben}`,
    ).toBeLessThanOrEqual(SUBPIXEL);
    // Das Banner darf nicht über den Rand laufen (Gate 1).
    const breite = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(breite, 'kein waagerechter Überlauf').toBeLessThanOrEqual(kontext.viewport.width);

    await banner.getByRole('button', { name: 'anzeigen' }).click();
    await expect(karten).toHaveCount(3);
    await expect(karten.first()).toHaveAttribute('aria-label', 'Schicht Florian Süd 9');
    await expect(banner).toHaveCount(0);

    test.info().annotations.push({
      type: 'messwert',
      description:
        `${kontext.name}/${kontext.dichte}: Zeile ${vorher.zeile} → ${nachher.zeile} px, ` +
        `oberste Karte y ${vorher.oben} → ${nachher.oben}`,
    });
  });
}
