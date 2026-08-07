import { expect, test, type Page, type Locator } from '@playwright/test';

// e2e-Smoke der CMD+K-Command-Palette (LFH-11). Deckt das ab, was jsdom nicht kann:
// echtes Hotkey-Verhalten, Navigation, und vor allem die Koexistenz des Palette-Modals
// über einem offenen antd-Drawer (AK6 — nur im echten Browser-Layout prüfbar).
// Harness: Backend und Vite startet playwright.config.ts selbst (LFH-309), Login
// admin / e2e-admin-pw gegen eine Temp-DB je Lauf.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const SCHMAL = { width: 390, height: 844 };

/** Eindeutiges Palette-Signal: das Suchfeld (Placeholder ist projektweit einmalig). */
function paletteInput(page: Page): Locator {
  return page.getByPlaceholder(/Suchen: Module/);
}

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

/** Hartes Navigieren zu einem Modul + warten bis die App (EinsatzLayout-Header)
 *  gemountet ist — sonst kommt der Hotkey vor der Provider-Listener-Bindung. */
async function zumModul(page: Page, id: string, modul: string) {
  await page.goto(`/einsaetze/${id}/${modul}`);
  await expect(page.locator('header').first()).toBeVisible();
}

test('öffnet auf 390 px per sichtbarem Trigger, fokussiert die Palette und navigiert per Enter (AK1–AK3)', async ({ page }) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Palette ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await zumModul(page, id, 'etb');

  const trigger = page.getByRole('button', { name: 'Suchen' });
  const kasten = (await trigger.boundingBox())!;
  expect(Math.min(kasten.width, kasten.height), 'Trefffläche des Such-Triggers').toBeGreaterThanOrEqual(48);
  await trigger.click();
  await expect(paletteInput(page)).toBeFocused();

  await paletteInput(page).fill('lagekarte');
  await expect(page.getByRole('option', { name: /Lagekarte/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

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

test('legt sich über den mobilen Navigations-Drawer, ESC schließt nur die Palette, Drawer bleibt bedienbar (AK6)', async ({ page }) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Drawer ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await zumModul(page, id, 'etb');

  // Den echten Navigations-Drawer aus EinsatzLayout öffnen. Ein fachlicher
  // Anlegen-Drawer belegt den mobilen Navigationsvertrag nicht.
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  const navDrawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(navDrawer).toBeVisible();
  await expect(navDrawer.getByRole('navigation')).toBeVisible();

  // Palette ÜBER dem Drawer öffnen — beide Overlays gleichzeitig sichtbar
  await page.keyboard.press('Control+k');
  const palette = paletteInput(page);
  const paletteDialog = page.getByRole('dialog').filter({ has: palette });
  await expect(palette).toBeVisible();
  await expect(navDrawer).toBeVisible();

  // Der Fokus bleibt sichtbar innerhalb der obersten Palette und läuft nicht
  // in den darunterliegenden Drawer.
  await expect(palette).toBeFocused();
  await expect(page.locator(':focus-visible')).toHaveAttribute('placeholder', /Suchen: Module/);
  await page.keyboard.press('Tab');
  await expect(palette).not.toBeFocused();
  await expect(paletteDialog.locator(':focus-visible')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(palette).toBeFocused();
  await expect(page.locator(':focus-visible')).toHaveAttribute('placeholder', /Suchen: Module/);

  // ESC schließt NUR die Palette, der Drawer bleibt offen …
  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();
  await expect(navDrawer).toBeVisible();

  // … und bleibt bedienbar: die echte Modulnavigation reagiert weiter.
  await navDrawer.getByRole('button', { name: 'Lage' }).click();
  await navDrawer.getByRole('button', { name: 'Lagekarte' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/lagekarte`));
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
