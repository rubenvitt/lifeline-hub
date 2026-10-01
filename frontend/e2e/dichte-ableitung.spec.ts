import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, anmeldenAls, benutzerAnlegen } from './rollen-kern';

/**
 * Die Ableitung der Bediendichte im Browser, mit ECHTEM `(pointer: coarse)` (LFH-724, Spec
 * `bedien-dichte`). Vitest belegt die Regel als Wahrheitstafel (`theme/dichte.test.ts`) mit
 * gemocktem `matchMedia`; erst hier meldet ein Browser selbst die Zeigerart.
 *
 * `hasTouch` liegt über `test.use` auf der ganzen Datei: jeder Fall hier ist ein Touchgerät.
 * Der Gegenfall „feiner Zeiger ohne Wahl → kompakt“ steht in `dichte.spec.ts` und wird hier
 * nicht verdoppelt.
 *
 * Gemessen am Anmelde-Knopf (`size="large"` = 1,25 × Steuerhöhe), Muster `dichte.spec.ts`:
 * ein FENSTER je Stufe statt „mindestens“, damit eine falsch angekommene Nachbarstufe auffällt.
 */
test.use({ hasTouch: true });

const SCHLUESSEL = 'lifeline-hub.dichte';

/** 1,25 × 30 / 48 / 72. ±4 px trennen die drei Stufen sicher. */
const KNOPF = { kompakt: 37.5, komfortabel: 60, handschuh: 90 } as const;
type Stufe = keyof typeof KNOPF;

async function speichere(page: Page, wert: string) {
  await page.addInitScript(
    ([schluessel, stufe]) => window.localStorage.setItem(schluessel, stufe),
    [SCHLUESSEL, wert] as const,
  );
}

/** Stufe am `<html>` und Höhe des Anmelde-Knopfs im Fenster der Stufe. */
async function stehtAuf(page: Page, stufe: Stufe) {
  // Auto-Retry: das Merkmal setzt ein Effekt, beim ersten Bild fehlt es noch.
  await expect(page.locator('html')).toHaveAttribute('data-dichte', stufe);
  const knopf = page.getByRole('button', { name: 'Anmelden', exact: true });
  await expect(knopf).toBeVisible();
  let hoehe = 0;
  await expect
    .poll(
      async () => {
        hoehe = (await knopf.boundingBox())?.height ?? 0;
        return Math.abs(hoehe - KNOPF[stufe]);
      },
      { message: `Anmelde-Knopf in ${stufe}` },
    )
    .toBeLessThanOrEqual(4);
  test.info().annotations.push({ type: stufe, description: `${hoehe}px` });
}

test('Touchgerät ohne Wahl beginnt bei komfortabel', async ({ page }) => {
  // Vorbedingung: der Browser meldet den groben Zeiger wirklich, sonst prüfte der Test die
  // Vorgabe `kompakt` gegen ein Fenster, das zufällig nicht passt.
  await page.goto('/login');
  expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
  await stehtAuf(page, 'komfortabel');
  // Abgeleitet heißt nicht gewählt: der Speicher bleibt leer.
  expect(await page.evaluate((s) => window.localStorage.getItem(s), SCHLUESSEL)).toBeNull();
});

test('die gespeicherte Wahl kompakt schlägt die Zeigerart', async ({ page }) => {
  await speichere(page, 'kompakt');
  await page.goto('/login');
  await stehtAuf(page, 'kompakt');
});

test('ein unbrauchbarer Speicherwert fällt auf die Zeigerart, nicht auf kompakt', async ({
  page,
}) => {
  await speichere(page, 'riesig');
  await page.goto('/login');
  await stehtAuf(page, 'komfortabel');
});

test('handschuh entsteht nur aus der Wahl — und bleibt dann', async ({ page }) => {
  // Ohne Wahl kein Handschuh, auch auf Touch (der erste Test zeigt komfortabel);
  // mit Wahl steht er.
  await speichere(page, 'handschuh');
  await page.goto('/login');
  await stehtAuf(page, 'handschuh');
});

test('die Wahl gehört zum Gerät, nicht zur Person', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const zweite = await benutzerAnlegen(page, 'beobachter');

  const trigger = page.getByRole('button', { name: 'Benutzermenü' });
  await trigger.click();
  await page.getByRole('menuitem', { name: /Handschuh/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  // Abmelden über den Bedienweg, den eine Person am geteilten Tablet nimmt.
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login/);
  await stehtAuf(page, 'handschuh');

  await anmeldenAls(page, zweite.benutzername, zweite.passwort);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  expect(await page.evaluate((s) => window.localStorage.getItem(s), SCHLUESSEL)).toBe('handschuh');
});
