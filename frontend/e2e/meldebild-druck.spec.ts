import { expect, test, type Page } from '@playwright/test';
import { baumLage, pruefeHaengendenEinzug } from './baum-einzug-kern';
import { SUBPIXEL, anmelden, einsatzAnlegen, seedeKraefte } from './meldebild-kern';
import { pdfAuszug } from './pdf-kern';

/**
 * Druck des Meldebilds: die Nachweise, die NUR im Browser gehen (jsdom rechnet kein Layout und
 * wertet `@media print` nicht aus). Chromium, Firefox und WebKit prüfen sie unter Druckmedium
 * (`DRUCK_SPECS`, LFH-915); ein PDF erzeugt diese Spec nicht, sie braucht deshalb keinen
 * Chromium-Zweig. Den echten Seitenumbruch und die Kopfwiederholung auf dem Blatt zeigt nur der
 * Druck selbst (Prüfliste LFH-22, Handprüfung).
 *
 * NACHWEIS 2 — der Druckpfad durch den Bildlaufcontainer: die Neutralisierer in
 * `druck/druck.css` (seit LFH-548 dort, vorher `pages/kraefteuebersichtPrint.css`) WIRKEN,
 * nicht bloß „stehen da" (eine Regel mit Tippfehler im Selektor steht auch da). Gemessen wird, dass der Inhalt bei A4-Breite
 * vollständig in der Druckwurzel liegt; nicht die Seitenhöhe. Kein echter Druckdialog —
 * `emulateMedia` liefert das Layout; den Knopf prüft NACHWEIS 2b mit einem `window.print`-Stub.
 *
 * Mutationsprobe (LFH-915): `thead` in `druck/druck.css` auf `table-row-group` statt
 * `table-header-group` → NACHWEIS 2b ist in Chromium, Firefox und WebKit rot. Die Regel bloß zu
 * streichen ist keine Probe: `table-header-group` ist schon der Vorgabewert der Browser.
 *
 * Seeding per `page.request`: ein Meldebild ohne Zeilen hat keinen Baum und keinen
 * Bildlaufweg, jede Messung wäre grün durch Nichtstun.
 */

/**
 * Computed-Style- und Geometriewerte des Meldebilds im aktuellen Medium, per `evaluate` —
 * `toBeVisible` sagt über `overflow`/`position`/`display` nichts. Gelesen werden nur Knoten
 * innerhalb der Druckwurzel.
 */
