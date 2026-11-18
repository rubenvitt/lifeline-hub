import { expect, test, type Page } from '@playwright/test';
import { einsatzPerApi } from './einsatz-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Fristen zuerst (LLH-1748, Spec `lage-verdichtung`, „Fristen über der Falz“ und „Fristen zuerst
 * am Handy“): der Überblick trägt kein Kennzahlenband mehr, „Nächste Marken“ steht in der ersten
 * Paneelreihe vor „Offene Vorgänge“. Vorher begann das Paneel am Fükw bei y ≈ 1309 und am Handy
 * bei y ≈ 2173.
 *
 * Die Startliste blendet der Test über ihren Knopf aus, wie es die Einsatzleitung tut: das
 * Szenario misst den laufenden Einsatz ohne sie.
 *
 * Mutationsprobe (17.11.2026): in `UeberblickPage.tsx` die beiden Reihen zurückgetauscht →
 * am Fükw rot an der Falz, am Handy an der Folge.
 */

const marken = (page: Page) => page.getByRole('region', { name: 'Nächste Marken' });

/** Öffnet den Überblick eines frischen Einsatzes ohne Startliste und wartet auf die Paneele. */
async function ueberblickOhneStartliste(page: Page, breite: number, hoehe: number) {
  await page.setViewportSize({ width: breite, height: hoehe });
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzPerApi(page, `E2E Fristen oben ${breite} ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
  const startliste = page.getByRole('region', { name: 'Einsatz starten' });
  await startliste.getByRole('button', { name: 'Ausblenden' }).click();
  await expect(startliste).toHaveCount(0);
  await expect(marken(page)).toBeVisible();
  await expect(page.locator('[data-lfh="seiten-inhalt"] [aria-busy="true"]')).toHaveCount(0);
  // Kein Band mehr zwischen Alarmzeile und Paneelen.
  await expect(page.locator('[data-lfh="kennzahlenband"]')).toHaveCount(0);
}

test('Fükw 1440 × 900: „Nächste Marken“ beginnt über der Falz', async ({ page }) => {
  await ueberblickOhneStartliste(page, 1440, 900);
  const oben = await marken(page).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  test.info().annotations.push({ type: 'messwert', description: `Nächste Marken y ${oben}` });
  expect(oben, 'Oberkante „Nächste Marken“').toBeLessThan(900);
});

test('Handy 390 px: „Nächste Marken“ ist das erste Paneel unter der Alarmzeile', async ({
  page,
}) => {
  await ueberblickOhneStartliste(page, 390, 844);
  // Gestapelt gilt die Folge der Paneele von oben nach unten.
  const oberkante = (name: string | RegExp) =>
    page
      .getByRole('region', { name, exact: typeof name === 'string' })
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
  const folge = [
    await oberkante('Nächste Marken'),
    await oberkante('Offene Vorgänge'),
    await oberkante('Einsatzabschnitte'),
    await oberkante(/^Entscheidungen|^Letzte Entscheidungen/),
  ];
  test
    .info()
    .annotations.push({ type: 'messwert', description: `Oberkanten ${folge.join(' / ')}` });
  expect(folge, 'Marken, Vorgänge, Abschnitte, Entscheidungen').toEqual(
    [...folge].sort((x, y) => x - y),
  );
  const alarm = await page
    .getByRole('status', { name: 'Was brennt' })
    .evaluate((el) => el.getBoundingClientRect().bottom);
  const oben = await marken(page).evaluate((el) => el.getBoundingClientRect().top);
  expect(oben, 'Marken direkt unter der Alarmzeile').toBeGreaterThanOrEqual(alarm);
});
