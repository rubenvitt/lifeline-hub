import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Einsatzabschnitte und Führungsorganisation“
 * (`docs/anwender/kapitel/einsatzabschnitte.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatzabschnitte`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   gliederung.png         frontend/src/pages/EinsatzabschnittePage.tsx,
 *                          frontend/src/pages/einsatzabschnitte/AbschnittDaten.tsx
 *   abschnitt-anlegen.png  frontend/src/pages/EinsatzabschnittePage.tsx (Formular)
 *   organigramm.png        frontend/src/pages/einsatzabschnitte/Organigramm.tsx
 *
 * Daten: Abschnitte, Unterabschnitt und Einheiten stammen aus den Demo-Daten; der neue Abschnitt
 * wird nur ausgefüllt, nicht gespeichert.
 */

const KAPITEL = 'einsatzabschnitte';

/**
 * Meldet der Seite die Benachrichtigungs-Freigabe als erteilt. Der kopflose Chromium sagt sonst
 * „denied“ (auch mit `permissions: ['notifications']`), und die Kopfleiste zeigte „Benachrichtigung
 * blockiert“ — ein Zustand des Bildlaufs, nicht der Arbeitsplätze, die das Bild zeigen soll.
 */
async function benachrichtigungErlaubt(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (typeof Notification !== 'undefined') {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    }
  });
}

test.describe(KAPITEL, () => {
  test('Gliederung mit gewähltem Abschnitt', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await benachrichtigungErlaubt(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzabschnitte`);
    const gliederung = page.getByRole('region', { name: 'Gliederung' });
    await gliederung.getByText('Sanitätsdienst').first().click();
    const detail = page.getByRole('region', { name: 'Abschnitt: Sanitätsdienst' });
    await expect(detail.getByText('Zugeordnete Einheiten')).toBeVisible();
    await expect(detail.getByRole('listitem').first()).toBeVisible();
    await fotografiere(page, KAPITEL, 'gliederung');
  });

  test('Formular „Neuer Abschnitt“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzabschnitte`);
    await expect(page.getByRole('region', { name: 'Gliederung' })).toBeVisible();
    await page.getByRole('button', { name: 'Abschnitt anlegen' }).first().click();
    const formular = page.getByRole('region', { name: 'Neuer Abschnitt' });
    await formular.getByLabel('Name').fill('Deichverteidigung');
    await formular.getByLabel('Kurzbezeichnung').fill('EA 4');
    await waehleIn(formular.getByRole('combobox', { name: 'Lagezustand' }), 'angespannt');
    await formular
      .getByLabel('Abschnittsauftrag')
      .fill('Deich am Mühlbach sichern, Sandsackverbau am Nordufer');
    await formular.getByLabel('Abschnittsauftrag').blur();
    await fotografiere(formular, KAPITEL, 'abschnitt-anlegen');
  });

  test('Organigramm der Führungsorganisation', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzabschnitte?ansicht=organigramm`);
    const organigramm = page.locator('.organigramm-print-root');
    await expect(organigramm.getByRole('group', { name: 'Einsatzleitung' })).toBeVisible();
    await expect(organigramm.getByText('UHS Turnhalle').first()).toBeVisible();
    await fotografiere(organigramm, KAPITEL, 'organigramm');
  });
});
