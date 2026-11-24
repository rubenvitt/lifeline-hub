import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Überblick“ (`docs/anwender/kapitel/ueberblick.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep ueberblick`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   ueberblick.png   frontend/src/pages/fuehrung/UeberblickPage.tsx,
 *                    frontend/src/components/instrument/AlarmZeile.tsx
 *   startliste.png   frontend/src/pages/fuehrung/StartlistePaneel.tsx,
 *                    frontend/src/components/instrument/ListenPaneel.tsx,
 *                    frontend/src/components/instrument/DashboardPaneel.tsx
 */

const KAPITEL = 'ueberblick';

/**
 * Der Demo-Einsatz trägt keinen Einsatzort; im Überblick stünde deshalb die Startliste „Einsatz
 * starten“ mit diesem einen offenen Punkt (LLH-1815). Das Bild des laufenden Einsatzes zeigt den
 * Überblick ohne sie, die Startliste hat ihr eigenes Bild. Nur, wenn er fehlt.
 */
async function demoEinsatzortFuellen(page: Page, einsatzId: number): Promise<void> {
  const kopf = (await (await page.request.get(`/api/einsaetze/${einsatzId}`)).json()) as {
    einsatzort?: string | null;
  };
  if (kopf.einsatzort) return;
  await fuelle(page, 'patch', `/api/einsaetze/${einsatzId}`, {
    einsatzort: 'Musterstadt, Mühlbachweg',
    einsatzort_lat: 50.9512,
    einsatzort_lon: 10.2489,
  });
}

test.describe(KAPITEL, () => {
  test('Überblick des Demo-Einsatzes', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await demoEinsatzortFuellen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    await expect(page.locator('[data-lfh="ueberblick-abschnitt"]').first()).toBeVisible();
    // Alle fünf Punkte erledigt: die Startliste steht nicht im Bild des laufenden Einsatzes.
    await expect(page.getByRole('region', { name: 'Einsatz starten' })).toHaveCount(0);
    await expect(page.locator('[data-lfh="ueberblick-marke"]').first()).toBeVisible();
    // Die Alarmzeile hat alle Quellen (LLH-1743), sonst zeigte das Bild einen Zwischenstand.
    await expect(page.locator('[data-lfh="alarm-zeile"]')).toHaveAttribute(
      'data-stand',
      'vollstaendig',
    );
    await fotografiere(page, KAPITEL, 'ueberblick');
    // Ablauf weiter: aus dem Paneel der Entscheidungen ins Einsatztagebuch.
    // Der Sprung „ETB ↗“ im Paneelkopf (Dashboard-Baukasten, LLH-1140).
    await page
      .locator('section[data-lfh="paneel"]')
      .filter({ has: page.getByRole('heading', { name: /Entscheidungen/ }) })
      .getByRole('button', { name: 'ETB' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/etb\\?.*typ=entscheidung`));
  });

  // Ablauf „Nur die eigenen Vorgänge sehen“ (LLH-1145): die Sicht steht in der Adresse.
  test('Offene Vorgänge: meine Stelle', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    const vorgaenge = page.locator('[data-lfh="offene-vorgaenge"]');
    await expect(vorgaenge.getByRole('heading', { level: 3 })).toHaveText([
      'Meldungen',
      'Aufträge',
      'Nachforderungen',
      'Erinnerungen',
      'Ablösungen',
    ]);
    await page.getByRole('radio', { name: 'meine Stelle' }).click();
    await expect(page).toHaveURL(/[?&]vorgaenge=meine/);
    await page.getByRole('radio', { name: 'alle', exact: true }).click();
    await expect(page).not.toHaveURL(/vorgaenge=/);
  });

  // Ablauf „Vom Überblick weiterarbeiten“, Schritt 3 (LLH-1743): die Übersichten verweisen
  // aufeinander.
  test('Vom Überblick ins Lagebild', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    await page.getByRole('button', { name: 'Lagebild', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/lage-dashboard`));
  });

  test('Vom Überblick zur Erfassung und zum Lagebericht', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    await page.getByRole('button', { name: 'Eintrag', exact: true }).click();
    // Die ETB-Seite räumt `neu=1` nach dem Öffnen der Erfassung wieder aus der Adresse.
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/etb`));
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    await page.getByRole('button', { name: 'Lagebericht', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/lageberichte$`));
  });

  // Ablauf „Einen neuen Einsatz arbeitsfähig machen“ (LLH-1815): ein frisch angelegter Einsatz mit
  // Einsatzort ohne Koordinate und erfasstem Einsatzleiter, sonst nichts.
  test('Startliste „Einsatz starten“', async ({ page }) => {
    await anmelden(page);
    const einsatz = await fuelle<{ id: number }>(page, 'post', '/api/einsaetze', {
      bezeichnung: 'Sturmschaden Waldweg',
    });
    await fuelle(page, 'patch', `/api/einsaetze/${einsatz.id}`, { einsatzort: 'Deich West' });
    await fuelle(page, 'patch', `/api/einsaetze/${einsatz.id}/command-post`, {
      einsatzleiter: { art: 'extern', name: 'KBM Weber' },
    });
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${einsatz.id}/ueberblick`);
    const startliste = page.getByRole('region', { name: 'Einsatz starten' });
    await expect(startliste.locator('[data-lfh="startliste-punkt"]')).toHaveCount(5);
    await expect(
      startliste.locator('[data-lfh="startliste-punkt"][data-zustand="erledigt"]'),
    ).toHaveCount(2);
    await expect(startliste).toContainText('nicht verortet');
    await fotografiere(startliste, KAPITEL, 'startliste');
    // Ablauf weiter: ein offener Punkt führt in seine Erfassung.
    await startliste.getByRole('link', { name: /Einsatzabschnitte/ }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatz.id}/einsatzabschnitte`));
    await expect(page.getByRole('dialog', { name: 'Abschnitt anlegen' })).toBeVisible();
    // Zurück im Überblick: „Ausblenden“ nimmt die Liste in diesem Browser weg.
    await page.goto(`/einsaetze/${einsatz.id}/ueberblick`);
    await startliste.getByRole('button', { name: 'Ausblenden' }).click();
    await expect(startliste).toHaveCount(0);
  });
});
