import { expect, test, type Page } from '@playwright/test';

// Spaltenschalter der Kartenverwaltungen am Handschirm (LFH-374, Kriterium 14).
//
// Warum hier und nicht nur in Vitest: jsdom rechnet kein Layout. Die Unit-Tests pinnen
// Zähler und Menü; dieser Spec misst, was nur ein Browser weiß — die Tabelle bleibt bei
// 390 px eine Tabelle (keine Auflösung in Karten), die Werkzeugzeile mit Suche UND Schalter
// drückt nichts breit, und der Schalter lässt sich mit einem echten Klick bedienen
// (`toBeVisible()` ist kein Beleg für Klickbarkeit, CLAUDE.md/LFH-355).
//
// Gemessen werden das DOM des Primitivs (`.ant-table`, `[data-lfh="katalog-werkzeuge"]`) UND
// die Seite als Ganzes (`documentElement.scrollWidth`): `gate1-ueberlauf.spec.ts` führt diese
// zwei Routen nicht, die seitenweite Aussage stünde sonst nirgends.

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

/** Das OFFENE Spaltenmenü — antd lässt geschlossene Portale im Baum stehen. */
function offenesMenue(page: Page) {
  return page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
}

async function breitenPruefen(page: Page) {
  for (const selektor of ['.ant-table', '[data-lfh="katalog-werkzeuge"]']) {
    const breite = await page
      .locator(selektor)
      .first()
      .evaluate((el) => el.scrollWidth);
    expect(breite, `${selektor} drückt die Seite breit (${breite} px)`).toBeLessThanOrEqual(BREITE);
  }
  const seite = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(seite, `die Seite scrollt waagerecht (${seite} px)`).toBeLessThanOrEqual(BREITE);
  // Fixiert steht die menschenlesbare Kennung, nie eine andere Spalte.
  await expect(page.locator('th.ant-table-cell-fix-start')).toHaveText(['Name']);
}

test('Online-Quellen bei 390 px: Tabelle, Zähler für URL und Attribution, einblendbar', async ({
  page,
}) => {
  await anmelden(page);
  // Eine Zeile legt der Spec selbst an — ohne Zeile wäre „bleibt eine Tabelle" nur ein Kopf.
  // INAKTIV und am Ende wieder gelöscht: Online-Quellen gelten instanzweit, und das e2e-Backend
  // teilen alle Specs eines Shards. Eine aktive Quelle mit unerreichbarer URL blieb stehen und
  // brach jede spätere Lagekarte im Shard (Marker kamen nie in der Quelle an; in der CI von
  // PR #158 und auf alpha 7e427fef gemessen, lokal mit/ohne diesen Spec belegt, LFH-741).
  const antwort = await page.request.post('/api/karte/online-quellen', {
    data: {
      name: `E2E Spalten ${Date.now()}`,
      url: `https://e2e.example/${Date.now()}/{z}/{x}/{y}.png`,
      typ: 'raster',
      attribution: '© E2E',
      sortier: 99,
      aktiv: false,
      proxy: false,
    },
  });
  expect(antwort.ok(), `Seeding: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  const { id: quelleId } = (await antwort.json()) as { id: number };
  try {
    await page.goto('/admin/karten/online');
    await expect(page.locator('tr.ant-table-row').first()).toBeVisible();
    await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);

    const schalter = page.getByRole('button', {
      name: 'Spalten · 2 ausgeblendet — Online-Quellen',
    });
    await expect(schalter).toBeVisible();
    await breitenPruefen(page);

    const kopf = page.locator('.ant-table-thead th');
    await expect(kopf.filter({ hasText: 'Attribution' })).toHaveCount(0);

    await schalter.click();
    await offenesMenue(page).getByRole('menuitem', { name: 'Attribution' }).click();
    await expect(kopf.filter({ hasText: 'Attribution' })).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Spalten · 1 ausgeblendet — Online-Quellen' }),
    ).toBeVisible();
  } finally {
    await page.request.delete(`/api/karte/online-quellen/${quelleId}`);
  }
});

test('Offline-Karten bei 390 px: Tabelle mit Schalter, Attribution gezählt', async ({ page }) => {
  await anmelden(page);
  await page.goto('/admin/karten/offline');
  // Die Offline-Liste ist im Harness leer — der Kopf ist trotzdem der einer Tabelle, und der
  // Zähler hängt an den Spalten, nicht an den Zeilen.
  await expect(page.locator('.ant-table-thead th').first()).toBeVisible();
  await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);

  const schalter = page.getByRole('button', { name: 'Spalten · 1 ausgeblendet — Offline-Karten' });
  await expect(schalter).toBeVisible();
  await breitenPruefen(page);

  await schalter.click();
  await expect(offenesMenue(page).getByRole('menuitem', { name: 'Größe' })).toBeVisible();
});
