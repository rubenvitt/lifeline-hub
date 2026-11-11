import { expect, test, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { FUEKW } from './fuehrungsorganisation-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Einsatz am Spiegel (LLH-1492, Specs `einsatz-spiegel` und `spiegel-antraege`): Band, gesperrte
 * Bearbeitung, ETB-Erfassung wird Antrag.
 *
 * DIREKTER DATENBANKGRIFF: Einen Spiegel legt nur der Abgleich mit einer zweiten, gekoppelten
 * Instanz an (`tests/instanz_spiegel.rs`); die e2e-Suite hat nur eine. Wie
 * `aufbewahrung.spec.ts` setzt der Test den Zustand per `node:sqlite` in der Lauf-Datenbank: eine
 * Kopplung, zugeordnet einer eigenen Org (die Seite „Instanzkopplung“ des Admins bleibt leer,
 * `instanzkopplung.spec.ts`), und die Zeile in `einsatz_spiegel` unter dem Merker der Übernahme.
 * Die Kopplung wird gemeldet (`wird_gemeldet`): Der Takt baut zu ihr nie eine Verbindung auf, die
 * Anträge bleiben „ausstehend“.
 */

function datenbank(): string {
  const lauf = process.env.LIFELINE_E2E_LAUF;
  if (!lauf) throw new Error('LIFELINE_E2E_LAUF fehlt — läuft der Test außerhalb der Suite?');
  return (JSON.parse(lauf) as { datenbank: string }).datenbank;
}

function utcJetzt(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Macht den Einsatz zum Spiegel von „ELW Nord“. */
function alsSpiegel(einsatzId: number) {
  const db = new DatabaseSync(datenbank());
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('BEGIN IMMEDIATE');
    db.prepare(
      `INSERT INTO organisation (name) SELECT 'E2E Spiegel-Gegenstelle'
       WHERE NOT EXISTS (SELECT 1 FROM organisation WHERE name = 'E2E Spiegel-Gegenstelle')`,
    ).run();
    db.prepare(
      `INSERT OR IGNORE INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel,
         gegenueber_name, richtung, zustand)
       VALUES ('e2e-elw-nord', 'e2e', 'ELW Nord', 'wird_gemeldet', 'aktiv')`,
    ).run();
    db.prepare(
      `INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, fremde_org_name)
       SELECT k.id, o.id, 'e2e-elw-nord/1', 'ELW Nord'
       FROM instanz_kopplung k, organisation o
       WHERE k.gegenueber_kennung = 'e2e-elw-nord' AND o.name = 'E2E Spiegel-Gegenstelle'
         AND NOT EXISTS (SELECT 1 FROM instanz_kopplung_org z WHERE z.kopplung_id = k.id)`,
    ).run();
    db.exec('INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)');
    db.prepare(
      `INSERT INTO einsatz_spiegel (einsatz_id, kopplung_org_id, fremde_kennung, stand,
         letzter_abgleich_at)
       SELECT ?, z.id, 'e2e-elw-nord/' || ?, 1, ?
       FROM instanz_kopplung_org z JOIN instanz_kopplung k ON k.id = z.kopplung_id
       WHERE k.gegenueber_kennung = 'e2e-elw-nord'`,
    ).run(einsatzId, einsatzId, utcJetzt());
    db.exec('DELETE FROM spiegel_uebernahme');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
}

/** Setzt einen Antrag auf „abgelehnt“, wie es die Quittung des Führers täte. */
function ablehnen(antragId: number, grund: string) {
  const db = new DatabaseSync(datenbank());
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare("UPDATE spiegel_antrag SET zustand = 'abgelehnt', grund = ? WHERE id = ?").run(
      grund,
      antragId,
    );
  } finally {
    db.close();
  }
}

async function einsatzMitEintrag(page: Page): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Spiegel ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz anlegen: ${antwort.status()}`).toBe(true);
  const id = ((await antwort.json()) as { id: number }).id;
  const eintrag = await page.request.post(`/api/einsaetze/${id}/etb`, {
    data: { typ: 'meldung', inhalt: 'Lage vom ELW', von: 'ELW Nord', an: 'EL' },
  });
  expect(eintrag.ok(), `ETB-Eintrag: ${eintrag.status()}`).toBe(true);
  return id;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAlsAdmin(page);
});

test('am Spiegel: Band, Bearbeiten gesperrt, ETB-Erfassung wird beantragt', async ({ page }) => {
  const einsatz = await einsatzMitEintrag(page);
  alsSpiegel(einsatz);

  await page.goto(`/einsaetze/${einsatz}/etb`);
  const band = page.locator('[data-lfh="spiegel-band"]');
  await expect(band.locator('[data-lfh="spiegel-band-titel"]')).toHaveText('Spiegel von ELW Nord');

  // Bearbeiten gesperrt: am vorhandenen Eintrag nur „Berichtigen“ (ein ETB-Eintrag, also
  // beantragbar), keine Wiedervorlage und kein Auftrag.
  const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
  await expect(sicht.getByText('Lage vom ELW', { exact: true })).toBeVisible();
  await sicht.getByRole('button', { name: 'Aktionen zu Eintrag 1', exact: true }).click();
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)');
  await expect(menue.getByRole('menuitem', { name: /Berichtigen/ })).toBeVisible();
  await expect(menue.getByRole('menuitem', { name: /Wiedervorlage/ })).toHaveCount(0);
  await expect(menue.getByRole('menuitem', { name: /Auftrag erteilen/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Erfassen wird ein Antrag: als „beantragt“ in der Zeitachse, ohne laufende Nummer.
  const feld = page.getByPlaceholder(/Inhalt/);
  await feld.click();
  await feld.pressSequentially('Sandsäcke am Deich angekommen');
  await feld.press('Enter');
  const beantragt = sicht.locator('[data-zeile^="beantragt-"]').filter({
    hasText: 'Sandsäcke am Deich angekommen',
  });
  await expect(beantragt).toHaveCount(1);
  await expect(beantragt.getByText('beantragt', { exact: true })).toBeVisible();
  await expect(band.locator('[data-lfh="spiegel-band-zaehler"]')).toContainText(
    '1 Antrag ausstehend',
  );
  // Nicht in die Daten des Spiegels geschrieben.
  const etb = await page.request.get(`/api/einsaetze/${einsatz}/etb`);
  expect(await etb.text()).not.toContain('Sandsäcke am Deich angekommen');

  // Der Führer lehnt ab: das Band nennt den Grund, „Verwerfen“ räumt den Antrag.
  const antraege = (await (
    await page.request.get(`/api/einsaetze/${einsatz}/antraege`)
  ).json()) as { id: number }[];
  expect(antraege).toHaveLength(1);
  ablehnen(antraege[0].id, 'Einsatz ist abgeschlossen.');
  await page.reload();
  await expect(band.locator('[data-lfh="spiegel-band-zaehler"]')).toContainText('1 abgelehnt');
  await band.getByRole('button', { name: /Anträge/ }).click();
  const antrag = band.locator('[data-lfh="spiegel-antrag"]');
  await expect(antrag).toContainText('Einsatz ist abgeschlossen.');
  await antrag.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(antrag).toHaveCount(0);
});
