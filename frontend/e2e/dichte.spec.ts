import { expect, test, type Page } from '@playwright/test';

/**
 * Die Bediendichte im Browser (LFH-329 · B1).
 *
 * WARUM HIER UND NICHT IN VITEST: die Vitest-Suite belegt, dass die Stufe am
 * ConfigProvider und am `<html>` ankommt — aber jsdom rechnet kein Layout, und
 * `vite.config.ts` fährt Vitest mit `css: false`. Ob aus einer Steuerhöhe von
 * 72 auch 72 gerenderte Pixel werden, ist ausschließlich hier messbar.
 *
 * KEIN Login: `/login` ist öffentlich, und der Theme-Provider hängt in `main.tsx`
 * über der ganzen App. Die gespeicherte Stufe wird per `addInitScript` gesetzt —
 * damit prüft der Test denselben Weg, den ein wiederkehrender Benutzer nimmt.
 *
 * ABGRENZUNG: die vollständige Trefflächen-Geometrie (jedes fokussierbare Element
 * je umgebauter Route) bleibt bei den Modulpaketen. Dieses Paket liefert den
 * MECHANISMUS und belegt nur, dass er bis in die Pixel durchschlägt. Die
 * Anmeldeseite trägt dafür bewusst keine Änderung; ihre punktuellen
 * Größen-Angaben sind Bestand und fallen in ihrem eigenen Paket.
 *
 * Bewusst KEIN zweites Playwright-Projekt und kein Device-Descriptor: das zöge
 * einen Browser-Download nach sich, für den es im Repo keinen Guard gibt.
 */

const SCHLUESSEL = 'lifeline-hub.dichte';

/** Höhe des Anmelde-Knopfs, mit Wiederholung.
 *
 *  Zwei Beats liegen zwischen dem ersten Bild und dem Endmaß: das Merkmal am
 *  `<html>` wird in einem Effekt gesetzt, und antd spritzt seine Stilregeln
 *  danach noch einmal nach. Eine einmalige Messung wäre deshalb flaky. */
async function knopfhoehe(page: Page): Promise<number> {
  const knopf = page.getByRole('button', { name: 'Anmelden', exact: true });
  await expect(knopf).toBeVisible();
  let gemessen = 0;
  await expect
    .poll(
      async () => {
        gemessen = (await knopf.boundingBox())?.height ?? 0;
        return gemessen;
      },
      { message: 'Höhe des Anmelde-Knopfs' },
    )
    .toBeGreaterThan(0);
  return gemessen;
}

test('gespeicherte Stufe handschuh trägt sich bis in die Trefffläche', async ({ page }) => {
  await page.addInitScript(
    ([schluessel, stufe]) => window.localStorage.setItem(schluessel, stufe),
    [SCHLUESSEL, 'handschuh'] as const,
  );
  await page.goto('/login');

  // Auto-Retry ist hier Pflicht: das Merkmal setzt ein Effekt, beim ersten Bild
  // fehlt es noch.
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  const hoehe = await knopfhoehe(page);
  // Der Knopf trägt eine große Größen-Angabe, antd leitet daraus das 1,25-fache
  // der Steuerhöhe ab: 72 × 1,25 = 90. GEMESSEN: exakt 90,0 px.
  //
  // Das Fenster liegt um die gemessenen 90, nicht bei „mindestens 72". Die alte
  // Untergrenze widersprach ihrer eigenen Herleitung eine Zeile darüber: sie stand
  // auf der ROHEN Steuerhöhe, nicht auf dem daraus abgeleiteten Knopfmaß. Ein
  // Regress, der die große Größen-Angabe verliert, landet auf genau 72 — also
  // exakt AUF der Grenze — und liefe durch (per Mutationsprobe belegt: ohne
  // `size="large"` misst der Knopf 72 px und der alte Test blieb grün).
  //
  // ±4 px lassen Schrift- und Rundungsspiel und schließen trotzdem jeden Wert aus,
  // der hier sonst in Frage käme: 72 (Größen-Angabe verloren), 60 (Stufe
  // komfortabel, 48 × 1,25), 37,5 (Stufe kompakt).
  expect(hoehe, `handschuh: ${hoehe}px`).toBeGreaterThanOrEqual(86);
  expect(hoehe, `handschuh: ${hoehe}px`).toBeLessThanOrEqual(94);
});

test('ohne Seed bleibt es kompakt', async ({ page }) => {
  // Die Gegenprobe. Ohne sie belegte der Test oben nur, dass irgendetwas groß
  // ist — nicht, dass die STUFE es groß macht.
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');

  const hoehe = await knopfhoehe(page);
  // 30 × 1,25 = 37,5. GEMESSEN: exakt 37,5 px.
  //
  // Fenster um den gemessenen Wert, aus demselben Grund wie oben: die frühere
  // Spanne 24 < h < 72 ließ auch 60 px durch (Stufe komfortabel, 48 × 1,25) — die
  // Gegenprobe hätte also nicht gemerkt, wenn ohne Seed die falsche Stufe
  // ankommt. Sie soll belegen, dass es KOMPAKT ist, nicht bloß „kleiner als
  // handschuh".
  expect(hoehe, `kompakt: ${hoehe}px`).toBeGreaterThanOrEqual(34);
  expect(hoehe, `kompakt: ${hoehe}px`).toBeLessThanOrEqual(42);
});
