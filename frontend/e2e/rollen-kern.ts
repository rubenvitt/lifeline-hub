import { expect, type Page } from '@playwright/test';

/**
 * Rollen für die Layout-Gates (LFH-435). Ein Gate, das nur als `admin` misst, läuft durch die
 * freien Zweige der Oberfläche; die gesperrten (Rechtehinweis, Tag „Keine Berechtigung",
 * Sperrgrund) sind oft breiter und blieben ungeprüft — so entstand der Überlauf in LFH-337.
 *
 * Drei Rollen, jede deckt eine Achse
 * (openspec/changes/archive/2026-09-30-lfh-435-e2e-gates-nicht-privilegiert/design.md, D3):
 *  - `beobachter`: System `keiner`, Org `keine`, Einsatzrolle `beobachter` — weder
 *    Verwaltungs- noch Schreibrecht, also alle Nur-Lese-Zweige in einem Benutzer.
 *  - `fuehrungskraft`: Org-Rolle `fuehrungskraft` — kommt in die Verwaltung, ist dort aber kein
 *    System-Admin (Sperrgründe, Rechtehinweis).
 *  - `fuehrungspersonal`: Einsatzrolle — schreibt, leitet aber nicht (Module, Mitglieder).
 *
 * Der Wechsel läuft im SELBEN Kontext (API-Logout im geteilten Cookie-Jar, dann UI-Login):
 * `page.route`-Stubs und `addInitScript`-Einstellungen bleiben so erhalten. Danach jede Route
 * frisch per `goto` ansteuern, sonst trifft eine Seite mit alter Kennung auf 412 (LFH-387).
 */

export const ADMIN = 'admin';
export const ADMIN_PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

export type Rolle = 'beobachter' | 'fuehrungskraft' | 'fuehrungspersonal';

export interface Konto {
  id: number;
  benutzername: string;
  passwort: string;
}

export async function anmeldenAls(page: Page, benutzer: string, passwort: string) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(benutzer);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

export async function anmeldenAlsAdmin(page: Page) {
  await anmeldenAls(page, ADMIN, ADMIN_PW);
}

let zaehler = 0;

/**
 * Legt einen Benutzer an; die angemeldete Sitzung muss ein Admin sein. Ohne `org_rolle` gilt
 * `keiner`/`keine` — die Einsatzrolle kommt erst über {@link mitgliedEintragen}.
 *
 * KURZER Anzeigename als Vorgabe: die Benutzerliste ist global und die Temp-DB lebt über den
 * ganzen Lauf. Dutzende langer Namen verbreiterten die fixierte Namensspalte in
 * `/admin/benutzer` und färbten `fokus-verdeckung` rot (Befund LFH-819). Wer langen Stoff
 * braucht, übergibt ihn ausdrücklich.
 */
export async function benutzerAnlegen(
  page: Page,
  rolle: Rolle,
  anzeigename = `E2E ${rolle}`,
): Promise<Konto> {
  zaehler += 1;
  const benutzername = `e2e-${rolle}-${Date.now()}-${zaehler}-${Math.floor(Math.random() * 1e6)}`;
  const passwort = `e2e-${rolle}-passwort-123`;
  const antwort = await page.request.post('/api/benutzer', {
    data: {
      anzeigename,
      benutzername,
      passwort,
      ...(rolle === 'fuehrungskraft' ? { org_rolle: 'fuehrungskraft' } : {}),
    },
  });
  // Ein still gescheitertes Seeding führte zurück in den Admin-Zustand — grün durch Nichtstun.
  expect(antwort.ok(), `Benutzer ${rolle}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  const { id } = (await antwort.json()) as { id: number };
  return { id, benutzername, passwort };
}

/** Trägt den Benutzer mit Einsatzrolle ein; die Sitzung muss die Einsatzleitung sein. */
export async function mitgliedEintragen(
  page: Page,
  einsatzId: string,
  benutzerId: number,
  einsatzRolle: 'beobachter' | 'fuehrungspersonal' | 'einsatzleitung',
) {
  const antwort = await page.request.put(`/api/einsaetze/${einsatzId}/mitglieder/${benutzerId}`, {
    data: { einsatz_rolle: einsatzRolle },
  });
  expect(
    antwort.ok(),
    `Mitglied ${einsatzRolle}: ${antwort.status()} ${await antwort.text()}`,
  ).toBe(true);
}

/** Wechselt die Sitzung im selben Kontext auf `konto`. */
export async function wechsleZu(page: Page, konto: Pick<Konto, 'benutzername' | 'passwort'>) {
  const abgemeldet = await page.request.post('/api/auth/logout');
  expect(abgemeldet.ok(), `Abmelden: ${abgemeldet.status()}`).toBe(true);
  await anmeldenAls(page, konto.benutzername, konto.passwort);
}

/**
 * Legt den Benutzer der Rolle an, trägt ihn (bei Einsatzrollen) in `einsatzId` ein und wechselt
 * die Sitzung auf ihn. Die aktuelle Sitzung muss der Admin sein, der den Einsatz angelegt hat.
 */
export async function wechsleZuRolle(page: Page, rolle: Rolle, einsatzId?: string): Promise<Konto> {
  const konto = await benutzerAnlegen(page, rolle);
  if (rolle !== 'fuehrungskraft') {
    if (!einsatzId) throw new Error(`Rolle ${rolle} braucht einen Einsatz`);
    await mitgliedEintragen(page, einsatzId, konto.id, rolle);
  }
  await wechsleZu(page, konto);
  return konto;
}
