import { expect, test, type Page } from '@playwright/test';

/**
 * Chat-Layout und Auftragsseite auf dem Handschirm (LFH-343 · C8, Befunde H51/M72).
 *
 * WARUM HIER UND NICHT IN VITEST: `vite.config.ts` fährt Vitest mit `css: false`,
 * und jsdom rechnet kein Layout. Die eine Frage, die dieses Paket beantworten
 * muss — bleibt das Eingabefeld sichtbar, wenn der Nachrichtenstrom lang wird —
 * hängt an einer Höhenkette über mehrere Flex-Ebenen und ist ausschließlich im
 * Browser messbar.
 *
 * `toBeInViewport()` statt `toBeVisible()`: ein Element, das unterhalb des
 * sichtbaren Bereichs steht, IST sichtbar im Sinne von `toBeVisible` — genau der
 * Zustand, den H51 beschreibt („das Eingabefeld wandert nach jeder Nachricht aus
 * dem Bild"). Die schwächere Zusicherung wäre auch im kaputten Zustand grün.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const SCHMAL = { width: 390, height: 844 };

// Login-/Anlege-Helfer aus `kopfzeile-schmal.spec.ts` kopiert — es gibt (noch)
// kein geteiltes e2e-Hilfsmodul.
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

/** Waagerechter Überstand des Dokuments. `<= 0` heißt: kein Querscrollen. */
async function ueberstand(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test('Chat: die Eingabe bleibt bei langem Strom sichtbar — auch nach dem Absenden', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Chat ${Date.now()}`);

  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);

  const eingabe = page.getByPlaceholder('Nachricht…');
  await expect(eingabe).toBeVisible();

  // Genug Nachrichten, dass der Strom deutlich höher wird als der Schirm. Über
  // die Oberfläche gesendet statt per API: geprüft werden soll das Layout NACH
  // dem Absenden, und genau dieser Weg erzeugt es.
  for (let i = 1; i <= 12; i += 1) {
    await eingabe.fill(`Probe ${i} — Deichabschnitt Nord meldet Lage unverändert, Kräfte im Einsatz.`);
    await page.getByRole('button', { name: 'Senden' }).click();
    await expect(page.getByText(`Probe ${i} —`, { exact: false })).toBeVisible();
  }

  // Der Kern von H51: nach dem letzten Absenden steht die Eingabe weiterhin im
  // sichtbaren Bereich, nicht darunter.
  await expect(eingabe).toBeInViewport();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);
});

test('Chat: unter md trägt eine Segmented-Leiste die Kanäle, nicht die Seitenspalte', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Chat Kanäle ${Date.now()}`);

  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);
  await expect(page.getByPlaceholder('Nachricht…')).toBeVisible();

  // Die Kanalliste wird unter `md` NICHT bloß ausgeblendet, sondern durch die
  // Leiste ersetzt — sonst stünden beide Navigationen im Baum und die Aussage
  // wäre bedeutungslos (dieselbe Regel wie beim Navigations-Drawer, LFH-329/B1).
  await expect(page.getByTestId('kanal-leiste')).toBeVisible();
  await expect(page.getByTestId('kanal-spalte')).toHaveCount(0);

  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.getByTestId('kanal-spalte')).toBeVisible();
  await expect(page.getByTestId('kanal-leiste')).toHaveCount(0);
});

test('Aufträge: auf 390 px scrollt der Body nicht waagerecht', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Auftraege ${Date.now()}`);

  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/auftraege`);
  await expect(page.getByRole('heading', { name: 'Aufträge' })).toBeVisible();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);

  // Das Erfassungsformular ist der Teil, den C8 umgebaut hat (vier sichtbare
  // Felder plus Collapse) — aufgeklappt gemessen, sonst prüfte die Zusicherung
  // eine Fläche, die es im Betrieb so nicht gibt.
  await page.getByRole('button', { name: /Auftrag erteilen/ }).click();
  await expect(page.getByLabel('Auftrag / Was')).toBeVisible();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);

  await page.getByText(/Befehlsschema/).click();
  await expect(page.getByLabel('Ort / Wo')).toBeVisible();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);
});
