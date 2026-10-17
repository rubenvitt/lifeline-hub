import { expect, test, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Verpflegung (LFH-1044; Spec `funktionsansichten`): ein Tablet bei 1280 × 800, einsatzweit
 * ohne Stelle, zählt Portionen an der Ausgabe (LLH-1032: 20 × „+1“ ohne Anfrage, nach der Ruhe
 * genau EINE Ausgabe über 20 EP) und meldet die Fehlmenge an die Einsatzleitung. Zeitfenster
 * anlegen, Bedarf ändern, löschen und Nachfordern gibt es auf dem Gerät nicht; nach dem Widerruf
 * endet es ohne Neuladen.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext. Kein `networkidle`
 * (LFH-385).
 *
 * Mutationsproben: in `geraetSicht.ts` `verpflegung-planen` für Geräte auf `true` → der Schritt
 * „kein Zeitfenster anlegen“ wird rot; `RUHE_MS` auf 0 in `verpflegung/ausgabeSammlung.ts` → der
 * Request-Zähler steht vor der Ruhe nicht auf null.
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

test('LFH-1044: Verpflegungsgerät bucht Portionen und meldet die Fehlmenge', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Verpflegung ${Date.now()}`,
  });
  const e = einsatz.id;
  const jetzt = Date.now();
  const zeit = (minuten: number) => new Date(jetzt + minuten * 60_000).toISOString();
  await anlegen(page, `/api/einsaetze/${e}/verpflegung/zeitfenster`, {
    bezeichnung: 'Mittag Deich',
    von_at: zeit(-30),
    bis_at: zeit(90),
    bedarf_kraefte: 60,
    bedarf_betreute: 20,
  });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'verpflegung', bezeichnung: 'Ausgabe Deich' },
  );

  const kontext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/verpflegung$`));

    const nav = tablet.getByRole('navigation', { name: 'Gerätenavigation' });
    await expect(nav.getByRole('link')).toHaveText(['Verpflegung', 'Melden']);
    const karte = tablet.getByRole('article', { name: /^Zeitfenster Mittag Deich/ });
    await expect(karte).toBeVisible();

    // Planen bleibt bei der Führung: kein Anlegen, kein Bedarf, kein Nachfordern.
    await expect(tablet.getByRole('button', { name: 'Zeitfenster anlegen' })).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: /^Bedarf bearbeiten/ })).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: /^Aktionen zu/ })).toHaveCount(0);
    await expect(tablet.getByText('Nachfordern')).toHaveCount(0);

    // Zählen an der Ausgabe (LLH-1032): Sprung von der Karte in die Ausgabeansicht.
    const anfragen: string[] = [];
    tablet.on('request', (r) => {
      if (r.method() === 'POST' && /\/verpflegung\/zeitfenster\/\d+\/ausgaben$/.test(r.url())) {
        anfragen.push(r.url());
      }
    });
    await karte.getByRole('link', { name: /^Ausgabe öffnen zu/ }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/verpflegung/\\d+/ausgabe$`));
    await expect(tablet.getByRole('heading', { level: 1, name: 'Mittag Deich' })).toBeVisible();
    // Auf der Unterseite bleibt das Navigationsziel „Verpflegung“ aktiv.
    await expect(nav.getByRole('link', { name: 'Verpflegung' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const plus1 = tablet.getByRole('button', { name: '+1', exact: true });
    for (let i = 0; i < 20; i++) await plus1.click();
    // Gezählt wird lokal: noch keine Anfrage, die Sammlung steht bei 20.
    expect(anfragen).toHaveLength(0);
    await expect(tablet.locator('[data-lfh="sammlung-menge"]')).toHaveText('20');
    // Nach der Ruhe (3 s) genau eine Ausgabe über 20 EP; Kopf und Liste zeigen sie.
    await expect(tablet.getByText('Gebucht: 20 EP zu ‚Mittag Deich‘')).toBeVisible();
    expect(anfragen).toHaveLength(1);
    const kopf = tablet.locator('[data-lfh="ausgabe-kopf"]');
    await expect(
      kopf
        .locator('[data-lfh="kennzahl"]', { hasText: 'ausgegeben' })
        .locator('[data-lfh="kennzahl-wert"]'),
    ).toHaveText('20');
    await expect(tablet.locator('[data-lfh="sammlung-menge"]')).toHaveText('0');
    const zeile = tablet.locator('[data-lfh="ausgabe-zeile"]');
    await expect(zeile).toHaveCount(1);
    await expect(zeile).toContainText('20 EP');
    // Die eigene Buchung lässt sich zurücknehmen (Rücknahme gehört zur Ansicht).
    await zeile.getByRole('button', { name: /^Zurücknehmen: Ausgabe 20 EP/ }).click();
    const rueckfrage = tablet.getByRole('dialog', { name: 'Ausgabe zurücknehmen?' });
    await rueckfrage.getByRole('button', { name: 'Zurücknehmen' }).click();
    await expect(rueckfrage).toHaveCount(0);
    await expect(zeile).toHaveAttribute('data-zurueckgenommen', 'true');

    // Nachtragen von der Liste: 50 EP über das Formular.
    await nav.getByRole('link', { name: 'Verpflegung' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/verpflegung$`));
    await karte.getByRole('button', { name: /^Ausgabe nachtragen zu/ }).click();
    const dialog = tablet.getByRole('dialog', { name: /Ausgabe nachtragen/ });
    await dialog.getByLabel('Menge (EP)').fill('50');
    await dialog.getByRole('button', { name: 'Nachtragen' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(karte.getByRole('button', { name: /^Zurücknehmen: Ausgabe 50 EP/ })).toBeVisible();

    // 80 Bedarf, 50 ausgegeben: die Fehlmenge geht als Meldung an die Einsatzleitung.
    await karte.getByRole('button', { name: /^Fehlmenge melden zu/ }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/meldungen$`));
    const inhalt = tablet.getByLabel('Inhalt');
    await expect(inhalt).toHaveValue(
      /^Fehlmenge Verpflegung ‚Mittag Deich‘ .+: 30 EP \(Bedarf 80, ausgegeben 50\)\.$/,
    );
    await tablet.getByRole('button', { name: 'Meldung senden' }).click();
    // Auf die Quittung warten, nicht auf den Text: der stünde auch im Feld (e2e-Falle textarea).
    await expect(tablet.getByLabel('Inhalt')).toHaveValue('');
    await expect(tablet.getByText(/^Fehlmenge Verpflegung ‚Mittag Deich‘/)).toBeVisible();

    // Die Einsatzleitung sieht die Ausgabe in der Deckung und die Meldung mit dem Gerät als
    // Absender.
    const verpflegung = await page.request.get(`/api/einsaetze/${e}/verpflegung`);
    const zf = ((await verpflegung.json()) as { zeitfenster: { ausgegeben: { gesamt: number } }[] })
      .zeitfenster[0];
    // 20 gezählt und zurückgenommen, 50 nachgetragen.
    expect(zf.ausgegeben.gesamt).toBe(50);
    const meldungen = await page.request.get(`/api/einsaetze/${e}/meldungen`);
    const liste = (await meldungen.json()) as { inhalt: string; absender: string }[];
    expect(liste.find((m) => m.inhalt.startsWith('Fehlmenge Verpflegung'))?.absender).toBe(
      'Verpflegung · Ausgabe Deich',
    );

    // Widerruf durch die Einsatzleitung: das Gerät endet von selbst, ohne Neuladen.
    await anlegen(page, `/api/einsaetze/${e}/geraete/${kopplung.kopplung.id}/widerrufen`);
    await expect(tablet).toHaveURL(/\/kopplung-beendet$/);
    await expect(tablet.getByRole('heading', { name: 'Kopplung beendet' })).toBeVisible();
  } finally {
    await kontext.close();
  }
});

/**
 * Stellen am Gerät (LLH-1040, design.md D13 Punkt 7): das Gerät sieht die Ansicht „Stellen“ ohne
 * eine Aktion, in der Ausgabeansicht ist die einzige zugeordnete Stelle vorgewählt; eine Hand-Wahl
 * bucht an der gewählten Stelle, das Ist der Stelle steht daneben.
 */
test('LLH-1040: Verpflegungsgerät sieht Stellen ohne Aktionen und bucht an einer gewählten Stelle', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const { id: e } = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Verpflegung Stellen ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${e}/verpflegung`;
  const jetzt = Date.now();
  const zeit = (minuten: number) => new Date(jetzt + minuten * 60_000).toISOString();
  const stelle = async (bezeichnung: string, art: string) => {
    const { id } = await anlegen(page, `${basis}/stellen`, { bezeichnung, art });
    await anlegen(page, `${basis}/stellen/${id}/status`, { status: 'aktiv' });
    return id;
  };
  const feldkueche = await stelle('Feldküche BR Sportplatz', 'feldkueche');
  const turnhalle = await stelle('Ausgabe Turnhalle Nord', 'ausgabestelle');
  const { id: mittag } = await anlegen(page, `${basis}/zeitfenster`, {
    bezeichnung: 'Mittag Deich',
    von_at: zeit(-30),
    bis_at: zeit(90),
    bedarf_kraefte: 60,
    bedarf_betreute: 20,
  });
  const zuordnung = await page.request.patch(`${basis}/zeitfenster/${mittag}`, {
    data: { stelle_ids: [feldkueche] },
  });
  expect(zuordnung.ok(), `Zuordnung: ${zuordnung.status()}`).toBeTruthy();
  const kopplung = await anlegen<{ code: { code: string } }>(page, `/api/einsaetze/${e}/geraete`, {
    ansicht: 'verpflegung',
    bezeichnung: 'Ausgabe Turnhalle',
  });

  const kontext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/verpflegung$`));

    // Ansicht „Stellen“: beide Stellen, keine Aktion, kein Anlegen.
    await tablet.getByRole('radio', { name: 'Stellen (2)' }).click();
    const zeilen = tablet.locator('[data-lfh="verpflegungsstelle"]');
    await expect(zeilen).toHaveCount(2);
    await expect(zeilen.first()).toHaveAttribute('data-status', 'aktiv');
    await expect(tablet.locator('[data-lfh="stelle-aktionen"]')).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: 'Stelle anlegen' })).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: /zu Stelle / })).toHaveCount(0);

    // Ausgabeansicht: die einzige zugeordnete Stelle ist vorgewählt, gewählt wird die Turnhalle.
    await tablet.getByRole('radio', { name: /^laufend/ }).click();
    const karte = tablet.getByRole('article', { name: /^Zeitfenster Mittag Deich/ });
    await karte.getByRole('link', { name: /^Ausgabe öffnen zu/ }).click();
    await expect(tablet.getByRole('heading', { level: 1, name: 'Mittag Deich' })).toBeVisible();
    const wahl = tablet.locator('[data-lfh="ausgabe-stelle"]');
    await expect(wahl.locator('.ant-select')).toContainText('Feldküche BR Sportplatz');
    await wahl.getByRole('combobox', { name: 'Stelle' }).click();
    await tablet
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .locator('.ant-select-item-option[title="Ausgabe Turnhalle Nord"]')
      .click();
    await expect(wahl.locator('.ant-select')).toContainText('Ausgabe Turnhalle Nord');
    await expect(wahl.locator('[data-lfh="ausgabe-stelle-ist"]')).toHaveText('an der Stelle 0 EP');

    const plus1 = tablet.getByRole('button', { name: '+1', exact: true });
    for (let i = 0; i < 5; i++) await plus1.click();
    await expect(tablet.getByText('Gebucht: 5 EP zu ‚Mittag Deich‘')).toBeVisible();
    await expect(wahl.locator('[data-lfh="ausgabe-stelle-ist"]')).toHaveText('an der Stelle 5 EP');

    const antwort = await page.request.get(`/api/einsaetze/${e}/verpflegung`);
    const stand = (await antwort.json()) as {
      zeitfenster: {
        ausgaben: { menge: number; verpflegungsstelle_id: number | null }[];
        je_stelle: { stelle_id: number | null; ausgegeben: { gesamt: number } }[];
      }[];
    };
    const zf = stand.zeitfenster[0];
    expect(zf.ausgaben.map((a) => [a.menge, a.verpflegungsstelle_id])).toEqual([[5, turnhalle]]);
    // Die zugeordnete Stelle steht mit 0 EP in `je_stelle`, die gewählte mit der Buchung.
    expect(zf.je_stelle.map((z) => [z.stelle_id, z.ausgegeben.gesamt])).toEqual([
      [feldkueche, 0],
      [turnhalle, 5],
    ]);
  } finally {
    await kontext.close();
  }
});

/**
 * Gerät an einer Verpflegungsstelle (LLH-1048, Entscheidung LLH-1024 F7; Spec
 * `funktionsansichten`, „Verpflegungsgerät an einer Verpflegungsstelle“): die Einsatzleitung
 * koppelt über die Maske an die Feldküche. Das Gerät sieht die Zeitfenster der Feldküche und das
 * einsatzweite, nicht das der Turnhalle; der Kopf nennt die Stelle, die Ausgabeansicht hat keine
 * Stellenwahl, und die gezählte Ausgabe trägt die Feldküche. Die Feldküche meldet danach
 * `geraet_gekoppelt` (die Storno-Sperre selbst belegt `tests/geraet_kopplung.rs`).
 *
 * Mutationsproben: in `AusgabeAnsicht.tsx` die feste Stelle ignoriert (`gewaehlteStelle` nur aus
 * der Wahl) → „Stelle fest“ und die Stelle an der Ausgabe werden rot; in
 * `verpflegung::stellensicht` den Zeitfensterfilter aus → „Abend Turnhalle“ ist sichtbar.
 */
test('LLH-1048: Gerät an der Feldküche sieht die Turnhalle nicht und bucht an der Feldküche', async ({
  page,
  browser,
}) => {
  // Zwei Kontexte und die Kopplungsmaske: lokal knapp unter dem Vorgabe-Budget von 30 s.
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await anmeldenAlsAdmin(page);
  const { id: e } = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Verpflegung an Stelle ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${e}/verpflegung`;
  const jetzt = Date.now();
  const zeit = (minuten: number) => new Date(jetzt + minuten * 60_000).toISOString();
  const stelle = async (bezeichnung: string, art: string) => {
    const { id } = await anlegen(page, `${basis}/stellen`, { bezeichnung, art });
    await anlegen(page, `${basis}/stellen/${id}/status`, { status: 'aktiv' });
    return id;
  };
  const feldkueche = await stelle('Feldküche BR Sportplatz', 'feldkueche');
  const turnhalle = await stelle('Ausgabe Turnhalle Nord', 'ausgabestelle');
  const zeitfenster = (bezeichnung: string, stelle_ids: number[]) =>
    anlegen(page, `${basis}/zeitfenster`, {
      bezeichnung,
      von_at: zeit(-30),
      bis_at: zeit(90),
      bedarf_kraefte: 60,
      bedarf_betreute: 0,
      stelle_ids,
    });
  await zeitfenster('Mittag Feldküche', [feldkueche]);
  await zeitfenster('Abend Turnhalle', [turnhalle]);
  await zeitfenster('Getränke einsatzweit', []);

  // Einsatzleitung: über die Maske an die Feldküche koppeln.
  await page.goto(`/einsaetze/${e}/einstellungen/geraete`);
  await page.getByRole('button', { name: 'Gerät koppeln' }).click();
  await waehleIn(page.getByRole('combobox', { name: 'Ansicht' }), 'Verpflegung');
  const stellenFeld = page.getByRole('combobox', { name: 'Verpflegungsstelle' });
  await expect(page.locator('.ant-form-item', { has: stellenFeld })).toContainText(
    'ohne Stelle (einsatzweit)',
  );
  await waehleIn(stellenFeld, 'Feldküche BR Sportplatz');
  await page.getByLabel('Gerätebezeichnung').fill('Tresen');
  await page.getByRole('button', { name: 'Koppeln', exact: true }).click();
  const codeText = page.locator('[data-lfh="kopplungscode-text"]');
  await expect(codeText).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await codeText.textContent())!.replace('-', '');
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.locator('[data-lfh="geraet-titel"]')).toHaveText(
    'Feldküche BR Sportplatz · Tresen',
  );

  const kontext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/verpflegung$`));
    await expect(
      tablet.getByRole('banner').getByText('Feldküche BR Sportplatz', { exact: true }),
    ).toBeVisible();

    // Nur die eigenen und die einsatzweiten Zeitfenster.
    const karten = tablet.locator('[data-lfh="verpflegung-karte"]');
    await expect(
      tablet.getByRole('article', { name: /^Zeitfenster Mittag Feldküche/ }),
    ).toBeVisible();
    await expect(
      tablet.getByRole('article', { name: /^Zeitfenster Getränke einsatzweit/ }),
    ).toBeVisible();
    await expect(karten).toHaveCount(2);
    await expect(tablet.getByText('Abend Turnhalle')).toHaveCount(0);

    // Ausgabeansicht: die Stelle steht fest, keine Wahl; gezählt wird an der Feldküche.
    await tablet
      .getByRole('article', { name: /^Zeitfenster Mittag Feldküche/ })
      .getByRole('link', { name: /^Ausgabe öffnen zu/ })
      .first()
      .click();
    await expect(tablet.getByRole('heading', { level: 1, name: 'Mittag Feldküche' })).toBeVisible();
    const platz = tablet.locator('[data-lfh="ausgabe-stelle"]');
    await expect(platz.locator('[data-lfh="ausgabe-stelle-fest"]')).toHaveText(
      'Stelle Feldküche BR Sportplatz',
    );
    await expect(platz.getByRole('combobox')).toHaveCount(0);
    const plus1 = tablet.getByRole('button', { name: '+1', exact: true });
    for (let i = 0; i < 4; i++) await plus1.click();
    await expect(tablet.getByText('Gebucht: 4 EP zu ‚Mittag Feldküche‘')).toBeVisible();
    await expect(platz.locator('[data-lfh="ausgabe-stelle-ist"]')).toHaveText('an der Stelle 4 EP');

    const antwort = await page.request.get(basis);
    const stand = (await antwort.json()) as {
      zeitfenster: {
        bezeichnung: string;
        ausgaben: { menge: number; verpflegungsstelle_id: number | null }[];
      }[];
      stellen: { id: number; geraet_gekoppelt: boolean }[];
    };
    const mittag = stand.zeitfenster.find((z) => z.bezeichnung === 'Mittag Feldküche')!;
    expect(mittag.ausgaben.map((a) => [a.menge, a.verpflegungsstelle_id])).toEqual([
      [4, feldkueche],
    ]);

    // Die Feldküche trägt das Gerät, die Turnhalle nicht.
    expect(stand.stellen.find((s) => s.id === feldkueche)?.geraet_gekoppelt).toBe(true);
    expect(stand.stellen.find((s) => s.id === turnhalle)?.geraet_gekoppelt).toBe(false);
  } finally {
    await kontext.close();
  }
});
