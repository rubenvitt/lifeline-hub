import { expect, test } from '@playwright/test';
import { anmeldenOhneStartseite, einsatzMitLage, grundlageOhneNetz } from './lageplan-kern';
import { auswahlAnsicht, objektZeile } from './leisten-kern';
import { ADMIN, ADMIN_PW } from './rollen-kern';

/**
 * Lagekarte auf einem Gerät ohne WebGL2 (LLH-1353, `lagekarte/AGENTS.md`, „Karte ohne Grafik“):
 * maplibre kann die Karte nicht zeichnen. Statt der Fehlerseite der App steht in der Kartenfläche
 * „Karte auf diesem Gerät nicht darstellbar“; Leiste, Objektliste und Seitenkopf bleiben bedienbar,
 * und der Lageplan nennt den Grund, statt zu drucken oder anzufügen.
 *
 * Chromium hat WebGL2; ein Init-Skript lässt `getContext('webgl2')` `null` liefern, so wie es der
 * headless Firefox hier und in der CI ohnehin tut. Deshalb läuft die Spec auch in Firefox
 * (`OHNE_WEBGL_SPECS` in `playwright.config.ts`): dort belegt sie das Verhalten ohne Nachbau.
 *
 * Mutationsprobe: Fang in `Kartenflaeche.tsx` weg (`new maplibregl.Map(optionen)` direkt) → die
 * Seite zeigt „Unexpected Application Error!“ und keine Leiste, rot (geprobt 21.10.).
 */

const FUEKW = { width: 1366, height: 768 };
const ZUSTAND = 'Karte auf diesem Gerät nicht darstellbar';

test('ohne WebGL2: Zustand in der Kartenfläche, Leiste bedienbar, Lageplan nennt den Grund', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      art: string,
      ...rest: unknown[]
    ) {
      if (art === 'webgl2') return null;
      return (original as (...a: unknown[]) => RenderingContext | null).call(this, art, ...rest);
    } as typeof original;
  });
  await page.setViewportSize(FUEKW);
  await grundlageOhneNetz(page);
  await anmeldenOhneStartseite(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzMitLage(page, `E2E Lagekarte ohne Grafik ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);

  // Vorbedingung: das Gerät hat wirklich kein WebGL2 (Nachbau in Chromium, Firefox headless selbst).
  expect(
    await page.evaluate(() => document.createElement('canvas').getContext('webgl2') === null),
  ).toBe(true);

  const zustand = page.locator('[data-lfh="karte-nicht-darstellbar"]');
  await expect(zustand).toHaveText(ZUSTAND);
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
  await expect(page.getByTestId('kartenflaeche').locator('canvas')).toHaveCount(0);

  // Die Leiste bleibt: Objektliste mit der Einheit, ein Tipp wählt sie aus.
  const zeile = await objektZeile(page, 'LF Lageplan');
  await zeile.getByRole('button', { name: /LF Lageplan/ }).click();
  await expect(auswahlAnsicht(page)).toContainText('LF Lageplan');

  // Druck: der Grund steht über der Karte, kein Druckdialog, kein Blatt.
  await page.evaluate(() => {
    const w = window as unknown as { __lfhDrucke: number };
    w.__lfhDrucke = 0;
    window.print = () => {
      w.__lfhDrucke += 1;
    };
  });
  await page.getByRole('button', { name: 'Drucken / als PDF', exact: true }).click();
  const hinweis = page.getByTestId('karten-speicherfehler');
  await expect(hinweis).toContainText('Lageplan nicht gedruckt');
  await expect(hinweis).toContainText(ZUSTAND);
  await expect(page.locator('[data-lfh="druckwurzel"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __lfhDrucke: number }).__lfhDrucke),
  ).toBe(0);

  // Anlage: derselbe Grund im Dialog, der offen bleibt.
  await page.getByRole('button', { name: 'Als Anlage an …', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Neuer Lagevortrag' }).check();
  await dialog.getByRole('button', { name: 'Anfügen', exact: true }).click();
  await expect(dialog).toContainText('Lageplan nicht angefügt');
  await expect(dialog).toContainText(ZUSTAND);

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
