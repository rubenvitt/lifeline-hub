import { expect, test, type Page } from '@playwright/test';
import { detailBereit, einheitMitZuordnungen, kopfFelder, zuordnungsKarte } from './einheit-fixture';
import { pruefeFokusVerdeckung } from './fokus-kern';

/**
 * Prüflisten-Zeile Z13 der Bedien-Leitlinie — WCAG 2.4.11 „Focus Not Obscured (Minimum)":
 * ein fokussiertes Ziel darf nicht VOLLSTÄNDIG von autoreneigenem Inhalt verdeckt sein
 * (LFH-330 · B2, Bündel V).
 *
 * WARUM DIESE DATEI ÜBERHAUPT EXISTIERT: `2026-07-28-katalogtabellen-pruefliste.md:36/65`
 * hat Z13 namentlich an B2 delegiert, mit genau dieser Begründung — „genau dieses Paket zieht
 * eine fixierte Kopfzeile und eine fixierte erste Spalte ein", also die zwei Konstrukte, auf
 * die 2.4.11 zielt. Ein Tabulatordurchlauf dahinter war nirgends gemessen.
 *
 * WARUM NICHT IN VITEST: jsdom rechnet kein Layout (`vite.config.ts` fährt `css: false`) —
 * `position: sticky` hat dort keine geometrische Wirkung, jedes Rechteck ist 0×0, und die
 * Aussage wäre strukturell unfähig rot zu werden.
 *
 * NEUBAU OHNE VORBILD: `press(`/`keyboard.` trifft in `frontend/e2e/` ausschließlich
 * `command-palette.spec.ts`, `'Tab'` gar nicht. Deshalb trägt der Messkern einen eigenen
 * POSITIVNACHWEIS (erster Test) — bei einem Neubau ist „grün" ohne Gegenprobe kein Ergebnis,
 * sondern eine unbelegte Behauptung. Genau die Rolle, die `katalogTabelle.guard.test.ts:122-135`
 * im Vitest spielt.
 *
 * WELCHE HÄLFTE VON Z13 HIER FÄLLT: die Tabellen-Hälfte (stehende Kopfzeile, fixierte erste
 * Spalte). Die DRAWER-Hälfte — Tabulatordurchlauf bei offenem Navigations-Drawer — bleibt
 * **B7 (LFH-335)**, so von `2026-07-28-rahmen-pruefliste.md:47/90` ausdrücklich getrennt. Wer
 * Z13 abhakt, muss sagen, welche Hälfte er meint.
 *
 * SEEDING PER `page.request`, mit Begründung: die Session ist Cookie-basiert
 * (`api/client.ts:35/46/56`, `credentials: 'same-origin'`, kein CSRF-Header), und
 * `page.request` teilt den Cookie-Jar des Kontexts. Acht Benutzer per Anlege-Modal wären ~40
 * Formularaktionen ohne Erkenntnisgewinn.
 *
 * NEBENBEFUND, benannt statt verschwiegen: die gesäten Benutzer machen die ZAHLEN IN DEN
 * KOMMENTAREN von `katalogtabelle-schmal.spec.ts:134` („gemessen 206 px") und `:160-165`
 * („Dokument 884 px hoch") ungenau. Alle dortigen ZUSICHERUNGEN sind dagegen abgeleitet und
 * unberührt (nachgeprüft: `:135` misst waagerecht, `:184`/`:192`/`:200` rechnen aus eigenen
 * Messwerten) — und mehr Zeilen erhöhen die Bildlaufreserve, machen sie also sicherer. Die
 * Datei wird deshalb nicht angefasst.
 *
 * DER MESSKERN LIEGT SEIT LFH-465 IN `./fokus-kern`: `befehl-aktionsleiste.spec.ts` braucht
 * denselben Kern, und zwei Kopien, die verschieden rechnen, machen beide Nachweise wertlos.
 * Der Umzug war ein reiner Move — die Tests dieser Datei sind unverändert und belegen den
 * Kern weiterhin, samt seinem Selbstbeweis gleich unten.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

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

test('Selbstbeweis: der Messkern meldet eine erfundene Verdeckung', async ({ page }) => {
  // DER ERSATZ FÜR „ROT VOR GRÜN". Ob die zwei Tests unten heute rot sind, war beim Schreiben
  // offen — deshalb braucht der Messkern einen Fall, der JETZT rot ist, solange er falsch
  // rechnet, und der von jeder B2-Zeile unabhängig ist.
  await anmelden(page);
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto('/admin/benutzer');
  await expect(page.locator('tr.ant-table-row').first()).toBeVisible();

  await page.addStyleTag({
    content: `.e2e-verdecker { position: fixed; inset-block-start: 0; inset-inline: 0;
                                block-size: 100vh; background: #000; z-index: 2000; }`,
  });
  await page.evaluate(() =>
    document.body.append(
      Object.assign(document.createElement('div'), { className: 'e2e-verdecker' }),
    ),
  );

  const probe = await pruefeFokusVerdeckung(page, 10);
  expect(
    probe.stoppsGesamt,
    'Vorbedingung: der Durchlauf muss überhaupt irgendwo landen',
  ).toBeGreaterThan(0);
  expect(
    probe.verdeckt.length,
    `der Messkern muss eine echte Verdeckung finden (${probe.stoppsGesamt} Stopps, ` +
      `${probe.fixierteKandidaten} fixierte Kandidaten)`,
  ).toBeGreaterThan(0);
});

test('Katalogtabelle: Tabulaturdurchlauf hinter stehender Kopfzeile und fixierter erster Spalte', async ({
  page,
}) => {
  await anmelden(page);

  // WARUM `/admin/benutzer` und nicht ein Stammdaten-Reiter: Qualifikationen kostet weniger
  // Seeding (EIN Pflichtfeld), trägt aber nur drei Spalten — die fixierte Spalte hätte dort
  // keinen waagerechten Bildlaufweg und die halbe Zusicherung wäre leer. Die Benutzerliste
  // trägt sechs Spalten und zwei fokussierbare Knöpfe je Zeile.
  const LAUF = Date.now();
  for (let i = 0; i < 8; i += 1) {
    const antwort = await page.request.post('/api/benutzer', {
      data: {
        anzeigename: `E2E Fokus ${LAUF}-${i}`,
        benutzername: `e2e-fokus-${LAUF}-${i}`,
        passwort: 'e2e-fokus-pw-123',
      },
    });
    expect(
      antwort.ok(),
      `Seeding Benutzer ${i}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  }

  // Höhe bewusst verkürzt: die Bildlaufreserve ist die Vorbedingung dieses Nachweises, und
  // 844 px Schirmhöhe lassen der Benutzerliste des Harness nur ~40 px (die Falle, die
  // `katalogtabelle-schmal.spec.ts:158-169` protokolliert).
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto('/admin/benutzer');
  await page.waitForLoadState('networkidle');

  /**
   * MINDESTENS 9 Zeilen (8 gesät + Harness-Admin), NICHT genau 9.
   *
   * Gemessen und behoben: `toHaveCount(9)` schlug unter `--repeat-each=5` in vier von fünf
   * Wiederholungen fehl. Die Benutzerliste hängt an `globalKeys`, ist also nicht je Einsatz
   * getrennt, und die Temp-DB lebt über den ganzen Lauf — jede Wiederholung sät acht weitere
   * Benutzer (9 → 17 → 25 …). Eine absolute Zeilenzahl gegen eine geteilte Datenbank ist
   * hier grundsätzlich falsch; gebraucht wird ohnehin nur die UNTERGRENZE, weil sie die
   * Bildlaufreserve trägt. Mehr Zeilen machen den Nachweis sicherer, nicht schwächer.
   *
   * Die Blätterung von `KatalogTabelle` setzt erst über 50 Zeilen ein
   * (`KatalogTabelle.tsx:61/219`); bis dahin stehen alle Zeilen im Baum. Wird diese Datei
   * einmal mit mehr als fünf Wiederholungen gefahren, greift die Blätterung und die
   * Untergrenze bleibt trotzdem erfüllt (Seitengröße 50 ≥ 9).
   */
  const zeilenzahl = await page.locator('tr.ant-table-row').count();
  expect(zeilenzahl, 'Vorbedingung: mindestens 8 gesäte Zeilen + Harness-Admin').toBeGreaterThanOrEqual(9);

  // ── VORBEDINGUNGEN. Ohne sie ist „0 verdeckte Ziele" trivial wahr.
  const kopf = page.locator('.ant-table-sticky-holder');
  await expect(kopf).toHaveCount(1);
  await expect(kopf, 'Vorbedingung: die Kopfzeile muss überhaupt stehen').toHaveCSS(
    'position',
    'sticky',
  );
  const kopfHoehe = (await kopf.boundingBox())!.height;
  const reserve = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(
    reserve,
    `Vorbedingung: die Bildlaufreserve (${reserve}px) muss die Kopfzeile (${kopfHoehe}px) überschreiten — ` +
      'sonst kann keine Zeile unter den Kopf wandern und die Aussage ist leer',
  ).toBeGreaterThan(kopfHoehe);

  // Wirklich unter den Kopf scrollen. Ein Durchlauf am Dokumentanfang trifft die Fixierung
  // gar nicht.
  await page.evaluate((z) => window.scrollTo(0, z), Math.round(reserve / 2));

  const ergebnis = await pruefeFokusVerdeckung(page, 60);
  expect(
    ergebnis.fixierteKandidaten,
    'Vorbedingung: es muss mindestens einen fixierten Knoten geben, hinter dem etwas liegen KÖNNTE',
  ).toBeGreaterThan(0);
  expect(
    ergebnis.stoppsInTabelle,
    `Vorbedingung: der Durchlauf muss überhaupt in der Tabelle landen (${ergebnis.stoppsGesamt} Stopps gesamt) — ` +
      'eine Tabelle ohne fokussierbare Zellen wäre grün, indem der Durchlauf an ihr vorbeiläuft',
  ).toBeGreaterThanOrEqual(4);

  expect(
    ergebnis.verdeckt,
    `Fokusziele vollständig verdeckt:\n${ergebnis.verdeckt.join('\n')}`,
  ).toEqual([]);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Katalogtabelle 390×400: ${ergebnis.stoppsGesamt} Stopps, davon ${ergebnis.stoppsInTabelle} ` +
      `in der Tabelle, ${ergebnis.fixierteKandidaten} fixierte Knoten, Reserve ${reserve}px, ` +
      `Kopf ${kopfHoehe}px`,
  });
});

test('Datensicht-Tabellenzweig: Tabulaturdurchlauf hinter Werkzeugzeile, Kopfzeile und fixierter Spalte', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Fokus B2 ${Date.now()}`);
  for (let i = 0; i < 12; i += 1) {
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

  // 1366 px, damit der TABELLENZWEIG läuft (`form="auto"` schaltet unter `md` auf Karten);
  // Höhe verkürzt für die Bildlaufreserve.
  await page.setViewportSize({ width: 1366, height: 520 });
  await page.goto(`/einsaetze/${einsatzId}/personal`);
  await page.waitForLoadState('networkidle');

  // Belegt, dass hier wirklich der Tabellenzweig gemessen wird und nicht der Kartenzweig.
  await expect(page.locator('.ant-table')).toHaveCount(1);
  await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);
  await expect(page.locator('tr.ant-table-row')).toHaveCount(12);

  const kopf = page.locator('.ant-table-sticky-holder');
  await expect(kopf).toHaveCSS('position', 'sticky');
  const kopfHoehe = (await kopf.boundingBox())!.height;
  const reserve = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(
    reserve,
    `Vorbedingung: Bildlaufreserve (${reserve}px) über Kopfhöhe (${kopfHoehe}px)`,
  ).toBeGreaterThan(kopfHoehe);
  await page.evaluate((z) => window.scrollTo(0, z), Math.round(reserve / 2));

  const ergebnis = await pruefeFokusVerdeckung(page, 60);
  expect(ergebnis.fixierteKandidaten, 'Vorbedingung: fixierte Knoten vorhanden').toBeGreaterThan(0);
  // Höher als in der Katalogtabelle: hier kommen Spaltenschalter, Suchfeld, Spaltenfilter und
  // die Sortierauslöser als Fokusziele dazu. Eine zu niedrige Schwelle ließe einen Durchlauf
  // durch, der die Fläche nur streift.
  expect(
    ergebnis.stoppsInTabelle,
    `Vorbedingung: Durchlauf muss in der Tabelle landen (${ergebnis.stoppsGesamt} Stopps gesamt)`,
  ).toBeGreaterThanOrEqual(8);

  expect(
    ergebnis.verdeckt,
    `Fokusziele vollständig verdeckt:\n${ergebnis.verdeckt.join('\n')}`,
  ).toEqual([]);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Datensicht 1366×520: ${ergebnis.stoppsGesamt} Stopps, davon ${ergebnis.stoppsInTabelle} ` +
      `in der Tabelle, ${ergebnis.fixierteKandidaten} fixierte Knoten, Reserve ${reserve}px, ` +
      `Kopf ${kopfHoehe}px`,
  });
});

/**
 * Die sticky Speicherleiste der Einstellungs-Sektionen (LFH-345 · C10, Prüflisten-Zeile 13).
 *
 * DIE DRITTE HÄLFTE VON Z13. Die Tabellen-Hälfte fiel mit B2, die Drawer-Hälfte mit B7 —
 * C10 zieht ein NEUES `position: sticky` ein, und zwar genau die Konstruktion, auf die
 * WCAG 2.4.11 zielt: eine am unteren Rand verankerte Leiste über einem langen Formular. Das
 * unterste Feld liegt dann potenziell dahinter.
 *
 * Die Sektion „Verhalten" ist der scharfe Fall: neun Felder, das letzte steht unmittelbar
 * über der Leiste. „Allgemein" (5) und „Aufbewahrung" (1) kommen ohne Bildlauf aus.
 *
 * ── WARUM ES DIESEN TEST GIBT ───────────────────────────────────────────────────────────
 * Die Prüfliste führte Zeile 13 zunächst als „erfüllt — wird gegen `fokus-verdeckung.spec.ts`
 * gehalten". Diese Datei enthielt die Einstellungen aber gar nicht; das Verdikt stand auf
 * nicht existierender Evidenz. Im eigenen Review aufgefallen — das hier ist die Nachbesserung.
 */
test('Einstellungen: Tabulaturdurchlauf unter der sticky Speicherleiste', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Fokus Einstellungen ${Date.now()}`);

  // Verkürzte Höhe ist die Vorbedingung: ohne Bildlaufreserve klebt die Leiste am Seitenende
  // statt über dem Inhalt, und die Zusicherung wäre trivial wahr.
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto(`/einsaetze/${einsatzId}/einstellungen/verhalten`);
  await expect(page.getByLabel('Präfix ETB')).toBeVisible();

  const reserve = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(reserve, 'Vorbedingung: die Seite muss überhaupt scrollen').toBeGreaterThan(0);

  const ergebnis = await pruefeFokusVerdeckung(page, 40);

  expect(
    ergebnis.fixierteKandidaten,
    'Vorbedingung: die sticky Speicherleiste muss im Baum stehen',
  ).toBeGreaterThanOrEqual(1);

  expect(
    ergebnis.stoppsGesamt,
    'Vorbedingung: der Durchlauf muss die Formularfelder erreichen',
  ).toBeGreaterThanOrEqual(8);

  expect(
    ergebnis.verdeckt,
    `Fokusziele vollständig verdeckt:\n${ergebnis.verdeckt.join('\n')}`,
  ).toEqual([]);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Einstellungen/verhalten 390×420: ${ergebnis.stoppsGesamt} Stopps, ` +
      `${ergebnis.fixierteKandidaten} fixierte Knoten, Reserve ${reserve}px`,
  });
});

/** LFH-446: Besuchsnachweise gehören zur Route, allgemeine Stopps zählen auch die Navigation. */
async function einheitFokusBereit(page: Page, dichte: string) {
  await anmelden(page);
  const { pfad } = await einheitMitZuordnungen(page);
  await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
  await page.goto(pfad);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
  await detailBereit(page);
  const ziele = kopfFelder(page).map(({ name, fokus }) => ({ name, fokus }));
  for (const name of ['Speichern', 'Auflösen']) {
    ziele.push({ name, fokus: page.getByRole('main').getByRole('button', { name, exact: true }) });
  }
  ziele.push({ name: 'neue Sprechgruppe anlegen', fokus: page.getByRole('main').getByRole('button', { name: /neue Sprechgruppe anlegen$/ }) });
  for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
    const karte = zuordnungsKarte(page, titel);
    ziele.push({ name: `${titel} entfernen`, fokus: karte.getByRole('button', { name: 'Entfernen', exact: true }) });
    ziele.push({ name: `${titel} zuordnen`, fokus: karte.getByRole('combobox') });
  }
  ziele.push({ name: 'Als Einheitsführer', fokus: zuordnungsKarte(page, 'Personal').getByRole('button', { name: 'Als Einheitsführer' }) });
  for (const { name, fokus } of ziele) {
    await expect(fokus, name).toHaveCount(1);
    await fokus.evaluate((el, kennung) => el.setAttribute('data-e2e-fokus', kennung), name);
  }
  const leiste = page.getByRole('button', { name: 'Speichern', exact: true }).locator('xpath=ancestor::div[@style][contains(@style,"sticky")][1]');
  await expect(leiste).toHaveCount(1);
  await expect(leiste).toHaveCSS('position', 'sticky');
  await leiste.evaluate((el) => el.classList.add('e2e-einheit-leiste'));
  const reserve = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(reserve).toBeGreaterThan((await leiste.boundingBox())!.height);
  return { ziele: ziele.map(({ name }) => name), leiste };
}

for (const viewport of [{ width: 1366, height: 520 }, { width: 390, height: 420 }]) {
  for (const dichte of ['kompakt', 'handschuh']) {
    test(`Einheit: alle Formular- und Zuordnungsziele frei bei ${viewport.width}px, ${dichte}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      const { ziele, leiste } = await einheitFokusBereit(page, dichte);
      await page.getByRole('main').getByRole('link', { name: 'Einheiten', exact: true }).focus();
      // Die Leiste steht während der Formulareingabe tatsächlich im Viewport.
      await page.getByLabel('Name', { exact: true }).focus();
      await expect(leiste).toBeInViewport();
      await page.getByRole('main').getByRole('link', { name: 'Einheiten', exact: true }).focus();
      const befund = await pruefeFokusVerdeckung(page, 60);
      expect(befund.besuchteZiele.sort(), 'Jedes benannte Feld, jede Leisten- und Zuordnungsaktion muss per Tab besucht werden').toEqual(ziele.sort());
      expect(befund.fixierteKandidaten).toBeGreaterThan(0);
      expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);
      test.info().annotations.push({ type: 'messwert', description: `${viewport.width}px ${dichte}: ${befund.besuchteZiele.length} verschiedene Routenziele, ${befund.stoppsGesamt} Stopps, ${befund.verdeckt.length} Verdeckungen` });
    });
  }
}

