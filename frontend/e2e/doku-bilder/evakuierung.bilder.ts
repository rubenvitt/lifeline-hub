import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Evakuierung“ (`docs/anwender/kapitel/evakuierung.md`, LLH-1034).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep evakuierung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   uebersicht.png       frontend/src/pages/EvakuierungPage.tsx,
 *                        frontend/src/betreuung/EvakuierungKennzahlen.tsx,
 *                        frontend/src/betreuung/BezirkTabelle.tsx
 *   bezirk-anlegen.png   frontend/src/betreuung/BetreuungDialoge.tsx
 *   stand-melden.png     frontend/src/betreuung/BetreuungDialoge.tsx
 *   bezirk-detail.png    frontend/src/pages/EvakuierungsbezirkPage.tsx,
 *                        frontend/src/betreuung/BezirkKennzahlen.tsx,
 *                        frontend/src/betreuung/BezirkStammdaten.tsx,
 *                        frontend/src/betreuung/BezirkGebiet.tsx,
 *                        frontend/src/betreuung/BezirkStandlinie.tsx
 *
 * Daten: der Demo-Einsatz hat einen Bezirk. Ein zweiter, geräumter Bezirk kommt per API dazu (D3),
 * damit Räumung und Kennzahlenband zu sehen sind.
 */

const KAPITEL = 'evakuierung';

interface Uebersicht {
  bezirke: { id: number; bezeichnung: string }[];
}

/** Ergänzt die Demo-Lage einmal je Lauf (die Datenbank gilt für alle Tests eines Laufs). */
async function lageErgaenzen(page: Page, einsatzId: number): Promise<void> {
  const basis = `/api/einsaetze/${einsatzId}/evakuierung`;
  const lage = (await (await page.request.get(basis)).json()) as Uebersicht;
  if (!lage.bezirke.some((b) => b.bezeichnung === 'Uferstraße 2–18')) {
    const bezirk = await fuelle<{ id: number }>(page, 'post', `${basis}/bezirke`, {
      bezeichnung: 'Uferstraße 2–18',
      plan_personen: 64,
      plan_erhebung: 'gezaehlt',
      sammelstelle: 'Parkplatz Uferstraße',
    });
    await fuelle(page, 'patch', `${basis}/bezirke/${bezirk.id}`, { raeumung: 'laeuft' });
    // Eine frühere Meldung, damit die Detailseite eine Stufenlinie zeigt (LLH-1076).
    const frueher = new Date(Date.now() - 45 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    await fuelle(page, 'post', `${basis}/bezirke/${bezirk.id}/staende`, {
      evakuiert: 30,
      erhebung: 'geschaetzt',
      zeitpunkt_at: frueher,
    });
    await fuelle(page, 'post', `${basis}/bezirke/${bezirk.id}/staende`, {
      evakuiert: 64,
      erhebung: 'gezaehlt',
    });
    await fuelle(page, 'patch', `${basis}/bezirke/${bezirk.id}`, { raeumung: 'geraeumt' });
  }
}

test.describe(KAPITEL, () => {
  test('Übersicht mit Kennzahlenband und Bezirkstabelle', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await lageErgaenzen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/evakuierung`);
    await expect(page.getByText('Uferstraße 2–18').first()).toBeVisible();
    await expect(page.getByRole('group', { name: 'Räumung in Zahlen' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'uebersicht');
  });

  test('Dialog „Evakuierungsbezirk anlegen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/evakuierung`);
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
    await page.goto(`/einsaetze/${demo.id}/evakuierung`);
    await page.getByRole('button', { name: 'Stand melden für Bezirk Mühlbachweg 1–40' }).click();
    const dialog = page.getByRole('dialog', { name: 'Stand melden: Mühlbachweg 1–40' });
    await dialog.getByLabel('Evakuiert gesamt (Personen)').fill('104');
    await dialog.getByLabel('Evakuiert gesamt (Personen)').blur();
    await fotografiere(dialog, KAPITEL, 'stand-melden');
  });

  test('Detailseite eines Bezirks', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await lageErgaenzen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/evakuierung`);
    await page.getByRole('link', { name: 'Uferstraße 2–18' }).click();
    await expect(page.getByRole('group', { name: 'Bezirk in Zahlen' })).toBeVisible();
    await expect(page.locator('[data-lfh="bezirk-standlinie"]')).toBeVisible();
    await fotografiere(page, KAPITEL, 'bezirk-detail');
  });
});
