import { expect, test, type Page } from '@playwright/test';
import {
  detailBereit,
  einheitMitZuordnungen,
  kopfFelder,
  zuordnungsKarte,
} from './einheit-fixture';
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

test('Selbstbeweis (LFH-373): Zusatzkandidaten machen einen ABSOLUTEN Verdecker sichtbar — ohne sie nicht', async ({
  page,
}) => {
  // Die Kartenaufbauten der Lage- und Personenkarte sind `position: absolute`. Die Vorgabe des
  // Kerns wertet nur `sticky|fixed` — ein Lauf dort wäre grün durch Konstruktion. Dieser Test
  // belegt beide Hälften der Opt-in-Erweiterung: mit `zusatzKandidaten` findet der Kern die
  // Verdeckung, OHNE sie findet er sie nicht. Die zweite Hälfte ist die schärfere: sie zeigt,
  // dass die Vorgabe die Option nicht still mitenthält, dass also die Bestandsaufrufer
  // unverändert rechnen.
  await anmelden(page);
  await page.setViewportSize({ width: 390, height: 400 });

  const laufMitAttrappe = async (optionen?: { zusatzKandidaten: string[] }) => {
    await page.goto('/admin/benutzer');
    await expect(page.locator('tr.ant-table-row').first()).toBeVisible();
    // Absolut über das GANZE Dokument, nicht über den Schirm: sonst läge ein Ziel nach dem
    // Bildlauf außerhalb der Attrappe und der Befund hinge an der Scrollposition.
    await page.evaluate(() => {
      const hoehe = document.scrollingElement!.scrollHeight;
      document.body.append(
        Object.assign(document.createElement('div'), {
          className: 'e2e-absolut-verdecker',
          style: `position:absolute;top:0;left:0;width:100%;height:${hoehe}px;background:#000;z-index:2000`,
        }),
      );
    });
    return pruefeFokusVerdeckung(page, 10, 'Tab', optionen);
  };

  const ohne = await laufMitAttrappe();
  const mit = await laufMitAttrappe({ zusatzKandidaten: ['.e2e-absolut-verdecker'] });
  expect(mit.stoppsGesamt, 'Vorbedingung: der Durchlauf muss irgendwo landen').toBeGreaterThan(0);
  expect(
    mit.verdeckt.length,
    `mit Zusatzkandidat muss der Kern die absolute Attrappe finden (${mit.stoppsGesamt} Stopps)`,
  ).toBeGreaterThan(0);
  expect(
    ohne.verdeckt,
    'ohne Zusatzkandidat bleibt der absolute Verdecker unsichtbar — die Vorgabe ist unverändert',
  ).toEqual([]);
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
  // `expect.poll` statt `count()`: Letzteres ist die EINZIGE Abfrage dieser Datei ohne
  // Nachwartung, und `waitForLoadState('networkidle')` davor ist zu früh, wenn die Seite
  // ihre erste Datenanfrage erst NACH dem 500-ms-Ruhefenster stellt — Assets fertig,
  // 500 ms still, „idle", dann montiert React und holt erst jetzt `/api/benutzer`. Auf
  // zwei geteilten Kernen mit zwei Playwright-Workern ist das erreichbar: in CI zweimal
  // rot mit „Received: 0" (LFH-358, PR #59), lokal 3/3 grün. Die Aussage bleibt wortgleich
  // — die UNTERGRENZE gegen die geteilte Temp-DB, siehe der Absatz darüber —, sie bekommt
  // nur die Wiederholung, die jede andere Zeile dieses Specs schon hat.
  await expect
    .poll(() => page.locator('tr.ant-table-row').count(), {
      message: 'Vorbedingung: mindestens 8 gesäte Zeilen + Harness-Admin',
    })
    .toBeGreaterThanOrEqual(9);

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
  ziele.push({
    name: 'neue Sprechgruppe anlegen',
    fokus: page.getByRole('main').getByRole('button', { name: /neue Sprechgruppe anlegen$/ }),
  });
  for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
    const karte = zuordnungsKarte(page, titel);
    ziele.push({
      name: `${titel} entfernen`,
      fokus: karte.getByRole('button', { name: 'Entfernen', exact: true }),
    });
    ziele.push({ name: `${titel} zuordnen`, fokus: karte.getByRole('combobox') });
  }
  ziele.push({
    name: 'Als Einheitsführer',
    fokus: zuordnungsKarte(page, 'Personal').getByRole('button', { name: 'Als Einheitsführer' }),
  });
  for (const { name, fokus } of ziele) {
    await expect(fokus, name).toHaveCount(1);
    await fokus.evaluate((el, kennung) => el.setAttribute('data-e2e-fokus', kennung), name);
  }
  const leiste = page
    .getByRole('button', { name: 'Speichern', exact: true })
    .locator('xpath=ancestor::div[@style][contains(@style,"sticky")][1]');
  await expect(leiste).toHaveCount(1);
  await expect(leiste).toHaveCSS('position', 'sticky');
  await leiste.evaluate((el) => el.classList.add('e2e-einheit-leiste'));
  const reserve = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(reserve).toBeGreaterThan((await leiste.boundingBox())!.height);
  return { ziele: ziele.map(({ name }) => name), leiste };
}

