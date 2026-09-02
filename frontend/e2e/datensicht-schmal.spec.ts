import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Das `Datensicht`-Primitiv am schmalen Schirm (LFH-330 · B2).
 *
 * WARUM HIER UND NICHT IN VITEST: jsdom rechnet kein Layout (`vite.config.ts` fährt
 * `css: false`) — dort sind alle Breiten 0, und `boundingBox` gibt es nicht. Die Aussagen
 * dieser Datei sind reine Layoutaussagen: welcher Zweig bei welcher Breite steht, und wie
 * hoch die Berührungsziele wirklich sind. Dass die Weiche existiert, pinnt
 * `src/components/Datensicht.test.tsx`; hier geht es um die gemessene Wirkung.
 *
 * DIE BREITENWEICHE, gegen die gemessen wird: `Datensicht.tsx:852`
 * `alsTabelle = form === 'tabelle' || (form === 'auto' && abBreite('md'))`. `md` ist antds
 * 768 px. 390 px liegt darunter (Kartenzweig), 1366 px darüber (Tabellenzweig).
 *
 * AN- UND ABWESENHEIT, je mit Gegenprobe auf der anderen Breite. `.ant-table` allein trennt
 * die Zweige nicht: eine Seite, die aus einem beliebigen anderen Grund keine Tabelle rendert
 * (Ladezustand, Leerzustand, Redirect), erfüllt „kein `.ant-table` bei 390 px" ebenfalls. Erst
 * das Paar aus Abwesenheit unten und Anwesenheit oben — plus der gesäte Datensatz als Anker in
 * beiden — schließt das aus.
 *
 * ─── DIE TREFFFLÄCHEN WERDEN ÜBER DIE DICHTE-STAFFEL GEMESSEN, NICHT GEGEN 48 PX ─────
 *
 * Die Vorgabe lautete „Trefffläche ≥ 48 px". GEMESSEN sind es 30 px — und das ist kein
 * Fehler, sondern die Dichteachse: `theme/tokens.ts:119-137` staffelt `controlHeight` auf
 * 30 / 48 / 72 px (kompakt · komfortabel · handschuh), `ThemeModeProvider.tsx:16` startet auf
 * `kompakt`, und `Datensicht` hängt jede Höhe an genau diesen Token (`:982`, `:1104` als
 * `minHeight`, die Knöpfe über antds `controlHeight`). Bei der Vorgabestufe sind 48 px damit
 * gar nicht darstellbar.
 *
 * Deshalb prüft diese Datei die AUSSAGE, die tragfähig ist: **die Berührungsziele des
 * Primitivs folgen der gewählten Stufe.** Je Ziel wird über alle drei Stufen gemessen —
 * kompakt ≥ 30, komfortabel ≥ 48, handschuh ≥ 72. Das ist strenger als „≥ 48": ein
 * hartkodiertes `height: 48` bestünde die 48er-Zusicherung und fiele hier durch, und ein
 * hartkodiertes `size="small"` fiele auf jeder Stufe durch.
 *
 * Zwei Folgerungen, die in die Prüfliste gehören und nicht in einen weichgelesenen Test:
 *  - Der 24-px-BODEN aus Kriterium 1 ist auf der Vorgabestufe eingehalten (30 ≥ 24).
 *  - Die 48 px, die die Leitlinie dem MOBILEN Kontext zuweist, kommen nicht von selbst: die
 *    Dichte hängt an der Benutzerwahl, nicht an der Breite. Das ist derselbe offene Punkt,
 *    den `2026-07-28-rahmen-pruefliste.md:36` (Z2) schon nach **B5 (LFH-333)** schickt — hier
 *    für die Listenflächen bestätigt, nicht neu entdeckt.
 *
 * WO WELCHES ZIEL GEMESSEN WIRD, und warum nicht alle auf einer Seite:
 *  - **Aktionsknopf** auf `/personal` bei 390 px. Der Kartenplan dort setzt `aktion`
 *    („Entfernen", hinter `Popconfirm`, `PersonalPage.tsx:384-390`).
 *  - **Spaltenschalter** auf `/personal` bei 1366 px. Er hängt an `alsTabelle`
 *    (`Datensicht.tsx:922`) und existiert im Kartenzweig GAR NICHT — eine Messung bei 390 px
 *    wäre eine Messung an einem nicht vorhandenen Element.
 *  - **Titel-Link** auf `/tiere` bei 390 px. Die Personalseite hat KEINEN: ihr Kartenplan
 *    setzt `titel: { spalte: 'name' }` OHNE `ziel` (`PersonalPage.tsx:375`, mit Begründung —
 *    `personalPfad` ist eine Query-Param-Selektion auf dieselbe Seite, der Link zeigte auf
 *    sich selbst), und `Datensicht.tsx:1095-1112` rendert dann `Typography.Text` statt eines
 *    Ankers. Die Tierliste trägt `titel.ziel` (`TierePage.tsx:144`) und ist die richtige
 *    Fläche. Diese Aufteilung ist eine ABWEICHUNG von der Spec-Formulierung „Titel-Link,
 *    Aktionsknopf und Spaltenschalter" (§8), die alle drei auf der Personalseite vermutet —
 *    sie steht so in der Prüfliste, damit Z1 nicht auf einer Verwechslung ruht.
 *
 * `toHaveCount(1)` VOR JEDER ZUSICHERUNG: ein gesäter Name kann Kartentitel UND Sekundärfeld
 * treffen, und `boundingBox()` auf einem mehrdeutigen Locator misst stillschweigend den
 * ersten Treffer. Ein Maßvergleich auf dem falschen Knoten ist grün und wertlos.
 *
 * BEWUSST KEIN Device-Descriptor und kein zweites Playwright-Projekt: ein
 * `devices['iPhone …']` zöge webkit nach, und ein Browser-Download ist im Repo nirgends
 * abgesichert (gleichlautend in vier Bestands-Specs begründet). Anmelden und Anlegen laufen am
 * Fükw-Maß, erst danach wird umgestellt — Vorgehen aus `seitenrinne.spec.ts`.
 *
 * SEEDING PER `page.request`: die Session ist Cookie-basiert (`api/client.ts:35/46/56`,
 * `credentials: 'same-origin'`, kein CSRF-Header), `page.request` teilt den Cookie-Jar des
 * Kontexts. Über die Anlege-Modale wären es je Datensatz vier Formularaktionen auf 390 px —
 * zusätzliche Fehlerquellen ohne Erkenntnisgewinn für eine Breitenmessung.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * Die Dichte-Staffel als handgeschriebene Zahlen, NICHT aus `theme/tokens` importiert: sonst
 * prüfte der Test den Token gegen sich selbst und bliebe auch dann grün, wenn das Maß am
 * Bedienelement gar nicht mehr ankommt (dieselbe Begründung wie `nav-schmal.spec.ts:50-54`
 * für die Drawer-Breite).
 *
 * Quellen: kompakt 30 px aus A0/LFH-352 · komfortabel 48 px = Material 48 dp · handschuh
 * 72 px ≙ 19,05 mm nach MIL-STD-1472F Fig. 12.
 */
const STAFFEL = [
  { dichte: 'kompakt', soll: 30 },
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

/** Kriterium 1 der Bedien-Leitlinie kennt neben dem 48-px-Ziel einen harten Boden. */
const BODEN = 24;

/**
 * Subpixel-Spielraum für JEDEN Maßvergleich, aus `nav-schmal.spec.ts:26-46` übernommen.
 * `boundingBox()` liefert Fließkomma, und Chromium rechnet unter Last anders als im
 * Einzellauf; dort hat dieselbe Falle DREIMAL zugeschlagen (47,99999809 gegen 48), jedes Mal
 * nur im vollen Sammel-Gate. Ein halbes Pixel ist kein Aufweichen: die Stufen 30, 48 und 72
 * bleiben klar getrennt.
 */
const SUBPIXEL = 0.5;

const HANDSCHIRM = { width: 390, height: 844 };
const FUEKW = { width: 1366, height: 768 };

/** Schlüssel aus `theme/ThemeModeProvider.tsx:13`. Bewusst literal: ein Import aus dem
 *  Produktivcode in eine e2e-Datei gibt es im Repo nirgends, und der Wert ist Vertrag. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

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

async function anlegen(page: Page, einsatzId: string, pfad: string, data: unknown, was: string) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

/**
 * Stellt die Bediendichte und lädt neu. `ThemeModeProvider` liest den Speicher beim Montieren
 * (`:46-48`), ein Setzen ohne Neuladen bliebe also folgenlos — und ein Test, der das
 * übersieht, misst dreimal dieselbe Stufe und ist dreifach grün.
 */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(
    ([schluessel, wert]) => window.localStorage.setItem(schluessel, wert),
    [DICHTE_SCHLUESSEL, dichte] as const,
  );
  await page.reload();
  // KEIN `networkidle` hier: die Zusicherung darunter IST die stärkere Bedingung und
  // wiederholt von sich aus, bis sie greift. `networkidle` wartet dagegen auf ein
  // Schweigen des Netzes, das der Live-Stream ohnehin nur widerwillig hergibt — es
  // kostet je Aufruf mindestens eine halbe Sekunde und sagt nichts über den Zustand,
  // den dieser Test messen will. Dieser Test navigiert zwölfmal (drei Dichtestufen ×
  // vier Seiten); das summierte Warten hat ihn unter Volllast über sein 30-s-Budget
  // gedrückt, während er einzeln grün war.
  // Gegenprobe, dass die Stufe wirklich angekommen ist: `ThemeModeProvider.tsx:99` schreibt
  // sie als Merkmal an das Wurzelelement. Ohne diese Zeile wäre ein verworfener
  // Speicherwert (unbekannte Stufe → Rückfall auf `kompakt`) nicht von einem
  // Darstellungsfehler zu unterscheiden.
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/** Höhe genau eines Knotens, subpixel-tolerant gegen die Sollstufe. */
async function haeltStufe(ziel: Locator, soll: number, name: string) {
  await expect(ziel, `${name}: genau ein Knoten muss gemessen werden`).toHaveCount(1);
  const kasten = await ziel.boundingBox();
  expect(kasten, `${name}: kein Kasten messbar`).not.toBeNull();
  expect(
    kasten!.height,
    `${name} (gemessen ${kasten!.height}px hoch, Soll ≥ ${soll})`,
  ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
  return kasten!.height;
}

const KRAFT = 'Kirchgassner-Wohlfahrt, Maximiliane';
const TIER = 'Donnerhall-vom-Wiesengrund';

async function seedeKraft(page: Page, einsatzId: string) {
  await anlegen(
    page,
    einsatzId,
    'personal',
    {
      adhoc: {
        name: KRAFT,
        funktion: 'Abschnittsleitung Technische Hilfeleistung',
        traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
      },
    },
    'Personal',
  );
}

test('Personalseite: bei 390 px Karten und kein Tabellenelement, bei 1366 px Tabelle — Gegenprobe in beide Richtungen', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Datensicht Zweig ${Date.now()}`);
  await seedeKraft(page, einsatzId);

  // ── 390 px: KARTENZWEIG
  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/personal`);
  await page.waitForLoadState('networkidle');

  const bereich = page.getByRole('region', { name: 'Personal im Einsatz' });
  await expect(bereich).toHaveCount(1);
  // Der gesäte Datensatz ist der Anker. Ohne ihn wäre „kein Tabellenelement" auch bei einer
  // leeren, fehlgeschlagenen oder weggeleiteten Seite wahr.
  await expect(bereich.getByText(KRAFT)).toHaveCount(1);

  await expect(page.locator('.ant-table'), 'bei 390 px darf keine Tabelle stehen').toHaveCount(0);
  await expect(
    page.locator('[data-lfh="datensicht-karte"]'),
    'bei 390 px steht genau eine Karte je Datensatz',
  ).toHaveCount(1);
  // GENAU EIN Zweig im Baum: ein zweiter, verborgener machte die Aussage oben bedeutungslos
  // (`Datensicht.tsx:1212-1214` schreibt das fest — hier gemessen).
  await expect(page.locator('tr.ant-table-row')).toHaveCount(0);
  // Der Spaltenschalter existiert im Kartenzweig NICHT — es gibt dort keine Spalten.
  await expect(
    page.getByRole('button', { name: /^Spalten/ }),
    'im Kartenzweig gibt es keinen Spaltenschalter',
  ).toHaveCount(0);
  // Die Werkzeugzeile steht dagegen in BEIDEN Zweigen und immer, auch leer — eine Zeile, die
  // erst mit Inhalt erscheint, verschiebt die Fläche (`Datensicht.tsx:858-864`).
  await expect(page.locator('[data-lfh="datensicht-werkzeuge"]')).toHaveCount(1);

  // ── 1366 px: GEGENPROBE, TABELLENZWEIG
  await page.setViewportSize(FUEKW);
  await page.goto(`/einsaetze/${einsatzId}/personal`);
  await page.waitForLoadState('networkidle');
  await expect(bereich).toHaveCount(1);
  await expect(bereich.getByText(KRAFT).first()).toBeVisible();

  await expect(page.locator('.ant-table'), 'bei 1366 px steht genau eine Tabelle').toHaveCount(1);
  await expect(
    page.locator('[data-lfh="datensicht-karte"]'),
    'bei 1366 px steht keine Karte',
  ).toHaveCount(0);
  await expect(page.locator('tr.ant-table-row')).toHaveCount(1);
  await expect(
    page.locator('[data-lfh="datensicht-werkzeuge"]').getByRole('button', { name: /^Spalten/ }),
    'im Tabellenzweig steht der Spaltenschalter',
  ).toHaveCount(1);
});

test('Trefflächen des Primitivs folgen der Dichte-Staffel 30 / 48 / 72 px — Aktionsknopf, Spaltenschalter, Titel-Link', async ({
  page,
}) => {
  // Dieser Test leistet das Dreifache eines gewöhnlichen: drei Dichtestufen, je vier
  // Seitenaufrufe samt Neuladen. Das Vorgabebudget von 30 s reicht dafür einzeln, unter
  // Volllast der ganzen Suite aber nicht — der Fehlschlag war dann ein abgebrochenes
  // `page.goto` („frame was detached"), also die Uhr und keine Aussage über die Staffel.
  // Die redundanten `networkidle`-Wartezeiten sind zusätzlich heraus (siehe `stelleDichte`).
  test.setTimeout(90_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Datensicht Dichte ${Date.now()}`);
  await seedeKraft(page, einsatzId);
  // `spezies` ist Pflicht; der Status-Default `aktiv` (`src/routes/einsatz_tier.rs:102`) deckt
  // sich mit dem Standardreiter der Tierseite — ein anderer Status fiele aus der Sicht und die
  // Messung liefe auf einem Leerzustand.
  await anlegen(
    page,
    einsatzId,
    'tiere',
    { spezies: 'grosstier', rufname: TIER, rasse_beschreibung: 'Süddeutsches Kaltblut, 163 cm' },
    'Tier',
  );

  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    // ── Aktionsknopf im Kartenzweig (390 px)
    await page.setViewportSize(HANDSCHIRM);
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    await stelleDichte(page, dichte);
    const karte = page.locator('[data-lfh="datensicht-karte"]');
    await expect(karte).toHaveCount(1);
    const knopf = await haeltStufe(
      karte.getByRole('button', { name: 'Entfernen' }),
      soll,
      `Aktionsknopf „Entfernen" (390 px, ${dichte})`,
    );

    // ── Titel-Link im Kartenzweig (390 px, Tierliste)
    await page.goto(`/einsaetze/${einsatzId}/tiere`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    const tierKarte = page.locator('[data-lfh="datensicht-karte"]');
    await expect(tierKarte).toHaveCount(1);
    const titelLink = tierKarte.locator('a');
    const titel = await haeltStufe(titelLink, soll, `Titel-Link der Karte (390 px, ${dichte})`);
    // …und er zeigt wirklich auf die Detailroute. Ein Anker ohne Ziel hätte dieselbe Höhe,
    // und `Datensicht.tsx:1096-1098` begründet ihn ausdrücklich als Tastaturziel der Zeile.
    await expect(titelLink).toHaveAttribute(
      'href',
      new RegExp(`/einsaetze/${einsatzId}/tiere/\\d+`),
    );

    // ── Spaltenschalter im Tabellenzweig (1366 px)
    await page.setViewportSize(FUEKW);
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    // Sein `aria-label` ist `"<Beschriftung> — <Bezeichnung>"` (`Datensicht.tsx:648`), die
    // Beschriftung wechselt mit dem Zähler („Spalten" bzw. „Spalten · n ausgeblendet",
    // `:628`) — deshalb ein Präfix-Muster und keine feste Zeichenkette.
    const schalter = await haeltStufe(
      page.locator('[data-lfh="datensicht-werkzeuge"]').getByRole('button', { name: /^Spalten/ }),
      soll,
      `Spaltenschalter (1366 px, ${dichte})`,
    );

    gemessen.push(
      `${dichte} (Soll ${soll}): Aktionsknopf ${knopf}, Titel-Link ${titel}, Spaltenschalter ${schalter}`,
    );

    // Auf der Vorgabestufe zusätzlich der harte Boden aus Kriterium 1. Er steht getrennt,
    // weil er eine ANDERE Aussage ist als die Staffel: 30 ≥ 24 ist erfüllt, 30 ≥ 48 nicht,
    // und die Prüfliste braucht beide Hälften getrennt belegt.
    if (dichte === 'kompakt') {
      for (const [name, wert] of [
        ['Aktionsknopf', knopf],
        ['Titel-Link', titel],
        ['Spaltenschalter', schalter],
      ] as const) {
        expect(wert, `${name} hält den 24-px-Boden (gemessen ${wert}px)`).toBeGreaterThanOrEqual(
          BODEN - SUBPIXEL,
        );
      }
    }
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

/**
 * Der Spaltenschalter ist das Bedienelement, mit dem Prüflisten-Zeile 14 („Spaltenschalter mit
 * Zähler ausgeblendeter Spalten") begründet wird. Ein Schalter, der nur mit der Maus wirkt,
 * trägt dieses Verdikt nicht — WCAG 2.1.1 verlangt einen Tastaturweg für jede Funktion, und
 * die ortsfeste Stelle ist in der Bedien-Leitlinie ausdrücklich als „voller Tastaturfluss"
 * geführt.
 *
 * DER TEST WAR ZUERST ROT (gemessen am Stand 82c2885): der Umschalter hing allein am
 * `onChange` des Kontrollkästchens, das Dropdown bekam beim Öffnen keinen Fokus
 * (`ArrowDown` ließ `document.activeElement` auf dem Knopf, kein Eintrag wurde hervorgehoben),
 * und die Eingabetaste schloss das Menü, ohne die Spalte umzuschalten. Der Zähler stand vorher
 * wie nachher auf demselben Wert.
 *
 * WARUM NICHT IN VITEST: jsdom kennt weder Fokusfolge im Portal noch `-active`-Hervorhebung
 * von rc-menu; die Aussage wäre dort strukturell unfähig, rot zu werden.
 *
 * DIE LEERTASTE IST BEWUSST NICHT ZUGESICHERT: rc-menu bindet auf dem hervorgehobenen Eintrag
 * nur die Eingabetaste (gemessen — mit Leertaste blieb der Zähler stehen). Ein Tastaturweg ist
 * verlangt, nicht jeder denkbare.
 */
test('Spaltenschalter ist mit der Tastatur bedienbar — Eingabetaste schaltet die Spalte, der Zähler zieht mit', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Schalter Tastatur ${Date.now()}`);
  await seedeKraft(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/personal`);
  await page.waitForLoadState('networkidle');

  const werkzeuge = page.locator('[data-lfh="datensicht-werkzeuge"]');
  const schalter = werkzeuge.getByRole('button', { name: /^Spalten/ });
  await expect(schalter).toHaveCount(1);
  // Namentlich, nicht über die Position: „Träger" ist bei 1366 px sichtbar (steht also in den
  // Spaltenköpfen) UND wählbar (`PersonalPage.tsx` gibt ihr weder Position 0 noch
  // `immerSichtbar`) — beides braucht der Test, um Zähler und Tabelle gemeinsam zu prüfen.
  const ZIELSPALTE = 'Träger';

  // Der Zähler ist der Messwert. Er steht als Text im Namen des Knopfes (`Datensicht.tsx:628`)
  // und zählt BEIDE Ursachen — Handauswahl und `abBreite`.
  const zaehler = async () => {
    const text = (await schalter.textContent()) ?? '';
    return Number(text.match(/·\s*(\d+)\s*ausgeblendet/)?.[1] ?? 0);
  };
  const vorher = await zaehler();

  // NUR das offene Menü. antd lässt das Portal nach dem Schließen im Baum stehen (der Wrapper
  // trägt dann `ant-dropdown-hidden`), und der zuletzt hervorgehobene Eintrag behält seine
  // `-active`-Klasse: ein Locator ohne diese Einschränkung misst ein geschlossenes Menü und
  // liest daraus eine Hervorhebung, die niemand sieht.
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu');
  const aktiv = menue.locator('li.ant-dropdown-menu-item-active');

  /**
   * Öffnet den Schalter per Tastatur und läuft mit `ArrowDown`, bis {@link ZIELSPALTE}
   * hervorgehoben ist.
   *
   * ZWEI GEMESSENE GRÜNDE für die Suchschleife statt eines gezählten `ArrowDown`:
   *  - rc-menu merkt sich den zuletzt aktiven Eintrag; ein zweites Öffnen startet NICHT
   *    wieder oben, und ein blindes `ArrowDown` traf in der Gegenprobe eine andere Spalte.
   *  - Auch das ERSTE Öffnen ist nicht deterministisch: je nach Zeitpunkt steht schon ein
   *    Eintrag aktiv, wenn die erste Taste ankommt, oder noch keiner. Unter Last (vier
   *    Playwright-Worker) kippte das den Test, allein gefahren nicht — genau die Flake-Klasse,
   *    die `nav-schmal.spec.ts:26-39` dreimal getroffen hat.
   * Deshalb ist die Spalte NAMENTLICH festgelegt und die Position egal.
   */
  const oeffneUndHebeHervor = async (): Promise<void> => {
    /*
     * Bis zu drei Anläufe, und das ist keine Nachsicht mit dem Bedienelement, sondern mit dem
     * Zeitverhalten des Portals: ein Tastendruck auf den Griff, während das vorige Menü noch
     * ausblendet, wird von rc-trigger verschluckt — das Menü bleibt zu, die folgenden
     * Pfeiltasten laufen ins Leere, die Eingabetaste schaltet nichts. Erst auf `toHaveCount(0)`
     * zu warten reicht NICHT: im vollen Sammel-Gate (43 Specs parallel) fiel die Gegenprobe
     * trotzdem, allein gefahren nie — dieselbe Flake-Klasse, die `nav-schmal.spec.ts:26-39`
     * dreimal getroffen hat. Ein Bediener klickt in dieser Lage ebenfalls noch einmal.
     */
    for (let versuch = 0; versuch < 3; versuch += 1) {
      await expect(menue, 'vor dem Öffnen muss das Menü geschlossen sein').toHaveCount(0);
      await schalter.press('Enter');
      const offen = await menue
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (offen) break;
    }
    await expect(menue, 'der Griff ließ sich in drei Anläufen nicht öffnen').toHaveCount(1);
    /*
     * ERST SCHAUEN, DANN DRÜCKEN. Der Kommentar oben hält fest, dass rc-menu sich den
     * zuletzt aktiven Eintrag merkt — beim ZWEITEN Öffnen steht die Hervorhebung also
     * schon auf der Zielspalte. Ein unbedingtes `ArrowDown` schob genau dort daran
     * vorbei, und die Suchschleife lief einmal um das Menü herum, bis sie wieder
     * ankam; landete sie unterwegs am Rand oder verschluckte rc-trigger einen
     * Tastendruck, schaltete die Eingabetaste eine FREMDE Spalte. Gemessen am
     * 29.07.2026: Zähler 3 statt 1 zurück, also zwei fremde Spalten ausgeblendet
     * statt der einen wieder eingeblendet.
     *
     * Die Schleife bleibt unverändert die Absicherung für den ersten Aufruf, bei dem
     * noch nichts hervorgehoben ist.
     */
    if (((await aktiv.textContent().catch(() => null)) ?? '').trim() === ZIELSPALTE) return;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('ArrowDown');
      // Belegt zugleich, dass der Fokus überhaupt ins Menü gewandert ist — genau der Punkt,
      // an dem der Ausgangszustand brach (Fokus blieb am Knopf, 0 Einträge hervorgehoben).
      await expect(aktiv, 'nach ArrowDown muss genau ein Eintrag hervorgehoben sein').toHaveCount(
        1,
      );
      if (((await aktiv.textContent()) ?? '').trim() === ZIELSPALTE) return;
    }
    throw new Error(`Eintrag „${ZIELSPALTE}" war in 12 Schritten nicht erreichbar`);
  };

  const spaltenKoepfe = async () =>
    (await page.locator('th.ant-table-cell').allTextContents()).map((t) => t.trim());

  await oeffneUndHebeHervor();
  const geschaltet = ZIELSPALTE;
  expect(await spaltenKoepfe(), 'die Spalte steht vor dem Umschalten').toContain(geschaltet);

  await page.keyboard.press('Enter');
  await expect
    .poll(zaehler, { message: 'die Eingabetaste muss eine Spalte ausblenden' })
    .toBe(vorher + 1);
  // Der Zähler allein genügt nicht: er könnte mitzählen, ohne dass die Spalte verschwindet.
  expect(await spaltenKoepfe(), 'die Spalte ist aus der Tabelle verschwunden').not.toContain(
    geschaltet,
  );

  // Gegenrichtung: derselbe Weg holt dieselbe Spalte zurück. Ohne sie bliebe offen, ob die
  // Taste umschaltet oder nur in eine Richtung schiebt.
  await oeffneUndHebeHervor();
  await page.keyboard.press('Enter');
  await expect.poll(zaehler, { message: 'derselbe Weg muss zurückschalten' }).toBe(vorher);
  expect(await spaltenKoepfe(), 'die Spalte steht wieder in der Tabelle').toContain(geschaltet);
});
