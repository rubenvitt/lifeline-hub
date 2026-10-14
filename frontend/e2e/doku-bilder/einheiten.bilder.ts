import type { APIRequestContext } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
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
 * Bilder des Kapitels „Einheiten“ (`docs/anwender/kapitel/einheiten.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einheiten`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   gliederung.png      frontend/src/pages/EinheitenPage.tsx (Tabelle „Gliederung“,
 *                       frontend/src/kraefte/KraeftebaumZelle.tsx, components/Datensicht.tsx)
 *   einheit-bilden.png  frontend/src/pages/EinheitenPage.tsx (Dialog „Einheit bilden“ mit dem
 *                       Feld „Vorlage“)
 *   vorlage-bilden.png  frontend/src/pages/EinheitAusVorlagePage.tsx (Seite „Einheit aus Vorlage
 *                       bilden“: Kopf, Baum der Vorlage, Aktion mit Zusammenfassung;
 *                       frontend/src/components/Erfassung.tsx)
 *   personal.png        frontend/src/pages/EinheitDetailPage.tsx (Paneel „Personal“)
 *   aufgeloest.png      frontend/src/kraefte/EntlassenBlock.tsx (Block unter der Gliederung)
 *
 * Demo-Lücke (D3): die Demo-Einheiten stehen alle auf einer Ebene und haben keinen
 * Einheitsführer. Die Spec unterstellt die Rettungsstaffel dem Sanitätszug und setzt Anna Probe
 * als ihre Einheitsführerin. Für den Block „Aufgelöst“ bildet sie eine Einheit, gibt ihr eine
 * Alarmierung (eine Spur, sonst löschte das Auflösen sie ganz) und löst sie auf (LLH-1079).
 * Die Vorschau zeigt die Demo-Vorlage „Sanitätszug Musterstadt“ gegen den Demo-Einsatz, in dem
 * ihre Kräfte schon den gleichnamigen Einheiten angehören: die Zeilen tragen „in «…»“ und
 * „umhängen aus «…»“, das Namensfeld „Name schon vergeben“. Die Spec hakt RTW „Musterstadt 83-1“
 * und Anna Probe an (LLH-1049).
 */

const KAPITEL = 'einheiten';

interface Einheit {
  id: number;
  name: string;
}
interface Person {
  id: number;
  name: string;
}

async function einheitNamens(api: APIRequestContext, einsatzId: number, name: string) {
  const antwort = await api.get(`/api/einsaetze/${einsatzId}/einheiten`);
  expect(antwort.ok(), `Einheiten: ${antwort.status()}`).toBe(true);
  const einheit = ((await antwort.json()) as Einheit[]).find((e) => e.name === name);
  expect(einheit, `Einheit „${name}“ im Demo-Einsatz`).toBeDefined();
  return einheit!;
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    try {
      const demo = await demoEinsatz(api);
      const zug = await einheitNamens(api, demo.id, 'Sanitätszug Musterstadt');
      const rettung = await einheitNamens(api, demo.id, 'Rettungsstaffel');
      const personal = await api.get(`/api/einsaetze/${demo.id}/personal`);
      expect(personal.ok(), `Personal: ${personal.status()}`).toBe(true);
      const anna = ((await personal.json()) as Person[]).find((p) => p.name === 'Anna Probe');
      expect(anna, 'Anna Probe im Demo-Einsatz').toBeDefined();
      await fuelle(api, 'patch', `/api/einsaetze/${demo.id}/einheiten/${rettung.id}`, {
        ueber_einheit_id: zug.id,
        fuehrer_id: anna!.id,
      });

      const alt = await fuelle<Einheit>(api, 'post', `/api/einsaetze/${demo.id}/einheiten`, {
        name: 'Erkundungstrupp',
      });
      await fuelle(api, 'post', `/api/einsaetze/${demo.id}/einheiten/${alt.id}/zeitachse`, {
        art: 'alarmierung',
        zeitpunkt_at: new Date(Date.now() - 90 * 60_000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' '),
      });
      await fuelle(api, 'delete', `/api/einsaetze/${demo.id}/einheiten/${alt.id}`);
    } finally {
      await api.dispose();
    }
  });

  test('Gliederung der Einheiten', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einheiten`);
    const tabelle = page.getByRole('region', { name: 'Gliederung' });
    await expect(tabelle.getByRole('link', { name: 'Rettungsstaffel' })).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(tabelle, KAPITEL, 'gliederung');
  });

  test('Dialog „Einheit bilden“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einheiten`);
    await page.getByRole('button', { name: 'Einheit bilden' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Einheit bilden' });
    await dialog.getByLabel('Name').fill('2. Zug');
    await waehleIn(dialog.getByRole('combobox', { name: 'Typ' }), 'Zug');
    await dialog.getByRole('combobox', { name: 'Typ' }).blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'einheit-bilden');
  });

  test('Seite „Einheit aus Vorlage bilden“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const vorlagen = await page.request.get('/api/einheit-vorlagen');
    expect(vorlagen.ok(), `Vorlagen: ${vorlagen.status()}`).toBe(true);
    const zug = ((await vorlagen.json()) as { id: number; name: string }[]).find(
      (v) => v.name === 'Sanitätszug Musterstadt',
    );
    expect(zug, 'Demo-Vorlage „Sanitätszug Musterstadt“').toBeDefined();
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einheiten/aus-vorlage/${zug!.id}`);
    const formular = page.getByRole('main').locator('form');
    await expect(formular.getByRole('heading', { name: 'Rettungsstaffel' })).toBeVisible();
    await expect(formular.getByRole('checkbox').first()).toBeVisible();
    // Ein RTW samt einer Person umgehängt: das Bild zeigt gesetzte Häkchen und die Zählung.
    await formular.getByRole('checkbox', { name: /^Musterstadt 83-1/ }).check();
    await formular.getByRole('checkbox', { name: /^Anna Probe/ }).check();
    await expect(formular.getByText(/1 Fahrzeug, 1 Kraft$/)).toBeVisible();
    // Ohne Fokusring im Bild.
    await formular.getByRole('checkbox', { name: /^Anna Probe/ }).blur();
    await page.mouse.move(0, 0);
    await fotografiere(formular, KAPITEL, 'vorlage-bilden');
  });

  test('Mitglieder einer Einheit', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const rettung = await einheitNamens(page.request, demo.id, 'Rettungsstaffel');
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einheiten/${rettung.id}`);
    const paneel = page.getByRole('region', { name: 'Personal' });
    await expect(paneel.getByText('Einheitsführer', { exact: true })).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'personal');
  });

  test('Block „Aufgelöst“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einheiten`);
    const block = page.locator('[data-lfh="entlassen-block"]');
    await block.getByText('Aufgelöst (1)').click();
    await expect(
      block.getByRole('list', { name: 'Aufgelöst' }).getByText('Erkundungstrupp'),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(block, KAPITEL, 'aufgeloest');
  });
});
