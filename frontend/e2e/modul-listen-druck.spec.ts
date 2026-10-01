import { expect, test, type APIResponse, type Page } from '@playwright/test';

/**
 * Druck der Modul-Listen (LFH-727) gegen einen echten Server: Einstieg aus der Liste mit dem
 * aktiven Seitenfilter, Auswahl und Umfang im Druckkopf, das Druckbild nach einem ausgelösten
 * `beforeprint` (nur die Druckwurzel, Tabellenkopf je Seite, kein Protokoll-Hinweis auf Papier).
 * Das Protokoll des Personendrucks prüfen `tests/einsatz_person.rs` (Backend) und
 * `pages/PersonenDruckPage.test.tsx` (genau ein Abruf je Öffnung).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.setTimeout(120_000);

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/** Bis zu drei Versuche bei 503 („bitte erneut versuchen", SQLite-Schreibkonflikt). */
async function mitWiederholung(anfrage: () => Promise<APIResponse>): Promise<APIResponse> {
  let antwort = await anfrage();
  for (let versuch = 1; versuch < 4 && antwort.status() === 503; versuch++) {
    await new Promise((fertig) => setTimeout(fertig, 300 * versuch));
    antwort = await anfrage();
  }
  return antwort;
}

async function saeen(page: Page, pfad: string, daten: Record<string, unknown>) {
  const antwort = await mitWiederholung(() => page.request.post(pfad, { data: daten }));
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
}

function zeilen(page: Page, kennung: string) {
  return page.locator(`[data-lfh="${kennung}"] tbody tr`);
}

test('Druck der Modul-Listen: Einstieg mit Filter, Kopf, Auswahl und Druckbild', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Listen-Druck ${Date.now()}`);
  const basis = `/api/einsaetze/${einsatzId}`;
  // Zwei Betroffene (Sichtung hebt auf „betroffen"), eine vermisste Person.
  await saeen(page, `${basis}/personen`, { name: 'Albers', sichtung: 'sk1' });
  await saeen(page, `${basis}/personen`, { name: 'Brandt', sichtung: 'sk3' });
  await saeen(page, `${basis}/personen`, { name: 'Cordes', status: 'vermisst' });
  await saeen(page, `${basis}/tiere`, { spezies: 'hund', rufname: 'Rex' });
  await saeen(page, `${basis}/tiere`, { spezies: 'katze', rufname: 'Mimi' });
  await saeen(page, `${basis}/schaeden`, { typ: 'sachschaden', ausmass: 'gering', ort: 'Deich' });

  await page.setViewportSize({ width: 1280, height: 900 });
  const drucken = page.getByRole('button', { name: 'Drucken / als PDF' });
  const kopf = page.locator('[data-lfh="druckkopf"]');

  // ── Personen: Einstieg aus der gefilterten Liste.
  await page.goto(`/einsaetze/${einsatzId}/personen?filter=betroffen`);
  await expect(page.getByText('Albers')).toBeVisible();
  await page.getByRole('link', { name: 'Drucken / als PDF' }).click();
  await expect(page).toHaveURL(new RegExp(`/personen/druck\\?filter=betroffen$`));
  await expect(drucken).toBeEnabled({ timeout: 30_000 });
  await expect(kopf).toContainText('Betroffenenliste');
  await expect(kopf).toContainText('Status: Betroffen');
  await expect(kopf).toContainText('2 Personen');
  await expect(zeilen(page, 'personen-druck-tabelle')).toHaveCount(2);
  await expect(zeilen(page, 'personen-druck-tabelle').first()).toContainText('SK I');
  await expect(page.getByText('Zugriffsprotokoll')).toBeVisible();

  // ── Druckbild: `beforeprint` selbst auslösen (emulateMedia feuert es nicht), dann Print-Medium.
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await drucken.click();
  await page.emulateMedia({ media: 'print' });
  const druck = await page.evaluate(() => {
    const anzeige = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : 'fehlt';
    };
    const wurzel = document.querySelector('[data-lfh="druckwurzel"]') as HTMLElement;
    return {
      wurzeln: document.querySelectorAll('[data-lfh="druckwurzel"]').length,
      position: getComputedStyle(wurzel).position,
      kopfleiste: anzeige('.ant-layout-header'),
      seitenkopf: anzeige('[data-lfh="seitenkopf"]'),
      hinweis: anzeige('[data-testid="druck-hinweis"]'),
      tabellenkopf: anzeige('[data-lfh="personen-druck-tabelle"] thead'),
    };
  });
  expect(druck.wurzeln).toBe(1);
  expect(druck.position).toBe('static');
  expect(druck.kopfleiste).toBe('none');
  expect(druck.seitenkopf, 'Bedienung der Druckansicht steht nicht auf dem Papier').toBe('none');
  expect(druck.hinweis, 'der Protokoll-Hinweis gehört an den Bildschirm').toBe('none');
  expect(druck.tabellenkopf, 'Tabellenkopf wiederholt sich je Seite').toBe('table-header-group');
  await page.emulateMedia({ media: null });

  // ── Tiere: die Vorgabe-Sicht „aktiv" reist ausdrücklich mit.
  await page.goto(`/einsaetze/${einsatzId}/tiere`);
  await expect(page.getByText('Rex')).toBeVisible();
  await page.getByRole('link', { name: 'Drucken / als PDF' }).click();
  await expect(page).toHaveURL(new RegExp(`/tiere/druck\\?sicht=aktiv$`));
  await expect(drucken).toBeEnabled({ timeout: 30_000 });
  await expect(kopf).toContainText('Sicht: Aktiv');
  await expect(zeilen(page, 'tiere-druck-tabelle')).toHaveCount(2);

  // ── Schäden: Vorgabe-Sicht „offen".
  await page.goto(`/einsaetze/${einsatzId}/schaeden`);
  await expect(page.getByText('Deich')).toBeVisible();
  await page.getByRole('link', { name: 'Drucken / als PDF' }).click();
  await expect(page).toHaveURL(new RegExp(`/schaeden/druck\\?sicht=offen$`));
  await expect(drucken).toBeEnabled({ timeout: 30_000 });
  await expect(kopf).toContainText('Schadensliste');
  await expect(zeilen(page, 'schaeden-druck-tabelle')).toHaveCount(1);
});
