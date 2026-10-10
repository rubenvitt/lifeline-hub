import {
  expect,
  request,
  test as basis,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN, ADMIN_PW, type Konto } from '../rollen-kern';

/**
 * Helfer der Bilder-Specs (LFH-1128, `docs/anwender/AGENTS.md`, „Bilder“). Eine Bilder-Spec liegt
 * als `e2e/doku-bilder/<kapitel>.bilder.ts` neben diesem Kern und fotografiert, was das Kapitel
 * `docs/anwender/kapitel/<kapitel>.md` zeigt. Lauf: `playwright.doku.config.ts`.
 *
 * Ablauf einer Aufnahme:
 *   1. `anmelden(page)` — Admin per API im Kontext der Seite (Cookie gilt für Seite und
 *      `page.request`);
 *   2. Lücken der Demo-Daten füllen: `demoEinsatz(page)` und `fuelle(page, …)` (D3);
 *   3. `uhrAnhalten(page)` vor dem ersten `goto`;
 *   4. auf einen Inhaltsanker warten, nie auf `networkidle` (e2e/AGENTS.md, SSE);
 *   5. `fotografiere(locator, '<kapitel>', '<name>')`.
 */

export { expect };

/**
 * Das kopflose Chromium meldet `Notification.permission` als `'denied'`, auch mit der Berechtigung
 * `notifications`; die Kopfleiste zeigte dann in jedem Bild „Benachrichtigung blockiert“. Die
 * Aufnahmen zeigen den Zustand eines Geräts, auf dem die Benachrichtigung erlaubt ist. Gilt für
 * jede Seite des Kontexts; einen eigenen Kontext (`browser.newContext()`) deckt es nicht ab.
 */
export const test = basis.extend({
  context: async ({ context }, weiter) => {
    await context.addInitScript(() => {
      if (typeof Notification !== 'undefined') {
        Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
      }
    });
    await weiter(context);
  },
});
export { KONTEXTE, type Kontext } from './kontexte';

/** `docs/anwender/` dieses Checkouts: relativ zur Datei, damit ein Worktree in sich schreibt. */
const ANWENDER = fileURLToPath(new URL('../../../docs/anwender/', import.meta.url));

/** Größte erlaubte Bilddatei, wie im Wächter (`hilfe/anwenderdoku.guard.test.ts`). */
const BILD_GRENZE = 300 * 1024;

/**
 * Was ein Bild nie zeigen soll: die Werkzeuge des Dev-Servers (TanStack-Devtools-Knopf). Gilt nur
 * während der Aufnahme (Playwright `style`), die Seite selbst bleibt unverändert.
 */
const AUFNAHME_STIL = '.tsqd-parent-container { display: none !important; }';

/** Pfad eines Bildes: `docs/anwender/bilder/<kapitel>/<name>.png` in diesem Checkout. */
export function bildDatei(kapitel: string, name: string): string {
  return join(ANWENDER, 'bilder', kapitel, `${name}.png`);
}

/**
 * Fotografiert `ziel` (ein Element, sonst die sichtbare Seite) als
 * `docs/anwender/bilder/<kapitel>/<name>.png` und gibt den Pfad zurück. Rot, wenn es das Kapitel
 * nicht gibt, der Name nicht der Form `[a-z0-9-]+` folgt oder das Bild über 300 KB wiegt (dann
 * den Ausschnitt verkleinern: Maske, Liste oder Dialog statt ganzer Seite).
 */
export async function fotografiere(
  ziel: Locator | Page,
  kapitel: string,
  name: string,
): Promise<string> {
  expect(kapitel, 'Kapitel als Dateiname ohne .md').toMatch(/^[a-z0-9-]+$/);
  expect(name, 'Bildname aus Kleinbuchstaben, Ziffern und Bindestrich').toMatch(/^[a-z0-9-]+$/);
  expect(
    existsSync(join(ANWENDER, 'kapitel', `${kapitel}.md`)),
    `Kapitel docs/anwender/kapitel/${kapitel}.md fehlt`,
  ).toBe(true);
  const seite = 'goto' in ziel ? ziel : ziel.page();
  // Schriften nachgeladen (theme/schriften.ts lädt sie über die FontFace-API).
  await seite.evaluate(() => document.fonts.ready.then(() => undefined));
  const pfad = bildDatei(kapitel, name);
  mkdirSync(dirname(pfad), { recursive: true });
  await ziel.screenshot({
    path: pfad,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    style: AUFNAHME_STIL,
  });
  const groesse = statSync(pfad).size;
  expect(
    groesse,
    `${kapitel}/${name}.png wiegt ${Math.ceil(groesse / 1024)} KB, Grenze 300 KB`,
  ).toBeLessThanOrEqual(BILD_GRENZE);
  return pfad;
}

