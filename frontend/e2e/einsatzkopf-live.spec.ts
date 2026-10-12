import { expect, test, type Page } from '@playwright/test';
import {
  einsatzModulPfad,
  lagebesprechungPfad,
  stabPfad,
  ueberblickPfad,
} from '../src/routing/deeplinks';
import { anmeldenAls, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/**
 * Der Einsatzkopf ist live (LFH-555): ein Termin, den ein anderer Schirm setzt, erscheint ohne
 * Neuladen. Seit LLH-1111 setzt ihn nur das Modul Lagebesprechung (`PUT …/lagebesprechung/termin`
 * oder der Abschluss `POST …/lagebesprechungen`); der Kopf-PATCH lehnt das Feld mit 400 ab. Es
 * folgen die Zeile „Nächste Lagebesprechung“ der Stab-Seite, die Marke im Führungsüberblick und
 * die Seite Lagebesprechung selbst.
 *
 * Der „andere Schirm" schreibt über die API derselben Sitzung; was hier zählt, ist der Weg über
 * den Live-Strom in die offene Seite. Die Seite wartet auf die Antwort von `/live`, BEVOR
 * geschrieben wird: der Server abonniert vor dem ersten Byte, ein früheres Ereignis ginge sonst
 * verloren (kein Refetch-Fallback, vgl. `kernfluss.spec.ts`). Kein `networkidle` (LFH-385).
 *
 * Mutationsprobe (LFH-555, 5.2): `einsatz` aus `EINSATZ_STREAM_EVENTS` genommen → die Stab-Zeile
 * und der Überblick bleiben stehen, beide Termin-Tests rot.
 *
 * LFH-854: ein Rollenwechsel im Einsatz feuert ebenfalls `einsatz`; der Schirm der betroffenen
 * Person zeigt ihr neues Schreibrecht ohne Neuladen. Mutationsprobe: Emitter in
 * `mitglied_setzen` entfernt → der Rollenwechsel-Test rot.
 *
 * LFH-855: Das Umschalten einer Lagekennzahl läuft über dasselbe Ereignis; das Lage-Dashboard hält
 * seinen Zuschnitt und bietet den neuen per Sammelbanner an. Mutationsprobe: Emitter in
 * `routes/pegel.rs` entfernt → der Pegel-Test rot.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmeldenUndAnlegen(page: Page): Promise<number> {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Einsatzkopf live ${Date.now()}` },
  });
  expect(antwort.ok()).toBeTruthy();
  return (await antwort.json()).id as number;
}

/** Öffnet `pfad` und wartet, bis der Live-Strom des Einsatzes steht. */
async function oeffnenMitStrom(page: Page, pfad: string, id: number) {
  const strom = page.waitForResponse(
    (r) => r.url().endsWith(`/api/einsaetze/${id}/live`) && r.status() === 200,
  );
  await page.goto(pfad);
  await strom;
}

/** Ein Termin in zwei Stunden, auf die Minute gerundet (RFC 3339; der Server normalisiert). */
function terminInZweiStunden(): string {
  const t = new Date(Date.now() + 2 * 60 * 60 * 1000);
  t.setUTCSeconds(0, 0);
  return t.toISOString();
}

/** Die Zeile „Nächste Lagebesprechung“ der Stab-Seite (`lagebesprechung/LagebesprechungZeile.tsx`). */
const stabZeile = (page: Page) => page.getByRole('group', { name: 'Nächste Lagebesprechung' });

/** Die Kennzahl „Nächste Lagebesprechung“ im Paneel „Termin“ der Seite Lagebesprechung. */
const terminKennzahl = (page: Page) =>
  page
    .getByRole('region', { name: 'Termin', exact: true })
    .locator('[data-lfh="kennzahl"]')
    .filter({ hasText: 'Nächste Lagebesprechung' });

/** Zustand eines Termins in rund zwei Stunden („in 1 h 59 min“ oder „in 2 h 00 min“). */
const IN_ZWEI_STUNDEN = /in (1 h 5\d|2 h 00) min/;

test('LLH-1111: ein anderer Schirm setzt den Termin, die offene Stab-Zeile folgt', async ({
  page,
}) => {
  const id = await anmeldenUndAnlegen(page);
  await oeffnenMitStrom(page, stabPfad(id), id);
  const zeile = stabZeile(page);
  await expect(zeile.getByText('kein Termin', { exact: true })).toBeVisible();

  // Der Kopf-PATCH lehnt den Termin ab, laut statt still: es gibt nur einen Schreibweg.
  const patch = await page.request.patch(`/api/einsaetze/${id}`, {
    data: { naechste_lagebesprechung_at: terminInZweiStunden() },
  });
  expect(patch.status()).toBe(400);

  const termin = await page.request.put(`/api/einsaetze/${id}/lagebesprechung/termin`, {
    data: { naechste_at: terminInZweiStunden() },
  });
  expect(termin.ok()).toBeTruthy();

  await expect(zeile.getByText(IN_ZWEI_STUNDEN)).toBeVisible();
  await expect(zeile.getByText('kein Termin', { exact: true })).toHaveCount(0);
});

test('LLH-1111: der Abschluss setzt den Termin, Überblick und Seite Lagebesprechung folgen', async ({
  page,
  context,
}) => {
  const id = await anmeldenUndAnlegen(page);
  await oeffnenMitStrom(page, ueberblickPfad(id), id);
  const marke = page
    .locator('[data-lfh="ueberblick-marke"]')
    .filter({ hasText: 'Lagebesprechung' });
  await expect(page.getByText('Keine anstehenden Fristen.')).toBeVisible();
  await expect(marke).toHaveCount(0);

  // Der zweite Schirm derselben Sitzung steht auf der Seite Lagebesprechung.
  const seite = await context.newPage();
  await oeffnenMitStrom(seite, lagebesprechungPfad(id), id);
  await expect(terminKennzahl(seite)).toContainText('kein Termin');
  await expect(seite.getByText('Noch keine Lagebesprechung abgeschlossen')).toBeVisible();

  const abschluss = await page.request.post(`/api/einsaetze/${id}/lagebesprechungen`, {
    data: { entschluss: 'Lage unverändert', naechste_at: terminInZweiStunden() },
  });
  expect(abschluss.status()).toBe(201);

  // Überblick: die Marke steht und führt in das Modul Lagebesprechung.
  await expect(marke).toHaveCount(1);
  await expect(marke).toHaveAttribute('href', lagebesprechungPfad(id));
  // Seite Lagebesprechung: Termin, Zahl und Verlauf ohne Neuladen.
  await expect(terminKennzahl(seite)).toContainText(IN_ZWEI_STUNDEN);
  const verlauf = seite.getByRole('region', { name: 'Verlauf', exact: true });
  await expect(verlauf.getByRole('heading', { level: 3, name: /^Nr\. 1 · / })).toBeVisible();
  await expect(
    verlauf.getByRole('link', { name: 'ETB-Eintrag zu Lagebesprechung Nr. 1', exact: true }),
  ).toBeVisible();
});

test('LFH-854: ein Rollenwechsel schaltet das Schreibrecht der betroffenen Person ohne Neuladen', async ({
  page,
  browser,
}) => {
  // Zwei Sitzungen: die Einsatzleitung (Admin) und die betroffene Person in eigenem Kontext.
  const id = await anmeldenUndAnlegen(page);
  const konto = await benutzerAnlegen(page, 'beobachter');
  await mitgliedEintragen(page, String(id), konto.id, 'beobachter');

  const kontext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    const person = await kontext.newPage();
    await anmeldenAls(person, konto.benutzername, konto.passwort);
    await oeffnenMitStrom(person, `/einsaetze/${id}/chat`, id);

    // „Nur Ansicht · Grund“ (`RechteHinweis`, LFH-1078).
    const hinweis = person
      .locator('[data-lfh="rechte-hinweis"]')
      .filter({ hasText: 'nur Einsatzleitung und Führungspersonal' });
    const eingabe = person.getByPlaceholder('Nachricht…');
    await expect(hinweis, 'Vorbedingung: als Beobachter steht der Hinweis').toHaveCount(1);
    await expect(eingabe, 'Vorbedingung: als Beobachter keine Eingabe').toHaveCount(0);

    await mitgliedEintragen(page, String(id), konto.id, 'fuehrungspersonal');
    await expect(eingabe).toBeVisible();
    await expect(hinweis).toHaveCount(0);

    await mitgliedEintragen(page, String(id), konto.id, 'beobachter');
    await expect(hinweis).toHaveCount(1);
    await expect(eingabe).toHaveCount(0);
  } finally {
    await kontext.close();
  }
});

