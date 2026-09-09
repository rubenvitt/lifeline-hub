import { expect, test, type Page } from '@playwright/test';

/**
 * Die ETB-Chronologie als Layoutmessung (LFH-342 · C7, Befunde H59/H64).
 *
 * WARUM HIER UND NICHT IN VITEST: jsdom rechnet kein Layout (`vite.config.ts` fährt
 * `css: false`) — alle Breiten sind dort 0, `boundingBox` gibt es nicht. Dass die
 * Breitenweiche und das Spaltenbudget existieren, pinnt `src/etb/EtbTabelle.test.tsx`;
 * hier geht es um die gemessene Wirkung, und die beiden Akzeptanzkriterien des Tickets
 * sind genau solche Messungen.
 *
 * DER BEFUND, gegen den gemessen wird: im Fükw (1366 px, geöffnetes ModulPanel, 1033 px
 * Contentbreite) belegten sechs fest verdrahtete Nebenspalten 884 px, dem Meldungstext
 * blieben 149 px — 14 % für ausgerechnet die beweissichernde Aussage. Bei 390 px standen
 * 278 px verfügbare Breite gegen dasselbe 884-px-Gerüst.
 *
 * DER GESÄTE TEXT IST DETERMINISTISCH UND KURZ. Das ist kein Zufall: `KatalogTabelle`
 * rendert mit `width: max-content` bei `min-width: 100%`, die Tabellenbreite ist also
 * inhaltsgetrieben mit Container als Untergrenze. Ein langer Text bliese die Inhaltsspalte
 * auf und machte die ≥50-%-Zusicherung trivial; ein kurzer ist der SCHWERE Fall, weil der
 * Überschuss dann allein aus der Verteilung der ungebundenen Spalte kommt.
 *
 * GEMESSEN WIRD GEGEN DIE SICHT, nicht gegen die Tabelle: bei sehr langem Inhalt wächst die
 * Tabelle über den Container hinaus und scrollt in sich — ein Verhältnis Spalte-zu-Tabelle
 * wäre dann kleiner, obwohl der Text MEHR Platz hat. Die Contentbreite ist die Bezugsgröße
 * des Befunds.
 *
 * BEWUSST KEIN Device-Descriptor und kein zweites Playwright-Projekt: ein
 * `devices['iPhone …']` zöge webkit nach, und ein Browser-Download ist im Repo nirgends
 * abgesichert (gleichlautend in fünf Bestands-Specs begründet). Anmelden und Säen laufen am
 * Fükw-Maß, erst danach wird umgestellt — Vorgehen aus `seitenrinne.spec.ts`.
 *
 * SEEDING PER `page.request`: die Session ist Cookie-basiert (`api/client.ts:35/46/56`,
 * `credentials: 'same-origin'`), `page.request` teilt den Cookie-Jar des Kontexts.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const HANDSCHIRM = { width: 390, height: 844 };
const FUEKW = { width: 1366, height: 768 };

/** Anteil der Contentbreite, den der Meldungstext im Fükw mindestens bekommt (AK#1). */
const MINDESTANTEIL = 0.5;

/**
 * Subpixel-Spielraum, aus `datensicht-schmal.spec.ts:26-46` übernommen. `boundingBox()`
 * liefert Fließkomma, und Chromium rechnet unter Last anders als im Einzellauf.
 */
const SUBPIXEL = 0.5;

const MELDUNG = 'Keller Musterweg 3 unter Wasser';

