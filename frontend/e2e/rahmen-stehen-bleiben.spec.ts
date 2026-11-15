import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Der Rahmen bleibt beim Rollen erreichbar (LFH-952, Spec `einsatztauglichkeit-layout`,
 * `frontend/AGENTS.md`, Rahmen). Gestuft: ab `md` klebt der Kopf, ab `lg` die Rail-Kategorien
 * und das Modulpanel darunter, ab `md` der Seitenkopf, wenn er ins Drittel passt (zjt7c073); unter
 * `md` rollt der Kopf, und die Betriebszeile klebt nur bei Störung. jsdom rechnet
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

/**
 * Genug Einträge, dass das ETB auf jeder Breite weit über 1500 px rollt. Die Spaltenzeile ab `lg`
 * ist niedriger als die alte Zeitachse (kwc2yszv: ≤ 36 px je einzeiligem Eintrag), deshalb 80.
 */
async function etbFuellen(page: Page, einsatzId: string) {
  for (let i = 0; i < 80; i += 1) {
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
      // Vorbedingung des Rollenzweigs (`e2e/AGENTS.md`): ohne Schreibrecht fehlt die Erfassung.
      await expect(page.getByPlaceholder('Inhalt …')).toHaveCount(rolle === 'beobachter' ? 0 : 1);

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
        // Bedienbar: der Sprung aus der gerollten Seite führt in die Kategorie.
        const lage = page
          .getByRole('navigation', { name: 'Kategorien' })
          .getByRole('button', { name: 'Lage', exact: true });
        await lage.click();
        await expect(lage).toHaveAttribute('aria-current', 'true');
        await expect(page).not.toHaveURL(/\/etb$/);
      }
    });
  }
}

/**
 * Geringe Höhe in `handschuh` (1366 × 520): Kategorien und Fuß (Griff „Menü“ und Einstellungen)
 * passen nicht zusammen unter den Kopf. Als zwei getrennt klebende Teile überdeckte der Fuß die
 * letzte Kategorie, und nichts rollte sie frei (Review 06.10.2026). Als eine Spalte rollt sie in
 * sich, und die letzte Kategorie ist erreichbar.
 */
test('1366 × 520, handschuh, gerollt: auch die letzte Kategorie ist erreichbar', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen niedrig ${Date.now()}`);
  await etbFuellen(page, einsatzId);
  await page.setViewportSize({ width: 1366, height: 520 });
  await etbGerollt(page, einsatzId);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  const spalte = page.locator('[data-lfh="rail-spalte"]');
  // Vorbedingung: die Spalte reicht wirklich nicht, sonst wäre die Aussage leer.
  const ueberhang = await spalte.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(ueberhang, 'Kategorien und Fuß sind höher als der Platz unter dem Kopf').toBeGreaterThan(
    0,
  );

  const rail = page.getByRole('navigation', { name: 'Kategorien' });
  const letzte = rail.locator('[data-lfh="rail-haupt"] button').last();
  const name = (await letzte.getAttribute('aria-label'))!;
  await letzte.click();
  await expect(rail.getByRole('button', { name, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page).not.toHaveURL(/\/etb$/);
});

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
  // Zeilenform aus dem Baustein `GliederungsPaneel` (LLH-1140): Kopf = Name, Zahl = Stärke.
  const name = (await zeile.locator('.lfh-gliederung__kopf').boundingBox())!;
  const staerke = (await zeile.locator('.lfh-gliederung__zahl').boundingBox())!;
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

  // Der Seitenkopf der Verwaltung klebt mit (zjt7c073): der Tabellenkopf hängt unter ihm.
  const seitenkopf = page.locator('[data-lfh="seitenkopf"]');
  await expect(seitenkopf).toHaveCSS('position', 'sticky');
  const unterkante = (await seitenkopf.boundingBox())!;
  const tabellenkopf = page.locator('.ant-table-sticky-holder');
  await expect(tabellenkopf).toBeInViewport();
  const t = (await tabellenkopf.boundingBox())!;
  expect(Math.round(t.y), 'Tabellenkopf bündig unter dem Seitenkopf').toBe(
    Math.round(unterkante.y + unterkante.height),
  );
});

/**
 * zjt7c073 (Spec `einsatztauglichkeit-layout`, „Der Rahmen bleibt beim Rollen erreichbar“): das
 * Modulpanel und der Seitenkopf bleiben stehen. Vorher rollten beide mit: das ETB öffnet am Ende der
 * Zeitachse, die zweite Spalte war dort leer bis auf „Einsatzdauer“.
 *
 * Mutationsprobe (15.11.2026, Chromium): ohne `position: sticky` an `modul-panel-spalte` rot
 * („Modulpanel …“), ohne `SEITENKOPF_KLEBT` rot („Seitenkopf …“, Tabellenkopf oben).
 */

/**
 * Rollt ans Seitenende und prüft die Vorbedingung: die Seite ist WIRKLICH gerollt, mindestens um
 * `mindestens` px (Vorgabe 200).
 */
async function ansEnde(page: Page, mindestens = 200) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(mindestens);
}

async function unterkanteKopf(page: Page): Promise<number> {
  const k = (await page.locator('[data-lfh="rahmen-kopf"]').boundingBox())!;
  return k.y + k.height;
}

test('Modulpanel bleibt im ETB am Ende der Zeitachse stehen (1440 × 900)', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen Panel ${Date.now()}`);
  await etbFuellen(page, einsatzId);
  await page.setViewportSize({ width: 1440, height: 900 });
  await etbGerollt(page, einsatzId);

  const panel = page.locator('[data-lfh="modul-panel"]');
  await expect(panel).toBeVisible();
  const spalte = page.locator('[data-lfh="modul-panel-spalte"]');
  await expect(spalte).toHaveCSS('position', 'sticky');
  expect(Math.round((await spalte.boundingBox())!.y), 'Modulpanel hängt unter der Kopfleiste').toBe(
    Math.round(await unterkanteKopf(page)),
  );
  // Kopf der Kategorie, jeder Eintrag und der Fuß stehen ganz im Bild.
  await expect(spalte.getByText('Erfassung', { exact: true })).toBeInViewport({ ratio: 1 });
  const eintraege = page.locator('[data-lfh="modul-panel-liste"] button');
  for (const eintrag of await eintraege.all()) await expect(eintrag).toBeInViewport({ ratio: 1 });
  await expect(page.locator('[data-lfh="modul-panel-fuss"]')).toBeInViewport({ ratio: 1 });
  // Bedienbar ohne vorheriges Rollen: der Wechsel ins nächste Modul.
  const vorher = await page.evaluate(() => window.scrollY);
  const ziel = eintraege.filter({ hasNotText: 'ETB' }).first();
  await expect(ziel).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(vorher);
  await ziel.click();
  await expect(page).not.toHaveURL(/\/etb$/);
});

