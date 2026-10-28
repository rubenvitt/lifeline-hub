import { stehendeAuswahl, waehleIn } from '../auswahl-kern';
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
 *   material.png              frontend/src/pages/MaterialPage.tsx (Gruppierung „Nach Ort“, Mengenzelle
 *                             mit „Ausgeben“), frontend/src/components/Datensicht.tsx,
 *                             frontend/src/components/instrument/Segmentleiste.tsx,
 *                             frontend/src/kraefte/MaterialVerdichtung.tsx,
 *                             frontend/src/kraefte/MaterialOrtAngabe.tsx,
 *                             frontend/src/kraefte/materialOrtWahl.ts,
 *                             frontend/src/kraefte/kraeftebaumKern.ts
 *   material-ausgeben.png     frontend/src/kraefte/MaterialAusgabeModal.tsx (Dialog „… ausgeben“)
 *   material-disponieren.png  frontend/src/pages/MaterialPage.tsx (Dialog „Material disponieren“,
 *                             Feld „Ort“ aus frontend/src/kraefte/materialOrtWahl.ts)
 *   adhoc-material.png        frontend/src/pages/MaterialPage.tsx (Dialog „Ad-hoc-Material ohne
 *                             Stammeintrag“ mit Feld „Art“)
 *   aus-dem-einsatz.png       frontend/src/kraefte/EntlassenBlock.tsx (Block „Aus dem Einsatz
 *                             genommen“ unter der Liste)
 *   angaben-aendern.png       frontend/src/kraefte/MaterialAngabenModal.tsx (Dialog „Angaben zu …
 *                             ändern“)
 *   aufteilen.png             frontend/src/kraefte/MaterialAufteilenModal.tsx (Dialog „… aufteilen“)
 *
 * Die Demo-Daten tragen zwei Posten im Einsatz (LLH-1230): den Sanitätsrucksack der
 * Rettungsstaffel und den Feldbettensatz der Betreuungsgruppe. Die Spec disponiert zwei weitere
 * Stammposten und einen Ad-hoc-Posten und setzt zwei Status. Damit steht jedes Demo-Gerät im
 * Einsatz; für den Dialog „Material disponieren“ legt sie deshalb ein freies Stamm-Gerät an, die
 * Zeltheizung (LLH-1487). Für den Block „Aus
 * dem Einsatz genommen“ disponiert sie einen weiteren Ad-hoc-Posten und nimmt ihn wieder heraus
 * (LLH-1079 Teil II). Für die Gruppierung „Nach Ort“ (LLH-1225) liegt der Sanitätsrucksack an der
 * ersten geplanten oder aktiven UHS und die Spende-Decken bei der ersten Einheit des
 * Demo-Einsatzes, beides über den einen Ort-Weg (PATCH der Disposition).
 */

const KAPITEL = 'material';
const ZELTHEIZUNG = 'Zeltheizung';

