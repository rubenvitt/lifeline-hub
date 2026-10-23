import { expect, test } from '@playwright/test';
import { anmelden, einsatzAnlegen, seedKraeftebaum } from './meldebild-kern';

/**
 * Taktische Zeit im Meldebild (LLH-1061, Spec `zeitdarstellung`): die Spalte „Seit“ steht in der
 * Rolle „kurz“ — taktisch heute nur die Uhrzeit (`1446`), mit der Gerätewahl „Datum und Uhrzeit“
 * `14:46`. Den Vortag (`091446`) pinnen die Unit-Tests des Formatkerns; der Status-Zeitpunkt
 * eines Fahrzeugs ist über die API immer „jetzt“.
 */

const GERAETEWAHL = 'lifeline.zeitdarstellung';
const FUEKW = { width: 1366, height: 768 };

test.use({ timezoneId: 'Europe/Berlin' });

test('Meldebild: „Seit“ taktisch `1446`, mit „Datum und Uhrzeit“ am Gerät `14:46`', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild Zeit ${Date.now()}`);
  await seedKraeftebaum(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  const bereich = page.getByRole('region', { name: 'Meldebild' });
  await expect(bereich).toHaveCount(1);
  const zug = bereich.locator('tr').filter({ hasText: '1. Zug Musterstadt-Nordwest' }).first();
  const seit = zug.locator('[data-lfh="meldebild-seit"]');

  await expect(seit).toHaveText(/^\d{4}$/);

  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [GERAETEWAHL, 'datum_uhrzeit']);
  await page.reload();
  await expect(bereich).toHaveCount(1);
  await expect(seit).toHaveText(/^\d{2}:\d{2}$/);
  await page.evaluate((k) => localStorage.removeItem(k), GERAETEWAHL);
});
