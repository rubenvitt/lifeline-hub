import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Einstellungen des Einsatzes und Module“
 * (`docs/anwender/kapitel/einsatz-einstellungen.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatz-einstellungen`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   allgemein.png   frontend/src/pages/EinsatzEinstellungenPage.tsx,
 *                   frontend/src/pages/einstellungen/EinsatzAllgemein.tsx
 *   verhalten.png   frontend/src/pages/einstellungen/EinsatzVerhalten.tsx
 *   module.png      frontend/src/pages/einstellungen/EinsatzModule.tsx,
 *                   frontend/src/pages/einstellungen/ModulEinstellungsListe.tsx
 */

const KAPITEL = 'einsatz-einstellungen';

test.describe(KAPITEL, () => {
  test('Reiter „Allgemein“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/allgemein`);
    const reiter = page.getByRole('tabpanel', { name: 'Allgemein' });
    await expect(reiter.getByLabel('Einstiegsmodul')).toBeVisible();
    await fotografiere(reiter, KAPITEL, 'allgemein');
  });

  test('Reiter „Verhalten & Automatik“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/verhalten`);
    const reiter = page.getByRole('tabpanel', { name: 'Verhalten & Automatik' });
    await expect(reiter.getByLabel('Rückmeldefrist Einheiten (Minuten)')).toBeVisible();
    await fotografiere(reiter, KAPITEL, 'verhalten');
  });

  test('Reiter „Module“ mit ausgeblendetem und beschränktem Modul', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const pfad = (modul: string) => `/api/einsaetze/${demo.id}/modul-overrides/${modul}`;
    // Nur für die Aufnahme: zwei Module verändert, danach zurückgesetzt. Andere Kapitel brauchen
    // den Demo-Einsatz unverändert.
    await fuelle(page, 'put', pfad('lageberichte'), { sichtbar: false, benoetigte_rolle: null });
    await fuelle(page, 'put', pfad('lagemeldungen'), {
      sichtbar: true,
      benoetigte_rolle: 'fuehrungskraft',
    });
    try {
      await uhrAnhalten(page);
      await page.goto(`/einsaetze/${demo.id}/einstellungen/module`);
      const paneel = page.getByRole('region', { name: 'Modul-Sichtbarkeit & Berechtigungen' });
      await paneel.getByLabel('Modul filtern').fill('Lage');
      await paneel.getByLabel('Modul filtern').blur();
      await expect(paneel.getByText('Lagemeldungen')).toBeVisible();
      await expect(paneel.getByText('Überblick')).toBeHidden();
      await fotografiere(paneel, KAPITEL, 'module');
    } finally {
      await fuelle(page, 'put', pfad('lageberichte'), { sichtbar: true, benoetigte_rolle: null });
      await fuelle(page, 'put', pfad('lagemeldungen'), { sichtbar: true, benoetigte_rolle: null });
    }
  });
});
