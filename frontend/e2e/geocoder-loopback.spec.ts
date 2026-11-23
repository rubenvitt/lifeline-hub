import { expect, test } from '@playwright/test';
import { anmeldenPerApi } from './anmelde-kern';
import { GEOCODER_LOOPBACK } from './geocoder-kern';
import { ADMIN, ADMIN_PW } from './rollen-kern';

// Kein Lauf fragt einen Drittdienst (LLH-2063): die globale Vorbereitung lenkt den Geocoder der
// Organisation auf Loopback (`e2e/geocoder-kern.ts`). Ohne sie ginge jede Ort-Vorschau an den
// öffentlichen Nominatim, und ob ein Ortsname zurückkäme, hinge am Netz des Laufs.

test('der Lauf fragt keinen öffentlichen Geocoder: Ort-Vorschau ohne Ortsnamen', async ({
  page,
}) => {
  await anmeldenPerApi(page, ADMIN, ADMIN_PW, { startseite: false });

  const einstellungen = await page.request.get('/api/org-settings');
  expect(einstellungen.ok(), await einstellungen.text()).toBe(true);
  expect(((await einstellungen.json()) as { geocoder_url: string | null }).geocoder_url).toBe(
    GEOCODER_LOOPBACK,
  );

  // Berlin, Pariser Platz: der öffentliche Nominatim kennt hier eine Adresse.
  const vorschau = await page.request.get('/api/ort-vorschau?lat=52.5163&lon=13.3777');
  expect(vorschau.ok(), await vorschau.text()).toBe(true);
  expect(await vorschau.json()).not.toHaveProperty('ortsname');
});
