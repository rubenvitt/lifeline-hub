import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Gate 1 der Bedien-Leitlinie: kein waagerechter Überlauf auf den drei
 * Arbeitsbreiten (LFH-329 · B1, Abschlussschritt).
 *
 * WARUM ALS EIGENE SPEC: Die sieben Arbeitspakete von B1 messen jeweils nur
 * ihren eigenen Ausschnitt — die Rinne, die Kopfzeile, den Navigationsrahmen,
 * eine Katalogtabelle. Gate 1 ist aber eine Aussage über die ganze Seite. Ohne
 * diese Spec hätte das erste Akzeptanzkriterium des Tickets keinen Eigentümer:
 * jedes Paket wäre grün und die Seite trotzdem breiter als der Schirm.
 *
 * DIE PRÜFBREITEN stammen aus der Bedien-Leitlinie (A1, Gate 1): 1366 px
 * Führungswagen, 1024 px Führungs-Tablet, 390 px mobil.
 *
 * DIE 1-PX-TOLERANZ ist kein Aufweichen: Chromium rundet `scrollWidth` auf
 * ganze Pixel, während Layoutbreiten gebrochen sein dürfen (die Kopfzeilen-
 * Polsterung rechnet mit 46,875 px). Ohne die Toleranz meldete das Gate einen
 * Rundungsrest als Überlauf.
 *
 * BEI EINEM BRUCH nennt die Diagnose das schuldige Element mit Tag, Klassen und
 * gemessener Breite. Ein nacktes „erwartet 390, war 400" schickt den nächsten
 * Leser sonst auf die Suche.
 *
 * ─── ERWEITERUNG LFH-330 · B2 (Bündel V) ────────────────────────────────────
 *
 * Fünf Routen kommen hinzu: Personal, Kräfteübersicht, Befehle-Reiter, Personen
 * und Tiere. Alle fünf sind vom `Datensicht`-Umbau betroffen, alle fünf tragen
 * jetzt acht bis zehn Spalten, und keine stand bisher in einem Überlauf-Gate.
 *
 * SEEDING, WEIL EINE LEERE LISTE NICHT ÜBERLAUFEN KANN. Ein frisch angelegter
 * Einsatz hat 0 Kräfte, 0 Befehle, 0 Personen, 0 Tiere. Ein 390-px-Überlauftest
 * über fünf Leerzustände ist grün durch Nichtstun — er misst einen Rahmen um
 * einen Leertext. Deshalb sät `seedeUeberlaufstoff` je Modul einen Datensatz mit
 * ABSICHTLICH LANGEN Werten (etablierte Form: `kopfzeile-schmal.spec.ts:72-91`
 * prüft die Kopfzeile mit absichtlich langem Einsatznamen), und der Anker jeder
 * neuen Zeile ist der gesäte Datensatz, nicht der Seitenrahmen.
 *
 * SEEDING PER `page.request`: neues Muster in `frontend/e2e/` (0 Vorkommen
 * vorher). Die Session ist Cookie-basiert (`api/client.ts:35/46/56`
 * `credentials: 'same-origin'`, kein CSRF-Header), und `page.request` teilt den
 * Cookie-Jar des Kontexts. Über die UI wären es fünf Modale und ~25 Aktionen je
 * Lauf — ohne Erkenntnisgewinn für ein Breitengate.
 *
 * DER EINSATZNAME BLEIBT `E2E Gate1 <ts>` — bewusst OHNE Modulnamen darin: die
 * Kommandopalette durchsucht Module UND Einsätze in einer Optionsliste, ein
 * „E2E Kräfteübersicht …" ließe `command-palette.spec.ts` per strict mode flaken
 * (dokumentiert in `lagekarte-smoke.spec.ts:56-60`). Personen-, Tier- und
 * Befehlstitel stehen nicht in der Palette.
 *
 * WAS BEI 390 PX GEMESSEN WIRD, ist NICHT durchgehend eine Tabelle: `Datensicht`
 * mit `form="auto"` rendert unter `md` (768 px) Karten, `form="tabelle"` am
 * Meldebild bleibt in jeder Breite Tabelle, `form="karte"` an den Befehlen in
 * jeder Breite Karte. Der Spaltendruck der acht bis zehn Spalten wirkt also nur
 * auf 1366 und 1024 px; auf 390 px prüft die Zeile den Kartenzweig. Beides ist
 * eine Aussage über Gate 1 — aber nicht dieselbe, und die Anker sind deshalb
 * form-agnostisch (gesäter Text, kein `tr.ant-table-row`).
 *
 * MUTATIONSPROBE, protokolliert — sonst ist die Erweiterung eine Behauptung
 * (Beweisform aus `katalogtabelle-schmal.spec.ts:90-98`). Mit entferntem
 * `scroll={{ x: 'max-content' }}` in `components/KatalogTabelle.tsx:252` meldet
 * diese Datei sechs Brüche:
 *   `/einsaetze/:id/etb`             1024 px → 166 px · 390 px → 506 px
 *   `/admin/benutzer`                1024 px →  15 px · 390 px → 105 px
 *   `/einsaetze/:id/kraefteuebersicht` 1024 px →  12 px · 390 px → 352 px
 * Die NEUE Kräfteübersicht-Zeile hängt damit nachweislich am Bildlaufcontainer
 * und ist nicht durch Konstruktion grün. Auf 390 px schlägt sie zugleich über
 * ihren Freistellungs-Deckel (60 px) und wird als VERSCHLECHTERUNG gemeldet —
 * das ist der Wirknachweis für den Deckel-Zweig von {@link BESTAND_OFFEN}.
 * Zurückgedreht und byte-gleich verglichen.
 *
 * Personal, Personen und Tiere bleiben in dieser Probe stumm: auf 390 px stehen
 * dort Karten (kein Bildlaufcontainer im Spiel), und auf 1366/1024 px passen ihre
 * Spalten auch ohne ihn. Ihre Zeilen belegen also den Karten- bzw. den
 * unauffälligen Tabellenzweig, nicht den Bildlaufcontainer.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Führungswagen · Führungs-Tablet · mobil (A1, Gate 1). */
