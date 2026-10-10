import { request, type Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Geräte koppeln“ (`docs/anwender/kapitel/geraete-koppeln.md`): die
 * Geräteverwaltung der Einsatzleitung in den Einstellungen des Einsatzes, Fükw.
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep geraete-koppeln`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   geraeteliste.png    frontend/src/pages/einstellungen/EinsatzGeraete.tsx,
 *                       frontend/src/pages/einstellungen/geraeteKern.ts
 *   kopplungscode.png   frontend/src/pages/einstellungen/EinsatzGeraete.tsx (Dialog „Code für …“)
 *   aktionen.png        frontend/src/pages/einstellungen/EinsatzGeraete.tsx (Aktionsmenü)
 *   verlaengern.png     frontend/src/pages/einstellungen/EinsatzGeraete.tsx (Dialog „Verlängern“)
 */

const KAPITEL = 'geraete-koppeln';

interface Kopplung {
  kopplung: { id: number; anzeigename: string };
  code: { code: string };
}

/** Kennung der ersten Stelle einer Liste des Demo-Einsatzes. */
async function ersteId(page: Page, pfad: string): Promise<number> {
  const antwort = await page.request.get(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
  const liste = (await antwort.json()) as { id: number }[];
  expect(liste.length, `${pfad} ist leer`).toBeGreaterThan(0);
  return liste[0].id;
}

/**
 * Löst einen Code ein wie ein Gerät (eigener Cookie-Jar, `POST /api/geraete/koppeln`) und fragt
 * einmal den Anmeldestatus ab, damit die Liste einen letzten Zugriff zeigt.
 */
async function einloesen(code: string) {
  const geraet = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const antwort = await geraet.post('/api/geraete/koppeln', { data: { code } });
    expect(antwort.ok(), `Koppeln: ${antwort.status()} ${await antwort.text()}`).toBe(true);
    expect((await geraet.get('/api/auth/me')).ok()).toBe(true);
  } finally {
    await geraet.dispose();
  }
}

/** Ein paar Kopplungen in verschiedenen Zuständen, damit die Liste etwas zeigt (D3). */
async function geraeteAnlegen(page: Page, einsatz: number) {
  const basis = `/api/einsaetze/${einsatz}`;
  const uhs = await ersteId(page, `${basis}/uhs`);
  const br = await ersteId(page, `${basis}/bereitstellungsraeume`);
  const tablet = await fuelle<Kopplung>(page, 'post', `${basis}/geraete`, {
    ansicht: 'uhs-tablet',
    stelle_id: uhs,
    bezeichnung: 'Tablet Aufnahme',
  });
  await einloesen(tablet.code.code);
  const brTablet = await fuelle<Kopplung>(page, 'post', `${basis}/geraete`, {
    ansicht: 'bereitstellungsraum',
    stelle_id: br,
    bezeichnung: 'Tablet BR',
  });
  await einloesen(brTablet.code.code);
  await fuelle(page, 'post', `${basis}/geraete`, {
    ansicht: 'lagemonitor',
    bezeichnung: 'Monitor Stab',
  });
  const verpflegung = await fuelle<Kopplung>(page, 'post', `${basis}/geraete`, {
    ansicht: 'verpflegung',
    bezeichnung: 'Ausgabe Schule',
  });
  await fuelle(page, 'post', `${basis}/geraete/${verpflegung.kopplung.id}/widerrufen`);
}

test.describe(KAPITEL, () => {
  test('Liste „Gekoppelte Geräte“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await geraeteAnlegen(page, demo.id);

    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/geraete`);
    const liste = page.getByRole('region', { name: 'Gekoppelte Geräte' });
    await expect(liste.locator('[data-lfh="geraet-zustand"]')).toHaveCount(4);
    await expect(liste.getByText(/widerrufen/)).toBeVisible();
    await fotografiere(liste, KAPITEL, 'geraeteliste');
  });

  test('Dialog „Code für …“ nach dem Koppeln', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const betreuung = await page.request.get(`/api/einsaetze/${demo.id}/betreuung`);
    const [stelle] = ((await betreuung.json()) as { stellen: { bezeichnung: string }[] }).stellen;
    expect(stelle, 'der Demo-Einsatz hat eine Betreuungsstelle').toBeDefined();

    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/geraete`);
    await page.getByRole('button', { name: 'Gerät koppeln' }).click();
    const maske = page.getByRole('dialog', { name: 'Gerät koppeln' });
    await waehleIn(maske.getByRole('combobox', { name: 'Ansicht' }), 'Betreuungsstelle');
    await waehleIn(maske.getByRole('combobox', { name: 'Betreuungsstelle' }), stelle.bezeichnung);
    await maske.getByLabel('Gerätebezeichnung').fill('Tablet Aula');
    await maske.getByRole('button', { name: 'Koppeln', exact: true }).click();

    const code = page.getByRole('dialog', { name: /^Code für / });
    await expect(code.locator('[data-lfh="kopplungscode-text"]')).toHaveText(
      /^[A-Z0-9]{4}-[A-Z0-9]{4}$/,
    );
    await fotografiere(code, KAPITEL, 'kopplungscode');
    await code.getByRole('button', { name: 'Fertig' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Gekoppelte Geräte' })
        .getByText(/^Betreuungsstelle · wartet auf Gerät/),
    ).toBeVisible();
  });

  test('Aktionsmenü einer Kopplung', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/geraete`);
    const knopf = page.getByRole('button', { name: /^Aktionen zu Gerät .*Tablet Aufnahme$/ });
    await knopf.click();
    const menue = page.getByRole('menu');
    await expect(menue.getByRole('menuitem', { name: /Widerrufen/ })).toBeVisible();
    await fotografiere(menue, KAPITEL, 'aktionen');
  });

  test('Dialog „Verlängern“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/geraete`);
    await page.getByRole('button', { name: /^Aktionen zu Gerät .*Tablet Aufnahme$/ }).click();
    await page.getByRole('menuitem', { name: /Verlängern/ }).click();
    const dialog = page.getByRole('dialog', { name: /^Verlängern — / });
    await expect(dialog.getByLabel('Neues Ende')).toBeVisible();
    await dialog.getByLabel('Neues Ende').blur();
    await fotografiere(dialog, KAPITEL, 'verlaengern');
    // Nachgeklickt: die Vorbelegung (24 h ab jetzt) nimmt der Server an.
    await dialog.getByRole('button', { name: 'Verlängern', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
});
