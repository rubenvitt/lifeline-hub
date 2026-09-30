import { expect, test, type Page } from '@playwright/test';
import { auftraegePfad } from '../src/routing/deeplinks';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * LFH-549: ein Auftrag an ein Sachgebiet aus dem Funktionskatalog.
 *
 * Nachgewiesen im echten Browser gegen den echten Server:
 * - die Katalogwahl „S3 – Einsatz (Müller)“ im Empfängerfeld erzeugt einen Katalogempfänger,
 * - die Karte zeigt den Snapshot und dahinter die aktuelle Besetzung,
 * - ein Besetzungswechsel kommt live an (Stab-Ereignis invalidiert die Aufträge),
 * - ohne Stab-Freigabe steht nur der Snapshot da (Rollenzweig nach LFH-435).
 *
 * Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

async function einsatzAnlegen(page: Page): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Funktionskatalog ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

async function besetzeExtern(page: Page, einsatzId: number, sachgebiet: string, name: string) {
  const antwort = await page.request.put(
    `/api/einsaetze/${einsatzId}/stab/besetzung/${sachgebiet}`,
    { data: { besetzung_art: 'extern', bezeichnung: name } },
  );
  expect(antwort.ok(), `Besetzung: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

test('Auftrag an S3 zeigt die aktuelle Besetzung und folgt ihr live', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await besetzeExtern(page, einsatzId, 's3', 'Müller');

  await page.goto(auftraegePfad(einsatzId));
  // Der Kopfknopf trägt ein Icon im Namen; danach heißt er „Formular schließen“.
  await page.getByRole('button', { name: /Auftrag erteilen/ }).click();
  await page.getByLabel('Auftrag / Was').fill('Lage an der Brücke erkunden');
  const empfaenger = page.getByRole('combobox', { name: 'Empfänger', exact: true });
  await empfaenger.click();
  await page.getByTitle('S3 – Einsatz (Müller)', { exact: true }).click();
  // Mehrere Empfänger sind erlaubt, die Liste bleibt offen: Escape schließt sie.
  await empfaenger.press('Escape');
  // Senden über den Knopf im <form> (der Select schluckt Enter).
  await page.getByRole('button', { name: 'Auftrag erteilen', exact: true }).click();

  const offen = page.getByText('S3 Einsatz · Müller', { exact: true });
  await expect(offen).toBeVisible();

  // Umbesetzen über die API: das Stab-Ereignis kommt über den Live-Strom und invalidiert die
  // Aufträge — die Karte folgt ohne Neuladen, der Snapshot bleibt.
  await besetzeExtern(page, einsatzId, 's3', 'Schulz');
  await expect(page.getByText('S3 Einsatz · Schulz', { exact: true })).toBeVisible();
  await expect(offen).toHaveCount(0);
});

test('Ohne Stab-Freigabe steht nur der Snapshot da (Führungspersonal)', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await besetzeExtern(page, einsatzId, 's3', 'Müller');
  const erteilt = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
    data: {
      auftrag_text: 'Lage erkunden',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion: 's3' }],
    },
  });
  expect(erteilt.ok(), `Auftrag: ${erteilt.status()} ${await erteilt.text()}`).toBeTruthy();
  // Stab nur für Admins: Führungspersonal liest Aufträge, aber nicht die Besetzung.
  const sperre = await page.request.put(`/api/einsaetze/${einsatzId}/modul-overrides/stab`, {
    data: { sichtbar: true, benoetigte_rolle: 'admin' },
  });
  expect(sperre.ok(), `Override: ${sperre.status()} ${await sperre.text()}`).toBeTruthy();

  await wechsleZuRolle(page, 'fuehrungspersonal', String(einsatzId));
  await page.goto(auftraegePfad(einsatzId));
  // Vorbedingung des Rollenzweigs: der Auftrag steht da, die Besetzung nicht.
  await expect(page.getByText('S3 Einsatz', { exact: true })).toBeVisible();
  await expect(page.getByText(/S3 Einsatz · /)).toHaveCount(0);
  await expect(page.getByText('Müller')).toHaveCount(0);
});
