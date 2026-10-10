import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Betreuung und Evakuierung“ (`docs/anwender/kapitel/betreuung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep betreuung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   uebersicht.png       frontend/src/pages/BetreuungPage.tsx, frontend/src/betreuung/EvakuierungBlock.tsx,
 *                        frontend/src/betreuung/StellenBlock.tsx
 *   bezirk-anlegen.png   frontend/src/betreuung/BetreuungDialoge.tsx
 *   stand-melden.png     frontend/src/betreuung/BetreuungDialoge.tsx
 *   belegung-melden.png  frontend/src/betreuung/BetreuungDialoge.tsx
 *
 * Daten: der Demo-Einsatz hat einen Bezirk und eine Betreuungsstelle. Ein zweiter, geräumter Bezirk
 * und eine fast volle Notunterkunft kommen per API dazu (D3), damit Räumung und Auslastung zu sehen
 * sind.
 */

const KAPITEL = 'betreuung';

interface Uebersicht {
  bezirke: { id: number; bezeichnung: string }[];
  stellen: { id: number; bezeichnung: string }[];
}

/** Ergänzt die Demo-Lage einmal je Lauf (die Datenbank gilt für alle Tests eines Laufs). */
async function lageErgaenzen(page: Page, einsatzId: number): Promise<void> {
  const basis = `/api/einsaetze/${einsatzId}/betreuung`;
  const lage = (await (await page.request.get(basis)).json()) as Uebersicht;
  if (!lage.bezirke.some((b) => b.bezeichnung === 'Uferstraße 2–18')) {
    const bezirk = await fuelle<{ id: number }>(page, 'post', `${basis}/bezirke`, {
      bezeichnung: 'Uferstraße 2–18',
      plan_personen: 64,
      plan_erhebung: 'gezaehlt',
      sammelstelle: 'Parkplatz Uferstraße',
    });
    await fuelle(page, 'patch', `${basis}/bezirke/${bezirk.id}`, { raeumung: 'laeuft' });
    await fuelle(page, 'post', `${basis}/bezirke/${bezirk.id}/staende`, {
      evakuiert: 64,
      erhebung: 'gezaehlt',
    });
    await fuelle(page, 'patch', `${basis}/bezirke/${bezirk.id}`, { raeumung: 'geraeumt' });
  }
  if (!lage.stellen.some((s) => s.bezeichnung === 'Sporthalle Nord')) {
    const stelle = await fuelle<{ id: number }>(page, 'post', `${basis}/stellen`, {
      bezeichnung: 'Sporthalle Nord',
      art: 'notunterkunft',
      kapazitaet_personen: 80,
      standort: 'Nordring 4',
    });
    await fuelle(page, 'patch', `${basis}/stellen/${stelle.id}`, { status: 'in_betrieb' });
    await fuelle(page, 'post', `${basis}/stellen/${stelle.id}/belegungen`, { belegt: 74 });
  }
}

test.describe(KAPITEL, () => {
  test('Übersicht mit Evakuierungsbezirken und Betreuungsstellen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await lageErgaenzen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/betreuung`);
    await expect(page.getByText('Uferstraße 2–18').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Belegung melden für Sporthalle Nord' }),
    ).toBeVisible();
    await fotografiere(page, KAPITEL, 'uebersicht');
  });

  test('Dialog „Evakuierungsbezirk anlegen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/betreuung`);
    await page.getByRole('button', { name: 'Evakuierungsbezirk anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
    await dialog.getByLabel('Bezeichnung').fill('Lindenstraße 1–20');
    await dialog.getByLabel('Plangröße (Personen)').fill('85');
    await dialog.getByRole('button', { name: 'Weitere Angaben' }).click();
    await dialog.getByLabel('Sammelstelle').fill('Bushaltestelle Lindenplatz');
    await dialog.getByLabel('Sammelstelle').blur();
    await fotografiere(dialog, KAPITEL, 'bezirk-anlegen');
  });

  test('Dialog „Stand melden“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/betreuung`);
    await page.getByRole('button', { name: 'Stand melden für Bezirk Mühlbachweg 1–40' }).click();
    const dialog = page.getByRole('dialog', { name: 'Stand melden: Mühlbachweg 1–40' });
    await dialog.getByLabel('Evakuiert gesamt (Personen)').fill('104');
    await dialog.getByLabel('Evakuiert gesamt (Personen)').blur();
    await fotografiere(dialog, KAPITEL, 'stand-melden');
  });

  test('Dialog „Belegung melden“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/betreuung`);
    await page.getByRole('button', { name: 'Belegung melden für Gesamtschule' }).click();
    const dialog = page.getByRole('dialog', { name: 'Belegung melden: Gesamtschule' });
    await dialog.getByLabel('Belegt gesamt (Personen)').fill('82');
    await dialog.getByLabel('Belegt gesamt (Personen)').blur();
    await fotografiere(dialog, KAPITEL, 'belegung-melden');
  });
});
