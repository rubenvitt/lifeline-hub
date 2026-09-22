import { expect, test, type Locator, type Page } from '@playwright/test';
import { pruefeFokusVerdeckung } from './fokus-kern';

/**
 * Browser-Nachweise der Prüfliste Einsatztauglichkeit für LFH-606
 * (`docs/superpowers/specs/2026-09-22-lfh-606-pruefliste.md`).
 *
 * Gemessen wird, was jsdom nicht rechnet: Trefflächen über die Dichte-Staffel (Kriterien 1/2),
 * Kontrast der Pegel-Kennzahl in beiden Modi samt Achtungskante (5/6), Querlauf der
 * Einstellungssektion auf 390 px (Gate 1) und verdeckte Fokusziele (13).
 *
 * HERMETISCH: die Pegel-Liste und die Stationsliste der Fachebene kommen per `page.route`
 * aus Literalen. Der echte Abruf ginge an PEGELONLINE (Messungen) — ein e2e-Nachweis, der
 * am Netz eines Fremddienstes hängt, misst dessen Erreichbarkeit, nicht die Oberfläche.
 * Die Wire-Form ist dieselbe, die `api/types.generated.ts` beschreibt.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const THEMA_SCHLUESSEL = 'lifeline-hub.theme';
const SUBPIXEL = 0.5;

/** Dichte-Staffel als handgeschriebene Böden (Untergrenzen, Muster `gate3-trefflaeche`). */
const STAFFEL = [
  { dichte: 'kompakt', soll: 30, sollSM: 24 },
  { dichte: 'komfortabel', soll: 48, sollSM: 48 },
  { dichte: 'handschuh', soll: 72, sollSM: 72 },
] as const;
// `sollSM` ist das Tripel von `controlHeightSM` (24 / 48 / 72, CLAUDE.md „Welches
// Zahlentripel, hängt am Token"): antd gibt Menüeinträgen eines `Dropdown` die kleine
// Steuerhöhe, im Kompaktbetrieb also 24 px = der WCAG-2.5.8-Boden, nicht 30.

const UUID = [
  '47174d8f-1b8e-4599-8a59-b580dd55bc87',
  '5f9c1b54-3c41-4d93-bb48-2b7c7c3f5a61',
  'a1b2c3d4-0000-4000-8000-000000000003',
];

/** Eine Messung, die zur echten Uhr `alterMin` Minuten alt ist. */
const messung = (alterMin: number) => ({
  wasserstand_cm: 684,
  zeitpunkt: new Date(Date.now() - alterMin * 60_000).toISOString(),
  trend_cm_pro_h: 9.2,
});

const pegelListe = (alterMin: number) => [
  {
    id: 1,
    station_uuid: UUID[0],
    name: 'HANN. MÜNDEN',
    gewaesser: 'WESER',
    reihenfolge: 0,
    messung: messung(alterMin),
  },
  { id: 2, station_uuid: UUID[1], name: 'WAHNHAUSEN', gewaesser: 'FULDA', reihenfolge: 1 },
];

const STATIONEN = {
  quelle: 'pegelonline',
  status: 'ok',
  attribution: 'WSV',
  features: {
    type: 'FeatureCollection',
    features: [
      ['HANN. MÜNDEN', 'WESER', 0.5, UUID[0]],
      ['WAHNHAUSEN', 'FULDA', 97.4, UUID[1]],
      ['KASSEL', 'FULDA', 81.73, UUID[2]],
    ].map(([titel, gewaesser, km, uuid]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [9.6, 51.4] },
      properties: { titel, gewaesser, km, uuid, kategorie: 'pegel' },
    })),
  },
};

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, bezeichnung: string): Promise<string> {
  const r = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(r.ok(), `Seeding Einsatz: ${r.status()} ${await r.text()}`).toBeTruthy();
  return String(((await r.json()) as { id: number }).id);
}

/** Stellt die Pegel-Abfrage und die Stationsliste auf Literale. */
async function stellePegel(page: Page, einsatzId: string, liste: unknown[]) {
  await page.route(`**/api/einsaetze/${einsatzId}/pegel`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: liste }) : route.continue(),
  );
  await page.route('**/api/karte/fachebenen/pegelonline', (route) =>
    route.fulfill({ json: STATIONEN }),
  );
}

async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

