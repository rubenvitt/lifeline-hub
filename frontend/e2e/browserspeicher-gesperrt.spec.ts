import { expect, test, type Page } from '@playwright/test';

/**
 * Gesperrter Browserspeicher (LFH-942, Spec `browserspeicher`). Auf einem gehärteten
 * Behördenrechner (Firefox mit `dom.storage.enabled=false`) ist `localStorage` `null`, in einer
 * Einbettung wirft schon der Zugriff. Vorher brach der erste Render im `ThemeModeProvider` ab,
 * und die Seite blieb weiß. jsdom belegt den Provider (`ThemeModeProvider.test.tsx`); hier wird
 * die ganze App mit allen Speichern geladen, die beim Start und bei der Anmeldung lesen.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Sammelt unbehandelte Fehler der Seite; ein Wurf im Render landet hier. */
function fehlerSammeln(page: Page): Error[] {
  const fehler: Error[] = [];
  page.on('pageerror', (e) => fehler.push(e));
  return fehler;
}

async function anmeldenOhneSpeicher(page: Page, fehler: Error[], nurEntwicklung?: RegExp) {
  await page.goto('/login');
  await expect(page.getByLabel('Benutzername')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  expect(fehler.filter((f) => !nurEntwicklung?.test(f.message))).toEqual([]);
}

test('localStorage ist null (Firefox mit gesperrtem DOM-Storage): Anmeldung im Nachtbetrieb', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: null });
  });
  const fehler = fehlerSammeln(page);
  await anmeldenOhneSpeicher(page, fehler);
});

test('jeder Zugriff auf localStorage wirft (Einbettung): Anmeldung im Nachtbetrieb', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        // Die TanStack-Devtools gibt es nur am Vite-Entwicklungsserver (im Build ein No-op);
        // sie lesen ihren Speicher unabgesichert. Ihr Wurf trägt deshalb eine eigene Marke.
        const quelle = /Devtools/.test(new Error().stack ?? '') ? 'devtools' : 'app';
        throw new DOMException(`Speicher gesperrt (${quelle})`, 'SecurityError');
      },
    });
  });
  const fehler = fehlerSammeln(page);
  await anmeldenOhneSpeicher(page, fehler, /\(devtools\)/);
});
