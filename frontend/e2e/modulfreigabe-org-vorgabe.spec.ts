import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

// Akzeptanz LFH-669 (Spec `modul-freigabe`): eine Org-Vorgabe `fuehrungskraft` sperrt ein Modul
// für ein normales Mitglied. Der Client kennt die Org-Vorgaben nicht; er folgt den Freigaben des
// Servers. Die Navigation zeigt das Modul gesperrt, die Lagekarte fragt dessen Liste nicht an, und
// es steht kein Ausfallhinweis da. Ein Deeplink in das Modul zeigt den Hinweis des Rahmens
// (LFH-888).
//
// Modul `lagemeldungen`: eine Quelle der Lagekarte, die kein anderer Spec mit einer
// Nicht-Admin-Rolle bedient. Die Org-Vorgabe gilt für JEDEN Einsatz der (einen) e2e-Organisation
// und damit auch für parallel laufende Specs — deshalb so kurz wie möglich und im `finally`
// zurückgesetzt.

interface KartenHaken {
  loaded(): boolean;
}

async function karteBereit(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: KartenHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
}

async function orgVorgabe(page: Page, rolle: 'fuehrungskraft' | null) {
  const antwort = await page.request.put('/api/org-modul-einstellungen/lagemeldungen', {
    data: { benoetigte_rolle: rolle },
  });
  expect(antwort.ok(), `Org-Vorgabe: ${antwort.status()} ${await antwort.text()}`).toBe(true);
}

test('Org-Vorgabe sperrt „Lagemeldungen": gesperrt in der Navigation, kein Abruf, kein Ausfall', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmeldenAlsAdmin(page);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Freigabe ${Date.now()}` },
  });
  expect(angelegt.ok(), `Einsatz: ${angelegt.status()}`).toBe(true);
  const einsatzId = String(((await angelegt.json()) as { id: number }).id);

  await orgVorgabe(page, 'fuehrungskraft');
  try {
    await wechsleZuRolle(page, 'beobachter', einsatzId);

    const abrufe: string[] = [];
    page.on('request', (r) => {
      const pfad = new URL(r.url()).pathname;
      if (pfad.startsWith(`/api/einsaetze/${einsatzId}/`)) abrufe.push(pfad);
    });

    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await karteBereit(page);

    // Vorbedingung: freie Kartenquellen liefen — sonst wäre „kein Abruf" trivial.
    await expect
      .poll(() => abrufe.includes(`/api/einsaetze/${einsatzId}/schaeden/marker`))
      .toBe(true);
    expect(abrufe).toContain(`/api/einsaetze/${einsatzId}/modul-freigaben`);

    // Navigation: das Modul steht da, gesperrt, mit Grund.
    const eintrag = page.locator('button[title="Keine Berechtigung"]', {
      hasText: 'Lagemeldungen',
    });
    await expect(eintrag).toBeVisible();
    await expect(eintrag).toBeDisabled();

    // Kein Abruf der gesperrten Liste und kein Ausfallhinweis.
    expect(abrufe).not.toContain(`/api/einsaetze/${einsatzId}/lage/meldungen`);
    await expect(page.getByTestId('lagebild-unvollstaendig')).toHaveCount(0);

    // Deeplink in das gesperrte Modul (LFH-888): der Rahmen zeigt den Hinweis statt der Seite,
    // die Liste wird nicht abgerufen, und der Rückweg führt in ein freies Modul.
    await page.goto(`/einsaetze/${einsatzId}/lagemeldungen`);
    const hinweis = page.getByRole('heading', { level: 1, name: 'Lagemeldungen' });
    await expect(hinweis).toBeVisible();
    await expect(page.getByText('Keine Berechtigung', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Für deine Rolle nicht freigegeben')).toBeVisible();
    // Der Beobachter verwaltet keine Freigaben: kein Weg in die Einstellungen (LFH-1078).
    await expect(page.getByRole('button', { name: 'Modulfreigaben öffnen' })).toHaveCount(0);
    expect(abrufe).not.toContain(`/api/einsaetze/${einsatzId}/lage/meldungen`);

    const rueckweg = page.getByRole('button', { name: / öffnen$/ });
    await rueckweg.click();
    await expect(page).not.toHaveURL(/\/lagemeldungen/);
    await expect(hinweis).toHaveCount(0);
    expect(abrufe).not.toContain(`/api/einsaetze/${einsatzId}/lage/meldungen`);
  } finally {
    // Zurück auf den Admin — nur er darf die Org-Vorgabe setzen.
    await page.request.post('/api/auth/logout');
    await anmeldenAlsAdmin(page);
    await orgVorgabe(page, null);
  }
});

// Akzeptanz LLH-1179 (Spec `modul-freigabe`): die Organisation blendet ein Modul für alle Einsätze
// aus, der Einsatz überstimmt und nimmt den eigenen Wert zurück — die Bedienkette von der
// Verwaltung bis zur Navigation.
//
// OHNE Org-weiten Zustand auf dem Server: eine Sichtbarkeits-Vorgabe gälte für jeden Einsatz der
// einen e2e-Organisation, und jedes Modul wird von einem parallel laufenden Spec angesprochen
// (`e2e/AGENTS.md`, LFH-820: keine Org-Vorgabe säen). Die Vorgabe lebt deshalb nur in diesem
// Browser: `page.route` beantwortet die Org-Vorgaben und legt sie über die echten Freigaben, so wie
// der Server rechnet (eigener Wert des Einsatzes ?? Vorgabe). Die Serverregel selbst belegen
// `tests/modul_freigaben.rs` und `tests/org_einstellungen.rs`.

const MODUL = 'nachforderungen';

/** Der Eintrag „Nachforderung“ im Modul-Panel der Kategorie Kommunikation. */
function nachforderungImPanel(page: Page) {
  return page.getByRole('button', { name: /^Nachforderung(,|$)/ });
}

async function kommunikationOeffnen(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/meldungen`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Meldungen (eingehend)' }),
  ).toBeVisible();
}

