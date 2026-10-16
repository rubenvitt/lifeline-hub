import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';
import { haeltStufe, stelleDichte } from './trefflaeche-kern';

/**
 * Bereitstellungsraum (LFH-1042; Spec `funktionsansichten`): ein Tablet bei 1024 × 768 nimmt
 * seinen geplanten Raum in Betrieb, meldet eine Einheit an und wieder ab und schickt eine Meldung
 * an die Einsatzleitung. Auflösen, Stornieren und andere Räume gibt es auf dem Gerät nicht. Die
 * Belegung nennt „seit …“, und der Verlauf des eigenen Raums steht am Gerät mit Eintritt und
 * Austritt (LLH-1095, Spec `bereitstellungsraum-belegung`, „Verlauf auf der Detailseite“), in
 * `kompakt` und `handschuh`.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext. Kein `networkidle`
 * (LFH-385).
 *
 * Mutationsprobe: in `geraetSicht.ts` `br-verwalten` für Geräte auf `true` → der Schritt „kein
 * Stornieren“ wird rot.
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

test('LFH-1042: BR-Tablet nimmt den Raum in Betrieb, meldet Kräfte an und ab und meldet', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', { bezeichnung: `E2E BR ${Date.now()}` });
  const e = einsatz.id;
  const sportplatz = await anlegen(page, `/api/einsaetze/${e}/bereitstellungsraeume`, {
    bezeichnung: 'BR Sportplatz',
  });
  await anlegen(page, `/api/einsaetze/${e}/bereitstellungsraeume`, { bezeichnung: 'BR Schule' });
  await anlegen(page, `/api/einsaetze/${e}/einheiten`, { name: 'LF Nord' });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'bereitstellungsraum', stelle_id: sportplatz.id, bezeichnung: 'Tablet BR' },
  );

  const kontext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/br/${sportplatz.id}$`));

    const nav = tablet.getByRole('navigation', { name: 'Gerätenavigation' });
    await expect(nav.getByRole('link')).toHaveText(['Raum', 'Melden']);
    await expect(tablet.getByRole('heading', { level: 1, name: /BR Sportplatz/ })).toBeVisible();
    await expect(tablet.getByText('BR Schule')).toHaveCount(0);

    // Geplant: in Betrieb nehmen ja, stornieren nein; aktiv: auflösen nein.
    await expect(tablet.getByRole('button', { name: 'Stornieren' })).toHaveCount(0);
    await tablet.getByRole('button', { name: 'In Betrieb nehmen' }).click();
    await expect(tablet.getByRole('button', { name: 'In Betrieb nehmen' })).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: 'Auflösen' })).toHaveCount(0);

    // Anmelden aus „Kräfte ohne BR“, abmelden aus der Belegung. Angemeldet nennt die Zeile, seit
    // wann die Einheit wartet (LLH-1095).
    await tablet.getByRole('button', { name: 'LF Nord zuweisen' }).click();
    const belegung = tablet.getByRole('button', { name: 'entfernen' });
    await expect(belegung).toHaveCount(1);
    await expect(tablet.getByTestId('br-belegung')).toContainText(/seit \d{4,6} · \d+ min/);
    await belegung.click();
    await expect(tablet.getByText('Keine Einheiten bereitgestellt')).toBeVisible();

    // Verlauf des eigenen Raums: zugeklappt geladen erst beim Aufklappen, neueste zuerst.
    const verlauf = tablet.getByRole('button', {
      name: 'Verlauf des Bereitstellungsraums BR Sportplatz',
    });
    for (const { dichte, soll } of [
      { dichte: 'kompakt', soll: 30 },
      { dichte: 'handschuh', soll: 72 },
    ]) {
      await stelleDichte(tablet, dichte);
      await expect(verlauf).toHaveAttribute('aria-expanded', 'false');
      await haeltStufe(verlauf, soll, `Klappkopf „Verlauf“ (${dichte})`);
      await verlauf.click();
      await expect(verlauf).toHaveAttribute('aria-expanded', 'true');
      const eintraege = tablet.getByRole('list', { name: 'Verlauf' }).getByRole('listitem');
      await expect(eintraege).toHaveCount(2);
      await expect(eintraege.nth(0)).toContainText('Austritt');
      await expect(eintraege.nth(0)).toContainText('LF Nord');
      await expect(eintraege.nth(1)).toContainText('Eintritt');
      await expect(eintraege.nth(1)).toContainText('LF Nord');
    }

    await nav.getByRole('link', { name: 'Melden' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/meldungen$`));
    await expect(tablet.getByText('Noch keine Meldungen von dieser Stelle')).toBeVisible();
    await tablet.getByLabel('Inhalt').fill('Raum voll, weitere Kräfte zum BR Schule');
    await tablet.getByRole('button', { name: 'Meldung senden' }).click();
    await expect(tablet.getByText('Raum voll, weitere Kräfte zum BR Schule')).toBeVisible();

    // Die Einsatzleitung sieht den Raum als Status „aktiv“ und die Meldung mit dem Raum als Absender.
    const raum = await page.request.get(
      `/api/einsaetze/${e}/bereitstellungsraeume/${sportplatz.id}`,
    );
    expect(((await raum.json()) as { status: string }).status).toBe('aktiv');
    const meldungen = await page.request.get(`/api/einsaetze/${e}/meldungen`);
    const liste = (await meldungen.json()) as { inhalt: string; absender: string }[];
    expect(
      liste.find((m) => m.inhalt === 'Raum voll, weitere Kräfte zum BR Schule')?.absender,
    ).toBe('BR Sportplatz · Tablet BR');

    // LLH-1155: benennt die Einsatzleitung den Raum um, zieht der Gerätekopf ohne Neuanmeldung
    // nach. Die Sitzung des Tablets nennt weiter den alten Namen.
    const kopf = tablet.locator('[data-lfh="kopf-stelle"]');
    await expect(kopf).toContainText('BR Sportplatz');
    const umbenannt = await page.request.patch(
      `/api/einsaetze/${e}/bereitstellungsraeume/${sportplatz.id}`,
      { data: { bezeichnung: 'BR Festwiese' } },
    );
    expect(umbenannt.ok(), `${umbenannt.status()} ${await umbenannt.text()}`).toBeTruthy();
    await expect(kopf).toContainText('BR Festwiese');
    await expect(kopf).not.toContainText('BR Sportplatz');
  } finally {
    await kontext.close();
  }
});

/**
 * LLH-1075 Teil II (Spec `bereitstellungsraum-belegung`, „Eintreffen buchen in der Oberfläche“):
 * der Einweiser am Tablet (`handschuh`) bucht eine erwartete Einheit mit einem Tipp und ein
 * unangemeldetes Fahrzeug; die Führung am Desktop (`kompakt`) sieht die Meldung, das Kennzeichen
 * „nicht übernommen“ im Meldebild und in der Einheitenliste und übernimmt mit Abschnitt, danach ist
 * das Kennzeichen weg. Der Teil „ohne Netz vorgemerkt“ folgt mit der Schreib-Warteschlange
 * (Teil III).
 *
 * Mutationsprobe: in `geraetSicht.ts` `br-eintreffen` nur für `uhs-tablet` → der Knopf fehlt am
 * Tablet, der Schritt „Eintreffen buchen“ wird rot.
 */
