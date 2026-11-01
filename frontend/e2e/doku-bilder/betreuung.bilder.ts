import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Betreuung“ (`docs/anwender/kapitel/betreuung.md`). Die Bezirke hat seit
 * LLH-1034 das Kapitel „Evakuierung“ (`evakuierung.bilder.ts`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder e2e/doku-bilder/betreuung.bilder.ts`, Mitänderungsregel in
 * `docs/anwender/AGENTS.md`; `--grep betreuung` träfe auch `geraet-betreuungsstelle`):
 *   uebersicht.png       frontend/src/pages/BetreuungPage.tsx, frontend/src/betreuung/StellenBlock.tsx,
 *                        frontend/src/betreuung/UnterbringungKennzahlen.tsx
 *   belegung-melden.png  frontend/src/betreuung/BetreuungDialoge.tsx
 *   stelle.png           frontend/src/pages/BetreuungsstelleDetailPage.tsx,
 *                        frontend/src/betreuung/StelleBelegung.tsx,
 *                        frontend/src/betreuung/StelleBelegungslinie.tsx
 *
 * Daten: der Demo-Einsatz hat eine Betreuungsstelle. Eine fast volle Notunterkunft kommt per API
 * dazu (D3), damit die Auslastung zu sehen ist.
 */

const KAPITEL = 'betreuung';

interface Uebersicht {
  stellen: { id: number; bezeichnung: string }[];
}

/** Ergänzt die Demo-Lage einmal je Lauf (die Datenbank gilt für alle Tests eines Laufs). */
async function lageErgaenzen(page: Page, einsatzId: number): Promise<number> {
  const basis = `/api/einsaetze/${einsatzId}/betreuung`;
  const lage = (await (await page.request.get(basis)).json()) as Uebersicht;
  if (!lage.stellen.some((s) => s.bezeichnung === 'Sporthalle Nord')) {
    const stelle = await fuelle<{ id: number }>(page, 'post', `${basis}/stellen`, {
      bezeichnung: 'Sporthalle Nord',
      art: 'notunterkunft',
      kapazitaet_personen: 80,
      standort: 'Nordring 4',
      leitung: 'Hallenwart Meyer',
      kontaktweg: 'Kanal 3',
    });
    await fuelle(page, 'patch', `${basis}/stellen/${stelle.id}`, { status: 'in_betrieb' });
    // Zwei frühere Meldungen, damit die Seite der Stelle den Belegungsverlauf zeigt (LLH-1347).
    const vor = (min: number) =>
      new Date(Date.now() - min * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    for (const [belegt, min] of [
      [30, 180],
      [55, 90],
    ] as const) {
      await fuelle(page, 'post', `${basis}/stellen/${stelle.id}/belegungen`, {
        belegt,
        zeitpunkt_at: vor(min),
      });
    }
    await fuelle(page, 'post', `${basis}/stellen/${stelle.id}/belegungen`, { belegt: 74 });
    return stelle.id;
  }
  return lage.stellen.find((s) => s.bezeichnung === 'Sporthalle Nord')!.id;
}

test.describe(KAPITEL, () => {
  test('Übersicht mit Betreuungsstellen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await lageErgaenzen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/betreuung`);
    await expect(
      page.getByRole('button', { name: 'Belegung melden für Sporthalle Nord' }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Unterbringung in Zahlen' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'uebersicht');
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

  test('Seite einer Betreuungsstelle', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const stelle = await lageErgaenzen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/betreuung/${stelle}`);
    await expect(page.getByRole('group', { name: 'Belegung in Zahlen' })).toContainText('74');
    await expect(page.getByText('Hallenwart Meyer')).toBeVisible();
    await expect(page.locator('[data-lfh="stelle-belegungslinie"]')).toBeVisible();
    await fotografiere(page, KAPITEL, 'stelle');
  });
});
