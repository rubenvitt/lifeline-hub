import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Abschnittsgerät (LFH-1043, Spec `funktionsansichten`): ein Tablet an „EA Nord“ startet auf
 * seinem Abschnitt, sieht die Einheit des Unterabschnitts, aber nicht die des Nachbarn, quittiert
 * den Auftrag an seinen Unterabschnitt (der an den Nachbarn bleibt ohne Knopf) und meldet an die
 * Einsatzleitung; die Meldung trägt den Abschnitt als Absenderbezug.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext. Kein `networkidle`
 * (LFH-385).
 *
 * Mutationsprobe: in `AuftragKarte` die Bedingung `darfQuittierenFuer` entfernt → der Knopf für
 * „EA Süd“ steht (rot).
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

test('LFH-1043: Abschnittsgerät sieht seinen Teilbaum, quittiert und meldet', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Abschnitt ${Date.now()}`,
  });
  const e = einsatz.id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/abschnitte`, { name: 'EA Nord' });
  const ost = await anlegen(page, `/api/einsaetze/${e}/abschnitte`, {
    name: 'UA Nord-Ost',
    ueber_abschnitt_id: nord.id,
  });
  const sued = await anlegen(page, `/api/einsaetze/${e}/abschnitte`, { name: 'EA Süd' });
  await anlegen(page, `/api/einsaetze/${e}/einheiten`, { name: 'Zug Ost', abschnitt_id: ost.id });
  await anlegen(page, `/api/einsaetze/${e}/einheiten`, { name: 'Zug Süd', abschnitt_id: sued.id });
  await anlegen(page, `/api/einsaetze/${e}/auftraege`, {
    auftrag_text: 'Deich Nord sichern',
    empfaenger: [
      { empfaenger_typ: 'abschnitt', abschnitt_id: ost.id },
      { empfaenger_typ: 'abschnitt', abschnitt_id: sued.id },
    ],
  });
  await anlegen(page, `/api/einsaetze/${e}/auftraege`, {
    auftrag_text: 'Pumpe Süd',
    empfaenger: [{ empfaenger_typ: 'abschnitt', abschnitt_id: sued.id }],
  });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'einsatzabschnitt', stelle_id: nord.id, bezeichnung: 'Tablet A' },
  );

  const kontext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();

    // Start: der eigene Abschnitt mit den Einheiten des Teilbaums.
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/abschnitt$`));
    await expect(tablet.getByRole('heading', { level: 1, name: 'EA Nord' })).toBeVisible();
    const einheiten = tablet.getByRole('list', { name: 'Einheiten' });
    await expect(einheiten.getByText('Zug Ost')).toBeVisible();
    await expect(tablet.getByText('Zug Süd')).toHaveCount(0);

    // Aufträge: nur der an den eigenen Teilbaum, quittierbar nur die eigene Zeile.
    const nav = tablet.getByRole('navigation', { name: 'Gerätenavigation' });
    await nav.getByRole('link', { name: 'Aufträge' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/auftraege$`));
    await expect(tablet.getByText('Deich Nord sichern')).toBeVisible();
    await expect(tablet.getByText('Pumpe Süd')).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: 'Empfang für EA Süd quittieren' })).toHaveCount(
      0,
    );
    await tablet.getByRole('button', { name: 'Empfang für UA Nord-Ost quittieren' }).click();
    await tablet.getByRole('button', { name: 'Empfang quittieren' }).click();
    await expect(tablet.getByText('Empfang quittiert')).toBeVisible();
    await expect(
      tablet.getByRole('button', { name: 'Empfang für UA Nord-Ost quittieren' }),
    ).toHaveCount(0);

    // Melden: Absender ist der Abschnitt.
    await nav.getByRole('link', { name: 'Melden' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/melden$`));
    await tablet.getByLabel('Inhalt').fill('Deich hält');
    await tablet.getByRole('button', { name: 'Meldung senden' }).click();
    await expect(tablet.getByText(/Meldung #\d+ gesendet/)).toBeVisible();
    // Leer heißt angenommen: vorher stünde der Text noch im Eingabefeld.
    await expect(tablet.getByLabel('Inhalt')).toHaveValue('');
    await expect(tablet.getByText('Deich hält')).toBeVisible();

    const meldungen = await page.request.get(`/api/einsaetze/${e}/meldungen`);
    const gesendet = ((await meldungen.json()) as { inhalt: string; abschnitt_id?: number }[]).find(
      (m) => m.inhalt === 'Deich hält',
    );
    expect(gesendet?.abschnitt_id).toBe(nord.id);
  } finally {
    await kontext.close();
  }
});

/**
 * LLH-1190 (Spec `funktionsansichten`, „Ansicht Einsatzabschnitt“): das Tablet an „EA Nord“ sieht
 * den freigegebenen Befehl an seinen Unterabschnitt und den Nachbarn, quittiert ohne Rückfrage
 * nur die eigene Zeile, „Rückgängig“ nimmt die Quittung zurück; die Einsatzleitung sieht beides.
 * Ein Befehl nur an den Nachbarn erscheint nicht.
 *
 * Mutationsprobe: in `GeraetBefehle` `canQuittierenFor` entfernt → der Knopf für „EA Süd“ steht (rot).
 */
test('LLH-1190: Abschnittsgerät quittiert einen Einsatzbefehl an seinen Bereich', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Befehl Abschnitt ${Date.now()}`,
  });
  const e = einsatz.id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/abschnitte`, { name: 'EA Nord' });
  const ost = await anlegen(page, `/api/einsaetze/${e}/abschnitte`, {
    name: 'UA Nord-Ost',
    ueber_abschnitt_id: nord.id,
  });
  const sued = await anlegen(page, `/api/einsaetze/${e}/abschnitte`, { name: 'EA Süd' });
  const abschnitte = [
    { schluessel: 'lage', text: 'Pegel steigt' },
    { schluessel: 'auftrag', text: 'Deich halten' },
    { schluessel: 'durchfuehrung', text: 'Sandsäcke an die Deichkrone' },
  ];
  async function befehl(titel: string, verteiler: unknown[]): Promise<number> {
    const b = await anlegen(page, `/api/einsaetze/${e}/befehle`, {
      vorlage: 'befehl_lad',
      titel,
      abschnitte,
    });
    const patch = await page.request.patch(`/api/einsaetze/${e}/befehle/${b.id}`, {
      data: { verteiler },
    });
    expect(patch.ok(), `Verteiler: ${patch.status()}`).toBeTruthy();
    await anlegen(page, `/api/einsaetze/${e}/befehle/${b.id}/freigeben`);
    return b.id;
  }
  const bid = await befehl('Deichverteidigung', [
    { empfaenger_typ: 'abschnitt', abschnitt_id: ost.id },
    { empfaenger_typ: 'abschnitt', abschnitt_id: sued.id },
  ]);
  await befehl('Pumpstation Süd', [{ empfaenger_typ: 'abschnitt', abschnitt_id: sued.id }]);
  const kopplung = await anlegen<{ code: { code: string } }>(page, `/api/einsaetze/${e}/geraete`, {
    ansicht: 'einsatzabschnitt',
    stelle_id: nord.id,
    bezeichnung: 'Tablet B',
  });

  const kontext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/abschnitt$`));
    await tablet
      .getByRole('navigation', { name: 'Gerätenavigation' })
      .getByRole('link', { name: 'Aufträge' })
      .click();

    const block = tablet.locator('[data-lfh="geraet-befehle"]');
    await expect(block.getByText('Deichverteidigung')).toBeVisible();
    await expect(tablet.getByText('Pumpstation Süd')).toHaveCount(0);
    await expect(block.getByRole('button', { name: 'Empfang für EA Süd quittieren' })).toHaveCount(
      0,
    );
    await block.getByRole('button', { name: 'Befehlstext' }).click();
    await expect(block.getByText('Sandsäcke an die Deichkrone')).toBeVisible();

    const eigen = block.getByRole('button', { name: 'Empfang für UA Nord-Ost quittieren' });
    await eigen.click();
    await expect(tablet.getByText('Empfang quittiert')).toBeVisible();
    await expect(eigen).toHaveCount(0);
    const quittiert = async () => {
      const b = await page.request.get(`/api/einsaetze/${e}/befehle/${bid}`);
      const v = (await b.json()) as {
        verteiler: { abschnitt_id?: number; quittiert_at?: string }[];
      };
      return v.verteiler.find((z) => z.abschnitt_id === ost.id)?.quittiert_at ?? null;
    };
    await expect.poll(quittiert).not.toBeNull();

    await tablet.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(eigen).toBeVisible();
    await expect.poll(quittiert).toBeNull();
  } finally {
    await kontext.close();
  }
});
