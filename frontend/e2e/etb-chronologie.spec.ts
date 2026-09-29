import { expect, test, type Page } from '@playwright/test';

/**
 * Die ETB-Chronologie als Layoutmessung: das Tagebuch ist auf ALLEN Breiten eine Zeitachse
 * (`src/etb/EtbZeitachse.tsx`, Struktur-Pins in `EtbZeitachse.test.tsx`). Gemessen wird, dass
 * der Meldungstext Platz hat und nichts überläuft.
 *
 * DER GESÄTE TEXT DER ERSTEN BLÖCKE IST KURZ: für die ≥50-%-Zusicherung ist ein kurzer Text
 * der schwere Fall (ein langer machte sie trivial). Den langen Text prüft der dritte Block.
 *
 * GEMESSEN WIRD GEGEN DIE CONTENTBREITE, nie gegen den eigenen Container: der Befund ist in
 * der Contentbreite formuliert, und ein Verhältnis zu einem mitwachsenden Container kann
 * kleiner werden, obwohl der Text mehr Platz hat.
 *
 * Kein Device-Descriptor; Anmelden und Säen am Fükw-Maß, erst danach umstellen. Seeding per
 * `page.request`.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const HANDSCHIRM = { width: 390, height: 844 };
const FUEKW = { width: 1366, height: 768 };

/** Anteil der Contentbreite, den der Meldungstext im Fükw mindestens bekommt (AK#1). */
const MINDESTANTEIL = 0.5;

/** Subpixel-Spielraum: `boundingBox()` liefert Fließkomma, Chromium rechnet unter Last anders. */
const SUBPIXEL = 0.5;

const MELDUNG = 'Keller Musterweg 3 unter Wasser';

