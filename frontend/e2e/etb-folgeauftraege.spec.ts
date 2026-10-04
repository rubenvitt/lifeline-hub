import { expect, test, type Page } from '@playwright/test';

/**
 * ETB-Folgeaufträge im Browser (LFH-815, Nachzug zu LFH-636 Aufgabe 4.2; Spec
 * `openspec/specs/etb-folgeauftraege/spec.md`): eine Entscheidung wird über die
 * Schnellerfassung erfasst, aus ihr zweimal „Auftrag erteilen" ausgelöst. Danach trägt die
 * Zeitachse an DIESER Entscheidung je Auftrag einen Verweis „Folgeauftrag Nr. …", jeder
 * Verweis wählt in der Auftragsliste seinen Auftrag aus, und der Überblick zählt „2 Aufträge".
 *
 * Alles über die Oberfläche, nichts gesät: die Lücke war der Weg im Browser, nicht das
 * Wire-Feld (das belegen `src/etb/repo.rs` und der Routentest).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const ENTSCHEIDUNG = 'Ortsteil Nord wird geräumt';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/** Erteilt aus dem ETB-Eintrag `nr` einen Auftrag und liefert dessen `id` und `lfd_nr`. */
async function auftragErteilen(
  page: Page,
  einsatzId: string,
  nr: number,
  text: string,
): Promise<{ id: number; lfd_nr: number }> {
  const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
  await sicht.getByRole('button', { name: `Aktionen zu Eintrag ${nr}`, exact: true }).click();
  await page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden)')
    .getByRole('menuitem', { name: 'Auftrag erteilen', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Aus ETB-Eintrag Auftrag erteilen' });
  const feld = dialog.getByLabel('Auftrag / Was');
  // Vorbelegt mit dem Eintragstext (LFH-112) — hier überschrieben, damit die Aufträge
  // auseinanderzuhalten sind.
  await expect(feld).toHaveValue(ENTSCHEIDUNG);
  await feld.fill(text);
  // Ohne Empfänger lehnt das Formular ab; eine freie Funktion genügt, gepflegt ist nichts.
  const empfaenger = dialog.getByRole('combobox', { name: 'Empfänger', exact: true });
  await empfaenger.fill('S3');
  await empfaenger.press('Enter');
  // Die Liste bleibt offen (mehrere Empfänger erlaubt) und könnte den Sendeknopf verdecken.
  // Tab schließt sie; Escape schlösse im Modal womöglich den Dialog mit.
  await empfaenger.press('Tab');
  await expect(dialog.getByTitle('S3', { exact: true })).toBeVisible();
  const erteilt = page.waitForResponse(
    (antwort) =>
      /\/api\/einsaetze\/\d+\/etb\/\d+\/auftrag$/.test(antwort.url()) &&
      antwort.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Auftrag erteilen', exact: true }).click();
  const antwort = await erteilt;
  expect(antwort.ok(), `Auftrag erteilen in Einsatz ${einsatzId}`).toBeTruthy();
  await expect(dialog).toBeHidden();
  const auftrag = (await antwort.json()) as { id: number; lfd_nr: number };
  expect(auftrag.lfd_nr).toEqual(expect.any(Number));
  return auftrag;
}

test('LFH-815: zwei Folgeaufträge aus einer Entscheidung — Zeitachse, Auswahl, Überblick', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Folgeaufträge ${Date.now()}`);

  // Entscheidung erfassen: `/entscheidung ` am Zeilenanfang setzt den Typ (Schnellerfassung).
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const eingabe = page.getByPlaceholder('Inhalt …');
  await eingabe.fill(`/entscheidung ${ENTSCHEIDUNG}`);
  await expect(
    page.getByRole('button', { name: 'Eintragstyp /entscheidung ändern' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();

  const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
  const entscheidung = sicht.getByTestId('etb-ereigniszeile').filter({ hasText: ENTSCHEIDUNG });
  await expect(entscheidung).toHaveCount(1);
  await expect(entscheidung).toContainText('Entscheidung');

  const erster = await auftragErteilen(page, einsatzId, 1, 'Lautsprecherdurchsage Ortsteil Nord');
  const zweiter = await auftragErteilen(page, einsatzId, 1, 'Sammelstelle Turnhalle einrichten');
  expect(zweiter.id).not.toBe(erster.id);

  // Je Folgeauftrag ein eigener Verweis an der Entscheidung, in aufsteigender Nummer.
  const folgeVerweise = entscheidung.getByRole('link', { name: /^Folgeauftrag/ });
  const [klein, gross] = [erster, zweiter].sort((a, b) => a.lfd_nr - b.lfd_nr);
  await expect(folgeVerweise).toHaveText([
    new RegExp(`^Folgeauftrag Nr\\. ${klein.lfd_nr}\\b`),
    new RegExp(`^Folgeauftrag Nr\\. ${gross.lfd_nr}\\b`),
  ]);

  // Ein Klick wählt den jeweiligen Auftrag aus — und nur ihn. Belegt an der Hervorhebung, nicht
  // an der URL: `useQueryParamSelektion` räumt `?auftrag=` nach dem Anwenden per `replace`, eine
  // URL-Zusicherung liefe dagegen um die Wette. Zurück per Verlauf statt `goto`: ein Neuladen
  // übersetzt im Dev-Server jedes Modul neu und kostet unter drei Workern das Testbudget.
  for (const [ziel, anderer] of [
    [erster, zweiter],
    [zweiter, erster],
  ]) {
    await entscheidung
      .getByRole('link', { name: `Folgeauftrag Nr. ${ziel.lfd_nr}`, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/auftraege(\\?|$)`));
    await expect(page.locator(`[data-auftrag-id="${ziel.id}"]`)).toHaveAttribute(
      'data-hervorgehoben',
      'true',
    );
    await expect(page.locator(`[data-auftrag-id="${anderer.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-auftrag-id="${anderer.id}"]`)).not.toHaveAttribute(
      'data-hervorgehoben',
      'true',
    );
    await page.goBack();
    await expect(entscheidung).toHaveCount(1);
  }

  // Der Überblick zählt die Folgeaufträge an der Entscheidung.
  await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
  const eintrag = page.locator('li').filter({ hasText: ENTSCHEIDUNG });
  await expect(eintrag.locator('[data-lfh="entscheidung-folge"]')).toHaveText('2 Aufträge');
});