test('Modulpanel länger als das Fenster rollt in sich, Kopf und Fuß bleiben (1366 × 520, handschuh)', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen Panel niedrig ${Date.now()}`);
  await etbFuellen(page, einsatzId);
  await page.setViewportSize({ width: 1366, height: 520 });
  await etbGerollt(page, einsatzId);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  // Die Kategorie mit den meisten Einträgen (Kräfte, neun Module).
  await page
    .getByRole('navigation', { name: 'Kategorien' })
    .getByRole('button', { name: 'Kräfte & Mittel', exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/etb$/);
  // Vorbedingung: die Seite ist WIRKLICH gerollt, mindestens um die Kopfhöhe; sonst stünden Kopf
  // und Fuß des Panels auch ohne `sticky` im Fenster.
  await ansEnde(page, await unterkanteKopf(page));

  const liste = page.locator('[data-lfh="modul-panel-liste"]');
  const ueberhang = await liste.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(ueberhang, 'Vorbedingung: die Einträge passen nicht ins Fenster').toBeGreaterThan(0);
  const kopfZeile = page.locator('[data-lfh="modul-panel-spalte"]').getByText('Kräfte & Mittel', {
    exact: true,
  });
  const fuss = page.locator('[data-lfh="modul-panel-fuss"]');
  await expect(kopfZeile).toBeInViewport({ ratio: 1 });
  await expect(fuss).toBeInViewport({ ratio: 1 });
  // Der letzte Eintrag kommt per Wischen ins Bild, ganz zwischen Kopf und Fuß, nicht darunter.
  const letzter = liste.locator('button').last();
  await liste.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(letzter).toBeInViewport({ ratio: 1 });
  const l = (await letzter.boundingBox())!;
  const f = (await fuss.boundingBox())!;
  expect(l.y + l.height, 'letzter Eintrag über dem Fuß').toBeLessThanOrEqual(f.y + 1);
  await expect(kopfZeile).toBeInViewport({ ratio: 1 });
});

for (const ziel of ['etb', 'personal', 'einstellungen', 'verwaltung'] as const) {
  test(`Seitenkopf bleibt stehen: ${ziel} (1180 × 600)`, async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, `Rahmen Seitenkopf ${ziel} ${Date.now()}`);
    if (ziel === 'etb') await etbFuellen(page, einsatzId);
    if (ziel === 'personal') {
      for (let i = 0; i < 30; i += 1) {
        const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personal`, {
          data: { adhoc: { name: `Seitenkopf Kraft ${i}`, funktion: 'Helfer' } },
        });
        expect(antwort.ok(), `Kraft ${i}: ${antwort.status()}`).toBe(true);
      }
    }
    if (ziel === 'verwaltung') {
      const lauf = Date.now();
      for (let i = 0; i < 20; i += 1) {
        const antwort = await page.request.post('/api/benutzer', {
          data: {
            anzeigename: `Seitenkopf ${i}`,
            benutzername: `e2e-seitenkopf-${lauf}-${i}`,
            passwort: 'e2e-rahmen-pw-123',
          },
        });
        expect(antwort.ok(), `Benutzer ${i}: ${antwort.status()}`).toBe(true);
      }
    }
    await page.setViewportSize({ width: 1180, height: 600 });
    await page.goto(
      ziel === 'verwaltung'
        ? '/admin/benutzer'
        : ziel === 'einstellungen'
          ? `/einsaetze/${einsatzId}/einstellungen/allgemein`
          : `/einsaetze/${einsatzId}/${ziel}`,
    );
    const seitenkopf = page.locator('[data-lfh="seitenkopf"]');
    await expect(seitenkopf.getByRole('heading', { level: 1 })).toBeVisible();
    // Vorbedingung: so weit gerollt, dass ein mitrollender Seitenkopf ganz hinter der Kopfleiste
    // läge. Gemessen vor dem Rollen, in Dokumentkoordinaten.
    const seitenkopfUnten = await seitenkopf.evaluate(
      (el) => el.getBoundingClientRect().bottom + window.scrollY,
    );
    const kopfHoehe = await unterkanteKopf(page);
    await ansEnde(page, seitenkopfUnten - kopfHoehe);

    await expect(seitenkopf).toHaveCSS('position', 'sticky');
    expect(Math.round((await seitenkopf.boundingBox())!.y), 'Seitenkopf unter der Kopfleiste').toBe(
      Math.round(await unterkanteKopf(page)),
    );
    await expect(seitenkopf.getByRole('heading', { level: 1 })).toBeInViewport({ ratio: 1 });
    // Bedienbar: jede Seitenaktion steht ganz im Bild.
    for (const knopf of await seitenkopf.locator('button, a[href]').all()) {
      if (await knopf.isVisible()) await expect(knopf).toBeInViewport({ ratio: 1 });
    }
  });
}

