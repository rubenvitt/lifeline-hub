import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Standard-Rufname und Von/An-Pflicht im ETB (LFH-894, Spec `etb-absender-empfaenger`). Der
 * Admin trägt für den ganzen Lauf einen Standard (`globale-vorbereitung.ts`); die Abfrage sieht
 * deshalb nur eine frisch angelegte Person.
 */

async function einsatzAnlegen(page: Page): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Rufname ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz anlegen: ${antwort.status()}`).toBe(true);
  return String(((await antwort.json()) as { id: number }).id);
}

function abfrage(page: Page) {
  return page.getByRole('group', { name: 'Mit welchem Rufnamen schreibst du ins ETB?' });
}

test('ohne Standard fragt das ETB, hält den Eintrag auf und sendet danach mit dem Rufnamen', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  await expect(abfrage(page)).toBeVisible();
  // Lage: Von und An tragen beide die eigene Stelle (Change `kwc2yszv-etb-neuentwurf`, D3).
  await page
    .getByRole('radiogroup', { name: 'Typ des Eintrags' })
    .getByRole('radio', { name: 'Lage' })
    .click();
  const feld = page.getByPlaceholder('Inhalt …');
  const inhalt = `Pegel steigt ${Date.now()}`;

  // Die Pflicht: ohne Rufnamen geht nichts an den Server, der Text bleibt stehen.
  const gesendet: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/api/einsaetze/${einsatzId}/etb`)) {
      gesendet.push(r.url());
    }
  });
  await feld.fill(inhalt);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  await expect(page.locator('[data-lfh="etb-pflicht-hinweis"]').first()).toContainText(
    'Absender fehlt',
  );
  expect(gesendet).toEqual([]);
  await expect(feld).toHaveValue(inhalt);

  // Freitext über den eigenen Eintrag (Spec `stammdaten-feld`, „Tastatur“; Change
  // `kwc2yszv-etb-neuentwurf`, D5).
  await abfrage(page).getByRole('combobox', { name: 'Rufname für Von und An' }).fill('Florian 4/1');
  await page.getByTitle('„Florian 4/1“ als Freitext übernehmen', { exact: true }).click();
  await expect(abfrage(page).getByRole('combobox', { name: 'Rufname für Von und An' })).toHaveValue(
    'Florian 4/1',
  );
  await abfrage(page).getByRole('button', { name: 'Übernehmen' }).click();
  await expect(abfrage(page)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Von', exact: true })).toHaveValue('Florian 4/1');
  await expect(page.getByRole('combobox', { name: 'An', exact: true })).toHaveValue('Florian 4/1');

  const antwort = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/api/einsaetze/${einsatzId}/etb`),
  );
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  const eintrag = await antwort;
  expect(eintrag.status()).toBe(201);
  expect(await eintrag.json()).toMatchObject({ inhalt, von: 'Florian 4/1', an: 'Florian 4/1' });
  const zeile = page.getByTestId('etb-ereigniszeile').filter({ hasText: inhalt });
  // Von = An: ein eigener Vermerk (Spec `etb-zeitachse-darstellung`).
  await expect(zeile).toContainText('Vermerk Florian 4/1');

  // Der Standard liegt am Server: nach dem Neuladen keine Abfrage; die neue Meldung trägt ihn als An.
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'An', exact: true })).toHaveValue('Florian 4/1');
  await expect(abfrage(page)).toHaveCount(0);
});

/**
 * Tastaturregel des Vorschlagsfelds im echten Browser (Spec `stammdaten-feld`, „Tastatur“; Change
 * `kwc2yszv-etb-neuentwurf`, D5). Nur hier wertet rc-select die Tasten über `which` aus und hielte
 * bei offener Liste den Fokus mit Tab fest; jsdom zeigt das nicht (`StammdatenFeld.test.tsx`).
 */
test('Abfrage: Tab nimmt den obersten Vorschlag und springt weiter, Enter nimmt ihn ohne zu speichern', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  for (const name of ['Sanitätsgruppe UHS', 'Sanitätszug Musterstadt']) {
    const r = await page.request.post(`/api/einsaetze/${einsatzId}/einheiten`, { data: { name } });
    expect(r.ok(), `Einheit ${name}: ${r.status()}`).toBe(true);
  }
  await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(abfrage(page)).toBeVisible();
  const feld = abfrage(page).getByRole('combobox', { name: 'Rufname für Von und An' });

  // Tab: der oberste Vorschlag „Im Einsatz“ ist markiert, Tab nimmt ihn und springt weiter.
  await feld.click();
  await feld.pressSequentially('San');
  await expect(page.locator('.ant-select-item-option-active')).toHaveAttribute(
    'title',
    'Sanitätsgruppe UHS',
  );
  await page.keyboard.press('Tab');
  await expect(feld).toHaveValue('Sanitätsgruppe UHS');
  await expect(feld).not.toBeFocused();
  await expect(
    abfrage(page).getByRole('checkbox', { name: 'Empfänger wie Absender' }),
  ).toBeFocused();

  // Enter bei offener Liste nimmt ↓ markierten zweiten Vorschlag und speichert nicht.
  await feld.fill('');
  await feld.pressSequentially('San');
  await expect(page.locator('.ant-select-item-option-active')).toHaveAttribute(
    'title',
    'Sanitätsgruppe UHS',
  );
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ant-select-item-option-active')).toHaveAttribute(
    'title',
    'Sanitätszug Musterstadt',
  );
  await page.keyboard.press('Enter');
  await expect(feld).toHaveValue('Sanitätszug Musterstadt');
  await expect(feld).toBeFocused();
  await expect(abfrage(page)).toBeVisible();

  // Enter bei geschlossener Liste speichert den Standard.
  await page.keyboard.press('Enter');
  await expect(abfrage(page)).toHaveCount(0);
  // Die Meldung trägt die eigene Stelle als An.
  await expect(page.getByRole('combobox', { name: 'An', exact: true })).toHaveValue(
    'Sanitätszug Musterstadt',
  );
});

test('als Beobachter keine Abfrage', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  // Vorbedingung: die Seite steht, die Erfassung fehlt (kein Schreibrecht).
  await expect(page.getByRole('heading', { name: 'ETB', level: 1 })).toBeVisible();
  await expect(page.getByPlaceholder('Inhalt …')).toHaveCount(0);
  await expect(page.getByRole('group', { name: /Rufnamen/ })).toHaveCount(0);
});