for (const viewport of [
  { width: 1366, height: 520 },
  { width: 390, height: 420 },
]) {
  for (const dichte of ['kompakt', 'handschuh']) {
    test(`Einheit: alle Formular- und Zuordnungsziele frei bei ${viewport.width}px, ${dichte}`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      const { ziele, leiste } = await einheitFokusBereit(page, dichte);
      await page.getByRole('main').getByRole('link', { name: 'Einheiten', exact: true }).focus();
      // Die Leiste steht während der Formulareingabe tatsächlich im Viewport.
      await page.getByLabel('Name', { exact: true }).focus();
      await expect(leiste).toBeInViewport();
      await page.getByRole('main').getByRole('link', { name: 'Einheiten', exact: true }).focus();
      const befund = await pruefeFokusVerdeckung(page, 60);
      expect(
        befund.besuchteZiele.sort(),
        'Jedes benannte Feld, jede Leisten- und Zuordnungsaktion muss per Tab besucht werden',
      ).toEqual(ziele.sort());
      expect(befund.fixierteKandidaten).toBeGreaterThan(0);
      expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);
      test.info().annotations.push({
        type: 'messwert',
        description: `${viewport.width}px ${dichte}: ${befund.besuchteZiele.length} verschiedene Routenziele, ${befund.stoppsGesamt} Stopps, ${befund.verdeckt.length} Verdeckungen`,
      });
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
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
      .filter({ hasText: /^TMO$/ })
      .click();
    const ergaenzt = [
      { name: 'Neue Bezeichnung', fokus: bezeichnung, huelle: bezeichnung },
      {
        name: 'Neue Betriebsart',
        fokus: betriebsart,
        huelle: page.locator('.ant-select').filter({ has: betriebsart }),
      },
      ...['Anlegen', 'Abbrechen'].map((name) => ({
        name,
        fokus: page.getByRole('button', { name, exact: true }),
        huelle: page.getByRole('button', { name, exact: true }),
      })),
    ];
    await expect(ergaenzt[2].fokus).toBeEnabled();
    const kaesten = [];
    for (const { name, fokus, huelle } of ergaenzt) {
      await fokus.evaluate((el, wert) => el.setAttribute('data-e2e-fokus', wert), name);
      const kasten = (await huelle.boundingBox())!;
      expect(Math.min(kasten.width, kasten.height), `${name}, ${dichte}`).toBeGreaterThanOrEqual(
        boden - 0.5,
      );
      kaesten.push(kasten);
    }
    for (let i = 1; i < kaesten.length; i++) {
      const a = kaesten[i - 1];
      const b = kaesten[i];
      expect(
        Math.max(b.x - a.x - a.width, b.y - a.y - a.height),
        `Feldabstand ${dichte}, Paar ${i}`,
      ).toBeGreaterThanOrEqual(abstand - 0.5);
    }
    const breite = await page.evaluate(() => ({
      inhalt: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(
      breite.inhalt,
      `Kein horizontaler Überlauf bei geöffneter Schnellerfassung ${dichte}`,
    ).toBeLessThanOrEqual(breite.viewport);
    await page.getByRole('main').getByRole('link', { name: 'Einheiten', exact: true }).focus();
    const befund = await pruefeFokusVerdeckung(page, 60);
    expect(befund.besuchteZiele.sort()).toEqual(
      [
        ...ziele.filter((name) => name !== 'neue Sprechgruppe anlegen'),
        ...ergaenzt.map(({ name }) => name),
      ].sort(),
    );
    expect(befund.fixierteKandidaten).toBeGreaterThan(0);
    expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);
    test.info().annotations.push({
      type: 'messwert',
      description: `390px ${dichte}, Sprechgruppen offen: ${befund.besuchteZiele.length} Routenziele, ${befund.verdeckt.length} Verdeckungen, 4 Ziele ≥${boden}px, Abstände ≥${abstand}px, kein horizontaler Überlauf`,
    });
  });
}

test('Einheit Selbstbeweis: ein Fokusziel hinter der echten sticky Aktionsleiste wird erkannt', async ({
  page,
}) => {
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
    Object.assign(probe.style, {
      position: 'fixed',
      left: `${r.left + 10}px`,
      top: `${r.top + 10}px`,
      width: '40px',
      height: '20px',
      zIndex: '0',
    });
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
  await page.locator('#e2e-leistenprobe').evaluate((el) => {
    el.style.top = '100px';
  });
  await page.locator('#e2e-probenstart').focus();
  expect((await pruefeFokusVerdeckung(page, 1)).verdeckt).toEqual([]);
});

/**
 * Der klebende Fuß des Modulpanels (Einsatzdauer, `sticky; bottom: 0`) verdeckt kein Ziel
 * der Liste darüber — deterministisch statt über den Tabulatordurchlauf oben, der die Lage
 * nur zufällig trifft: im vollen Lauf mit gewachsenem Datenbestand landete
 * „Bereitstellungsräume" (72 px, `handschuh`) ganz hinter dem Fuß, einzeln lief derselbe
 * Test grün. Hier wird die Seite je Schritt anders gescrollt und das Ziel frisch fokussiert.
 * Gegenprobe beim Bau: ohne `fussFokusabstandStil` blieb es bei 0/20/40 px Ausgangslage
 * unter dem Fuß (Unterkante 520 gegen Fußoberkante 438).
 */
test('Modulpanel: der klebende Einsatzdauer-Fuß verdeckt kein fokussiertes Modul (1366 × 520, handschuh)', async ({
  page,
}) => {
  await anmelden(page);
  await page.setViewportSize({ width: 1366, height: 520 });
  const { pfad } = await einheitMitZuordnungen(page);
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await page.goto(pfad);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  await detailBereit(page);
  const panel = page.locator('[data-lfh="modul-panel"]');
  const fuss = panel.locator('[data-lfh="modul-panel-fuss"]');
  await expect(fuss).toHaveCSS('position', 'sticky');
  const ziel = panel.getByRole('button', { name: /^Bereitstellungsräume/ });
  await expect(ziel).toHaveCount(1);
  const befunde: string[] = [];
  let unterDemFussGestartet = 0;
  for (let y = 0; y <= 200; y += 20) {
    await page.evaluate((wert) => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, wert);
    }, y);
    // Vorbedingung zählen: nur Lagen, in denen das Ziel VOR dem Fokus den Fuß berührt,
    // prüfen überhaupt etwas.
    const vorher = await ziel.evaluate(
      (el, f) => el.getBoundingClientRect().bottom > f!.getBoundingClientRect().top,
      await fuss.elementHandle(),
    );
    if (vorher) unterDemFussGestartet += 1;
    await ziel.focus();
    const m = await ziel.evaluate(
      (el, f) => ({
        unten: el.getBoundingClientRect().bottom,
        fussOben: f!.getBoundingClientRect().top,
      }),
      await fuss.elementHandle(),
    );
    if (m.unten > m.fussOben + 1) befunde.push(`Ausgangslage ${y}px: ${JSON.stringify(m)}`);
  }
  expect(unterDemFussGestartet, 'mindestens eine Lage beginnt unter dem Fuß').toBeGreaterThan(0);
  expect(befunde, befunde.join('\n')).toEqual([]);
});

