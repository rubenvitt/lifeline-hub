import { anmelden, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Stammdaten“ (`docs/anwender/kapitel/stammdaten.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep stammdaten`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   fahrzeuge.png         frontend/src/stammdaten/FahrzeugeTab.tsx,
 *                         frontend/src/stammdaten/dienststatus.tsx
 *   fahrzeug-anlegen.png  frontend/src/stammdaten/FahrzeugFormModal.tsx
 *   organisation.png      frontend/src/stammdaten/OrganisationTab.tsx
 *   vorlage-stammbesetzung.png
 *                         frontend/src/stammdaten/EinheitVorlageDetailPage.tsx,
 *                         frontend/src/stammdaten/EinheitVorlageSections.tsx
 *                         (Paneel „Stammbesetzung“), frontend/src/stammdaten/EinheitVorlagenTab.tsx
 *                         (Weg dorthin)
 *   schichtmodelle.png    frontend/src/stammdaten/SchichtmodelleTab.tsx,
 *                         frontend/src/abloesung/schichtmodellText.ts
 *   schichtmodell-anlegen.png
 *                         frontend/src/abloesung/SchichtmodellModal.tsx
 *
 * Nichts wird gespeichert: die Demo-Stammdaten bleiben für andere Kapitel unverändert. Einzige
 * Ausnahme ist das Schichtmodell „Sanitätsdienst“ als Vorgabe der Organisation für das Bild der
 * Schichtmodelle; der Test löscht es danach wieder (LLH-1122). Die
 * Vorlage „Rettungsstaffel“ unter „Sanitätszug Musterstadt“ bringen die Demo-Daten mit
 * (`src/demo/szenario.rs`, `EINHEITEN_VORLAGEN`).
 */

const KAPITEL = 'stammdaten';

test.describe(KAPITEL, () => {
  test('Katalog „Fahrzeuge“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/stammdaten/fahrzeuge');
    const tabelle = page.locator('.ant-table-wrapper');
    await expect(tabelle.getByText('Musterstadt 11-1')).toBeVisible();
    await fotografiere(tabelle, KAPITEL, 'fahrzeuge');
  });

  test('Dialog „Fahrzeug anlegen“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/stammdaten/fahrzeuge');
    await page.getByRole('button', { name: 'Fahrzeug anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Fahrzeug anlegen' });
    await dialog.getByLabel('Funkrufname').fill('Musterstadt 44-1');
    await dialog.getByLabel('Fahrzeugtyp').fill('LF 20');
    await dialog.getByLabel('Trägerorganisation').fill('Feuerwehr Musterstadt');
    await dialog.getByLabel('Trägerorganisation').blur();
    await fotografiere(dialog, KAPITEL, 'fahrzeug-anlegen');
  });

  test('Sektion „Organisation“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/stammdaten/organisation');
    const formular = page.locator('form');
    await expect(formular.getByLabel('Name der Organisation')).toBeVisible();
    await fotografiere(formular, KAPITEL, 'organisation');
  });

  test('Stammbesetzung einer Einheiten-Vorlage', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/stammdaten/einheiten');
    await page.getByRole('link', { name: 'Rettungsstaffel', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/stammdaten\/einheiten\/\d+$/);
    const besetzung = page.getByRole('region', { name: 'Stammbesetzung' });
    await expect(besetzung.getByRole('link', { name: 'Anna Probe' })).toBeVisible();
    // Die Position aus dem Personalstamm steht erst da, wenn das Personal geladen ist.
    await expect(besetzung.getByText(/\(Vorgabe\)/).first()).toBeVisible();
    await expect(besetzung.getByRole('combobox', { name: 'Person wählen' })).toBeVisible();
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(besetzung, KAPITEL, 'vorlage-stammbesetzung');
  });

  test('Katalog „Schichtmodelle“', async ({ page }) => {
    await anmelden(page);
    const modell = await fuelle<{ id: number }>(page, 'post', '/api/schichtmodelle', {
      bezeichnung: 'Sanitätsdienst',
      typ: 'rhythmus',
      rhythmus_minuten: 360,
      ist_vorgabe: true,
    });
    try {
      await uhrAnhalten(page);
      await page.goto('/admin/stammdaten/schichtmodelle');
      const tabelle = page.locator('.ant-table-wrapper');
      await expect(tabelle.getByText('12-h-Schicht Hochwasser')).toBeVisible();
      await expect(tabelle.getByText('Vorgabe der Organisation')).toBeVisible();
      await fotografiere(tabelle, KAPITEL, 'schichtmodelle');
    } finally {
      await fuelle(page, 'delete', `/api/schichtmodelle/${modell.id}`);
    }
  });

  test('Dialog „Schichtmodell anlegen“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/stammdaten/schichtmodelle');
    await page.getByRole('button', { name: 'Schichtmodell anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Schichtmodell anlegen' });
    await dialog.getByRole('textbox', { name: 'Bezeichnung' }).fill('Hochwasser 12 h');
    await dialog.getByRole('radio', { name: 'Wechselzeiten' }).click();
    await dialog.getByRole('textbox', { name: 'Wechselzeiten' }).fill('0600 1800');
    await dialog.getByRole('textbox', { name: 'Mindestdauer' }).fill('4 h');
    await dialog.getByRole('textbox', { name: 'Mindestdauer' }).blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'schichtmodell-anlegen');
  });
});
