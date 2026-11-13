import { expect, test, type Page } from '@playwright/test';
import { pruefe, randKontrast } from './kontrast-kern';
import { anmeldenPerApi } from './anmelde-kern';

/**
 * Filterleiste und Filterband des Einsatztagebuchs (LLH-1065/LLH-1071, Spec `etb-filterleiste`).
 *
 * - **Eine Leiste über der Zeitachse:** bei 1440 × 900 in `kompakt` stehen Typ, System, Zeitraum,
 *   Einheit und Volltext in höchstens zwei Zeilen, Typ und System in derselben; der Seitenkopf
 *   trägt ab `md` keine Segmentleiste.
 * - **Das Band über der Erfassung** steht bei jedem Filtermerkmal in der Achtungsfläche: Text
 *   Tag ≥ 7 : 1, Nacht ≥ 5 : 1, Knopfrand ≥ 3 : 1 (Böden als Literale), und auf 390 × 844 läuft es
 *   nicht seitlich über und hält die Leiste unter der halben Fensterhöhe.
 */

const ZIEL = { light: 7, dark: 5 } as const;

async function anmelden(page: Page, modus: 'light' | 'dark' = 'light') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await anmeldenPerApi(page, 'admin', process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
}

async function einsatzMitEintrag(page: Page): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Filterleiste ${Date.now()}` },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const { id } = (await r.json()) as { id: number };
  const e = await page.request.post(`/api/einsaetze/${id}/etb`, {
    data: { typ: 'meldung', inhalt: 'Pegel steigt', von: 'ELW 1', an: 'Leitstelle' },
  });
  expect(e.ok(), await e.text()).toBeTruthy();
  return id;
}

/**
 * Zeilen einer umbrechenden Leiste: verschiedene Mittellinien ihrer Bedienziele. Gemessen an der
 * Mitte, nicht an der Oberkante: die Ziele einer Zeile sind verschieden hoch und mittig
 * ausgerichtet; eine Zeile weiter liegt die Mitte mindestens eine Steuerhöhe tiefer.
 */
async function zeilenDerLeiste(page: Page): Promise<{ zeilen: number; typUndSystem: boolean }> {
  return page.evaluate(() => {
    const leiste = document.querySelector('[data-lfh="etb-filterleiste"]')!;
    const ziele = [
      ...leiste.querySelectorAll<HTMLElement>('[role="radio"], button, input, .ant-select'),
    ].filter((el) => el.getBoundingClientRect().height > 0);
    const mitten: number[] = [];
    for (const el of ziele) {
      const r = el.getBoundingClientRect();
      const m = r.top + r.height / 2;
      if (!mitten.some((o) => Math.abs(o - m) <= 8)) mitten.push(m);
    }
    const typ = leiste.querySelector('[data-lfh="segmentleiste"]')!.getBoundingClientRect();
    const system = leiste.querySelector('[data-lfh="segment-umschalter"]')!.getBoundingClientRect();
    return {
      zeilen: mitten.length,
      typUndSystem: Math.abs(typ.top + typ.height / 2 - (system.top + system.height / 2)) <= 8,
    };
  });
}

test('1440 × 900 kompakt: alle Filter in höchstens zwei Zeilen, Typ und System in einer, Kopf ohne Typ', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmelden(page);
  const id = await einsatzMitEintrag(page);
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'kompakt'));
  await page.goto(`/einsaetze/${id}/etb`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
  const leiste = page.locator('[data-lfh="etb-filterleiste"]');
  await expect(leiste.getByRole('button', { name: 'Systemeinträge zeigen' })).toBeVisible();
  await expect(leiste.locator('[data-lfh="etb-zeitraum"]')).toBeVisible();
  await expect(leiste.getByRole('combobox', { name: 'Nach Einheit filtern' })).toBeVisible();
  await expect(leiste.getByRole('searchbox', { name: 'Volltextsuche' })).toBeVisible();

  const m = await zeilenDerLeiste(page);
  expect(m.zeilen, 'Zeilen der Filterleiste').toBeLessThanOrEqual(2);
  expect(m.typUndSystem, 'Typ und System in derselben Zeile').toBe(true);
  await expect(page.locator('[data-lfh="seitenkopf"] [data-lfh="segmentleiste"]')).toHaveCount(0);
});

/**
 * An der Arbeitsposition (kwc2yszv D8, Spec `etb-filterleiste`): die Seite öffnet am Ende der
 * Zeitachse über der Erfassung. Seitenkopf und Filterleiste kleben dann unter dem Rahmen, ein
 * gesetzter Filter steht im Bild, und die Volltextsuche ist ohne Rollen bedienbar — nicht bloß
 * sichtbar, sondern zuoberst an ihrer Stelle und angeklickt.
 */
test('1440 × 900 kompakt, am Ende der Zeitachse: Kopf und Filterleiste kleben, die Suche geht ohne Rollen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmelden(page);
  const id = await einsatzMitEintrag(page);
  for (let n = 1; n <= 40; n += 1) {
    const e = await page.request.post(`/api/einsaetze/${id}/etb`, {
      data: { typ: 'meldung', inhalt: `Probe ${n}: Lage unverändert`, von: 'ELW 1', an: 'ILS' },
    });
    expect(e.ok(), await e.text()).toBeTruthy();
  }
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'kompakt'));
  await page.goto(`/einsaetze/${id}/etb?typ=meldung`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
  const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
  await expect(zeitachse.getByText('Probe 40: Lage unverändert')).toBeAttached();
  await expect(page.locator('.etb-erfassung-sticky').getByPlaceholder(/^Inhalt …/)).toBeVisible();
  // An die Arbeitsposition: das Ende der Zeitachse über der Erfassung. Ausdrücklich gerollt, damit
  // der Fall nicht am Zeitpunkt des Startlaufs (`useFunkprotokollLauf`) hängt.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(zeitachse.getByText('Probe 40: Lage unverändert')).toBeInViewport();
  // Vorbedingung: die Seite steht am Ende, nicht oben — sonst stünde die Leiste trivial im Bild.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

  const m = await page.evaluate(() => {
    const rahmen =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--lfh-rahmen-oben'),
      ) || 0;
    const kopf = document.querySelector('[data-lfh="seitenkopf"]')!.getBoundingClientRect();
    const leiste = document.getElementById('etb-filterleiste')!.getBoundingClientRect();
    const spaltenkopf = document.querySelector('[data-lfh="etb-spaltenkopf"]');
    return {
      rahmen,
      kopfOben: kopf.top,
      kopfUnten: kopf.bottom,
      leisteOben: leiste.top,
      leisteUnten: leiste.bottom,
      spaltenkopfOben: spaltenkopf?.getBoundingClientRect().top ?? null,
    };
  });
  expect(m.rahmen, 'Vorbedingung: der Rahmen klebt ab md').toBeGreaterThan(0);
  expect(
    Math.abs(m.kopfOben - m.rahmen),
    `Seitenkopf unter dem Rahmen ${JSON.stringify(m)}`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(m.leisteOben - m.kopfUnten),
    `Filterleiste unter dem Seitenkopf`,
  ).toBeLessThanOrEqual(1);
  // Der Spaltenkopf der Zeitachse klebt an `--etb-kopf-unterkante`, direkt unter der Leiste.
  if (m.spaltenkopfOben != null) {
    expect(
      Math.abs(m.spaltenkopfOben - m.leisteUnten),
      'Spaltenkopf unter der Leiste',
    ).toBeLessThanOrEqual(1);
  }

  // Der gesetzte Filter steht an der Arbeitsposition: das gewählte Segment ist im Bild.
  await expect(page.getByRole('radio', { name: 'Meldung' })).toBeInViewport();
  // Die Suche ist zuoberst an ihrer Stelle, nicht von der Zeitachse überdeckt — und bedienbar.
  const suche = page.getByRole('searchbox', { name: 'Volltextsuche' });
  await expect(suche).toBeInViewport();
  const zuoberst = await suche.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const oben = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return oben === el || el.contains(oben);
  });
  expect(zuoberst, 'Volltextsuche zuoberst').toBe(true);
  const vorher = await page.evaluate(() => window.scrollY);
  // Mit der Maus an der Stelle, nicht `locator.click()`: das rollte das Ziel vorher selbst ins Bild.
  const box = (await suche.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(suche).toBeFocused();
  expect(await page.evaluate(() => window.scrollY), 'Klick in die Suche rollt nicht').toBe(vorher);
  await page.keyboard.type('Probe 7');
  await expect(page).toHaveURL(/[?&]q=Probe(\+|%20)7/);
});

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: das Filterband hält Text- und Randkontrast`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await anmelden(page, modus);
    const id = await einsatzMitEintrag(page);
    await page.goto(`/einsaetze/${id}/etb?typ=meldung`);
    await page.mouse.move(0, 0);
    const band = page.locator('[data-lfh="filterhinweis"]');
    await expect(band).toBeVisible();
    await pruefe(band.getByText('Gefiltert', { exact: true }), ZIEL[modus], `${modus}/Filterband`);
    const knopf = band.getByRole('button', { name: 'Filter zurücksetzen' });
    await expect(knopf).toBeVisible();
    const rand = await randKontrast(knopf, 'top');
    expect(
      rand.gegenAussen,
      `${modus}: Knopfrand gegen das Band ${JSON.stringify(rand)}`,
    ).toBeGreaterThanOrEqual(3);
    // Das Band steht über der Erfassung, im selben Fuß.
    const fuss = page.locator('.etb-erfassung-sticky');
    const b = (await band.boundingBox())!;
    const f = (await fuss.getByPlaceholder('Inhalt …').boundingBox())!;
    expect(b.y + b.height, 'Band über dem Erfassungsfeld').toBeLessThanOrEqual(f.y + 0.5);
  });
}

test('390 × 844 mit Filter: das Band bricht um statt überzulaufen, die Leiste bleibt unter der halben Höhe', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await anmelden(page);
  const id = await einsatzMitEintrag(page);
  for (const dichte of ['kompakt', 'handschuh']) {
    await page.evaluate((d) => localStorage.setItem('lifeline-hub.dichte', d), dichte);
    await page.goto(`/einsaetze/${id}/etb?typ=meldung&q=Pegel`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    await expect(page.locator('[data-lfh="filterhinweis"]')).toBeVisible();
    const m = await page.evaluate(() => ({
      ueberlauf: document.documentElement.scrollWidth - window.innerWidth,
      leiste: document.querySelector('.etb-erfassung-sticky')!.getBoundingClientRect().height,
      hoehe: window.innerHeight,
    }));
    expect(m.ueberlauf, `${dichte}: seitlicher Überlauf`).toBeLessThanOrEqual(0.5);
    expect(m.leiste, `${dichte}: Leiste ${m.leiste} px`).toBeLessThanOrEqual(m.hoehe / 2);
  }
});
