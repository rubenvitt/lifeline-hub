import { expect, type Page } from '@playwright/test';

/**
 * Hilfen der Organigramm-Specs (LFH-626), geteilt von `fuehrungsorganisation.spec.ts` und
 * `fuehrungsorganisation-druck.spec.ts` (LFH-915) — Muster `rollen-kern.ts`: wer einen Helfer
 * braucht, nimmt ihn von hier statt einer Kopie.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
export const FUEKW = { width: 1366, height: 768 };

/** Absichtlich lange, aber reale Werte. */
export const ABSCHNITT = 'Deichverteidigung Nordwest II';
export const KURZ = 'EA-NORD-2';
export const EINHEIT = 'Fachgruppe Wasserschaden Musterstadt-Nordwest';
export const EINHEIT_RUF = 'Florian Musterstadt 1/10';
export const FUEHRER = 'Kirchgassner-Wohlfahrt, Maximiliane';
export const STAERKE = '12/34/156//202';
export const SUBPIXEL = 0.5;
/** A4 hoch, nutzbar (wie `funkplan-kern.ts`, `druck-fluss.spec.ts`). */
export const A4_DRUCKBREITE = 680;

export async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

export async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

export async function post(
  page: Page,
  einsatzId: string,
  pfad: string,
  data: unknown,
): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

/** Acht oberste Abschnitte mit je drei Einheiten, im ersten ein Unterabschnitt. */
export async function seedeGross(page: Page, einsatzId: string) {
  const abschnitte: number[] = [];
  for (let i = 1; i <= 8; i++) {
    const id = await post(page, einsatzId, 'abschnitte', {
      name: i === 1 ? ABSCHNITT : `Einsatzabschnitt ${i}`,
      kurzbezeichnung: `EA-${i}`,
    });
    abschnitte.push(id);
    for (let j = 1; j <= 3; j++) {
      await post(page, einsatzId, 'einheiten', {
        name: i === 1 && j === 1 ? EINHEIT : `Einheit ${i}.${j}`,
        funkrufname: i === 1 && j === 1 ? EINHEIT_RUF : `Florian ${i}/${j}`,
        abschnitt_id: id,
      });
    }
  }
  const unter = await post(page, einsatzId, 'abschnitte', {
    name: 'Unterabschnitt Deich',
    ueber_abschnitt_id: abschnitte[0],
  });
  await post(page, einsatzId, 'einheiten', { name: 'Gruppe Deich', abschnitt_id: unter });
  return { abschnitte, unter };
}

export const organigramm = (page: Page) => page.getByRole('region', { name: 'Organigramm' });

export async function oeffneOrganigramm(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte?ansicht=organigramm`);
  // Der Zeiger steht noch, wo der letzte Klick war, womöglich über dem Organigramm: dann hielte
  // die Zufluss-Schleuse (LFH-867) jede Live-Änderung zurück. Ruhestellung oben links.
  await page.mouse.move(0, 0);
  // Datenanker: die Einheit steht erst, wenn Abschnitte und Einheiten geladen sind.
  await expect(organigramm(page).getByRole('link', { name: 'Gruppe Deich' })).toBeVisible();
}
