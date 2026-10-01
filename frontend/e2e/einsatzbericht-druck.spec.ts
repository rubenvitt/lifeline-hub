import { expect, test, type APIResponse, type Page } from '@playwright/test';

/**
 * Einsatzbericht (LFH-726) gegen einen echten Server: Einstieg über die Einsatzdaten, sieben
 * Blöcke in fester Reihenfolge, „In diesem Einsatz nicht genutzt“ für ein ausgeblendetes Modul,
 * kein Name einer betroffenen Person auf dem Blatt, Vorläufig-Vermerk im Kopf und das Druckbild.
 *
 * Gegen den Server, weil die Freigabe-Weiche (`druck/einsatzbericht/quellen.ts`) Modul-Keys auf
 * Server-Gates abbildet: ein falscher Key wäre im Unit-Test grün und hier ein 403 statt des
 * Vermerks. Die Seitenlogik decken `EinsatzberichtDruckPage.test.tsx` und
 * `druck/einsatzbericht/*.test.ts`.
 *
 * Druckbild mit ausgelöstem `beforeprint` (`window.print` als Stub, `druck/AGENTS.md`), nicht nur
 * `emulateMedia`.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const NAME = 'Quastenflosser';
const VORNAME = 'Wendelin';

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

async function sende(page: Page, methode: 'POST' | 'PUT', pfad: string, data?: unknown) {
  const antwort = await mitWiederholung(() =>
    methode === 'POST' ? page.request.post(pfad, { data }) : page.request.put(pfad, { data }),
  );
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return antwort.text().then((t) => (t ? JSON.parse(t) : null));
}

/** UTC 'YYYY-MM-DD HH:mm:ss', eine Stunde zurück (die Zeitachse lehnt Zukunft ab). */
function vorEinerStunde(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

async function saeen(page: Page, einsatzId: string) {
  const basis = `/api/einsaetze/${einsatzId}`;
  const bericht = await sende(page, 'POST', `${basis}/lageberichte`, {
    vorlage: 'lagebericht',
    titel: 'Erstlage Halle 3',
    abschnitte: [{ schluessel: 'eigene_lage', text: 'Zwei Züge im Einsatz.' }],
  });
  await sende(page, 'POST', `${basis}/lageberichte/${bericht.id}/freigeben`);
  await sende(page, 'POST', `${basis}/etb`, {
    typ: 'entscheidung',
    inhalt: 'Bereitstellungsraum Nord einrichten',
  });
  await sende(page, 'POST', `${basis}/personen`, {
    name: NAME,
    vorname: VORNAME,
    status: 'betroffen',
    sichtung: 'sk2',
  });
  const einheit = await sende(page, 'POST', `${basis}/einheiten`, { name: 'Zug Nord' });
  await sende(page, 'POST', `${basis}/einheiten/${einheit.id}/zeitachse`, {
    art: 'alarmierung',
    zeitpunkt_at: vorEinerStunde(),
  });
  await sende(page, 'PUT', `${basis}/modul-overrides/betreuung`, {
    sichtbar: false,
    benoetigte_rolle: null,
  });
}

test('Einsatzbericht: Einstieg, sieben Blöcke, nicht genutztes Modul, kein Personenbezug, Druckbild', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Einsatzbericht ${Date.now()}`);
  await saeen(page, einsatzId);

  // ── Einstieg über die Einsatzdaten.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
  await page.getByRole('link', { name: 'Einsatzbericht drucken' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/einsatzdaten/bericht$`));
  const drucken = page.getByRole('button', { name: 'Drucken / als PDF' });
  await expect(drucken).toBeEnabled({ timeout: 60_000 });

  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  await expect(wurzel).toHaveCount(1);
  await expect(wurzel.getByRole('heading', { level: 3 })).toHaveText([
    'Stammdaten',
    'Zeiten',
    'Führung',
    'Kräfte',
    'Lage',
    'Bilanz',
    'ETB-Auszug',
  ]);

  const kopf = page.locator('[data-lfh="druckkopf"]');
  await expect(kopf).toContainText('Einsatzbericht');
  await expect(kopf).toContainText('Vorläufig – Einsatz läuft');

  // Die Quellen kamen wirklich vom Server (sonst stünde „keine Einträge“).
  await expect(page.locator('[data-lfh="einsatzbericht-block-lage"]')).toContainText(
    'Erstlage Halle 3',
  );
  await expect(page.locator('[data-lfh="einsatzbericht-block-lage"]')).toContainText(
    'Zwei Züge im Einsatz.',
  );
  await expect(page.locator('[data-lfh="einsatzbericht-block-etb"]')).toContainText(
    'Bereitstellungsraum Nord einrichten',
  );
  const kraefte = page.locator('[data-lfh="einsatzbericht-block-kraefte"]');
  await expect(kraefte.locator('dt', { hasText: 'Einheiten' }).last()).toBeVisible();
  const bilanz = page.locator('[data-lfh="einsatzbericht-block-bilanz"]');
  await expect(bilanz).toContainText('SK II');
  await expect(bilanz.getByText('In diesem Einsatz nicht genutzt')).toHaveCount(1);

  // Kein Personenbezug Betroffener auf dem Blatt.
  const text = await wurzel.innerText();
  expect(text).not.toContain(NAME);
  expect(text).not.toContain(VORNAME);

  // ── Druckbild: `window.print` als Stub, der wie der Browser `beforeprint` feuert.
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await drucken.click();
  await page.emulateMedia({ media: 'print' });
  const druck = await page.evaluate(() => {
    const w = document.querySelector('[data-lfh="druckwurzel"]') as HTMLElement;
    const anzeige = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : 'fehlt';
    };
    return {
      position: getComputedStyle(w).position,
      oben: w.getBoundingClientRect().top + window.scrollY,
      rechts: Math.max(
        ...Array.from(w.querySelectorAll('*')).map((el) => el.getBoundingClientRect().right),
      ),
      wurzelRechts: w.getBoundingClientRect().right,
      kopfleiste: anzeige('.ant-layout-header'),
      rail: anzeige('nav[aria-label="Kategorien"]'),
      seitenkopf: anzeige('[data-lfh="seitenkopf"]'),
      tabellenkopf: anzeige('[data-lfh="druckwurzel"] thead'),
    };
  });
  expect(druck.position).toBe('static');
  expect(druck.oben).toBeLessThanOrEqual(1);
  expect(druck.kopfleiste).toBe('none');
  expect(druck.rail).toBe('none');
  expect(druck.seitenkopf, 'Bedienung der Druckansicht steht nicht auf dem Papier').toBe('none');
  expect(druck.tabellenkopf, 'Tabellenkopf wiederholt sich je Seite').toBe('table-header-group');
  expect(druck.rechts, 'nichts ragt rechts aus der Druckwurzel').toBeLessThanOrEqual(
    druck.wurzelRechts + 1,
  );
});
