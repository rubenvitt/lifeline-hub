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
 * DER GESÄTE TEXT DIESER BEIDEN BLÖCKE IST DETERMINISTISCH UND KURZ, und das ist kein
 * Zufall: ein kurzer Text ist für die ≥50-%-Zusicherung der SCHWERE Fall, weil der
 * Überschuss dann allein aus der Verteilung der ungebundenen Spalte kommt — ein langer
 * machte sie trivial. Der lange Text ist die Aufgabe des dritten Blocks (LFH-523), und
 * dort wird die Zusicherung zusätzlich UNTER Langtextlast nachgemessen.
 *
 * FORTGESCHRIEBEN DURCH LFH-523: die Tabelle der Chronologie ist seit dem nicht mehr
 * inhaltsgetrieben. Die Inhaltsspalte trägt `mindestBreite`, `KatalogTabelle` rechnet
 * daraus eine feste `scroll.x`-Zahl (`Σ(width) + mindestBreite`), und antds `min-width:
 * 100%` bleibt daneben stehen. Für den KURZEN Text ändert das nichts — liegt die Zahl
 * unter der Containerbreite, ist die benutzte Breite dieselbe wie zuvor und die
 * Layoutrechnung verteilt identisch; die Fassungen gehen erst auseinander, wenn
 * `max-content` den Container übersteigt. Die Messungen dieser beiden Blöcke sind deshalb
 * unverändert gültig.
 *
 * GEMESSEN WIRD GEGEN DIE SICHT, nicht gegen die Tabelle. Der Grund von LFH-342 — bei sehr
 * langem Inhalt wuchs die Tabelle über den Container und ein Verhältnis Spalte-zu-Tabelle
 * wurde kleiner, obwohl der Text MEHR Platz hatte — ist mit LFH-523 entfallen; die
 * Bezugsgröße bleibt trotzdem die Contentbreite, denn sie ist die Größe, in der der Befund
 * formuliert ist, und sie bleibt richtig, wenn die Tabelle wieder wachsen dürfte.
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

test.describe('LFH-464: ETB-Umbruch bei xl', () => {
  test.use({ hasTouch: true });
  for (const dichte of ['kompakt', 'komfortabel', 'handschuh']) {
    test(`misst beide Seiten der Schwelle und die Tabletbreiten (${dichte})`, async ({
      page,
    }, testInfo) => {
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
        expect(mass.bodyUeberlauf, `Seitenrumpf bei ${breite}/${dichte}`).toBeLessThanOrEqual(
          SUBPIXEL,
        );
        if (breite < 1200) {
          expect(mass.innererUeberlauf).toBeLessThanOrEqual(SUBPIXEL);
          expect(mass.text / mass.sicht).toBeGreaterThan(0.85);
        }
        messungen.push({ breite, dichte, ...mass });
      }
      await testInfo.attach('layoutmessung.json', {
        body: JSON.stringify(messungen, null, 2),
        contentType: 'application/json',
      });
    });
  }
});

/**
 * Der lange Meldungstext bricht im Tabellenzweig um (LFH-523).
 *
 * DER BEFUND, gemessen auf `origin/main` 17aed41c: ein NORMAL UMBRECHBARER Text mit 209
 * Zeichen bleibt in der Tabelle einzeilig und verbreitert sie. Handschuhmodus, 1280 px
 * Viewport: 936 px Sicht, rund 1484 px Text, 1122 px innerer waagerechter Überlauf; bei
 * 1366 px noch 1036 px. Der Rumpf selbst scrollt dabei NICHT — der Überlauf steckt im
 * Scrollcontainer der Tabelle, und genau deshalb misst dieser Block beides getrennt.
 *
 * WARUM DER BODY-TEST DAS NICHT GEFANGEN HAT: `KatalogTabelle` scrollt in sich (das ist
 * Festlegung 1 des Primitivs und richtig). Ein Test, der nur `document.body.scrollWidth`
 * prüft, ist gegen diesen Befund blind — er war auf `origin/main` grün, während der Text
 * 1122 px weit aus der Sicht ragte.
 *
 * DIE ZWEITE HÄLFTE IST DIE POSITIVE: „kein Überlauf" allein wäre auch bei einer leeren,
 * kaputten oder weggeleiteten Seite wahr. Gemessen wird deshalb ZUSÄTZLICH, dass der Text
 * wirklich steht (Sichtfläche positiv, Textbreite positiv) und dass er MEHRZEILIG ist —
 * seine Höhe übersteigt die einer Zeile. Ohne diese Aussage bliebe der Test grün, wenn der
 * Text auf null Breite zusammenfiele.
 *
 * KURZ UND LANG IM PAAR: der kurze Text ist die Gegenprobe. Er darf durch die Deckelung
 * NICHT schmaler werden — an ihm hängt die C7-Zusicherung, und ein Deckel, der auch den
 * kurzen Fall zusammenzieht, hätte den Befund gegen die Zusicherung eingetauscht.
 */