// ── LFH-373 ──────────────────────────────────────────────────────────────────────────────

/** Stellt die Dichte über den Weg eines wiederkehrenden Benutzers (localStorage + Neuladen)
 *  und hält die Wache am `<html>` — Muster `stelleDichte` in `gate3-trefflaeche.spec.ts`. */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/**
 * Blendet den Öffnen-Knopf der TanStack-Query-Devtools aus (LFH-373). Er steht nur im
 * DEV-Build (`main.tsx`, `ReactQueryDevtools`), gegen den die e2e-Suite fährt, als
 * `position: fixed` unten rechts — auf 390 px lag er gemessen vollständig über einer
 * Matrixzelle. Ein Verdecker, den es im Betrieb nicht gibt, ist kein Befund über die Seite.
 * Per Init-Skript, weil `stelleDichte` neu lädt und ein `addStyleTag` dabei verloren ginge.
 */
async function ohneDevtoolsKnopf(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const stil = document.createElement('style');
      stil.textContent = '[class*="tsqd-open-btn"] { display: none !important; }';
      document.head.append(stil);
    });
  });
}

/**
 * Kleinster freier Streifen zwischen der UNTERKANTE eines angesteuerten Ziels und der
 * OBERKANTE einer angepinnten Fußleiste, über `schritte` Tabulatorschritte. Gezählt werden
 * nur Ziele mit `data-e2e-fokus`.
 *
 * WARUM NEBEN DEM KERN: der Kern meldet nur VOLLSTÄNDIGE Verdeckung (WCAG 2.4.11 Minimum).
 * Ein Ziel, das zur Hälfte unter der Leiste steckt, ist dort frei — für die Bedienung aber
 * nicht. Der Befehls-Spec hat eine verwandte Messung (`kleinsterFreiraum`), die auf dessen
 * Formularfelder und Leiste zugeschnitten ist und sich deshalb nicht teilen lässt.
 */
