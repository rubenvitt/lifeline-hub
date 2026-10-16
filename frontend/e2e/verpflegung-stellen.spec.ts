import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Verpflegungsstellen in der Oberfläche (LLH-1040 Teil II, design.md D13; Spec
 * `kraefte-verpflegung`, „Stellen im Modul“): am Desktop in `kompakt` und im Handschuh-Betrieb
 * eine Stelle anlegen und in Betrieb nehmen, sie einem Zeitfenster zuordnen, an ihr eine Ausgabe
 * nachtragen, das Ist je Stelle an der Karte lesen, sie auflösen — danach ist sie in der
 * Ausgabeansicht nicht mehr wählbar. Der Beobachter sieht die Stellen ohne Aktionen; bei 390 px
 * scrollt nichts waagrecht.
 *
 * Seeding als Admin über die API, was nicht selbst geprüft wird. Kein `networkidle` (LFH-385).
 *
 * Mutationsproben: in `StellenListe.tsx` den Riegel `!darfPlanen ? []` entfernt → der
 * Beobachter-Test findet „Aktionen zu Stelle“ und wird rot; in `ZeitfensterKarte.tsx` die
 * Aufstellung auch bei leerem `je_stelle` → die Probe „Abend ohne Aufstellung“ wird rot.
 */

