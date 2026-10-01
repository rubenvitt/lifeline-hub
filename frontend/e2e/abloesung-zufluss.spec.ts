import { expect, test, type Page } from '@playwright/test';

/**
 * Ablösung: eine FREMD angelegte Schicht verschiebt keine Karte, bis das Sammelbanner bedient
 * wird (WCAG 3.2.5). Ob das Banner seine Werkzeugzeile beim Erscheinen HÖHER macht — bei
 * 390 px und in höheren Dichtestufen, wenn Banner oder Segmentleiste umbrechen —, rechnet
 * jsdom nicht; deshalb drei Kontexte.
 *
 * DIE FREMDE SCHICHT KOMMT OBEN AN (kürzerer Rhythmus, die Server-Ordnung nach Fälligkeit
 * stellt sie vor die gezeigten) — landete sie unten, bewiese der Test nichts.
 *
 * „Fremd" heißt: am Frontend vorbei per API angelegt. Die Seite erkennt eigene Neuzugänge an
 * den Antworten ihrer eigenen Aufrufe; die Karte kommt über das Live-Ereignis `abloesung`.
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

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/**
 * Die Schriften kommen über `@font-face` und tauschen nach dem Laden die Zeilenmaße; unter Last
 * fiel der Tausch zwischen Vorher- und Nachher-Messung. Gemessen wird erst mit geladenen
 * Schriften.
 */
