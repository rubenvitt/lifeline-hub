import { expect, type Page } from '@playwright/test';

/**
 * Hilfen der Funkplan-Specs (LFH-548), geteilt von `funkplan.spec.ts` und `funkplan-druck.spec.ts`
 * (LFH-915) — Muster `rollen-kern.ts`: wer einen Helfer braucht, nimmt ihn von hier statt einer
 * Kopie.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
export const FUEKW = { width: 1366, height: 768 };
/** A4 hoch, nutzbar (wie `meldebild-druck.spec.ts`, `druck-fluss.spec.ts`). */
export const A4_DRUCKBREITE = 680;
export const SUBPIXEL = 0.5;

/** Absichtlich lange, aber reale Werte (dieselben wie in der Messung vor dem Bau). */
export const ABSCHNITT = 'Deichverteidigung Nordwest II';
export const KURZ = 'EA-NORD-2';
export const EINHEIT = 'Fachgruppe Wasserschaden Musterstadt-Nordwest';
export const EINHEIT_RUF = 'Florian Musterstadt 1/10';
export const ERREICHBAR = '+49 171 1234567';
export const FAHRZEUG = 'Florian Musterstadt-Nordwest 1/42-1';
const FUEHRER = 'Kirchgassner-Wohlfahrt, Maximiliane';
export const LOKAL = 'DMO 999 Reserve';

export async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

export async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/**
 * Ein Abschnitt mit Sprechgruppen, eine Einheit darunter mit Erreichbarkeit und ohne
 * Sprechgruppe, ein Fahrzeug mit Führer in der Einheit, ein Fahrzeug ohne Einheit (Sammelknoten)
 * und eine nicht zugeordnete einsatzlokale Sprechgruppe: jede Lücke hat einen Treffer.
 */
export async function seede(page: Page, einsatzId: string) {
  const basis = `/api/einsaetze/${einsatzId}`;
  const post = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(`${basis}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  };
  const tmo = await post('sprechgruppen', { bezeichnung: 'TMO 412_F_DRK', betriebsart: 'TMO' });
  const dmo = await post('sprechgruppen', { bezeichnung: 'DMO 505', betriebsart: 'DMO' });
  await post('sprechgruppen', { bezeichnung: LOKAL, betriebsart: 'DMO' });
  const abschnitt = await post('abschnitte', {
    name: ABSCHNITT,
    kurzbezeichnung: KURZ,
    kommunikationsmittel: 'digitalfunk',
    sprechgruppe_ids: [tmo, dmo],
  });
  const einheit = await post('einheiten', {
    name: EINHEIT,
    funkrufname: EINHEIT_RUF,
    abschnitt_id: abschnitt,
    erreichbarkeit: ERREICHBAR,
  });
  const fahrzeug = await post('fahrzeuge', {
    adhoc: { funkrufname: FAHRZEUG, fahrzeugtyp: 'HLF 20' },
  });
  const zuordnung = await page.request.put(`${basis}/einheiten/${einheit}/fahrzeug/${fahrzeug}`);
  expect(zuordnung.ok(), `Zuordnung: ${await zuordnung.text()}`).toBeTruthy();
  const fuehrer = await post('personal', {
    adhoc: { name: FUEHRER, staerke_position: 'fuehrer' },
  });
  const besatzung = await page.request.put(`${basis}/fahrzeuge/${fahrzeug}/besatzung/${fuehrer}`);
  expect(besatzung.ok(), `Besatzung: ${await besatzung.text()}`).toBeTruthy();
  await post('fahrzeuge', { adhoc: { funkrufname: 'Florian ELW 1' } });
  return { einheit };
}

export const tabelle = (page: Page) => page.getByRole('region', { name: 'Funkplan' });

export async function oeffne(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/stab/funkplan`);
  // Datenanker: das Fahrzeug steht erst, wenn Abschnitt, Einheit und Fahrzeug geladen sind.
  await expect(tabelle(page).getByText(FAHRZEUG)).toBeVisible();
}

/** Eine absichtlich lange, aber reale Bezeichnung (≥ 24 Zeichen). */
export const SG_LANG = 'TMO 412_F_DRK Nordwest-Reserve';

/** Ein Zweck von 60 Zeichen, wie ihn der S6 in den Hinweis schreibt. */
export const SG_HINWEIS = 'Führungskanal EA Nordwest, Ausweich bei Störung auf DMO 505';
export const EINHEIT_ZWEI = 'Technischer Zug Musterstadt-Südost';

export async function seedeSprechgruppen(page: Page, einsatzId: string) {
  const basis = `/api/einsaetze/${einsatzId}`;
  const post = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(`${basis}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  };
  const tmo = await post('sprechgruppen', {
    bezeichnung: SG_LANG,
    betriebsart: 'TMO',
    hinweis: SG_HINWEIS,
  });
  const dmo = await post('sprechgruppen', { bezeichnung: 'DMO 505', betriebsart: 'DMO' });
  await post('sprechgruppen', { bezeichnung: LOKAL, betriebsart: 'DMO' });
  const abschnitt = await post('abschnitte', {
    name: ABSCHNITT,
    kurzbezeichnung: KURZ,
    sprechgruppe_ids: [tmo, dmo],
  });
  const einheit = await post('einheiten', {
    name: EINHEIT,
    funkrufname: EINHEIT_RUF,
    abschnitt_id: abschnitt,
    sprechgruppe_ids: [tmo],
  });
  await post('einheiten', {
    name: EINHEIT_ZWEI,
    funkrufname: 'Florian Musterstadt 2/10',
    abschnitt_id: abschnitt,
    sprechgruppe_ids: [tmo, dmo],
  });
  return { einheit };
}

export const sprechgruppenSicht = (page: Page) =>
  page.getByRole('region', { name: 'Sprechgruppen' });
export const sgZeile = (page: Page, bezeichnung: string) =>
  sprechgruppenSicht(page).locator('tr.ant-table-row').filter({ hasText: bezeichnung });