async function kleinsterStreifen(page: Page, schritte: number, leiste: string): Promise<number> {
  let kleinster = Number.POSITIVE_INFINITY;
  for (let i = 0; i < schritte; i += 1) {
    await page.keyboard.press('Tab');
    const wert = await page.evaluate((sel) => {
      const fokus = document.activeElement;
      const l = document.querySelector(sel);
      if (fokus == null || l == null || !fokus.hasAttribute('data-e2e-fokus')) return null;
      return l.getBoundingClientRect().top - fokus.getBoundingClientRect().bottom;
    }, leiste);
    if (wert != null) kleinster = Math.min(kleinster, wert);
  }
  return kleinster;
}

/**
 * ETB (LFH-373, Prüfliste ETB Zeile 13): die angepinnte Erfassungsleiste am Seitenfuß.
 *
 * GEMESSEN VOR DEM FIX (24.09.2026): beim Vorwärtstabben rollt der Browser jedes Ziel an den
 * UNTEREN Rand des Fensters — genau dorthin, wo die Leiste klebt. Jeder zweite bis jeder
 * Zeilenauslöser lag vollständig hinter ihr, auf beiden Breiten und in beiden Stufen.
 *
 * START AM ERSTEN AUSLÖSER, nicht am Dokumentanfang: die Erfassung fokussiert beim Einhängen
 * ihr Textfeld am Seitenfuß, ein nacktes Tab nach `goto` liefe an der Zeitachse vorbei.
 *
 * KLEINE HÖHEN mit Absicht: ohne Bildlaufreserve klebt die Leiste am Seitenende statt über
 * der Zeitachse, und „0 verdeckt" wäre trivial wahr. Deshalb 600 bzw. 520 px und 16 Einträge.
 */
