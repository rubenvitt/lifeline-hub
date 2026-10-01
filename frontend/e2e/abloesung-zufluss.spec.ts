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

/** Vorlauf der festen Uhr: länger als jeder Testlauf samt Vorwarnzeit (30 min). */
const VORLAUF_MS = 60 * 60_000;

/**
 * Nächster Zeitpunkt `stunde:minute` in Europe/Berlin, mindestens `VORLAUF_MS` voraus (Sommer-
 * wie Winterzeit; der Versatz kommt aus `Intl`, nicht aus einer Konstante). In der ZUKUNFT, weil
 * der Server mit seiner echten Uhr rechnet: Läge die feste Uhr zurück, wären die Schichten für
 * ihn überfällig, der Erinnerungs-Scheduler schickte Hinweise in die AlarmZentrale, und deren
 * Toasts (`duration: 0`, oben rechts) könnten „anzeigen“ im Banner verdecken.
 */
function berlinNaechste(stunde: number, minute: number): Date {
  const teile = (d: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Berlin',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
        .formatToParts(d)
        .map((t) => [t.type, Number(t.value)]),
    ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute', number>;
  // Wandzeit Berlin (als UTC-Zahl gelesen) → Zeitpunkt; zweimal angenähert, falls der
  // Versatz zwischen Schätzung und Ziel wechselt.
  const zeitpunkt = (wandzeit: number) => {
    let t = wandzeit;
    for (let i = 0; i < 2; i++) {
      const w = teile(new Date(t));
      t -= Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - wandzeit;
    }
    return t;
  };
  const frueheste = Date.now() + VORLAUF_MS;
  const heute = teile(new Date(frueheste));
  const wandzeit = Date.UTC(heute.year, heute.month - 1, heute.day, stunde, minute);
  const ziel = zeitpunkt(wandzeit);
  return new Date(ziel >= frueheste ? ziel : zeitpunkt(wandzeit + 86_400_000));
}

/**
 * Eine FREMDE Rhythmusänderung ordnet vorhandene Karten nicht unter dem Cursor um. Die
 * geänderte Karte steht in der MITTE (die Server-Ordnung stellte sie nach oben), und gemessen
 * werden Oberkante und Höhe JEDER Karte: „Inhalt frisch" darf die geänderte Karte nicht höher
 * machen.
 *
 * GEGEN DIE UHR (LFH-708): Die Zeitspalte zeigt die Fälligkeit als `HHmm`, wenn sie heute liegt,
 * sonst als `DDHHmm`. Kurz vor Mitternacht liegen alle Fälligkeiten auf dem nächsten Tag. Mit
 * einer Spalte, die mit dem Text wuchs, brach die Karte dann anders um als am Tag, und mobil
 * sprang Karte 3 um 23 px. Deshalb läuft jeder Kontext mit fester Browser-Uhr am Tag UND um
 * 23:40. Die Schichten beginnen fünf Minuten vor der festen Uhr: Die Karte rechnet Einstufung
 * und Abstand gegen die Browser-Uhr, also steht die Fälligkeit wie im echten Lauf 6 h bzw.
 * 25 min voraus.
 */
const UHRZEITEN = [
  { name: 'Tag', stunde: 12, minute: 0 },
  { name: 'Mitternacht', stunde: 23, minute: 40 },
] as const;

test.describe('fremde Rhythmusänderung', () => {
  test.use({ timezoneId: 'Europe/Berlin' });

  for (const kontext of KONTEXTE)
    for (const uhr of UHRZEITEN) {
      test(`Ablösung (${kontext.name}, ${kontext.dichte}, ${uhr.name}): fremde Rhythmusänderung ordnet erst mit dem Banner um`, async ({
        page,
      }) => {
        test.setTimeout(60_000);
        const fest = berlinNaechste(uhr.stunde, uhr.minute);
        await page.clock.setFixedTime(fest);
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
            (
              await post(
                'abloesungen',
                {
                  einheit_id: einheit.id,
                  rhythmus_minuten: 360,
                  beginn_at: new Date(fest.getTime() - 5 * 60_000).toISOString(),
                },
                name,
              )
            ).id,
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
        const hoehen = () =>
          karten.evaluateAll((ks) => ks.map((k) => k.getBoundingClientRect().height));
        const zeitspalte = () =>
          karten.first().evaluate((k) => k.firstElementChild!.getBoundingClientRect().width);
        const vorher = { namen: await namen(), oben: await oberkanten(), hoehe: await hoehen() };
        expect(vorher.namen).toEqual([
          'Schicht Florian Nord 1',
          'Schicht Florian Nord 2',
          'Schicht Florian Nord 3',
        ]);
        // Die Zeit nimmt am Tag (`HHmm`) denselben Platz wie in der Nacht (`DDHHmm`): gemessen
        // gegen sechs Ziffern in derselben Schrift.
        const zeitBreite = await karten
          .first()
          .locator('[data-lfh="abloesung-zeit"]')
          .evaluate((el) => {
            const probe = el.cloneNode(false) as HTMLElement;
            probe.textContent = '000000';
            probe.style.minWidth = '0';
            probe.style.position = 'absolute';
            probe.style.visibility = 'hidden';
            el.parentElement!.appendChild(probe);
            const sechs = probe.getBoundingClientRect().width;
            probe.remove();
            return { zeit: el.getBoundingClientRect().width, sechs };
          });
        expect(
          zeitBreite.zeit,
          `Zeit ${zeitBreite.zeit}px, sechs Ziffern ${zeitBreite.sechs}px`,
        ).toBeGreaterThanOrEqual(zeitBreite.sechs - SUBPIXEL);

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

        const nachher = { namen: await namen(), oben: await oberkanten(), hoehe: await hoehen() };
        expect(nachher.namen, 'keine Karte hat ihren Platz gewechselt').toEqual(vorher.namen);
        vorher.oben.forEach((y, i) =>
          expect(
            Math.abs(nachher.oben[i] - y),
            `Karte ${i + 1}: vorher y=${y}, mit Banner y=${nachher.oben[i]}`,
          ).toBeLessThanOrEqual(SUBPIXEL),
        );
        vorher.hoehe.forEach((h, i) =>
          expect(
            Math.abs(nachher.hoehe[i] - h),
            `Karte ${i + 1}: vorher ${h}px hoch, mit Banner ${nachher.hoehe[i]}px`,
          ).toBeLessThanOrEqual(SUBPIXEL),
        );
        const breite = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(breite, 'kein waagerechter Überlauf').toBeLessThanOrEqual(kontext.viewport.width);
        const spalte = await zeitspalte();

        await banner.getByRole('button', { name: 'anzeigen' }).click();
        await expect(karten.first()).toHaveAttribute('aria-label', 'Schicht Florian Nord 2');
        await expect(banner).toHaveCount(0);

        test.info().annotations.push({
          type: 'messwert',
          description:
            `${kontext.name}/${kontext.dichte}/${uhr.name}: Zeitspalte ${spalte} px, ` +
            `Oberkanten ${vorher.oben.join('/')} → ${nachher.oben.join('/')}, ` +
            `Höhen ${vorher.hoehe.join('/')} → ${nachher.hoehe.join('/')}`,
        });
      });
    }
});

/**
 * Die Rhythmuszeile ist die Zeile, die eine fremde Änderung von Wert oder Quelle berührt. Sie
 * bleibt deshalb für jeden zulässigen Rhythmus einzeilig (LFH-708): 167 h 59 min als Vorgabe
 * ist der breiteste Text (224 px bei 15 px Schrift). Gemessen wird dort, wo am wenigsten Platz
 * ist, auf 390 px in `komfortabel` (252 px Inhalt) und `handschuh` (226 px Inhalt).
 */
for (const dichte of ['komfortabel', 'handschuh'] as const) {
  test(`Ablösung (mobil, ${dichte}): der längste Rhythmus bleibt einzeilig`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await anmelden(page);

    const neu = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E Rhythmuszeile ${dichte} ${Date.now()}` },
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
    const vorgabe = await page.request.put(
      `/api/einsaetze/${einsatzId}/abloesungen/vorgaben/${abschnitt.id}`,
      { data: { rhythmus_minuten: 7 * 24 * 60 - 1 } },
    );
    expect(vorgabe.ok(), `Seeding Vorgabe: ${vorgabe.status()}`).toBeTruthy();
    const einheit = await post(
      'einheiten',
      { name: 'Florian Nord 1', abschnitt_id: abschnitt.id },
      'Einheit',
    );
    await post('abloesungen', { einheit_id: einheit.id }, 'Schicht');

    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await stelleDichte(page, dichte);
    const zeile = page.locator('[data-lfh="abloesung-rhythmus"]');
    await expect(zeile).toHaveText('Rhythmus 167 h 59 min (Vorgabe)');
    await schriftenGeladen(page);

    const mass = await zeile.evaluate((el) => ({
      hoehe: el.getBoundingClientRect().height,
      zeilenhoehe: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(
      mass.hoehe,
      `Rhythmuszeile ${mass.hoehe}px bei Zeilenhöhe ${mass.zeilenhoehe}px`,
    ).toBeLessThanOrEqual(mass.zeilenhoehe + SUBPIXEL);
  });
}