async function haeltStufe(ziel: Locator, soll: number, name: string): Promise<number> {
  await expect(ziel, `${name}: genau ein Knoten`).toHaveCount(1);
  const k = await ziel.boundingBox();
  expect(k, `${name}: kein Kasten`).not.toBeNull();
  expect(k!.height, `${name}: ${k!.height}px, Soll ≥ ${soll}`).toBeGreaterThanOrEqual(
    soll - SUBPIXEL,
  );
  return k!.height;
}

/**
 * Kontrast eines Textknotens gegen die zusammengesetzte Grundfläche; optional zusätzlich
 * eine fremde Farbe (die Kante steckt im `box-shadow`, nicht im Rand). Kern wie
 * `kraefte-kontrast.spec.ts` — Alpha wird gemischt, unebene Flächen werden abgelehnt.
 */
async function kontrast(ziel: Locator, zusatz?: string) {
  await expect(ziel).toHaveCount(1);
  return ziel.evaluate((el, extra) => {
    type Farbe = [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const farbe = (css: string): Farbe => {
      if (!CSS.supports('color', css)) throw new Error(`Nicht auflösbare Farbe: ${css}`);
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const mische = (v: Farbe, h: Farbe): Farbe => {
      const a = v[3] + h[3] * (1 - v[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (v[i] * v[3] + h[i] * h[3] * (1 - v[3])) / a).concat(a) as Farbe;
    };
    const lagen: Farbe[] = [];
    for (let k: Element | null = el; k; k = k.parentElement) {
      const s = getComputedStyle(k);
      if (s.opacity !== '1' || s.backgroundImage !== 'none')
        throw new Error(`Nicht ebene Fläche an ${k.tagName}`);
      const f = farbe(s.backgroundColor);
      lagen.push(f);
      if (f[3] === 1) break;
    }
    const grund = lagen.reverse().reduce((h, v) => mische(v, h), [0, 0, 0, 0] as Farbe);
    if (grund[3] !== 1) throw new Error('Keine opake Grundfläche');
    const lum = (f: Farbe) => {
      const c = f
        .slice(0, 3)
        .map((x) => x / 255)
        .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const k = (v: Farbe) => {
      const a = lum(mische(v, grund));
      const b = lum(grund);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    return {
      text: k(farbe(getComputedStyle(el).color)),
      zusatz: extra ? k(farbe(extra)) : null,
    };
  }, zusatz);
}

const pegelZelle = (page: Page) =>
  page
    .getByRole('group', { name: 'Lage in Zahlen' })
    .locator('a[data-lfh="kennzahl"]')
    .filter({ has: page.locator('.lfh-augenbraue', { hasText: /^Pegel$/ }) });

for (const modus of ['light', 'dark'] as const) {
  test(`Pegel-Kennzahl: Wert, Notiz und Achtungskante im Modus ${modus}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Pegel Kontrast ${Date.now()}`);
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEMA_SCHLUESSEL, modus]);

    const werte: string[] = [];
    // Frisch (neutral) und veraltet (achtung): der Achtungston ändert im Nachtmodus die
    // Zahlfarbe — beide Zustände gehören gemessen.
    for (const [fall, alter] of [
      ['frisch', 10],
      ['veraltet', 180],
    ] as const) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await stellePegel(page, einsatzId, pegelListe(alter));
      await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const zelle = pegelZelle(page);
      await expect(zelle.locator('[data-lfh="kennzahl-wert"]')).toHaveText('6,84');
      await page.mouse.move(0, 0);
      const ton = fall === 'veraltet' ? 'achtung' : 'neutral';
      await expect(zelle).toHaveAttribute('data-ton', ton);

      const wert = await kontrast(zelle.locator('[data-lfh="kennzahl-wert"]'));
      const notiz = await kontrast(zelle.locator('[data-lfh="kennzahl-notiz"]'));
      const kante = await zelle.evaluate((el) => {
        const m = getComputedStyle(el).boxShadow.match(/rgba?\([^)]+\)/);
        return m ? m[0] : null;
      });
      const kanteK = kante
        ? (await kontrast(zelle.locator('[data-lfh="kennzahl-wert"]'), kante)).zusatz
        : null;
      const boden = modus === 'light' ? 7 : 5;
      expect.soft(wert.text, `${modus}/${fall} Wert`).toBeGreaterThanOrEqual(boden);
      expect.soft(notiz.text, `${modus}/${fall} Notiz`).toBeGreaterThanOrEqual(4.5);
      if (fall === 'veraltet') {
        await expect(zelle.locator('[data-lfh="kennzahl-notiz"]')).toContainText('veraltet');
        expect(kante, 'veraltet trägt eine Kante').not.toBeNull();
        expect.soft(kanteK!, `${modus} Kante`).toBeGreaterThanOrEqual(3);
      } else {
        expect(kante, 'frisch trägt keine Kante').toBeNull();
      }
      werte.push(
        `${fall}: Wert ${wert.text.toFixed(2)}, Notiz ${notiz.text.toFixed(2)}` +
          (kanteK ? `, Kante ${kanteK.toFixed(2)}` : ''),
      );
    }
    test
      .info()
      .annotations.push({ type: 'messwert', description: `${modus} — ${werte.join(' | ')}` });
  });
}

