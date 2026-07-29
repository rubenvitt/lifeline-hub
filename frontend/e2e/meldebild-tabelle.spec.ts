import { expect, test, type Page } from '@playwright/test';

/**
 * Die zwei Nachweise des Meldebilds, die NUR im Browser gehen (LFH-330 · B2, Bündel V).
 *
 * WARUM HIER UND NICHT IN VITEST: jsdom rechnet kein Layout (`vite.config.ts` fährt
 * `css: false`), und `@media print` wertet es gar nicht aus. Beide Aussagen unten sind
 * reine Layoutaussagen — in Vitest wären sie strukturell unfähig, rot zu werden.
 *
 * NACHWEIS 1 — fixierte erste Spalte × Aufklapp-Symbol im Baum. Keiner der 19
 * `KatalogTabelle`-Bestandskonsumenten ist ein Baum; die Kombination „Spalte 0 fixiert +
 * `expandable` im Meldebild" ist im Repo damit unbelegt. Solange dieser Nachweis nicht grün
 * ist, ist `form="tabelle"` am Meldebild (`pages/KraefteuebersichtPage.tsx:375`) eine
 * Behauptung: die Bedien-Leitlinie verbietet dort die Auflösung in Karten, also MUSS der
 * Baum in der fixierten Tabelle bedienbar sein — auch auf 390 px.
 *
 * NACHWEIS 2 — der Druckpfad durch den Bildlaufcontainer. `pages/kraefteuebersichtPrint.css`
 * schaltete bis B2 nur `visibility`; `KatalogTabelle` bringt seit B1 einen waagerechten
 * Bildlaufcontainer, eine stehende Kopfzeile (zwei getrennte Tabellen plus Halter) und
 * `position: sticky` an Spalte 0 mit. Bündel IV hat die Neutralisierer geschrieben und per
 * TEXT-Prüfung belegt, dass sie dastehen — nicht, dass sie wirken. Der Unterschied ist
 * genau der Punkt: eine Regel mit einem Tippfehler im Selektor steht auch da.
 *
 * WAS NACHWEIS 2 BEWEIST UND WAS NICHT: gemessen wird „der Inhalt liegt vollständig innerhalb
 * des Druck-Wurzelknotens bei der nutzbaren Breite von A4 hoch" (Herleitung an
 * {@link A4_DRUCKBREITE}). NICHT gemessen wird die Seitenhöhe, der Umbruch über mehrere
 * Blätter und die Wiederholung der Kopfzeile je Blatt — das sind Fragen von `@page` und
 * `break-inside`, und die stellt dieses Paket nicht.
 *
 * MUTATIONSPROBE ZU NACHWEIS 2, protokolliert weil eine Zusicherung ohne Gegenprobe eine
 * Behauptung ist (Beweisform aus `katalogtabelle-schmal.spec.ts:90-98`):
 *  - ganzer Neutralisierer-Block aus `kraefteuebersichtPrint.css` entfernt → rot bei (a),
 *    `overflow-x` bleibt `auto` statt `visible`.
 *  - NUR die eine Regel `.ant-table-body table { width: 100% }` entfernt, alles andere
 *    unverändert → rot bei (b) mit **340 px** Überhang im Druck. Die Nutzlast-Hälfte hängt
 *    also nachweislich an einer einzelnen Regel und ist nicht durch (a) mitgemeint.
 * Beide Male zurückgedreht und byte-gleich verglichen.
 *
 * WARUM NICHT `handleDrucken()`: der Knopf setzt `printPending` und ein Effekt ruft
 * `window.print()` (`KraefteuebersichtPage.tsx:200-212`). Ein modaler Druckdialog im
 * Headless-Chromium ist kein Nachweis, sondern ein Aufhänger. `emulateMedia` liefert das
 * Layout, und das Aufklappen erledigen die Symbole aus Nachweis 1 — derselbe Weg, den ein
 * Benutzer nimmt.
 *
 * WARUM `page.request`-Seeding: ein frischer Einsatz hat 0 Kräfte, und ein Meldebild ohne
 * Zeilen hat keinen Baum, keinen Bildlaufweg und keine letzte Spaltenzelle — jede Messung
 * unten wäre grün durch Nichtstun. Die Session ist Cookie-basiert (`api/client.ts:35/46/56`
 * `credentials: 'same-origin'`, kein CSRF-Header), und `page.request` teilt den Cookie-Jar
 * des Kontexts. 8 Kräfte per Anlege-Modal wären 40 Aktionen ohne Erkenntnisgewinn.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Handschirm aus A1, Gate 1. Bewusst per `setViewportSize` und kein Device-Descriptor:
 *  ein `devices['iPhone …']` zöge webkit nach, und ein Browser-Download ist im Repo
 *  nirgends abgesichert (gleichlautend in vier Bestands-Specs begründet). */
