import { expect, test, type Locator, type Page } from '@playwright/test';
import { kontrast, pruefe } from './kontrast-kern';

async function vorbereiten(page: Page, modus: 'light' | 'dark') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(`Kontrast ${modus} ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
  return `/einsaetze/${page.url().match(/\/einsaetze\/(\d+)/)![1]}`;
}

async function post(page: Page, pfad: string, data: unknown) {
  const response = await page.request.post(`/api${pfad}`, { data });
  expect(response.ok(), `${pfad}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

for (const modus of ['light', 'dark'] as const) {
  const minimum = modus === 'light' ? 7 : 5;
  test(`${modus}: sechs SK-Auswahlflächen auf Route und im Modal`, async ({ page }) => {
    test.setTimeout(90_000);
    const basis = await vorbereiten(page, modus);
    for (const ort of ['route', 'modal']) {
      await page.goto(`${basis}/personen${ort === 'route' ? '/aufnahme' : ''}`);
      if (ort === 'modal') await page.getByRole('button', { name: 'Schnellerfassung' }).click();
      const gruppe = page.locator('#sichtung');
      await expect(gruppe.locator('.ant-tag')).toHaveText([
        'SK I',
        'SK II',
        'SK III',
        'SK IV',
        'tot',
        'unverletzt',
      ]);
      for (const label of ['SK I', 'SK II', 'SK III', 'SK IV', 'tot', 'unverletzt']) {
        const tag = gruppe.locator('.ant-tag').filter({ hasText: new RegExp(`^${label}$`) });
        await page.mouse.move(0, 0);
        await pruefe(tag, minimum, `${modus}/${ort}/${label}/ungewählt`);
        await tag.hover();
        await pruefe(tag, minimum, `${modus}/${ort}/${label}/hover`);
        await tag.click();
        await expect(gruppe.getByRole('radio', { checked: true })).toHaveCount(1);
        await expect(gruppe.getByRole('radio', { name: label, exact: true })).toBeChecked();
        await pruefe(tag, minimum, `${modus}/${ort}/${label}/gewählt+hover`);
        await page.mouse.move(0, 0);
        await pruefe(tag, minimum, `${modus}/${ort}/${label}/gewählt`);
      }
    }
  });

  test(`${modus}: alle Personen- und Schadensstatus in Liste und Detail`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const basis = await vorbereiten(page, modus);
    const personen = [];
    for (const [status, label] of [
      ['erfasst', 'erfasst'],
      ['vermisst', 'vermisst'],
      ['betroffen', 'betroffen'],
      ['verstorben', 'verstorben'],
      ['abgemeldet', 'abgemeldet'],
    ]) {
      const p = await post(page, `${basis}/personen`, { antreff_ort: `Kontrast ${status}` });
      if (status !== 'erfasst') await post(page, `${basis}/personen/${p.id}/status`, { status });
      personen.push({ id: p.id, label });
    }
    const schaeden = [];
    for (const label of ['offen', 'übergeben', 'abgeschlossen']) {
      const s = await post(page, `${basis}/schaeden`, {
        typ: 'sachschaden',
        ausmass: 'gering',
        ort: `Kontrast ${label}`,
      });
      if (label === 'übergeben')
        await post(page, `${basis}/schaeden/${s.id}/uebergeben`, { uebergeben_an: 'Teststelle' });
      if (label === 'abgeschlossen')
        await post(page, `${basis}/schaeden/${s.id}/abschliessen`, { abschluss_grund: 'behoben' });
      schaeden.push({ id: s.id, label });
    }
    for (const [modul, saetze] of [
      ['personen', personen],
      ['schaeden', schaeden],
    ] as const) {
      await page.goto(`${basis}/${modul}`);
      // Schäden filtern seit dem Neuentwurf über eine Segmentleiste (`radio`), Personen ggf.
      // noch über Reiter — der Griff nimmt beide Rollen.
      await page
        .getByRole('tab', { name: 'Alle', exact: true })
        .or(page.getByRole('radio', { name: 'Alle', exact: true }))
        .click();
      await expect(page.locator('.ant-table-row')).toHaveCount(saetze.length);
      for (const { id, label } of saetze) {
        const tag = page
          .locator(`.ant-table-row[data-row-key="${id}"] .ant-tag`)
          .filter({ hasText: new RegExp(`^${label}(?: \\(Teststelle\\))?$`) });
        await expect(tag).toHaveCount(1);
        await pruefe(tag, minimum, `${modus}/${modul}/${label}/Liste`);
      }
      for (const { id, label } of saetze) {
        await page.goto(`${basis}/${modul}/${id}`);
        const tag = page.locator('.ant-tag').filter({ hasText: new RegExp(`^${label}$`) });
        await expect(tag).toHaveCount(1);
        await pruefe(tag, minimum, `${modus}/${modul}/${label}/Detail`);
      }
    }
  });
}