async function schriftenGeladen(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
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
    await schriftenGeladen(page);

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

/**
 * Der Nachtfall (LFH-707): die Zeitspalte zeigt heute „0540", an einem anderen Tag „020540".
 * Hing ihre Breite daran, brach die Karte nachts anders um als tags; der Test war um 23:40 rot
 * und mittags grün. Die Browserzone wird deshalb so gewählt, dass es dort beim Laden der Suite
 * 22 Uhr ist: die 6-h-Fälligkeit liegt dann am nächsten Tag (sechs Ziffern), die 30-min-Fälligkeit
 * nach der Änderung je nach Minute heute oder morgen. Die Zone gilt nur im Browser; der Server
 * rechnet in UTC, und die Einstufung hängt nur an absoluten Zeitpunkten.
 */
function zoneUm22Uhr(): string {
  let versatz = 22 - new Date().getUTCHours();
  if (versatz > 14) versatz -= 24;
  // `Etc/GMT-2` ist UTC+2: das Vorzeichen der Etc-Zonen ist umgekehrt.
  return versatz === 0 ? 'Etc/GMT' : `Etc/GMT${versatz > 0 ? '-' : '+'}${Math.abs(versatz)}`;
}

const UMORDNUNG_KONTEXTE: readonly {
  name: string;
  viewport: { width: number; height: number };
  dichte: string;
  zeitzone?: string;
}[] = [
  ...KONTEXTE,
  {
    name: 'mobil, nachts',
    viewport: { width: 390, height: 844 },
    dichte: 'komfortabel',
    zeitzone: zoneUm22Uhr(),
  },
];

/**
 * Eine FREMDE Rhythmusänderung ordnet vorhandene Karten nicht unter dem Cursor um. Die
 * geänderte Karte steht in der MITTE (die Server-Ordnung stellte sie nach oben), und gemessen
 * wird die Oberkante JEDER Karte: „Inhalt frisch" darf die geänderte Karte nicht höher machen.
 * Dazu die Breite jeder Zeitspalte: sie darf weder vom Tag noch von der Änderung abhängen.
 */
for (const kontext of UMORDNUNG_KONTEXTE) {
  test.describe(() => {
    if (kontext.zeitzone) test.use({ timezoneId: kontext.zeitzone });
    test(`Ablösung (${kontext.name}, ${kontext.dichte}): fremde Rhythmusänderung ordnet erst mit dem Banner um`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(kontext.viewport);
      await anmelden(page);

      const neu = await page.request.post('/api/einsaetze', {
        data: { bezeichnung: `E2E Umordnung ${kontext.name} ${Date.now()}` },
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
      const schichten: number[] = [];
      for (const name of ['Florian Nord 1', 'Florian Nord 2', 'Florian Nord 3']) {
        const einheit = await post('einheiten', { name, abschnitt_id: abschnitt.id }, name);
        schichten.push(
          (await post('abloesungen', { einheit_id: einheit.id, rhythmus_minuten: 360 }, name)).id,
        );
      }

      await page.goto(`/einsaetze/${einsatzId}/abloesung`);
      await stelleDichte(page, kontext.dichte);

      const karten = page.locator('[data-lfh="abloesung-karte"]');
      const banner = page.locator('[data-lfh="sammelbanner"]');
      await expect(karten).toHaveCount(3);
      await expect(banner).toHaveCount(0);
      await schriftenGeladen(page);
      const namen = () => karten.evaluateAll((ks) => ks.map((k) => k.getAttribute('aria-label')));
      const oberkanten = () =>
        karten.evaluateAll((ks) => ks.map((k) => k.getBoundingClientRect().top));
      const zeitspalten = () =>
        karten.evaluateAll((ks) =>
          ks.map((k) => (k.firstElementChild as HTMLElement).getBoundingClientRect().width),
        );
      const vorher = {
        namen: await namen(),
        oben: await oberkanten(),
        spalten: await zeitspalten(),
      };
      if (kontext.zeitzone) {
        // Vorbedingung des Nachtfalls: die Fälligkeit steht als Tag + Uhrzeit.
        await expect(karten.nth(1).locator('[data-lfh="abloesung-zeit"]')).toHaveText(/^\d{6}$/);
      }
      expect(vorher.namen).toEqual([
        'Schicht Florian Nord 1',
        'Schicht Florian Nord 2',
        'Schicht Florian Nord 3',
      ]);

      // Fremd geändert, am Frontend vorbei: 30 min Rhythmus → fällig vor den beiden anderen.
      const mitte = karten.nth(1);
      const aenderung = await page.request.patch(
        `/api/einsaetze/${einsatzId}/abloesungen/${schichten[1]}`,
        { data: { rhythmus_minuten: 30 } },
      );
      expect(aenderung.ok(), `fremde Änderung: ${aenderung.status()}`).toBeTruthy();

      await expect(banner).toBeVisible();
      await expect(banner).toContainText(
        'Reihenfolge geändert, 1 fällige Schicht steht weiter unten',
      );
      // Folge eingefroren, Inhalt frisch: die mittlere Karte trägt schon ihre neue Einstufung.
      await expect(mitte).toHaveAttribute('data-einstufung', 'vorwarnung');

      const nachher = {
        namen: await namen(),
        oben: await oberkanten(),
        spalten: await zeitspalten(),
      };
      expect(nachher.namen, 'keine Karte hat ihren Platz gewechselt').toEqual(vorher.namen);
      [...vorher.spalten, ...nachher.spalten].forEach((b) =>
        expect(
          Math.abs(b - vorher.spalten[0]),
          `Zeitspalten vorher ${vorher.spalten.join('/')}, mit Banner ${nachher.spalten.join('/')}`,
        ).toBeLessThanOrEqual(SUBPIXEL),
      );
      vorher.oben.forEach((y, i) =>
        expect(
          Math.abs(nachher.oben[i] - y),
          `Karte ${i + 1}: vorher y=${y}, mit Banner y=${nachher.oben[i]}`,
        ).toBeLessThanOrEqual(SUBPIXEL),
      );
      const breite = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(breite, 'kein waagerechter Überlauf').toBeLessThanOrEqual(kontext.viewport.width);

      await banner.getByRole('button', { name: 'anzeigen' }).click();
      await expect(karten.first()).toHaveAttribute('aria-label', 'Schicht Florian Nord 2');
      await expect(banner).toHaveCount(0);

      test.info().annotations.push({
        type: 'messwert',
        description:
          `${kontext.name}/${kontext.dichte}: Oberkanten ${vorher.oben.join('/')} → ` +
          `${nachher.oben.join('/')}` +
          (kontext.zeitzone ? ` (${kontext.zeitzone})` : ''),
      });
    });
  });
}
