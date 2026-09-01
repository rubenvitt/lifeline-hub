import { expect, test, type Page } from '@playwright/test';

/**
 * Der Aufnahmeweg für Personen (LFH-340 · C5, AK 2 und AK 3).
 *
 * Der Ausgangsbefund war eine Zahl: **9 Interaktionen und 2 Vollseiten-Wechsel** je
 * gesichteter Person, weil die Sichtungskategorie in der Schnellerfassung fehlte — anlegen,
 * Detailseite öffnen, sichten. Diese Datei misst die Zahl, nicht das Gefühl.
 *
 * ── DIE ZWEI AKs, UND WARUM SIE ZWEI SIND ───────────────────────────────────────────────
 *
 *  1. **AK 2 — ≤ 4 Interaktionen, kein Seitenwechsel.** Gemessen am Modal der Liste. Die
 *     URL vor und nach dem Erfassen ist dieselbe; das ist die belastbare Fassung von „ohne
 *     Seitenwechsel". Die Aufnahme-ROUTE erfüllt dieses AK bewusst nicht — sie ist die
 *     Anspring-Adresse für andere Module, und eine angesprungene Route IST ein
 *     Seitenwechsel. Der Widerspruch im Ticket ist damit aufgelöst, nicht umbenannt.
 *  2. **AK 3 — Serie.** Nach „Speichern und nächste" ist die Maske leer, der Fokus steht im
 *     ersten Feld, der Zähler ist gestiegen, und es wurde kein Dialog neu geöffnet.
 *
 * ── KEIN `waitForLoadState('networkidle')` ──────────────────────────────────────────────
 *
 * Auf Einsatzrouten bleibt ein SSE-Strom offen; die Bedingung tritt nie sauber ein
 * (LFH-385). Die Zusicherungen warten inhaltlich.
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
 * Die Sichtungs-Gruppe — über die Feld-Id, NICHT über `getByRole('radiogroup')`.
 *
 * Bis LFH-392 stand hier als Grund, die Kopfzeile trage zwei WEITERE Radiogruppen
 * („Farbschema wählen", „Bediendichte wählen", beides `Segmented`), ein blankes
 * `getByRole('radiogroup')` breche also im Strict-Modus. Diese zwei Gruppen sind fort —
 * der Grund ist damit hinfällig, die Wahl des Selektors aber NICHT.
 *
 * Er bleibt, weil er an den richtigen Vertrag bindet: die Id kommt aus `name="sichtung"`
 * am `Form.Item`, also an denselben Namen, der abgesendet wird. Auf
 * `getByRole('radiogroup')` umzustellen koppelte diesen Test wieder daran, wie viele
 * Radiogruppen sonst noch auf der Seite stehen — genau die Zahl, die LFH-392 gerade
 * beweglich gemacht hat.
 */
function sichtung(page: Page) {
  return page.locator('#sichtung');
}

/** Eine Sichtungs-Auswahlfläche über ihre Beschriftung treffen. */
function skFlaeche(page: Page, label: string) {
  return sichtung(page).getByText(label, { exact: true });
}

test('AK 2: eine gesichtete Person in ≤ 4 Interaktionen und ohne Seitenwechsel', async ({ page }) => {
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

  // Die Quittung trägt BEIDES: die vergebene Registriernummer (Befund H30) und die
  // Kategorie — der Beleg, dass die Sichtung in derselben Anlage angekommen ist.
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

  // Fokus zurück im ersten Feld: das ist seit C5 die erste Auswahlfläche der Sichtung.
  const ersteFlaeche = sichtung(page).getByRole('radio').first();
  await expect(ersteFlaeche).toBeFocused();

  await skFlaeche(page, 'SK III').click();
  await page.getByRole('button', { name: 'Speichern und nächste' }).click();
  await expect(page.getByText(/Erfasst: 2/), 'der Zähler steigt').toBeVisible();
});

test('die Aufnahme-Route zeigt dieselbe Maske und erfasst in Serie', async ({ page }) => {
  // Sie ist die Anspring-Adresse für andere Module (C6). Geprüft wird, dass die Route
  // existiert und trägt — die Interaktionszahl misst der Fall oben am Modal.
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