async function druckLage(page: Page) {
  return page.evaluate(() => {
    const wurzel = document.querySelector('.kraefte-print-root')!;
    const koerper = document.querySelector('.ant-table-body')!;
    const halter = document.querySelector('.ant-table-sticky-holder');
    const werkzeuge = document.querySelector('[data-lfh="datensicht-werkzeuge"]')!;
    const fixZelle = document.querySelector('tr.ant-table-row td.ant-table-cell-fix-start')!;
    // Die erste DATENZEILE: antd schiebt bei `scroll.x` eine `ant-table-measure-row` voran.
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
 * A4-Hochformat, nutzbare Breite in CSS-Pixeln. `emulateMedia` schaltet nur die
 * Medienabfrage, die Layoutbreite bleibt die des Sichtfelds — ein Druck-Layoutbeweis muss das
 * Sichtfeld auf die Papierbreite stellen.
 *
 * [abgeleitet]: 210 mm ÷ 25,4 × 96 = 793,7 px minus 2 × 15 mm `@page`-Rand (113,4 px)
 * = 680,3 px, abgerundet — dieselbe Zahl wie `NUTZ_BREITE` in `druck-fluss.spec.ts`. Bei
 * 390 px Sichtfeld ragt die Tabelle heraus; das ist kein Druckbefund.
 */
const A4_DRUCKBREITE = 680;

test('Druckpfad des Meldebilds: die Neutralisierer WIRKEN, und keine Spalte ragt aus dem Druck-Wurzelknoten', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild Druck ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 8);

  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 800 });
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  await expect(page.getByText('Ohne Einheit', { exact: true })).toHaveCount(1);

  // Aufklappen über das Symbol: erst die Mittelzeilen erzeugen mit ihren langen Namen den Überhang.
  const zeilen = page.locator('tr.ant-table-row');
  const symbolIn = (index: number) =>
    zeilen.nth(index).locator('td.ant-table-cell-fix-start .ant-table-row-expand-icon');
  await expect(zeilen).toHaveCount(1);
  await symbolIn(0).click();
  await expect(zeilen).toHaveCount(9);

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

  // (a) DIE NEUTRALISIERER WIRKEN — vier Regeln, vier gemessene Umschläge.
  expect(druck.koerperOverflowX, 'Bildlaufcontainer im Druck auf visible').toBe('visible');
  expect(druck.halterPosition, 'Kopfhalter im Druck auf static').toBe('static');
  expect(druck.fixPosition, 'Kennungsspalte im Druck auf static').toBe('static');
  expect(druck.werkzeugeDisplay, 'Werkzeugzeile im Druck ausgeblendet').toBe('none');

  // (b) DIE NUTZLAST, zwei Hälften: der Bildlaufcontainer hält keinen Inhalt mehr zurück
  //     (die diskriminierende Hälfte — auf Papier wäre verborgener Inhalt weg), und die
  //     LETZTE Spaltenzelle liegt vollständig in der Druckwurzel.
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

  // (c) Hängender Einzug im Druck (LFH-977): die Kräfte stehen rechts von „Ohne Einheit“, und
  //     kein Text ragt aus seiner Zelle. Die Einheitenspalte hat keine Breite; eine Hülle neben
  //     antds Floats behielt hier ~12 px, weil Floats nicht zur Mindestbreite der Zelle zählen.
  const einzug = await baumLage(page, '.kraefte-print-root');
  expect(einzug.filter((z) => z.ebene === 1)).toHaveLength(8);
  pruefeHaengendenEinzug(einzug, `Meldebild-Druck ${A4_DRUCKBREITE} px`, 'inhalt');

  // Medium zurückstellen, damit ein Folgeschritt nicht im Druckmodus weiterläuft.
  await page.emulateMedia({ media: null });
});

/**
 * NACHWEIS 2b — im Druck steht der Tabellenkopf in DERSELBEN Tabelle wie der Körper. Mit
 * `sticky` legt rc-table den Kopf in einen eigenen Halter, und die Kopfwiederholung je Blatt
 * griffe nicht; das Primitiv schaltet `sticky` bei `beforeprint` ab (`useDruckModus`).
 *
 * Weder `emulateMedia` noch `page.pdf()` feuern `beforeprint`; geprüft werden beide
 * Betriebswege: der KNOPF (Stub für `window.print`, der wie der Browser synchron
 * `beforeprint` feuert — belegt zugleich, dass `useDrucken` außerhalb des React-Effekts
 * druckt) und Strg+P (`dispatchEvent`). Nach `afterprint` steht der Kopf wieder im Halter.
 * Die Wiederholung auf dem PDF-Blatt selbst ist nicht belegt (PDF-Text komprimiert).
 */
async function kopfLage(page: Page) {
  return page.evaluate(() => {
    const wurzel = document.querySelector('[data-lfh="druckwurzel"]')!;
    const mitZeilen = Array.from(wurzel.querySelectorAll('table')).filter(
      (t) => t.querySelector('tbody tr.ant-table-row') !== null,
    );
    const kopf = mitZeilen[0]?.querySelector('thead');
    const seitenkopf = wurzel.querySelector('[data-lfh="seitenkopf"]');
    const druckkopf = wurzel.querySelector('[data-lfh="druckkopf"]');
    return {
      tabellenMitZeilen: mitZeilen.length,
      koerperHatKopf: kopf != null,
      kopfDisplay: kopf ? getComputedStyle(kopf).display : 'kein thead',
      halter: wurzel.querySelector('.ant-table-sticky-holder') != null,
      seitenkopf: seitenkopf ? getComputedStyle(seitenkopf).display : 'fehlt',
      druckkopf: druckkopf ? getComputedStyle(druckkopf).display : 'fehlt',
      zeilen: wurzel.querySelectorAll('tr.ant-table-row').length,
    };
  });
}

