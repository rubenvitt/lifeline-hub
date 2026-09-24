import { expect, test, type Browser, type Page } from '@playwright/test';

// LFH-673: Betreuung auf der Lagekarte — Durchstich im echten Renderer.
//
// Warum im Browser: `LagekartePage.test.tsx` stubbt die Kartenfläche weg. Ob eine verortete
// Stelle wirklich in der Marker-Quelle landet, ob der Platziermodus aus dem Modul heraus
// ankommt, ob eine zweite Karte den Marker ohne Neuladen bekommt (Verortung schreibt kein
// ETB, verteilt aber live) und was die Bezirksfläche als Beschriftung trägt, sieht nur ein
// echter Renderer. Geprüft wird die Quelle (`querySourceFeatures`), die Bilder unter
// `test-results/` sind Sichtbelege für die Prüfliste.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  loaded(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  project(ll: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  querySourceFeatures(quelle: string): { properties: Record<string, unknown> | null }[];
}

async function anmeldenAls(page: Page, benutzer: string, passwort: string) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(benutzer);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function senden(
  page: Page,
  methode: 'post' | 'put' | 'patch',
  pfad: string,
  data?: unknown,
): Promise<{ id: number }> {
  const antwort = await page.request[methode](pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as { id: number };
}

async function features(page: Page, quelle: string): Promise<Record<string, unknown>[]> {
  return page.evaluate((q) => {
    const k = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
    if (!k || !k.loaded()) return [];
    return k.querySourceFeatures(q).map((f) => f.properties ?? {});
  }, quelle);
}

async function karteBereit(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
}

async function springe(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(
    ({ c, z }) =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.jumpTo({ center: c, zoom: z }),
    { c: center, z: zoom },
  );
}

async function klickeAuf(page: Page, ll: [number, number]) {
  const p = await page.evaluate((c) => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    const px = k.project(c);
    const r = k.getCanvas().getBoundingClientRect();
    return { x: r.left + px.x, y: r.top + px.y };
  }, ll);
  await page.mouse.click(p.x, p.y);
}

async function schluessel(page: Page): Promise<string[]> {
  return (await features(page, 'marker-cluster')).map((p) => String(p.schluessel));
}

async function zonenLabel(page: Page): Promise<string[]> {
  return [...new Set((await features(page, 'zonen')).map((p) => String(p.label)))];
}

/** Zweite Sitzung desselben Admins — die „andere Karte" im Führungsraum. */
async function zweiteSitzung(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await anmeldenAls(page, ADMIN, PW);
  return page;
}

const ORT: [number, number] = [9.356, 52.103];
const STELLE_ORT: [number, number] = [9.36, 52.105];
const FLAECHE = {
  type: 'Polygon',
  coordinates: [
    [
      [9.35, 52.1],
      [9.354, 52.1],
      [9.354, 52.102],
      [9.35, 52.102],
      [9.35, 52.1],
    ],
  ],
};

test.use({ viewport: { width: 1366, height: 768 } });

