import { stehendeAuswahl } from '../auswahl-kern';
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
 * Bilder des Kapitels „Material“ (`docs/anwender/kapitel/material.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep material`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   material.png              frontend/src/pages/MaterialPage.tsx, frontend/src/components/Datensicht.tsx
 *   material-disponieren.png  frontend/src/pages/MaterialPage.tsx (Dialog „Material disponieren“)
 *   adhoc-material.png        frontend/src/pages/MaterialPage.tsx (Dialog „Ad-hoc-Material ohne
 *                             Stammeintrag“)
 *
 * Demo-Lücke (D3): die Demo-Daten tragen Material nur im Stamm, keines ist im Einsatz. Die Spec
 * disponiert drei Stammposten und einen Ad-hoc-Posten und setzt zwei Status.
 */

const KAPITEL = 'material';

interface Stammmaterial {
  id: number;
  bezeichnung: string;
}
interface EinsatzMaterial {
  id: number;
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    try {
      const demo = await demoEinsatz(api);
      const antwort = await api.get('/api/material');
      expect(antwort.ok(), `Material: ${antwort.status()}`).toBe(true);
      const stamm = (await antwort.json()) as Stammmaterial[];
      const posten = (bezeichnung: string) => {
        const m = stamm.find((s) => s.bezeichnung === bezeichnung);
        expect(m, `Stammmaterial „${bezeichnung}“`).toBeDefined();
        return m!.id;
      };
      const pfad = `/api/einsaetze/${demo.id}/material`;
      const strom = await fuelle<EinsatzMaterial>(api, 'post', pfad, {
        material_id: posten('Stromerzeuger 8 kVA'),
        menge: 1,
      });
      await fuelle(api, 'post', pfad, { material_id: posten('Beleuchtungssatz'), menge: 2 });
      const rucksack = await fuelle<EinsatzMaterial>(api, 'post', pfad, {
        material_id: posten('Sanitätsrucksack'),
        menge: 4,
      });
      await fuelle(api, 'post', pfad, {
        adhoc: { bezeichnung: 'Spende-Decken', kategorie: 'Verbrauchsgut' },
        menge: 50,
      });
      await fuelle(api, 'patch', `${pfad}/${strom.id}`, {
        status: 'defekt',
        bemerkung: 'Zündung defekt',
      });
      await fuelle(api, 'patch', `${pfad}/${rucksack.id}`, { status: 'im_einsatz' });
    } finally {
      await api.dispose();
    }
  });

  test('Material im Einsatz', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/material`);
    await expect(page.getByText('Spende-Decken').first()).toBeVisible();
    await fotografiere(page, KAPITEL, 'material');
  });

  test('Dialog „Material disponieren“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/material`);
    await page.getByRole('button', { name: 'Material disponieren' }).click();
    const dialog = page.getByRole('dialog', { name: 'Material disponieren' });
    // Demo-Stammdaten stehen mit Marke in eigener Gruppe; ihre Option trägt keinen Titel, der
    // Klick geht deshalb über den Text der Option (`stammdaten/demoAuswahl.tsx`).
    const feld = dialog.getByRole('combobox', { name: 'Material' });
    await feld.click();
    const liste = await stehendeAuswahl(page);
    await liste.locator('.ant-select-item-option', { hasText: 'Feldbettensatz' }).click();
    await expect(dialog.getByText(/^Feldbettensatz/)).toBeVisible();
    await dialog.getByRole('spinbutton', { name: 'Menge' }).fill('2');
    await dialog.getByRole('spinbutton', { name: 'Menge' }).blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'material-disponieren');
  });

  test('Dialog „Ad-hoc-Material ohne Stammeintrag“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/material`);
    await page.getByRole('button', { name: 'Ad-hoc-Material' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ad-hoc-Material ohne Stammeintrag' });
    await dialog.getByLabel('Bezeichnung').fill('Sandsäcke');
    await dialog.getByRole('spinbutton', { name: 'Menge' }).fill('200');
    await dialog.getByLabel('Kategorie').fill('Verbrauchsgut');
    await dialog.getByLabel('Trägerorganisation').fill('THW');
    await dialog.getByLabel('Trägerorganisation').blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'adhoc-material');
  });
});