test('Einstellungssektion Pegel: Trefflächen über die Staffel, kein Querlauf auf 390 px', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Pegel Sektion ${Date.now()}`);
  await stellePegel(page, einsatzId, pegelListe(10));

  const gemessen: string[] = [];
  for (const breite of [1366, 390]) {
    await page.setViewportSize({ width: breite, height: 844 });
    for (const { dichte, soll, sollSM } of STAFFEL) {
      await page.goto(`/einsaetze/${einsatzId}/einstellungen/pegel`);
      await stelleDichte(page, dichte);
      const main = page.getByRole('main');
      await expect(main.locator('[data-lfh="pegel-titel"]')).toHaveCount(2);

      const auswahl = await haeltStufe(
        main
          .locator('.ant-select')
          .filter({ has: page.getByRole('combobox', { name: 'Station wählen' }) }),
        soll,
        `Auswahl ${breite}/${dichte}`,
      );
      const knopf = await haeltStufe(
        main.getByRole('button', { name: 'Hinzufügen' }),
        soll,
        `Hinzufügen ${breite}/${dichte}`,
      );
      let menue = Number.POSITIVE_INFINITY;
      for (const name of ['HANN. MÜNDEN', 'WAHNHAUSEN']) {
        const ausloeser = main.getByRole('button', { name: `Aktionen zu Pegel ${name}` });
        const h = await haeltStufe(ausloeser, soll, `Zeilenmenü ${name} ${breite}/${dichte}`);
        const k = (await ausloeser.boundingBox())!;
        expect(k.width, `Zeilenmenü ${name}: Breite ≥ 24`).toBeGreaterThanOrEqual(24);
        menue = Math.min(menue, h);
      }
      // Die Menüeinträge selbst — das Ziel, das nach dem Öffnen getroffen wird.
      await main.getByRole('button', { name: 'Aktionen zu Pegel WAHNHAUSEN' }).click();
      const offen = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
      await expect(offen).toHaveCount(1);
      let eintrag = Number.POSITIVE_INFINITY;
      for (const name of ['Nach oben', 'Nach unten', 'Entfernen']) {
        const item = offen.getByRole('menuitem', { name: new RegExp(name) });
        await expect(item).toHaveCount(1);
        // Das Menü klappt animiert auf (scaleY): gemessen wird der eingeschwungene Kasten.
        await expect
          .poll(async () => (await item.boundingBox())?.height ?? 0, {
            message: `Menüeintrag ${name} ${breite}/${dichte}, Soll ≥ ${sollSM}`,
          })
          .toBeGreaterThanOrEqual(sollSM - SUBPIXEL);
        eintrag = Math.min(eintrag, (await item.boundingBox())!.height);
      }
      await page.keyboard.press('Escape');

      // Abstände zwischen benachbarten Zielen (Kriterium 2: ≥ 16 px im Handschuh-Betrieb):
      // Auswahl ↔ Hinzufügen (neben- oder untereinander, je nach Umbruch) und die beiden
      // Zeilenmenüs untereinander.
      const a = (await main
        .locator('.ant-select')
        .filter({ has: page.getByRole('combobox', { name: 'Station wählen' }) })
        .boundingBox())!;
      const b = (await main.getByRole('button', { name: 'Hinzufügen' }).boundingBox())!;
      const abstandAuswahl = Math.max(b.x - (a.x + a.width), b.y - (a.y + a.height));
      const m1 = (await main
        .getByRole('button', { name: 'Aktionen zu Pegel HANN. MÜNDEN' })
        .boundingBox())!;
      const m2 = (await main
        .getByRole('button', { name: 'Aktionen zu Pegel WAHNHAUSEN' })
        .boundingBox())!;
      const abstandMenue = m2.y - (m1.y + m1.height);
      if (dichte === 'handschuh') {
        expect(abstandAuswahl, `Abstand Auswahl/Hinzufügen ${breite}`).toBeGreaterThanOrEqual(16);
        expect(abstandMenue, `Abstand Zeilenmenüs ${breite}`).toBeGreaterThanOrEqual(16);
      }

      const querlauf = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(querlauf, `Querlauf ${breite}/${dichte}`).toBeLessThanOrEqual(0);
      gemessen.push(
        `${breite}/${dichte} (≥${soll}): Auswahl ${auswahl}, Hinzufügen ${knopf}, ` +
          `Zeilenmenü ${menue}, Menüeintrag ${eintrag}, Querlauf ${querlauf}, ` +
          `Abstand Auswahl/Knopf ${abstandAuswahl}, Abstand Menüs ${abstandMenue}`,
      );
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Einstellungssektion Pegel: Tabulaturdurchlauf ohne verdecktes Fokusziel (390 × 420)', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Pegel Fokus ${Date.now()}`);
  await stellePegel(page, einsatzId, pegelListe(10));
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto(`/einsaetze/${einsatzId}/einstellungen/pegel`);
  await expect(page.getByRole('main').locator('[data-lfh="pegel-titel"]')).toHaveCount(2);

  // Die Ziele der Sektion markieren: nur so belegt der Durchlauf, dass er sie ERREICHT hat —
  // allgemeine Stopps zählen auch Kopfzeile und Navigation mit.
  const main = page.getByRole('main');
  const ziele: [string, Locator][] = [
    ['Reiter Pegel', page.getByRole('tab', { name: 'Pegel' })],
    ['Zeilenmenü 1', main.getByRole('button', { name: 'Aktionen zu Pegel HANN. MÜNDEN' })],
    ['Zeilenmenü 2', main.getByRole('button', { name: 'Aktionen zu Pegel WAHNHAUSEN' })],
    ['Auswahl', main.getByRole('combobox', { name: 'Station wählen' })],
  ];
  for (const [name, ziel] of ziele) {
    await expect(ziel, name).toHaveCount(1);
    await ziel.evaluate((el, k) => el.setAttribute('data-e2e-fokus', k), name);
  }

  const ergebnis = await pruefeFokusVerdeckung(page, 40);
  const erreicht = [...ergebnis.besuchteZiele].sort().join(', ');
  expect([...ergebnis.besuchteZiele].sort(), 'alle Sektionsziele erreicht').toEqual(
    ziele.map(([n]) => n).sort(),
  );
  expect(ergebnis.verdeckt, `verdeckt:\n${ergebnis.verdeckt.join('\n')}`).toEqual([]);
  test.info().annotations.push({
    type: 'messwert',
    description: `${ergebnis.stoppsGesamt} Stopps, ${ergebnis.fixierteKandidaten} fixierte Knoten; Ziele: ${erreicht}`,
  });
});

