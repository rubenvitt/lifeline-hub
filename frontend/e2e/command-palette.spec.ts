import { expect, test, type Page, type Locator } from '@playwright/test';

// e2e-Smoke der CMD+K-Command-Palette (LFH-11). Deckt das ab, was jsdom nicht kann:
// echtes Hotkey-Verhalten, Navigation, und vor allem die Koexistenz des Palette-Modals
// über einem offenen antd-Drawer (AK6 — nur im echten Browser-Layout prüfbar).
// Backend separat starten (admin / e2e-admin-pw), Vite startet Playwright selbst.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Eindeutiges Palette-Signal: das Suchfeld (Placeholder ist projektweit einmalig). */
function paletteInput(page: Page): Locator {
  return page.getByPlaceholder(/Suchen: Module/);
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/** Hartes Navigieren zu einem Modul + warten bis die App (EinsatzLayout-Header)
 *  gemountet ist — sonst kommt der Hotkey vor der Provider-Listener-Bindung. */
async function zumModul(page: Page, id: string, modul: string) {
  await page.goto(`/einsaetze/${id}/${modul}`);
  await expect(page.locator('header').first()).toBeVisible();
}

test('öffnet mit STRG+K aus einem Einsatz, filtert per Suche und navigiert per Enter (AK1–AK3)', async ({ page }) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Palette ${Date.now()}`);
  await zumModul(page, id, 'etb');

  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();

  await paletteInput(page).fill('lagekarte');
  await page.getByRole('option', { name: /Lagekarte/ }).click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/lagekarte`));
  await expect(paletteInput(page)).toBeHidden();
});

test('öffnet global mit CMD+K und schließt mit ESC ohne Seiteneffekt (AK1, AK4)', async ({ page }) => {
  await anmelden(page); // landet auf /einsaetze (kein Einsatz-Kontext)

  await page.keyboard.press('Meta+k');
  await expect(paletteInput(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();
  await expect(page).toHaveURL(/\/einsaetze$/);
});

test('legt sich über einen offenen Drawer, ESC schließt nur die Palette, Drawer bleibt bedienbar (AK6)', async ({ page }) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Drawer ${Date.now()}`);
  await zumModul(page, id, 'unfallhilfsstellen');

  // antd-Drawer öffnen — neuer Einsatz ohne UHS zeigt den Leerzustand-Button
  // (Ersteller ist Einsatzleitung → darf schreiben).
  await page.getByRole('button', { name: 'Erste UHS anlegen' }).click();
  const drawerTitel = page.getByText('Unfallhilfsstelle anlegen');
  await expect(drawerTitel).toBeVisible();

  // Palette ÜBER dem Drawer öffnen — beide Overlays gleichzeitig sichtbar
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await expect(drawerTitel).toBeVisible();

  // ESC schließt NUR die Palette, der Drawer bleibt offen …
  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();
  await expect(drawerTitel).toBeVisible();

  // … und bleibt bedienbar (kein hängender Body-Scroll-Lock / Focus-Trap-Konflikt):
  // ein Drawer-Feld lässt sich noch fokussieren und befüllen.
  await page.getByLabel('Bezeichnung').fill('BHP Koexistenz');
  await expect(page.getByLabel('Bezeichnung')).toHaveValue('BHP Koexistenz');
});

test('Schnellaktion „Neue Person" navigiert und öffnet die Schnellerfassung (Schnellaktionen)', async ({ page }) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Aktion ${Date.now()}`);
  await zumModul(page, id, 'etb');

  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await paletteInput(page).fill('Neue Person');
  await page.getByRole('option', { name: /Neue Person/ }).click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/personen`));
  await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
});

test('Schnelleinstellung schaltet das Theme sichtbar um (Schnelleinstellungen)', async ({ page }) => {
  await anmelden(page);

  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await paletteInput(page).fill('Dunkel');
  await page.getByRole('option', { name: /Dunkel/ }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