test.describe('LFH-523: langer Meldungstext im Tabellenzweig', () => {
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
      // Kurz UND lang in derselben Chronologie: die Tabellenbreite entsteht aus ALLEN
      // Zeilen, ein langer Text neben kurzen ist der Befundfall.
      await seedeEintrag(page, einsatzId);
      await seedeEintrag(page, einsatzId, LANG);
      await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);

      const messungen = [];
      // Nur Breiten ab `xl`: darunter steht die Chronologie als Karten, und die hatten den
      // Befund nie. 1200 px ist die schmalste Flaeche, auf der die Tabelle ueberhaupt steht.
      for (const breite of [1200, 1280, 1366]) {
        await page.setViewportSize({ width: breite, height: 900 });
        await page.goto(`/einsaetze/${einsatzId}/etb`);
        await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
        const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
        await expect(sicht.locator('.ant-table')).toHaveCount(1);
        await expect(sicht.getByText(LANG, { exact: true })).toHaveCount(1);

        const mass = await sicht.evaluate((element, langtext) => {
          const bloecke = [...element.querySelectorAll<HTMLElement>('.markdown')];
          const lang = bloecke.find((knoten) => knoten.textContent?.trim() === langtext)!;
          const kurz = bloecke.find((knoten) => knoten.textContent?.trim() !== langtext)!;
          // JEDER Scrollcontainer der Sicht, nicht nur `.ant-table-body`: antd zieht Kopf
          // und Koerper in zwei Elemente auseinander, und der Ueberlauf kann in beiden
          // stecken. Ein auf eine Klasse verengter Griff ginge bei einem antd-Bump still
          // ins Leere und der Test waere danach eine Attrappe.
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
            container: container.length,
            bodyUeberlauf: document.body.scrollWidth - window.innerWidth,
            innererUeberlauf: Math.max(0, ...container.map((k) => k.scrollWidth - k.clientWidth)),
          };
        }, LANG);

        const wo = `${breite}/${dichte}`;
        // (a) Die Sicht steht ueberhaupt — sonst belegen die Null-Aussagen unten nichts.
        expect(mass.sicht, `Sichtflaeche bei ${wo}`).toBeGreaterThan(0);
        expect(mass.langBreite, `Textbreite bei ${wo}`).toBeGreaterThan(0);
        // Und es GIBT einen Scrollcontainer — sonst waere „kein innerer Ueberlauf" die
        // triviale Aussage ueber eine Menge ohne Element.
        expect(mass.container, `Scrollcontainer bei ${wo}`).toBeGreaterThan(0);

        // (b) Der Rumpf wandert nicht — die Bestandsaussage, die den Befund NICHT fing.
        expect(mass.bodyUeberlauf, `Seitenrumpf bei ${wo}`).toBeLessThanOrEqual(SUBPIXEL);
        // (c) Und der innere Ueberlauf, der ihn fing. Auf altem Stand gemessen: 974 px
        // (kompakt) / 1134 px (komfortabel) / 1178 px (handschuh) bei 1200 px, und
        // 1122 px bei 1280/handschuh im Ticket. DAS ist die Zeile, die den Befund traegt.
        expect(mass.innererUeberlauf, `Innerer Tabellenueberlauf bei ${wo}`).toBeLessThanOrEqual(
          SUBPIXEL,
        );

        // (d) Der Text steht INNERHALB der Sicht — die positive Form derselben Aussage.
        expect(mass.langBreite, `Textbreite gegen Sicht bei ${wo}`).toBeLessThanOrEqual(
          mass.sicht + SUBPIXEL,
        );

        // (e) Er ist MEHRZEILIG. Das ist die eigentliche Aussage des Tickets: lesbar ohne
        // waagerechtes Abfahren EINER langen Zeile. Ohne sie waere ein auf null Breite
        // zusammengefallener Text ebenfalls „ohne Ueberlauf".
        expect(mass.zeilenhoehe, `Zeilenhoehe bei ${wo}`).toBeGreaterThan(0);
        expect(
          mass.langHoehe,
          `Texthoehe bei ${wo} (einzeilig waere <= ${mass.zeilenhoehe})`,
        ).toBeGreaterThan(mass.zeilenhoehe * 1.5);

        // (f) Gegenprobe: der KURZE Text ist vom Deckel unberuehrt. Er teilt sich die Spalte
        // mit dem langen, bekommt also dieselbe Breite — zusammengezogen haette der Deckel
        // den Befund gegen die C7-Zusicherung eingetauscht.
        expect(mass.kurzBreite, `Kurztextbreite bei ${wo}`).toBeGreaterThan(0);

        messungen.push({ breite, dichte, ...mass });
      }
      await testInfo.attach('langtext-messung.json', {
        body: JSON.stringify(messungen, null, 2),
        contentType: 'application/json',
      });
    });
  }

  /**
   * Die C7-Zusicherung UNTER Langtextlast (AK#4). Der Bestandstest unten saet nur den
   * kurzen Text; dass der Deckel die Spalte auch dann nicht unter die Haelfte drueckt,
   * wenn ein langer Text in derselben Tabelle steht, ist die Aussage, die LFH-523
   * zusaetzlich schuldet. Die fixierte Kennung wird im selben Zug mitgeprueft.
   *
   * DIESER FALL IST EIN WAECHTER, KEIN BEFUNDFAENGER — gemessen: mit zurueckgedrehtem
   * Produktionscode bleibt er GRUEN, weil der ungedeckelte Text die Spalte aufblaeht und
   * die ≥50 % damit trivial erfuellt (derselbe Grund, aus dem der Bestandstest kurz saet).
   * Rot wird auf altem Stand allein der Ueberlauf-Fall darueber, und zwar in allen drei
   * Dichten: 974 / 1134 / 1178 px innerer Ueberlauf bei 1200 px. Wer diesen Waechter fuer
   * den Beleg des Tickets haelt, verwechselt die beiden.
   */
  test('haelt bei 1366 px die halbe Contentbreite und die fixierte Kennung', async ({ page }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E ETB Langtext C7 ${Date.now()}`);
    await seedeEintrag(page, einsatzId);
    await seedeEintrag(page, einsatzId, LANG);
    await page.setViewportSize(FUEKW);
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    const bereich = page.getByRole('region', { name: 'Einsatztagebuch' });
    await expect(bereich.getByText(LANG, { exact: true })).toHaveCount(1);

    // Der Spaltenschalter sagt weiterhin, dass die zwei Nebenspalten AUSGEBLENDET sind —
    // ohne diese Zeile waere „Spalte weg" von „Spalte kaputt" nicht zu unterscheiden.
    await expect(page.getByRole('button', { name: /2 ausgeblendet/ })).toHaveCount(1);

    const spalte = await bereich.getByRole('columnheader', { name: 'Inhalt' }).boundingBox();
    const flaeche = await bereich.boundingBox();
    expect(spalte, 'Inhaltsspalte nicht messbar').not.toBeNull();
    expect(flaeche, 'Sichtflaeche nicht messbar').not.toBeNull();
    const anteil = spalte!.width / flaeche!.width;
    expect(
      anteil,
      `Meldungstext bekommt ${Math.round(anteil * 100)} % der Contentbreite ` +
        `(${Math.round(spalte!.width)}px von ${Math.round(flaeche!.width)}px), Soll >= 50 %`,
    ).toBeGreaterThanOrEqual(MINDESTANTEIL);

    // Die fixierte Kennung bleibt die erste Spalte und bleibt fixiert (Gate 2).
    const fixiert = bereich.locator('th.ant-table-cell-fix-start');
    await expect(fixiert).toHaveCount(1);
    await expect(fixiert).toHaveText('Nr.');
  });
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

async function seedeEintrag(page: Page, einsatzId: string, inhalt: string = MELDUNG) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
    data: { typ: 'meldung', inhalt, von: 'ELW 1', an: 'Leitstelle' },
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
    `Meldungstext bekommt ${Math.round(anteil * 100)} % der Contentbreite ` +
      `(${Math.round(spalte!.width)}px von ${Math.round(flaeche!.width)}px), Soll ≥ 50 %`,
  ).toBeGreaterThanOrEqual(MINDESTANTEIL);
});
