import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';
import { abmeldenUeberMenue, benutzermenueAusloeser } from './menue-kern';

/**
 * Der Rahmen bleibt beim Rollen erreichbar (LFH-952, LLH-1728, Spec `einsatztauglichkeit-layout`,
 * `frontend/AGENTS.md`, Rahmen). Der Kopf klebt in jeder Breite, ab `lg` auch die Rail-Kategorien
 * und das Modulpanel darunter, ab `md` der Seitenkopf, wenn er ins Drittel passt (zjt7c073); unter
 * `md` klebt die gestörte Betriebszeile über dem Kopf (Rang, design.md D2 in
 * `openspec/changes/archive/2026-11-15-ejt520so-handy-kopfleiste-fixiert/`). jsdom rechnet kein Layout, deshalb im
 * Browser.
 *
 * Jede Messung hat ihre Vorbedingung (die Seite ist WIRKLICH gerollt), sonst stünde der Kopf auch
 * ohne `sticky` oben. Die Layout-Messung läuft als Admin und als Beobachter (`e2e/AGENTS.md`).
 *
 * Mutationsprobe (06.10.2026, Chromium): ohne `RAHMEN_KLEBT` am Kopf und an der Betriebszeile
 * rot bei 820/1180/1440 als Admin und als Beobachter, offline auf allen vier Breiten (ab `md` liegt
 * das Wort OFFLINE mit dem Kopf außerhalb des Bildes); die Gegenprobe bei 390 bleibt grün.
 * Mutationsprobe LLH-1728 (15.11.2026, Chromium): klebt der Einsatzkopf unter `md` wieder nicht,
 * rot bei 390 px als Admin und Beobachter, offline, in der Übung (auch offline) und die
 * einzeilige Zeile in allen drei Dichten; die Einsatzliste (App-Rahmen) bleibt zu Recht grün.
 * Mutationsprobe LLH-2037 (22.11.2026, Chromium): mit der Einheit-Auswahl der ETB-Filterleiste
 * wieder auf Feldstufe `schmal` rot im ETB-Fall bei 1180 × 600 („Filterleiste einzeilig“, 64
 * statt 32 px); die übrigen Seitenköpfe bleiben grün.
 */

const BREITEN = [
  { width: 390, height: 844, handy: true, rail: false },
  { width: 820, height: 1180, handy: false, rail: false },
  { width: 1180, height: 820, handy: false, rail: true },
  { width: 1440, height: 900, handy: false, rail: true },
] as const;

async function einsatzAnlegen(
  page: Page,
  name: string,
  einsatzart?: 'uebung' | 'realeinsatz',
): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: name, ...(einsatzart ? { einsatzart } : {}) },
  });
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

/**
 * Dreistellige Zähler wie im echten Einsatz (LLH-2037): zu den 80 Meldungen aus
 * {@link etbFuellen} 45 weitere und je 12 Anordnungen und Lagefeststellungen — „Alle 149“,
 * „Meldung 125“, „Anordnung 12“, „Lage 12“.
 */
