import { expect, test, type Browser, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { kontoAnlegen } from './konto-anlegen';

// Verbleib „Notunterkunft" an eine Betreuungsstelle knüpfen — Durchstich gegen das echte
// Backend. Die Einzelheiten prüfen Vitest und `tests/verbleib_betreuungsstelle.rs`; hier geht
// es um das Zusammenspiel: Paneel „Verbleib erfassen" im Patientenkopf (LLH-1094, kein Dialog)
// → POST → Personenseite, und eine ZWEITE geöffnete
// Betreuungsseite, die „davon namentlich 1" ohne Neuladen bekommt (Live-Fan-out
// `person → betreuung`). Dazu der Gegenfall ohne Modul Betreuung.

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

/** Das Paneel „Verbleib erfassen", das der Knopf im Patientenkopf aufklappt. */
function verbleibPaneel(page: Page) {
  return page.getByRole('region', { name: 'Verbleib erfassen' });
}

/** Klappt das Paneel über den Knopf am Aufenthalt bzw. Verbleib des Patientenkopfs auf. */
async function verbleibPaneelOeffnen(page: Page) {
  const kopf = page.getByRole('region', { name: 'Patientenkopf' });
  await kopf.getByRole('button', { name: 'Verbleib erfassen', expanded: false }).click();
  await expect(verbleibPaneel(page)).toBeVisible();
  // Kein Dialog mehr: das Paneel steht in der Ansicht.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return verbleibPaneel(page);
}

/** Wählt in einem antd-Select des Paneels einen Eintrag (der echte Optionsknoten, nicht der a11y-Spiegel). */
async function waehle(page: Page, feld: string, eintrag: string) {
  await waehleIn(verbleibPaneel(page).getByRole('combobox', { name: feld }), eintrag);
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
  // Gesichtet → der Patientenkopf bietet „Verbleib erfassen" an.
  await senden(page, 'post', `${basis}/personen/${p}/sichtung`, { kategorie: 'sk3' });

  // Zweite Sitzung auf der Betreuungsseite — vorher ohne namentliche Zahl.
  const zweite = await zweiteSitzung(browser, ADMIN, PW);
  await zweite.goto(`/einsaetze/${e}/betreuung`);
  const zeile = zweite.locator('tr', { hasText: 'NU Turnhalle Nord' });
  await expect(zeile).toContainText('40');
  await expect(zeile).not.toContainText('namentlich');

  await page.goto(`/einsaetze/${e}/personen/${p}`);
  const paneel = await verbleibPaneelOeffnen(page);
  await waehle(page, 'Art', 'Notunterkunft');
  await waehle(page, 'Betreuungsstelle (optional)', 'NU Turnhalle Nord');
  await expect(paneel.getByLabel('Ziel')).toHaveValue('NU Turnhalle Nord');
  await page.screenshot({ path: info.outputPath('dialog-stelle-gewaehlt.png') });

  await paneel.getByRole('button', { name: 'Verbleib erfassen' }).click();
  // Nach dem Erfolg klappt das Paneel zu; der Kopf zeigt den Verbleib.
  await expect(paneel).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Patientenkopf' }).locator('[data-lfh="aufenthalt"]'),
  ).toContainText('Notunterkunft → NU Turnhalle Nord');

  // Die zweite Seite bekommt die Zahl über das Personen-Ereignis, ohne Neuladen.
  await expect(zeile).toContainText('davon namentlich 1', { timeout: 30_000 });
  // Die Belegung selbst bleibt die Mengenmeldung: „In Betreuung“ im Band zählt 40 (LLH-1050).
  await expect(
    zweite
      .getByRole('group', { name: 'Unterbringung in Zahlen' })
      .locator('[data-lfh="kennzahl"]')
      .filter({ hasText: 'In Betreuung' }),
  ).toContainText('40');
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
  const { id: bid } = await kontoAnlegen(page.request, {
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
  const paneel = await verbleibPaneelOeffnen(seite);
  await waehle(seite, 'Art', 'Notunterkunft');
  await expect(paneel.getByLabel('Ziel')).toBeVisible();
  await expect(paneel.getByRole('combobox', { name: 'Betreuungsstelle (optional)' })).toHaveCount(
    0,
  );
  await seite.screenshot({ path: info.outputPath('dialog-ohne-betreuung.png') });
});