/**
 * Meldet `konto` (Vorgabe: der Admin) per API im Kontext der Seite an. Danach sind Seite und
 * `page.request` angemeldet; das erste `goto` landet nicht auf der Anmeldeseite.
 */
export async function anmelden(
  page: Page,
  konto: Pick<Konto, 'benutzername' | 'passwort'> = { benutzername: ADMIN, passwort: ADMIN_PW },
) {
  const antwort = await page.request.post('/api/auth/login', {
    data: { benutzername: konto.benutzername, passwort: konto.passwort },
  });
  expect(antwort.ok(), `Anmeldung ${konto.benutzername}: ${antwort.status()}`).toBe(true);
}

/**
 * Eigener, als Admin angemeldeter API-Kontext, etwa für Füllungen in `beforeAll`. Der Aufrufer
 * räumt ihn mit `dispose()`.
 */
export async function apiAlsAdmin(): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  const antwort = await api.post('/api/auth/login', {
    data: { benutzername: ADMIN, passwort: ADMIN_PW },
  });
  expect(antwort.ok(), `Admin-Anmeldung: ${antwort.status()}`).toBe(true);
  return api;
}

export interface DemoEinsatz {
  id: number;
  bezeichnung: string;
  /** Zeitpunkt des Imports; die Szenariouhr legt die Demo-Ereignisse relativ dazu. */
  importiertAt: Date;
}

function apiVon(quelle: Page | APIRequestContext): APIRequestContext {
  return 'goto' in quelle ? quelle.request : quelle;
}

/** Der Übungseinsatz aus `POST /api/demo-daten` (eingespielt in `vorbereitung.ts`). */
export async function demoEinsatz(quelle: Page | APIRequestContext): Promise<DemoEinsatz> {
  const antwort = await apiVon(quelle).get('/api/demo-daten');
  expect(antwort.ok(), `Demo-Daten: ${antwort.status()}`).toBe(true);
  const status = (await antwort.json()) as {
    importiert: boolean;
    import?: { einsatz_id: number; einsatz_bezeichnung: string; importiert_at: string };
  };
  expect(status.importiert && status.import, 'Demo-Daten nicht eingespielt').toBeTruthy();
  const kopf = status.import!;
  return {
    id: kopf.einsatz_id,
    bezeichnung: kopf.einsatz_bezeichnung,
    // UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`, src/demo/mod.rs).
    importiertAt: new Date(`${kopf.importiert_at.replace(' ', 'T')}Z`),
  };
}

/**
 * Füllt eine Lücke der Demo-Daten über die API (Design LFH-1127, D3) und gibt die Antwort zurück.
 * Rot mit Status und Text, wenn der Server ablehnt: eine still gescheiterte Füllung ergäbe ein
 * leeres Bild. Pfade wie im Frontend (`/api/einsaetze/<id>/…`).
 */
export async function fuelle<T = unknown>(
  quelle: Page | APIRequestContext,
  methode: 'post' | 'put' | 'patch' | 'delete',
  pfad: string,
  daten?: unknown,
): Promise<T> {
  const antwort = await apiVon(quelle)[methode](pfad, daten === undefined ? {} : { data: daten });
  expect(
    antwort.ok(),
    `${methode.toUpperCase()} ${pfad}: ${antwort.status()} ${await antwort.text()}`,
  ).toBe(true);
  const text = await antwort.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Hält die Browser-Uhr an (`page.clock.setFixedTime`), vor dem ersten `goto` aufrufen. Ohne
 * Zeitpunkt: die nächste volle Minute ab jetzt, also kurz nach dem Import und nach den eigenen
 * Füllungen (die der Server mit seiner Uhr stempelt; ein früherer Zeitpunkt zeigte sie in der
 * Zukunft). Timer laufen weiter, nur `Date` steht.
 */
export async function uhrAnhalten(page: Page, zeit?: Date): Promise<Date> {
  const jetzt = zeit ?? new Date(Math.ceil(Date.now() / 60_000) * 60_000);
  await page.clock.setFixedTime(jetzt);
  return jetzt;
}