async function etbDreistellig(page: Page, einsatzId: string) {
  await etbFuellen(page, einsatzId);
  const weitere = [
    ...Array.from({ length: 45 }, () => 'meldung'),
    ...Array.from({ length: 12 }, () => 'anordnung'),
    ...Array.from({ length: 12 }, () => 'lage'),
  ];
  for (const [i, typ] of weitere.entries()) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: { typ, inhalt: `Zählerprobe ${i}`, von: 'ELW 1', an: 'Leitstelle' },
    });
    expect(antwort.ok(), `ETB ${typ} ${i}: ${antwort.status()}`).toBe(true);
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
      await expect(kopf).toHaveCSS('position', 'sticky');
      expect(Math.round(await oben(page, '[data-lfh="rahmen-kopf"]')), 'Kopf steht oben').toBe(0);
      // Bedienbar, nicht nur sichtbar (`e2e/AGENTS.md`): das Benutzermenü öffnet, am Handy aus der
      // Navigation (LLH-1728, D3).
      await (await benutzermenueAusloeser(page)).click();
      await expect(page.getByRole('menuitem', { name: 'Profil' })).toBeInViewport();
      await page.keyboard.press('Escape');

      if (b.rail) {
        const kopfUnten = (await kopf.boundingBox())!;
        const etb = page.getByRole('navigation', { name: 'Kategorien' }).getByRole('link', {
          name: 'Führung',
        });
        await expect(etb).toBeInViewport();
        const r = (await etb.boundingBox())!;
        expect(r.y, 'Kategorien hängen unter dem Kopf').toBeGreaterThanOrEqual(
          kopfUnten.y + kopfUnten.height - 1,
        );
        // Bedienbar: der Sprung aus der gerollten Seite führt in die Kategorie.
        const lage = page
          .getByRole('navigation', { name: 'Kategorien' })
          .getByRole('link', { name: 'Lage', exact: true });
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
  const letzte = rail.locator('[data-lfh="rail-haupt"] :is(a, button)').last();
  const name = (await letzte.getAttribute('aria-label'))!;
  await letzte.click();
  await expect(rail.getByRole('link', { name, exact: true })).toHaveAttribute(
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
      if (!b.handy) {
        // Ab `md` trägt die SYNC-Zelle im klebenden Kopf die Störung als Wort.
        await expect(
          page.locator('[data-lfh="rahmen-kopf"]').getByText('OFFLINE', { exact: true }),
        ).toBeInViewport();
      } else {
        // Am Handy steht die Verbindung im Kopf nur als Symbol: die Betriebszeile nennt die
        // Störung und klebt über dem Kopf (LLH-1728, D2).
        const zeile = page.locator('[data-lfh="betriebszeile"]');
        await expect(zeile).toContainText('Offline');
        await expect(zeile).toHaveCSS('position', 'sticky');
        await expect(zeile).toBeInViewport();
        const z = (await zeile.boundingBox())!;
        expect(Math.round(z.y)).toBe(0);
        await expect
          .poll(
            async () => Math.round(await oben(page, '[data-lfh="rahmen-kopf"]')),
            'Kopf direkt unter der Betriebszeile',
          )
          .toBe(Math.round(z.y + z.height));
      }
    } finally {
      await context.setOffline(false);
    }
  });
}

/**
 * Der Rail-Fuß bleibt im Fenster (LLH-1734, Spec `einsatztauglichkeit-layout`): ab `md` steht die
 * Betriebszeile im Fluss über dem Kopf und schob die Rail-Spalte um ihre Höhe nach unten, „Einst.“
 * lag unter dem Fensterrand. Gemessen bei Rollstand 0, denn erst gerollt rutscht die Zeile weg.
 */
