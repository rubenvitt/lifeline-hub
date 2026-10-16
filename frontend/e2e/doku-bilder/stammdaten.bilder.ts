import { anmelden, apiAlsAdmin, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

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
 *   verpflegungsplan.png  frontend/src/stammdaten/VerpflegungsplanTab.tsx
 *
 * Gespeichert wird nur der Verpflegungsplan (LLH-1058), den die Demo-Daten nicht mitbringen: vier
 * aktive Mahlzeiten und eine deaktivierte. Die übrigen Demo-Stammdaten bleiben unverändert. Die
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

  test('Katalog „Verpflegungsplan“', async ({ page }) => {
    const api = await apiAlsAdmin();
    try {
      for (const [bezeichnung, beginn, ende, verpflegungsart] of [
        ['Frühstück', '0630', '0800', 'kalt'],
        ['Mittag', '1200', '1330', 'warm'],
        ['Kaffee', '1500', '1530', 'getraenke'],
        ['Abendessen', '1800', '1930', 'warm'],
        ['Nachtverpflegung', '2300', '0100', 'kalt'],
      ]) {
        const m = await fuelle<{ id: number }>(api, 'post', '/api/verpflegung-vorlagen', {
          bezeichnung,
          beginn,
          ende,
          verpflegungsart,
        });
        if (bezeichnung === 'Kaffee') {
          await fuelle(api, 'patch', `/api/verpflegung-vorlagen/${m.id}`, { aktiv: false });
        }
      }
    } finally {
      await api.dispose();
    }
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/stammdaten/verpflegungsplan');
    const tabelle = page.locator('.ant-table-wrapper');
    await expect(tabelle.getByText('+1 Tag')).toBeVisible();
    await expect(tabelle.getByText('Inaktiv')).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(tabelle, KAPITEL, 'verpflegungsplan');
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
});
