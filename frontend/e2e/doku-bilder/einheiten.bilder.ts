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
 *   gliederung.png      frontend/src/pages/EinheitenPage.tsx (Paneel „Gliederung“)
 *   einheit-bilden.png  frontend/src/pages/EinheitenPage.tsx (Dialog „Einheit bilden“)
 *   personal.png        frontend/src/pages/EinheitDetailPage.tsx (Paneel „Personal“)
 *
 * Demo-Lücke (D3): die Demo-Einheiten stehen alle auf einer Ebene und haben keinen
 * Einheitsführer. Die Spec unterstellt die Rettungsstaffel dem Sanitätszug und setzt Anna Probe
 * als ihre Einheitsführerin.
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
    } finally {
      await api.dispose();
    }
  });

  test('Gliederung der Einheiten', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einheiten`);
    const paneel = page.getByRole('region', { name: 'Gliederung' });
    await expect(paneel.getByRole('link', { name: 'Rettungsstaffel' })).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'gliederung');
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
});