const PRUEFBREITEN = [
  { name: 'Fükw', breite: 1366, hoehe: 768 },
  { name: 'Führungs-Tablet', breite: 1024, hoehe: 768 },
  { name: 'mobil', breite: 390, hoehe: 844 },
] as const;

// Login-/Anlege-Helfer aus `kernfluss.spec.ts` kopiert — es gibt (noch) kein
// geteiltes e2e-Hilfsmodul.
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
 * GEMESSENE BESTANDS-VERSTÖSSE — die Burn-down-Liste dieses Gates.
 *
 * Die fünf neuen Zeilen haben auf 390 px drei Verstöße aufgedeckt, und alle drei sind
 * **Bestand des Seitenkopfs**, nicht Werk von LFH-330:
 *
 *  | Route              | über  | Verursacher                                                     |
 *  |--------------------|-------|-----------------------------------------------------------------|
 *  | `/personen`        | 120px | `Space` ohne `wrap` mit drei Knöpfen „Schnellerfassung",         |
 *  |                    |       | „Vermisst melden", „Betroffene/n erfassen" (`PersonenPage.tsx:138-144`) |
 *
 * BELEGT ALS BESTAND, nicht vermutet — zwei unabhängige Messungen:
 *  1. Auf dem **leeren** Einsatz (0 Personal, 0 Personen, 0 Kräfte) stehen dieselben Werte
 *     79 / 120 px. Die Verursacher sind Kopfknöpfe, die ohne jeden Datensatz rendern;
 *     der `Datensicht`-Inhalt ist unbeteiligt.
 *  2. `git diff a06cd0f..HEAD` berührt in allen drei Dateien nur Importe und Spalten — die
 *     schuldigen `Space`-Blöcke sind unverändert.
 * `/tiere` und `/auftraege` messen auf allen drei Breiten 0 px. Auf 1366 und 1024 px sind
 * alle neun Routen sauber; die verbliebenen zwei Verstöße treten ausschließlich auf 390 px auf.
 *
 * DER DRITTE EINTRAG IST WEG (LFH-338 · C3): `/kraefteuebersicht` stand hier mit 7 px,
 * verursacht von einem `Space` ohne `wrap` im Aktionen-Slot. C3 hat dem Slot einen dritten
 * Bedienknopf gegeben (den Aufklapp-Umschalter) — damit sprang der Überlauf auf 246 px und
 * das Gate schlug an, wie es soll. Der Fix ist das `wrap`, das die Freistellung ohnehin
 * gefordert hätte; gemessen steht die Route jetzt bei **0 px**, und die Totmeldung des
 * Gates hat die Streichung dieser Zeile erzwungen.
 *
 * DER ZWEITE EINTRAG IST WEG (LFH-339 · C4): `/personal` stand hier mit 79 px. C4 hat den
 * Verursacher an der Wurzel behoben — `wrap` samt `minWidth: 0` im Seitenkopf-Primitiv
 * `components/EinsatzSeite.tsx` PLUS `wrap` und ein `maxWidth` am Auswahlfeld der
 * Aktionsreihe selbst. Beides zusammen ist nötig: der Umbruch im Primitiv schiebt den
 * Aktionsblock nur unter den Titel, wo er weiterhin zu breit ist. Gemessen steht die Route
 * jetzt bei **0 px**, und die Totmeldung dieses Gates hat die Streichung erzwungen — genau
 * die Mechanik, die der Absatz darunter beschreibt.
 *
 * BEI DER GELEGENHEIT GEMESSEN, ohne hier gelistet zu sein: `/fahrzeuge` (115 px) und
 * `/material` (327 px) liefen ebenfalls über — dieselbe Ursache, nur auf Routen, die dieses
 * Gate nicht führt. Beide sind mit C4 behoben und werden seither von
 * `e2e/kraefte-schmal.spec.ts` gemessen. Wer diese Liste erweitert, nimmt sie NICHT auf:
 * eine zweite Messung derselben Zusicherung an zwei Orten veraltet an einem davon.
 *
 * WARUM FREISTELLUNG UND NICHT ROT: die verbliebene Reparatur ist `wrap` an einem fremden
 * Seitenkopf — Bestandsarbeit in `frontend/src/pages/`, die jenes Bündel nicht besaß,
 * und ein rot geborenes Gate wird abgeschaltet statt befolgt. Freigestellt wird deshalb
 * **namentlich, mit Deckel und mit Totmeldung**, nach dem Muster der `NOCH_OFFEN`-Listen der
 * Vitest-Guards:
 *  - Ein Verstoß auf einer NICHT gelisteten Route × Breite ist rot. Die Liste kann also
 *    nicht als Generalamnestie wirken.
 *  - Wächst ein gelisteter Verstoß über seinen `deckel`, ist er rot. Eine Verschlechterung
 *    fällt auf.
 *  - Ist ein gelisteter Eintrag behoben (≤ 1 px), meldet das Gate ihn als TOT und erzwingt
 *    seine Streichung. Die Liste kann nicht veralten.
 * Der `deckel` liegt bewusst über dem Messwert (Subpixel- und Schriftmetrik-Spielraum), aber
 * weit unter der nächsten Größenordnung.
 *
 * ZIELTICKET: **B5 (LFH-333)** — dort laufen die Kopf- und Bedienflächen ohnehin auf die
 * Dichte-Staffel und den `size`-Abbau; „Kopfaktionen umbrechen unter `sm`" gehört in denselben
 * Griff. Die Zeile steht in der Prüfliste `2026-07-28-einsatzlisten-pruefliste.md`.
 */
