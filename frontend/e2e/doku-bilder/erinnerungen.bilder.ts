import type { Page } from '@playwright/test';
import {
  anmelden,
  apiAlsAdmin,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Erinnerungen“ (`docs/anwender/kapitel/erinnerungen.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep erinnerungen`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   erinnerungen-liste.png   frontend/src/pages/ErinnerungenPage.tsx, frontend/src/erinnerung/ErinnerungKarte.tsx
 *   erinnerung-anlegen.png   frontend/src/erinnerung/ErinnerungFormular.tsx
 */

const KAPITEL = 'erinnerungen';

/** Zeitpunkt `minuten` ab jetzt in der Form des Servers ('YYYY-MM-DD HH:MM', UTC). */
function inMinuten(minuten: number): string {
  return new Date(Date.now() + minuten * 60_000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Öffnet die Erinnerungen des Demo-Einsatzes. */
async function erinnerungenOeffnen(page: Page) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/erinnerungen`);
  await expect(page.getByRole('button', { name: 'Erinnerung anlegen' })).toBeVisible();
  await expect(page.getByText('Lagemeldung aller Einsatzabschnitte').first()).toBeVisible();
}

test.describe(KAPITEL, () => {
  // Demo-Lücke (D3): der Demo-Einsatz hat nur eine offene Erinnerung und keine wiederkehrende.
  // Einmal je Lauf, die Datenbank teilen alle Tests.
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    const demo = await demoEinsatz(api);
    await fuelle(api, 'post', `/api/einsaetze/${demo.id}/erinnerungen`, {
      titel: 'Lagemeldung aller Einsatzabschnitte',
      beschreibung: 'Stand Kräfte, Betroffene und Schäden je Abschnitt abfragen.',
      faellig_at: inMinuten(45),
      intervall_minuten: 60,
      empfaenger_funktion: 'S2',
    });
    await api.dispose();
  });

  test('Offene Erinnerungen mit Fälligkeit und Intervall', async ({ page }) => {
    await erinnerungenOeffnen(page);
    await fotografiere(page, KAPITEL, 'erinnerungen-liste');
  });

  test('Formular „Neue Erinnerung“', async ({ page }) => {
    await erinnerungenOeffnen(page);
    await page.getByRole('button', { name: 'Erinnerung anlegen' }).click();
    const paneel = page.getByRole('region', { name: 'Neue Erinnerung' });
    await paneel.getByLabel('Titel').fill('Ablösung Rettungsstaffel vorbereiten');
    await paneel
      .getByLabel('Beschreibung')
      .fill('Ersatzkräfte bei der Leitstelle anfragen, Übergabeort Turnhalle.');
    await paneel.getByLabel('Intervall').fill('30');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(paneel, KAPITEL, 'erinnerung-anlegen');
  });
});
