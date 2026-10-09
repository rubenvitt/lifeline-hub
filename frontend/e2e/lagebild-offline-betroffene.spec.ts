import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Betroffene ohne Freitexte auf dem Gerät (LFH-1095, Bedrohungsmodell 5 a).
//
// Der Weg des Feldes wie in `lagebild-offline.spec.ts`: Betroffene und UHS mit Netz öffnen, Netz
// weg, NEU LADEN. Läuft deshalb gegen den Prod-Bundle (Service Worker, Begründung dort im Kopf).
//
// DIE VORBEDINGUNGEN SIND TEIL DER AUSSAGE:
//  - Online zeigt die Liste die Freitexte wirklich — sonst wäre „nicht auf der Platte“ grün,
//    weil sie nie geladen wurden.
//  - Die Platte wird ROH gelesen (eigene IndexedDB-Verbindung), nicht über die App.
//  - `/api/health` scheitert offline.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const distPfad = fileURLToPath(new URL('../dist', import.meta.url));
const bundleFehlt = !existsSync(`${distPfad}/sw.js`);

const lauf = process.env.LIFELINE_E2E_LAUF;
const backendUrl = lauf
  ? `http://127.0.0.1:${(JSON.parse(lauf) as { backendPort: number }).backendPort}`
  : '';

test.use({ baseURL: backendUrl || undefined });

const NAME = 'Offlinebetroffen';
const UHS = 'BHP Funkloch';
const FREITEXTE = {
  herkunft_adresse: 'Lindenallee 17',
  melder_kontakt: '0170 5550199',
  notiz: 'Insulinpflichtig',
  zustand: 'stark unterkühlt',
  antreff_ort: 'Kellerabgang Nord',
};
const KOORDINATE = { antreff_lat: 53.0791, antreff_lon: 8.8017 };

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

/** Service Worker aktiv UND zuständig — Muster: `lagekarte-offline-precache`. */
async function serviceWorkerZustaendig(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg?.active?.state !== 'activated') return 'nicht aktiv';
          return navigator.serviceWorker.controller ? 'aktiv und zuständig' : 'nicht zuständig';
        }),
      { timeout: 30_000, message: 'Service Worker wird nie aktiv/zuständig' },
    )
    .toBe('aktiv und zuständig');
}

/** Navigation innerhalb der App, ohne Dokument-Abruf (die Drosselung soll durchlaufen). */
async function innerhalbNavigieren(page: Page, pfad: string) {
  await page.evaluate((ziel) => {
    window.history.pushState({}, '', ziel);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, pfad);
}

/** Der vorgehaltene Stand, roh als JSON-Text (leer = kein Datensatz). */
async function platteRoh(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((fertig) => {
        const anfrage = indexedDB.open('lifeline-lagebild');
        anfrage.onerror = () => fertig('');
        anfrage.onsuccess = () => {
          const db = anfrage.result;
          if (!db.objectStoreNames.contains('stand')) {
            db.close();
            fertig('');
            return;
          }
          const lesen = db.transaction('stand').objectStore('stand').getAll();
          lesen.onsuccess = () => {
            db.close();
            fertig(JSON.stringify(lesen.result));
          };
          lesen.onerror = () => {
            db.close();
            fertig('');
          };
        };
      }),
  );
}

test.describe('Betroffene ohne Freitexte auf dem Gerät (LFH-1095)', () => {
  test.skip(bundleFehlt, 'Prod-Bundle fehlt (frontend/dist/sw.js) — vorher `pnpm build`');
  test.skip(!lauf, 'LIFELINE_E2E_LAUF fehlt — Backend-Port unbekannt');

  test('Freitexte bleiben von der Platte fern; UHS und Sichtung tragen nach Kaltstart ohne Netz', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const seitenFehler: string[] = [];
    page.on('pageerror', (f) => seitenFehler.push(f.message));

    await anmelden(page);
    await serviceWorkerZustaendig(page);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E Betroffene offline ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    const uhsId = await post(page, `${basis}/uhs`, {
      typ: 'behandlungsplatz',
      bezeichnung: UHS,
    });
    await post(page, `${basis}/uhs/${uhsId}/status`, { status: 'aktiv' });
    await post(page, `${basis}/personen`, {
      name: NAME,
      sichtung: 'sk2',
      uhs_id: uhsId,
      ...FREITEXTE,
      ...KOORDINATE,
    });

    // (1) Online: Liste und UHS einmal wirklich laden. Die Liste zeigt den Zustand — die
    //     Freitexte waren also im Tab.
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await expect(page.getByText(NAME).first()).toBeVisible();
    await expect(page.getByText(FREITEXTE.zustand).first()).toBeVisible();
    await expect(page.getByText(`UHS ${UHS}`).first()).toBeVisible();
    await innerhalbNavigieren(page, `/einsaetze/${einsatzId}/unfallhilfsstellen/liste`);
    await expect(page.getByText(UHS).first()).toBeVisible();

    // (2) Die Platte, roh: Personen und UHS liegen dort, kein Freitext und keine Koordinate.
    for (const erwartet of ['"einsatz-personen"', '"einsatz-uhs"', NAME]) {
      await expect.poll(() => platteRoh(page), { timeout: 20_000 }).toContain(erwartet);
    }
    const roh = await platteRoh(page);
    expect(roh).toContain('"aktuelle_sichtung":"sk2"');
    for (const wert of [...Object.values(FREITEXTE), String(KOORDINATE.antreff_lat)]) {
      expect(roh, `auf der Platte: ${wert}`).not.toContain(wert);
    }

    // (3) Netz weg — und nachweislich weg.
    await page.context().setOffline(true);
    expect(
      await page.evaluate(() =>
        fetch('/api/health', { cache: 'no-store' }).then(
          (a) => `beantwortet ${a.status}`,
          () => 'scheitert',
        ),
      ),
    ).toBe('scheitert');

    // (4) Betroffene nach Kaltstart: Name, Sichtung und UHS stehen, die Freitexte „nicht
    //     geladen“, und kein „Fundort offen“.
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/^Stand \d\d:\d\d · offline$/).first()).toBeVisible();
    await expect(page.getByText(NAME).first()).toBeVisible();
    await expect(page.getByText('SK II').first()).toBeVisible();
    await expect(page.getByText(`UHS ${UHS}`).first()).toBeVisible();
    await expect(page.locator('[data-lfh="nicht-geladen"]').first()).toBeVisible();
    await expect(page.getByText(FREITEXTE.zustand)).toHaveCount(0);
    await expect(page.getByText('Fundort offen')).toHaveCount(0);
    await expect(page.locator('[data-lfh="offene-felder"]')).toHaveText(
      '0 ohne Verbleib, Fundort nicht geladen',
    );

    // (5) UHS-Liste nach Kaltstart wie mit Netz. Die UHS-Detailseite liest ein eigenes Fach
    //     (`einsatz-uhs-detail`), das schon vor dieser Änderung nicht offline vorgehalten wird.
    await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen/liste`);
    await expect(page.getByText(/^Stand \d\d:\d\d · offline$/).first()).toBeVisible();
    await expect(page.getByText(UHS).first()).toBeVisible();

    await page.context().setOffline(false);
    expect(seitenFehler).toEqual([]);
  });
});
