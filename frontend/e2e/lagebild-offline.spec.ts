import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lagebild ohne Netz lesen (LFH-723, design.md D10).
//
// Der Weg ist der des Feldes: Einsatz mit Netz öffnen, Netz weg, NEU LADEN. Das ist nur mit
// einem Service Worker überhaupt möglich — die Shell muss offline aus dem Precache kommen —,
// deshalb läuft dieser Spec wie `lagekarte-offline-precache.spec.ts` gegen den Prod-Bundle,
// den das e2e-Backend ausliefert (Begründung und Auslieferungspfad stehen dort im Kopf).
//
// DIE VORBEDINGUNGEN SIND TEIL DER AUSSAGE, sonst wäre der Test grün durch Konstruktion:
//  - Der vorgehaltene Stand liegt in der IndexedDB, BEVOR das Netz weggeht (gelesen, nicht
//    auf eine Uhr gewartet — die Speicherung ist gedrosselt).
//  - `/api/health` scheitert offline. Sonst wäre der Offline-Schalter wirkungslos, und die
//    Seiten zeigten schlicht frisch geladene Daten.
//  - Die angezeigte Uhrzeit ist die der Online-Antwort, nicht die des Neuladens.
//
// Die Lagekarte ist hier mit Kopfzahl und Datenstand dabei. Ob sie ihre Ebenen ohne Netz
// ZEICHNET, misst `lagekarte-offline-zeichnen.spec.ts` im Dev-Server — der Prod-Bundle trägt
// den Karten-Haken `__lfhKarte` nicht.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const distPfad = fileURLToPath(new URL('../dist', import.meta.url));
const swPfad = `${distPfad}/sw.js`;
const bundleFehlt = !existsSync(swPfad);

const lauf = process.env.LIFELINE_E2E_LAUF;
const backendUrl = lauf
  ? `http://127.0.0.1:${(JSON.parse(lauf) as { backendPort: number }).backendPort}`
  : '';

test.use({ baseURL: backendUrl || undefined });

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

/** Service Worker aktiv UND zuständig — Muster und Begründung: `lagekarte-offline-precache`.
 *  `registerType: 'prompt'` setzt kein `clientsClaim`: zuständig wird er erst für eine Seite,
 *  die NACH seiner Aktivierung geladen wurde — deshalb das Neuladen nach `ready`. */
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
          if (!reg) return 'keine Registrierung';
          if (reg.active?.state !== 'activated') return `Zustand ${reg.active?.state ?? 'ohne'}`;
          return navigator.serviceWorker.controller ? 'aktiv und zuständig' : 'nicht zuständig';
        }),
      { timeout: 30_000, message: 'Service Worker wird nie aktiv/zuständig' },
    )
    .toBe('aktiv und zuständig');
}

/** Navigation innerhalb der App (Data Router hört auf `popstate`), ohne Dokument-Abruf. */
async function innerhalbNavigieren(page: Page, pfad: string) {
  await page.evaluate((ziel) => {
    window.history.pushState({}, '', ziel);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, pfad);
}

/** Die ersten Elemente der Query-Keys im vorgehaltenen Stand (leer = kein Datensatz). */
async function vorgehalteneKeys(page: Page): Promise<string[] | null> {
  return page.evaluate(
    () =>
      new Promise<string[] | null>((fertig) => {
        const anfrage = indexedDB.open('lifeline-lagebild');
        anfrage.onerror = () => fertig(null);
        anfrage.onsuccess = () => {
          const db = anfrage.result;
          if (!db.objectStoreNames.contains('stand')) {
            db.close();
            fertig(null);
            return;
          }
          const lesen = db.transaction('stand').objectStore('stand').get('aktuell');
          lesen.onsuccess = () => {
            const satz = lesen.result as
              { client: { clientState: { queries: { queryKey: unknown[] }[] } } } | undefined;
            db.close();
            fertig(satz ? satz.client.clientState.queries.map((q) => String(q.queryKey[0])) : null);
          };
          lesen.onerror = () => {
            db.close();
            fertig(null);
          };
        };
      }),
  );
}

/** Zahl der Einträge der Offline-Queue (ETB) — die Beweissicherung, die nie mitgelöscht wird. */
async function queueEintraege(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((fertig) => {
        const anfrage = indexedDB.open('lifeline-offline');
        anfrage.onerror = () => fertig(-1);
        anfrage.onsuccess = () => {
          const db = anfrage.result;
          if (!db.objectStoreNames.contains('ausstehend')) {
            db.close();
            fertig(0);
            return;
          }
          const zaehlen = db.transaction('ausstehend').objectStore('ausstehend').count();
          zaehlen.onsuccess = () => {
            db.close();
            fertig(zaehlen.result);
          };
          zaehlen.onerror = () => {
            db.close();
            fertig(-1);
          };
        };
      }),
  );
}