test('LFH-855: der erste Pegel auf einem anderen Schirm bietet dem offenen Dashboard den Zuschnitt an', async ({
  page,
}) => {
  const id = await anmeldenUndAnlegen(page);
  await oeffnenMitStrom(page, einsatzModulPfad(id, 'lage-dashboard'), id);
  const platzEins = page
    .getByRole('group', { name: 'Lage in Zahlen' })
    .locator('[data-lfh="kennzahl"]')
    .first();
  await expect(platzEins).toContainText('Verbleib offen');

  const festlegen = await page.request.post(`/api/einsaetze/${id}/pegel`, {
    data: { station_uuid: 'a6ee8177-107b-47dd-bcfd-30960ccc6e9c', name: 'Hann. Münden' },
  });
  expect(festlegen.status()).toBe(201);

  const banner = page.locator('[data-lfh="sammelbanner"]', {
    hasText: 'Kennzahlreihe geändert: Pegel statt Verbleib offen',
  });
  await expect(banner).toBeVisible();
  // Gehalten: die Reihe tauscht nicht unter dem Blick.
  await expect(platzEins).toContainText('Verbleib offen');

  await banner.getByRole('button', { name: 'übernehmen' }).click();
  await expect(platzEins).toContainText('Pegel');
  await expect(banner).toHaveCount(0);
});
