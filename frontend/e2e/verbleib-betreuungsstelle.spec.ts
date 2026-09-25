import { expect, test, type Browser, type Page } from '@playwright/test';

// LFH-674: Verbleib „Notunterkunft" an eine Betreuungsstelle knüpfen — Durchstich im echten
// Browser gegen das echte Backend.
//
// Die Einzelheiten prüfen Vitest (Dialog, Kern, Stellenzelle) und `tests/verbleib_
// betreuungsstelle.rs` (Prüfkette, Rechte, Zählung). Hier geht es um das Zusammenspiel, das
// nur der ganze Stack zeigt: Dialog → POST → Personenseite, und eine ZWEITE geöffnete
// Betreuungsseite, die „davon namentlich 1" ohne Neuladen bekommt (Live-Fan-out
// `person → betreuung`). Dazu der Gegenfall ohne Modul Betreuung. Die Bilder unter
// `test-results/` sind Sichtbelege für die Prüfliste.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

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

/** Wählt in einem antd-Select des Dialogs einen Eintrag (der echte Optionsknoten, nicht der a11y-Spiegel). */
async function waehle(page: Page, feld: string, eintrag: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: feld }).click();
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByTitle(eintrag)
    .click();
}

async function zweiteSitzung(browser: Browser, benutzer: string, pw: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await anmeldenAls(page, benutzer, pw);
  return page;
}

test.use({ viewport: { width: 1366, height: 768 } });

test('Notunterkunft mit Stelle: Ziel vorbelegt, Personenseite zeigt es, zweite Betreuungsseite zählt live', async ({
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
  const { id: sid } = await senden(page, 'post', `${basis}/betreuung/stellen`, {
    bezeichnung: 'NU Turnhalle Nord',
    art: 'notunterkunft',
    kapazitaet_personen: 150,
  });
  await senden(page, 'patch', `${basis}/betreuung/stellen/${sid}`, { status: 'in_betrieb' });
  await senden(page, 'post', `${basis}/betreuung/stellen/${sid}/belegungen`, { belegt: 40 });
  const { id: p } = await senden(page, 'post', `${basis}/personen`, {});
  // Gesichtet → die Primäraktion der Seite ist „Verbleib erfassen".
  await senden(page, 'post', `${basis}/personen/${p}/sichtung`, { kategorie: 'sk3' });

  // Zweite Sitzung auf der Betreuungsseite — vorher ohne namentliche Zahl.
  const zweite = await zweiteSitzung(browser, ADMIN, PW);
  await zweite.goto(`/einsaetze/${e}/betreuung`);
  const zeile = zweite.locator('tr', { hasText: 'NU Turnhalle Nord' });
  await expect(zeile).toContainText('40');
  await expect(zeile).not.toContainText('namentlich');

  await page.goto(`/einsaetze/${e}/personen/${p}`);
  await page.getByRole('button', { name: 'Verbleib erfassen' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await waehle(page, 'Art', 'Notunterkunft');
  await waehle(page, 'Betreuungsstelle (optional)', 'NU Turnhalle Nord');
  await expect(dialog.getByLabel('Ziel')).toHaveValue('NU Turnhalle Nord');
  await page.screenshot({ path: info.outputPath('dialog-stelle-gewaehlt.png') });

  await dialog.getByRole('button', { name: 'Erfassen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Notunterkunft → NU Turnhalle Nord').first()).toBeVisible();

  // Die zweite Seite bekommt die Zahl über das Personen-Ereignis, ohne Neuladen.
  await expect(zeile).toContainText('davon namentlich 1', { timeout: 30_000 });
  await expect(zweite.getByText('40 untergebracht')).toBeVisible();
  await zweite.screenshot({ path: info.outputPath('betreuung-davon-namentlich.png') });
});

test('ohne Modul Betreuung: keine Stellenauswahl, Freitext-Ziel bleibt', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const LAUF = Date.now();
  await anmeldenAls(page, ADMIN, PW);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Deichlage ${LAUF}`,
  });
  const basis = `/api/einsaetze/${e}`;
  await senden(page, 'post', `${basis}/betreuung/stellen`, {
    bezeichnung: 'NU Halle Ost',
    art: 'notunterkunft',
  });
  const { id: p } = await senden(page, 'post', `${basis}/personen`, {});
  await senden(page, 'post', `${basis}/personen/${p}/sichtung`, { kategorie: 'sk3' });
  const name = `fk${LAUF}`;
  const { id: bid } = await senden(page, 'post', '/api/benutzer', {
    anzeigename: name,
    benutzername: name,
    passwort: `${name}pw1`,
    org_rolle: 'keine',
  });
  await senden(page, 'put', `${basis}/mitglieder/${bid}`, { einsatz_rolle: 'fuehrungspersonal' });
  await senden(page, 'put', `${basis}/modul-overrides/betreuung`, {
    sichtbar: false,
    benoetigte_rolle: null,
  });

  const seite = await zweiteSitzung(browser, name, `${name}pw1`);
  await seite.goto(`/einsaetze/${e}/personen/${p}`);
  await seite.getByRole('button', { name: 'Verbleib erfassen' }).first().click();
  await waehle(seite, 'Art', 'Notunterkunft');
  const dialog = seite.getByRole('dialog');
  await expect(dialog.getByLabel('Ziel')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Betreuungsstelle (optional)' })).toHaveCount(
    0,
  );
  await seite.screenshot({ path: info.outputPath('dialog-ohne-betreuung.png') });
});
