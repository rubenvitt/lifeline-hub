import { expect, test, type Browser, type Page } from '@playwright/test';
import { anmeldenPerApi } from './anmelde-kern';
import { einsatzPerApi } from './einsatz-kern';

/**
 * Kein stilles Überschreiben an Einzelangaben (LLH-1831, LLH-1834; Change
 * `nvhnqynd-konflikt-und-aenderungsvermerk`, Specs `formularseiten`, `einsatzdaten-bearbeitung`,
 * `einheit-ansicht`, `aenderungsvermerk`). Zwei Browserkontexte: B öffnet eine Angabe, A speichert
 * sie inzwischen. B sieht den fremden Wert im offenen Feld, und sein Speichern endet in der
 * Rückfrage statt still zu überschreiben.
 *
 * Diskriminierend: ohne Altwert (`erwartet`) schriebe B's PATCH mit 200 durch, und am Ende stünde
 * B's Wert statt A's.
 */
const ADMIN = 'admin';
const ADMIN_PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function zweiterKontext(
  browser: Browser,
): Promise<{ b: Page; schliessen: () => Promise<void> }> {
  const kontext = await browser.newContext();
  const b = await kontext.newPage();
  await anmeldenPerApi(b, ADMIN, ADMIN_PW, { startseite: false });
  return { b, schliessen: () => kontext.close() };
}

test('Einsatzdaten · Leitstellen-Nr.: B sieht den fremden Wert und wird gefragt', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await anmeldenPerApi(page, ADMIN, ADMIN_PW, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Feld-CAS ${Date.now()}`);
  const pfad = `/einsaetze/${einsatzId}/einsatzdaten`;
  const { b, schliessen } = await zweiterKontext(browser);
  try {
    await b.goto(pfad);
    await b.getByRole('button', { name: 'Leitstellen-Nr. eintragen' }).click();
    const feldB = b.getByRole('textbox', { name: 'Leitstellen-Nr.' });
    await feldB.fill('ILS-4712');

    // A speichert inzwischen.
    await page.goto(pfad);
    await page.getByRole('button', { name: 'Leitstellen-Nr. eintragen' }).click();
    await page.getByRole('textbox', { name: 'Leitstellen-Nr.' }).fill('ILS-4711');
    await page.getByRole('button', { name: 'Leitstellen-Nr. speichern' }).click();
    await expect(page.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' })).toBeVisible();

    // B: Hinweis im offenen Feld (Live-Verteilung), die eigene Eingabe bleibt.
    // Mit Wer und Wann (Spec `formularseiten`, „Wert kommt während der Eingabe“).
    await expect(b.getByRole('status').filter({ hasText: 'Inzwischen geändert' })).toContainText(
      /Inzwischen geändert von \S.*: ILS-4711/,
    );
    await expect(feldB).toHaveValue('ILS-4712');

    // B speichert: Rückfrage statt stillem Überschreiben; Verwerfen lässt A's Wert stehen.
    await b.getByRole('button', { name: 'Leitstellen-Nr. speichern' }).click();
    const dialog = b.getByRole('dialog');
    await expect(dialog).toContainText('Zwischenzeitlich geändert');
    await expect(dialog).toContainText('„ILS-4711“');
    await b.getByRole('button', { name: 'Verwerfen und neu laden' }).click();
    await expect(
      b.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }),
    ).toHaveAccessibleDescription('ILS-4711');

    const kopf = (await (await page.request.get(`/api/incidents/${einsatzId}`)).json()) as {
      leitstellen_nr: string;
      vermerke?: Record<string, { von?: string }>;
    };
    expect(kopf.leitstellen_nr).toBe('ILS-4711');
    expect(kopf.vermerke?.leitstellen_nr?.von).toBeTruthy();
    // Der Vermerk steht an der Zeile und im Paneelkopf.
    const paneel = b.getByRole('region', { name: 'Einsatz' });
    await expect(paneel.getByText(/^Zuletzt geändert von /)).toBeVisible();
  } finally {
    await schliessen();
  }
});

test('Einsatzort · Adresse: eine reine Textänderung lässt die fremd verschobene Koordinate stehen', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmeldenPerApi(page, ADMIN, ADMIN_PW, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Feld-CAS Ort ${Date.now()}`);
  const kopf = (daten: Record<string, unknown>) =>
    page.request.patch(`/api/incidents/${einsatzId}`, { data: daten });
  expect(
    (
      await kopf({ einsatzort: 'Hinter der Halle', einsatzort_lat: 52.5, einsatzort_lon: 13.4 })
    ).ok(),
  ).toBe(true);

  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
  const paneel = page.getByRole('region', { name: 'Einsatzort' });
  await paneel.getByRole('button', { name: 'Adresse bearbeiten' }).click();
  // Ein anderer Arbeitsplatz verschiebt inzwischen nur die Koordinate.
  expect((await kopf({ einsatzort_lat: 52.6, einsatzort_lon: 13.5 })).ok()).toBe(true);
  await expect(paneel.getByRole('status').filter({ hasText: 'Inzwischen geändert' })).toBeVisible();

  const feld = paneel.getByRole('textbox', { name: 'Adresse' });
  await feld.fill('Vor der Halle');
  await paneel.getByRole('button', { name: 'Adresse speichern' }).click();
  await expect(paneel.getByRole('button', { name: 'Adresse bearbeiten' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const e = (await (await page.request.get(`/api/incidents/${einsatzId}`)).json()) as {
    einsatzort: string;
    einsatzort_lat: number;
  };
  expect(e.einsatzort).toBe('Vor der Halle');
  expect(e.einsatzort_lat, 'die fremde Koordinate bleibt').toBe(52.6);
});

test('Einheit · Bemerkung: B wird gefragt, „Meine Änderung übernehmen“ schreibt bewusst', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await anmeldenPerApi(page, ADMIN, ADMIN_PW, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Feld-CAS Einheit ${Date.now()}`);
  const antwort = await page.request.post(`/api/incidents/${einsatzId}/units`, {
    data: { name: 'Trupp 1' },
  });
  expect(antwort.ok(), await antwort.text()).toBe(true);
  const eid = ((await antwort.json()) as { id: number }).id;
  const pfad = `/einsaetze/${einsatzId}/einheiten/${eid}`;
  const { b, schliessen } = await zweiterKontext(browser);
  try {
    await b.goto(pfad);
    await b.getByRole('button', { name: 'Bemerkung eintragen' }).click();
    await b.getByRole('textbox', { name: 'Bemerkung' }).fill('Halle 2');

    const a = await page.request.patch(`/api/incidents/${einsatzId}/units/${eid}`, {
      data: { bemerkung: 'Tor 3' },
    });
    expect(a.ok()).toBe(true);
    await expect(b.getByRole('status').filter({ hasText: 'Inzwischen geändert' })).toContainText(
      /Inzwischen geändert von \S.*: Tor 3/,
    );

    await b.getByRole('button', { name: 'Bemerkung speichern' }).click();
    await expect(b.getByRole('dialog')).toContainText('„Tor 3“');
    await b.getByRole('button', { name: 'Meine Änderung übernehmen' }).click();
    await expect(
      b.getByRole('button', { name: 'Bemerkung bearbeiten' }),
    ).toHaveAccessibleDescription('Halle 2');
  } finally {
    await schliessen();
  }
});