test('ETB (LFH-373): kein Zeilenauslöser verschwindet beim Tabben hinter der Erfassungsleiste', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ohneDevtoolsKnopf(page);
  await anmelden(page);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Fokus 373 Nord ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id: einsatzId } = (await antwort.json()) as { id: number };
  const ANZAHL = 16;
  for (let n = 1; n <= ANZAHL; n += 1) {
    const eintrag = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: {
        typ: 'meldung',
        inhalt: `Probe ${n}: Lage unverändert`,
        von: 'ELW 1',
        an: 'Leitstelle',
      },
    });
    expect(eintrag.ok(), await eintrag.text()).toBeTruthy();
  }

  const gemessen: string[] = [];
  const LEISTE = '.etb-erfassung-sticky';
  for (const flaeche of [
    { width: 390, height: 600 },
    { width: 1366, height: 520 },
  ]) {
    await page.setViewportSize(flaeche);
    for (const dichte of ['kompakt', 'handschuh']) {
      const lauf = `${flaeche.width}×${flaeche.height}/${dichte}`;
      await page.goto(`/einsaetze/${einsatzId}/etb`);
      await stelleDichte(page, dichte);
      const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
      await expect(zeitachse.getByTestId('etb-ereigniszeile')).toHaveCount(ANZAHL);
      await expect(page.locator(LEISTE)).toHaveCSS('position', 'sticky');

      const ausloeser = zeitachse.getByRole('button', { name: /^Aktionen zu Eintrag \d+$/ });
      await expect(ausloeser).toHaveCount(ANZAHL);
      await ausloeser.evaluateAll((els) =>
        els.forEach((el) => el.setAttribute('data-e2e-fokus', el.getAttribute('aria-label')!)),
      );
      const { reserve, leiste } = await page.evaluate((sel) => {
        const l = document.querySelector(sel)!.getBoundingClientRect();
        return {
          reserve: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          leiste: Math.round(l.height),
        };
      }, LEISTE);
      expect(
        reserve,
        `${lauf}: Vorbedingung — die Bildlaufreserve (${reserve}px) muss die Leiste (${leiste}px) übersteigen`,
      ).toBeGreaterThan(leiste);

      await page.evaluate(() => window.scrollTo(0, 0));
      await ausloeser.first().focus();
      const kern = await pruefeFokusVerdeckung(page, ANZAHL + 4);
      expect(
        kern.besuchteZiele.length,
        `${lauf}: Vorbedingung — der Durchlauf muss die Zeitachse ablaufen`,
      ).toBeGreaterThanOrEqual(ANZAHL - 1);

      await page.evaluate(() => window.scrollTo(0, 0));
      await ausloeser.first().focus();
      const streifen = await kleinsterStreifen(page, ANZAHL + 4, LEISTE);

      expect(kern.verdeckt, `${lauf}: vollständig verdeckt:\n${kern.verdeckt.join('\n')}`).toEqual(
        [],
      );
      expect(
        streifen,
        `${lauf}: kleinster freier Streifen Ziel ↔ Leiste ${streifen}px, Soll > 0`,
      ).toBeGreaterThan(0);
      gemessen.push(
        `${lauf}: Leiste ${leiste}px, ${kern.besuchteZiele.length} Auslöser, Streifen ≥ ${Math.round(streifen)}px`,
      );
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

/** Einsatz mit zwei Gefahrengebieten per API (Karte braucht WebGL, `POST …/zonen` nicht). */
async function matrixEinsatz(page: Page): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Fokus 373 Sued ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id } = (await antwort.json()) as { id: number };
  for (const [i, label] of ['Sektor Sued 1', 'Sektor Sued 2'].entries()) {
    const x = 10 + i / 20;
    const zone = await page.request.post(`/api/einsaetze/${id}/zonen`, {
      data: {
        typ: 'gefahrengebiet',
        geometrie_typ: 'Polygon',
        geometrie: JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [x, 50],
              [x + 0.01, 50],
              [x + 0.01, 50.01],
              [x, 50.01],
              [x, 50],
            ],
          ],
        }),
        label,
      },
    });
    expect(zone.ok(), await zone.text()).toBeTruthy();
  }
  return id;
}

