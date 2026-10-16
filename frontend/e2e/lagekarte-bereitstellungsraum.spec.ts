import { expect, test, type Browser, type Page } from '@playwright/test';

// Bereitstellungsräume auf der Lagekarte (LLH-1107) — Durchstich im echten Renderer: kommt der
// Platziermodus aus der BR-Detailseite an, landet der Raum mit Belegung in der Marker-Quelle,
// bekommt eine zweite Karte ihn ohne Neuladen (Verortung schreibt kein ETB, verteilt aber live),
// trägt ein geplanter Raum seinen gestrichelten Ring, und führt der Inspector zurück zur
// Detailseite? Geprüft wird die Quelle (`querySourceFeatures`), nicht die Pixel.

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
  methode: 'post' | 'patch',
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

async function raumFeature(page: Page, id: number): Promise<Record<string, unknown> | undefined> {
  return (await features(page, 'marker-cluster')).find(
    (p) => p.schluessel === `bereitstellungsraum-${id}`,
  );
}

async function karteBereit(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
}

/** Wartet, bis der Live-Strom der Seite steht (LFH-741, Muster `lagekarte-betreuung.spec.ts`). */
async function liveOffen(page: Page) {
  await expect(page.locator('header [data-lfh="kopf-sync"]')).toHaveAttribute(
    'data-zustand',
    'verbunden',
    { timeout: 30_000 },
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

/** Zweite Sitzung desselben Admins — die „andere Karte" im Führungsraum. */
async function zweiteSitzung(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await anmeldenAls(page, ADMIN, PW);
  return page;
}

async function etbAnzahl(page: Page, basis: string): Promise<number> {
  return ((await (await page.request.get(`${basis}/etb`)).json()) as unknown[]).length;
}

const ORT: [number, number] = [9.356, 52.103];
const RAUM_ORT: [number, number] = [9.362, 52.106];
const NORD_ORT: [number, number] = [9.366, 52.109];

test.use({ viewport: { width: 1366, height: 768 } });

test('Bereitstellungsraum: aus der Detailseite verorten, Marker mit Belegung live, Sprung zurück', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const LAUF = Date.now();
  await anmeldenAls(page, ADMIN, PW);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Bereitstellung ${LAUF}`,
  });
  const basis = `/api/einsaetze/${e}`;
  await senden(page, 'patch', basis, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });
  const { id: br } = await senden(page, 'post', `${basis}/bereitstellungsraeume`, {
    bezeichnung: 'BR Sportplatz',
  });
  await senden(page, 'post', `${basis}/bereitstellungsraeume/${br}/status`, { status: 'aktiv' });
  const { id: einheit } = await senden(page, 'post', `${basis}/einheiten`, { name: 'LF Nord' });
  await senden(page, 'post', `${basis}/bereitstellungsraeume/${br}/belegung`, {
    objekt_typ: 'einheit',
    objekt_id: einheit,
    art: 'eintritt',
  });
  // Ein geplanter Raum, schon beim Anlegen verortet: er trägt den gestrichelten Ring.
  const { id: nord } = await senden(page, 'post', `${basis}/bereitstellungsraeume`, {
    bezeichnung: 'BR Nord',
    lat: NORD_ORT[1],
    lon: NORD_ORT[0],
  });

  // Die zweite Karte steht schon offen, bevor verortet wird.
  const andere = await zweiteSitzung(browser);
  await andere.goto(`/einsaetze/${e}/lagekarte`);
  await karteBereit(andere);
  await liveOffen(andere);
  await springe(andere, RAUM_ORT, 15);
  expect(await raumFeature(andere, br)).toBeUndefined();

  // Einstieg an den Raumdaten der Detailseite.
  await page.goto(`/einsaetze/${e}/bereitstellungsraeume/${br}`);
  const etbVorher = await etbAnzahl(page, basis);
  await page.getByRole('button', { name: 'Auf Karte verorten' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${e}/lagekarte`));
  await karteBereit(page);
  await expect(page.locator('[data-lfh="kartenspalte"]')).toHaveClass(/lfh-karte-setzen/);
  // apply-then-clean: der Auftrag ist aus der Adresse verschwunden.
  await expect(page).not.toHaveURL(/platzieren=/);
  await springe(page, RAUM_ORT, 15);
  await klickeAuf(page, RAUM_ORT);

  await expect.poll(() => raumFeature(page, br), { timeout: 30_000 }).toBeDefined();
  // Beschriftung: Name, Stärke im Raum, Fahrzeuge erst mit Fahrzeugen — hier die Einheit allein.
  expect(String((await raumFeature(page, br))?.beschriftung)).toMatch(
    /^BR Sportplatz · \d+\/\d+\/\d+\/\/\d+$/,
  );
  expect((await raumFeature(page, br))?.icon).toEqual(expect.stringMatching(/^ez\|/));
  // Die andere Karte bekommt den Marker über das Live-Ereignis, ohne Neuladen.
  await expect.poll(() => raumFeature(andere, br), { timeout: 30_000 }).toBeDefined();
  // Kein ETB-Eintrag für die Verortung.
  expect(await etbAnzahl(page, basis)).toBe(etbVorher);

  // Der geplante Raum: Ring und Wort.
  await springe(page, NORD_ORT, 15);
  await expect
    .poll(async () => (await raumFeature(page, nord))?.isGeplant, { timeout: 30_000 })
    .toBe(true);
  expect((await raumFeature(page, nord))?.beschriftung).toBe('BR Nord · geplant');
  await page.screenshot({ path: info.outputPath('raeume-nacht.png') });

  // Auswahl → Inspector und Sprung zur Detailseite.
  await springe(page, RAUM_ORT, 15);
  const ausgewaehlt = page.locator('[data-paneel="ausgewaehlt"]');
  await expect(async () => {
    await klickeAuf(page, RAUM_ORT);
    await expect(ausgewaehlt.getByText('BR Sportplatz')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(ausgewaehlt.getByText('Bereitstellungsraum', { exact: true })).toBeVisible();
  const sprung = ausgewaehlt.getByRole('link', { name: /Im Fachmodul öffnen/ });
  await expect(sprung).toHaveAttribute('href', `/einsaetze/${e}/bereitstellungsraeume/${br}`);
  await sprung.click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${e}/bereitstellungsraeume/${br}$`));
  await expect(page.getByRole('button', { name: 'Auf Karte versetzen' })).toBeVisible();
  await andere.context().close();
});