test.describe('LFH-463: Terminpflege und Wiedervorlage', () => {
  test.use({ timezoneId: 'Europe/Berlin' });
  test('übernimmt den gepflegten Termin sekundengenau und blendet die Schnellwahl nach Löschen aus', async ({
    page,
  }) => {
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
    let einsatz = (await (await page.request.get(`/api/einsaetze/${einsatzId}`)).json()) as Record<
      string,
      unknown
    >;
    expect(einsatz.naechste_lagebesprechung_at).toBe('2099-09-09 13:17:43');

    async function oeffneWiedervorlage() {
      await page.goto(`/einsaetze/${einsatzId}/etb`);
      const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
      await expect(sicht.getByText(MELDUNG, { exact: true })).toBeVisible();
      await sicht.getByRole('button', { name: 'Aktionen zu Eintrag 1', exact: true }).click();
      await page
        .locator('.ant-dropdown:not(.ant-dropdown-hidden)')
        .getByRole('menuitem', { name: /Wiedervorlage/ })
        .click();
      return page.getByRole('dialog');
    }
    let dialog = await oeffneWiedervorlage();
    await dialog.getByRole('button', { name: 'Nächste Lagebesprechung', exact: true }).click();
    const gespeichert = page.waitForResponse(
      (antwort) =>
        antwort.url().endsWith(`/api/einsaetze/${einsatzId}/erinnerungen`) &&
        antwort.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    const antwort = await gespeichert;
    expect(antwort.ok()).toBeTruthy();
    expect(antwort.request().postDataJSON().faellig_at).toBe('2099-09-09 13:17:43');

    await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const picker = page
      .locator('.ant-picker')
      .filter({ has: page.getByLabel('Nächste Lagebesprechung (optional)') });
    await picker.hover();
    await picker.locator('.ant-picker-clear').click();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
    einsatz = (await (await page.request.get(`/api/einsaetze/${einsatzId}`)).json()) as Record<
      string,
      unknown
    >;
    expect(einsatz).not.toHaveProperty('naechste_lagebesprechung_at');
    dialog = await oeffneWiedervorlage();
    await expect(dialog.getByRole('button', { name: '+30 min', exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Nächste Lagebesprechung', exact: true }),
    ).toHaveCount(0);
  });
});

/**
 * Die Zeitachse auf ALLEN Breiten: keine `.ant-table`, genau eine Ereigniszeile, kein Überlauf
 * (Rumpf UND jeder Scrollcontainer der Sicht), und der Meldungstext hat Platz.
 *
 * DIE ANTEILSSCHWELLEN SIND SETZUNGEN [abgeleitet]: neben dem Text stehen Zeit/Nr. und
 * Verfasser/Weg/Aktion, bei 390 px im Handschuh nimmt allein der Aktionsknopf 72 px. 30 % ist
 * der Boden für schmale Schirme, ab 1200 px die Hälfte der Sicht. Die Messwerte hängen am
 * Lauf; wer die Schwellen schärft, schärft sie gegen diese Anhänge.
 */
test.describe('Neuentwurf S4: Zeitachse auf allen Breiten', () => {
  test.use({ hasTouch: true });
  for (const dichte of ['kompakt', 'komfortabel', 'handschuh']) {
    test(`keine Tabelle, kein Überlauf, Platz für den Text (${dichte})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(FUEKW);
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E ETB Zeitachse ${dichte} ${Date.now()}`);
      await seedeEintrag(page, einsatzId);
      await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
      const messungen = [];
      for (const breite of [390, 767, 768, 1024, 1199, 1200, 1280, 1366, 1600]) {
        await page.setViewportSize({ width: breite, height: 900 });
        await page.goto(`/einsaetze/${einsatzId}/etb`);
        await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
        const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
        await expect(sicht.getByText(MELDUNG, { exact: true })).toHaveCount(1);
        await expect(sicht.locator('.ant-table')).toHaveCount(0);
        await expect(sicht.locator('table')).toHaveCount(0);
        await expect(sicht.getByTestId('etb-ereigniszeile')).toHaveCount(1);
        const mass = await sicht.evaluate((element) => {
          const text = element.querySelector<HTMLElement>('.markdown')!;
          const container = [...element.querySelectorAll<HTMLElement>('*')].filter((knoten) =>
            ['auto', 'scroll'].includes(getComputedStyle(knoten).overflowX),
          );
          return {
            sicht: element.getBoundingClientRect().width,
            text: text.getBoundingClientRect().width,
            bodyUeberlauf: document.body.scrollWidth - window.innerWidth,
            innererUeberlauf: Math.max(
              0,
              ...container.map((knoten) => knoten.scrollWidth - knoten.clientWidth),
            ),
          };
        });
        const wo = `${breite}/${dichte}`;
        expect(mass.bodyUeberlauf, `Seitenrumpf bei ${wo}`).toBeLessThanOrEqual(SUBPIXEL);
        expect(mass.innererUeberlauf, `Innerer Überlauf bei ${wo}`).toBeLessThanOrEqual(SUBPIXEL);
        expect(mass.text, `Textbreite bei ${wo}`).toBeGreaterThan(0);
        expect(mass.text / mass.sicht, `Textanteil bei ${wo}`).toBeGreaterThanOrEqual(
          breite >= 1200 ? MINDESTANTEIL : 0.3,
        );
        messungen.push({ breite, dichte, ...mass });
      }
      await testInfo.attach('zeitachse-messung.json', {
        body: JSON.stringify(messungen, null, 2),
        contentType: 'application/json',
      });
    });
  }
});

/**
 * Der lange Meldungstext bricht um: mehrzeilig, in der Sicht, und nichts scrollt seitlich —
 * weder der Rumpf noch ein Container darin (LFH-523). Die positive Hälfte (Text messbar und
 * mehrzeilig) bleibt, sonst wäre „kein Überlauf" auch bei einer leeren Seite wahr.
 */
test.describe('LFH-523: langer Meldungstext in der Zeitachse', () => {
  test.use({ hasTouch: true });

  /** 209 Zeichen, ausschließlich normale Wortgrenzen — kein unteilbares Wort, keine URL. */
  const LANG =
    'Im Kellergeschoss des Anwesens Musterweg 3 steht das Wasser rund achtzig Zentimeter ' +
    'hoch. Die Heizungsanlage ist betroffen, der Hausanschlusskasten ist noch trocken. ' +
    'Eigentuemer vor Ort, Zugang ueber die Hofseite.';

  for (const dichte of ['kompakt', 'komfortabel', 'handschuh']) {
    test(`bricht um statt zu ueberlaufen (${dichte})`, async ({ page }, testInfo) => {
      await page.setViewportSize(FUEKW);
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E ETB Langtext ${dichte} ${Date.now()}`);
      await seedeEintrag(page, einsatzId);
      await seedeEintrag(page, einsatzId, LANG);
      await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);

      const messungen = [];
      for (const breite of [390, 1024, 1200, 1366]) {
        await page.setViewportSize({ width: breite, height: 900 });
        await page.goto(`/einsaetze/${einsatzId}/etb`);
        await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
        const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
        await expect(sicht.getByText(LANG, { exact: true })).toHaveCount(1);

        const mass = await sicht.evaluate((element, langtext) => {
          const bloecke = [...element.querySelectorAll<HTMLElement>('.markdown')];
          const lang = bloecke.find((knoten) => knoten.textContent?.trim() === langtext)!;
          const kurz = bloecke.find((knoten) => knoten.textContent?.trim() !== langtext)!;
          const container = [...element.querySelectorAll<HTMLElement>('*')].filter((knoten) =>
            ['auto', 'scroll'].includes(getComputedStyle(knoten).overflowX),
          );
          const zeilenhoehe = parseFloat(getComputedStyle(lang).lineHeight) || 0;
          return {
            sicht: element.getBoundingClientRect().width,
            langBreite: lang.getBoundingClientRect().width,
            langHoehe: lang.getBoundingClientRect().height,
            kurzBreite: kurz.getBoundingClientRect().width,
            zeilenhoehe,
            bodyUeberlauf: document.body.scrollWidth - window.innerWidth,
            innererUeberlauf: Math.max(0, ...container.map((k) => k.scrollWidth - k.clientWidth)),
          };
        }, LANG);

        const wo = `${breite}/${dichte}`;
        expect(mass.sicht, `Sichtflaeche bei ${wo}`).toBeGreaterThan(0);
        expect(mass.langBreite, `Textbreite bei ${wo}`).toBeGreaterThan(0);
        expect(mass.bodyUeberlauf, `Seitenrumpf bei ${wo}`).toBeLessThanOrEqual(SUBPIXEL);
        expect(mass.innererUeberlauf, `Innerer Ueberlauf bei ${wo}`).toBeLessThanOrEqual(SUBPIXEL);
        expect(mass.langBreite, `Textbreite gegen Sicht bei ${wo}`).toBeLessThanOrEqual(
          mass.sicht + SUBPIXEL,
        );
        expect(mass.zeilenhoehe, `Zeilenhoehe bei ${wo}`).toBeGreaterThan(0);
        expect(
          mass.langHoehe,
          `Texthoehe bei ${wo} (einzeilig waere <= ${mass.zeilenhoehe})`,
        ).toBeGreaterThan(mass.zeilenhoehe * 1.5);
        expect(mass.kurzBreite, `Kurztextbreite bei ${wo}`).toBeGreaterThan(0);

        messungen.push({ breite, dichte, ...mass });
      }
      await testInfo.attach('langtext-messung.json', {
        body: JSON.stringify(messungen, null, 2),
        contentType: 'application/json',
      });
    });
  }
});

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

async function seedeEintrag(page: Page, einsatzId: string, inhalt: string = MELDUNG) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
    data: { typ: 'meldung', inhalt, von: 'ELW 1', an: 'Leitstelle' },
  });
  expect(
    antwort.ok(),
    `Seeding ETB-Eintrag: ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
}

test('bei 390 px scrollt der Seitenrumpf nicht seitlich, und die Chronologie steht als Zeitachse', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E ETB Breite ${Date.now()}`);
  await seedeEintrag(page, einsatzId);

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  const bereich = page.getByRole('region', { name: 'Einsatztagebuch' });
  await expect(bereich).toHaveCount(1);
  // Der gesäte Eintrag ist der Anker — sonst wäre die Aussage auch bei einer leeren Seite wahr.
  await expect(bereich.getByText(MELDUNG)).toHaveCount(1);

  const mass = await page.evaluate(() => ({
    scroll: document.body.scrollWidth,
    innen: window.innerWidth,
  }));
  expect(
    mass.scroll,
    `Body scrollt seitlich: ${mass.scroll}px gegen ${mass.innen}px Fensterbreite`,
  ).toBeLessThanOrEqual(mass.innen + SUBPIXEL);

  await expect(bereich.locator('[data-testid="etb-ereigniszeile"]')).toHaveCount(1);
  await expect(bereich.locator('table')).toHaveCount(0);

  // Die Schnellerfassung am Fuß bleibt erreichbar: sichtbar im Fenster, ohne Blättern.
  await expect(page.getByPlaceholder('Inhalt …')).toBeInViewport();
});

test('bei 1366 px bekommt der Meldungstext mindestens die halbe Zeitachsenbreite', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E ETB Textbreite ${Date.now()}`);
  await seedeEintrag(page, einsatzId);

  await page.setViewportSize(FUEKW);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  const bereich = page.getByRole('region', { name: 'Einsatztagebuch' });
  await expect(bereich).toHaveCount(1);
  await expect(bereich.getByText(MELDUNG)).toHaveCount(1);

  // Die Bilanz steht ab `xl` rechts daneben — gemessen wird gegen die Zeitachse selbst.
  await expect(page.getByRole('complementary', { name: 'Bilanz des Tagebuchs' })).toBeVisible();
  const text = await bereich.locator('.markdown').first().boundingBox();
  const flaeche = await bereich.boundingBox();
  expect(text, 'Meldungstext nicht messbar').not.toBeNull();
  expect(flaeche, 'Sichtfläche nicht messbar').not.toBeNull();

  // Der Textblock ist so breit wie seine Spalte, das misst also die Spalte, die der Text
  // bekommt — nicht die Länge des kurzen Textes.
  const anteil = text!.width / flaeche!.width;
  expect(
    anteil,
    `Meldungstext bekommt ${Math.round(anteil * 100)} % der Zeitachse ` +
      `(${Math.round(text!.width)}px von ${Math.round(flaeche!.width)}px), Soll ≥ 50 %`,
  ).toBeGreaterThanOrEqual(MINDESTANTEIL);
});
