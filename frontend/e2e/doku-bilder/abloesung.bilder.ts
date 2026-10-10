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
 * Bilder des Kapitels „Ablösung“ (`docs/anwender/kapitel/abloesung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep abloesung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   schichten.png        frontend/src/pages/AbloesungPage.tsx, frontend/src/abloesung/AbloesungKarte.tsx
 *   schicht-beginnen.png frontend/src/abloesung/AbloesungDialoge.tsx (`SchichtBeginnenDialog`)
 *   vollziehen.png       frontend/src/abloesung/AbloesungDialoge.tsx (Vollzugsdialog)
 *   vorgaben.png         frontend/src/pages/AbloesungPage.tsx (Paneel „Rhythmus je Abschnitt“)
 *
 * Demo-Lücke (D3): die Demo-Daten tragen keine Schichten. Die Spec setzt am Abschnitt
 * „Sanitätsdienst“ die Vorgabe 6 h, bildet eine „2. Rettungsstaffel“ als Ablöser und beginnt drei
 * Schichten: eine überfällige, eine in der Vorwarnzeit und eine planmäßige mit eigenem Rhythmus.
 */

const KAPITEL = 'abloesung';

interface Einheit {
  id: number;
  name: string;
}
interface Vorgabe {
  abschnitt_id: number;
  abschnitt_name: string;
}
interface Schicht {
  id: number;
}

/** Drahtformat des Servers: UTC ohne Zonenkennung. */
function draht(zeit: Date): string {
  return zeit.toISOString().slice(0, 19).replace('T', ' ');
}

function vor(basis: Date, minuten: number): Date {
  return new Date(basis.getTime() - minuten * 60_000);
}

async function liste<T>(api: APIRequestContext, pfad: string): Promise<T[]> {
  const antwort = await api.get(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
  return (await antwort.json()) as T[];
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    try {
      const demo = await demoEinsatz(api);
      const basis = `/api/einsaetze/${demo.id}`;
      const jetzt = new Date();
      const einheiten = await liste<Einheit>(api, `${basis}/einheiten`);
      const einheit = (name: string) => {
        const e = einheiten.find((x) => x.name === name);
        expect(e, `Einheit „${name}“`).toBeDefined();
        return e!.id;
      };
      const vorgaben = await liste<Vorgabe>(api, `${basis}/abloesungen/vorgaben`);
      const sanitaetsdienst = vorgaben.find((v) => v.abschnitt_name === 'Sanitätsdienst');
      expect(sanitaetsdienst, 'Abschnitt „Sanitätsdienst“').toBeDefined();
      await fuelle(api, 'put', `${basis}/abloesungen/vorgaben/${sanitaetsdienst!.abschnitt_id}`, {
        rhythmus_minuten: 360,
      });
      const abloeser = await fuelle<Einheit>(api, 'post', `${basis}/einheiten`, {
        name: '2. Rettungsstaffel',
      });

      const rettung = await fuelle<Schicht>(api, 'post', `${basis}/abloesungen`, {
        einheit_id: einheit('Rettungsstaffel'),
        beginn_at: draht(vor(jetzt, 380)),
      });
      await fuelle(api, 'patch', `${basis}/abloesungen/${rettung.id}`, {
        abloesende_einheit_id: abloeser.id,
      });
      await fuelle(api, 'post', `${basis}/abloesungen`, {
        einheit_id: einheit('Sanitätszug Musterstadt'),
        beginn_at: draht(vor(jetzt, 340)),
      });
      await fuelle(api, 'post', `${basis}/abloesungen`, {
        einheit_id: einheit('Sanitätsgruppe UHS'),
        beginn_at: draht(vor(jetzt, 240)),
        rhythmus_minuten: 480,
      });
    } finally {
      await api.dispose();
    }
  });

  test('Laufende Schichten', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    const schichten = page.getByRole('region', { name: 'Laufende Schichten' });
    await expect(schichten.locator('[data-lfh="abloesung-karte"]')).toHaveCount(3);
    await fotografiere(schichten, KAPITEL, 'schichten');
  });

  test('Paneel „Rhythmus je Abschnitt“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    const paneel = page.getByRole('region', { name: 'Rhythmus je Abschnitt' });
    await expect(paneel.getByText('Rhythmus 6 h · 2 laufend')).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'vorgaben');
  });

  test('Dialog „Schicht beginnen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    await page.getByRole('button', { name: 'Schicht beginnen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Schicht beginnen' });
    await waehleIn(dialog.getByRole('combobox', { name: 'Einheit' }), 'Betreuungsgruppe');
    await dialog.getByRole('spinbutton', { name: 'Rhythmus (Stunden)' }).fill('8');
    await dialog.getByRole('spinbutton', { name: 'Rhythmus (Stunden)' }).blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'schicht-beginnen');
  });

  test('Dialog „Ablösung vollziehen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    const karte = page.getByRole('article', { name: 'Schicht Rettungsstaffel' });
    await karte.getByRole('button', { name: 'Ablösung vollziehen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ablösung Rettungsstaffel vollziehen' });
    await expect(dialog.getByTitle('2. Rettungsstaffel', { exact: true })).toBeVisible();
    // Der Dialog setzt den Fokus ins erste Feld; das Bild soll keinen Fokusrahmen zeigen.
    await dialog.getByRole('combobox', { name: 'Ablösende Einheit' }).blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'vollziehen');
  });
});
