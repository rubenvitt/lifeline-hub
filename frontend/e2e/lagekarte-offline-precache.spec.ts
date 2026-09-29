import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Offline-Precache des maplibre-Tile-Workers: kommt `maplibre-gl-worker-*.js` nach `offline`
// wirklich AUS DEM SERVICE WORKER? Ein nicht precachter Worker ließe die Karte offline tot
// liegen, während jeder Online-Test grün bleibt.
//
// PROD-BUNDLE nötig: den Service Worker gibt es nur im Build (`vite-plugin-pwa` ist im
// Dev-Server nicht aktiv). Ausgeliefert vom e2e-Backend, nicht von `vite preview`:
// `src/static_files.rs` liest `frontend/dist` im Debug-Build vom Dateisystem, mit den echten
// Cache-Headern und same-origin mit der API. Der Port kommt aus `LIFELINE_E2E_LAUF`.
//
// NICHT BEHAUPTET: dass die Lagekarte offline vollständig hochkommt. Der Prod-Bundle trägt den
// DEV-Haken `__lfhKarte` nicht, und die API ist nicht precacht. Die Daten hält seit LFH-723 die
// App selbst vor (IndexedDB), das belegen `lagebild-offline.spec.ts` und
// `lagekarte-offline-zeichnen.spec.ts`. Geprüft wird hier das Asset-Versprechen: Shell und
// Worker kommen aus dem Precache, und der Worker ist aus dem Cache startbar.
//
// TRAGEND ist `fromServiceWorker()`: das Asset ist `immutable` und könnte sonst aus dem
// HTTP-Cache kommen. Gegenkontrolle: etwas NICHT-Precachtes (`/api/health`) MUSS offline
// scheitern, sonst ist der Offline-Schalter wirkungslos.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const distPfad = fileURLToPath(new URL('../dist', import.meta.url));
const swPfad = `${distPfad}/sw.js`;
const bundleFehlt = !existsSync(swPfad);

/** Backend-Port aus der Lauf-Entscheidung der playwright.config — der Prod-Bundle kommt vom
 *  Backend, nicht von Vite. */
const lauf = process.env.LIFELINE_E2E_LAUF;
const backendUrl = lauf
  ? `http://127.0.0.1:${(JSON.parse(lauf) as { backendPort: number }).backendPort}`
  : '';

