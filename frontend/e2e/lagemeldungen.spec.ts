import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';
import { waehleIn } from './auswahl-kern';

/**
 * Lagemeldung als Meldungsart (LLH-1031, Spec `meldungseingang`): auf der Seite „Lagemeldungen“
 * erfasst, steht sie sofort in der Zeitachse, und der Sprung „Meldung #n“ öffnet sie im
 * Meldungseingang, hervorgehoben. Eine übernommene Meldung anderer Art trägt ihr Wort an der
 * Zeile. Belegt an `data-hervorgehoben`, nicht an der URL: `useQueryParamSelektion` räumt den
 * Parameter nach dem Anwenden.
 */

async function post<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test('erfasste Lagemeldung steht in der Zeitachse und führt zur Meldung (LLH-1031)', async ({
  page,
}) => {
  const { id } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Lagemeldung ${Date.now()}`,
  });
  // Eine übernommene Rückmeldung daneben: dieselbe Achse, ihr eigenes Wort.
  const rueck = await post(page, `/api/einsaetze/${id}/meldungen`, {
    absender: 'Florian Nord 1',
    meldeweg: 'funk',
    meldungsart: 'rueckmeldung',
    inhalt: 'Wir sind vor Ort',
    ereigniszeit: new Date(Date.now() - 10 * 60_000).toISOString(),
  });
  await post(page, `/api/einsaetze/${id}/meldungen/${rueck.id}/lagerelevant`, {
    text: 'Einheit Nord am Deich eingetroffen',
  });

  await page.goto(`/einsaetze/${id}/lagemeldungen`);
  await expect(page.getByText('1 Lagemeldung', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lagemeldung erfassen' }).click();
  const paneel = page.getByRole('region', { name: 'Lagemeldung erfassen' });
  await paneel
    .getByRole('textbox', { name: 'Inhalt / Wortlaut' })
    .fill('Pegel Mühlbach steigt, Deich hält');
  await paneel.getByRole('textbox', { name: 'Absender' }).fill('EA Unterstadt');
  await paneel.getByRole('button', { name: 'Lagemeldung erfassen' }).click();
  await expect(paneel).toBeHidden();

  const sicht = page.getByRole('region', { name: 'Lagemeldungen' });
  const zeilen = sicht.getByRole('listitem');
  await expect(zeilen).toHaveCount(2);
  await expect(page.getByText('2 Lagemeldungen', { exact: true })).toBeVisible();
  const neu = zeilen.filter({ hasText: 'Pegel Mühlbach steigt, Deich hält' });
  await expect(neu).toContainText('Lage');
  await expect(neu).toContainText('Neu');
  await expect(neu).toContainText('EA Unterstadt');
  await expect(zeilen.filter({ hasText: 'Einheit Nord am Deich eingetroffen' })).toContainText(
    'Rückmeldung',
  );

  // Die Herkunft trennt die übernommene von der erfassten.
  await page
    .getByRole('radiogroup', { name: 'Herkunft' })
    .getByRole('radio', { name: 'Übernommen' })
    .click();
  await expect(zeilen).toHaveCount(1);
  await page
    .getByRole('radiogroup', { name: 'Herkunft' })
    .getByRole('radio', { name: 'Alle' })
    .click();

  const meldungen = await page.request.get(`/api/einsaetze/${id}/meldungen`);
  const lage = ((await meldungen.json()) as { id: number; lfd_nr: number; inhalt: string }[]).find(
    (m) => m.inhalt === 'Pegel Mühlbach steigt, Deich hält',
  )!;
  await neu.getByRole('link', { name: `Meldung #${lage.lfd_nr}` }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/meldungen(\\?|$)`));
  await expect(page.locator(`[data-meldung-id="${lage.id}"]`)).toHaveAttribute(
    'data-hervorgehoben',
    'true',
  );
});

test('eine Meldung an der Karte korrigiert, in der Lage versetzt und herausgenommen (LLH-1066)', async ({
  page,
}) => {
  const { id } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Korrektur ${Date.now()}`,
  });
  const m = await post<{ id: number; lfd_nr: number }>(page, `/api/einsaetze/${id}/meldungen`, {
    absender: 'Florian Nord 1',
    meldeweg: 'funk',
    inhalt: 'Brücke Nord gesperrt',
    ereigniszeit: new Date(Date.now() - 5 * 60_000).toISOString(),
  });

  // Art an der Karte berichtigen: aus „Sonstige“ wird eine Rückmeldung, dann in die Lage.
  await page.goto(`/einsaetze/${id}/meldungen`);
  const karte = page.locator(`[data-meldung-id="${m.id}"]`);
  await karte.getByRole('button', { name: `Aktionen zu Meldung ${m.lfd_nr}` }).click();
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  const formular = karte.getByRole('form', { name: `Meldung #${m.lfd_nr} korrigieren` });
  await waehleIn(formular.getByRole('combobox', { name: 'Meldungsart' }), 'Rückmeldung');
  await formular.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText(`Meldung #${m.lfd_nr} korrigiert`)).toBeVisible();
  await expect(formular).toBeHidden();
  await expect(karte).toContainText('Rückmeldung');
  await post(page, `/api/einsaetze/${id}/meldungen/${m.id}/lagerelevant`, {});

  // In der Lage: Lage-Text und Ort nachtragen.
  await page.goto(`/einsaetze/${id}/lagemeldungen`);
  const zeile = page.getByRole('region', { name: 'Lagemeldungen' }).getByRole('listitem');
  await zeile
    .getByRole('button', { name: `Lage-Angaben zu Meldung #${m.lfd_nr} bearbeiten` })
    .click();
  const lage = zeile.getByRole('form', { name: `Lage-Angaben zu Meldung #${m.lfd_nr}` });
  await lage.getByRole('textbox', { name: 'Lage-Text' }).fill('Brücke Nord für alle gesperrt');
  await lage.getByRole('button', { name: 'Speichern' }).click();
  await expect(lage).toBeHidden();
  await expect(zeile).toContainText('Brücke Nord für alle gesperrt');
  await expect(zeile).toContainText('Neu');

  // Aus der Lage nehmen: nach der Rückfrage fehlt sie in der Zeitachse.
  await page.goto(`/einsaetze/${id}/meldungen`);
  await karte.getByRole('button', { name: `Aktionen zu Meldung ${m.lfd_nr}` }).click();
  await page.getByRole('menuitem', { name: 'Aus der Lage nehmen' }).click();
  const rueckfrage = page.getByRole('dialog', {
    name: `Meldung #${m.lfd_nr} aus der Lage nehmen?`,
  });
  await rueckfrage.getByRole('button', { name: 'Aus der Lage nehmen' }).click();
  await expect(page.getByText('Aus der Lage genommen')).toBeVisible();
  await page.goto(`/einsaetze/${id}/lagemeldungen`);
  await expect(page.getByText('Noch keine Lagemeldungen')).toBeVisible();

  // Das ETB nennt jede Korrektur mit Verweis auf die Meldung.
  const etb = (await (await page.request.get(`/api/einsaetze/${id}/etb`)).json()) as {
    inhalt: string;
    meldung_id?: number;
  }[];
  const texte = etb.filter((e) => e.meldung_id === m.id).map((e) => e.inhalt);
  expect(texte).toEqual(
    expect.arrayContaining([
      `Meldung #${m.lfd_nr}: Art Sonstige → Rückmeldung`,
      `Meldung #${m.lfd_nr}: Lage-Text geändert`,
      `Meldung #${m.lfd_nr}: aus der Lage genommen`,
    ]),
  );
});
