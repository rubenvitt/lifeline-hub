import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/*
 * LFH-387 — Sitzung über mehrere Tabs.
 *
 * Zwei Seiten im SELBEN Browserkontext sind zwei Tabs eines Browsers: sie teilen das
 * Session-Cookie und den BroadcastChannel. Genau das ist die Lage, in der ein alter Tab noch
 * Benutzer A zeigt, während die originweite Sitzung schon B gehört.
 *
 * Drei Fälle nach design.md D9:
 *   (a) schneller Wechsel A→B in Tab 2 (ohne vorheriges Abmelden) → Tab 1 zeigt ohne Neuladen
 *       den Konfliktdialog; B bleibt angemeldet; „Als B weiterarbeiten“ übernimmt.
 *   (b) gleichzeitige Mutation: B meldet sich an der App vorbei an (kein App-Code, also keine
 *       Kanalmeldung), Tab 1 sendet trotzdem → der Server lehnt mit 412 ab, der Eintrag
 *       entsteht nicht, Tab 1 zeigt den Konflikt, B bleibt angemeldet.
 *   (c) Sitzungsablauf: die Sitzung endet an der App vorbei, Tab 1 schreibt → Anmeldung mit
 *       Rückkehrziel; Tab 2 folgt ohne Neuladen.
 */

const ADMIN = 'admin';
const ADMIN_PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const B_PW = 'e2e-tabs-pw-123';

async function anmelden(page: Page, benutzername: string, passwort: string) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(benutzername);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Legt (als angemeldeter Admin des Kontexts) einen zweiten Benutzer an. */
async function zweitenBenutzerAnlegen(
  ctx: BrowserContext,
): Promise<{ name: string; anzeige: string }> {
  const lauf = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const name = `e2e-tabs-${lauf}`;
  const anzeige = `Tab Zwei ${lauf}`;
  const antwort = await ctx.request.post('/api/benutzer', {
    data: { anzeigename: anzeige, benutzername: name, passwort: B_PW },
  });
  expect(
    antwort.ok(),
    `Benutzer anlegen: ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
  return { name, anzeige };
}

async function einsatzAnlegen(ctx: BrowserContext): Promise<number> {
  const antwort = await ctx.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Tabs ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz anlegen: ${antwort.status()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

async function aktuellerBenutzer(ctx: BrowserContext): Promise<string | null> {
  const antwort = await ctx.request.get('/api/auth/me');
  if (antwort.status() === 401) return null;
  return ((await antwort.json()) as { benutzername: string }).benutzername;
}

const konfliktDialog = (page: Page) =>
  page.getByRole('dialog').filter({ hasText: 'Anderer Benutzer angemeldet' });

test('(a) schneller Wechsel A→B in Tab 2: Tab 1 zeigt den Konflikt ohne Neuladen', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const tab1 = await ctx.newPage();
  const tab2 = await ctx.newPage();

  await anmelden(tab1, ADMIN, ADMIN_PW);
  const b = await zweitenBenutzerAnlegen(ctx);
  const einsatzId = await einsatzAnlegen(ctx);
  await tab1.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(tab1.getByPlaceholder('Inhalt …')).toBeVisible();

  // Tab 2 wechselt, ohne sich vorher abzumelden: Anmeldeseite öffnen, als B anmelden.
  await anmelden(tab2, b.name, B_PW);

  const dialog = konfliktDialog(tab1);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(b.anzeige);
  expect(await aktuellerBenutzer(ctx)).toBe(b.name);

  // Weiterarbeiten als B: der Dialog geht, Tab 1 steht auf der Startseite — und B bleibt
  // angemeldet (Tab 1 hat nichts abgemeldet).
  await dialog.getByRole('button', { name: `Als ${b.anzeige} weiterarbeiten` }).click();
  await expect(tab1).toHaveURL(/\/einsaetze$/);
  await expect(konfliktDialog(tab1)).toHaveCount(0);
  expect(await aktuellerBenutzer(ctx)).toBe(b.name);

  await ctx.close();
});

test('(b) gleichzeitige Mutation aus dem veralteten Tab: 412, kein Eintrag, B bleibt angemeldet', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const tab1 = await ctx.newPage();

  await anmelden(tab1, ADMIN, ADMIN_PW);
  const b = await zweitenBenutzerAnlegen(ctx);
  const einsatzId = await einsatzAnlegen(ctx);
  await tab1.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(tab1.getByPlaceholder('Inhalt …')).toBeVisible();

  // B meldet sich an der App vorbei an: das Cookie des Kontexts gehört jetzt B, aber kein
  // App-Code lief — Tab 1 hat keine Meldung bekommen und zeigt weiter den Admin.
  const login = await ctx.request.post('/api/auth/login', {
    data: { benutzername: b.name, passwort: B_PW },
  });
  expect(login.ok()).toBeTruthy();
  await expect(konfliktDialog(tab1)).toHaveCount(0);

  const inhalt = `Aus dem alten Tab ${Date.now()}`;
  const antwort = tab1.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/api/einsaetze/${einsatzId}/etb`),
  );
  await tab1.getByPlaceholder('Inhalt …').fill(inhalt);
  await tab1.getByRole('button', { name: 'Erfassen', exact: true }).click();
  expect((await antwort).status()).toBe(412);

  await expect(konfliktDialog(tab1)).toBeVisible();
  expect(await aktuellerBenutzer(ctx)).toBe(b.name);

  // Kein Eintrag unter dem Admin: nachgesehen in einem EIGENEN Kontext, damit das Cookie des
  // Tab-Kontexts (B) unberührt bleibt.
  const pruefer = await browser.newContext();
  const pl = await pruefer.request.post('/api/auth/login', {
    data: { benutzername: ADMIN, passwort: ADMIN_PW },
  });
  expect(pl.ok()).toBeTruthy();
  const etb = (await (await pruefer.request.get(`/api/einsaetze/${einsatzId}/etb`)).json()) as {
    inhalt: string;
  }[];
  expect(etb.map((e) => e.inhalt)).not.toContain(inhalt);

  await pruefer.close();
  await ctx.close();
});

