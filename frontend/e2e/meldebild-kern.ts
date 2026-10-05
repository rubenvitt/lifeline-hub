import { expect, type Page } from '@playwright/test';

/**
 * Hilfen der Meldebild-Specs, geteilt von `meldebild-tabelle.spec.ts` und
 * `meldebild-druck.spec.ts` (LFH-915) — Muster `rollen-kern.ts`: wer einen Helfer braucht, nimmt
 * ihn von hier statt einer Kopie.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Subpixel-Spielraum für JEDEN Maßvergleich. */
export const SUBPIXEL = 0.5;

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

/**
 * Ad-hoc-Kräfte ohne Einheit erzeugen die Sammelzeile „Ohne Einheit" mit n Kindern — eine
 * Aufklapp-Ebene aus einem einzigen Endpunkt. ABSICHTLICH LANGE WERTE: die
 * Bezeichnungsspalte wächst mit dem Inhalt, sonst hätte die fixierte Spalte keinen
 * Bildlaufweg zu halten.
 */
export async function seedeKraefte(page: Page, einsatzId: string, anzahl: number) {
  for (let i = 0; i < anzahl; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personal`, {
      data: {
        adhoc: {
          name: `Kirchgassner-Wohlfahrt, Maximiliane ${i}`,
          funktion: 'Abschnittsleitung Technische Hilfeleistung',
          traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
        },
      },
    });
    expect(
      antwort.ok(),
      `Seeding Kraft ${i}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  }
}