test('1366 × 768 offline, oben: „Einst.“ am Rail-Fuß bleibt im Fenster', async ({
  page,
  context,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen Fuß ${Date.now()}`);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const einstellungen = page
    .getByRole('navigation', { name: 'Kategorien' })
    .getByRole('link', { name: 'Einstellungen', exact: true });
  await expect(einstellungen).toBeVisible();
  await context.setOffline(true);
  try {
    // Vorbedingung: die Zeile steht wirklich im Fluss über dem Kopf, sonst wäre die Aussage leer.
    const zeile = page.locator('[data-lfh="betriebszeile"]');
    await expect(zeile).toContainText('Offline');
    await expect.poll(async () => (await zeile.boundingBox())?.height ?? 0).toBeGreaterThan(20);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await expect
      .poll(
        async () => {
          const box = await einstellungen.boundingBox();
          return box ? box.y + box.height : Number.POSITIVE_INFINITY;
        },
        { message: 'Unterkante von „Einst.“' },
      )
      .toBeLessThanOrEqual(768);
  } finally {
    await context.setOffline(false);
  }
});

for (const b of [
  { width: 390, height: 844 },
  { width: 1180, height: 820 },
]) {
  // LLH-1730: „Abmelden“ steht zuletzt und darf im Handschuh-Betrieb erst durch Rollen ins Bild
  // kommen; erreichbar und bedienbar bleibt es (Spec `einsatztauglichkeit-layout`, „Benutzermenü:
  // Einsatzfunktion im Kopf“, Szenario „Schichtwechsel am Handy im Handschuh-Betrieb“).
  test(`${b.width} px, handschuh: Abmelden im Benutzermenü erreichbar`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, `Rahmen Abmelden ${b.width} ${Date.now()}`);
    await page.setViewportSize(b);
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

    await abmeldenUeberMenue(page);
  });
}

test('1180 px mit offenem Modulmenü: die Stärke steht auf Höhe des Abschnittsnamens', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen Überblick ${Date.now()}`);
  const ab = await page.request.post(`/api/einsaetze/${einsatzId}/sectors`, {
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
    const antwort = await page.request.post('/api/users', {
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
  // Wiederholt gerollt: lädt der Inhalt noch, wächst die Seite nach dem ersten Rollen weiter.
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return window.scrollY;
      }),
    )
    .toBeGreaterThan(mindestens);
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
  // Kopf der Kategorie, jeder Eintrag und der Fuß stehen ganz im Bild. Das ETB steht in der
  // Führung (y3zh5ymv D10).
  await expect(spalte.getByText('Führung', { exact: true })).toBeInViewport({ ratio: 1 });
  const eintraege = page.locator('[data-lfh="modul-panel-liste"] :is(a, button)');
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
    .getByLabel('Kräfte & Mittel', { exact: true })
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
  const letzter = liste.locator(':is(a, button)').last();
  await liste.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(letzter).toBeInViewport({ ratio: 1 });
  const l = (await letzter.boundingBox())!;
  const f = (await fuss.boundingBox())!;
  expect(l.y + l.height, 'letzter Eintrag über dem Fuß').toBeLessThanOrEqual(f.y + 1);
  await expect(kopfZeile).toBeInViewport({ ratio: 1 });
});

for (const ziel of ['etb', 'personal', 'einstellungen', 'verwaltung'] as const) {
  // Das ETB klebt Seitenkopf, Filterleiste und Spaltenkopf nur GEMEINSAM und nur, solange sie mit
  // der Kopfleiste höchstens ein Drittel der Fensterhöhe nehmen (`etb/etbKopfKleben.ts`): bei
  // 600 px also nur mit EINZEILIGER Filterleiste (53 + 44 + 32 + 26 px). Gemessen mit
  // dreistelligen Zählern wie im echten Einsatz; vorher brach die Leiste dort um (LLH-2034,
  // LLH-2037). Das Mitrollen im niedrigen Fenster prüft „niedriges Fenster: …“ unten.
  test(`Seitenkopf bleibt stehen: ${ziel} (1180 × 600)`, async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, `Rahmen Seitenkopf ${ziel} ${Date.now()}`);
    if (ziel === 'etb') await etbDreistellig(page, einsatzId);
    if (ziel === 'personal') {
      for (let i = 0; i < 30; i += 1) {
        const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personnel`, {
          data: { adhoc: { name: `Seitenkopf Kraft ${i}`, funktion: 'Helfer' } },
        });
        expect(antwort.ok(), `Kraft ${i}: ${antwort.status()}`).toBe(true);
      }
    }
    if (ziel === 'verwaltung') {
      const lauf = Date.now();
      for (let i = 0; i < 20; i += 1) {
        const antwort = await page.request.post('/api/users', {
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
    if (ziel === 'etb') {
      // Vorbedingung: die Zähler stehen, dreistellig. Ohne sie wäre die Typleiste schmaler.
      const typleiste = page.locator('[data-lfh="etb-filter-typ"]');
      await expect(typleiste).toContainText('149');
      await expect(typleiste).toContainText('125');
      // Die Leiste bleibt einzeilig: so hoch wie ihre Typleiste (LLH-2037). Bricht sie um, ist
      // das hier rot und nicht erst als „klebt nicht“ unten.
      const leiste = page.locator('[data-lfh="etb-filterleiste"]');
      expect(
        Math.round((await leiste.boundingBox())!.height),
        'Filterleiste einzeilig bei 1180 px mit dreistelligen Zählern',
      ).toBe(Math.round((await typleiste.boundingBox())!.height));
    }
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
    const antwort = await page.request.post('/api/users', {
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

/**
 * Review zjt7c073 (B3): Rail, Modulpanel und Verwaltungsmenü kleben an der Kopfhöhe, der
 * Fokusabstand am Dokument zählt aber den klebenden Seitenkopf mit. Ohne Ausnahme rollte ein
 * Fokus auf die oberste Kategorie die Seite um die Seitenkopfhöhe zurück (gemessen 1349 → 1305),
 * obwohl das Ziel klebt und an seinem Platz blieb.
 */
test('Fokus in der klebenden Rail rollt die Seite nicht (1440 × 900)', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen Rail-Fokus ${Date.now()}`);
  for (let i = 0; i < 30; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personnel`, {
      data: { adhoc: { name: `Rail-Fokus Kraft ${i}`, funktion: 'Helfer' } },
    });
    expect(antwort.ok(), `Kraft ${i}: ${antwort.status()}`).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/personal`);
  await expect(
    page.locator('[data-lfh="seitenkopf"]').getByRole('heading', { level: 1 }),
  ).toBeVisible();
  await ansEnde(page);
  // Vorbedingung: der Seitenkopf klebt, die Rahmenhöhe ist größer als die Kopfhöhe.
  await expect(page.locator('[data-lfh="seitenkopf"]')).toHaveCSS('position', 'sticky');
  const vorher = await page.evaluate(() => window.scrollY);
  const rail = page.locator('[data-lfh="rail-spalte"] :is(a, button)').first();
  await rail.focus();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY), 'Fokus auf „Führung“').toBe(vorher);
  // Auch per Tastatur, rückwärts vom zweiten Ziel der Rail.
  await page.locator('[data-lfh="rail-spalte"] :is(a, button)').nth(1).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(rail).toBeFocused();
  expect(await page.evaluate(() => window.scrollY), 'Shift+Tab auf „Führung“').toBe(vorher);
});