test('(c) Sitzungsablauf: Tab 1 führt zur Anmeldung mit Rückkehrziel, Tab 2 folgt', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const tab1 = await ctx.newPage();
  const tab2 = await ctx.newPage();

  await anmelden(tab1, ADMIN, ADMIN_PW);
  // Tab 2 auf einer Seite ohne Live-Strom und ohne eigene Abfragen im Hintergrund: seine
  // Umleitung soll an der Meldung aus Tab 1 hängen, nicht an einer eigenen 401.
  await tab2.goto('/profil');
  await expect(tab2).toHaveURL(/\/profil$/);
  await tab1.goto('/einsaetze');
  await expect(tab1.getByRole('button', { name: 'Neuer Einsatz' })).toBeVisible();

  // Die Sitzung endet an der App vorbei (wie ein serverseitiger Ablauf).
  const aus = await ctx.request.post('/api/auth/logout');
  expect(aus.status()).toBe(204);
  // Gegenprobe: ohne Anstoß aus Tab 1 bleibt Tab 2, wo es ist.
  await tab2.waitForTimeout(500);
  await expect(tab2).toHaveURL(/\/profil$/);

  // Tab 1 schreibt → 401 → Anmeldung mit Rückkehrziel.
  await tab1.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await tab1.getByLabel('Bezeichnung').fill('nach Ablauf');
  await tab1.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(tab1).toHaveURL(/\/login$/);

  // Tab 2 folgt über die Kanalmeldung ohne Neuladen.
  await expect(tab2).toHaveURL(/\/login$/);

  // Mit dem Rückkehrziel: nach erneuter Anmeldung steht Tab 1 wieder auf der Einsatzliste.
  await tab1.getByLabel('Benutzername').fill(ADMIN);
  await tab1.getByLabel('Passwort').fill(ADMIN_PW);
  await tab1.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(tab1).toHaveURL(/\/einsaetze$/);

  await ctx.close();
});