const ROUTEN = [
  { name: 'ETB', modul: 'etb', inhalt: 'Offline-Probe Lagemeldung' },
  { name: 'Meldebild', modul: 'kraefteuebersicht', inhalt: 'Offline-Probe Zug' },
  { name: 'Betroffene', modul: 'personen', inhalt: 'Offlineprobe' },
  { name: 'Aufträge', modul: 'auftraege', inhalt: 'Offline-Probe Auftrag' },
  { name: 'Lagekarte', modul: 'lagekarte', inhalt: null },
] as const;

/** Die Prefixe, die nach dem Besuch aller fünf Seiten mindestens auf der Platte liegen. */
const ERWARTETE_PREFIXE = [
  'einsatz',
  'etb',
  'einsatz-einheiten',
  'einsatz-personen',
  'einsatz-auftraege',
  'einsatz-zonen',
];

test.describe('Lagebild ohne Netz (LFH-723)', () => {
  test.skip(bundleFehlt, 'Prod-Bundle fehlt (frontend/dist/sw.js) — vorher `pnpm build`');
  test.skip(!lauf, 'LIFELINE_E2E_LAUF fehlt — Backend-Port unbekannt');

  test('nach dem Neuladen ohne Netz zeigen die fünf Seiten ihren letzten Stand, gekennzeichnet', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const seitenFehler: string[] = [];
    page.on('pageerror', (f) => seitenFehler.push(f.message));

    await anmelden(page);
    await serviceWorkerZustaendig(page);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E Funkloch ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    await post(page, `${basis}/etb`, {
      typ: 'meldung',
      inhalt: 'Offline-Probe Lagemeldung',
      von: 'ELW 1',
      an: 'Leitstelle',
    });
    const einheit = await post(page, `${basis}/einheiten`, { name: 'Offline-Probe Zug' });
    const position = await page.request.patch(`${basis}/einheiten/${einheit}/position`, {
      data: { lat: 53.0775, lon: 8.8 },
    });
    expect(position.ok(), await position.text()).toBeTruthy();
    await post(page, `${basis}/personen`, { name: 'Offlineprobe' });
    await post(page, `${basis}/auftraege`, {
      auftrag_text: 'Offline-Probe Auftrag',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'S3' }],
    });

    // (1) Online: jede Seite einmal wirklich laden und ihren Datenstand merken — per Navigation
    //     INNERHALB der App, wie im Betrieb. Ein `page.goto` je Seite lüde jedes Mal das ganze
    //     Dokument neu und verließe die Seite vor Ablauf der 1-s-Drosselung (design.md,
    //     Risiken): der Stand der vorigen Seite erreichte die Platte dann nie.
    const standOnline = new Map<string, string>();
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    for (const route of ROUTEN) {
      await innerhalbNavigieren(page, `/einsaetze/${einsatzId}/${route.modul}`);
      const kopf = page.locator('[data-lfh="seitenkopf"]').first();
      if (route.inhalt) await expect(page.getByText(route.inhalt).first()).toBeVisible();
      else await expect(kopf).toContainText('1 verortet');
      // Seitenweit, nicht nur im Seitenkopf: die Aufträge führen ihren Stand im Abschnittskopf.
      const stand = page.getByText(/^Stand \d\d:\d\d$/).first();
      await expect(stand).toBeVisible({ timeout: 30_000 });
      standOnline.set(route.name, (await stand.textContent())!);
    }

    // (2) Vorbedingung: der Stand liegt auf der Platte — gelesen, nicht erwartet.
    await expect
      .poll(async () => (await vorgehalteneKeys(page)) ?? [], { timeout: 20_000 })
      .toEqual(expect.arrayContaining(ERWARTETE_PREFIXE));
    // Und nur die Allowlist: ETB-Druck, Chat und Personen-Audit tauchen nicht auf.
    const keys = (await vorgehalteneKeys(page))!;
    expect(keys.filter((k) => /druck|chat|audit/.test(k))).toEqual([]);

    // (3) Netz weg — und nachweislich weg. Die Uhrzeit des Schalters begrenzt unten die
    //     erlaubte Anzeige: eine Seite, die online nach ihrer Ablesung noch einmal abrief
    //     (`staleTime` 10 s), darf eine spätere Online-Minute zeigen, aber keine nach dem
    //     Schalter — das wäre die Zeit des Neuladens.
    const offlineAb = await page.evaluate(() => {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    });
    await page.context().setOffline(true);
    expect(
      await page.evaluate(() =>
        fetch('/api/health', { cache: 'no-store' }).then(
          (a) => `beantwortet ${a.status}`,
          () => 'scheitert',
        ),
      ),
    ).toBe('scheitert');

    // (4) Jede Seite neu laden: Inhalt steht, Datenstand trägt die Online-Uhrzeit und „offline".
    for (const route of ROUTEN) {
      await page.goto(`/einsaetze/${einsatzId}/${route.modul}`);
      await expect(page, `${route.name}: nicht auf der Anmeldung`).not.toHaveURL(/\/login/);
      const kopf = page.locator('[data-lfh="seitenkopf"]').first();
      if (route.inhalt) await expect(page.getByText(route.inhalt).first()).toBeVisible();
      else await expect(kopf).toContainText('1 verortet');
      const anzeige = page.getByText(/^Stand \d\d:\d\d · offline$/).first();
      await expect(anzeige).toBeVisible();
      const uhrzeit = (await anzeige.textContent())!.slice('Stand '.length, 'Stand '.length + 5);
      const online = standOnline.get(route.name)!.slice('Stand '.length);
      expect(uhrzeit >= online && uhrzeit <= offlineAb, `${route.name}: ${uhrzeit}`).toBe(true);
    }

    expect(seitenFehler).toEqual([]);
  });

  test('nach dem Abmelden liegt kein Stand mehr auf dem Gerät, die Offline-Queue bleibt', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await anmelden(page);
    await serviceWorkerZustaendig(page);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E Abmeldung ${Date.now()}`,
    });
    await post(page, `/api/einsaetze/${einsatzId}/etb`, {
      typ: 'meldung',
      inhalt: 'Offline-Probe vor dem Abmelden',
      von: 'ELW 1',
      an: 'Leitstelle',
    });
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(page.getByText('Offline-Probe vor dem Abmelden')).toBeVisible();
    await expect
      .poll(async () => (await vorgehalteneKeys(page)) ?? [], { timeout: 20_000 })
      .toContain('etb');

    // Eine vorgemerkte Erfassung: offline absenden, sie liegt dann in der Queue.
    await page.context().setOffline(true);
    const feld = page.getByRole('textbox', { name: /Inhalt/ }).first();
    await feld.fill('Offline-Probe in der Queue');
    await feld.press('Enter');
    await expect.poll(() => queueEintraege(page), { timeout: 10_000 }).toBe(1);

    // Abmelden OHNE Netz: der Server-Logout scheitert, lokal wird trotzdem abgemeldet — und
    // gelöscht. Mit Netz spülte der Flush die Queue vor dem Abmelden leer, und „sie bleibt"
    // wäre nicht mehr prüfbar (gemessen).
    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/login/);

    await expect.poll(() => vorgehalteneKeys(page), { timeout: 10_000 }).toBeNull();
    expect(await queueEintraege(page)).toBe(1);
    await page.context().setOffline(false);
  });
});