test('niedriges Fenster: passt der Seitenkopf nicht ins Drittel, rollt er mit (1366 × 520, handschuh)', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen Seitenkopf niedrig ${Date.now()}`);
  await page.setViewportSize({ width: 1366, height: 520 });
  await page.goto(`/einsaetze/${einsatzId}/einstellungen/allgemein`);
  const seitenkopf = page.locator('[data-lfh="seitenkopf"]');
  await expect(seitenkopf.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  const kopfHoehe = (await page.locator('[data-lfh="rahmen-kopf"]').boundingBox())!.height;
  const seitenkopfHoehe = (await seitenkopf.boundingBox())!.height;
  expect(
    kopfHoehe + seitenkopfHoehe,
    'Vorbedingung: zusammen mehr als ein Drittel',
  ).toBeGreaterThan(520 / 3);
  await ansEnde(page);
  await expect(seitenkopf).not.toHaveCSS('position', 'sticky');
  expect((await seitenkopf.boundingBox())!.y, 'Seitenkopf ist weggerollt').toBeLessThan(0);
  // Die Kopfleiste bleibt wie bisher stehen.
  expect(Math.round((await page.locator('[data-lfh="rahmen-kopf"]').boundingBox())!.y)).toBe(0);
});

test('Fokus rückwärts unter dem klebenden Seitenkopf, Fokus im Seitenkopf rollt nicht (1440 × 900)', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const lauf = Date.now();
  for (let i = 0; i < 30; i += 1) {
    const antwort = await page.request.post('/api/benutzer', {
      data: {
        anzeigename: `Fokus ${i}`,
        benutzername: `e2e-fokus-sk-${lauf}-${i}`,
        passwort: 'e2e-rahmen-pw-123',
      },
    });
    expect(antwort.ok(), `Benutzer ${i}: ${antwort.status()}`).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/benutzer');
  await page.getByPlaceholder('Name oder Benutzername').fill(`e2e-fokus-sk-${lauf}`);
  await expect(page.locator('tr.ant-table-row')).toHaveCount(30);
  await ansEnde(page);
  const seitenkopf = page.locator('[data-lfh="seitenkopf"]');
  await expect(seitenkopf).toHaveCSS('position', 'sticky');

  // Ein Ziel unten im Inhalt fokussieren, dann rückwärts durch die Tabelle.
  await page.locator('tr.ant-table-row').last().locator('a, button').last().focus();
  let geprueft = 0;
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Shift+Tab');
    const lage = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el.closest('[data-lfh="seitenkopf"], [data-lfh="rahmen-kopf"], aside, nav'))
        return null;
      const k = document.querySelector('[data-lfh="seitenkopf"]')!.getBoundingClientRect();
      return { oben: el.getBoundingClientRect().top, kante: k.bottom };
    });
    if (!lage) continue;
    geprueft += 1;
    expect(lage.oben, `Ziel ${i} liegt nicht hinter dem Seitenkopf`).toBeGreaterThanOrEqual(
      lage.kante - 1,
    );
  }
  expect(geprueft, 'Vorbedingung: Ziele im Inhalt getroffen').toBeGreaterThan(5);

  // Ein Fokus in den Seitenaktionen rollt die Seite nicht.
  const vorher = await page.evaluate(() => window.scrollY);
  await seitenkopf.locator('button, a[href]').first().focus();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(vorher);
});
