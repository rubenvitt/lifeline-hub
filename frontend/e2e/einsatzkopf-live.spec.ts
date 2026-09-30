import { expect, test, type Page } from '@playwright/test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { einsatzdatenPfad, stabPfad } from '../src/routing/deeplinks';

dayjs.extend(utc);

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

/** Ein Termin in zwei Stunden als Wire-String (UTC ohne Zone). */
function terminInZweiStunden(): string {
  return dayjs.utc().add(2, 'hour').startOf('minute').format('YYYY-MM-DD HH:mm:ss');
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
  await expect(page.getByText('kein Termin', { exact: true })).toBeVisible();

  const patch = await page.request.patch(`/api/einsaetze/${id}`, {
    data: { naechste_lagebesprechung_at: terminInZweiStunden() },
  });
  expect(patch.ok()).toBeTruthy();

  await expect(page.getByText(/^in (1 h 5\d|2 h 00) min$/)).toBeVisible();
  await expect(page.getByText('kein Termin', { exact: true })).toHaveCount(0);
});
