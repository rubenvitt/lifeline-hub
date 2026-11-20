import { expect, test, type Page } from '@playwright/test';
import { einsatzPerApi } from './einsatz-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Storno sperrt offene Seiten (LLH-1832, Spec `storno-sperre`).
 *
 * GESÄT: eine Person in einem neuen Einsatz. Platz B hat ihre Detailseite offen und schreibt eine
 * Notiz, Platz A (eigener Browserkontext, eigene Sitzung) storniert sie per API.
 *
 * GEPRÜFT: B zeigt ohne Neuladen „Storniert von … um …“, der Notiztext steht schreibgeschützt da,
 * „Notiz anlegen“ ist weg. Das Zugriffsprotokoll der Person trägt genau den einen Eintrag vom
 * Öffnen bei B: der Live-Abgleich des Stands schreibt keinen.
 *
 * Mutationsprobe: `EINSATZ_KEYS.personStand` aus `EINSATZ_STREAM_ZIELE.person` und
 * `EINSATZ_STREAM_EVENTS.person` entfernt → rot, das Banner erscheint nicht.
 */

async function oeffnenMitStrom(page: Page, pfad: string, einsatzId: string) {
  const strom = page.waitForResponse(
    (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
  );
  await page.goto(pfad);
  await strom;
}

test('Storno an Platz A sperrt die offene Personen-Detailseite an Platz B', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Storno-Sperre ${Date.now()}`);
  const angelegt = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, {
    data: { name: 'Storno', vorname: 'Probe' },
  });
  expect(angelegt.ok(), await angelegt.text()).toBe(true);
  const pid = ((await angelegt.json()) as { id: number }).id;

  await oeffnenMitStrom(page, `/einsaetze/${einsatzId}/personen/${pid}`, einsatzId);
  const notiz = page.getByRole('textbox', { name: 'Verlaufsnotiz' });
  await notiz.fill('Klagt über Schwindel');
  await expect(
    page.locator('[data-lfh="notiz-zeile"]').getByRole('button', { name: 'Erfassen', exact: true }),
  ).toBeVisible();

  const platzA = await browser.newContext();
  try {
    const a = await platzA.newPage();
    await anmeldenAlsAdmin(a, { startseite: false });
    const storno = await a.request.delete(`/api/einsaetze/${einsatzId}/personen/${pid}`);
    expect(storno.status(), await storno.text()).toBe(204);
  } finally {
    await platzA.close();
  }

  await expect(page.getByText(/^Storniert von .+ (um|am) /)).toBeVisible();
  await expect(
    page.locator('[data-lfh="notiz-zeile"]').getByRole('button', { name: 'Erfassen', exact: true }),
  ).toHaveCount(0);
  await expect(notiz).toHaveValue('Klagt über Schwindel');
  await expect(notiz).toHaveAttribute('readonly', '');

  const audit = await page.request.get(`/api/einsaetze/${einsatzId}/personen/${pid}/audit`);
  expect(audit.ok()).toBe(true);
  const eintraege = (await audit.json()) as { art: string; person_id: number | null }[];
  expect(eintraege.filter((e) => e.person_id === pid)).toHaveLength(1);
});