// ─── LFH-650: die neuen Flächen aus LFH-613 ──────────────────────────────────────────
//
// Nachzug zur LFH-613-Prüfliste (Tabellen 1–5, Nr. 5): Zustand-Knopf, Zustandswert,
// Koordinate, Fehler an der Zeile, `#…`-Marke, Verorten-Link, Feldmeldungen, Kartenhinweis,
// Leerzustand, Cluster-Kern, Dashboard-Fuß — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1. Dazu die
// KANTE der Marker gegen den Kartengrund (WCAG 1.4.11, ≥ 3 : 1), gemessen an Pixeln: WebGL
// hat keine berechneten Stile, die `kontrast()` lesen könnte.
//
// Gemessen wird die ZUSAMMENGESETZTE Paarung (`kontrast-kern.ts`), nicht der Token —
// „keine Farbwerte aus dem Produkt importieren: eine schlechte Palette muss rot werden".

/** Misst, sichert den Boden und gibt den Wert für die Anmerkung zurück. */
async function misst(tag: Locator, minimum: number, name: string, werte: string[]) {
  await pruefe(tag, minimum, name);
  const v = (await kontrast(tag)).verhaeltnis;
  werte.push(`${name.split('/').slice(1).join('/')} ${v.toFixed(2)}`);
}

async function personMit(page: Page, basis: string, daten: object): Promise<number> {
  return ((await post(page, `${basis}/personen`, daten)) as { id: number }).id;
}

/** Kontrast zweier opaker rgb()-Farben (für den Cluster-Kern: er liegt in einem Ring mit
 *  `conic-gradient`, den der Kompositionskern bewusst ablehnt — der Kern selbst ist opak). */