// Die Seite läuft gegen die Backend-Origin. `test.use`, damit Trace/Video/Viewport des
// Projekts erhalten bleiben.
test.use({ baseURL: backendUrl || undefined });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Einsatz über die API; der Name trägt keinen Modulnamen (Palette). */
async function einsatzAnlegen(page: Page): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Vorratscache ${Date.now()}` },
  });
  expect(antwort.ok(), `POST /api/einsaetze: ${antwort.status()} ${await antwort.text()}`).toBe(
    true,
  );
  return ((await antwort.json()) as { id: number }).id;
}

test('Lagekarte: der maplibre-Worker kommt offline aus dem Service-Worker-Precache', async ({
  page,
}) => {
  // Kein gebauter Bundle → kein Service Worker → laut übersprungen statt rot. Das Sammel-Gate
  // baut den Bundle in Schritt 7 selbst.
  if (bundleFehlt) {
    console.warn(
      `ÜBERSPRUNGEN: ${swPfad} fehlt — der Offline-Precache-Nachweis braucht einen Prod-Bundle.\n` +
        "  Einmal 'pnpm -C frontend build' laufen lassen (oder ./scripts/check-all.sh --nur e2e).",
    );
  }
  test.skip(bundleFehlt, 'Prod-Bundle fehlt (frontend/dist/sw.js) — vorher `pnpm build`');
  test.skip(!lauf, 'LIFELINE_E2E_LAUF fehlt — Backend-Port unbekannt');

  // (0) Das geprüfte Asset steht im Manifest — bindet den Laufzeit-Nachweis an den konkreten
  //     Dateinamen statt an „irgendeinen Worker".
  const workerDatei = readdirSync(`${distPfad}/assets`).find((n) =>
    /^maplibre-gl-worker-.*\.js$/.test(n),
  );
  expect(
    workerDatei,
    'kein maplibre-gl-worker-*.js in dist/assets — `?worker&url` gebrochen?',
  ).toBeDefined();
  const workerPfad = `/assets/${workerDatei}`;
  expect(
    readFileSync(swPfad, 'utf8'),
    `${workerDatei} fehlt im Precache-Manifest von dist/sw.js`,
  ).toContain(`assets/${workerDatei}`);

  const seitenFehler: Error[] = [];
  page.on('pageerror', (fehler) => seitenFehler.push(fehler));
  /** Antworten auf das Worker-Asset, erst ab dem Offline-Schalter gesammelt. */
  const workerAntwortenOffline: string[] = [];
  let offline = false;
  page.on('response', (antwort) => {
    if (offline && antwort.url().endsWith(workerPfad))
      workerAntwortenOffline.push(`${antwort.status()} sw=${antwort.fromServiceWorker()}`);
  });

  // (1) Online die Karte einmal wirklich benutzen: belegt, dass der geprüfte Pfad DER Pfad der
  //     Karte ist.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page);
  // Erst warten, bis der Service Worker aktiv ist, DANN die Lagekarte laden: `registerType:
  // 'prompt'` setzt weder `skipWaiting` noch `clientsClaim`, kontrolliert wird nur eine Seite,
  // die NACH der Aktivierung navigiert. Das Verhalten der App ist hier Prüfgegenstand, nicht
  // Stellschraube.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche')).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);

  // (2) Der Service Worker ist AKTIV (Workbox füllt den Precache in `install`) und
  //     KONTROLLIERT die Seite — sonst liefe jeder fetch am Cache vorbei.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          if (!reg) return 'keine Registrierung';
          if (reg.active?.state !== 'activated') return `Zustand ${reg.active?.state ?? 'ohne'}`;
          return navigator.serviceWorker.controller ? 'aktiv und zuständig' : 'nicht zuständig';
        }),
      { timeout: 20_000, message: 'Service Worker wird nie aktiv/zuständig' },
    )
    .toBe('aktiv und zuständig');

  // (3) Strom weg.
  offline = true;
  await page.context().setOffline(true);

  const messung = await page.evaluate(async (pfad) => {
    const ergebnis: Record<string, string> = {};
    // GEGENKONTROLLE zuerst: etwas Nicht-Precachtes muss offline scheitern.
    try {
      const antwort = await fetch('/api/health', { cache: 'no-store' });
      ergebnis.gegenkontrolle = `unerwartet beantwortet: ${antwort.status}`;
    } catch {
      ergebnis.gegenkontrolle = 'scheitert wie erwartet';
    }
    // `no-store` schließt den HTTP-Cache aus; der Service Worker antwortet aus Cache Storage.
    try {
      const antwort = await fetch(pfad, { cache: 'no-store' });
      ergebnis.asset = `${antwort.status} bytes=${(await antwort.text()).length}`;
    } catch (fehler) {
      ergebnis.asset = `scheitert: ${String(fehler)}`;
    }
    // Und: die gecachten Bytes sind ein STARTBARER Worker, nicht bloß irgendeine Antwort.
    ergebnis.workerStart = await new Promise<string>((fertig) => {
      let worker: Worker | null = null;
      const frist = setTimeout(() => {
        worker?.terminate();
        fertig('startet');
      }, 1500);
      try {
        worker = new Worker(pfad);
        worker.onerror = (e) => {
          clearTimeout(frist);
          worker?.terminate();
          fertig(`Fehler: ${(e as ErrorEvent).message || 'onerror'}`);
        };
      } catch (fehler) {
        clearTimeout(frist);
        fertig(`wirft: ${String(fehler)}`);
      }
    });
    return ergebnis;
  }, workerPfad);

  expect(messung.gegenkontrolle).toBe('scheitert wie erwartet');
  // Bewusst locker: „echte Datei statt leerer Antwort", keine Bundle-Größe.
  expect(messung.asset).toMatch(/^200 bytes=[1-9]\d{4,}$/);
  expect(messung.workerStart).toBe('startet');

  // (4) Die Zeile, die den HTTP-Cache ausschließt: die Antwort kam vom Service Worker.
  expect(
    workerAntwortenOffline.length,
    'keine Worker-Asset-Antwort nach dem Offline-Schalter',
  ).toBeGreaterThan(0);
  expect(
    workerAntwortenOffline.every((a) => a === '200 sw=true'),
    workerAntwortenOffline.join(' | '),
  ).toBe(true);

  // (5) Die App-Shell kommt offline aus dem Precache — sonst könnte die Seite den Worker nie
  //     anfordern. Geprüft an der Navigations-Antwort; welche Daten offline stehen, prüft
  //     `lagebild-offline.spec.ts`.
  const navigation = await page.reload({ timeout: 20_000 });
  expect(navigation?.status()).toBe(200);
  expect(navigation?.fromServiceWorker(), 'Shell kam nicht aus dem Service-Worker-Cache').toBe(
    true,
  );

  // Backstop über den ganzen Lauf: dass Abrufe offline scheitern, ist erwartet; dass die Seite
  // dabei eine Ausnahme wirft und den React-Root abreißt, wäre ein Fehler.
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