test.describe('LFH-463: Terminpflege und Wiedervorlage', () => {
  test.use({ timezoneId: 'Europe/Berlin' });
  test('übernimmt den gepflegten Termin sekundengenau und blendet die Schnellwahl nach Löschen aus', async ({ page }) => {
    await page.setViewportSize(FUEKW);
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Lagebesprechung ${Date.now()}`);
    await seedeEintrag(page, einsatzId);
    await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const termin = page.getByLabel('Nächste Lagebesprechung (optional)');
    await termin.fill('2099-09-09 15:17:43');
    // Enter übernimmt den Pickerwert und sendet das umgebende Formular ab.
    await termin.press('Enter');
    await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
    let einsatz = await (await page.request.get(`/api/einsaetze/${einsatzId}`)).json() as Record<string, unknown>;
    expect(einsatz.naechste_lagebesprechung_at).toBe('2099-09-09 13:17:43');

    async function oeffneWiedervorlage() {
      await page.goto(`/einsaetze/${einsatzId}/etb`);
      const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
      await expect(sicht.getByText(MELDUNG, { exact: true })).toBeVisible();
      await sicht.getByRole('button', { name: 'Aktionen zu Eintrag 1', exact: true }).click();
      await page.locator('.ant-dropdown:not(.ant-dropdown-hidden)')
        .getByRole('menuitem', { name: /Wiedervorlage/ }).click();
      return page.getByRole('dialog');
    }
    let dialog = await oeffneWiedervorlage();
    await dialog.getByRole('button', { name: 'Nächste Lagebesprechung', exact: true }).click();
    const gespeichert = page.waitForResponse((antwort) =>
      antwort.url().endsWith(`/api/einsaetze/${einsatzId}/erinnerungen`) && antwort.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    const antwort = await gespeichert;
    expect(antwort.ok()).toBeTruthy();
    expect(antwort.request().postDataJSON().faellig_at).toBe('2099-09-09 13:17:43');

    await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const picker = page.locator('.ant-picker').filter({ has: page.getByLabel('Nächste Lagebesprechung (optional)') });
    await picker.hover();
    await picker.locator('.ant-picker-clear').click();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
    einsatz = await (await page.request.get(`/api/einsaetze/${einsatzId}`)).json() as Record<string, unknown>;
    expect(einsatz).not.toHaveProperty('naechste_lagebesprechung_at');
    dialog = await oeffneWiedervorlage();
    await expect(dialog.getByRole('button', { name: '+30 min', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Nächste Lagebesprechung', exact: true })).toHaveCount(0);
  });
});

test.describe('LFH-464: ETB-Umbruch bei xl', () => {
  test.use({ hasTouch: true });
  for (const dichte of ['kompakt', 'komfortabel', 'handschuh']) {
    test(`misst beide Seiten der Schwelle und die Tabletbreiten (${dichte})`, async ({ page }, testInfo) => {
      await page.setViewportSize(FUEKW);
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E ETB xl ${dichte} ${Date.now()}`);
      await seedeEintrag(page, einsatzId);
      await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
      const messungen = [];
      for (const breite of [767, 768, 991, 992, 1024, 1199, 1200, 1280, 1366]) {
        await page.setViewportSize({ width: breite, height: 900 });
        await page.goto(`/einsaetze/${einsatzId}/etb`);
        await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
        const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
        await expect(sicht.getByText(MELDUNG, { exact: true })).toHaveCount(1);
        await expect(sicht.locator('.ant-table')).toHaveCount(breite >= 1200 ? 1 : 0);
        await expect(sicht.getByTestId('etb-ereigniszeile')).toHaveCount(breite >= 1200 ? 0 : 1);
        const mass = await sicht.evaluate((element) => {
          const text = element.querySelector<HTMLElement>('.markdown')!;
          const container = [...element.querySelectorAll<HTMLElement>('*')].filter((knoten) =>
            ['auto', 'scroll'].includes(getComputedStyle(knoten).overflowX));
          return {
            sicht: element.getBoundingClientRect().width,
            text: text.getBoundingClientRect().width,
            bodyUeberlauf: document.body.scrollWidth - window.innerWidth,
            innererUeberlauf: Math.max(0, ...container.map((knoten) => knoten.scrollWidth - knoten.clientWidth)),
          };
        });
        expect(mass.bodyUeberlauf, `Seitenrumpf bei ${breite}/${dichte}`).toBeLessThanOrEqual(SUBPIXEL);
        if (breite < 1200) {
          expect(mass.innererUeberlauf).toBeLessThanOrEqual(SUBPIXEL);
          expect(mass.text / mass.sicht).toBeGreaterThan(0.85);
        }
        messungen.push({ breite, dichte, ...mass });
      }
      await testInfo.attach('layoutmessung.json', {
        body: JSON.stringify(messungen, null, 2), contentType: 'application/json',
      });
    });
  }
});