interface Stammmaterial {
  id: number;
  bezeichnung: string;
}
interface EinsatzMaterial {
  id: number;
  bezeichnung: string;
}
interface Einheit {
  id: number;
  name: string;
  aufgeloest_at?: string | null;
}
interface Uhs {
  id: number;
  status: string;
  storniert_at?: string | null;
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
      // Stamm-Geräte stehen je Stück im Einsatz (LLH-1224 D2): Menge 1.
      await fuelle(api, 'post', pfad, { material_id: posten('Beleuchtungssatz'), menge: 1 });
      const imEinsatz = await api.get(pfad);
      expect(imEinsatz.ok(), `Material im Einsatz: ${imEinsatz.status()}`).toBe(true);
      const rucksack = ((await imEinsatz.json()) as EinsatzMaterial[]).find(
        (m) => m.bezeichnung === 'Sanitätsrucksack',
      );
      expect(rucksack, 'Sanitätsrucksack im Demo-Einsatz').toBeDefined();
      const decken = await fuelle<EinsatzMaterial>(api, 'post', pfad, {
        adhoc: { bezeichnung: 'Spende-Decken', kategorie: 'Verbrauchsgut' },
        menge: 50,
      });
      await fuelle(api, 'patch', `${pfad}/${strom.id}`, {
        status: 'defekt',
        bemerkung: 'Zündung defekt',
      });
      await fuelle(api, 'patch', `${pfad}/${rucksack!.id}`, { status: 'im_einsatz' });
      // Ausgabe (LLH-1224 D4): 20 von 50 Decken sind ausgegeben, die Menge zeigt den Rest.
      await fuelle(api, 'patch', `${pfad}/${decken.id}`, { ausgegeben: 20 });
      // Ein Ort je Posten (LLH-1224 D6), gesetzt über den einen Weg (LLH-1225 D2).
      const einheiten = (await (
        await api.get(`/api/einsaetze/${demo.id}/einheiten`)
      ).json()) as Einheit[];
      const einheit = einheiten.find((e) => !e.aufgeloest_at);
      expect(einheit, 'Demo-Einheit').toBeDefined();
      const uhsListe = (await (await api.get(`/api/einsaetze/${demo.id}/uhs`)).json()) as Uhs[];
      const uhs = uhsListe.find(
        (u) => (u.status === 'geplant' || u.status === 'aktiv') && !u.storniert_at,
      );
      expect(uhs, 'Demo-UHS').toBeDefined();
      await fuelle(api, 'patch', `${pfad}/${decken.id}`, { einheit_id: einheit!.id });
      await fuelle(api, 'patch', `${pfad}/${rucksack!.id}`, { uhs_id: uhs!.id });
      const pavillon = await fuelle<EinsatzMaterial>(api, 'post', pfad, {
        adhoc: { bezeichnung: 'Faltpavillon 3 × 3 m', kategorie: 'Unterkunft' },
        menge: 2,
      });
      await fuelle(api, 'post', `${pfad}/${pavillon.id}/entlassen`);
      // Ein freies Gerät für den Dialog „Material disponieren“: die Demo-Geräte stehen alle im
      // Einsatz, ihre Optionen sind gesperrt (LLH-1487).
      await fuelle(api, 'post', '/api/material', {
        bezeichnung: ZELTHEIZUNG,
        kategorie: 'Betreuung',
        bestandsnummer: 'M-017',
        art: 'geraet',
      });
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
    await expect(page.getByRole('radio', { name: 'Nach Ort' })).toBeChecked();
    await page.getByRole('button', { name: 'Material disponieren' }).click();
    const dialog = page.getByRole('dialog', { name: 'Material disponieren' });
    // Die Zeltheizung ist kein Demo-Stammdatum: ihre Option trägt einen Titel, Bezeichnung und
    // Kategorie (`stammdaten/demoAuswahl.tsx`).
    await waehleIn(
      dialog.getByRole('combobox', { name: 'Material' }),
      `${ZELTHEIZUNG} (Betreuung)`,
    );
    // Ein Gerät steht je Stück im Einsatz (LLH-1224 D2): die Menge bleibt 1 und gesperrt.
    await expect(dialog.getByRole('spinbutton', { name: 'Menge' })).toBeDisabled();
    await expect(dialog.getByText('Ein Gerät steht je Stück im Einsatz')).toBeVisible();
    // Ort (LLH-1225 D7): die erste Einheit der Auswahl.
    await dialog.getByRole('combobox', { name: 'Ort' }).click();
    const orte = await stehendeAuswahl(page);
    await orte.locator('.ant-select-item-group', { hasText: 'Einheiten' }).waitFor();
    await orte
      .locator('.ant-select-item-group:has-text("Einheiten") ~ .ant-select-item-option')
      .first()
      .click();
    await expect(orte).toBeHidden();
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
    await dialog.getByLabel('Kategorie').fill('Hochwasser');
    await dialog.getByLabel('Kategorie').blur();
    // Art (LLH-1225 D6): die Vorgabe folgt der Menge.
    await expect(dialog.getByRole('radio', { name: 'Verbrauchsgut' })).toBeChecked();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'adhoc-material');
  });

  test('Block „Aus dem Einsatz genommen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/material`);
    const block = page.locator('[data-lfh="entlassen-block"]');
    await block.getByText('Aus dem Einsatz genommen (1)').click();
    await expect(
      block.getByRole('button', { name: 'Erneut disponieren: Faltpavillon 3 × 3 m' }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(block, KAPITEL, 'aus-dem-einsatz');
  });

  test('Dialog „Angaben ändern“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/material`);
    await page.getByRole('button', { name: 'Weitere Aktionen zu Spende-Decken' }).click();
    await page.getByRole('menuitem', { name: 'Angaben ändern …' }).click();
    const dialog = page.getByRole('dialog', { name: 'Angaben zu Spende-Decken ändern' });
    await expect(dialog.getByLabel('Bezeichnung')).toHaveValue('Spende-Decken');
    await dialog.getByLabel('Trägerorganisation').fill('Kleiderkammer');
    await dialog.getByLabel('Trägerorganisation').blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'angaben-aendern');
  });

  test('Dialog „Aufteilen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/material`);
    await page.getByRole('button', { name: 'Weitere Aktionen zu Spende-Decken' }).click();
    await page.getByRole('menuitem', { name: 'Aufteilen …' }).click();
    const dialog = page.getByRole('dialog', { name: 'Spende-Decken aufteilen' });
    await dialog.getByRole('spinbutton', { name: 'Menge abteilen' }).fill('20');
    await expect(dialog.getByText('Danach 30 + 20')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(300);
    await fotografiere(dialog, KAPITEL, 'aufteilen');
  });

  test('Dialog „Ausgeben“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/material`);
    await page.getByRole('button', { name: 'Spende-Decken ausgeben' }).click();
    const dialog = page.getByRole('dialog', { name: 'Spende-Decken ausgeben' });
    await dialog.getByRole('spinbutton', { name: 'Menge ausgeben' }).fill('10');
    await expect(dialog.getByTestId('ausgabe-danach')).toHaveText('Danach 20 von 50 übrig');
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(300);
    await fotografiere(dialog, KAPITEL, 'material-ausgeben');
  });
});
