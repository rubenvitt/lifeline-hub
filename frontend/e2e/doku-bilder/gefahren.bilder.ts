import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Gefahren“ (`docs/anwender/kapitel/gefahren.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep gefahren`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   gefahren.png          frontend/src/pages/gefahren/GefahrenPage.tsx,
 *                         frontend/src/pages/gefahren/GefahrenMatrix.tsx,
 *                         frontend/src/pages/gefahren/GefahrenBeurteilung.tsx,
 *                         frontend/src/pages/gefahren/GefahrenErlaeuterungen.tsx (die Demo
 *                         erläutert Ertrinken × Menschen); im Seitenkopf der Nebenweg
 *                         „Drucken / als PDF“ (LLH-1364)
 *   bewertung-waehlen.png frontend/src/pages/gefahren/GefahrenMatrix.tsx (Menü einer Zelle)
 *   bewertung-details.png frontend/src/pages/gefahren/GefahrenZelleDetails.tsx (Dialog
 *                         „Erläuterung …“)
 *
 * Die Demo bewertet je Gefahrengebiet nur eine Zelle; für ein lesbares Bild ergänzt der Lauf
 * einige Bewertungen der „Überflutung Unterstadt“ über die API. Für `gefahren.png` bestätigt er
 * die Beurteilung des „Hangrutsch Kirchberg“, damit die Liste beide Zusätze zeigt („1 Gefahr ·
 * …“ und „nicht beurteilt“, LLH-1102); die „Überflutung Unterstadt“ bleibt für den Ablauf
 * „Beurteilung bestätigen“ offen.
 */

const KAPITEL = 'gefahren';

/** Füllt die Matrix der „Überflutung Unterstadt“ und gibt die Kennung des Gebiets zurück. */
async function gebietMitBewertungen(page: Page, einsatzId: number): Promise<number> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/gefahrengebiete`);
  expect(antwort.ok()).toBe(true);
  const gebiete = (await antwort.json()) as { id: number; label: string | null }[];
  const gebiet = gebiete.find((g) => g.label === 'Überflutung Unterstadt');
  expect(gebiet, 'Demo-Gefahrengebiet „Überflutung Unterstadt“ fehlt').toBeTruthy();
  const bewertungen = [
    ['ertrinken', 'einsatzkraefte', 'mittel'],
    ['elektrizitaet', 'menschen', 'mittel'],
    ['elektrizitaet', 'einsatzkraefte', 'mittel'],
    ['ausbreitung', 'umwelt', 'niedrig'],
    ['chemische_stoffe', 'umwelt', 'niedrig'],
    ['einsturz', 'sachwerte', 'niedrig'],
    ['erkrankung_verletzung', 'menschen', 'niedrig'],
  ];
  for (const [gefahrentyp, schutzobjekt, warnstufe] of bewertungen) {
    await fuelle(
      page,
      'put',
      `/api/einsaetze/${einsatzId}/gefahrengebiete/${gebiet!.id}/matrix/bewertung`,
      { gefahrentyp, schutzobjekt, warnstufe },
    );
  }
  return gebiet!.id;
}

async function oeffneGefahren(page: Page) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  const gebietId = await gebietMitBewertungen(page, demo.id);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/gefahren?gefahrengebiet=${gebietId}`);
  await expect(page.getByRole('heading', { name: 'Überflutung Unterstadt' })).toBeVisible();
  await expect(page.locator('[data-warnstufe="hoch"]').first()).toBeVisible();
}