// Login-/Anlege-Helfer aus `kernfluss.spec.ts` kopiert — es gibt (noch) kein geteiltes
// e2e-Hilfsmodul (gleichlautend in fünf Bestands-Specs vermerkt).
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

async function seedeEintrag(page: Page, einsatzId: string) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
    data: { typ: 'meldung', inhalt: MELDUNG, von: 'ELW 1', an: 'Leitstelle' },
  });
  expect(
    antwort.ok(),
    `Seeding ETB-Eintrag: ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
}

test('bei 390 px scrollt der Seitenrumpf nicht seitlich, und die Chronologie steht als Ereigniszeilen', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E ETB Breite ${Date.now()}`);
  await seedeEintrag(page, einsatzId);

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await page.waitForLoadState('networkidle');

  const bereich = page.getByRole('region', { name: 'Einsatztagebuch' });
  await expect(bereich).toHaveCount(1);
  // Der gesäte Eintrag ist der Anker. Ohne ihn wäre „kein Tabellenelement" auch bei einer
  // leeren, fehlgeschlagenen oder weggeleiteten Seite wahr.
  await expect(bereich.getByText(MELDUNG)).toHaveCount(1);

  // AK#1, erste Hälfte: der Rumpf wandert nicht.
  const mass = await page.evaluate(() => ({
    scroll: document.body.scrollWidth,
    innen: window.innerWidth,
  }));
  expect(
    mass.scroll,
    `Body scrollt seitlich: ${mass.scroll}px gegen ${mass.innen}px Fensterbreite`,
  ).toBeLessThanOrEqual(mass.innen + SUBPIXEL);

  // Und die Form: Ereigniszeilen statt Tabelle. Ein Tabellenelement, das nur in sich
  // scrollt, erfüllte die Zeile darüber ebenfalls — die Aussage des Tickets ist aber
  // die Auflösung in Zeilen.
  await expect(bereich.locator('[data-testid="etb-ereigniszeile"]')).toHaveCount(1);
  await expect(bereich.locator('table')).toHaveCount(0);
});

test('bei 1366 px bekommt der Meldungstext mindestens die halbe Contentbreite', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E ETB Spaltenbudget ${Date.now()}`);
  await seedeEintrag(page, einsatzId);

  await page.setViewportSize(FUEKW);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await page.waitForLoadState('networkidle');

  const bereich = page.getByRole('region', { name: 'Einsatztagebuch' });
  await expect(bereich).toHaveCount(1);
  await expect(bereich.getByText(MELDUNG)).toHaveCount(1);

  // Die Nebenspalten, die den Text erdrückten, sind bei dieser Breite aus (`abBreite:
  // 'xxl'`) — und der Spaltenschalter sagt es. Ohne diese Zeile wäre „Spalte weg" von
  // „Spalte kaputt" nicht zu unterscheiden.
  await expect(bereich.getByRole('columnheader', { name: 'Von → An' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /2 ausgeblendet/ })).toHaveCount(1);

  const inhalt = bereich.getByRole('columnheader', { name: 'Inhalt' });
  await expect(inhalt).toHaveCount(1);
  const spalte = await inhalt.boundingBox();
  const flaeche = await bereich.boundingBox();
  expect(spalte, 'Inhaltsspalte nicht messbar').not.toBeNull();
  expect(flaeche, 'Sichtfläche nicht messbar').not.toBeNull();

  const anteil = spalte!.width / flaeche!.width;
  expect(
    anteil,
    `Meldungstext bekommt ${Math.round(anteil * 100)} % der Contentbreite `
      + `(${Math.round(spalte!.width)}px von ${Math.round(flaeche!.width)}px), Soll ≥ 50 %`,
  ).toBeGreaterThanOrEqual(MINDESTANTEIL);
});
