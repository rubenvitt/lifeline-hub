import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';
import { benutzermenueAusloeser } from './menue-kern';
import { navigateInApp } from './navigation-kern';

/**
 * Orientierung (LFH-954, Spec `seiten-orientierung`): Tab-Titel, Ortspfad, Einsatzstatus und
 * Rückweg. Die Module kommen aus dem Quelltext der Registry — ein Import zöge die Icons samt CSS
 * in den Testlauf, eine abgeschriebene Liste liefe still auseinander.
 */
const hier = dirname(fileURLToPath(import.meta.url));

function registryModule(): { route: string; label: string }[] {
  const quelle = readFileSync(join(hier, '../src/einsatz/modulRegistry.ts'), 'utf-8');
  const anfang = quelle.indexOf('export const modulRegistry');
  const liste = quelle.slice(anfang, quelle.indexOf('\n];', anfang));
  const module = [...liste.matchAll(/label: '([^']+)',[\s\S]*?route: '([^']+)'/g)].map((m) => ({
    label: m[1],
    route: m[2],
  }));
  // Vorbedingung: sonst wäre die Schleife unten grün durch Nichtstun.
  expect(module.length, 'Module aus der Registry gelesen').toBeGreaterThan(25);
  return module;
}

/**
 * Direkteinstieg: UHS und Bereitstellungsräume öffnen ohne Eintrag einen Leerzustand ohne
 * Seitenkopf, mit Eintrag dessen Detailseite. Ihr Name steht dort im Tab, nicht im h1.
 */
const DIREKTEINSTIEG = new Set(['unfallhilfsstellen', 'bereitstellungsraeume']);

