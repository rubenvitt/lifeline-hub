import { expect, test, type Locator, type Page } from '@playwright/test';
import { farbenDunkel, farbenHell } from '../src/theme/tokens';
import { randKontrast } from './kontrast-kern';

/**
 * Der Rand eines Knopfs auf einer Hinweisfläche hält ≥ 3 : 1, Tag und Nacht (LFH-739, Spec
 * `farbrollen-kontrast`, WCAG 1.4.11): gegen die Hinweisfläche UND gegen die eigene Knopffläche.
 * Die Hinweisfläche ist die Statusfläche ihrer Bedeutung; vorher leitete antd sie aus den
 * Signalfarben ab, und der Rand fiel am Tag auf 2,16 (Info, Prüfliste LFH-690: 2,84). Gerechnet
 * steht dasselbe in `src/theme/hinweisKontrast.test.ts`; hier zählt, was der Browser zeichnet.
 * Der Boden steht als Literal.
 *
 * GEMESSEN (beide Zustände per `page.route`, ohne Backend-Schalter):
 *  · Info: „Zu den Demo-Daten“ im Demo-Hinweis der Einsatzliste (Knopf in der Beschreibung).
 *    `GET /api/demo-daten` antwortet „nicht importiert“, sonst ist die Route ohne
 *    `--demo-daten` gar nicht registriert.
 *  · Fehler: „Erneut abrufen“ im Ladefehler der Einsatzliste (Knopf im `action`-Slot).
 *    `GET /api/einsaetze` antwortet 500.
 *
 * Dass der Grund außen die Statusfläche IST, sichert der Spec vor der Messung zu; sonst wäre
 * „gegen die Hinweisfläche“ gegen irgendeinen Grund gemessen.
 */

const BODEN = 3;

const ROLLEN = { light: farbenHell, dark: farbenDunkel } as const;

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).concat(1);
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function randHaelt(knopf: Locator, flaeche: string, name: string) {
  await expect(knopf, name).toBeVisible();
  const m = await randKontrast(knopf, 'top');
  const beschreibung = `${name}: ${JSON.stringify(m)}`;
  expect(m.gegenAussen, `${beschreibung} — gegen die Hinweisfläche`).toBeGreaterThanOrEqual(BODEN);
  expect(m.gegenInnen, `${beschreibung} — gegen die Knopffläche`).toBeGreaterThanOrEqual(BODEN);
  expect(m.aussen, `${beschreibung} — Grund außen ist die Statusfläche`).toEqual(rgb(flaeche));
}

for (const modus of ['light', 'dark'] as const) {
  test.describe(`Knopfrand auf Hinweisflächen — ${modus}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    });

    test('Info: Demo-Hinweis der Einsatzliste', async ({ page }) => {
      await page.route(
        (url) => url.pathname === '/api/demo-daten',
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({ json: { importiert: false } })
            : route.fallback(),
      );
      await anmelden(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const hinweis = page
        .locator('.ant-alert-info')
        .filter({ hasText: 'Demo-Daten sind freigeschaltet und noch nicht importiert.' });
      await expect(hinweis).toHaveCount(1);
      await randHaelt(
        hinweis.getByRole('link', { name: 'Zu den Demo-Daten' }),
        ROLLEN[modus].bedienFlaeche,
        `${modus}/Zu den Demo-Daten`,
      );
    });

    test('Fehler: Ladefehler der Einsatzliste', async ({ page }) => {
      await anmelden(page);
      await page.route(
        (url) => url.pathname === '/api/einsaetze',
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({ status: 500, json: { fehler: 'E2E 739' } })
            : route.fallback(),
      );
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const hinweis = page
        .locator('.ant-alert-error')
        .filter({ hasText: 'Die Einsatzliste konnte nicht geladen werden.' });
      await expect(hinweis).toHaveCount(1);
      await randHaelt(
        hinweis.getByRole('button', { name: 'Erneut abrufen' }),
        ROLLEN[modus].alarmFlaeche,
        `${modus}/Erneut abrufen`,
      );
    });
  });
}