const BESTAND_OFFEN = [
  { modul: 'personen', breite: 390, deckel: 180, gemessen: 120 },
] as const;

/**
 * Ein Datensatz je neu aufgenommenem Modul, mit absichtlich langen Werten.
 *
 * Die Ad-hoc-Kraft erscheint gleich in ZWEI der neuen Zeilen: auf der Personalseite als
 * eigene Zeile und im Meldebild der Kräfteübersicht über den Sammelknoten „Ohne Abschnitt"
 * (`kraefte/kraeftebild.ts:576-620`, `hasOhne` über `ohneEinheitPersonal`). Ein zweiter
 * Datensatz dafür wäre Aufwand ohne Aussage.
 *
 * Jede Antwort wird mit Status und Text zugesichert. Ein stillschweigend fehlgeschlagenes
 * Seeding ist der direkte Weg zurück in den Leerzustand, den dieses Seeding beseitigen soll.
 */
async function seedeUeberlaufstoff(page: Page, einsatzId: string) {
  const anlegen = async (pfad: string, data: unknown, was: string) => {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  };

  await anlegen(
    'personal',
    {
      adhoc: {
        name: 'Kirchgassner-Wohlfahrt, Maximiliane',
        funktion: 'Abschnittsleitung Technische Hilfeleistung',
        traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
      },
    },
    'Personal (Personalseite + Meldebild)',
  );
  await anlegen(
    'befehle',
    { vorlage: 'befehl_lad', titel: 'Befehl an den 2. Zug zur Menschenrettung im Abschnitt Nord' },
    'Befehl',
  );
  // Status-Vorgabe bewusst weggelassen: das Backend setzt `erfasst`
  // (`src/person/repo.rs:123`), und genau darauf steht der Standardreiter der Personenseite
  // (`PersonenPage.tsx:37` `useState<Sicht>('erfasst')`). Eine Person mit anderem Status
  // fiele aus der Standardsicht und die Zeile messte wieder einen Leerzustand.
  await anlegen(
    'personen',
    {
      name: 'Oberacher-Dreiszigmark',
      vorname: 'Wolfgang-Sebastian',
      antreff_ort: 'Bahnübergang Nordwestring, Höhe Kilometer 4,7',
      notiz: 'Über die Drehleiter aus dem zweiten Obergeschoss gerettet',
    },
    'Person',
  );
  // `spezies` ist Pflicht; der Status-Default `aktiv` (`src/routes/einsatz_tier.rs:102`)
  // deckt sich mit dem Standardreiter der Tierseite (`TierePage.tsx` `useState<Sicht>('aktiv')`).
  await anlegen(
    'tiere',
    {
      spezies: 'grosstier',
      rufname: 'Donnerhall-vom-Wiesengrund',
      rasse_beschreibung: 'Süddeutsches Kaltblut, Stockmaß 163 cm',
      antreff_ort: 'Weidekoppel südlich der Bundesstraße',
    },
    'Tier',
  );
}