test('Druck des Meldebilds: Kopf und Körper in EINER Tabelle, kein Seitenkopf — über den Knopf und über Strg+P', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild Kopf ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 8);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 800 });
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  await expect(page.locator('tr.ant-table-row')).toHaveCount(1);

  // Vorbedingung am Bildschirm: Kopf im Halter, Körper ohne `thead`.
  const schirm = await kopfLage(page);
  expect(schirm.halter, 'Vorbedingung: stehende Kopfzeile am Bildschirm').toBe(true);
  expect(schirm.koerperHatKopf, 'Vorbedingung: Körpertabelle ohne eigenen Kopf').toBe(false);

  // ── KNOPF: der Stub hält den DOM-Stand IM Moment von `beforeprint` fest — später gemessen,
  // wäre ein liegengebliebenes Update bis dahin nachgerendert.
  await page.evaluate(() => {
    const w = window as unknown as { gedruckt: number; halterBeimDruck: boolean[] };
    w.gedruckt = 0;
    w.halterBeimDruck = [];
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
      w.halterBeimDruck.push(
        document.querySelector('[data-lfh="druckwurzel"] .ant-table-sticky-holder') != null,
      );
      w.gedruckt += 1;
    };
  });
  await page.getByRole('button', { name: 'Drucken / als PDF' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { gedruckt: number }).gedruckt))
    .toBe(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { halterBeimDruck: boolean[] }).halterBeimDruck,
    ),
    'Knopf: im Moment des Druckbilds steht kein Sticky-Halter mehr',
  ).toEqual([false]);
  await page.emulateMedia({ media: 'print' });
  const knopf = await kopfLage(page);
  expect(knopf.halter, 'Knopf: kein Sticky-Halter im Druck').toBe(false);
  expect(knopf.tabellenMitZeilen, 'Knopf: genau eine Tabelle mit Datenzeilen').toBe(1);
  expect(knopf.koerperHatKopf, 'Knopf: Körpertabelle trägt ihren Kopf').toBe(true);
  expect(knopf.kopfDisplay, 'Knopf: Kopf wiederholt sich je Blatt').toBe('table-header-group');
  expect(knopf.zeilen, 'Knopf: „vorbereiten" hat die Mittel aufgeklappt').toBe(9);
  expect(knopf.seitenkopf, 'Seitenkopf im Druck ausgeblendet').toBe('none');
  expect(knopf.druckkopf, 'Druckkopf steht auf Papier').not.toBe('none');

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: null });
  await expect.poll(async () => (await kopfLage(page)).halter).toBe(true);

  // ── Strg+P: der Browser feuert `beforeprint` selbst.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  const strgP = await kopfLage(page);
  expect(strgP.halter, 'Strg+P: kein Sticky-Halter im Druck').toBe(false);
  expect(strgP.koerperHatKopf, 'Strg+P: Körpertabelle trägt ihren Kopf').toBe(true);
  expect(strgP.kopfDisplay).toBe('table-header-group');
  expect(strgP.seitenkopf).toBe('none');

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: null });
  const danach = await kopfLage(page);
  expect(danach.halter, 'nach afterprint steht die Kopfzeile wieder (LFH-330)').toBe(true);
  expect(danach.koerperHatKopf).toBe(false);
});

