import { expect, test, type Page } from '@playwright/test';
import { pruefe, randKontrast } from './kontrast-kern';

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
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
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