for (const modus of ['light', 'dark'] as const) {
  test(`Einstellungssektion Pegel: Kontrast von Titel, Messzeile und Leitpegel-Marke (${modus})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 844 });
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Pegel Sektion Kontrast ${Date.now()}`);
    await stellePegel(page, einsatzId, pegelListe(10));
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEMA_SCHLUESSEL, modus]);
    await page.goto(`/einsaetze/${einsatzId}/einstellungen/pegel`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    const main = page.getByRole('main');
    await expect(main.locator('[data-lfh="pegel-titel"]')).toHaveCount(2);
    await page.mouse.move(0, 0);

    const titel = await kontrast(main.locator('[data-lfh="pegel-titel"]').first());
    const zeile = await kontrast(main.getByText(/^WESER · 6,84 m/));
    const marke = main.locator('[data-lfh="leitpegel"]');
    // Die Marke ist Text, kein Zustand: getragen wird sie vom Wortlaut, nicht vom Rand.
    const tag = await kontrast(marke);
    const boden = modus === 'light' ? 7 : 5;
    expect.soft(titel.text, `${modus} Titel`).toBeGreaterThanOrEqual(boden);
    expect.soft(zeile.text, `${modus} Messzeile`).toBeGreaterThanOrEqual(4.5);
    expect.soft(tag.text, `${modus} Leitpegel-Marke`).toBeGreaterThanOrEqual(4.5);
    test.info().annotations.push({
      type: 'messwert',
      description:
        `${modus}: Titel ${titel.text.toFixed(2)}, Messzeile ${zeile.text.toFixed(2)}, ` +
        `Marke ${tag.text.toFixed(2)}`,
    });
  });
}

