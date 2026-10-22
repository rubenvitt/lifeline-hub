import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Lagebild“ (`docs/anwender/kapitel/lagebild.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep lagebild`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   lagebild.png          frontend/src/pages/lage-dashboard/LageDashboardPage.tsx,
 *                         frontend/src/pages/lage-dashboard/LagePaneele.tsx,
 *                         frontend/src/wetter/WetterKopfMarke.tsx (Wettermarke im Kopf, LLH-1117)
 *   etb-eintraege-neu.png frontend/src/pages/lage-dashboard/LagePaneele.tsx (MeldungsstromPaneel,
 *                         Paneel „Jüngste ETB-Einträge“)
 */

const KAPITEL = 'lagebild';

/**
 * Das Wetter am Einsatzort als Literal in der Wire-Form (wie `wetter-pegel.bilder.ts`): sonst ginge
 * das Backend an Bright Sky, und das Bild zeigte das Wetter des Lauftags. Stufe „mäßig“: die Marke
 * im Kopf erscheint, der Unwetterhinweis der AlarmZentrale nicht (er läge über dem Bild).
 */
async function stelleWetter(page: Page, einsatzId: number, jetzt: Date) {
  const um = (ms: number) => new Date(jetzt.getTime() + ms).toISOString();
  await page.route(`**/api/einsaetze/${einsatzId}/wetter`, (route) =>
    route.fulfill({
      json: {
        ort: { name: 'Musterstadt', kreis: 'Landkreis Musterland', land: 'Niedersachsen' },
        warnungen: {
          zustand: 'ok',
          abgerufen_at: um(-4 * 60_000),
          daten: [
            {
              stufe: 'maessig',
              ereignis: 'DAUERREGEN',
              ueberschrift: 'Amtliche WARNUNG vor DAUERREGEN',
              beginn: um(-3 * 3_600_000),
              ende: um(9 * 3_600_000),
            },
          ],
        },
        vorhersage: { zustand: 'kein_ort' },
        aktuell: { zustand: 'kein_ort' },
      },
    }),
  );
}

test.describe(KAPITEL, () => {
  test('Lagebild des Demo-Einsatzes', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const jetzt = await uhrAnhalten(page);
    await stelleWetter(page, demo.id, jetzt);
    await page.goto(`/einsaetze/${demo.id}/lage-dashboard`);
    await expect(page.locator('[data-lfh="wetter-kopfmarke"]')).toContainText('Dauerregen');
    await expect(page.locator('[data-lfh="gefahrenzeile"]').first()).toBeVisible();
    // Die Demo-Gebiete sind nicht beurteilt: der Fuß des Paneels nennt sie.
    await expect(page.locator('[data-lfh="gefahren-beurteilung"]')).toContainText(
      'nicht beurteilt',
    );
    await expect(page.locator('[data-sichtung]').first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Jüngste Einträge' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'lagebild');
    // Ablauf weiter: aus einem Paneel ins Modul.
    await page
      .getByRole('region', { name: 'Gefahrenmatrix' })
      .getByRole('button', { name: 'Gefahren' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/gefahren`));
  });

  test('Jüngste ETB-Einträge mit Sammelbanner für neue Einträge', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lage-dashboard`);
    const strom = page.getByRole('region', { name: 'Jüngste ETB-Einträge' });
    await expect(page.getByRole('list', { name: 'Jüngste Einträge' })).toBeVisible();
    // Zwei neue Einträge, während die Seite offen ist: der Strom schiebt sie nicht ein, sondern
    // kündigt sie an.
    for (const inhalt of [
      'Pegel Mühlbach: Wasserstand stagniert seit 30 Minuten.',
      'UHS Turnhalle meldet freie Kapazität für vier Patienten.',
    ]) {
      await fuelle(page, 'post', `/api/einsaetze/${demo.id}/etb`, {
        typ: 'meldung',
        inhalt,
        von: 'Abschnitt Sanitätsdienst',
        an: 'ELW 1',
        meldeweg: 'funk',
      });
    }
    await expect(page.getByText('2 neue Einträge')).toBeVisible();
    await fotografiere(strom, KAPITEL, 'etb-eintraege-neu');
    await strom.getByRole('button', { name: 'anzeigen' }).click();
    await expect(page.getByText('2 neue Einträge')).toBeHidden();
    await expect(
      strom.getByText('UHS Turnhalle meldet freie Kapazität für vier Patienten.'),
    ).toBeVisible();
  });
});
