import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Hilfe ohne Netz (LFH-1096, LFH-1128, Spec `anwenderdoku`): die Kapitel stecken im Chunk der Hilfe-Seite,
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
  await expect(inhalt.getByRole('heading', { name: 'Warum sofort' })).toBeVisible();
  await page.context().setOffline(false);
});

// Bilder der Kapitel (LFH-1128, Spec `anwenderdoku`, „Bild ohne Netz“): NICHT im Precache (jeder
// Client lüde sonst alle Bilder bei jedem Update), sondern im Laufzeit-Cache `CacheFirst` unter
// `/assets/doku/`. Ein einmal angesehenes Bild erscheint ohne Netz wieder.
//
// Mutationsprobe: `runtimeCaching` in `vite.config.ts` entfernen und neu bauen → das Bild bleibt
// ohne Netz leer (naturalWidth 0).
test('Hilfe: ein einmal gesehenes Bild erscheint ohne Netz wieder', async ({ page }) => {
  test.skip(bundleFehlt, 'Prod-Bundle fehlt (frontend/dist/sw.js) — vorher `pnpm build`');
  test.skip(!lauf, 'LIFELINE_E2E_LAUF fehlt — Backend-Port unbekannt');

  // (0) Die Bilder liegen im eigenen Ordner und stehen NICHT im Precache-Manifest.
  const bilder = readdirSync(`${distPfad}/assets/doku`).filter((n) => n.endsWith('.png'));
  expect(bilder.length, 'keine Bilder unter dist/assets/doku').toBeGreaterThan(0);
  const sw = readFileSync(swPfad, 'utf8');
  for (const b of bilder) expect(sw, `${b} im Precache`).not.toContain(b);

  // (1) Online ansehen, während der Service Worker zuständig ist (sonst läuft der Abruf an ihm
  //     vorbei und landet in keinem Cache).
  await page.goto('/hilfe/anmelden-abmelden');
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
  const bild = page.locator('[data-lfh="druckwurzel"] img.hilfe-bild').first();
  await bild.scrollIntoViewIfNeeded();
  const geladen = () => bild.evaluate((b: HTMLImageElement) => b.complete && b.naturalWidth > 0);
  await expect.poll(geladen, { message: 'Bild lädt online nicht' }).toBe(true);
  const adresse = (await bild.getAttribute('src'))!;
  expect(adresse).toMatch(/^\/assets\/doku\/.+\.png$/);
  await expect
    .poll(
      () =>
        page.evaluate(async (a) => {
          const cache = await caches.open('lifeline-doku-bilder');
          return (await cache.match(a)) ? 'ja' : 'nein';
        }, adresse),
      { message: 'Bild nicht im Laufzeit-Cache' },
    )
    .toBe('ja');

  // (2) Netz weg, Kaltstart: das Bild kommt aus dem Cache.
  await page.context().setOffline(true);
  await page.reload();
  const offline = page.locator('[data-lfh="druckwurzel"] img.hilfe-bild').first();
  await offline.scrollIntoViewIfNeeded();
  await expect
    .poll(() => offline.evaluate((b: HTMLImageElement) => b.complete && b.naturalWidth > 0), {
      message: 'Bild ohne Netz leer',
    })
    .toBe(true);
  await page.context().setOffline(false);
});
