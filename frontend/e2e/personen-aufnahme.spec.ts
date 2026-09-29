import { expect, test, type Page } from '@playwright/test';

/**
 * Der Aufnahmeweg für Personen: die Sichtungskategorie geht mit der Anlage mit.
 *
 *  1. ≤ 4 Interaktionen, kein Seitenwechsel — gemessen am Modal der Liste, belegt über
 *     dieselbe URL vor und nach dem Erfassen. Die Aufnahme-ROUTE ist die Anspring-Adresse für
 *     andere Module und damit selbst ein Seitenwechsel.
 *  2. Serie: nach „Speichern und nächste" ist die Maske leer, der Fokus steht im ersten Feld,
 *     der Zähler ist gestiegen, und es wurde kein Dialog neu geöffnet.
 *
 * Kein `networkidle` (SSE-Strom).
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

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

/**
 * Die Sichtungs-Gruppe über die Feld-Id, nicht über `getByRole('radiogroup')`: die Id kommt aus
 * `name="sichtung"` am `Form.Item` und bindet an den abgesendeten Namen statt an die Zahl der
 * Radiogruppen auf der Seite.
 */
function sichtung(page: Page) {
  return page.locator('#sichtung');
}

/** Eine Sichtungs-Auswahlfläche über ihre Beschriftung treffen. */
function skFlaeche(page: Page, label: string) {
  return sichtung(page).getByText(label, { exact: true });
}

test('AK 2: eine gesichtete Person in ≤ 4 Interaktionen und ohne Seitenwechsel', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Aufnahme ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await expect(page.getByRole('button', { name: 'Schnellerfassung' })).toBeVisible();

  const vorher = page.url();
  let interaktionen = 0;

  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  interaktionen += 1;
  await expect(sichtung(page)).toBeVisible();

  await skFlaeche(page, 'SK II').click();
  interaktionen += 1;

  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  interaktionen += 1;

  // Die Quittung trägt Registriernummer UND Kategorie — die Sichtung kam in derselben Anlage an.
  await expect(page.getByText(/Erfasst als R-\d{3} · SK II/)).toBeVisible();
  expect(interaktionen, 'AK 2: höchstens vier Interaktionen').toBeLessThanOrEqual(4);
  expect(page.url(), 'AK 2: kein Seitenwechsel').toBe(vorher);
});

test('AK 3: „Speichern und nächste" leert, fokussiert zurück und zählt hoch', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Serie ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  await expect(sichtung(page)).toBeVisible();

  await skFlaeche(page, 'SK I').click();
  await page.getByRole('button', { name: 'Speichern und nächste' }).click();

  // OHNE einen Dialog neu zu öffnen: er steht noch.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/Erfasst: 1/)).toBeVisible();

  // Geleert — die zuvor gewählte Kategorie darf NICHT auf die nächste Person übergehen.
  const gewaehlt = sichtung(page).getByRole('radio', { checked: true });
  await expect(gewaehlt, 'die Sichtung wird je Person neu erhoben').toHaveCount(0);

  // Fokus zurück im ersten Feld, der ersten Auswahlfläche der Sichtung.
  const ersteFlaeche = sichtung(page).getByRole('radio').first();
  await expect(ersteFlaeche).toBeFocused();

  await skFlaeche(page, 'SK III').click();
  await page.getByRole('button', { name: 'Speichern und nächste' }).click();
  await expect(page.getByText(/Erfasst: 2/), 'der Zähler steigt').toBeVisible();
});

test('die Aufnahme-Route zeigt dieselbe Maske und erfasst in Serie', async ({ page }) => {
  // Die Anspring-Adresse für andere Module: existiert und trägt. Die Interaktionszahl misst
  // der Fall oben am Modal.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Aufnahmeroute ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/personen/aufnahme`);

  await expect(page.getByRole('heading', { name: /Aufnahme/ })).toBeVisible();
  await skFlaeche(page, 'SK I').click();
  await page.getByRole('button', { name: 'Speichern und nächste' }).click();

  await expect(page.getByText(/Erfasst als R-\d{3} · SK I/)).toBeVisible();
  // Der Ort bleibt — das ist der Unterschied zum Primär-Knopf, der in die Liste zurückgeht.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/aufnahme`));
});

test('S7: die Erfassungszeile erfasst per Kürzel in Serie, ohne Dialog', async ({ page }) => {
  // Die Kurzeingabe: EINE Eingabe, Enter erfasst, das Feld ist danach leer und fokussiert, die
  // Quittung steht an der Zeile und kommt aus der ANTWORT.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Zeile ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/personen`);

  const feld = page.getByRole('textbox', { name: 'Kurzeingabe Person' });
  await feld.fill('Kowalski, Anna w 34 sk3');
  // Erkannt wird die Sichtung als BBK-`SichtungsTag`, nicht als Designfarbe.
  await expect(page.locator('[data-lfh="erkannt"] [data-sichtung="sk3"]')).toHaveText('SK III');
  await feld.press('Enter');

  await expect(feld).toHaveValue('');
  await expect(feld).toBeFocused();
  const zuletzt = page.locator('[data-lfh="zuletzt"]');
  await expect(zuletzt).toHaveText(/R-001 Kowalski, Anna · SK III$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Serie: sofort die nächste, ohne Namen.
  await feld.fill('unbekannt m ~50 skt');
  await feld.press('Enter');
  await expect(zuletzt).toHaveText(/R-002 · tot$/);
  await expect(page.locator('tr.ant-table-row')).toHaveCount(2);
});