test('Betreuungsstelle: aus dem Modul verorten, Marker live auf einer zweiten Karte', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const LAUF = Date.now();
  await anmeldenAls(page, ADMIN, PW);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Weserlage ${LAUF}`,
  });
  const basis = `/api/einsaetze/${e}`;
  await senden(page, 'patch', basis, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });
  const { id: sid } = await senden(page, 'post', `${basis}/betreuung/stellen`, {
    bezeichnung: 'NU Turnhalle Nord',
    art: 'notunterkunft',
    kapazitaet_personen: 150,
  });

  // Die zweite Karte steht schon offen, bevor verortet wird.
  const andere = await zweiteSitzung(browser);
  await andere.goto(`/einsaetze/${e}/lagekarte`);
  await karteBereit(andere);
  await springe(andere, STELLE_ORT, 15);
  expect(await schluessel(andere)).not.toContain(`betreuungsstelle-${sid}`);

  // Einstieg im Modul: Menü der Zeile → „Auf Karte verorten".
  await page.goto(`/einsaetze/${e}/betreuung`);
  await page.getByRole('button', { name: 'Aktionen zu Stelle NU Turnhalle Nord' }).click();
  await page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')
    .getByRole('menuitem', { name: 'Auf Karte verorten' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${e}/lagekarte`));
  await karteBereit(page);
  await expect(page.getByText(/Klick auf die Karte setzt die Koordinate/)).toBeVisible();
  // apply-then-clean: der Auftrag ist aus der Adresse verschwunden.
  await expect(page).not.toHaveURL(/platzieren=/);
  await springe(page, STELLE_ORT, 15);
  await klickeAuf(page, STELLE_ORT);

  await expect
    .poll(() => schluessel(page), { timeout: 30_000 })
    .toContain(`betreuungsstelle-${sid}`);
  // Die andere Karte bekommt den Marker über das Live-Ereignis, ohne Neuladen.
  await expect
    .poll(() => schluessel(andere), { timeout: 30_000 })
    .toContain(`betreuungsstelle-${sid}`);

  // Kein ETB-Eintrag für die Verortung.
  const etb = (await (await page.request.get(`${basis}/etb`)).json()) as { inhalt: string }[];
  expect(etb.filter((x) => /Turnhalle/.test(x.inhalt))).toHaveLength(1); // nur „angelegt"

  // Auswahl → Datenraster und Sprung ins Modul.
  const ausgewaehlt = page.locator('[data-paneel="ausgewaehlt"]');
  await expect(async () => {
    await klickeAuf(page, STELLE_ORT);
    await expect(ausgewaehlt.getByText('NU Turnhalle Nord')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(ausgewaehlt.getByText('Betreuungsstelle · Notunterkunft')).toBeVisible();
  await page.screenshot({ path: info.outputPath('stelle-nacht.png') });
  await ausgewaehlt.getByRole('link', { name: /Im Fachmodul öffnen/ }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${e}/betreuung\\?stelle=${sid}`));
  await andere.context().close();
});

test('Evakuierungsbezirk: Fläche mit Räumung, Sprung aus dem Modul, Storno löst', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const LAUF = Date.now();
  await anmeldenAls(page, ADMIN, PW);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Räumungslage ${LAUF}`,
  });
  const basis = `/api/einsaetze/${e}`;
  await senden(page, 'patch', basis, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });
  const { id: bid } = await senden(page, 'post', `${basis}/betreuung/bezirke`, {
    bezeichnung: 'Uferstraße 12–40',
    plan_personen: 640,
    plan_erhebung: 'geschaetzt',
  });
  await senden(page, 'post', `${basis}/zonen`, {
    typ: 'evakuierungsbezirk',
    geometrie_typ: 'Polygon',
    geometrie: JSON.stringify(FLAECHE),
    evakuierungsbezirk_id: bid,
  });

  // Aus dem Modul: „Auf Karte zeigen" am Bezirk.
  await page.goto(`/einsaetze/${e}/betreuung`);
  await page.getByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }).click();
  await page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')
    .getByRole('menuitem', { name: 'Auf Karte zeigen' })
    .click();
  await karteBereit(page);
  await expect(page).not.toHaveURL(/evakuierungsbezirk=/);
  await expect(page.getByLabel('Gehört zu Evakuierungsbezirk')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Betreuung zu Uferstraße 12–40' })).toBeVisible();
  await expect
    .poll(() => zonenLabel(page), { timeout: 30_000 })
    .toContain('Uferstraße 12–40 · Räumung: angeordnet');
  await page.screenshot({ path: info.outputPath('bezirk-nacht.png') });

  // Räumung aus einer anderen Sitzung → die Beschriftung folgt live.
  const andere = await zweiteSitzung(browser);
  await senden(andere, 'patch', `${basis}/betreuung/bezirke/${bid}`, { raeumung: 'laeuft' });
  await expect
    .poll(() => zonenLabel(page), { timeout: 30_000 })
    .toContain('Uferstraße 12–40 · Räumung: läuft');

  // Tagmodus: dieselbe Fläche als Sichtbeleg. Nachtbetrieb ist die Vorgabe und folgt nicht
  // `prefers-color-scheme` — umgeschaltet wird über den gespeicherten Modus.
  await page.evaluate(() => localStorage.setItem('lifeline-hub.theme', 'light'));
  await page.goto(`/einsaetze/${e}/lagekarte?evakuierungsbezirk=${bid}`);
  await karteBereit(page);
  await expect
    .poll(() => zonenLabel(page), { timeout: 30_000 })
    .toContain('Uferstraße 12–40 · Räumung: läuft');
  await page.screenshot({ path: info.outputPath('bezirk-tag.png') });

  // Storno löst die Fläche; sie bleibt als nicht zugeordnete Bezirksfläche stehen.
  await senden(andere, 'post', `${basis}/betreuung/bezirke/${bid}/stornieren`);
  await expect.poll(() => zonenLabel(page), { timeout: 30_000 }).toEqual(['Evakuierungsbezirk']);
  await andere.context().close();
});

test('ohne Modul Betreuung: Sperrzeile, Fläche nur mit Typwort', async ({ page }) => {
  test.setTimeout(180_000);
  const LAUF = Date.now();
  const NUTZER = `e2e-betreuung-${LAUF}`;
  const NUTZER_PW = 'e2e-betreuung-pw-123';
  await anmeldenAls(page, ADMIN, PW);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Sperrlage ${LAUF}`,
  });
  const basis = `/api/einsaetze/${e}`;
  await senden(page, 'patch', basis, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });
  const { id: bid } = await senden(page, 'post', `${basis}/betreuung/bezirke`, {
    bezeichnung: 'Uferstraße 12–40',
    plan_personen: 640,
    plan_erhebung: 'geschaetzt',
  });
  await senden(page, 'post', `${basis}/zonen`, {
    typ: 'evakuierungsbezirk',
    geometrie_typ: 'Polygon',
    geometrie: JSON.stringify(FLAECHE),
    evakuierungsbezirk_id: bid,
  });
  await senden(page, 'put', `${basis}/modul-overrides/betreuung`, {
    sichtbar: true,
    benoetigte_rolle: 'fuehrungskraft',
  });
  const { id: nutzerId } = await senden(page, 'post', '/api/benutzer', {
    anzeigename: `E2E Betreuung ${LAUF}`,
    benutzername: NUTZER,
    passwort: NUTZER_PW,
  });
  await senden(page, 'put', `${basis}/mitglieder/${nutzerId}`, {
    einsatz_rolle: 'fuehrungspersonal',
  });
  await page.request.post('/api/auth/logout');

  await anmeldenAls(page, NUTZER, NUTZER_PW);
  await page.goto(`/einsaetze/${e}/lagekarte`);
  await karteBereit(page);
  await springe(page, [9.352, 52.101], 15);
  await expect(
    page.getByRole('button', { name: 'Betreuungsstellen – Keine Berechtigung' }),
  ).toBeDisabled();
  await expect.poll(() => zonenLabel(page), { timeout: 30_000 }).toEqual(['Evakuierungsbezirk']);
  // Kein Ausfallhinweis für eine gesperrte Quelle.
  await expect(
    page.getByText(/Betreuungsstellen/).filter({ hasText: /nicht geladen|Ausfall/ }),
  ).toHaveCount(0);
});