/**
 * Misst das Wurzelelement und benennt bei Überschreitung die Verursacher.
 *
 * WAS DIESES GATE NICHT SIEHT — und das ist seine eigentliche Grenze: jedes
 * `overflow-x: hidden` an IRGENDEINEM Vorfahren nimmt überlaufende Kinder aus
 * der Wurzelmetrik heraus. Ein geklippter Inhalt ist dann abgeschnitten und ohne
 * Bildlauf unerreichbar — und das Gate ist trotzdem grün. Gate 1 wäre also
 * erfüllbar, indem man KLIPPT statt repariert. Wer eine Rotmeldung dieses Gates
 * mit `overflow-x: hidden` „behebt", hat es nicht behoben, sondern versteckt.
 *
 * FRÜHER STAND HIER, `documentElement` werde gemessen, weil ein `body` mit
 * `overflow: hidden` den Überlauf sonst verstecke. Das ist sachlich falsch und
 * beschrieb die Lücke außerdem zu eng: `overflow` am `body` propagiert bei
 * `html: visible` auf den Viewport — `documentElement.scrollWidth` wächst dann
 * gerade NICHT, ein `body`-Klipp bliebe also ohnehin folgenlos für diese
 * Messung. Gemessen wird die Wurzel schlicht deshalb, weil die Bildlaufleiste
 * der Seite dort hängt.
 *
 * GEMESSEN AN HEAD ist das kein Verstoß: im Produktivcode gibt es kein globales
 * `overflow-x: hidden`. Die einzigen Klipp-Stellen sind `.login-seite`
 * (`LoginPage.css`, keine der vier Routen unten), zwei Ellipsen-Regeln in
 * `theme/sprache.css` und antds eigener `.ant-table-sticky-holder`. Alle vier
 * Routen messen auf allen drei Breiten 0 px Überlauf — die Wurzelbreite ist also
 * echt eingehalten und nicht bloß weggeklippt.
 *
 * Elemente in einem eigenen Bildlaufbereich sind KEIN Verstoß — genau dafür
 * trägt die Katalogtabelle ihren waagerechten Bildlauf. Deshalb steigt die
 * Diagnose an jedem Vorfahren mit eigenem `overflow-x` aus, statt dessen Kinder
 * anzuzeigen. `hidden` wird dabei von `auto`/`scroll` GETRENNT ausgewiesen:
 * beides nimmt das Element aus der Wurzelmetrik, aber nur `auto`/`scroll` gibt
 * dem Benutzer den Inhalt zurück. Ein `[GEKLIPPT]` in der Diagnose ist deshalb
 * ein Fund, kein Freispruch.
 */
