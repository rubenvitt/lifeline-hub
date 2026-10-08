import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Schadenliste und Presse-Log seitenweise (LFH-1075, Specs `schaden-liste-blaettern` und
 * `stab-presse-log`). Mit 2.000 Schäden lädt die Modulseite eine Seite, nennt den Bestand aus den
 * Kennzahlen, findet per Filter einen Schaden weit hinten ohne Nachladen und hängt mit „Ältere
 * laden“ an. Das Presse-Log lädt die offenen ganz und die erledigten seitenweise. Als Admin und
 * als Beobachter (`e2e/AGENTS.md`, Rollen): beide Seiten sind Lesepfade beider.
 */

const SCHAEDEN = 2000;
const ERLEDIGTE = 120;

async function einsatz(page: Page, name: string): Promise<string> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E ${name} ${Date.now()}` },
  });
  expect(r.ok(), `POST /api/einsaetze: ${r.status()} ${await r.text()}`).toBe(true);
  return String(((await r.json()) as { id: number }).id);
}

/** Legt `anzahl` Datensätze in Bündeln an; `daten(i)` liefert den Körper des i-ten. */
async function saeen(page: Page, pfad: string, anzahl: number, daten: (i: number) => object) {
  const ids: number[] = [];
  for (let ab = 0; ab < anzahl; ab += 50) {
    const buendel = Array.from({ length: Math.min(50, anzahl - ab) }, (_, j) => ab + j);
    const antworten = await Promise.all(
      buendel.map((i) => page.request.post(pfad, { data: daten(i) })),
    );
    for (const [j, a] of antworten.entries()) {
      expect(a.ok(), `${pfad} #${buendel[j]}: ${a.status()} ${await a.text()}`).toBe(true);
      ids[buendel[j]] = ((await a.json()) as { id: number }).id;
    }
  }
  return ids;
}

/** 2.000 offene Schäden, „gering“, nur einer weit hinten „katastrophal“. */
async function einsatzMitSchaeden(page: Page): Promise<{ einsatzId: string; schwerNr: number }> {
  const einsatzId = await einsatz(page, 'Schäden blättern');
  const SCHWER = 17;
  await saeen(page, `/api/einsaetze/${einsatzId}/schaeden`, SCHAEDEN, (i) => ({
    typ: 'sachschaden',
    ausmass: i === SCHWER ? 'katastrophal' : 'gering',
    ort: `Deichweg ${i + 1}`,
  }));
  // Registriernummern laufen ab 1 in Anlagefolge; parallel angelegt also nicht sicher i + 1.
  const auswahl = await page.request.get(`/api/einsaetze/${einsatzId}/schaeden/auswahl`);
  const schwer = ((await auswahl.json()) as { registrier_nr: number; ort: string }[]).find(
    (s) => s.ort === `Deichweg ${SCHWER + 1}`,
  )!;
  return { einsatzId, schwerNr: schwer.registrier_nr };
}

async function pruefeSchaeden(page: Page, einsatzId: string, schwerNr: number) {
  await page.goto(`/einsaetze/${einsatzId}/schaeden`);
  await expect(page.getByText(`${SCHAEDEN} Schäden · ${SCHAEDEN} offen`)).toBeVisible();
  await expect(page.getByText(`100 von ${SCHAEDEN} geladen`)).toBeVisible();

  const nummer = `S-${String(schwerNr).padStart(3, '0')}`;
  // Vorbedingung: der katastrophale Schaden steht nicht in der ersten Seite.
  await expect(page.getByText(nummer, { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Ausmaß' }).click();
  await page.getByTitle('katastrophal', { exact: true }).click();
  await expect(page.getByText(nummer, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ältere laden' })).toHaveCount(0);
  await page.keyboard.press('Escape');
}

test.describe('Schadenliste seitenweise', () => {
  test.setTimeout(180_000);

  test('als Admin und als Beobachter', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, schwerNr } = await einsatzMitSchaeden(page);
    await pruefeSchaeden(page, einsatzId, schwerNr);

    // „Ältere laden“ in der Vorgabesicht.
    await page.goto(`/einsaetze/${einsatzId}/schaeden`);
    await expect(page.getByText(`100 von ${SCHAEDEN} geladen`)).toBeVisible();
    await page.getByRole('button', { name: 'Ältere laden' }).click();
    await expect(page.getByText(`200 von ${SCHAEDEN} geladen`)).toBeVisible();

    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await pruefeSchaeden(page, einsatzId, schwerNr);
    await expect(page.getByRole('button', { name: 'Schnellerfassung' })).toHaveCount(0);
  });
});

async function einsatzMitPresseLog(
  page: Page,
): Promise<{ einsatzId: string; aeltesterId: number }> {
  const einsatzId = await einsatz(page, 'Presse blättern');
  const basis = `/api/einsaetze/${einsatzId}/stab/medienkontakte`;
  const ids = await saeen(page, basis, ERLEDIGTE, (i) => ({
    art: 'termin',
    medium: i % 2 ? 'RTL' : 'dpa',
    thema: `Termin ${i + 1}`,
    eingang_at: `2026-10-01 ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`,
  }));
  for (const id of ids) {
    const r = await page.request.post(`${basis}/${id}/status`, { data: { status: 'erledigt' } });
    expect(r.ok(), `Status ${id}: ${r.status()}`).toBe(true);
  }
  const offen = await page.request.post(basis, {
    data: { art: 'anfrage', medium: 'NDR 1', thema: 'Noch offen' },
  });
  expect(offen.ok()).toBe(true);
  return { einsatzId, aeltesterId: ids[0] };
}

async function pruefePresse(page: Page, einsatzId: string, aeltesterId: number) {
  await page.goto(`/einsaetze/${einsatzId}/stab/presse`);
  await expect(page.getByText('NDR 1 · Noch offen')).toBeVisible();
  await expect(page.getByText(`101 von ${ERLEDIGTE + 1} geladen`)).toBeVisible();
  await expect(page.getByText(`${ERLEDIGTE + 1} gesamt, davon 1 offen`)).toBeVisible();
  await page.getByRole('button', { name: 'Ältere laden' }).click();
  await expect(page.getByRole('button', { name: 'Ältere laden' })).toHaveCount(0);
  await expect(page.getByText('dpa · Termin 1', { exact: true })).toBeVisible();

  // Deeplink auf den ältesten: einzeln geholt, ohne bis zu ihm zu blättern.
  await page.goto(`/einsaetze/${einsatzId}/stab/presse?kontakt=${aeltesterId}`);
  await expect(page.locator('.zeile-hervorgehoben')).toContainText('dpa · Termin 1');
  await expect(page.getByRole('button', { name: 'Ältere laden' })).toBeVisible();
}

test.describe('Presse-Log: erledigte seitenweise', () => {
  test.setTimeout(120_000);

  test('als Admin und als Beobachter', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, aeltesterId } = await einsatzMitPresseLog(page);
    await pruefePresse(page, einsatzId, aeltesterId);

    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await pruefePresse(page, einsatzId, aeltesterId);
    await expect(page.getByRole('button', { name: 'Medienkontakt erfassen' })).toBeDisabled();
  });
});