/**
 * Gefahrenmatrix (LFH-373, Prüfliste B5h Zeile 13): stehende Kopfzeile und fixierte Spalte
 * „Gefahr" gegenüber 58 Zell-Auslösern.
 *
 * STRUKTURELL ANDERS ALS DIE KATALOGTABELLEN: dort trägt eine Zeile ein, zwei Fokusziele, hier
 * trägt JEDE Spalte eins. Beim Sprung von der letzten Zelle einer Zeile zur ersten der nächsten
 * rollt der Tabellencontainer nach links, und der Browser richtet das Ziel am linken Rand des
 * Scrollports aus — unter der 180 px breiten fixierten Spalte. GEMESSEN VOR DEM FIX
 * (24.09.2026): vollständig verdeckt bei 390 px in allen Stufen, bei 1024 px in `kompakt`/
 * `komfortabel`, bei 1366 px in `handschuh`.
 *
 * VORBEDINGUNG „die Tabelle läuft waagerecht über": ohne Überlauf rollt nichts, die fixierte
 * Spalte steht nie vor einem Ziel, und „0 verdeckt" wäre trivial wahr.
 *
 * RÜCKWÄRTS eigens: vorwärts rollt ein Ziel an den UNTEREN Rand, unter die OBEN stehende
 * Kopfzeile gerät es so nie (Kern, Abschnitt RICHTUNG). `Shift+Tab` von der letzten Zelle aus
 * prüft die Kopfzeile, `stoppsAnTabellenkopf` belegt, dass der Lauf sie erreicht hat.
 */
test('Gefahrenmatrix (LFH-373): keine Zelle verschwindet beim Tabben unter der fixierten Spalte oder der Kopfzeile', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ohneDevtoolsKnopf(page);
  await anmelden(page);
  const einsatzId = await matrixEinsatz(page);
  const gemessen: string[] = [];

  for (const flaeche of [
    { width: 390, height: 400 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(flaeche);
    for (const dichte of ['kompakt', 'handschuh']) {
      const lauf = `${flaeche.width}×${flaeche.height}/${dichte}`;
      await page.goto(`/einsaetze/${einsatzId}/gefahren`);
      await stelleDichte(page, dichte);
      const zellen = page.getByRole('button', { name: /^Bewertung / });
      await expect(zellen).toHaveCount(58);
      await zellen.evaluateAll((els) =>
        els.forEach((el) => el.setAttribute('data-e2e-fokus', el.getAttribute('aria-label')!)),
      );
      await expect(page.locator('.ant-table-sticky-holder')).toHaveCSS('position', 'sticky');
      const huelle = await page
        .locator('.ant-table-body')
        .evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(
        huelle.sw,
        `${lauf}: Vorbedingung — die Matrix muss waagerecht überlaufen (${huelle.sw} ≤ ${huelle.cw})`,
      ).toBeGreaterThan(huelle.cw);

      await page.evaluate(() => window.scrollTo(0, 0));
      await zellen.first().focus();
      const vor = await pruefeFokusVerdeckung(page, 62);
      // 57: der Kern zählt nach jedem Tab, die Startzelle selbst ist also nie dabei.
      expect(vor.besuchteZiele.length, `${lauf}: vorwärts alle übrigen 57 Zellen besucht`).toBe(57);
      expect(vor.verdeckt, `${lauf} vorwärts:\n${vor.verdeckt.join('\n')}`).toEqual([]);

      await zellen.last().focus();
      const rueck = await pruefeFokusVerdeckung(page, 62, 'Shift+Tab');
      expect(rueck.besuchteZiele.length, `${lauf}: rückwärts alle übrigen 57 Zellen besucht`).toBe(
        57,
      );
      expect(rueck.verdeckt, `${lauf} rückwärts:\n${rueck.verdeckt.join('\n')}`).toEqual([]);

      gemessen.push(
        `${lauf}: Überlauf ${huelle.sw}/${huelle.cw}, rückwärts an der Kopfzeile ${rueck.stoppsAnTabellenkopf}`,
      );
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});
