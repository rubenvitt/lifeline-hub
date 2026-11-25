import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { anmeldenPerApi } from './anmelde-kern';
import { dialogSteht } from './dialog-kern';

/**
 * Stammdaten einlesen (LLH-1633): die Musterdatei des Vertrags hochladen, Vorschau ansehen,
 * übernehmen, und ein zweites Mal hochladen. Geprüft wird, was der Server danach hält (das
 * Fahrzeug mit OPTA und ISSI), nicht nur, was der Dialog sagt. Die Regeln des Abgleichs prüft
 * `tests/stammdaten_eingang.rs`.
 */

const MUSTER = fileURLToPath(
  new URL('../public/beispiele/stammdaten-beispiel.csv', import.meta.url),
);

test('Stammdaten einlesen: Musterdatei übernehmen, zweiter Lauf unverändert', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmeldenPerApi(page, 'admin', process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw', {
    startseite: false,
  });
  await page.goto('/admin/stammdaten/fahrzeuge');

  const datei = {
    name: 'stammdaten-beispiel.csv',
    mimeType: 'text/csv',
    buffer: readFileSync(MUSTER),
  };

  const einlesen = async () => {
    await page.getByRole('button', { name: 'Stammdaten einlesen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Stammdaten einlesen' });
    await dialogSteht(page, 'Stammdaten einlesen');
    const vorschau = page.waitForResponse(
      (r) => r.url().endsWith('/api/master-data/import/preview') && r.status() === 200,
    );
    await dialog.locator('input[type="file"]').setInputFiles(datei);
    await vorschau;
    return dialog;
  };

  // ── Erster Lauf: drei neue Fahrzeuge ────────────────────────────────────────────────────
  const erster = await einlesen();
  await expect(erster.getByText('3 Fahrzeuge neu')).toBeVisible();
  const uebernehmen = erster.getByRole('button', { name: 'Übernehmen' });
  await expect(uebernehmen).toBeEnabled();
  const importiert = page.waitForResponse(
    (r) => r.url().endsWith('/api/master-data/import') && r.status() === 200,
  );
  await uebernehmen.click();
  await importiert;
  await expect(erster.getByText('Übernommen')).toBeVisible();
  await erster.getByRole('button', { name: 'Schließen', exact: true }).last().click();
  await expect(erster).toBeHidden();

  const liste = await page.request.get('/api/vehicles');
  const fahrzeuge = (await liste.json()) as {
    funkrufname: string;
    opta?: string;
    fms_issi?: string;
  }[];
  const rtw = fahrzeuge.find((f) => f.funkrufname === 'RK Musterstadt 1/83-1');
  expect(rtw, 'Fahrzeug aus der Datei steht in der Liste').toBeTruthy();
  expect(rtw?.opta).toBe('4-83-1');
  expect(rtw?.fms_issi).toBe('1234501');
  await expect(page.getByText('RK Musterstadt 1/83-1')).toBeVisible();

  // ── Zweiter Lauf mit derselben Datei: nichts zu übernehmen ──────────────────────────────
  const zweiter = await einlesen();
  await expect(
    zweiter.locator('[data-lfh="marke"]', { hasText: 'Keine Änderungen' }),
  ).toBeVisible();
  await expect(zweiter.getByText('3 Fahrzeuge unverändert')).toBeVisible();
  await expect(zweiter.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
});