async function ueberlauf(page: Page): Promise<{ ueber: number; schuldige: string[] }> {
  return page.evaluate(() => {
    const wurzel = document.documentElement;
    const ueber = wurzel.scrollWidth - wurzel.clientWidth;
    if (ueber <= 1) return { ueber, schuldige: [] };

    const grenze = wurzel.clientWidth;
    const schuldige: string[] = [];
    const bildlaufArt = (el: Element) => {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return ' [eigener Bildlauf]';
      // Klippen ist kein Bildlauf: der Inhalt ist weg, nicht erreichbar.
      if (ox === 'hidden') return ' [GEKLIPPT — Inhalt ohne Bildlauf unerreichbar]';
      return '';
    };

    // FLACH über alle Elemente, nicht als Baumabstieg: ein absolut
    // positioniertes oder aus einem Bildlaufbereich ragendes Element hat
    // Vorfahren, die selbst brav innerhalb liegen — ein Abstieg, der nur
    // überragenden Knoten folgt, findet es nie und meldet „Überlauf ohne
    // Verursacher". Genau das ist beim ersten Lauf passiert.
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const rechteck = el.getBoundingClientRect();
      if (rechteck.right <= grenze + 1) continue;
      if (rechteck.width === 0 || rechteck.height === 0) continue;
      const klassen = el.className?.toString().slice(0, 50) ?? '';
      const stil = getComputedStyle(el);
      schuldige.push(
        `${el.tagName.toLowerCase()}.${klassen} → rechts ${Math.round(rechteck.right)}px, ` +
          `breit ${Math.round(rechteck.width)}px, position ${stil.position}, overflow-x ${stil.overflowX}` +
          bildlaufArt(el),
      );
      if (schuldige.length >= 12) break;
    }
    return { ueber, schuldige };
  });
}