async function direktKontrast(tag: Locator) {
  return tag.evaluate((e) => {
    const lum = (w: string) => {
      const [r, g, b] = /\d+(\.\d+)?/g.exec(w) ? w.match(/\d+(\.\d+)?/g)!.map(Number) : [0, 0, 0];
      const l = [r, g, b].map((n) => {
        const s = n / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return l[0] * 0.2126 + l[1] * 0.7152 + l[2] * 0.0722;
    };
    const stil = getComputedStyle(e);
    const [a, b] = [lum(stil.color), lum(stil.backgroundColor)].sort((x, y) => x - y);
    return (b + 0.05) / (a + 0.05);
  });
}

interface KartenHaken {
  loaded(): boolean;
  project(ll: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  once(ereignis: string, f: () => void): void;
  queryRenderedFeatures(p: [number, number], o: { layers: string[] }): unknown[];
}

/**
 * Kante eines Markers gegen den Kartengrund, aus Pixeln: ein 64-px-Ausschnitt um die
 * Kreismitte, im Browser dekodiert. Längs eines Strahls nach rechts liegt innen der weiße
 * Rand (Radius 9–11) und außen die schwarze Kante (11–13); der Grund wird diagonal weit
 * außerhalb gelesen. Die Kante hält, wenn EINE der beiden Linien ≥ 3 : 1 gegen den Grund
 * steht — sie liegen nebeneinander, das Auge braucht nur eine.
 */
async function markerKante(page: Page, ll: [number, number]) {
  await page.evaluate(
    (ziel) =>
      new Promise<void>((fertig) => {
        const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
        k.once('idle', () => fertig());
        // Zoom 11: unter dem Plaketten-Mindestzoom (12), damit keine Plakette im Ausschnitt
        // liegt; die Marker stehen 0,5° auseinander und clustern dort nicht.
        k.jumpTo({ center: ziel, zoom: 11 });
      }),
    ll,
  );
  const mitte = await page.evaluate((ziel) => {
    const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
    const p = k.project(ziel);
    const r = k.getCanvas().getBoundingClientRect();
    return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
  }, ll);
  const png = await page.screenshot({
    clip: { x: mitte.x - 32, y: mitte.y - 32, width: 64, height: 64 },
  });
  return page.evaluate(async (b64) => {
    const bild = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${b64}`)).blob(),
    );
    const c = document.createElement('canvas');
    c.width = bild.width;
    c.height = bild.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bild, 0, 0);
    const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    const lum = ([r, g, b]: number[]) => {
      const l = [r, g, b].map((n) => {
        const s = n / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return l[0] * 0.2126 + l[1] * 0.7152 + l[2] * 0.0722;
    };
    const k = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const grund = lum(px(32 + 26, 32 + 26));
    const strahl = (von: number, bis: number) =>
      Array.from({ length: bis - von + 1 }, (_, i) => lum(px(32 + von + i, 32)));
    const rand = Math.max(...strahl(9, 11));
    const kante = Math.min(...strahl(11, 14));
    return {
      rand: k(rand, grund),
      kante: k(kante, grund),
      beste: Math.max(k(rand, grund), k(kante, grund)),
    };
  }, png.toString('base64'));
}

/**
 * Kurzzeichen im Kreis (Tabelle 4, Nr. 6): wirklich GEZEICHNET, nicht nur in der Quelle.
 * `queryRenderedFeatures` auf `marker-kurz` liefert nur, was MapLibre platziert hat — ein
 * Symbol, das bei Kollision wiche oder am Mindestzoom hinge, fehlte hier. Die Lesbarkeit
 * selbst ist die Paarung Schwarz auf weißem Hof (21 : 1, `KURZ_PAINT`) [abgeleitet]: 9-px-
 * Glyphen mit Kantenglättung ergeben keinen belastbaren Pixelwert.
 */
async function kurzzeichenGezeichnet(page: Page, ll: [number, number]): Promise<string | null> {
  return page.evaluate((ziel) => {
    const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
    const p = k.project(ziel);
    const f = k.queryRenderedFeatures([p.x, p.y], { layers: ['marker-kurz'] });
    const wert = (f[0] as { properties?: { kurzzeichen?: string } } | undefined)?.properties;
    return wert?.kurzzeichen ?? null;
  }, ll);
}

for (const modus of ['light', 'dark'] as const) {
  const minimum = modus === 'light' ? 7 : 5;

  test(`${modus}: Betroffenenliste, Schnellerfassung, Detail und Aufnahme — die neuen Elemente (LFH-650)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    const basis = await vorbereiten(page, modus);
    const werte: string[] = [];
    await personMit(page, basis, { name: 'Albers' });
    const zwei = await personMit(page, basis, {
      name: 'Brandt',
      zustand: 'gehfähig',
      antreff_ort: 'Brücke',
      antreff_lat: 52.2691,
      antreff_lon: 9.1342,
    });

    // ── Liste ──
    await page.goto(`${basis}/personen`);
    const leer = page.getByRole('button', { name: 'Zustand zu R-001 hinzufügen' });
    const voll = page.getByRole('button', { name: 'Zustand zu R-002 bearbeiten' });
    for (const [ziel, name] of [
      [leer, 'Zustand-Knopf leer'],
      [voll, 'Zustandswert'],
    ] as const) {
      await page.mouse.move(0, 0);
      await misst(ziel, minimum, `${modus}/${name}`, werte);
      await ziel.hover();
      await misst(ziel, minimum, `${modus}/${name}+hover`, werte);
    }
    await page.mouse.move(0, 0);
    const zeile = page.locator(`tr.ant-table-row[data-row-key="${zwei}"]`);
    await misst(
      zeile.locator('[data-lfh="koordinate"]'),
      minimum,
      `${modus}/Koordinate Liste`,
      werte,
    );
    await misst(
      zeile.getByText('Brücke', { exact: true }),
      minimum,
      `${modus}/Fundort text2`,
      werte,
    );

    // Fehler an der Zeile: der PATCH scheitert, die Zelle trägt Marke und Satz.
    await page.route('**/api/einsaetze/*/personen/*', (r) =>
      r.request().method() === 'PATCH'
        ? r.fulfill({ status: 500, json: { error: 'Speicher nicht erreichbar' } })
        : r.continue(),
    );
    await leer.click();
    await page.keyboard.type('gehfähig');
    await page.keyboard.press('Tab');
    const alarm = page.getByRole('alert').filter({ hasText: 'Nicht gespeichert' });
    await expect(alarm).toHaveText('Nicht gespeichert: Speicher nicht erreichbar');
    await expect(page.locator('[data-lfh="zustand-zelle"][data-fehler="true"]')).toHaveCount(1);
    await misst(alarm, minimum, `${modus}/Fehler an der Zeile`, werte);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // ── Schnellerfassungszeile: die `#…`-Marke ──
    await page.getByRole('textbox', { name: 'Kurzeingabe Person' }).fill('Dora #52.2691/9.1342');
    await misst(
      page.locator('[data-lfh="erkannt"] [title="Fundort-Koordinate"]'),
      minimum,
      `${modus}/#-Marke`,
      werte,
    );

    // ── Detailseite ──
    await page.goto(`${basis}/personen/${zwei}`);
    await misst(
      page.getByRole('link', { name: 'Auf Lagekarte verorten', exact: true }),
      minimum,
      `${modus}/Verorten-Link`,
      werte,
    );
    await misst(
      page.locator('[data-lfh="koordinate"]'),
      minimum,
      `${modus}/Koordinate Detail`,
      werte,
    );

    // ── Aufnahme-Route: Koordinatengrund ──
    await page.goto(`${basis}/personen/aufnahme`);
    await page.getByRole('button', { name: /Weitere Angaben/ }).click();
    const koordinate = page.getByLabel('Koordinate', { exact: true });
    await koordinate.fill('abc');
    await koordinate.blur();
    const grund = page
      .locator('.ant-form-item')
      .filter({ has: koordinate })
      .locator('.ant-form-item-explain-error');
    await expect(grund).toHaveCount(1);
    // Feldmeldungen färbt antd mit `colorError` — app-weit in JEDEM Formular. Gemessen am Tag
    // 5,67 : 1, unter dem Tagesboden; das gehört nicht in diesen Nachzug, sondern nach
    // LFH-667. Gesichert wird bis dahin nur der absolute Boden 4,5 : 1.
    await misst(grund, 4.5, `${modus}/Koordinatengrund (LFH-667)`, werte);

    // ── Modal „Vermisst melden": Hinweis und Zukunftsgrenze ──
    await page.goto(`${basis}/personen`);
    await page.getByRole('button', { name: 'Vermisst melden' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Weitere Angaben/ }).click();
    // `extra` steht in `colorTextDescription` = `schwach` — der Befund von LFH-643 (dort
    // auch der Nachtwert). Gesichert nur der absolute Boden 4,5 : 1.
    await misst(
      dialog.getByText('Ohne Angabe gilt der Zeitpunkt der Meldung.'),
      4.5,
      `${modus}/Hinweis vermisst seit (LFH-643)`,
      werte,
    );
    const seit = dialog.getByLabel('vermisst seit', { exact: true });
    await seit.click();
    await seit.fill('01.01.2099 10:00');
    await seit.press('Enter');
    const zukunft = dialog.getByText('Liegt in der Zukunft', { exact: true });
    await expect(zukunft).toBeVisible();
    await misst(zukunft, 4.5, `${modus}/Liegt in der Zukunft (LFH-667)`, werte);

    test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
  });

  test(`${modus}: Kartenansicht und Dashboard-Fuß — Hinweis, Leerzustand, Cluster-Kern, Markerkante (LFH-650)`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    const basis = await vorbereiten(page, modus);
    const werte: string[] = [];

    // Leerzustand: dieser Einsatz hat (noch) keine Person mit Koordinate und keinen Ort.
    await personMit(page, basis, { name: 'Ohne' });
    await page.goto(`${basis}/personen?ansicht=karte`);
    await misst(
      page.getByText('Keine Person mit Koordinate'),
      minimum,
      `${modus}/Leerzustand Titel`,
      werte,
    );
    // Der Hinweissatz kommt aus dem GETEILTEN Primitiv `SeitenLeer` in `colorTextDescription`
    // (= `schwach`) — derselbe Befund wie LFH-618 Nr. 8 (Tag 5,33 auf `grund`), app-weit
    // zugeordnet an LFH-643. Gemessen und notiert, gesichert nur der absolute Boden 4,5 : 1.
    await misst(
      page.getByText(/Eine Koordinate lässt sich/),
      4.5,
      `${modus}/Leerzustand Hinweis (LFH-643)`,
      werte,
    );

    // Marker je Sichtung, 0,5° auseinander; dazu ein enges Paar für den Cluster.
    const orte: [string | null, [number, number]][] = [
      ['sk1', [8.0, 53.0]],
      ['sk2', [8.5, 53.0]],
      ['sk3', [9.0, 53.0]],
      ['sk4', [9.5, 53.0]],
      ['tot', [10.0, 53.0]],
      ['unverletzt', [10.5, 53.0]],
      [null, [11.0, 53.0]],
    ];
    for (const [sk, [lon, lat]] of orte) {
      await personMit(page, basis, {
        name: `Kante ${sk ?? 'ohne'}`,
        antreff_lat: lat,
        antreff_lon: lon,
        ...(sk ? { sichtung: sk } : {}),
      });
    }
    for (const i of [0, 1]) {
      await personMit(page, basis, {
        name: `Paar ${i}`,
        antreff_lat: 52.0 + i * 0.0002,
        antreff_lon: 8.0,
        sichtung: 'sk1',
      });
    }
    await page.goto(`${basis}/personen?ansicht=karte`);
    await page.waitForFunction(
      () => Boolean((window as unknown as { __lfhKarte?: KartenHaken }).__lfhKarte?.loaded()),
      undefined,
      { timeout: 60_000 },
    );
    await misst(
      page.locator('[data-lfh="betroffene-karte-ohne-koordinate"]'),
      minimum,
      `${modus}/Kartenhinweis`,
      werte,
    );
    const kern = page.locator('[data-lfh="cluster-sichtung"]').first().locator('..');
    await expect(kern).toBeVisible({ timeout: 20_000 });
    const kernWert = await direktKontrast(kern);
    expect(kernWert, `${modus}/Cluster-Kern`).toBeGreaterThanOrEqual(minimum);
    werte.push(`Cluster-Kern ${kernWert.toFixed(2)}`);

    await page.locator('[data-lfh="betroffene-karte"] canvas').scrollIntoViewIfNeeded();
    const kuerzel: Record<string, string> = {
      sk1: 'I',
      sk2: 'II',
      sk3: 'III',
      sk4: 'IV',
      tot: 'T',
      unverletzt: 'U',
      ohne: '–',
    };
    for (const [sk, ll] of orte) {
      const m = await markerKante(page, ll);
      // Zoom 11, Nachbarn 0,5° (rund 33 km) entfernt: gestreute Fundorte ohne Cluster.
      expect(await kurzzeichenGezeichnet(page, ll), `Kurzzeichen ${sk ?? 'ohne'}`).toBe(
        kuerzel[sk ?? 'ohne'],
      );
      expect(
        m.beste,
        `${modus}/Markerkante ${sk ?? 'ohne'}: ${JSON.stringify(m)}`,
      ).toBeGreaterThanOrEqual(3);
      werte.push(
        `Kante ${sk ?? 'ohne'} ${m.beste.toFixed(2)} (weiß ${m.rand.toFixed(2)}, schwarz ${m.kante.toFixed(2)})`,
      );
    }

    // ── Dashboard-Fuß ──
    await page.goto(`${basis}/lage-dashboard`);
    await misst(
      page.locator('[data-lfh="transport-bilanz"] > span').last(),
      minimum,
      `${modus}/Transport-Wert`,
      werte,
    );
    await misst(
      page.locator('[data-lfh="ohne-sichtung"] > span').last(),
      minimum,
      `${modus}/Ohne-Sichtung-Wert`,
      werte,
    );

    test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
  });
}

test('Kontrastmessung komponiert Alpha und erkennt unlesbare Schrift', async ({ page }) => {
  await page.setContent(
    '<body style="background:rgb(0,0,0)"><div style="background:rgba(255,255,255,0.5)"><span style="color:rgba(255,255,255,0.5)">Probe</span></div></body>',
  );
  const tag = page.getByText('Probe');
  const messung = await kontrast(tag);
  expect(messung.grund).toEqual([127.5, 127.5, 127.5, 1]);
  expect(messung.text).toEqual([191.25, 191.25, 191.25, 1]);
  expect(messung.verhaeltnis).toBeLessThan(3);
  await tag.evaluate((e) => {
    e.style.color = 'rgb(127,127,127)';
  });
  expect((await kontrast(tag)).verhaeltnis).toBeLessThan(1.01);
});
