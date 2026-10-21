import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * ETB verweist auf Meldung und Nachforderung (LLH-1104, Spec `etb-vorgaenge`): eine Meldung und
 * eine Nachforderung werden per API angelegt, die Nachforderung zugesagt. Im ETB trägt der
 * Eintrag der Meldung „Meldung #n ↗“, Anlage und Stufe der Nachforderung „Nachforderung ↗“; ein
 * Klick öffnet die Zielseite mit der Karte hervorgehoben. Belegt an `data-hervorgehoben`, nicht an
 * der URL: `useQueryParamSelektion` räumt den Parameter nach dem Anwenden.
 */

async function post<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test('Verweise im ETB führen auf die hervorgehobene Meldung und Nachforderung (LLH-1104)', async ({
  page,
}) => {
  const { id } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E ETB-Verweise ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${id}`;
  const meldung = await post<{ id: number; lfd_nr: number }>(page, `${basis}/meldungen`, {
    absender: 'Florian Nord 1',
    empfaenger: 'ELW 1',
    meldeweg: 'funk',
    inhalt: 'Brücke Hauptstraße gesperrt',
    ereigniszeit: new Date().toISOString(),
  });
  const nf = await post(page, `${basis}/nachforderungen`, {
    art: 'RTW',
    bezeichnung: 'Verstärkung Deich',
    anzahl: 2,
    adressat_kategorie: 'leitstelle',
    adressat_bezeichnung: 'ILS Nord',
  });
  await post(page, `${basis}/nachforderungen/${nf.id}/status`, { status: 'zugesagt' });

  await page.goto(`/einsaetze/${id}/etb`);
  const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
  const zeilen = sicht.getByTestId('etb-ereigniszeile');
  const meldungsZeile = zeilen.filter({ hasText: 'Brücke Hauptstraße gesperrt' });
  await expect(meldungsZeile).toHaveCount(1);
  const stufe = zeilen.filter({ hasText: 'Nachforderung 2× RTW: zugesagt' });
  await expect(stufe).toHaveCount(1);
  await expect(zeilen.filter({ hasText: 'Nachforderung: 2× RTW' })).toContainText(
    'Leitstelle (ILS Nord)',
  );

  await meldungsZeile
    .getByRole('link', { name: `Meldung #${meldung.lfd_nr}`, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/meldungen(\\?|$)`));
  await expect(page.locator(`[data-meldung-id="${meldung.id}"]`)).toHaveAttribute(
    'data-hervorgehoben',
    'true',
  );

  await page.goBack();
  await expect(stufe).toHaveCount(1);
  await stufe.getByRole('link', { name: 'Nachforderung', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/nachforderungen(\\?|$)`));
  await expect(page.locator(`[data-nachforderung-id="${nf.id}"]`)).toHaveAttribute(
    'data-hervorgehoben',
    'true',
  );
});
