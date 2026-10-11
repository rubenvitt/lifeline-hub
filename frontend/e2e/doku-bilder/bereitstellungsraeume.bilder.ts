import type { APIRequestContext } from '@playwright/test';
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
 * Bilder des Kapitels „Bereitstellungsräume“ (`docs/anwender/kapitel/bereitstellungsraeume.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep bereitstellungsraeume`, Mitänderungsregel in
 * `docs/anwender/AGENTS.md`):
 *   liste.png      frontend/src/pages/bereitstellungsraum/BereitstellungsraeumePage.tsx
 *   anlegen.png    frontend/src/pages/bereitstellungsraum/BrAnlegenDrawer.tsx,
 *                  frontend/src/components/AnlegenDrawer.tsx
 *   raum.png       frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx,
 *                  frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx,
 *                  frontend/src/pages/bereitstellungsraum/BrSwitcher.tsx
 *   bearbeiten.png frontend/src/pages/bereitstellungsraum/BrBearbeitenModal.tsx,
 *                  frontend/src/components/Erfassung.tsx
 *
 * Demo-Lücke (D3): der Demo-BR „Parkplatz Stadion Nord“ ist aktiv, aber leer. Die Spec stellt
 * dort zwei Einheiten bereit und legt einen zweiten, geplanten BR an.
 */

const KAPITEL = 'bereitstellungsraeume';
const DEMO_BR = 'Parkplatz Stadion Nord';

interface Benannt {
  id: number;
  name?: string;
  bezeichnung?: string;
}

async function liste(api: APIRequestContext, pfad: string): Promise<Benannt[]> {
  const antwort = await api.get(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
  return (await antwort.json()) as Benannt[];
}

async function demoBr(api: APIRequestContext, einsatzId: number): Promise<Benannt> {
  const raeume = await liste(api, `/api/einsaetze/${einsatzId}/bereitstellungsraeume`);
  const br = raeume.find((r) => r.bezeichnung === DEMO_BR);
  expect(br, `BR „${DEMO_BR}“ im Demo-Einsatz`).toBeDefined();
  return br!;
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    try {
      const demo = await demoEinsatz(api);
      const br = await demoBr(api, demo.id);
      const einheiten = await liste(api, `/api/einsaetze/${demo.id}/einheiten`);
      for (const name of ['Betreuungsgruppe', 'Rettungsstaffel']) {
        const einheit = einheiten.find((e) => e.name === name);
        expect(einheit, `Einheit „${name}“`).toBeDefined();
        await fuelle(
          api,
          'post',
          `/api/einsaetze/${demo.id}/bereitstellungsraeume/${br.id}/belegung`,
          { objekt_typ: 'einheit', objekt_id: einheit!.id, art: 'eintritt' },
        );
      }
      await fuelle(api, 'post', `/api/einsaetze/${demo.id}/bereitstellungsraeume`, {
        bezeichnung: 'BR Ost',
        standort: 'Sportplatz Ost, Zufahrt Parkstraße',
      });
    } finally {
      await api.dispose();
    }
  });

  test('Liste der Bereitstellungsräume', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/liste`);
    await expect(page.getByRole('link', { name: 'BR Ost' })).toBeVisible();
    await expect(page.getByRole('link', { name: DEMO_BR })).toBeVisible();
    await fotografiere(page.locator('.ant-table-wrapper').first(), KAPITEL, 'liste');
  });

  test('Drawer „Bereitstellungsraum anlegen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/liste`);
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Bereitstellungsraum anlegen' });
    await drawer.getByLabel('Bezeichnung').fill('BR Süd');
    await drawer.getByLabel('Standort (optional)').fill('Festplatz, Einfahrt Mühlenweg');
    await drawer.getByLabel('Notiz (optional)').fill('Platz für 10 Fahrzeuge');
    await drawer.getByLabel('Notiz (optional)').blur();
    await page.mouse.move(0, 0);
    await fotografiere(drawer, KAPITEL, 'anlegen');
  });

  test('Bereitstellungsraum mit Kräften', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const br = await demoBr(page.request, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/${br.id}`);
    await expect(page.getByText('Rettungsstaffel').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sanitätszug Musterstadt zuweisen' }),
    ).toBeVisible();
    await fotografiere(page, KAPITEL, 'raum');
  });

  test('Dialog „Bereitstellungsraum bearbeiten“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const br = await demoBr(page.request, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/${br.id}`);
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Bereitstellungsraum bearbeiten' });
    await expect(dialog.getByLabel('Bezeichnung')).toHaveValue(DEMO_BR);
    // Nur im Dialog, nicht gespeichert: das Bild „raum.png“ zeigt den Raum wie im Demo-Einsatz.
    await dialog.getByLabel('Notiz (optional)').fill('Zufahrt über Tor 3, Platz für 15 Fahrzeuge');
    await dialog.getByLabel('Notiz (optional)').blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'bearbeiten');
  });
});
