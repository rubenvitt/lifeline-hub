import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Der Rahmen bleibt beim Rollen erreichbar (LFH-952, Spec `einsatztauglichkeit-layout`,
 * `frontend/AGENTS.md`, Rahmen). Gestuft: ab `md` klebt der Kopf, ab `lg` die Rail-Kategorien
 * darunter; unter `md` rollt der Kopf, und die Betriebszeile klebt nur bei Störung. jsdom rechnet
 * kein Layout, deshalb im Browser.
 *
 * Jede Messung hat ihre Vorbedingung (die Seite ist WIRKLICH gerollt), sonst stünde der Kopf auch
 * ohne `sticky` oben. Die Layout-Messung läuft als Admin und als Beobachter (`e2e/AGENTS.md`).
 *
 * Mutationsprobe (06.10.2026, Chromium): ohne `RAHMEN_KLEBT` am Kopf und an der Betriebszeile
 * rot bei 820/1180/1440 als Admin und als Beobachter, offline auf allen vier Breiten (ab `md` liegt
 * das Wort OFFLINE mit dem Kopf außerhalb des Bildes); die Gegenprobe bei 390 bleibt grün.
 */

const BREITEN = [
  { width: 390, height: 844, kopfKlebt: false, rail: false },
  { width: 820, height: 1180, kopfKlebt: true, rail: false },
  { width: 1180, height: 820, kopfKlebt: true, rail: true },
  { width: 1440, height: 900, kopfKlebt: true, rail: true },
] as const;

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung: name } });
  expect(antwort.ok(), `Einsatz: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  const { id } = (await antwort.json()) as { id: number };
  return String(id);
}

/** Genug Einträge, dass das ETB auf jeder Breite weit über 1500 px rollt. */
async function etbFuellen(page: Page, einsatzId: string) {
  for (let i = 0; i < 40; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: {
        typ: 'meldung',
        inhalt: `Rahmenprobe ${i}: Lagemeldung aus dem Abschnitt, Pegel steigt weiter.`,
        von: 'ELW 1',
        an: 'Leitstelle',
      },
    });
    expect(antwort.ok(), `ETB ${i}: ${antwort.status()}`).toBe(true);
  }
}

async function etbGerollt(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByText('Rahmenprobe 0:', { exact: false }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1500));
  // Vorbedingung: wirklich gerollt, sonst stünde der Kopf auch ohne `sticky` oben.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(1000);
}

async function oben(page: Page, selektor: string): Promise<number> {
  const box = await page.locator(selektor).first().boundingBox();
  expect(box, `${selektor} steht im Layout`).not.toBeNull();
  return box!.y;
}

for (const rolle of ['admin', 'beobachter'] as const) {
  for (const b of BREITEN) {
    test(`${b.width} px als ${rolle}: Kopf und Rail nach dem Rollen`, async ({ page }) => {
      await anmeldenAlsAdmin(page);
      const einsatzId = await einsatzAnlegen(page, `Rahmen ${b.width} ${rolle} ${Date.now()}`);
      await etbFuellen(page, einsatzId);
      if (rolle === 'beobachter') await wechsleZuRolle(page, 'beobachter', einsatzId);
      await page.setViewportSize({ width: b.width, height: b.height });
      await etbGerollt(page, einsatzId);

      const kopf = page.locator('[data-lfh="rahmen-kopf"]');
      if (!b.kopfKlebt) {
        // Unter `md` rollt der Kopf mit (Gegenprobe): am Handy wäre er zu teuer.
        expect(await oben(page, '[data-lfh="rahmen-kopf"]')).toBeLessThan(0);
        return;
      }
      await expect(kopf).toHaveCSS('position', 'sticky');
      expect(Math.round(await oben(page, '[data-lfh="rahmen-kopf"]')), 'Kopf steht oben').toBe(0);
      // Bedienbar, nicht nur sichtbar (`e2e/AGENTS.md`): das Benutzermenü öffnet.
      await page.getByRole('button', { name: 'Benutzermenü' }).click();
      await expect(page.getByRole('menuitem', { name: 'Abmelden' })).toBeInViewport();
      await page.keyboard.press('Escape');

      if (b.rail) {
        const kopfUnten = (await kopf.boundingBox())!;
        const etb = page.getByRole('navigation', { name: 'Kategorien' }).getByRole('button', {
          name: 'Erfassung',
        });
        await expect(etb).toBeInViewport();
        const r = (await etb.boundingBox())!;
        expect(r.y, 'Kategorien hängen unter dem Kopf').toBeGreaterThanOrEqual(
          kopfUnten.y + kopfUnten.height - 1,
        );
      }
    });
  }
}

for (const b of BREITEN) {
  test(`${b.width} px offline: der Zustand bleibt nach dem Rollen sichtbar`, async ({
    page,
    context,
  }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, `Rahmen offline ${b.width} ${Date.now()}`);
    await etbFuellen(page, einsatzId);
    await page.setViewportSize({ width: b.width, height: b.height });
    await etbGerollt(page, einsatzId);
    await context.setOffline(true);
    try {
      if (b.kopfKlebt) {
        // Ab `md` trägt die SYNC-Zelle im klebenden Kopf die Störung als Wort.
        await expect(
          page.locator('[data-lfh="rahmen-kopf"]').getByText('OFFLINE', { exact: true }),
        ).toBeInViewport();
      } else {
        const zeile = page.locator('[data-lfh="betriebszeile"]');
        await expect(zeile).toContainText('Offline');
        await expect(zeile).toHaveCSS('position', 'sticky');
        await expect(zeile).toBeInViewport();
        expect(Math.round(await oben(page, '[data-lfh="betriebszeile"]'))).toBe(0);
      }
    } finally {
      await context.setOffline(false);
    }
  });
}

for (const b of [
  { width: 390, height: 844 },
  { width: 1180, height: 820 },
]) {
  test(`${b.width} px, handschuh: Abmelden ohne Rollen im Benutzermenü`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, `Rahmen Abmelden ${b.width} ${Date.now()}`);
    await page.setViewportSize(b);
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    const abmelden = page.getByRole('menuitem', { name: 'Abmelden' });
    // Ohne Rollen: Abmelden steht oben im Menü, das Menü ist dafür nicht gerollt worden.
    const gerollt = await page.locator('.ant-dropdown-menu').evaluate((m) => m.scrollTop);
    expect(gerollt, 'Vorbedingung: das Menü steht am Anfang').toBe(0);
    await expect(abmelden).toBeInViewport();
    await abmelden.click();
    await expect(page).toHaveURL(/\/login/);
  });
}

test('1180 px mit offenem Modulmenü: die Stärke steht auf Höhe des Abschnittsnamens', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen Überblick ${Date.now()}`);
  const ab = await page.request.post(`/api/einsaetze/${einsatzId}/abschnitte`, {
    data: { name: 'Abschnitt Nordufer' },
  });
  expect(ab.ok(), `Abschnitt: ${ab.status()}`).toBe(true);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`/einsaetze/${einsatzId}/ueberblick`);

  // Am Tablet quer ist das Menü ohne Wahl zu; der Griff öffnet es.
  await expect(page.locator('[data-lfh="modul-panel"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Menü ausklappen' }).click();
  await expect(page.locator('[data-lfh="modul-panel"]')).toBeVisible();

  const zeile = page.locator('[data-lfh="ueberblick-abschnitt"]').filter({
    hasText: 'Abschnitt Nordufer',
  });
  await expect(zeile).toBeVisible();
  const name = (await zeile.locator('.ueberblick-abschnitt__name').boundingBox())!;
  const staerke = (await zeile.locator('.ueberblick-abschnitt__staerke').boundingBox())!;
  expect(Math.abs(staerke.y - name.y), 'Stärke in der Zeile des Namens').toBeLessThanOrEqual(2);
  expect(staerke.x, 'Stärke rechts vom Namen').toBeGreaterThan(name.x + name.width);
});

