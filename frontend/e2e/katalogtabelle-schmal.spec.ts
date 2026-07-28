import { expect, test, type Page } from '@playwright/test';

// Browser-Smoke des Katalogtabellen-Primitivs am schmalen Schirm (LFH-329 · B1).
//
// Warum hier und nicht in Vitest: jsdom rechnet KEIN Layout — dort sind alle Breiten 0,
// eine wirkungslose Fixierung oder ein überragender Container fielen nie auf. Die
// Unit-Tests pinnen die DOM-Struktur, dieser Spec die einzige Aussage, die zählt:
// die Tabelle scrollt in sich, drückt die Seite nicht breit, und die Kopfzeile steht.
//
// Bewusst NICHT gemessen wird der Seitencontainer (`components/AdminPage.tsx`) oder der
// Seitenkörper: beide tragen Kopfleiste und Seitenrinne mit, die andere Arbeitspakete
// dieses Bandes gerade umbauen — der Spec wäre dann fremdverschuldet rot. Gemessen wird
// ausschliesslich DOM, das dieses Paket selbst erzeugt.

const BREITE = 390;
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.use({ viewport: { width: BREITE, height: 844 } });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

test('Katalogtabelle bei 390 px: scrollt in sich, drückt die Seite nicht breit, Kopfzeile bleibt stehen', async ({
  page,
}) => {
  await anmelden(page);
  // Benutzerliste: sechs Spalten und ohne jede Vorarbeit mindestens eine Datenzeile
  // (der vom Harness angelegte Admin). Ein Anlegen-Dialog auf 390 px wäre zusätzliche
  // Fehlerquelle ohne Erkenntnisgewinn.
  await page.goto('/admin/benutzer');
  const zeile = page.locator('tr.ant-table-row').first();
  await expect(zeile).toBeVisible();

  const koerper = page.locator('.ant-table-body');
  const rahmen = page.locator('.ant-table').first();

  // (a) Die Tabelle ist breiter als der Schirm UND scrollt in sich. Beide Hälften sind
  //     nötig: ohne den Überhang wäre (b) trivial erfüllt und bewiese nichts.
  const masse = await koerper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(masse.scrollWidth).toBeGreaterThan(masse.clientWidth);

  // (b) …und der Tabellenrahmen bleibt trotzdem im Schirm. Das ist die eigentliche
  //     Zusicherung: der Überhang lebt im Scrollcontainer, nicht in der Seitenbreite.
  const rahmenBreite = await rahmen.evaluate((el) => el.clientWidth);
  expect(rahmenBreite).toBeLessThanOrEqual(BREITE);

  // (c) Die erste Spalte ist die fixierte, menschenlesbare Kennung — genau eine.
  const fixierte = page.locator('th.ant-table-cell-fix-start');
  await expect(fixierte).toHaveCount(1);
  await expect(fixierte).toHaveCSS('position', 'sticky');

  // (d) Die Kopfzeile steht wirklich fest.
  const kopf = page.locator('.ant-table-sticky-holder');
  await expect(kopf).toHaveCSS('position', 'sticky');

  // Erst die Vorbedingung pinnen, dann die Wirkung: scrollt die Seite gar nicht, wäre
  // die folgende Behauptung leer und dieser Spec eine Attrappe. Gemessen scrollt sie
  // (390 × 844, Benutzerliste des Harness). Fällt diese Zeile künftig, ist die Aussage
  // darunter neu zu begründen — nicht stillschweigend zu überspringen.
  await page.evaluate(() => window.scrollTo(0, 400));
  const gescrollt = await page.evaluate(() => window.scrollY);
  expect(gescrollt, 'Seite muss senkrecht scrollen, sonst prüft (d) nichts').toBeGreaterThan(0);

  const kasten = await kopf.boundingBox();
  expect(kasten).not.toBeNull();
  expect(kasten!.y).toBeGreaterThanOrEqual(0);
  await expect(fixierte).toBeVisible();
});
