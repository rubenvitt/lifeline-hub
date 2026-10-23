import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Taktische Zeit in der ETB-Zeitachse (LLH-1061, Specs `zeitdarstellung` und
 * `etb-zeitachse-darstellung`, „Zeiten der Zeitachse aus dem Formatkern“): die Zeitspalte zeigt
 * heute nur die Uhrzeit (`1446`), am Vortag Tag und Uhrzeit (`091446`); der Kopf der
 * Stundengruppe nennt den Beginn der Stunde ebenso. Mit der Gerätewahl „Datum und Uhrzeit“ steht
 * `14:46` bzw. `09.10. 14:46`.
 *
 * Die genaue Uhrzeit hängt an der Serveruhr; geprüft wird die FORM, und beim Vortag der Tag in
 * der Anzeigezone. Der Vortagseintrag wird per API mit einer Ereigniszeit am Vortag um 10:46 UTC
 * gesät — mittags, damit Berlin und UTC denselben Kalendertag haben.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const ZONE = 'Europe/Berlin';
/** Schlüssel der Gerätewahl (`anzeige/zeitDarstellungStore.ts`). */
const GERAETEWAHL = 'lifeline.zeitdarstellung';

const HEUTE_TEXT = 'Zeitprobe heute Lagemeldung Nord';
const VORTAG_TEXT = 'Zeitprobe Vortag Lagemeldung Süd';

test.use({ timezoneId: ZONE });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function seedeEintrag(page: Page, einsatzId: string, inhalt: string, ereigniszeit?: string) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
    data: { typ: 'meldung', inhalt, von: 'ELW 1', an: 'Leitstelle', ereigniszeit },
  });
  expect(antwort.ok(), `Seeding: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

/** Tag des Monats (zweistellig) eines Zeitpunkts in der Anzeigezone. */
function tagInZone(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: ZONE, day: '2-digit' }).format(d);
}

function zeitDerZeile(page: Page, text: string) {
  return page
    .locator('[data-lfh-eintrag="zeitachse"]')
    .filter({ hasText: text })
    .locator('[data-lfh="zeitachse-zeit"]');
}

function kopfDerGruppe(page: Page, text: string) {
  return page.locator('.etb-stundengruppe').filter({ hasText: text }).getByRole('heading', {
    level: 2,
  });
}

test('ETB: taktisch heute `1446`, am Vortag `091446`; „Datum und Uhrzeit“ am Gerät wirkt', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E ETB Zeitdarstellung ${Date.now()}`);
  const vortag = new Date();
  vortag.setUTCDate(vortag.getUTCDate() - 1);
  vortag.setUTCHours(10, 46, 0, 0);
  const vortagWire = vortag.toISOString().slice(0, 19).replace('T', ' ');
  await seedeEintrag(page, einsatzId, VORTAG_TEXT, vortagWire);
  await seedeEintrag(page, einsatzId, HEUTE_TEXT);
  const tag = tagInZone(vortag);

  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByText(HEUTE_TEXT, { exact: true })).toBeVisible();

  // Taktisch (Vorgabe): heute vier Ziffern, am Vortag sechs, beginnend mit dem Tag.
  await expect(zeitDerZeile(page, HEUTE_TEXT)).toHaveText(/^\d{4}$/);
  await expect(zeitDerZeile(page, VORTAG_TEXT)).toHaveText(new RegExp(`^${tag}\\d{2}46$`));
  await expect(kopfDerGruppe(page, HEUTE_TEXT)).toHaveText(/^\d{2}00$/);
  await expect(kopfDerGruppe(page, VORTAG_TEXT)).toHaveText(new RegExp(`^${tag}\\d{2}00$`));
  // Kein Doppelpunkt und kein Großbuchstaben-Monat irgendwo in der Zeitspalte.
  for (const zeit of await page.locator('[data-lfh="zeitachse-zeit"]').allTextContents()) {
    expect(zeit).not.toMatch(/[:A-Z]/);
  }

  // Gerätewahl „Datum und Uhrzeit“: dieselben Zeilen in der anderen Darstellung.
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [GERAETEWAHL, 'datum_uhrzeit']);
  await page.reload();
  await expect(page.getByText(HEUTE_TEXT, { exact: true })).toBeVisible();
  await expect(zeitDerZeile(page, HEUTE_TEXT)).toHaveText(/^\d{2}:\d{2}$/);
  await expect(zeitDerZeile(page, VORTAG_TEXT)).toHaveText(
    new RegExp(`^${tag}\\.\\d{2}\\. \\d{2}:46$`),
  );
  await page.evaluate((k) => localStorage.removeItem(k), GERAETEWAHL);
});