test('Gate 1: keine tragende Route läuft auf 1366, 1024 oder 390 px waagerecht über', async ({
  page,
}) => {
  /**
   * DREIFACHE ZEITSCHRANKE (30 s → 90 s), und zwar aus einem gemessenen Grund, nicht
   * vorsorglich: die Erweiterung hebt den Lauf von 12 auf 27 Messungen, jede mit `goto` und
   * `networkidle`. Einzeln gemessen 24–29 s — also genau AUF der 30-s-Vorgabe aus
   * `playwright.config.ts:97`. Unter `--repeat-each=5` (sechs Worker auf einem Vite-Dev-Server)
   * ist einer von acht Läufen in `waitForLoadState` in die Zeitüberschreitung gelaufen; das
   * volle Sammel-Gate fährt dieselbe Parallelität.
   *
   * `test.slow()` statt eines nackten `setTimeout(90_000)`: es ist die benannte
   * Playwright-Form dafür und bleibt an die Konfiguration gekoppelt, statt eine zweite
   * absolute Zahl in das Repo zu tragen. Die Route-Zahl zu verkleinern wäre die Alternative —
   * dann verlöre das Gate aber genau die Abdeckung, um die es hier geht.
   */
  test.slow();

  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate1 ${Date.now()}`);
  await seedeUeberlaufstoff(page, einsatzId);

  // Eine Route je Layoutfamilie: Ebene-1-Shell, Lagebild, Modulseite unter dem
  // Einsatz-Workspace, Verwaltung unter dem Admin-Layout. Die vier hängen an
  // vier verschiedenen Rahmen — eine einzelne Route belegte nur einen davon.
  //
  // JE ROUTE EIN INHALTSANKER, und zwar ein Knoten, den NUR diese Seite hat.
  // Vorher stand hier bloß `.ant-layout-content` — das ist auf JEDER Route der
  // Anwendung wahr und belegte nur, dass irgendein Rahmen steht. Das ist keine
  // theoretische Lücke: die Modulrouten laufen über `modulRegistry` mit
  // `ModulRedirect`/`ModulStub` (`src/App.tsx`), und ein Redirect auf eine leere
  // Seite misst sich überlauffrei und wäre grün gewesen. Ein Gate, das eine
  // verschwundene Seite als „kein Überlauf" liest, misst nichts.
  //
  // Die Anker sind bewusst aus den Nachbar-Specs übernommen, wo sie am
  // Handschirm bereits belegt sind — sie müssen auf ALLEN DREI Breiten stehen,
  // auch auf 390 px:
  //  - `.lfh-kennzahlen .lfh-kz` → `lage-dashboard-schmal.spec.ts`
  //  - `Inhalt …` (ETB-Schnellerfassung) → `nav-schmal.spec.ts`
  //  - `tr.ant-table-row` → `katalogtabelle-schmal.spec.ts`
  // Für `/einsaetze` gibt es keinen Nachbar-Spec; gemessen trägt die Seite auf
  // allen drei Breiten `[data-testid="einsaetze-raster"]`. NICHT genommen wurde
  // „Neuer Einsatz": der Knopf liegt auf 390 px hinter dem Kopfgriff.
  //
  // DIE FÜNF NEUEN ZEILEN (LFH-330 · B2) tragen form-agnostische Datenanker. Ein
  // `tr.ant-table-row` wäre hier FALSCH: Personal, Personen und Tiere rendern bei
  // 390 px Karten und hätten gar kein `<tr>`, die Befehlsliste in keiner Breite.
  // Der naheliegende „Reparaturgriff" wäre dann, den Anker auf
  // `.ant-layout-content` zu lockern — und der misst wieder nichts (siehe oben).
  const routen: {
    pfad: string;
    anker: (p: Page) => Locator;
    /** Läuft nach `goto` und VOR der Ankerprüfung, je Breite erneut. */
    vorbereiten?: (p: Page) => Promise<void>;
  }[] = [
    { pfad: '/einsaetze', anker: (p: Page) => p.locator('[data-testid="einsaetze-raster"]') },
    {
      pfad: `/einsaetze/${einsatzId}/lage-dashboard`,
      anker: (p: Page) => p.locator('.lfh-kennzahlen .lfh-kz').first(),
    },
    {
      pfad: `/einsaetze/${einsatzId}/etb`,
      anker: (p: Page) => p.getByPlaceholder('Inhalt …'),
    },
    { pfad: '/admin/benutzer', anker: (p: Page) => p.locator('tr.ant-table-row').first() },
    {
      pfad: `/einsaetze/${einsatzId}/personal`,
      anker: (p: Page) => p.getByText('Kirchgassner-Wohlfahrt, Maximiliane'),
    },
    {
      // DATENANKER, nicht der Kennzahlenkopf: „Gesamtstärke (F/UF/M//Ges)" steht auch
      // über einer LEEREN Tabelle, die Zeile messte dann wieder einen Leerzustand.
      // „Ohne Abschnitt" gibt es nur, wenn wirklich eine Kraft disponiert ist.
      pfad: `/einsaetze/${einsatzId}/kraefteuebersicht`,
      anker: (p: Page) => p.getByText('Ohne Abschnitt'),
    },
    {
      pfad: `/einsaetze/${einsatzId}/auftraege`,
      // `AuftraegePage.tsx:38` fährt `defaultActiveKey="auftraege"`, OHNE `forceRender`
      // und ohne URL-Param: nach `goto` ist die Befehlsliste gar nicht im Baum, und die
      // Zeile hätte stillschweigend den Aufträge-Reiter gemessen. `Tabs` fällt bei jedem
      // `goto` auf den Default zurück, der Schritt läuft also je Breite erneut.
      vorbereiten: async (p: Page) => {
        const reiter = p.getByRole('tab', { name: 'Befehle' });
        // `toHaveCount(1)` davor: antd klappt Reiter bei Enge in ein Mehr-Menü, und ein
        // Klick auf einen nicht vorhandenen Reiter wäre eine irreführende Zeitüberschreitung.
        await expect(reiter).toHaveCount(1);
        await reiter.click();
      },
      anker: (p: Page) => p.getByRole('link', { name: /Befehl an den 2\. Zug/ }),
    },
    {
      pfad: `/einsaetze/${einsatzId}/personen`,
      anker: (p: Page) => p.getByText('Oberacher-Dreiszigmark'),
    },
    {
      pfad: `/einsaetze/${einsatzId}/tiere`,
      anker: (p: Page) => p.getByText('Donnerhall-vom-Wiesengrund'),
    },
  ];

  // ALLE Kombinationen messen und gesammelt melden, nicht beim ersten Bruch
  // aussteigen: sonst verdeckt der erste Fund die übrigen elf und man behebt
  // eine Ursache, ohne zu wissen, wie viele es sind.
  const verstoesse: string[] = [];
  const messwerte: string[] = [];
  const tot: string[] = [];
  const genutzteFreistellungen = new Set<string>();
  for (const { pfad, anker, vorbereiten } of routen) {
    for (const { name, breite, hoehe } of PRUEFBREITEN) {
      await page.setViewportSize({ width: breite, height: hoehe });
      await page.goto(pfad);
      // Erst wenn der Rahmen steht, ist die Messung aussagekräftig — sonst
      // misst man eine halb gefüllte Seite und bekommt grün geschenkt.
      // `first()`, weil der Verwaltungsbereich sein eigenes Layout in die
      // Ebene-1-Shell schachtelt und dort zwei Rahmen stehen.
      await expect(page.locator('.ant-layout-content').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      // Reiter-Umschaltungen o. Ä. NACH dem Laden und VOR dem Anker: sonst prüft der
      // Anker eine Fläche, die gar nicht im Baum ist.
      if (vorbereiten) await vorbereiten(page);
      // …und erst der Anker belegt, dass die GEMEINTE Seite steht. Nach
      // `networkidle`, damit ein datenabhängiger Anker nicht gegen seinen
      // eigenen Ladevorgang antritt.
      await expect(
        anker(page),
        `${pfad} bei ${breite}px: die gemeinte Seite ist nicht gerendert`,
      ).toBeVisible();

      const { ueber, schuldige } = await ueberlauf(page);
      messwerte.push(`${pfad} @${breite}: ${ueber}px`);

      // Freistellung greift über das MODUL-SEGMENT des Pfades, nicht über den ganzen
      // Pfad: der enthält die laufende Einsatz-ID und wäre nicht schreibbar.
      const frei = BESTAND_OFFEN.find(
        (b) => pfad.endsWith(`/${b.modul}`) && b.breite === breite,
      );
      if (frei) {
        genutzteFreistellungen.add(`${frei.modul}@${frei.breite}`);
        if (ueber <= 1) {
          tot.push(
            `${pfad} bei ${breite}px ist BEHOBEN (${ueber}px) — der Eintrag in ` +
              `BESTAND_OFFEN ist tot und muss samt seiner Zeile im Kopfkommentar weg.`,
          );
        } else if (ueber > frei.deckel) {
          verstoesse.push(
            `${pfad} bei ${breite}px (${name}): ${ueber}px über — das ist mehr als der ` +
              `freigestellte Deckel ${frei.deckel}px (gemessen war ${frei.gemessen}px), also eine ` +
              `VERSCHLECHTERUNG, kein Bestand\n  ${schuldige.slice(0, 4).join('\n  ')}`,
          );
        }
        continue;
      }

      if (ueber > 1) {
        verstoesse.push(
          `${pfad} bei ${breite}px (${name}): ${ueber}px über\n  ${schuldige.slice(0, 4).join('\n  ')}`,
        );
      }
    }
  }

  // Ein Eintrag, den keine Route × Breite überhaupt getroffen hat, ist ebenso tot wie ein
  // behobener — sonst überlebt eine Freistellung das Umbenennen ihrer Route.
  for (const b of BESTAND_OFFEN) {
    if (!genutzteFreistellungen.has(`${b.modul}@${b.breite}`)) {
      tot.push(
        `BESTAND_OFFEN nennt ${b.modul}@${b.breite}px, aber diese Route × Breite wird gar ` +
          `nicht gemessen — tote Freistellung.`,
      );
    }
  }
  expect(tot, `Tote Freistellungen:\n${tot.join('\n')}`).toEqual([]);
  // Die Messwerte werden protokolliert, nicht nur die Verstöße: ein grüner Lauf ohne
  // Zahlen belegt „kein Überlauf" und lässt offen, ob überhaupt gemessen wurde. Sichtbar
  // über `--reporter=list` bzw. im HTML-Bericht (Muster `lage-dashboard-schmal.spec.ts:88-97`).
  test.info().annotations.push({ type: 'messwert', description: messwerte.join(' · ') });
  expect(verstoesse, `Gate 1 verletzt:\n${verstoesse.join('\n')}`).toEqual([]);
});