/**
 * NACHWEIS 3 — Lesbarkeit auf A4 (LFH-1007). Die Mechanik oben war grün, während die erste
 * Spalte auf dem Blatt nur wenige Zeichen breit war: Namen brachen silbenweise, „Ohne Einheit“
 * und Spaltenköpfe standen buchstabenweise senkrecht, 40 Kräfte füllten 21 Seiten (auf dem Stand
 * vor dem Fix 41). Gemessen wird deshalb am Text, nicht an der Mechanik:
 *   (a) die erste Spalte hält eine Mindestbreite,
 *   (b) kein Kraftname läuft über mehr als zwei Zeilen, kein Einzelwort (Kürzel „Pers.“) bricht,
 *       keine Zeile ist höher als {@link MAX_ZEILEN_JE_REIHE} Textzeilen,
 *   (c) kein Wort eines Spaltenkopfs bricht (ein Kopf hat höchstens so viele Zeilen wie Wörter),
 *   (d) nur Chromium: das PDF hat höchstens {@link MAX_SEITEN} Seiten, jede mit Tabellenkopf, und
 *       keine Kraft fehlt.
 *
 * Gedruckt wird über den Knopf (Stub für `window.print`, wie NACHWEIS 2b): `vorbereiten` klappt
 * alle Mittel auf, `beforeprint` nimmt die stehende Kopfzeile weg — derselbe Stand wie beim
 * echten Druck.
 *
 * Eine Einheit mit langem Auftrag wirbt um Breite; ohne sie verteilte die Tabelle die Breite schon
 * nach Inhalt passabel, und der Anteil der ersten Spalte bliebe unbelegt.
 *
 * Mutationsproben in `pages/kraefteuebersichtPrint.css`, Abschnitt „Spaltenbreiten auf A4“, je in
 * Chromium, Firefox und WebKit rot: den ganzen Abschnitt streichen (erste Spalte 85 px, im PDF
 * 41 Seiten); nur `overflow-wrap: normal` am Kopf streichen ((c): sechs Köpfe brechen im Wort);
 * den Anteil der ersten Spalte auf `auto` (208 bzw. in WebKit 227 px). In
 * `pages/KraefteuebersichtPage.tsx` `flexShrink: 0` am Mittelkürzel streichen → (b) rot in Chromium
 * und Firefox („Pers“ über „.“).
 *
 * Zweiter Fall mit eingeblendeten Zusatzspalten (LFH-1109): so druckte Safari, und mit zehn Spalten
 * blieben der ersten 112 px. Mutationsprobe: in `KraefteuebersichtPage.tsx` den Filter über
 * `NUR_AM_SCHIRM` streichen → (a) rot in Chromium, Firefox und WebKit (123 px).
 */
const KRAEFTE_LESBAR = 40;
/** Mindestbreite der ersten Spalte auf A4 hoch, in CSS-Pixeln (gut ein Drittel der Nutzbreite). */
const MIN_ERSTE_SPALTE = 260;
/** Name (≤ 2) und Zusatz (Funktion, kleine Schrift) einer Kraft, mit Luft. */
const MAX_ZEILEN_JE_REIHE = 5;
/** Richtwert aus LFH-1007 für 40 Kräfte. */
const MAX_SEITEN = 4;
const EINHEIT_LESBAR = 'Einsatzeinheit Musterstadt-Nordwest 2';

