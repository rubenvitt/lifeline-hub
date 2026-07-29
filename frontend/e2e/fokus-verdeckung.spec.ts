import { expect, test, type Page } from '@playwright/test';

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

interface Verdeckungsbefund {
  verdeckt: string[];
  stoppsInTabelle: number;
  stoppsGesamt: number;
  fixierteKandidaten: number;
}

/**
 * Läuft `schritte` Tabulatorschritte und meldet jedes vollständig verdeckte Fokusziel.
 *
 * GEMESSEN WIRD GEGEN JEDEN KNOTEN MIT `position: sticky|fixed`, nicht gegen einen benannten
 * Selektor: der Kopfhalter heißt bei antd `.ant-table-sticky-holder`, die fixierte Spalte
 * `.ant-table-cell-fix-start`, die Werkzeugzeile des Primitivs ist ein drittes, unbenanntes
 * Konstrukt — und ein vierter Kandidat käme namenlos dazu. Eine Selektorliste veraltet still.
 *
 * ZWEI BEDINGUNGEN ZUSAMMEN, weil jede einzeln falsch urteilt:
 *  - Nur RECHTECK-ENTHALTENSEIN ist falsch POSITIV: eine durchsichtige Sticky-Hülle über der
 *    ganzen Fläche enthält jedes Ziel, verdeckt aber nichts.
 *  - Nur `elementFromPoint` ist falsch NEGATIV: ein Ziel mit einem Pixel Überstand liefert am
 *    Mittelpunkt sich selbst zurück und gilt als frei, obwohl es praktisch verdeckt ist.
 * Gemeldet wird nur, was BEIDE Bedingungen erfüllt.
 *
 * Vorfahren des Ziels sind ausgenommen: ein `sticky` Container, IN dem das Ziel liegt,
 * verdeckt es nicht — er trägt es.
 *
 * `stoppsInTabelle` zählt Stopps mit `closest('.ant-table')`, `fixierteKandidaten` die
 * gefundenen `sticky|fixed`-Knoten. Beide sind Vorbedingungs-Zähler, keine Nebenausgabe: ohne
 * sie kann ein Durchlauf an der Tabelle vorbeilaufen oder gar keinen fixierten Knoten
 * vorfinden, und „0 verdeckte Ziele" wäre in beiden Fällen trivial wahr.
 */
async function pruefeFokusVerdeckung(page: Page, schritte: number): Promise<Verdeckungsbefund> {
  const verdeckt: string[] = [];
  let stoppsInTabelle = 0;
  let stoppsGesamt = 0;
  let fixierteKandidaten = 0;

  for (let i = 0; i < schritte; i += 1) {
    await page.keyboard.press('Tab');
    const schritt = await page.evaluate(() => {
      const ziel = document.activeElement;
      if (ziel == null || ziel === document.body || ziel === document.documentElement) {
        return null;
      }
      const zr = ziel.getBoundingClientRect();
      if (zr.width === 0 || zr.height === 0) {
        return { beschreibung: null, inTabelle: false, kandidaten: 0 };
      }

      const kandidaten = Array.from(document.querySelectorAll('body *')).filter((el) => {
        const stil = getComputedStyle(el);
        if (stil.position !== 'sticky' && stil.position !== 'fixed') return false;
        if (stil.visibility === 'hidden' || stil.display === 'none') return false;
        return !el.contains(ziel);
      });

      const mx = zr.x + zr.width / 2;
      const my = zr.y + zr.height / 2;
      const amPunkt = document.elementFromPoint(mx, my);
      const punktGehoertZiel = amPunkt != null && (amPunkt === ziel || ziel.contains(amPunkt));

      let beschreibung: string | null = null;
      for (const el of kandidaten) {
        const kr = el.getBoundingClientRect();
        const umschliesst =
          zr.left >= kr.left - 0.5 &&
          zr.right <= kr.right + 0.5 &&
          zr.top >= kr.top - 0.5 &&
          zr.bottom <= kr.bottom + 0.5;
        if (!umschliesst || punktGehoertZiel) continue;
        beschreibung =
          `${ziel.tagName.toLowerCase()}[${(ziel.getAttribute('aria-label') ?? ziel.textContent ?? '').trim().slice(0, 30)}] ` +
          `bei (${Math.round(zr.x)},${Math.round(zr.y)}) ${Math.round(zr.width)}×${Math.round(zr.height)} ` +
          `vollständig hinter ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ` +
          `(${getComputedStyle(el).position}); am Mittelpunkt liegt ` +
          `${amPunkt == null ? 'nichts' : `${amPunkt.tagName.toLowerCase()}.${String(amPunkt.className).slice(0, 30)}`}`;
        break;
      }
      return {
        beschreibung,
        inTabelle: ziel.closest('.ant-table') != null,
        kandidaten: kandidaten.length,
      };
    });

    if (schritt == null) continue;
    stoppsGesamt += 1;
    if (schritt.inTabelle) stoppsInTabelle += 1;
    fixierteKandidaten = Math.max(fixierteKandidaten, schritt.kandidaten);
    if (schritt.beschreibung) verdeckt.push(schritt.beschreibung);
  }

  return { verdeckt, stoppsInTabelle, stoppsGesamt, fixierteKandidaten };
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
