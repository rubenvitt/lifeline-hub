import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Offline-Precache des maplibre-Tile-Workers (LFH-356/2).
//
// Was bisher belegt war: dass `maplibre-gl-worker-*.js` im Precache-Manifest von `dist/sw.js`
// STEHT — am Artefakt nachgesehen. Was niemand gefahren hatte: ob es nach `offline` auch
// wirklich AUS DEM CACHE kommt. Ein nicht-precachter Worker ließe die Karte offline tot liegen,
// während jeder Online-Test grün bleibt — und offline muss die Karte funktionieren.
//
// WARUM DIESER SPEC EINEN PROD-BUNDLE BRAUCHT und die übrigen nicht: den Service Worker gibt es
// nur dort. `vite-plugin-pwa` ist ohne `devOptions` im Dev-Server gar nicht aktiv, und selbst
// mit wäre sein Dev-SW kein Precache der gehashten Assets — der Nachweis wäre eine Attrappe.
//
// SERVIERT WIRD VOM BACKEND, NICHT VON `vite preview` — und das ist kein Umweg, sondern genau
// der Auslieferungspfad: `src/static_files.rs` bettet `frontend/dist` per rust-embed ein und
// liest es im DEBUG-Build zur Laufzeit vom Dateisystem. Das e2e-Backend läuft ohnehin (eigener
// Port, Temp-DB) und liefert damit den gebauten Bundle inklusive `sw.js` mit den echten
// Cache-Headern (`no-cache` für sw.js, `immutable` für assets/) — same-origin mit der API, also
// ohne zusätzlichen Proxy und ohne zweiten Webserver. Der Port kommt aus `LIFELINE_E2E_LAUF`,
// derselben Variablen, über die playwright.config.ts ihre Wahl an die Worker vererbt.
//
// WAS DIESER TEST NICHT BEHAUPTET (bewusst, gemessen): dass die Lagekarte offline vollständig
// hochkommt. Der Prod-Bundle trägt den DEV-Haken `__lfhKarte` nicht — in ihm ist Kartenzustand
// nicht auslesbar —, und die API ist NICHT precacht: nach einem Offline-Reload bootet die Shell
// aus dem Cache, aber `/api/einsaetze/…` und `/api/karte/config` scheitern, der React-Root
// bleibt leer (gemessen: `body.innerText` == ''). Offline-Datenhaltung ist eine eigene Frage
// (die Offline-Queue der Erfassung), nicht die dieses Tests. Geprüft wird deshalb genau das
// Asset-Versprechen: Shell und Worker kommen aus dem Precache, und der Worker ist aus dem
// Cache heraus startbar.
//
// DIE TRAGENDE ZEILE IST `fromServiceWorker()`. Ein bloßes „fetch hat offline funktioniert"
// wäre kein Beleg: das Asset trägt `Cache-Control: immutable`, es könnte also aus dem
// HTTP-Cache des Browsers kommen, ohne dass der Service Worker es je gesehen hat. Daneben steht
// eine Gegenkontrolle, ohne die alles Übrige trivial wäre: etwas NICHT-Precachtes
// (`/api/health`) MUSS offline scheitern — sonst ist der Offline-Schalter wirkungslos und der
// Test beweist nichts.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const distPfad = fileURLToPath(new URL('../dist', import.meta.url));
const swPfad = `${distPfad}/sw.js`;
const bundleFehlt = !existsSync(swPfad);

/** Backend-Port aus der Lauf-Entscheidung der playwright.config (dieselbe Quelle, die auch die
 *  webServer-Einträge benutzen) — der Prod-Bundle wird vom Backend ausgeliefert, nicht von Vite. */
const lauf = process.env.LIFELINE_E2E_LAUF;
const backendUrl = lauf
  ? `http://127.0.0.1:${(JSON.parse(lauf) as { backendPort: number }).backendPort}`
  : '';