test.describe(KAPITEL, () => {
  test('Gefahrengebiete und Matrix der Bewertung', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const gebiete = (await (
      await page.request.get(`/api/einsaetze/${demo.id}/gefahrengebiete`)
    ).json()) as { id: number; label: string | null }[];
    const hang = gebiete.find((g) => g.label === 'Hangrutsch Kirchberg');
    expect(hang, 'Demo-Gefahrengebiet „Hangrutsch Kirchberg“ fehlt').toBeTruthy();
    await fuelle(page, 'post', `/api/einsaetze/${demo.id}/gefahrengebiete/${hang!.id}/beurteilung`);
    await oeffneGefahren(page);
    await expect(page.getByText(/^1 Gefahr · /)).toBeVisible();
    await fotografiere(page, KAPITEL, 'gefahren');
    // Ablauf weiter: das Gebiet auf der Lagekarte zeigen.
    await page.getByRole('link', { name: /^Auf Karte zeigen/ }).click();
    await expect(page).toHaveURL(/\/lagekarte/);
  });

  test('Menü einer Zelle mit den Warnstufen', async ({ page }) => {
    // Höher als der Fükw, damit das Paneel ohne Bildlauf ganz steht: sonst läge die klebende
    // Kopfleiste über seinem oberen Rand.
    await page.setViewportSize({ width: 1440, height: 1200 });
    await oeffneGefahren(page);
    await page.getByRole('button', { name: /^Bewertung Elektrizität × Menschen:/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Erläuterung …' })).toBeVisible();
    // Zeiger auf die Stufe, die gilt: sonst stünde die Hervorhebung auf „Keine“.
    await page.getByRole('menuitem', { name: 'M · Mittel' }).hover();
    await fotografiere(
      page.getByRole('region', { name: 'Bewertung' }),
      KAPITEL,
      'bewertung-waehlen',
    );
    await page.getByRole('menuitem', { name: 'H · Hoch' }).click();
    await expect(
      page.getByRole('button', { name: 'Bewertung Elektrizität × Menschen: hoch' }),
    ).toBeVisible();
  });

  test('Beurteilung bestätigen', async ({ page }) => {
    // Ohne Bild: der Ablauf ist nachgeklickt, die Ansicht zeigt schon `gefahren.png`.
    await oeffneGefahren(page);
    const beurteilung = page.locator('[data-lfh="gefahrengebiet-beurteilung"]');
    await expect(beurteilung).toContainText('nicht beurteilt');
    await beurteilung.getByRole('button', { name: 'Beurteilung bestätigen' }).click();
    await expect(beurteilung.locator('[data-lfh="beurteilung-stand"]')).toContainText(
      /^beurteilt /,
    );
  });

  test('Erläuterung einer Bewertung', async ({ page }) => {
    await oeffneGefahren(page);
    await page.getByRole('button', { name: /^Bewertung Elektrizität × Menschen:/ }).click();
    await page.getByRole('menuitem', { name: 'Erläuterung …' }).click();
    const dialog = page.getByRole('dialog', { name: 'Erläuterung Elektrizität × Menschen' });
    await dialog.getByLabel('Erläuterung').fill('Stromführende Kellerverteilungen unter Wasser.');
    await dialog.getByLabel('Gemeldet von').fill('Rettungsstaffel');
    await dialog.getByLabel('Gemeldet von').blur();
    await fotografiere(dialog, KAPITEL, 'bewertung-details');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    // Ablauf „Erläuterungen lesen“ (ohne eigenes Bild): Marke und Liste unter der Matrix.
    await expect(
      page.getByRole('button', {
        name: /^Bewertung Elektrizität × Menschen: \S+ · mit Erläuterung$/,
      }),
    ).toBeVisible();
    const liste = page.locator('[data-lfh="gefahren-erlaeuterungen"]');
    await expect(liste).toContainText('Stromführende Kellerverteilungen unter Wasser.');
    await liste.getByRole('button', { name: /Elektrizität × Menschen/ }).click();
    await expect(dialog).toBeVisible();
  });

  test('Gefahrengebiet umbenennen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/gefahren`);
    await expect(page.getByRole('heading', { name: 'Überflutung Unterstadt' })).toBeVisible();
    await page.locator('.listen-eintrag').filter({ hasText: 'Hangrutsch Kirchberg' }).click();
    await expect(page.getByRole('heading', { name: 'Hangrutsch Kirchberg' })).toBeVisible();
    await page.getByRole('button', { name: 'Umbenennen' }).click();
    await page.getByRole('textbox', { name: 'Bezeichnung' }).fill('Hangrutsch Kirchstraße');
    await page.getByRole('button', { name: 'Bezeichnung speichern' }).click();
    await expect(page.getByRole('heading', { name: 'Hangrutsch Kirchstraße' })).toBeVisible();
  });
});
