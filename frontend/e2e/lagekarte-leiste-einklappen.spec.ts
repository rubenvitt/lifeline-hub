import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Die Kartenleiste lässt sich auch am Fükw ausblenden, und die Wahl bleibt gemerkt (LFH-715).
 *
 * Befund aus dem C9-Abgleich: ab `lg` stand die 300-px-Leiste fest neben der Karte. Bei
 * 1366 px blieben nach Rail (60), Modulpanel (208) und Leiste rechnerisch rund 797 px Karte;
 * das Akzeptanzkriterium verlangt mit ausgeblendeter Leiste ≥ 1000 px.
 *
 * Gemessen wird das **Paar**, und zwar am MapLibre-Canvas, nicht an der Kartenspalte: die
 * Spalte kann breit sein, während die Karte noch nicht nachgemessen hat. Ohne die Vorher-Messung
 * wäre „≥ 1000" auch dann grün, wenn die Leiste gar nicht gerendert würde.
 *
 * Die Wahl ist je Breitenklasse gemerkt (`lg` und darunter getrennt, `leistenWahl.ts`). 900 px
 * liegt unter `lg` (992) und über `md` (768): dort ist die Vorgabe offen, ein Ausblenden am Fükw
 * darf sie nicht mitnehmen.
 */

const FUEKW = { width: 1366, height: 768 };
const UNTER_LG = { width: 900, height: 768 };
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

// Login-/Anlege-Helfer kopiert — es gibt kein geteiltes e2e-Hilfsmodul.
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  // Kein Modulname im Einsatznamen (Kommandopalette sucht Module und Einsätze gemeinsam).
  await page.getByLabel('Bezeichnung').fill(`E2E Fükw-Fläche ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

function canvas(page: Page): Locator {
  return page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
}

async function kartenBreite(page: Page): Promise<number> {
  const box = await canvas(page).boundingBox();
  expect(box, 'Canvas der Karte hat keine Box').not.toBeNull();
  return box!.width;
}

async function karteBereit(page: Page) {
  await expect(canvas(page)).toHaveCount(1, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
}

const leiste = (page: Page) => page.getByRole('complementary', { name: 'Kartenleiste' });

test('Fükw 1366 px: ausgeblendete Leiste gibt der Karte ≥ 1000 px, die Wahl übersteht das Neuladen', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page);
  await page.setViewportSize(FUEKW);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await karteBereit(page);

  // Vorbedingung: per Vorgabe offen, und dann ist die Karte schmaler als 1000 px.
  await expect(leiste(page)).toBeVisible();
  await expect.poll(() => kartenBreite(page)).toBeLessThan(1000);
  const offen = await kartenBreite(page);

  const knopf = page.getByRole('button', { name: 'Leiste ausblenden' });
  await expect(knopf).toHaveAttribute('aria-expanded', 'true');
  await knopf.click();
  await expect(leiste(page)).toHaveCount(0);
  await expect.poll(() => kartenBreite(page)).toBeGreaterThanOrEqual(1000);
  const zu = await kartenBreite(page);
  test.info().annotations.push({
    type: 'Kartenbreite bei 1366 px',
    description: `Leiste offen ${offen} px · ausgeblendet ${zu} px`,
  });
  console.log(`LFH-715 Kartenbreite: offen ${offen} px, ausgeblendet ${zu} px`);

  await page.reload();
  await karteBereit(page);
  await expect(leiste(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leiste einblenden' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect.poll(() => kartenBreite(page)).toBeGreaterThanOrEqual(1000);
});

test('Die Wahl ist je Breitenklasse gemerkt: lg und darunter getrennt', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page);
  await page.setViewportSize(FUEKW);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await karteBereit(page);
  await page.getByRole('button', { name: 'Leiste ausblenden' }).click();
  await expect(leiste(page)).toHaveCount(0);

  // Unter lg gilt der eigene Platz: dort ist noch nichts gewählt, die Vorgabe ist offen.
  await page.setViewportSize(UNTER_LG);
  await expect(leiste(page)).toBeVisible();
  await page.getByRole('button', { name: 'Leiste ausblenden' }).click();
  await expect(leiste(page)).toHaveCount(0);

  // Zurück am Fükw bleibt dessen Wahl stehen, auch nach dem Neuladen …
  await page.setViewportSize(FUEKW);
  await page.reload();
  await karteBereit(page);
  await expect(leiste(page)).toHaveCount(0);

  // … und ebenso die Wahl unter lg. Einblenden dort lässt den Fükw-Platz unberührt.
  await page.setViewportSize(UNTER_LG);
  await expect(leiste(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Leiste einblenden' }).click();
  await expect(leiste(page)).toBeVisible();
  await page.setViewportSize(FUEKW);
  await expect(leiste(page)).toHaveCount(0);
});