for (const { dichte, boden, abstand } of [
  { dichte: 'komfortabel', boden: 48, abstand: 8 },
  { dichte: 'handschuh', boden: 72, abstand: 16 },
]) {
  test(`Einheit: geöffnete Sprechgruppenfelder bei 390px, ${dichte}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 420 });
    const { ziele } = await einheitFokusBereit(page, dichte);
    await page.getByRole('button', { name: /neue Sprechgruppe anlegen$/ }).click();
    const bezeichnung = page.getByRole('textbox', { name: 'Neue Bezeichnung', exact: true });
    const betriebsart = page.getByRole('combobox', { name: 'Neue Betriebsart', exact: true });
    await bezeichnung.fill('Messgruppe');
    await betriebsart.click();
    // AntD virtualisiert role=option in einen unsichtbaren ARIA-Hilfsknoten.
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^TMO$/ }).click();
    const ergaenzt = [
      { name: 'Neue Bezeichnung', fokus: bezeichnung, huelle: bezeichnung },
      { name: 'Neue Betriebsart', fokus: betriebsart, huelle: page.locator('.ant-select').filter({ has: betriebsart }) },
      ...['Anlegen', 'Abbrechen'].map((name) => ({ name, fokus: page.getByRole('button', { name, exact: true }), huelle: page.getByRole('button', { name, exact: true }) })),
    ];
    await expect(ergaenzt[2].fokus).toBeEnabled();
    const kaesten = [];
    for (const { name, fokus, huelle } of ergaenzt) {
      await fokus.evaluate((el, wert) => el.setAttribute('data-e2e-fokus', wert), name);
      const kasten = (await huelle.boundingBox())!;
      expect(Math.min(kasten.width, kasten.height), `${name}, ${dichte}`).toBeGreaterThanOrEqual(boden - 0.5);
      kaesten.push(kasten);
    }
    for (let i = 1; i < kaesten.length; i++) {
      const a = kaesten[i - 1];
      const b = kaesten[i];
      expect(Math.max(b.x - a.x - a.width, b.y - a.y - a.height), `Feldabstand ${dichte}, Paar ${i}`).toBeGreaterThanOrEqual(abstand - 0.5);
    }
    const breite = await page.evaluate(() => ({ inhalt: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(breite.inhalt, `Kein horizontaler Überlauf bei geöffneter Schnellerfassung ${dichte}`).toBeLessThanOrEqual(breite.viewport);
    await page.getByRole('main').getByRole('link', { name: 'Einheiten', exact: true }).focus();
    const befund = await pruefeFokusVerdeckung(page, 60);
    expect(befund.besuchteZiele.sort()).toEqual([...ziele.filter((name) => name !== 'neue Sprechgruppe anlegen'), ...ergaenzt.map(({ name }) => name)].sort());
    expect(befund.fixierteKandidaten).toBeGreaterThan(0);
    expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);
    test.info().annotations.push({ type: 'messwert', description: `390px ${dichte}, Sprechgruppen offen: ${befund.besuchteZiele.length} Routenziele, ${befund.verdeckt.length} Verdeckungen, 4 Ziele ≥${boden}px, Abstände ≥${abstand}px, kein horizontaler Überlauf` });
  });
}

test('Einheit Selbstbeweis: ein Fokusziel hinter der echten sticky Aktionsleiste wird erkannt', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 520 });
  const { leiste } = await einheitFokusBereit(page, 'handschuh');
  await page.getByLabel('Name', { exact: true }).focus();
  await expect(leiste).toBeInViewport();
  await leiste.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const probe = document.createElement('button');
    probe.id = 'e2e-leistenprobe';
    probe.textContent = 'Leistenprobe';
    probe.setAttribute('data-e2e-fokus', 'Leistenprobe');
    Object.assign(probe.style, { position: 'fixed', left: `${r.left + 10}px`, top: `${r.top + 10}px`, width: '40px', height: '20px', zIndex: '0' });
    // Geschwister, kein Kind der Leiste: Vorfahren des Fokusziels sind keine Verdecker.
    el.before(probe);
    const start = document.createElement('button');
    start.id = 'e2e-probenstart';
    start.style.position = 'fixed';
    probe.before(start);
    start.focus({ preventScroll: true });
  });
  const verdeckt = await pruefeFokusVerdeckung(page, 1);
  expect(verdeckt.besuchteZiele).toEqual(['Leistenprobe']);
  expect(verdeckt.verdeckt).toHaveLength(1);
  expect(verdeckt.verdeckt[0]).toContain('e2e-einheit-leiste');
  // Gegenprobe am selben Ziel: die Geometrie außerhalb der Leiste muss frei sein.
  await page.locator('#e2e-leistenprobe').evaluate((el) => { el.style.top = '100px'; });
  await page.locator('#e2e-probenstart').focus();
  expect((await pruefeFokusVerdeckung(page, 1)).verdeckt).toEqual([]);
});