const HANDSCHIRM = { width: 390, height: 844 };

/** Subpixel-Spielraum für JEDEN Maßvergleich (`nav-schmal.spec.ts:26-39`: dreimal
 *  zugeschlagen, jedes Mal nur im vollen Sammel-Gate). */
const SUBPIXEL = 0.5;

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

/**
 * Ad-hoc-Kräfte ohne Einheit und ohne Abschnitt. Genau das erzeugt den DREISTUFIGEN
 * Sammelbaum „Ohne Abschnitt → Ohne Einheit → n Personenzeilen"
 * (`kraefte/kraeftebild.ts:576-620`, `hasOhne` über `ohneEinheitPersonal`) — also zwei
 * Aufklapp-Ebenen aus einem einzigen Endpunkt, ohne Einheiten- und Abschnittsanlage.
 *
 * ABSICHTLICH LANGE WERTE: die Bezeichnungsspalte trägt keine `width`, sie wächst mit dem
 * Inhalt. Kurze Namen ließen den waagerechten Bildlaufweg auf 390 px schrumpfen, und die
 * Halte-Messung der fixierten Spalte hätte nichts zu halten.
 */
async function seedeKraefte(page: Page, einsatzId: string, anzahl: number) {
  for (let i = 0; i < anzahl; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personal`, {
      data: {
        adhoc: {
          name: `Kirchgassner-Wohlfahrt, Maximiliane ${i}`,
          funktion: 'Abschnittsleitung Technische Hilfeleistung',
          traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
        },
      },
    });
    expect(
      antwort.ok(),
      `Seeding Kraft ${i}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  }
}

/**
 * Maße des Aufklapp-Symbols der ERSTEN Datenzeile, RELATIV zum Bildlaufcontainer.
 *
 * Relativ und nicht in Sichtfeld-Koordinaten, aus dem in `katalogtabelle-schmal.spec.ts:38-45`
 * protokollierten Grund: absolut gemessen wanderte der Container zwischen zwei Messungen um
 * 10,8 px, und die tadellose Fixierung fiel durch. Die Fixierung sagt „die Zelle bleibt am
 * linken Rand IHRES Containers stehen".
 *
 * Gemessen wird an der Körperzelle (`td`), nicht am Kopf: mit `sticky` zieht antd Kopf und
 * Körper in zwei getrennte Bildlaufbereiche und gleicht sie per Skript ab.
 */
async function symbolLage(page: Page) {
  return page.evaluate(() => {
    const koerper = document.querySelector('.ant-table-body')!;
    const zeile = document.querySelector('tr.ant-table-row')!;
    const fix = zeile.querySelector('td.ant-table-cell-fix-start')!;
    const symbol = fix.querySelector('.ant-table-row-expand-icon')!;
    const nicht = zeile.querySelector('td:not(.ant-table-cell-fix-start)')!;
    const bezug = koerper.getBoundingClientRect().x;
    const s = symbol.getBoundingClientRect();
    return {
      symbolX: s.x - bezug,
      symbolBreite: s.width,
      symbolHoehe: s.height,
      nichtFixX: nicht.getBoundingClientRect().x - bezug,
      restweg: koerper.scrollWidth - koerper.clientWidth,
    };
  });
}

