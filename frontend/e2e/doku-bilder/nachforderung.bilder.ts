import type { APIRequestContext, Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import {
  anmelden,
  apiAlsAdmin,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Nachforderung“ (`docs/anwender/kapitel/nachforderung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep nachforderung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   nachforderungen-liste.png    frontend/src/pages/NachforderungenPage.tsx,
 *                                frontend/src/nachforderungen/NachforderungKarte.tsx
 *   nachforderung-absetzen.png   frontend/src/nachforderungen/NachforderungFormular.tsx
 *   nachforderung-ablehnen.png   frontend/src/pages/NachforderungenPage.tsx (Ablehnen)
 *   nachforderung-material-uebernehmen.png
 *                                frontend/src/nachforderungen/MaterialUebernahmeModal.tsx
 *   nachforderung-material-posten.png
 *                                frontend/src/nachforderungen/NachforderungKarte.tsx
 *                                (übernommene Posten)
 */

const KAPITEL = 'nachforderung';

/**
 * Demo-Lücke (D3): der Demo-Einsatz hat keine Nachforderung. Drei kommen über die API dazu, in
 * den Stufen Angefordert, Zugesagt und Unterwegs.
 */
async function nachforderungenFuellen(api: APIRequestContext) {
  const demo = await demoEinsatz(api);
  const basis = `/api/einsaetze/${demo.id}/nachforderungen`;
  const anlegen = (daten: Record<string, unknown>) =>
    fuelle<{ id: number }>(api, 'post', basis, daten);
  await anlegen({
    art: 'Sandsäcke',
    anzahl: 500,
    bezeichnung: 'Sandsäcke gefüllt für Unterführung Lindenstraße',
    adressat_kategorie: 'leitstelle',
    adressat_bezeichnung: 'Leitstelle Musterstadt',
    begruendung: 'Wasser steigt, Keller Lindenstraße 4 bis 8 gefährdet.',
    prioritaet: 'dringend',
  });
  const rtw = await anlegen({
    art: 'RTW',
    anzahl: 2,
    bezeichnung: 'Transport aus der UHS Turnhalle',
    adressat_kategorie: 'leitstelle',
    prioritaet: 'sofort',
  });
  await fuelle(api, 'post', `${basis}/${rtw.id}/status`, { status: 'zugesagt' });
  const seg = await anlegen({
    art: 'SEG Verpflegung',
    anzahl: 1,
    bezeichnung: 'Abendverpflegung für 80 Personen Gesamtschule',
    adressat_kategorie: 'uebergeordnet',
    adressat_bezeichnung: 'Kreisbereitschaftsleitung',
    prioritaet: 'normal',
  });
  await fuelle(api, 'post', `${basis}/${seg.id}/status`, { status: 'zugesagt' });
  await fuelle(api, 'post', `${basis}/${seg.id}/status`, { status: 'unterwegs' });

  // Zwei eingetroffene für „Als Material übernehmen“ (LLH-1226): Tauchpumpen noch ohne Posten,
  // Sandsäcke mit einer Teillieferung, die schon als Posten an der Rettungsstaffel steht.
  const eintreffen = async (id: number) => {
    for (const status of ['zugesagt', 'unterwegs', 'eingetroffen']) {
      await fuelle(api, 'post', `${basis}/${id}/status`, { status });
    }
  };
  const pumpen = await anlegen({
    art: 'Tauchpumpe',
    anzahl: 3,
    bezeichnung: '3 Tauchpumpen für Keller Hauptstraße',
    adressat_kategorie: 'leitstelle',
    prioritaet: 'dringend',
  });
  await eintreffen(pumpen.id);
  const saecke = await anlegen({
    art: 'Sandsäcke',
    anzahl: 2000,
    bezeichnung: 'Sandsäcke für Deich Nord',
    adressat_kategorie: 'uebergeordnet',
    adressat_bezeichnung: 'Kreisbereitschaftsleitung',
    prioritaet: 'dringend',
  });
  await eintreffen(saecke.id);
  const antwort = await api.get(`/api/einsaetze/${demo.id}/einheiten`);
  expect(antwort.ok(), `Einheiten: ${antwort.status()}`).toBe(true);
  const staffel = ((await antwort.json()) as { id: number; name: string }[]).find(
    (e) => e.name === 'Rettungsstaffel',
  );
  expect(staffel, 'Demo-Einheit „Rettungsstaffel“ fehlt').toBeTruthy();
  await fuelle(api, 'post', `/api/einsaetze/${demo.id}/material`, {
    adhoc: { bezeichnung: 'Sandsäcke' },
    menge: 1200,
    art: 'verbrauchsgut',
    einheit_id: staffel!.id,
    nachforderung_id: saecke.id,
  });
}

/** Öffnet die Nachforderungen des Demo-Einsatzes. */
async function nachforderungenOeffnen(page: Page) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/nachforderungen`);
  await expect(page.getByRole('button', { name: 'Nachforderung anlegen' })).toBeVisible();
  await expect(page.getByText('Transport aus der UHS Turnhalle').first()).toBeVisible();
}

/** Leert den Fokus, damit kein Fokusring und kein Cursor im Bild steht. */
async function fokusWeg(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe(KAPITEL, () => {
  // Einmal je Lauf, die Datenbank teilen alle Tests.
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    await nachforderungenFuellen(api);
    await api.dispose();
  });

  test('Offene Nachforderungen in drei Stufen', async ({ page }) => {
    await nachforderungenOeffnen(page);
    await expect(page.getByRole('button', { name: 'Eintreffen melden' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'nachforderungen-liste');
  });

  test('Formular „Neue Nachforderung“', async ({ page }) => {
    await nachforderungenOeffnen(page);
    await page.getByRole('button', { name: 'Nachforderung anlegen' }).click();
    const paneel = page.getByRole('region', { name: 'Neue Nachforderung' });
    await paneel.getByLabel('Art', { exact: true }).fill('Tauchpumpe');
    await paneel.getByLabel('Anzahl').fill('3');
    await paneel
      .getByLabel('Bezeichnung', { exact: true })
      .fill('Tauchpumpen mit Schläuchen für Keller');
    await paneel
      .getByLabel('Begründung / Lagebezug')
      .fill('Eigene Pumpen im Einsatz, weitere Keller laufen voll.');
    await fokusWeg(page);
    await fotografiere(paneel, KAPITEL, 'nachforderung-absetzen');
  });

  test('Dialog „Nachforderung ablehnen“', async ({ page }) => {
    await nachforderungenOeffnen(page);
    await page.getByRole('button', { name: 'Ablehnen' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Nachforderung ablehnen' });
    await dialog
      .getByRole('textbox')
      .fill('Keine Sandsäcke im Lager, Anforderung über Nachbarkreis.');
    await fokusWeg(page);
    await fotografiere(dialog, KAPITEL, 'nachforderung-ablehnen');
  });

  test('Dialog „Als Material übernehmen“', async ({ page }) => {
    await nachforderungenOeffnen(page);
    await page.getByRole('radio', { name: /Abgeschlossen/ }).click();
    const karte = page.locator('[data-nachforderung-id]', {
      hasText: '3 Tauchpumpen für Keller Hauptstraße',
    });
    await karte.getByRole('button', { name: 'Als Material übernehmen' }).click();
    const dialog = page.getByRole('dialog', { name: '„Tauchpumpe“ als Material übernehmen' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
    await dialog.getByRole('radio', { name: 'Gerät' }).click();
    await expect(dialog.getByRole('spinbutton', { name: 'Menge' })).toHaveValue('1');
    await waehleIn(dialog.getByRole('combobox', { name: 'Ort' }), 'Rettungsstaffel');
    await fokusWeg(page);
    await fotografiere(dialog, KAPITEL, 'nachforderung-material-uebernehmen');
  });

  test('Karte mit übernommenem Posten', async ({ page }) => {
    await nachforderungenOeffnen(page);
    await page.getByRole('radio', { name: /Abgeschlossen/ }).click();
    const karte = page.locator('[data-nachforderung-id]', { hasText: 'Sandsäcke für Deich Nord' });
    await expect(karte).toContainText('übernommen 1200 von 2000');
    await expect(karte.getByRole('button', { name: 'Weiteren Posten übernehmen' })).toBeVisible();
    await fokusWeg(page);
    await fotografiere(karte, KAPITEL, 'nachforderung-material-posten');
  });
});