/** Org-Vorgabe nur im Browser; liefert die PUT-Bodies der Verwaltung zur Prüfung. */
async function orgVorgabeImBrowser(page: Page, einsatzId: string) {
  const zustand = { orgAus: false, eigen: null as boolean | null, puts: [] as unknown[] };
  await page.route('**/api/org-modul-einstellungen', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      json: zustand.orgAus ? { [MODUL]: { benoetigte_rolle: null, sichtbar: false } } : {},
    });
  });
  await page.route(`**/api/org-modul-einstellungen/${MODUL}`, async (route) => {
    const body = route.request().postDataJSON() as { sichtbar?: boolean };
    zustand.puts.push(body);
    zustand.orgAus = body.sichtbar === false;
    await route.fulfill({ status: 200, body: '' });
  });
  // Der Override geht echt an den Server (er gehört nur diesem Einsatz); gemerkt wird der eigene
  // Wert, damit die Freigaben unten wie auf dem Server rechnen.
  await page.route(`**/api/einsaetze/${einsatzId}/modul-overrides/${MODUL}`, async (route) => {
    const body = route.request().postDataJSON() as { sichtbar: boolean | null };
    zustand.eigen = body.sichtbar ?? null;
    await route.continue();
  });
  await page.route(`**/api/einsaetze/${einsatzId}/modul-freigaben`, async (route) => {
    const antwort = await route.fetch();
    const json = (await antwort.json()) as Record<string, { sichtbar: boolean; zugriff: boolean }>;
    if (zustand.orgAus && zustand.eigen === null) json[MODUL] = { ...json[MODUL], sichtbar: false };
    await route.fulfill({ response: antwort, json });
  });
  return zustand;
}

test('Org blendet „Nachforderung" für alle Einsätze aus, der Einsatz überstimmt und übernimmt die Vorgabe wieder', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmeldenAlsAdmin(page);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Sichtbarkeit ${Date.now()}` },
  });
  expect(angelegt.ok(), `Einsatz: ${angelegt.status()}`).toBe(true);
  const einsatzId = String(((await angelegt.json()) as { id: number }).id);
  const zustand = await orgVorgabeImBrowser(page, einsatzId);

  // Vorbedingung: ohne Vorgabe steht das Modul in der Navigation.
  await kommunikationOeffnen(page, einsatzId);
  await expect(nachforderungImPanel(page)).toBeVisible();

  // Verwaltung: im Paneel „Module für alle Einsätze“ ausblenden.
  await page.goto('/admin/einstellungen/einsatz');
  const paneel = page.getByRole('region', { name: 'Module für alle Einsätze' });
  await expect(
    paneel.getByText('Wirkt auf alle Einsätze ohne eigene Einstellung, auch auf laufende.'),
  ).toBeVisible();
  await paneel.getByLabel('Modul filtern').fill('Nachforderung');
  const vorgabe = paneel.getByRole('switch', { name: 'Sichtbar: Nachforderung' });
  await expect(vorgabe).toBeChecked();
  await vorgabe.click();
  await expect(page.getByText('Modul-Vorgabe gespeichert')).toBeVisible();
  await expect(vorgabe).not.toBeChecked();
  expect(zustand.puts).toEqual([{ benoetigte_rolle: null, sichtbar: false }]);

  // Der laufende Einsatz ohne eigenen Wert folgt der Vorgabe.
  await kommunikationOeffnen(page, einsatzId);
  await expect(nachforderungImPanel(page)).toHaveCount(0);

  // Editor „Module“: geerbt aus, mit Herkunft; Einlegen überstimmt.
  await page.goto(`/einsaetze/${einsatzId}/einstellungen/module`);
  await page.getByLabel('Modul filtern').fill('Nachforderung');
  const schalter = page.getByRole('switch', { name: 'Sichtbar: Nachforderung' });
  const zeile = page.locator('[data-modul-zeile="nachforderungen"]');
  await expect(schalter).not.toBeChecked();
  await expect(zeile.getByText('Vorgabe der Organisation: ausgeblendet')).toBeVisible();
  const uebernehmen = page.getByRole('button', { name: 'Vorgabe übernehmen: Nachforderung' });
  await expect(uebernehmen).toHaveCount(0);
  await schalter.click();
  await expect(schalter).toBeChecked();
  await expect(uebernehmen).toBeVisible();

  await kommunikationOeffnen(page, einsatzId);
  await expect(nachforderungImPanel(page)).toBeVisible();

  // „Vorgabe übernehmen“ nimmt den eigenen Wert zurück: wieder ausgeblendet.
  await page.goto(`/einsaetze/${einsatzId}/einstellungen/module`);
  await page.getByLabel('Modul filtern').fill('Nachforderung');
  await uebernehmen.click();
  await expect(schalter).not.toBeChecked();
  await expect(uebernehmen).toHaveCount(0);

  await kommunikationOeffnen(page, einsatzId);
  await expect(nachforderungImPanel(page)).toHaveCount(0);
});
