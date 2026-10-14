import type { APIRequestContext } from '@playwright/test';
import { offeneAuswahl, stehendeAuswahl, waehleStehend } from '../auswahl-kern';
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
 * Bilder des Kapitels „Personal“ (`docs/anwender/kapitel/personal.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep personal`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   personal.png         frontend/src/pages/PersonalPage.tsx, frontend/src/components/Datensicht.tsx,
 *                        frontend/src/kraefte/EinsatzfunktionZelle.tsx, frontend/src/kraefte/EinheitAngabe.tsx,
 *                        frontend/src/kraefte/FahrzeugAngabe.tsx, frontend/src/kraefte/PositionAngabe.tsx,
 *                        frontend/src/kraefte/einteilungKern.ts (Gruppen nach Einheit)
 *   einteilen.png        frontend/src/pages/PersonalPage.tsx (Zeile), frontend/src/kraefte/EinheitAngabe.tsx,
 *                        frontend/src/components/InlineAngabe.tsx
 *   personal-disponieren.png frontend/src/kraefte/PersonalDisponierenModal.tsx,
 *                        frontend/src/kraefte/SammelGruende.tsx
 *   adhoc-person.png     frontend/src/kraefte/AdhocPersonModal.tsx
 *   ansicht.png          frontend/src/pages/EinsatzkraftPage.tsx
 *   zeitachse-person.png frontend/src/pages/EinsatzkraftPage.tsx (Paneel „Zeitachse“),
 *                        frontend/src/kraefte/KraftZeitachse.tsx
 *   entlassen.png        frontend/src/kraefte/EntlassenBlock.tsx (Block unter der Liste)
 *
 * Demo-Lücke (D3): die Demo-Daten tragen keine Ereignisse der Kräfte-Zeitachse. Die Spec trägt
 * Alarmierung und Eintreffen der Rettungsstaffel nach (gilt für ihre vier Personen) und für
 * Lena Beispiel Eintreffen und Entlassung, damit „Einsatzdauer“ und „Ruhe“ etwas zeigen. Für
 * den Block „Entlassen“ disponiert sie eine Ad-hoc-Kraft und entlässt sie (LLH-1079). Für den
 * Dialog „Personal disponieren“ legt sie drei Stamm-Personen an, die noch nicht im Einsatz sind
 * (LLH-1100): die Demo-Personen sind alle disponiert. Anna Probe bekommt die Einsatzfunktion
 * „Sprechfunker“, damit die Spalte „Funktion“ beide Angaben zeigt (LLH-1067). Für die Gruppe
 * „nicht eingeteilt“ und das Einteilen disponiert sie die Ad-hoc-Kraft Tim Neu ohne Einheit
 * (LLH-1060).
 */

const KAPITEL = 'personal';
/** Ad-hoc-Kraft ohne Einheit: trägt die Gruppe „nicht eingeteilt“ und das Bild „einteilen“. */
const OHNE_EINHEIT = 'Tim Neu';

/** Stamm-Personen für den Dialog „Personal disponieren“, nicht im Demo-Einsatz. */
const NEUE_STAMMKRAEFTE = [
  { name: 'Jana Neumann', personalnummer: '2041', traegerorganisation: 'DRK Musterstadt' },
  { name: 'Ole Hansen', personalnummer: '2042', traegerorganisation: 'DRK Musterstadt' },
  { name: 'Mira Kraus', personalnummer: '2043', traegerorganisation: 'DRK Musterstadt' },
];

interface Einheit {
  id: number;
  name: string;
}
interface Person {
  id: number;
  name: string;
}

/** Drahtformat des Servers: UTC ohne Zonenkennung. */
function draht(zeit: Date): string {
  return zeit.toISOString().slice(0, 19).replace('T', ' ');
}

function vor(basis: Date, minuten: number): Date {
  return new Date(basis.getTime() - minuten * 60_000);
}

async function personNamens(api: APIRequestContext, einsatzId: number, name: string) {
  const antwort = await api.get(`/api/einsaetze/${einsatzId}/personal`);
  expect(antwort.ok(), `Personal: ${antwort.status()}`).toBe(true);
  const person = ((await antwort.json()) as Person[]).find((p) => p.name === name);
  expect(person, `Person „${name}“ im Demo-Einsatz`).toBeDefined();
  return person!;
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    try {
      const demo = await demoEinsatz(api);
      const jetzt = new Date();
      const einheiten = await api.get(`/api/einsaetze/${demo.id}/einheiten`);
      expect(einheiten.ok(), `Einheiten: ${einheiten.status()}`).toBe(true);
      const rettung = ((await einheiten.json()) as Einheit[]).find(
        (e) => e.name === 'Rettungsstaffel',
      );
      expect(rettung, 'Rettungsstaffel im Demo-Einsatz').toBeDefined();
      const einheitPfad = `/api/einsaetze/${demo.id}/einheiten/${rettung!.id}/zeitachse`;
      await fuelle(api, 'post', einheitPfad, {
        art: 'alarmierung',
        zeitpunkt_at: draht(vor(jetzt, 287)),
      });
      await fuelle(api, 'post', einheitPfad, {
        art: 'eintreffen',
        zeitpunkt_at: draht(vor(jetzt, 271)),
      });

      const lena = await personNamens(api, demo.id, 'Lena Beispiel');
      const personPfad = `/api/einsaetze/${demo.id}/personal/${lena.id}/zeitachse`;
      await fuelle(api, 'post', personPfad, {
        art: 'eintreffen',
        zeitpunkt_at: draht(vor(jetzt, 280)),
      });
      await fuelle(api, 'post', personPfad, {
        art: 'entlassung',
        zeitpunkt_at: draht(vor(jetzt, 40)),
        notiz: 'Dienstende',
      });

      const anna = await personNamens(api, demo.id, 'Anna Probe');
      await fuelle(api, 'patch', `/api/einsaetze/${demo.id}/personal/${anna.id}`, {
        einsatzfunktion: 'Sprechfunker',
      });

      const weg = await fuelle<Person>(api, 'post', `/api/einsaetze/${demo.id}/personal`, {
        adhoc: { name: 'Paul Muster', funktion: 'Sanitäter' },
      });
      await fuelle(api, 'post', `/api/einsaetze/${demo.id}/personal/${weg.id}/entlassen`);
      await fuelle(api, 'post', `/api/einsaetze/${demo.id}/personal`, {
        adhoc: { name: OHNE_EINHEIT, funktion: 'Helfer' },
      });

      for (const kraft of NEUE_STAMMKRAEFTE) await fuelle(api, 'post', '/api/personal', kraft);
    } finally {
      await api.dispose();
    }
  });

  test('Personal im Einsatz', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personal`);
    const region = page.getByRole('region', { name: 'Personal im Einsatz', exact: true });
    await expect(region.getByRole('link', { name: 'Anna Probe' })).toBeVisible();
    // Gruppen erst mit der Einheitenliste, Dauer erst mit den Perioden.
    await expect(region.getByText(/nicht eingeteilt/).first()).toBeVisible();
    await expect(region.getByText('4 h 47').first()).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, 'personal');
  });

  test('Eine Person einteilen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personal`);
    const region = page.getByRole('region', { name: 'Personal im Einsatz', exact: true });
    await region.getByRole('button', { name: `Einheit zu ${OHNE_EINHEIT} eintragen` }).click();
    await region.getByRole('combobox', { name: `Einheit zu ${OHNE_EINHEIT}` }).click();
    await waehleStehend(page, 'Rettungsstaffel');
    await expect(offeneAuswahl(page)).toHaveCount(0);
    const zeile = region.locator('tr.ant-table-row').filter({ hasText: OHNE_EINHEIT });
    await expect(
      zeile.getByRole('button', { name: `Einheit zu ${OHNE_EINHEIT} speichern` }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(zeile, KAPITEL, 'einteilen');
  });

  test('Dialog „Personal disponieren“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personal`);
    await page.getByRole('button', { name: 'Personal disponieren' }).click();
    const dialog = page.getByRole('dialog', { name: 'Personal disponieren' });
    const titel = dialog.locator('.ant-modal-title');
    const personen = dialog.getByRole('combobox', { name: 'Personen' });
    for (const kraft of NEUE_STAMMKRAEFTE.slice(0, 2)) {
      await personen.click();
      await personen.fill(kraft.name);
      await waehleStehend(page, `${kraft.name} (${kraft.personalnummer})`);
    }
    await titel.click();
    await expect(offeneAuswahl(page)).toHaveCount(0);
    await dialog.getByRole('combobox', { name: 'In Einheit' }).click();
    await waehleStehend(page, 'Rettungsstaffel');
    // Das erste Fahrzeug der Rettungsstaffel, wie es die Demo-Daten führen.
    await dialog.getByRole('combobox', { name: 'Auf Fahrzeug' }).click();
    await (await stehendeAuswahl(page)).locator('.ant-select-item-option').first().click();
    await titel.click();
    await expect(offeneAuswahl(page)).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'personal-disponieren');
  });

  test('Dialog „Ad-hoc-Person disponieren“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personal`);
    await page.getByRole('button', { name: 'Ad-hoc-Person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ad-hoc-Person disponieren' });
    await dialog.getByLabel('Name').fill('Dr. Schmidt');
    await dialog.getByLabel('Qualifikation').fill('Notarzt');
    await dialog.getByLabel('Trägerorganisation').fill('KV Musterstadt');
    await dialog.getByLabel('Trägerorganisation').blur();
    await page.mouse.move(0, 0);
    // Erst nach dem Aufzieh-Übergang fotografieren, sonst trifft die Aufnahme den halben Dialog.
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'adhoc-person');
  });

  test('Ansicht einer Person', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personal`);
    await page
      .getByRole('region', { name: 'Personal im Einsatz', exact: true })
      .getByRole('link', { name: 'Anna Probe' })
      .click();
    await expect(page.getByRole('heading', { name: /Anna Probe/, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Einheit bearbeiten' })).toBeVisible();
    await expect(page.locator('[data-lfh="zeitachse-ereignis"]').first()).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, 'ansicht');
  });

  test('Zeitachse einer Person', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    const lena = await personNamens(page.request, demo.id, 'Lena Beispiel');
    await page.goto(`/einsaetze/${demo.id}/personal/${lena.id}`);
    const paneel = page
      .getByRole('main')
      .locator('[data-lfh="paneel"]')
      .filter({ has: page.getByRole('heading', { name: 'Zeitachse', exact: true }) });
    await expect(paneel.locator('[data-lfh="zeitachse-ereignis"]')).toHaveCount(2);
    await page.mouse.move(0, 0);
    await fotografiere(paneel, KAPITEL, 'zeitachse-person');
  });

  test('Block „Entlassen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personal`);
    const block = page.locator('[data-lfh="entlassen-block"]');
    await block.getByText('Entlassen (1)').click();
    await expect(
      block.getByRole('button', { name: 'Erneut disponieren: Paul Muster' }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(block, KAPITEL, 'entlassen');
  });
});