async function lesbarkeit(page: Page) {
  return page.evaluate(() => {
    const wurzel = document.querySelector('.kraefte-print-root')!;
    /** Anzahl verschiedener Zeilenoberkanten eines Textknotens. */
    const zeilenVon = (knoten: Node) => {
      const r = document.createRange();
      r.selectNodeContents(knoten);
      return new Set(
        Array.from(r.getClientRects())
          .filter((k) => k.width > 0)
          .map((k) => Math.round(k.top)),
      ).size;
    };
    const textKnoten = (el: Element) => {
      const gang = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const liste: Node[] = [];
      for (let k = gang.nextNode(); k; k = gang.nextNode())
        if (k.textContent?.trim()) liste.push(k);
      return liste;
    };
    const ersteKopfzelle = wurzel.querySelector('thead th')!;
    const zeilenhoehe = parseFloat(getComputedStyle(wurzel.querySelector('tbody td')!).lineHeight);
    const reihen = Array.from(wurzel.querySelectorAll('tr.ant-table-row')).map((tr) => {
      const erste = tr.querySelector('td')!;
      const namensKnoten = textKnoten(erste).find((k) =>
        /Kirchgassner-Wohlfahrt|Ohne Einheit|Einsatzeinheit/.test(k.textContent ?? ''),
      );
      return {
        text: (namensKnoten?.textContent ?? erste.textContent ?? '').trim(),
        nameZeilen: namensKnoten ? zeilenVon(namensKnoten) : 0,
        // Ein Einzelwort (Kürzel „Pers.“) steht auf einer Zeile.
        wortGebrochen: textKnoten(erste)
          .filter((k) => !/\s/.test(k.textContent!.trim()))
          .some((k) => zeilenVon(k) > 1),
        hoehe: tr.getBoundingClientRect().height,
      };
    });
    const koepfe = Array.from(wurzel.querySelectorAll('thead th')).map((th) => {
      const knoten = textKnoten(th);
      return {
        text: knoten.map((k) => k.textContent!.trim()).join(' '),
        // Je Textknoten: höchstens so viele Zeilen wie Wörter, sonst bricht ein Wort.
        gebrochen: knoten.some((k) => zeilenVon(k) > k.textContent!.trim().split(/\s+/).length),
      };
    });
    return {
      ersteSpalte: ersteKopfzelle.getBoundingClientRect().width,
      zeilenhoehe,
      reihen,
      koepfe,
    };
  });
}

/**
 * Gemeinsamer Ablauf beider Lesbarkeitsfälle. `zusatz`: Funkrufname und „Fahrzeuge und Personal“
 * stehen am Schirm, wie ab `xxl` oder per Handwahl (LFH-1109).
 */
