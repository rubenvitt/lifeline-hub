import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Hilfe ohne Netz (LFH-1096, Spec `anwenderdoku`): die Kapitel stecken im Chunk der Hilfe-Seite,
// den der Service Worker vorhält. Belegt wird der KALTSTART ohne Netz und ohne Anmeldung: Seite
// neu laden, während das Netz weg ist, und das Kapitel steht da.
//
// PROD-BUNDLE nötig wie in `lagekarte-offline-precache.spec.ts` (dort die Herleitung): den Service
// Worker gibt es nur im Build, ausgeliefert vom e2e-Backend. Ohne `dist/sw.js` laut übersprungen.
//
// Gegenkontrolle: `/api/health` muss offline scheitern, sonst ist der Offline-Schalter wirkungslos.

const distPfad = fileURLToPath(new URL('../dist', import.meta.url));
const swPfad = `${distPfad}/sw.js`;
const bundleFehlt = !existsSync(swPfad);
const lauf = process.env.LIFELINE_E2E_LAUF;
const backendUrl = lauf
  ? `http://127.0.0.1:${(JSON.parse(lauf) as { backendPort: number }).backendPort}`
  : '';

test.use({ baseURL: backendUrl || undefined });

test('Hilfe: Kaltstart ohne Netz und ohne Anmeldung zeigt das Kapitel', async ({ page }) => {
  if (bundleFehlt) {
    console.warn(`ÜBERSPRUNGEN: ${swPfad} fehlt — vorher 'pnpm -C frontend build'.`);
  }
  test.skip(bundleFehlt, 'Prod-Bundle fehlt (frontend/dist/sw.js) — vorher `pnpm build`');
  test.skip(!lauf, 'LIFELINE_E2E_LAUF fehlt — Backend-Port unbekannt');

  // (0) Der Chunk der Hilfe steht im Precache-Manifest.
  const chunk = readdirSync(`${distPfad}/assets`).find((n) => /^HilfePage-.*\.js$/.test(n));
  expect(chunk, 'kein HilfePage-*.js in dist/assets — lazy-Import gebrochen?').toBeDefined();
  expect(readFileSync(swPfad, 'utf8'), `${chunk} fehlt im Precache-Manifest`).toContain(
    `assets/${chunk}`,
  );

  // (1) Online einmal öffnen, Service Worker aktiv und zuständig (siehe Lagekarte: `prompt`
  //     kontrolliert erst eine Seite, die nach der Aktivierung lädt).
  await page.goto('/hilfe/geraet-verloren');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => (navigator.serviceWorker.controller ? 'ja' : 'nein')), {
      timeout: 20_000,
      message: 'Service Worker wird nie zuständig',
    })
    .toBe('ja');

  // (2) Netz weg, Gegenkontrolle, dann Kaltstart.
  await page.context().setOffline(true);
  const gegen = await page.evaluate(async () => {
    try {
      const a = await fetch('/api/health', { cache: 'no-store' });
      return `beantwortet ${a.status}`;
    } catch {
      return 'gescheitert';
    }
  });
  expect(gegen, 'offline muss /api/health scheitern').toBe('gescheitert');
  await page.reload();

  const inhalt = page.locator('[data-lfh="druckwurzel"]');
  await expect(inhalt.getByRole('heading', { level: 2, name: 'Gerät verloren' })).toBeVisible();
  await expect(inhalt.getByRole('heading', { name: 'Sofort melden' })).toBeVisible();
  await page.context().setOffline(false);
});