test('LLH-1075: Eintreffen am Tablet, Übernahme durch die Führung', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E BR Tor ${Date.now()}`,
  });
  const e = einsatz.id;
  const raum = await anlegen(page, `/api/einsaetze/${e}/bereitstellungsraeume`, {
    bezeichnung: 'BR Sportplatz',
  });
  await anlegen(page, `/api/einsaetze/${e}/bereitstellungsraeume/${raum.id}/status`, {
    status: 'aktiv',
  });
  await anlegen(page, `/api/einsaetze/${e}/abschnitte`, { name: 'EA Nord' });
  await anlegen(page, `/api/einsaetze/${e}/einheiten`, { name: 'HLF Musterstadt' });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'bereitstellungsraum', stelle_id: raum.id, bezeichnung: 'Tablet Tor' },
  );

  const kontext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/br/${raum.id}$`));
    await stelleDichte(tablet, 'handschuh');

    // Erwartet, ein Tipp.
    await tablet.getByRole('button', { name: 'Eintreffen buchen' }).click();
    const dialog = tablet.getByRole('dialog', { name: 'Eintreffen buchen' });
    await expect(dialog.getByRole('searchbox', { name: 'Suche' })).toBeFocused();
    // Gemessen erst, wenn die Einblendung steht (sonst skaliert `ant-zoom` den Kasten).
    await expect(tablet.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
    const treffer = dialog.getByRole('button', { name: 'Eintreffen HLF Musterstadt' });
    await haeltStufe(treffer, 72, 'Trefferknopf „Eintreffen“ (handschuh)');
    await treffer.click();
    await expect(tablet.getByText('HLF Musterstadt gebucht')).toBeVisible();
    const belegung = tablet.getByTestId('br-belegung');
    await expect(belegung.getByText('HLF Musterstadt')).toBeVisible();

    // Unangemeldet: der Suchtext wird der Funkrufname.
    await tablet.getByRole('button', { name: 'Eintreffen buchen' }).click();
    await dialog.getByRole('searchbox', { name: 'Suche' }).fill('Florian Nachbar 3');
    await dialog.getByRole('button', { name: 'Nicht in der Liste' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Funkrufname' })).toHaveValue(
      'Florian Nachbar 3',
    );
    await dialog.getByRole('textbox', { name: 'Trägerorganisation' }).fill('FF Nachbarstadt');
    await dialog.getByRole('button', { name: 'Unangemeldet buchen' }).click();
    await expect(
      tablet.getByText('Florian Nachbar 3 unangemeldet gebucht, Einsatzleitung informiert'),
    ).toBeVisible();
    // Die Einheit heißt wie ihr Fahrzeug: Zeile der Einheit und Fahrzeugzeile darunter.
    await expect(belegung.getByText('Florian Nachbar 3', { exact: true })).toHaveCount(2);
    await expect(belegung.getByText('nicht übernommen')).toBeVisible();
  } finally {
    await kontext.close();
  }

  // Die Führung am Desktop.
  const einheiten = (await (await page.request.get(`/api/einsaetze/${e}/einheiten`)).json()) as {
    id: number;
    name: string;
  }[];
  const neu = einheiten.find((x) => x.name === 'Florian Nachbar 3');
  expect(neu, 'die unangemeldete Einheit ist angelegt').toBeDefined();

  await page.goto(`/einsaetze/${e}/meldungen`);
  await stelleDichte(page, 'kompakt');
  const karte = page.locator('[data-meldung-id]').filter({ hasText: 'Florian Nachbar 3' });
  await expect(karte.getByRole('button', { name: 'Übernehmen' })).toBeVisible();
  await expect(karte.getByRole('button', { name: 'Abweisen' })).toBeVisible();

  await page.goto(`/einsaetze/${e}/kraefteuebersicht`);
  const zelle = page
    .locator('[data-lfh="kraeftebaum-zelle"]')
    .filter({ hasText: 'Florian Nachbar 3' });
  await expect(zelle.getByText('nicht übernommen')).toBeVisible();

  await page.goto(`/einsaetze/${e}/einheiten`);
  const zeile = page.getByRole('row').filter({ hasText: 'Florian Nachbar 3' });
  await expect(zeile.getByText('nicht übernommen')).toBeVisible();

  await page.goto(`/einsaetze/${e}/einheiten/${neu!.id}`);
  const paneel = page.getByRole('region', { name: 'Übernahme' });
  await paneel.getByRole('button', { name: 'Übernehmen' }).click();
  const uebernahme = page.getByRole('dialog', { name: 'Florian Nachbar 3 übernehmen' });
  await uebernahme.getByRole('combobox', { name: 'Abschnitt' }).click();
  await page.locator('.ant-select-item-option[title="EA Nord"]').click();
  await uebernahme.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByText('Florian Nachbar 3 übernommen')).toBeVisible();
  await expect(paneel).toHaveCount(0);
  await expect(page.getByText('nicht übernommen')).toHaveCount(0);

  await page.goto(`/einsaetze/${e}/einheiten`);
  await expect(page.getByRole('row').filter({ hasText: 'Florian Nachbar 3' })).toContainText(
    'EA Nord',
  );
  await expect(page.getByText('nicht übernommen')).toHaveCount(0);
});
