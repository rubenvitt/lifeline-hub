import { expect, test, type Page } from '@playwright/test';
import { anmelden, einsatzAnlegen } from './fuehrungsorganisation-kern';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Einsatzabschluss auf den Einsatzdaten (LFH-960): Unumkehrbares für den ganzen Einsatz steht nicht
 * im Kopf einer Arbeitsseite. Hier steht, was jsdom nicht belegt: auf Handy, Tablet hoch und quer
 * und Desktop trägt das Einsatztagebuch weder im Kopf noch im Menü „Weitere“ einen Abschluss, und
 * auf den Einsatzdaten steht „Einsatz abschließen“ als bedienbarer Knopf außerhalb des Seitenkopfs,
 * ohne waagerechten Überhang. Am Ende einmal der echte Abschluss über die benannte Rückfrage.
 *
 * Gemessen als Admin UND als Führungspersonal (`frontend/e2e/AGENTS.md`, Layout-Gate
 * nicht-privilegiert): Führungspersonal schreibt im Einsatz, leitet ihn aber nicht.
 *
 * Mutationsproben (beide gefahren):
 *   • in `pages/EinsatzdatenPage.tsx` `darfAbschliessen` auf `darfImEinsatzSchreiben` → nur der
 *     Führungspersonal-Test wird rot (Abschnitt ohne Leitungsrecht);
 *   • in `pages/EtbPage.tsx` den Menüeintrag „Einsatz abschließen“ zurück in „Weitere“ → beide
 *     Tests werden bei 390 px rot (Menü „Weitere“).
 */

const BREITEN = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1440, height: 900 },
];

/** Waagerechter Überhang der Seite in px (Chromium rundet `scrollWidth`, 1 px Toleranz). */
async function ueberhang(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** ETB: kein Abschluss im Kopf, und wo es das Menü „Weitere“ gibt, auch dort nicht. */
async function etbOhneAbschluss(page: Page, einsatzId: string, breite: number, wo: string) {
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const main = page.locator('main');
  await expect(
    main.getByRole('heading', { level: 1, name: 'ETB', exact: true }),
    `${wo}: ETB geladen`,
  ).toBeVisible();
  await expect(main.getByText('Einsatz abschließen'), `${wo}: kein Abschluss im ETB`).toHaveCount(
    0,
  );
  // Unter `md` (768 px) stehen Nebenwege im Menü „Weitere“, darüber direkt im Kopf.
  const weitere = main.getByRole('button', { name: 'Weitere Aktionen zum Einsatztagebuch' });
  if (breite < 768) {
    await expect(weitere, `${wo}: Menü „Weitere“ steht`).toBeVisible();
    await weitere.click();
    const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
    await expect(menue.getByRole('menuitem'), `${wo}: Menü „Weitere“`).toHaveText([
      'Drucken / als PDF',
    ]);
    await page.keyboard.press('Escape');
    await expect(menue).toHaveCount(0);
  }
}

test('Einsatzabschluss: nicht im ETB, auf den Einsatzdaten außerhalb des Kopfs (Admin)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Einsatzabschluss ${Date.now()}`);

  for (const breite of BREITEN) {
    await page.setViewportSize(breite);
    const wo = `admin ${breite.width}`;
    await etbOhneAbschluss(page, einsatzId, breite.width, wo);

    await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Einsatzabschluss' }), wo).toBeVisible();
    const knopf = main.getByRole('button', { name: 'Einsatz abschließen', exact: true });
    await expect(knopf, `${wo}: als Wort`).toBeVisible();
    await knopf.click({ trial: true, timeout: 5_000 });
    await expect(
      main.locator('[data-lfh="seitenkopf-aktionen"]').getByText('Einsatz abschließen'),
      `${wo}: nicht im Seitenkopf`,
    ).toHaveCount(0);
    const k = await knopf.boundingBox();
    expect(k, `${wo}: Knopf messbar`).not.toBeNull();
    expect(k!.x, `${wo}: links im Bild`).toBeGreaterThanOrEqual(0);
    expect(k!.x + k!.width, `${wo}: rechts im Bild`).toBeLessThanOrEqual(breite.width + 1);
    expect(await ueberhang(page), `${wo}: ohne Überhang`).toBeLessThanOrEqual(1);
  }

  // Der Abschluss selbst: erst die benannte Rückfrage schließt ab.
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Einsatz abschließen', exact: true }).click();
  const ok = page.getByRole('button', { name: 'Einsatz endgültig abschließen', exact: true });
  await expect(ok).toBeVisible();
  await ok.click();
  await expect(main.getByRole('heading', { name: 'Einsatzabschluss' })).toHaveCount(0);
  const einsatz = await page.request.get(`/api/einsaetze/${einsatzId}`);
  expect(((await einsatz.json()) as { status: string }).status).toBe('abgeschlossen');
});

test('Einsatzabschluss: fehlt für Führungspersonal auf allen Breiten', async ({ page }) => {
  test.setTimeout(180_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Einsatzabschluss FP ${Date.now()}`);
  await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);

  for (const breite of BREITEN) {
    await page.setViewportSize(breite);
    const wo = `fuehrungspersonal ${breite.width}`;
    await etbOhneAbschluss(page, einsatzId, breite.width, wo);

    await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
    const main = page.locator('main');
    // Vorbedingung: der Rollenzweig steht — Führungspersonal bearbeitet die Kopfdaten, verwaltet
    // aber keine Mitglieder.
    await expect(main.getByRole('button', { name: 'Bearbeiten', exact: true }), wo).toBeVisible();
    await expect(main.getByRole('button', { name: 'Hinzufügen' }), wo).toHaveCount(0);
    await expect(main.getByRole('heading', { name: 'Einsatzabschluss' }), wo).toHaveCount(0);
    await expect(main.getByText('Einsatz abschließen'), wo).toHaveCount(0);
    expect(await ueberhang(page), `${wo}: ohne Überhang`).toBeLessThanOrEqual(1);
  }
});