async function pruefeLesbarkeit(page: Page, browserName: string, zusatz: boolean) {
  test.setTimeout(120_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild lesbar ${Date.now()}`);
  await seedeKraefte(page, einsatzId, KRAEFTE_LESBAR);
  // Eine Einheit mit langem Auftrag: der Auftrag wirbt um Breite, die Einheitenspalte muss ihren
  // Anteil trotzdem halten (ohne ihn verteilte die Tabelle allein nach Inhalt).
  const einheit = await page.request.post(`/api/einsaetze/${einsatzId}/einheiten`, {
    data: { name: EINHEIT_LESBAR },
  });
  expect(einheit.ok(), `Seeding Einheit: ${einheit.status()}`).toBeTruthy();
  const einheitId = ((await einheit.json()) as { id: number }).id;
  const auftrag = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
    data: {
      auftrag_text:
        'Verletztenablage am Deich Süd einrichten und Betroffene aus dem Pegelbereich Altstadt ' +
        'zur Betreuungsstelle Gymnasium Nord bringen',
      empfaenger: [{ empfaenger_typ: 'einheit', einheit_id: einheitId }],
    },
  });
  expect(auftrag.ok(), `Seeding Auftrag: ${auftrag.status()} ${await auftrag.text()}`).toBeTruthy();
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 800 });
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  const zeilen = page.locator('tr.ant-table-row');
  await expect(zeilen).toHaveCount(2);
  await expect(page.getByText('Verletztenablage', { exact: false })).toHaveCount(1);
  if (zusatz) {
    for (const [knopf, spalte] of [
      [/^Spalten · 2 ausgeblendet/, 'Funkrufname'],
      [/^Spalten · 1 ausgeblendet/, 'Fahrzeuge und Personal'],
    ] as const) {
      await page.getByRole('button', { name: knopf }).click();
      await page.getByRole('menuitem', { name: spalte }).click();
      await page.keyboard.press('Escape');
    }
    await expect(page.getByRole('columnheader', { name: 'Funkrufname' })).toHaveCount(1);
  }

  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: 'Drucken / als PDF' }).click();
  await expect(zeilen, '„vorbereiten“ klappt alle Kräfte auf').toHaveCount(KRAEFTE_LESBAR + 2);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);

  const blatt = await lesbarkeit(page);
  test.info().annotations.push({
    type: 'messwert',
    description:
      `erste Spalte ${Math.round(blatt.ersteSpalte)}px, Namenszeilen max ` +
      `${Math.max(...blatt.reihen.map((r) => r.nameZeilen))}, Reihe max ` +
      `${Math.round(Math.max(...blatt.reihen.map((r) => r.hoehe)))}px (Zeilenhöhe ${blatt.zeilenhoehe}px)`,
  });

  // (a) Mindestbreite der ersten Spalte.
  expect(blatt.ersteSpalte, 'erste Spalte im Druck zu schmal').toBeGreaterThanOrEqual(
    MIN_ERSTE_SPALTE,
  );
  // (b) Namen und Reihenhöhe. Vorbedingung: die Namen wurden gefunden.
  expect(blatt.reihen.filter((r) => r.nameZeilen > 0)).toHaveLength(KRAEFTE_LESBAR + 2);
  for (const reihe of blatt.reihen) {
    expect(reihe.nameZeilen, `„${reihe.text}“ bricht über zu viele Zeilen`).toBeLessThanOrEqual(2);
    expect(reihe.wortGebrochen, `in „${reihe.text}“ bricht ein Einzelwort`).toBe(false);
    expect(
      reihe.hoehe,
      `Reihe „${reihe.text}“ höher als ${MAX_ZEILEN_JE_REIHE} Textzeilen`,
    ).toBeLessThanOrEqual(MAX_ZEILEN_JE_REIHE * blatt.zeilenhoehe);
  }
  // (b2) Die Zusatzspalten stehen nie auf dem Blatt (LFH-1109): mit ihnen blieben der
  //      Einheitenspalte neben den Mindestbreiten der übrigen neun Spalten gut 120 px.
  expect(blatt.koepfe.map((k) => k.text).join(' | ')).not.toMatch(
    /Funkrufname|Fahrzeuge und Personal/,
  );
  // (c) Spaltenköpfe brechen nicht im Wort.
  expect(blatt.koepfe.length, 'Vorbedingung: Spaltenköpfe gefunden').toBeGreaterThan(5);
  expect(
    blatt.koepfe.filter((k) => k.gebrochen).map((k) => k.text),
    'Spaltenköpfe, die im Wort brechen',
  ).toEqual([]);

  // (d) Das Blatt selbst: nur Chromium erzeugt ein PDF.
  if (browserName === 'chromium') {
    const auszug = await pdfAuszug(await page.pdf({ format: 'A4' }));
    test.info().annotations.push({ type: 'messwert', description: `PDF ${auszug.length} Seiten` });
    expect(auszug.length, `${KRAEFTE_LESBAR} Kräfte auf zu vielen Seiten`).toBeLessThanOrEqual(
      MAX_SEITEN,
    );
    auszug.forEach((seite, i) =>
      expect(seite.text, `Tabellenkopf auf Seite ${i + 1}`).toMatch(/Rückmeldung/i),
    );
    const alles = auszug.map((s) => s.text).join(' ');
    for (let i = 0; i < KRAEFTE_LESBAR; i += 1) {
      expect(alles, `Kraft ${i} auf dem Blatt`).toContain(`Maximiliane ${i}`);
    }
  }

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: null });
  if (zusatz) {
    // Am Bildschirm stehen sie nach dem Druck wieder.
    await expect(page.getByRole('columnheader', { name: 'Funkrufname' })).toHaveCount(1);
  }
}

test(`Lesbarkeit auf A4: ${KRAEFTE_LESBAR} Kräfte, Name höchstens zwei Zeilen, kein Kopf bricht im Wort, höchstens ${MAX_SEITEN} Seiten`, async ({
  page,
  browserName,
}) => {
  await pruefeLesbarkeit(page, browserName, false);
});

test('Lesbarkeit auf A4 mit eingeblendeten Zusatzspalten: das Blatt bleibt bei den Grundspalten', async ({
  page,
  browserName,
}) => {
  await pruefeLesbarkeit(page, browserName, true);
});