// Die Seite läuft gegen die Backend-Origin. `test.use` statt eines handgebauten Contexts, damit
// Trace/Video/Viewport-Einstellungen des Projekts erhalten bleiben.
test.use({ baseURL: backendUrl || undefined });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Einsatz über die API; der Name trägt keinen Modulnamen (Palette-Strict-Mode, s. Smoke). */
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
  // Kein gebauter Bundle → kein Service Worker → nichts zu prüfen. Laut übersprungen statt
  // rot: dieselbe Linie wie beim fehlenden Backend-Binary in scripts/check-all.sh. Das
  // Sammel-Gate baut den Bundle in Schritt 7 selbst, dort läuft der Test also immer.
  if (bundleFehlt) {
    console.warn(
      `ÜBERSPRUNGEN: ${swPfad} fehlt — der Offline-Precache-Nachweis braucht einen Prod-Bundle.\n` +
        "  Einmal 'pnpm -C frontend build' laufen lassen (oder ./scripts/check-all.sh --nur e2e).",
    );
  }
  test.skip(bundleFehlt, 'Prod-Bundle fehlt (frontend/dist/sw.js) — vorher `pnpm build`');
  test.skip(!lauf, 'LIFELINE_E2E_LAUF fehlt — Backend-Port unbekannt');

  // (0) Strukturelle Vorbedingung: das Asset, dessen Cache-Auslieferung geprüft wird, muss im
  //     Manifest stehen. Das ist die Artefakt-Hälfte der Zusicherung — sie bindet den
  //     Laufzeit-Nachweis unten an den konkreten Dateinamen, statt „irgendein Worker" zu prüfen.
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

  // (1) Online: die Karte einmal wirklich benutzen. Das ist die Vorbedingung mit Aussage — nur
  //     so ist belegt, dass der geprüfte Pfad DER Pfad der Karte ist und nicht eine Datei, die
  //     nur zufällig im Bundle liegt.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche')).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);

  // (2) Der Service Worker muss AKTIV sein, bevor der Strom weg ist — `activated` ist dabei das
  //     Signal für „Precache fertig": Workbox füllt ihn in `install`, und aktiviert wird erst
  //     danach. Zusätzlich muss er die Seite KONTROLLIEREN, sonst liefe jeder folgende fetch am
  //     Cache vorbei und der Test prüfte den HTTP-Cache.
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
    // GEGENKONTROLLE zuerst: etwas Nicht-Precachtes muss offline scheitern. Ohne diese Zeile
    // wäre der Rest auch bei wirkungslosem Offline-Schalter grün.
    try {
      const antwort = await fetch('/api/health', { cache: 'no-store' });
      ergebnis.gegenkontrolle = `unerwartet beantwortet: ${antwort.status}`;
    } catch {
      ergebnis.gegenkontrolle = 'scheitert wie erwartet';
    }
    // `no-store` schließt den HTTP-Cache als Quelle aus; der Service Worker wird davon nicht
    // umgangen (er antwortet aus der Cache Storage).
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
  // Gemessen 486 526 Bytes; die Schwelle ist bewusst locker (es geht um „echte Datei statt
  // leerer Antwort", nicht um eine Bundle-Größe, die jeder maplibre-Sprung verschiebt).
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

  // (5) Und die App-Shell selbst kommt offline aus dem Precache — sonst wäre der gecachte
  //     Worker wertlos, weil die Seite ihn nie anfordern könnte. Geprüft an der
  //     NAVIGATIONS-Antwort, nicht an sichtbarem Inhalt: die Datenschicht ist offline
  //     erwartungsgemäß tot (s. Kopf), der Shell-Abruf ist die Aussage.
  const navigation = await page.reload({ timeout: 20_000 });
  expect(navigation?.status()).toBe(200);
  expect(navigation?.fromServiceWorker(), 'Shell kam nicht aus dem Service-Worker-Cache').toBe(
    true,
  );

  // Backstop über den GANZEN Lauf, den Offline-Start eingeschlossen (gemessen leer, drei Läufe).
  // Dass die Shell offline keine Daten zeigt, ist erwartet; dass sie dabei eine Ausnahme wirft,
  // wäre keine Folge des fehlenden Netzes, sondern ein Fehler — eine App, die beim Ausfall ihrer
  // API den React-Root abreißt, verliert offline auch das, was sie noch könnte.
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