test('Meldebild bei 390 px: das Aufklapp-Symbol lebt in der fixierten Spalte, klappt auf und hält seine x-Position', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 8);

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  await page.waitForLoadState('networkidle');

  const bereich = page.getByRole('region', { name: 'Meldebild' });
  await expect(bereich).toHaveCount(1);

  // (a) `form="tabelle"` wirkt: auf 390 px steht hier eine Tabelle, KEIN Kartenzweig.
  //     Das ist die Zusicherung, die Prüflisten-Kriterium 14 an dieser Seite verlangt —
  //     eine Vergleichsfläche wird angepasst, nicht in Karten aufgelöst.
  await expect(page.locator('.ant-table')).toHaveCount(1);
  await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);

  // (b) Genau eine fixierte Kopfzelle, und sie ist wirklich `sticky`.
  const fixierte = page.locator('th.ant-table-cell-fix-start');
  await expect(fixierte).toHaveCount(1);
  await expect(fixierte).toHaveCSS('position', 'sticky');

  // (c) Der Sammelknoten steht. Ohne diesen Anker misst der Rest einen Leerzustand.
  await expect(page.getByText('Ohne Abschnitt')).toHaveCount(1);
  const zeilen = page.locator('tr.ant-table-row');
  await expect(zeilen).toHaveCount(1);

  // (d) Das Symbol liegt IN der fixierten Zelle — nicht daneben, nicht in einer eigenen
  //     Spalte. Genau das ist die unbelegte Kombination: antd rendert den Auslöser in die
  //     erste Spalte, und die ist hier unbedingt fixiert.
  //
  //     JE ZEILE VERENGT, nicht seitenweit: gemessen rendert antd auch an BLATT-Zeilen
  //     einen Knoten mit derselben Klasse (`…-expand-icon-spaced`, ein Platzhalter, der die
  //     Einrückung hält). Ein seitenweiter Locator löste nach dem Aufklappen auf zehn
  //     Elemente auf und brach im strict mode — und ein `.first()`-Pflaster hätte ab da
  //     stillschweigend irgendeine Zeile gemessen.
  const symbolIn = (index: number) =>
    zeilen.nth(index).locator('td.ant-table-cell-fix-start .ant-table-row-expand-icon');
  const symbol = symbolIn(0);
  await expect(symbol).toHaveCount(1);

  const vor = await symbolLage(page);
  // Vorbedingung: ohne waagerechten Bildlaufweg hätte die Halte-Messung unten nichts zu
  // halten und wäre trivial grün (dieselbe Vorbedingung wie
  // `katalogtabelle-schmal.spec.ts:135`).
  expect(
    vor.restweg,
    `Vorbedingung: das Meldebild braucht waagerechten Bildlaufweg (gemessen ${vor.restweg}px)`,
  ).toBeGreaterThan(50);

  // (e) FUNKTIONSHÄLFTE. `toBeVisible` belegt nicht, dass ein Element klickbar ist —
  //     `click()` prüft das Trefferziel und schlägt fehl, wenn ein anderer Knoten den
  //     Punkt abfängt. Ein Symbol, das rendert, aber nicht feuert, ist der Fehlermodus,
  //     den eine Sichtbarkeitsprüfung durchwinkt.
  await symbol.click();
  await expect(zeilen, 'Aufklappen muss die Kindzeile „Ohne Einheit" bringen').toHaveCount(2);

  // (f) HALTE-HÄLFTE nach echtem waagerechtem Bildlauf. Beide Teile sind nötig: ohne „die
  //     nicht-fixierte Zelle ist gewandert" wäre ein stillschweigend nicht ausgeführter
  //     Bildlauf grün und die Halte-Zusicherung leer.
  await page.locator('.ant-table-body').evaluate((el) => el.scrollTo(200, 0));
  const nach = await symbolLage(page);
  expect(nach.nichtFixX, 'nicht-fixierte Zelle muss mitwandern').toBeLessThan(vor.nichtFixX - 100);
  expect(
    Math.abs(nach.symbolX - vor.symbolX),
    `Aufklapp-Symbol hält seine x-Position (${vor.symbolX} → ${nach.symbolX})`,
  ).toBeLessThanOrEqual(1);

  // (g) …und es ist DORT noch bedienbar. Zweite Ebene aufklappen, während die Tabelle
  //     waagerecht verschoben ist: jetzt kommen die 8 Personenzeilen.
  const symbolEbene2 = symbolIn(1);
  await expect(symbolEbene2).toHaveCount(1);
  await symbolEbene2.click();
  await expect(zeilen, 'zweite Ebene: „Ohne Einheit" trägt die 8 gesäten Kräfte').toHaveCount(10);

  // (g′) BEFUND, mitgemessen weil er genau hier auffällt: der Platzhalter an einer
  //      BLATT-Zeile trägt dieselbe Klasse und ein `aria-label` („Zeile erweitern"), obwohl
  //      es nichts zu erweitern gibt. Ob er ein Fokusziel ist, entscheidet seine
  //      Sichtbarkeit — `visibility: hidden` nimmt ihn aus der Tabulatorfolge. Der Wert
  //      wird protokolliert, nicht bewertet: er ist antd-Bestand, kein B2-Erzeugnis.
  const platzhalterSichtbarkeit = await symbolIn(2).evaluate(
    (el) => getComputedStyle(el).visibility,
  );

  // (h) …und wieder zu. Ein Auslöser, der nur in eine Richtung schaltet, ist halb kaputt.
  await symbol.click();
  await expect(zeilen, 'Zuklappen nimmt den ganzen Unterbaum mit').toHaveCount(1);

  // (i) TREFFFLÄCHE DES SYMBOLS — gemessen, nicht geschätzt, und ausdrücklich über die
  //     Dichtestufen. Es ist der EINZIGE Auslöser dieser Fläche: das Meldebild läuft mit
  //     `form="tabelle"` auch auf 390 px, der Baum lässt sich also nur hierüber öffnen.
  //     Gate 3 gilt damit unmittelbar.
  //
  //     Die Zahl wird PROTOKOLLIERT und nicht zugesichert: das Symbol ist antd-Bestand,
  //     `Datensicht` reicht `expandable` nur durch und setzt dort keine Höhe. Eine
  //     Zusicherung hier wäre ein rot geborenes Gate an fremdem Code; das Verdikt gehört in
  //     die Prüfliste und das Zielticket ist B5 (LFH-333), das die Dichte-Staffel führt.
  //
  //     Der zweite Wert ist der eigentliche Befund: folgt das Symbol der HANDSCHUH-Stufe?
  //     Wenn nicht, ist die Baumfläche mit Einsatzhandschuh nicht bedienbar, egal welche
  //     Stufe der Benutzer wählt.
  const symbolKompakt = `${vor.symbolBreite}×${vor.symbolHoehe}`;
  await page.evaluate(() => window.localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  await expect(page.getByText('Ohne Abschnitt')).toHaveCount(1);
  const handschuh = await symbolLage(page);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Aufklapp-Symbol kompakt ${symbolKompakt}px, handschuh ` +
      `${handschuh.symbolBreite}×${handschuh.symbolHoehe}px, Restweg ${vor.restweg}px (390px), ` +
      `Blatt-Platzhalter visibility=${platzhalterSichtbarkeit}`,
  });
});

/**
 * Computed-Style- und Geometriewerte des Meldebilds im aktuellen Medium.
 *
 * Alles über `evaluate` und `getBoundingClientRect`, NICHT über `toBeVisible`: unter
 * `@media print` setzt `kraefteuebersichtPrint.css` `body * { visibility: hidden }`, und
 * Playwrights Sichtbarkeitsprüfung scheiterte dann an jedem Knoten außerhalb der
 * Druckwurzel — ein Werkzeugfehler, der wie ein Befund aussieht.
 */
async function druckLage(page: Page) {
  return page.evaluate(() => {
    const wurzel = document.querySelector('.kraefte-print-root')!;
    const koerper = document.querySelector('.ant-table-body')!;
    const halter = document.querySelector('.ant-table-sticky-holder');
    const werkzeuge = document.querySelector('[data-lfh="datensicht-werkzeuge"]')!;
    const fixZelle = document.querySelector('tr.ant-table-row td.ant-table-cell-fix-start')!;
    // Die erste DATENZEILE, nicht das erste `tr`: antd schiebt bei `scroll.x` eine
    // `ant-table-measure-row` voran, und ein `tr.ant-table-row:first-of-type` traf deshalb
    // gar nichts — die Zellenliste war leer und die Messung lief in ein `undefined`.
    const zellen = Array.from(
      document.querySelector('tr.ant-table-row')!.querySelectorAll(':scope > td'),
    ) as HTMLElement[];
    const letzte = zellen[zellen.length - 1];
    const w = wurzel.getBoundingClientRect();
    return {
      wurzelRechts: w.right,
      wurzelBreite: w.width,
      letzteRechts: letzte.getBoundingClientRect().right,
      letzteSpalten: zellen.length,
      koerperUeberhang: koerper.scrollWidth - koerper.clientWidth,
      koerperOverflowX: getComputedStyle(koerper).overflowX,
      halterPosition: halter ? getComputedStyle(halter).position : 'kein Halter',
      fixPosition: getComputedStyle(fixZelle).position,
      werkzeugeDisplay: getComputedStyle(werkzeuge).display,
    };
  });
}

/**
 * A4-Hochformat, nutzbare Breite in CSS-Pixeln — die Breite, mit der Chromium den Ausdruck
 * WIRKLICH umbricht.
 *
 * `emulateMedia({ media: 'print' })` schaltet nur die Medienabfrage; die Layoutbreite bleibt
 * die des Sichtfelds. Beim echten Druck ist sie dagegen die des Seitenkastens. Ein
 * Druck-Layoutbeweis MUSS deshalb das Sichtfeld auf die Papierbreite stellen — sonst prüft er
 * eine Breite, die nie gedruckt wird.
 *
 * [abgeleitet], Eingaben genannt: A4-Breite 210 mm ÷ 25,4 mm/in × 96 px/in = 793,7 px,
 * minus Chromiums Standardrand von 1 cm je Seite (2 × 37,8 px = 75,6 px) → 718,1 px.
 * Aufgerundet abgeschnitten: 717 px, also die ENGERE Annahme.
 *
 * GEMESSEN, damit niemand die Zahl für Willkür hält: die Mindest-Inhaltsbreite der
 * Meldebild-Tabelle ist 645 px (Druckmedium bei 390 px Sichtfeld, wo `width: 100%` nichts
 * mehr zu verteilen hat). 645 < 717, der Ausdruck passt also mit Reserve. Bei 390 px
 * Sichtfeld ragt er um 255 px heraus — das ist KEIN Druckbefund, sondern die Folge davon,
 * dass 390 px keine Papierbreite ist. Wer diese Zahl „behebt", behebt nichts.
 */
const A4_DRUCKBREITE = 717;

test('Druckpfad der Kräfteübersicht: die Neutralisierer WIRKEN, und keine Spalte ragt aus dem Druck-Wurzelknoten', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild Druck ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 8);

  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 800 });
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Ohne Abschnitt')).toHaveCount(1);

  // Aufklappen wie `handleDrucken` es tut — über die Symbole, nicht über `window.print()`.
  const zeilen = page.locator('tr.ant-table-row');
  const symbolIn = (index: number) =>
    zeilen.nth(index).locator('td.ant-table-cell-fix-start .ant-table-row-expand-icon');
  await symbolIn(0).click();
  await expect(zeilen).toHaveCount(2);
  await symbolIn(1).click();
  await expect(zeilen).toHaveCount(10);

  // ── GEGENPROBE `screen`: die Enge ist echt, der Container schneidet wirklich ab.
  const bildschirm = await druckLage(page);
  expect(
    bildschirm.koerperUeberhang,
    `Vorbedingung: am Bildschirm muss der Bildlaufcontainer echten Überhang tragen (gemessen ${bildschirm.koerperUeberhang}px)`,
  ).toBeGreaterThan(50);
  expect(bildschirm.werkzeugeDisplay, 'Werkzeugzeile steht am Bildschirm').not.toBe('none');
  expect(bildschirm.halterPosition, 'Kopfhalter steht am Bildschirm auf sticky').toBe('sticky');
  expect(bildschirm.fixPosition, 'Kennungsspalte steht am Bildschirm auf sticky').toBe('sticky');

  // ── DRUCKMEDIUM
  await page.emulateMedia({ media: 'print' });
  const druck = await druckLage(page);

  // (a) DIE NEUTRALISIERER WIRKEN — nicht: „sie stehen da". Eine Regel mit einem
  //     Tippfehler im Selektor steht auch da, und genau das hat die Textprüfung von
  //     Bündel IV nicht ausgeschlossen. Vier Regeln, vier gemessene Umschläge.
  expect(druck.koerperOverflowX, 'Bildlaufcontainer im Druck auf visible').toBe('visible');
  expect(druck.halterPosition, 'Kopfhalter im Druck auf static').toBe('static');
  expect(druck.fixPosition, 'Kennungsspalte im Druck auf static').toBe('static');
  expect(druck.werkzeugeDisplay, 'Werkzeugzeile im Druck ausgeblendet').toBe('none');

  // (b) DIE NUTZLAST — der eigentliche Layoutbeweis. Zwei Hälften, beide nötig.
  //
  //     Erstens: der Bildlaufcontainer hält keinen Inhalt mehr zurück. Am Bildschirm liegen
  //     bei dieser Breite gemessene 205 px im Bildlauf — auf Papier gibt es keinen Bildlauf,
  //     verborgener Inhalt wäre schlicht weg. Diese Hälfte ist damit die diskriminierende:
  //     ohne den `overflow`-Neutralisierer steht hier ein Wert > 0.
  //
  //     Zweitens: die LETZTE Spaltenzelle der ersten Datenzeile liegt vollständig innerhalb
  //     der Druckwurzel. Ohne diese Hälfte wäre (a) nur die Beobachtung, dass vier
  //     CSS-Regeln greifen — nicht, dass der Ausdruck dadurch vollständig wird.
  expect(
    druck.koerperUeberhang,
    `im Druck darf nichts mehr im Bildlauf verborgen liegen (gemessen ${druck.koerperUeberhang}px Überhang bei ${druck.letzteSpalten} Spalten)`,
  ).toBeLessThanOrEqual(1);
  expect(
    druck.letzteRechts,
    `letzte Spaltenzelle ragt aus dem Druck-Wurzelknoten (Zelle rechts ${druck.letzteRechts}px, Wurzel rechts ${druck.wurzelRechts}px, Wurzel ${druck.wurzelBreite}px breit)`,
  ).toBeLessThanOrEqual(druck.wurzelRechts + SUBPIXEL);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Druck bei ${A4_DRUCKBREITE}px (A4 hoch, nutzbar): Wurzel ${Math.round(druck.wurzelBreite)}px, ` +
      `letzte Zelle rechts ${Math.round(druck.letzteRechts)}px, ${druck.letzteSpalten} Spalten, ` +
      `Überhang screen ${bildschirm.koerperUeberhang}px → print ${druck.koerperUeberhang}px`,
  });

  // Medium zurückstellen, damit ein Folgeschritt im selben Kontext nicht im Druckmodus
  // weiterläuft.
  await page.emulateMedia({ media: null });
});