const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const HANDSCHIRM = { width: 390, height: 844 };

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, data === undefined ? {} : { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

const zeit = (minuten: number) => new Date(Date.now() + minuten * 60_000).toISOString();

/** Einsatz mit „Mittag Stellen“ (laufend, 200 EP) und „Abend Stellen“ (anstehend, ohne Stelle). */
async function saeen(page: Page) {
  await anmeldenAlsAdmin(page);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Stellen ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${e}/verpflegung`;
  const { id: mittag } = await senden(page, 'post', `${basis}/zeitfenster`, {
    bezeichnung: 'Mittag Stellen',
    von_at: zeit(-20),
    bis_at: zeit(100),
    bedarf_kraefte: 200,
    bedarf_betreute: 0,
  });
  await senden(page, 'post', `${basis}/zeitfenster`, {
    bezeichnung: 'Abend Stellen',
    von_at: zeit(300),
    bis_at: zeit(400),
    bedarf_kraefte: 50,
    bedarf_betreute: 0,
  });
  return { e, mittag, basis };
}

async function setzeDichte(page: Page, dichte: 'kompakt' | 'handschuh') {
  await page.evaluate(([k, w]) => localStorage.setItem(k, w), [DICHTE_SCHLUESSEL, dichte]);
}

/**
 * Wählt in einer antd-Auswahl (über ihr Label im `bereich`) die genannten Einträge. Je Eintrag
 * wiederholt, bis die Auswahl ihn trägt: im Handschuh-Betrieb kann der erste Klick in die noch
 * einfahrende Liste ins Leere gehen. Getragenes wird nicht noch einmal geklickt (Mehrfachauswahl
 * nähme es sonst wieder heraus).
 */
async function waehle(page: Page, bereich: Locator, feld: string, ...optionen: string[]) {
  const box = bereich.getByRole('combobox', { name: feld });
  const wurzel = box.locator(
    'xpath=ancestor::*[contains(concat(" ", @class, " "), " ant-select ")][1]',
  );
  const liste = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  for (const o of optionen) {
    await expect(async () => {
      if ((await wurzel.textContent())?.includes(o)) return;
      if (!(await liste.isVisible())) await box.click();
      await liste.locator(`.ant-select-item-option[title="${o}"]`).click({ timeout: 2_000 });
      await expect(wurzel).toContainText(o, { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
  }
}

const karte = (page: Page, name: string) =>
  page.getByRole('article', { name: new RegExp(`^Zeitfenster ${name}`) });
const zeile = (page: Page, name: string) => page.getByRole('article', { name: `Stelle ${name}` });

async function offenesMenue(page: Page) {
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  await expect(menue).toBeVisible();
  return menue;
}

for (const dichte of ['kompakt', 'handschuh'] as const) {
  test(`Stelle anlegen, in Betrieb nehmen, zuordnen, buchen, auflösen (${dichte})`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { e, mittag, basis } = await saeen(page);
    // Eine zweite, schon aktive Stelle über die API: sie macht die Aufstellung zu zwei Zeilen.
    const { id: turnhalle } = await senden(page, 'post', `${basis}/stellen`, {
      bezeichnung: 'Ausgabe Turnhalle Nord',
      art: 'ausgabestelle',
    });
    await senden(page, 'post', `${basis}/stellen/${turnhalle}/status`, { status: 'aktiv' });

    await page.goto(`/einsaetze/${e}/verpflegung`);
    await setzeDichte(page, dichte);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    await expect(karte(page, 'Mittag Stellen')).toBeVisible();

    // ── Ansicht „Stellen“: anlegen und in Betrieb nehmen ───────────────────────────────
    await page.getByRole('radio', { name: 'Stellen (1)' }).click();
    const kopf = page.locator('[data-lfh="seitenkopf-aktionen"]');
    await kopf.getByRole('button', { name: 'Stelle anlegen' }).click();
    const anlegen = page.getByRole('dialog', { name: 'Stelle anlegen' });
    await anlegen.getByLabel('Bezeichnung').fill('Feldküche BR Sportplatz');
    await waehle(page, anlegen, 'Art', 'Feldküche');
    await anlegen.getByLabel('Standort').fill('Sportplatz am Deich');
    await anlegen.getByRole('button', { name: 'Anlegen' }).click();
    await expect(anlegen).toHaveCount(0);
    await expect(page.getByText('Stelle ‚Feldküche BR Sportplatz‘ angelegt')).toBeVisible();
    const feldkueche = zeile(page, 'Feldküche BR Sportplatz');
    await expect(feldkueche).toHaveAttribute('data-status', 'geplant');
    await expect(feldkueche).toContainText('Sportplatz am Deich');
    await expect(page.getByRole('radio', { name: 'Stellen (2)' })).toBeVisible();

    await feldkueche
      .getByRole('button', { name: 'Aktionen zu Stelle Feldküche BR Sportplatz' })
      .click();
    await (await offenesMenue(page)).getByText('In Betrieb nehmen').click();
    await expect(feldkueche).toHaveAttribute('data-status', 'aktiv');
    await expect(feldkueche).toContainText('kein laufendes Zeitfenster');

    // ── Zeitfenster zuordnen ─────────────────────────────────────────────────────────────
    await page.getByRole('radio', { name: /^laufend|^aktuell/ }).click();
    const m = karte(page, 'Mittag Stellen');
    await m.getByRole('button', { name: /^Aktionen zu Zeitfenster Mittag Stellen/ }).click();
    await (await offenesMenue(page)).getByText('Bedarf bearbeiten').click();
    const bedarf = page.getByRole('dialog', { name: 'Bedarf bearbeiten: Mittag Stellen' });
    await bedarf.getByRole('button', { name: /^Art und Stellen/ }).click();
    await waehle(page, bedarf, 'Art', 'warm');
    await waehle(page, bedarf, 'Stellen', 'Feldküche BR Sportplatz', 'Ausgabe Turnhalle Nord');
    await bedarf.getByText('Bedarf bearbeiten: Mittag Stellen').click();
    await expect(
      bedarf.getByRole('button', { name: 'Art und Stellen · warm · 2 Stellen' }),
    ).toBeVisible();
    await bedarf.getByRole('button', { name: 'Speichern' }).click();
    await expect(bedarf).toHaveCount(0);
    await expect(m.locator('[data-lfh="verpflegungsart"]')).toHaveText('warm');

    // ── Ausgabe an der Stelle nachtragen; die zweite kommt über die API ──────────────────
    await m.getByRole('button', { name: /^Aktionen zu Zeitfenster Mittag Stellen/ }).click();
    await (await offenesMenue(page)).getByText('Ausgabe nachtragen').click();
    const nachtrag = page.getByRole('dialog', { name: 'Ausgabe nachtragen: Mittag Stellen' });
    await nachtrag.getByLabel('Menge (EP)').fill('100');
    await expect(nachtrag.getByLabel('Zuführungsziel')).toBeVisible();
    await waehle(page, nachtrag, 'Stelle', 'Feldküche BR Sportplatz');
    await expect(nachtrag.getByLabel('Zuführungsziel')).toHaveCount(0);
    await nachtrag.getByRole('button', { name: 'Nachtragen' }).click();
    await expect(nachtrag).toHaveCount(0);
    await senden(page, 'post', `${basis}/zeitfenster/${mittag}/ausgaben`, {
      menge: 80,
      verpflegungsstelle_id: turnhalle,
    });

    // ── Karte: Ist je Stelle, Gesamt-Fehlmenge 20; „Abend“ ohne Aufstellung ──────────────
    const jeStelle = m.locator('[data-lfh="verpflegung-je-stelle"] [data-lfh="je-stelle-text"]');
    await expect(jeStelle).toHaveText([
      'Ausgabe Turnhalle Nord · 80 EP',
      'Feldküche BR Sportplatz · 100 EP',
    ]);
    await expect(
      m
        .locator('[data-lfh="kennzahl"]', { hasText: 'fehlt' })
        .locator('[data-lfh="kennzahl-wert"]'),
    ).toHaveText('20');
    await expect(m.locator('[data-lfh="verpflegung-ausgabe"]').first()).toContainText(
      'Feldküche BR Sportplatz',
    );
    await expect(
      karte(page, 'Abend Stellen').locator('[data-lfh="verpflegung-je-stelle"]'),
    ).toHaveCount(0);
    await expect(
      m.getByRole('link', { name: /^Ausgabe öffnen an Feldküche BR Sportplatz zu/ }),
    ).toHaveAttribute('href', new RegExp(`/ausgabe\\?stelle=\\d+$`));

    // ── Stelle auflösen: rote Rückfrage, danach nicht mehr wählbar ───────────────────────
    await page.getByRole('radio', { name: /^Stellen/ }).click();
    await expect(feldkueche.locator('[data-lfh="stelle-laufend"]')).toContainText(
      '100 EP ausgegeben',
    );
    await feldkueche
      .getByRole('button', { name: 'Auflösen … zu Stelle Feldküche BR Sportplatz' })
      .click();
    const rueckfrage = page.getByRole('dialog', {
      name: 'Stelle ‚Feldküche BR Sportplatz‘ auflösen?',
    });
    const ok = rueckfrage.getByRole('button', { name: 'Auflösen' });
    await expect(ok).toHaveClass(/ant-btn-dangerous/);
    await ok.click();
    await expect(rueckfrage).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Stellen (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'aufgelöst (1)' }).click();
    await expect(feldkueche).toHaveAttribute('data-status', 'aufgeloest');

    await page.goto(`/einsaetze/${e}/verpflegung/${mittag}/ausgabe`);
    await expect(page.getByRole('heading', { level: 1, name: 'Mittag Stellen' })).toBeVisible();
    const platz = page.locator('[data-lfh="ausgabe-stelle"]');
    await platz.getByRole('combobox', { name: 'Stelle' }).click();
    const optionen = page.locator(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
    );
    await expect(optionen).toHaveText(['ohne Stelle', 'Ausgabe Turnhalle Nord']);
  });
}

test('Beobachter: Stellen ohne Aktionen, „Stelle anlegen“ gesperrt', async ({ page }) => {
  const { e, basis } = await saeen(page);
  await senden(page, 'post', `${basis}/stellen`, {
    bezeichnung: 'Zuführung Deich',
    art: 'zufuehrung',
  });
  await wechsleZuRolle(page, 'beobachter', String(e));
  await page.goto(`/einsaetze/${e}/verpflegung`);
  await page.getByRole('radio', { name: 'Stellen (1)' }).click();
  await expect(zeile(page, 'Zuführung Deich')).toBeVisible();
  await expect(
    page
      .locator('[data-lfh="seitenkopf-aktionen"]')
      .getByRole('button', { name: 'Stelle anlegen' }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: /zu Stelle/ })).toHaveCount(0);
  await expect(page.locator('[data-lfh="stelle-aktionen"]')).toHaveCount(0);
});

test('390 px im Handschuh-Betrieb: Stellen, Karte je Stelle und Stellenwahl ohne waagrechtes Scrollen', async ({
  page,
}) => {
  const { e, mittag, basis } = await saeen(page);
  const ids: number[] = [];
  for (const [bezeichnung, art] of [
    ['Feldküche BR Sportplatz mit einem langen Namen am Deich', 'feldkueche'],
    ['Ausgabe Turnhalle Nord', 'ausgabestelle'],
  ] as const) {
    const { id } = await senden(page, 'post', `${basis}/stellen`, {
      bezeichnung,
      art,
      standort: 'Sportplatz am Deich, Musterstadt',
    });
    await senden(page, 'post', `${basis}/stellen/${id}/status`, { status: 'aktiv' });
    ids.push(id);
  }
  await senden(page, 'patch', `${basis}/zeitfenster/${mittag}`, {
    stelle_ids: ids,
    verpflegungsart: 'getraenke',
  });
  await senden(page, 'post', `${basis}/zeitfenster/${mittag}/ausgaben`, {
    menge: 30,
    verpflegungsstelle_id: ids[0],
  });

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${e}/verpflegung`);
  await setzeDichte(page, 'handschuh');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  const ueberlauf = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

  await expect(
    karte(page, 'Mittag Stellen').locator('[data-lfh="verpflegung-je-stelle"]'),
  ).toBeVisible();
  expect(await ueberlauf()).toBeLessThanOrEqual(0);

  // Schmal ohne Zahl (design.md, Risiken: die Werkzeugzeile trägt sie bei 390 px nicht).
  await page.getByRole('radio', { name: 'Stellen', exact: true }).click();
  await expect(page.locator('[data-lfh="verpflegungsstelle"]')).toHaveCount(2);
  expect(await ueberlauf()).toBeLessThanOrEqual(0);

  await page.goto(`/einsaetze/${e}/verpflegung/${mittag}/ausgabe`);
  await expect(page.locator('[data-lfh="ausgabe-stelle"]').getByRole('combobox')).toBeVisible();
  expect(await ueberlauf()).toBeLessThanOrEqual(0);
});