/**
 * Kriterium 12 (CLS ≤ 0,1): die Pegel-Notiz hängt an einer EIGENEN Abfrage und kann nach dem
 * Rest der Kennzahlreihe eintreffen. Gemessen wird die Summe der `layout-shift`-Einträge des
 * Browsers (das Kriterium); die Bandhöhe davor/danach steht nur als Messwert dabei — sie wächst
 * gemessen um eine Zeile auch mit LEERER Pegel-Liste, der Sprung gehört also nicht dem Pegel. Die Pegel-Antwort wird bewusst um
 * 1,5 s verzögert, damit der Sprung NACH dem ersten Aufbau liegt — der ungünstige Fall.
 *
 * Zugesichert wird ≤ 0,1 auf 1366 und 1024 px (Fükw, Führungs-Tablet). Auf 390 px liegen
 * BEIDE Seiten schon OHNE Pegel-Daten darüber (gemessen 22.09.2026: Überblick 0,164,
 * Lage-Dashboard 0,167 mit leerer Pegel-Liste) — ein Bestandsbefund, der in der Prüfliste
 * als offen geführt wird. Dort steht die Zahl hier nur als Messwert; eine Schranke, die ohne
 * die eigene Änderung schon rot wäre, prüfte nicht diese Änderung.
 */
async function clsBeobachten(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((liste) => {
      for (const e of liste.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
        if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

for (const [route, text] of [
  ['ueberblick', /Pegel 6,84 m steigend/],
  ['lage-dashboard', /WESER · steigend/],
] as const) {
  test(`${route}: die nachladende Pegel-Angabe hält CLS ≤ 0,1`, async ({ page }) => {
    test.setTimeout(90_000);
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Pegel CLS ${Date.now()}`);
    await clsBeobachten(page);
    const werte: string[] = [];
    for (const breite of [1366, 1024, 390]) {
      await page.setViewportSize({ width: breite, height: 844 });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route(`**/api/einsaetze/${einsatzId}/pegel`, async (r) => {
        await new Promise((f) => setTimeout(f, 1500));
        await r.fulfill({ json: pegelListe(10) });
      });
      await page.goto(`/einsaetze/${einsatzId}/${route}`);
      const band = page.getByRole('group', { name: 'Lage in Zahlen' });
      await expect(band.locator('a[data-lfh="kennzahl"]').first()).toBeVisible();
      await page.waitForTimeout(300);
      const vorher = (await band.boundingBox())!.height;
      await expect(band.getByText(text)).toBeVisible();
      await page.waitForTimeout(300);
      const nachher = (await band.boundingBox())!.height;
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      werte.push(`${breite}: Band ${vorher} → ${nachher}, CLS ${cls.toFixed(4)}`);
      if (breite !== 390) {
        expect.soft(cls, `CLS ${route} bei ${breite} px`).toBeLessThanOrEqual(0.1);
      }
    }
    test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
  });
}

test('Einstellungssektion Pegel: nachladende Liste und Stationen halten CLS ≤ 0,1', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Pegel Sektion CLS ${Date.now()}`);
  await clsBeobachten(page);
  const werte: string[] = [];
  for (const breite of [1366, 1024, 390]) {
    await page.setViewportSize({ width: breite, height: 844 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route(`**/api/einsaetze/${einsatzId}/pegel`, async (r) => {
      await new Promise((f) => setTimeout(f, 800));
      await r.fulfill({ json: pegelListe(10) });
    });
    // Die Stationsliste kommt NACH der Pegel-Liste — der Fall, in dem die Auswahl erst
    // lädt, während die Liste schon steht.
    await page.route('**/api/karte/fachebenen/pegelonline', async (r) => {
      await new Promise((f) => setTimeout(f, 1600));
      await r.fulfill({ json: STATIONEN });
    });
    await page.goto(`/einsaetze/${einsatzId}/einstellungen/pegel`);
    await expect(page.getByRole('main').locator('[data-lfh="pegel-titel"]')).toHaveCount(2);
    await expect(page.getByRole('combobox', { name: 'Station wählen' })).toBeEnabled();
    await page.waitForTimeout(300);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    werte.push(`${breite}: CLS ${cls.toFixed(4)}`);
    expect.soft(cls, `CLS Sektion bei ${breite} px`).toBeLessThanOrEqual(0.1);
  }
  test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
});