/**
 * Übungsband (LLH-1725, Spec `uebungsmarke`, „Das Übungsband bleibt beim Rollen stehen“; D4 in
 * `openspec/changes/archive/2026-11-15-wc3kzd54-uebungsmarke-rahmen/design.md`): es klebt in JEDER Breite, direkt
 * unter dem Kopf, der seit LLH-1728 auch am Handy klebt; dort gestört unter Betriebszeile und Kopf.
 * Die Kopfhöhe `--lfh-kopf-oben` endet an seiner Unterkante, die Rahmenhöhe `--lfh-rahmen-oben`
 * zählt einen klebenden Seitenkopf darunter mit (zjt7c073 D2): daran hängt jeder stehende
 * Tabellenkopf (Guard `rahmenOben.guard.test.ts`), also liegt keiner hinter dem Band.
 *
 * Mutationsprobe (15.11.2026, Chromium): klebt das Band mit `top: 0` statt unter den übrigen
 * Quellen, rot bei 820/1180/1440 („Band bündig unter dem Kopf“) und offline bei 390; die Probe bei
 * 390 ohne Störung bleibt zu Recht grün.
 */
async function kopfOben(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--lfh-kopf-oben'),
    ),
  );
}

for (const b of BREITEN) {
  test(`${b.width} px, Übung: das Band steht nach dem Rollen unter dem Kopf`, async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, `Rahmen Übung ${b.width} ${Date.now()}`, 'uebung');
    await etbFuellen(page, einsatzId);
    await page.setViewportSize({ width: b.width, height: b.height });
    await etbGerollt(page, einsatzId);

    const band = page.locator('[data-lfh="uebung-band"]');
    await expect(band).toContainText('Übung');
    await expect(band).toHaveCSS('position', 'sticky');
    await expect(band).toBeInViewport();
    const r = (await band.boundingBox())!;
    const kopf = (await page.locator('[data-lfh="rahmen-kopf"]').boundingBox())!;
    expect(Math.round(r.y), 'Band bündig unter dem Kopf').toBe(Math.round(kopf.y + kopf.height));
    await expect
      .poll(async () => Math.round(await kopfOben(page)), 'Kopfkante unter dem Band')
      .toBe(Math.round(r.y + r.height));
  });
}

