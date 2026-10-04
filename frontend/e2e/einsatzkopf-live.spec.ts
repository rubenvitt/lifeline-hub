import { expect, test, type Page } from '@playwright/test';
import { einsatzdatenPfad, einsatzModulPfad, stabPfad } from '../src/routing/deeplinks';

/**
 * Der Einsatzkopf ist live (LFH-555): ein Termin, den ein anderer Schirm setzt, erscheint ohne
 * Neuladen, in beide Richtungen zwischen Stab und Einsatzdaten-Seite.
 *
 * Der „andere Schirm" schreibt über die API derselben Sitzung; was hier zählt, ist der Weg über
 * den Live-Strom in die offene Seite. Die Seite wartet auf die Antwort von `/live`, BEVOR
 * geschrieben wird: der Server abonniert vor dem ersten Byte, ein früheres Ereignis ginge sonst
 * verloren (kein Refetch-Fallback, vgl. `kernfluss.spec.ts`). Kein `networkidle` (LFH-385).
 *
 * Mutationsprobe (LFH-555, 5.2): `einsatz` aus `EINSATZ_STREAM_EVENTS` genommen → beide Tests rot.
 *
 * LFH-855: Das Umschalten einer Lagekennzahl läuft über dasselbe Ereignis; das Lage-Dashboard hält
 * seinen Zuschnitt und bietet den neuen per Sammelbanner an. Mutationsprobe: Emitter in
 * `routes/pegel.rs` entfernt → der Fall ist rot.
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

test('LFH-555: der Stab setzt den Termin, die offene Einsatzdaten-Seite folgt', async ({
  page,
}) => {
  const id = await anmeldenUndAnlegen(page);
  await oeffnenMitStrom(page, einsatzdatenPfad(id), id);
  await expect(
    page.getByRole('button', { name: 'Nächste Lagebesprechung eintragen', exact: true }),
  ).toBeVisible();

  const abschluss = await page.request.post(`/api/einsaetze/${id}/stab/lagebesprechungen`, {
    data: { entschluss: 'Lage unverändert', naechste_at: terminInZweiStunden() },
  });
  expect(abschluss.status()).toBe(201);

  await expect(
    page.getByRole('button', { name: 'Nächste Lagebesprechung bearbeiten', exact: true }),
  ).toBeVisible();
});

test('LFH-555: die Einsatzdaten setzen den Termin, der offene Stab-Kopfblock folgt', async ({
  page,
}) => {
  const id = await anmeldenUndAnlegen(page);
  await oeffnenMitStrom(page, stabPfad(id), id);
  // Nur der Stand-Block: die Vorbereitung (LFH-550) zeigt den Termin ebenfalls.
  const stand = page.getByLabel('Stand der Lagebesprechung');
  await expect(stand.getByText('kein Termin', { exact: true })).toBeVisible();

  const patch = await page.request.patch(`/api/einsaetze/${id}`, {
    data: { naechste_lagebesprechung_at: terminInZweiStunden() },
  });
  expect(patch.ok()).toBeTruthy();

  await expect(stand.getByText(/^in (1 h 5\d|2 h 00) min$/)).toBeVisible();
  await expect(stand.getByText('kein Termin', { exact: true })).toHaveCount(0);
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
