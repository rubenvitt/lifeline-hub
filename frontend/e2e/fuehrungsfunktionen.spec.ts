import { expect, test, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { auftraegePfad } from '../src/routing/deeplinks';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * LFH-549: ein Auftrag an ein Sachgebiet aus dem Funktionskatalog.
 *
 * Nachgewiesen im echten Browser gegen den echten Server:
 * - die Katalogwahl „S3 – Einsatz (Müller)“ im Empfängerfeld erzeugt einen Katalogempfänger,
 * - die Karte zeigt den Snapshot und dahinter die aktuelle Besetzung, aus der Führungsfunktion
 *   der Mitglieder (i6k6mzed, design.md D2),
 * - ein Funktionswechsel kommt live an (`mitglieder` invalidiert die Aufträge),
 * - auch ohne Stab-Freigabe steht die Besetzung da (Rollenzweig nach LFH-435).
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

/**
 * Legt ein Konto `name` an und nimmt es mit der Führungsfunktion `funktion` in den Einsatz auf;
 * liefert seine Kennung. Das Konto meldet sich nie an, braucht also keinen Erstwechsel.
 */
async function mitgliedMitFunktion(
  page: Page,
  einsatzId: number,
  funktion: string | null,
  name: string,
  benutzerId?: number,
): Promise<number> {
  let id = benutzerId;
  if (id == null) {
    const konto = await page.request.post('/api/benutzer', {
      data: {
        anzeigename: name,
        benutzername: `e2e-funktion-${Date.now()}-${name.toLowerCase().replace(/\W/g, '')}`,
        passwort: 'e2e-funktion-pw-123',
      },
    });
    expect(konto.ok(), `Konto: ${konto.status()} ${await konto.text()}`).toBeTruthy();
    id = ((await konto.json()) as { id: number }).id;
  }
  const antwort = await page.request.put(`/api/einsaetze/${einsatzId}/mitglieder/${id}`, {
    data: { einsatz_rolle: 'fuehrungspersonal', fuehrungsfunktion: funktion },
  });
  expect(antwort.ok(), `Mitglied: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return id;
}

test('Auftrag an S3 zeigt die aktuelle Besetzung und folgt ihr live', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  const mueller = await mitgliedMitFunktion(page, einsatzId, 's3', 'Müller');

  await page.goto(auftraegePfad(einsatzId));
  // Der Kopfknopf öffnet den Dialog „Auftrag erteilen“ (oxgob5gk D10); die leere Liste trägt
  // dieselbe Aktion, der Kopfknopf steht im DOM zuerst.
  await page.getByRole('button', { name: 'Auftrag erteilen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Auftrag erteilen' });
  await dialog.getByLabel('Auftrag / Was').fill('Lage an der Brücke erkunden');
  const empfaenger = dialog.getByRole('combobox', { name: 'Empfänger', exact: true });
  await waehleIn(empfaenger, 'S3 – Einsatz (Müller)');
  // Mehrere Empfänger sind erlaubt, die Liste bleibt offen: Escape schließt sie.
  await empfaenger.press('Escape');
  // Senden über den Knopf im <form> (der Select schluckt Enter).
  await dialog.getByRole('button', { name: 'Auftrag erteilen', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Gemessen an der Karte in der Liste; das Detail daneben zeigt den Empfänger ebenso.
  const liste = page.getByRole('list', { name: 'Offene Aufträge' });
  const offen = page.getByText('S3 Einsatz · Müller', { exact: true });
  await expect(liste.getByText('S3 Einsatz · Müller', { exact: true })).toBeVisible();

  // Funktionswechsel über die API: `mitglieder` kommt über den Live-Strom und invalidiert die
  // Aufträge — die Karte folgt ohne Neuladen, der Snapshot bleibt.
  await mitgliedMitFunktion(page, einsatzId, null, 'Müller', mueller);
  await mitgliedMitFunktion(page, einsatzId, 's3', 'Schulz');
  await expect(liste.getByText('S3 Einsatz · Schulz', { exact: true })).toBeVisible();
  await expect(offen).toHaveCount(0);
});

test('Ohne Modulrecht steht die Besetzung aus den Mitgliedern da (Führungspersonal)', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await mitgliedMitFunktion(page, einsatzId, 's3', 'Müller');
  const erteilt = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
    data: {
      auftrag_text: 'Lage erkunden',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion: 's3' }],
    },
  });
  expect(erteilt.ok(), `Auftrag: ${erteilt.status()} ${await erteilt.text()}`).toBeTruthy();
  // Die Besetzung hängt seit i6k6mzed an keinem Modulrecht mehr, nur am Leserecht am Einsatz.

  await wechsleZuRolle(page, 'fuehrungspersonal', String(einsatzId));
  await page.goto(auftraegePfad(einsatzId));
  // Spec `fuehrungsfunktionen`, „Ohne Stab-Recht“: Snapshot und Besetzung stehen da.
  await expect(
    page
      .getByRole('list', { name: 'Offene Aufträge' })
      .getByText('S3 Einsatz · Müller', { exact: true }),
  ).toBeVisible();
});