test('Tabellenkopf steht beim Rollen unter dem klebenden Kopf, nicht dahinter', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const lauf = Date.now();
  for (let i = 0; i < 20; i += 1) {
    const antwort = await page.request.post('/api/benutzer', {
      data: {
        anzeigename: `Rahmen ${i}`,
        benutzername: `e2e-rahmen-${lauf}-${i}`,
        passwort: 'e2e-rahmen-pw-123',
      },
    });
    expect(antwort.ok(), `Benutzer ${i}: ${antwort.status()}`).toBe(true);
  }
  await page.setViewportSize({ width: 1180, height: 600 });
  await page.goto('/admin/benutzer');
  await page.getByPlaceholder('Name oder Benutzername').fill(`e2e-rahmen-${lauf}`);
  await expect(page.locator('tr.ant-table-row')).toHaveCount(20);

  const tabelle = (await page.locator('.ant-table-wrapper').first().boundingBox())!;
  await page.evaluate((y) => window.scrollTo(0, y), tabelle.y + 200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

  const kopf = (await page.locator('[data-lfh="rahmen-kopf"]').boundingBox())!;
  const tabellenkopf = page.locator('.ant-table-sticky-holder');
  await expect(tabellenkopf).toBeInViewport();
  const t = (await tabellenkopf.boundingBox())!;
  expect(Math.round(t.y), 'Tabellenkopf bündig unter dem Rahmen').toBe(
    Math.round(kopf.y + kopf.height),
  );
});