async function einsatzAnlegen(page: Page, bezeichnung: string): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(antwort.ok(), `Einsatz: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return String(((await antwort.json()) as { id: number }).id);
}

test.describe('Orientierung (LFH-954)', () => {
  test('jedes Modul nennt sich im h1 und mit dem Einsatz im Tab, kein h1 trägt den Einsatzstatus', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await anmeldenAlsAdmin(page);
    const name = `Orientierung ${Date.now()}`;
    const id = await einsatzAnlegen(page, name);
    // Nur das erste Modul lädt die App, danach wechselt der Fall im Router wie das Menü
    // (LLH-1914): 34 volle Ladungen des unbündelten Dev-Servers (je rund 600 Module) endeten
    // unter Last zeitweise in einer leeren Seite, deren Titel „lifeline-hub“ aus `index.html`
    // blieb. So prüft der Fall auch, dass der Titel beim Modulwechsel nachzieht.
    let ersteLadung = true;
    for (const { route, label } of registryModule()) {
      const pfad = `/einsaetze/${id}/${route}`;
      if (ersteLadung) await page.goto(pfad);
      else await navigateInApp(page, pfad);
      ersteLadung = false;
      await expect(page, route).toHaveTitle(`${label} · ${name} · lifeline-hub`);
      // Ein Name je Modul: das h1 ist der Menüname (LFH-965, Spec `modul-benennung`).
      if (!DIREKTEINSTIEG.has(route)) {
        await expect.soft(page.locator('h1').first(), `${route}: h1 = Menüname`).toHaveText(label);
      }
      for (const h1 of await page.locator('h1').allTextContents()) {
        expect.soft(h1, `${route}: h1 ohne Einsatzstatus`).not.toMatch(/Aktiv/);
      }
    }
    await page.goto('/einsaetze');
    await expect(page).toHaveTitle('Einsätze · lifeline-hub');
  });

  test('Einsatzdaten heißt so, der Pfad nennt den Einsatz', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const name = `Einsatzdaten-Pfad ${Date.now()}`;
    const id = await einsatzAnlegen(page, name);
    await page.goto(`/einsaetze/${id}/einsatzdaten`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Einsatzdaten');
    await expect(page.locator('.lfh-seitenkopf__pfad')).toContainText(name);
    await page.goto(`/einsaetze/${id}/einstellungen`);
    await expect(page.locator('.lfh-seitenkopf__pfad')).toContainText(name);
    // Das ETB nennt den Einsatz nicht: sonst bräche sein Kopf bei 1440 px um (Spec, Ortspfad).
    await page.goto(`/einsaetze/${id}/etb`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ETB');
    await expect(page.locator('.lfh-seitenkopf__pfad')).not.toContainText(name);
  });

  test('abgeschlossener Einsatz: „Einsatzstatus“ neben dem Titel, nicht im h1', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page, `Abgeschlossen ${Date.now()}`);
    const zu = await page.request.post(`/api/einsaetze/${id}/abschliessen`);
    expect(zu.ok(), `Abschließen: ${zu.status()}`).toBe(true);
    for (const route of ['tiere', 'etb', 'lagekarte']) {
      await page.goto(`/einsaetze/${id}/${route}`);
      const marke = page.getByTestId('einsatzstatus');
      await expect(marke, route).toContainText('Einsatzstatus');
      await expect(marke, route).toContainText('Abgeschlossen');
      await expect(page.getByRole('heading', { level: 1 }), route).not.toContainText(
        'Abgeschlossen',
      );
    }
  });

  /**
   * Im Einsatz unter `md` kein Ortspfad, nur der Rückweg zum nächsten verlinkten Eintrag
   * (LLH-1728, D6, Spec `seiten-orientierung`): den Einsatz nennt der klebende Kopf. Per CSS
   * (`:has()`), deshalb im Browser.
   */
  test('390 px im Einsatz: kein Ortspfad, der Einsatzname steht im Kopf', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await anmeldenAlsAdmin(page);
    const name = `ÜBUNG Starkregen Musterstadt Abschnitt Nordwest ${Date.now()}`;
    const id = await einsatzAnlegen(page, name);
    await page.goto(`/einsaetze/${id}/einsatzdaten`);
    await expect(page.getByRole('heading', { level: 1, name: 'Einsatzdaten' })).toBeVisible();
    // Vorbedingung: der Pfad steht im DOM und nennt den Einsatz, er ist nur ausgeblendet.
    await expect(page.locator('.lfh-seitenkopf__pfad')).toHaveCount(1);
    await expect(page.locator('.lfh-seitenkopf__pfad')).toBeHidden();
    await expect(page.locator('[data-lfh="kopf-einsatzname"]')).toContainText('ÜBUNG Starkregen');

    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(page.locator('.lfh-seitenkopf__pfad')).toBeVisible();
    await expect(page.locator('.lfh-seitenkopf__pfad')).toContainText('Einsätze');
  });

  test('390 px auf einer Detailseite: nur „‹ Betroffene“, und er führt zur Liste', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page, `Rückweg Detail ${Date.now()}`);
    const antwort = await page.request.post(`/api/einsaetze/${id}/persons`, {
      data: { name: 'Rückweg', vorname: 'Rita', antreff_ort: 'Brücke' },
    });
    expect(antwort.ok(), `Person: ${antwort.status()}`).toBe(true);
    const personId = ((await antwort.json()) as { id: number }).id;
    await page.goto(`/einsaetze/${id}/personen/${personId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const pfad = page.locator('.lfh-seitenkopf__pfad');
    await expect(pfad).toBeVisible();
    // Genau ein sichtbarer Eintrag, der Link zur Liste; „Einsätze“ und der Einsatz stehen nicht.
    const sichtbar = pfad.locator('li:visible');
    await expect(sichtbar).toHaveCount(1);
    const rueckweg = sichtbar.getByRole('link');
    await expect(rueckweg).toHaveText('Betroffene');
    const zeichen = await rueckweg.evaluate((a) => getComputedStyle(a, '::before').content);
    expect(zeichen, '„‹“ vor dem Rückweg').toContain('‹');
    // Das Zeichen steht nicht im zugänglichen Namen (CSS-Ersatztext leer).
    await expect(sichtbar.getByRole('link', { name: 'Betroffene', exact: true })).toBeVisible();
    await rueckweg.click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/personen(\\?.*)?$`));
  });

  test('Beobachter: aus dem Profil zurück an dieselbe Stelle im Einsatz', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const name = `Rückweg ${Date.now()}`;
    const id = await einsatzAnlegen(page, name);
    await wechsleZuRolle(page, 'beobachter', id);
    await page.goto(`/einsaetze/${id}/etb`);
    await expect(page).toHaveTitle(`ETB · ${name} · lifeline-hub`);
    await (await benutzermenueAusloeser(page)).click();
    await page.getByRole('menuitem', { name: 'Profil' }).click();
    await expect(page).toHaveURL(/\/profil$/);
    await expect(page).toHaveTitle('Profil · lifeline-hub');
    await expect(
      page.locator('.lfh-seitenkopf__pfad').getByRole('link', { name: 'Einsätze', exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: `Zurück zu ${name}` }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/etb$`));
  });

  test('Anmeldung trägt ihren eigenen Tab-Titel', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle('Anmelden · lifeline-hub');
  });

  test('Verwaltung: Tab-Titel der Sektion, „Verwaltung“ als aktueller Ort', async ({ page }) => {
    await anmeldenAlsAdmin(page, { startseite: false });
    await page.goto('/admin/stammdaten/fahrzeuge');
    await expect(page).toHaveTitle('Fahrzeuge · Verwaltung · lifeline-hub');
    await expect(page.getByRole('link', { name: 'Verwaltung', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('Wechsler: eigener Einsatz markiert, Klick bleibt im Modul, keine Stammdaten', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const name = `Wechsler ${Date.now()}`;
    const id = await einsatzAnlegen(page, name);
    await page.goto(`/einsaetze/${id}/etb`);
    await page.locator('header').getByRole('button', { name, exact: true }).click();
    const menue = page.getByRole('menu');
    const eigen = menue.getByRole('menuitem', { name });
    await expect(eigen).toHaveClass(/-menu-item-selected/);
    await expect(menue.getByRole('menuitem', { name: 'Stammdaten' })).toHaveCount(0);
    await eigen.click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/etb$`));
  });
});