test('390 px, Übung, offline: Betriebszeile, Kopf und Band stehen übereinander', async ({
  page,
  context,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen Übung offline ${Date.now()}`, 'uebung');
  await etbFuellen(page, einsatzId);
  await page.setViewportSize({ width: 390, height: 844 });
  await etbGerollt(page, einsatzId);
  await context.setOffline(true);
  try {
    const zeile = page.locator('[data-lfh="betriebszeile"]');
    await expect(zeile).toContainText('Offline');
    await expect(zeile).toBeInViewport();
    const z = (await zeile.boundingBox())!;
    expect(Math.round(z.y)).toBe(0);
    const kopf = page.locator('[data-lfh="rahmen-kopf"]');
    await expect
      .poll(async () => Math.round((await kopf.boundingBox())!.y), 'Kopf unter der Betriebszeile')
      .toBe(Math.round(z.y + z.height));
    const k = (await kopf.boundingBox())!;
    const band = page.locator('[data-lfh="uebung-band"]');
    await expect
      .poll(async () => Math.round((await band.boundingBox())!.y), 'Band unter dem Kopf')
      .toBe(Math.round(k.y + k.height));
  } finally {
    await context.setOffline(false);
  }
});

test('Realeinsatz: kein Band, die Kopfkante bleibt am Kopf (Gegenprobe)', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page, `Rahmen real ${Date.now()}`, 'realeinsatz');
  await etbFuellen(page, einsatzId);
  await page.setViewportSize({ width: 1180, height: 820 });
  await etbGerollt(page, einsatzId);
  await expect(page.locator('[data-lfh="uebung-band"]')).toHaveCount(0);
  const kopf = (await page.locator('[data-lfh="rahmen-kopf"]').boundingBox())!;
  expect(Math.round(await kopfOben(page))).toBe(Math.round(kopf.height));
});

/**
 * Eine Zeile am Handy (LLH-1728, Spec `einsatztauglichkeit-layout`, „Langes Rollen im ETB am
 * Handy“): Menü, Name, Alarm, Verbindung und Uhr stehen nach dem Rollen in einer Zeile ganz im
 * Fenster, in jeder Dichtestufe; Suche und Benutzermenü stehen nicht im Kopf (D3).
 */
for (const dichte of ['kompakt', 'komfortabel', 'handschuh'] as const) {
  test(`390 px, ${dichte}: der Kopf klebt einzeilig mit Uhr`, async ({ page }) => {
    // Ruhezustand der Alarmzentrale: Ton bereit, Benachrichtigung erlaubt (wie `kopfzeile-schmal`).
    await page.addInitScript((d) => {
      localStorage.setItem('lifeline-hub.dichte', d);
      class Erlaubt {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
      }
      Object.defineProperty(window, 'Notification', { value: Erlaubt, configurable: true });
      const AC = window.AudioContext;
      if (AC) {
        Object.defineProperty(AC.prototype, 'state', { configurable: true, get: () => 'running' });
        AC.prototype.resume = () => Promise.resolve();
      }
    }, dichte);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, `Rahmen Zeile ${dichte} ${Date.now()}`);
    await etbFuellen(page, einsatzId);
    await page.setViewportSize({ width: 390, height: 844 });
    await etbGerollt(page, einsatzId);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    const kopf = page.locator('[data-lfh="rahmen-kopf"]');
    await expect(kopf).toHaveCSS('position', 'sticky');
    const ziele = [
      kopf.getByRole('button', { name: 'Navigation öffnen' }),
      kopf.locator('[data-lfh="kopf-einsatzname"]'),
      kopf.getByRole('button', { name: /^Alarmzentrale:/ }),
      kopf.locator('[data-lfh="kopf-sync"]'),
      kopf.locator('[data-lfh="kopf-uhr"]'),
    ];
    const k = (await kopf.boundingBox())!;
    expect(Math.round(k.y), 'Kopf steht oben').toBe(0);
    let hoehe = 0;
    for (const ziel of ziele) {
      await expect(ziel).toBeInViewport({ ratio: 1 });
      const r = (await ziel.boundingBox())!;
      hoehe = Math.max(hoehe, r.height);
      // Einzeilig: jedes Ziel liegt in derselben Zeile wie der Griff „Menü“.
      expect(r.y - k.y, 'in der ersten Zeile').toBeLessThan(r.height);
    }
    expect(k.height, 'eine Zeile hoch').toBeLessThanOrEqual(hoehe + 2);
    await expect(kopf.getByRole('button', { name: 'Suchen' })).toHaveCount(0);
    await expect(kopf.getByRole('button', { name: 'Benutzermenü' })).toHaveCount(0);
  });
}

for (const dichte of ['kompakt', 'komfortabel'] as const) {
  test(`390 px, ${dichte}: die Einsatzliste behält den Kopf einzeilig mit Uhr`, async ({
    page,
  }) => {
    await page.addInitScript((d) => localStorage.setItem('lifeline-hub.dichte', d), dichte);
    await anmeldenAlsAdmin(page);
    // Genug Einsätze, dass die Liste rollt.
    for (let i = 0; i < 25; i += 1) await einsatzAnlegen(page, `Rahmen Liste ${i} ${Date.now()}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/einsaetze');
    const kopf = page.locator('[data-lfh="rahmen-kopf"]');
    await expect(kopf.locator('[data-lfh="kopf-uhr"]')).toBeVisible();
    // Erst rollen, wenn die Liste steht: sonst ist das Dokument noch kurz.
    await expect(page.getByText('Rahmen Liste 24', { exact: false }).first()).toBeAttached();
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.scrollTo(0, 1000);
          return window.scrollY;
        }),
      )
      .toBeGreaterThanOrEqual(500);
    await expect(kopf).toHaveCSS('position', 'sticky');
    const k = (await kopf.boundingBox())!;
    expect(Math.round(k.y)).toBe(0);
    const uhr = (await kopf.locator('[data-lfh="kopf-uhr"]').boundingBox())!;
    expect(k.height, 'eine Zeile hoch').toBeLessThanOrEqual(uhr.height + 2);
    // Die Bildmarke führt zur Einsatzliste, wo die Wortmarke der Uhr weicht (D5).
    await expect(kopf.getByRole('link', { name: 'lifeline-hub' })).toHaveAttribute(
      'href',
      '/einsaetze',
    );
  });
}
