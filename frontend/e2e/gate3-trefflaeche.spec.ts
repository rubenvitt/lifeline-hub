import { expect, test, type Locator, type Page } from '@playwright/test';
import { detailBereit, einheitMitZuordnungen, kopfFelder, zuordnungsKarte } from './einheit-fixture';

/**
 * Gate 3 der Bedien-Leitlinie: Lage-Dashboard und Einsatzauswahl (LFH-396, Nachzug zur
 * Prüfliste von LFH-336 · C1, Kriterium 2), die Einheiten-Detailroute (LFH-446,
 * Nachzug zu LFH-339 · Kriterium 2), der Einsatz-NAVIGATIONSRAHMEN (LFH-516,
 * Nachzug zu LFH-337 · C2, Kriterium 2) sowie Kräfteübersicht und Verdichtungszeile
 * (LFH-515, Nachzug zu LFH-338 · C3, Kriterium 2).
 *
 * DIE DATEI TRÄGT VIER ROUTEN, DEN NAVIGATIONSRAHMEN UND EINEN SATZ HELFER. Das ist die
 * Gestalt, die der LFH-446-Plan ausdrücklich vorsah („vorhandene STAFFEL, stelleDichte,
 * haeltStufe und alleHaltenStufe aus gate3-trefflaeche.spec.ts verwenden") — die
 * Einheiten-Tests entstanden nur deshalb mit eigenen Kopien dieser Helfer, weil ihr Branch
 * die LFH-396-Fassung noch nicht hatte. Beim Zusammenführen (LFH-457, 06.09.2026) waren
 * `anmelden`, `stelleDichte` und `haeltStufe` auf beiden Seiten BYTE-GLEICH; geblieben
 * ist je eine Fassung. Der Navigationsrahmen (LFH-516, 11.09.2026) ist der erste Zugang,
 * der KEINE Route ist — er steht auf jeder Einsatzroute — und hat die Einladung
 * „wer hier etwas anhängt, nimmt dieselben Helfer" eingelöst, statt eine vierte Kopie
 * von `anmelden`/`stelleDichte`/`haeltStufe` anzulegen; Kräfteübersicht und
 * Verdichtungszeile (LFH-515, 11.09.2026) sind derselben Einladung gefolgt. Die beiden
 * Nachzüge entstanden am selben Tag auf getrennten Branches und trafen sich hier im
 * Rebase — jeder trägt seinen eigenen Block am Dateiende, die Helfer sind geteilt.
 *
 * WARUM HIER UND NICHT IN VITEST: `vite.config.ts` fährt Vitest mit `css: false`, und
 * jsdom rechnet kein Layout. Belegt war für beide Routen bisher nur, dass die Ziele ihre
 * Höhe aus `var(--lfh-zeilenhoehe)` LESEN (`LageDashboardPage.test.tsx`, Quellpin auf
 * `sprache.css`) — nicht, dass sie sie im Betrieb ERREICHEN. Ein `min-height`, das eine
 * Kaskadenregel weiter unten überschreibt, ein `display: inline`, das die Mindesthöhe
 * ignoriert, oder ein Wrapper, der die Staffel nicht durchreicht, wären dort alle grün.
 * Hier steht die gemessene `boundingBox()`.
 *
 * ── WAS GEMESSEN WIRD (die fünf Ziele aus dem Ticket) ─────────────────────────────
 *
 *  Lage-Dashboard (`/einsaetze/:id/lage-dashboard`):
 *   - `a.lfh-zeile`         die Kurzlisten-Zeilen (Meldung + Auftrag, je eine gesät)
 *   - `button.lfh-kz`       die sechs Kennzahl-Knöpfe
 *   - `.lfh-kachel__mehr`   der „Mehr"-Ausgang jeder Kachel
 *  Einsatzauswahl (`/einsaetze`):
 *   - der Titel-Link der Einsatzkarte (das Tastaturziel der Karte)
 *   - das Suchfeld samt Such-Knopf — es erscheint erst ab `SUCHE_AB = 8` aktiven
 *     Einsätzen (`EinsaetzePage.tsx`), deshalb sät der Test acht.
 *
 * MENGEN STATT EINZELKNOTEN. `datensicht-schmal.spec.ts` verlangt `toHaveCount(1)` vor jeder
 * Messung; hier ist das für Zeilen, Kennzahlen und Mehr-Knöpfe nicht die richtige Aussage —
 * sie stehen bewusst mehrfach, und jeder Einzelne muss den Boden halten. `alleHaltenStufe`
 * verlangt deshalb eine MINDESTZAHL (die gesäte, nicht null) und misst dann jeden Knoten;
 * ein leerer Locator wäre sonst grün durch Nichtstun. Der Titel-Link und das Suchfeld sind
 * dagegen echte Einzelknoten und laufen über `haeltStufe` mit `toHaveCount(1)`.
 *
 * UNTERGRENZE, KEINE GLEICHHEIT (Ticket): Polsterung und Zeilenumbruch dürfen ein Ziel
 * größer machen — die Kennzahl trägt Etikett + Zahl + Zusatz und misst in jeder Stufe weit
 * über dem Boden —, nur nicht kleiner.
 *
 * DIE BÖDEN STEHEN ALS LITERALE (30 / 48 / 72), nicht aus `theme/tokens` gelesen — sonst
 * prüfte der Test den Token gegen sich selbst (LFH-365, dort gemessen). Quellen wie in
 * `datensicht-schmal.spec.ts`: kompakt 30 px aus A0/LFH-352 · komfortabel 48 px = Material
 * 48 dp · handschuh 72 px ≙ 19,05 mm nach MIL-STD-1472F Fig. 12.
 *
 * MUTATIONSPROBE (Akzeptanzkriterium), am 05.09.2026 mit zwei temporären Kopien gefahren:
 *  - `localStorage` in `stelleDichte` auf `'kompakt'` festgenagelt, Staffel nur `handschuh`:
 *    beide Tests rot an der `data-dichte`-Wache („Expected handschuh, Received kompakt"),
 *    noch VOR jeder Höhenmessung.
 *  - dieselbe Mutation, zusätzlich die Wache entfernt: rot an der ERSTEN Höhenmessung —
 *    Dashboard „Kurzlisten-Zeile #1 gemessen 30px, Soll ≥ 72", Einsatzauswahl „Titel-Link
 *    gemessen 39,47px, Soll ≥ 72". Der Spec misst also die Staffel, nicht sich selbst.
 *
 * DER BEFUND, den der erste Lauf lieferte: der Titel-Link der Einsatzkarte maß 17 px in JEDER
 * Stufe — ein nacktes Inline-`<a>` im Kartenkopf, unter dem 24-px-Boden schon in `kompakt`.
 * Die Prüfliste von LFH-336 hatte für Kriterium 1 „Card-Link erbt die Steuerhöhe vom
 * ConfigProvider" geschrieben; das war eine Annahme, keine Messung. Behoben über
 * `kartenTitelStil` in `EinsaetzePage.tsx` (zwei Angaben nach LFH-365). Messwerte danach:
 *  - Dashboard: Zeile 30 / 48 / 72 · Kennzahl 81,9 / 99,9 / 119,9 · Mehr 30 / 48 / 72
 *  - Einsatzauswahl: Titel-Link 39,5 / 49,6 / 72 · Suchfeld 30,1 / 48 / 72 · Such-Knopf 30 / 48 / 72
 *
 * WARUM NICHT IN `dichte.spec.ts` ODER `trefflaeche-tablet.spec.ts`: die eine grenzt sich
 * wörtlich gegen Routen-Geometrie ab und meldet nicht an, die andere braucht `hasTouch` auf
 * Dateiebene für ihre Tablet-Vorbelegung — hier wird die Stufe ausdrücklich GESPEICHERT
 * gestellt, damit alle drei Stufen auf demselben Kontext laufen.
 *
 * BEWUSST KEIN Device-Descriptor und kein zweites Playwright-Projekt (Browser-Download ohne
 * Guard, gleichlautend in den Bestands-Specs begründet). Seeding per `page.request`: die
 * Session ist Cookie-basiert und `page.request` teilt den Cookie-Jar des Kontexts
 * (`gate1-ueberlauf.spec.ts`).
 *
 * DIE EINSATZNAMEN tragen keinen Modulnamen (`E2E Gate3 <ts> Nr <n>`): die Kommandopalette
 * durchsucht Module UND Einsätze in einer Liste, ein Modulwort im Namen ließe
 * `command-palette.spec.ts` per strict mode flaken (`lagekarte-smoke.spec.ts:56-60`).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Die Dichte-Staffel als handgeschriebene Zahlen — siehe Kopfkommentar. */
const STAFFEL = [
  { dichte: 'kompakt', soll: 30 },
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

/**
 * Subpixel-Spielraum wie in `datensicht-schmal.spec.ts:96-104`: `boundingBox()` liefert
 * Fließkomma, und Chromium rundet unter Last anders als im Einzellauf (dort dreimal
 * 47,99999809 gegen 48 gemessen). Ein halbes Pixel trennt die Stufen weiterhin klar.
 */
const SUBPIXEL = 0.5;

/** Fükw-Maß aus der Bedien-Leitlinie (A1, Gate 1). Beide Routen sind Fükw-Routen. */
const FUEKW = { width: 1366, height: 768 };

/** Handschirm-Maß aus A1 (mobil, einhändig) — unter antds `lg`, also der Drawer-Zweig
 *  des Navigationsrahmens (`nav-schmal.spec.ts:48` nimmt dieselben Zahlen). */
const HANDSCHIRM = { width: 390, height: 844 };

/**
 * Die Böden JE ZIEL des Navigationsrahmens (LFH-516) — handgeschriebene Literale wie
 * {@link STAFFEL}, aus demselben Grund: aus dem Token zurückgelesen prüfte die Zusicherung
 * den Token gegen sich selbst.
 *
 * Warum nicht eine Zahlenreihe für alles: der Rahmen trägt VIER verschiedene Verträge, und
 * jeder steht an seiner Fundstelle:
 *
 *  - `staffel` (30/48/72) — was nur `token.controlHeight` liest: Modul-Panel-Zeilen
 *    (`ModulPanel.modulZeilenStil`), Palettenzeilen (`command-palette/zeilenStil.ts`),
 *    die Kopfzeilen-Ziele aus `AppLayout`/`EinsatzLayout` und der Suchzugang ab `lg`.
 *  - `mitA1Boden` (48/48/72) — `Math.max(48, controlHeight)`: die Kategorie-Rail
 *    (`IconRail.railZielStil`), der Hamburger (`EinsatzLayout.tsx:319-320`), der
 *    Suchzugang unter `lg` (`CommandPaletteTrigger.tsx:25`) und die Modulzeilen IM
 *    Drawer (`mindestTrefflaeche={48}`). Die 48 ist dort BODEN unter der Staffel, nicht
 *    ihr Ersatz — deshalb muss `kompakt` hier ≥ 48 messen und nicht ≥ 30.
 *  - `benutzermenue` (40/48/72) — `Math.max(40, controlHeight)` (`BenutzerMenu.tsx:188`,
 *    LFH-460). Ein dritter Boden, weil der Auslöser einen 28-px-Avatar trägt; er steht
 *    hier als eigene Zeile, damit `kompakt` nicht stillschweigend auf 30 geprüft wird
 *    und die 40 damit unbelegt bliebe.
 *  - `fest48` (48/48/48) — die zwei bewusst FESTEN 48er des Drawer-Zweigs, siehe den
 *    Abschnitt „Der Drawer" weiter unten.
 *
 * ALLE VIER sind UNTERGRENZEN (wie im Kopfkommentar für die Routen begründet): Polsterung
 * und Zeilenumbruch dürfen ein Ziel größer machen. `fest48` zementiert die Ausnahme also
 * nicht — hübe jemand den Akkordeon-Kopf auf die Staffel, bliebe diese Zeile grün.
 */
const BODEN = {
  staffel: { kompakt: 30, komfortabel: 48, handschuh: 72 },
  mitA1Boden: { kompakt: 48, komfortabel: 48, handschuh: 72 },
  benutzermenue: { kompakt: 40, komfortabel: 48, handschuh: 72 },
  fest48: { kompakt: 48, komfortabel: 48, handschuh: 48 },
} as const;

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — Vertrag, kein Import. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/** `SUCHE_AB` aus `EinsaetzePage.tsx`, als Literal: fällt die Schwelle dort, sät der
 *  Test zu wenige Einsätze, das Suchfeld fehlt, und `toHaveCount(1)` sagt es laut. */
const SUCHE_AB = 8;

// Login-Helfer aus `kernfluss.spec.ts` kopiert — es gibt (noch) kein geteiltes
// e2e-Hilfsmodul (gleichlautend in den Bestands-Specs vermerkt).
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/**
 * Einsatz per API statt über das Anlege-Modal: acht Einsätze über die UI wären 32
 * Formularaktionen ohne Erkenntnisgewinn für eine Höhenmessung. `POST /api/einsaetze`
 * antwortet mit der `EinsatzAnzeige` samt `id` (`src/routes/einsatz.rs`).
 */
async function einsatzAnlegen(page: Page, bezeichnung: string): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(
    antwort.ok(),
    `Seeding Einsatz „${bezeichnung}": ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
  const { id } = (await antwort.json()) as { id: number };
  return String(id);
}

async function anlegen(page: Page, einsatzId: string, pfad: string, data: unknown, was: string) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

/**
 * Stellt die Bediendichte und lädt neu. `ThemeModeProvider` liest den Speicher beim
 * Montieren; ohne Neuladen bliebe das Setzen folgenlos und der Test misst dreimal dieselbe
 * Stufe. Die `data-dichte`-Wache ist die erste Zusicherung: sie trennt „Ziel zu klein" von
 * „Stufe gar nicht angekommen" (Muster aus `datensicht-schmal.spec.ts:139-157`).
 */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/** Höhe GENAU EINES Knotens, subpixel-tolerant gegen die Sollstufe (Untergrenze). */
async function haeltStufe(ziel: Locator, soll: number, name: string): Promise<number> {
  await expect(ziel, `${name}: genau ein Knoten muss gemessen werden`).toHaveCount(1);
  const kasten = await ziel.boundingBox();
  expect(kasten, `${name}: kein Kasten messbar`).not.toBeNull();
  expect(
    kasten!.height,
    `${name} (gemessen ${kasten!.height}px hoch, Soll ≥ ${soll})`,
  ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
  return kasten!.height;
}

/**
 * Höhe JEDES Knotens einer Menge. `mindestens` ist die Zahl, die das Seeding garantiert —
 * ein Locator, der weniger trifft, misst einen Leer- oder Ladezustand, und das ist ein
 * Fehler, keine grüne Zeile. Zurück kommt das kleinste Maß, damit die Anmerkung am Test
 * den knappsten Wert nennt.
 */
async function alleHaltenStufe(
  ziele: Locator,
  soll: number,
  name: string,
  mindestens: number,
): Promise<number> {
  const anzahl = await ziele.count();
  expect(anzahl, `${name}: mindestens ${mindestens} Knoten erwartet`).toBeGreaterThanOrEqual(
    mindestens,
  );
  let kleinstes = Number.POSITIVE_INFINITY;
  for (let i = 0; i < anzahl; i += 1) {
    const kasten = await ziele.nth(i).boundingBox();
    expect(kasten, `${name} #${i + 1}: kein Kasten messbar`).not.toBeNull();
    expect(
      kasten!.height,
      `${name} #${i + 1} (gemessen ${kasten!.height}px hoch, Soll ≥ ${soll})`,
    ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
    kleinstes = Math.min(kleinstes, kasten!.height);
  }
  return kleinstes;
}

/**
 * Zeitstempel im Wire-Format `YYYY-MM-DD HH:MM:SS` (UTC). Die Meldungsroute nimmt auch
 * RFC 3339 (`etb::normalisiere_zeit`), die Auftragsroute NICHT: `auftrag/eingabe.rs`
 * `parse_zeit` kennt nur `%Y-%m-%d %H:%M(:%S)` — ein `toISOString()` mit Millisekunden und
 * `Z` war dort gemessen „400 Ungültiger Zeitpunkt". Ein Format für beide.
 */
function wireZeit(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const MELDUNG = 'Wasserversorgung über Hydrant Nordring 14 hergestellt';
const AUFTRAG = 'Menschenrettung im zweiten Obergeschoss über die Drehleiter fortsetzen';

test('Lage-Dashboard: Kurzlisten-Zeile, Kennzahl-Knopf und Mehr-Knopf folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  // Drei Stufen mit je einem Neuladen — einzeln reicht das Vorgabebudget, unter Volllast
  // der Suite nicht (Begründung wie `datensicht-schmal.spec.ts:264-269`).
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Lage`);

  // Je eine offene Meldung und ein offener Auftrag: ohne sie rendert das Dashboard keine
  // einzige `a.lfh-zeile`, und die Zeilenmessung liefe auf einem Leerzustand.
  // `meldungszeilen` filtert auf `ist_offen`, `auftragszeilen` auf „nicht vollzogen /
  // abgenommen" (`lagebild.ts`) — beides ist der Anlage-Default.
  await anlegen(
    page,
    einsatzId,
    'meldungen',
    {
      absender: 'Florian Musterstadt 1/44-1',
      meldeweg: 'funk',
      inhalt: MELDUNG,
      ereigniszeit: wireZeit(new Date()),
    },
    'Meldung',
  );
  await anlegen(
    page,
    einsatzId,
    'auftraege',
    {
      auftrag_text: AUFTRAG,
      frist_at: wireZeit(new Date(Date.now() + 60 * 60 * 1000)),
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'Abschnittsleitung Nord' }],
    },
    'Auftrag',
  );

  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
    await stelleDichte(page, dichte);

    // Anker: die Daten sind da. Vor dem Einsatz-Abruf stellt die Leiste sechs `div.lfh-kz`
    // als Platzhalter (kein Knopf); gemessen wird der KNOPF, also erst nach dem Laden.
    const kennzahlen = page.locator('.lfh-kennzahlen button.lfh-kz');
    await expect(kennzahlen).toHaveCount(6);
    const zeilen = page.locator('a.lfh-zeile');
    await expect(zeilen.filter({ hasText: MELDUNG })).toHaveCount(1);
    await expect(zeilen.filter({ hasText: AUFTRAG })).toHaveCount(1);

    const zeile = await alleHaltenStufe(zeilen, soll, `Kurzlisten-Zeile (${dichte})`, 2);
    const kennzahl = await alleHaltenStufe(kennzahlen, soll, `Kennzahl-Knopf (${dichte})`, 6);
    // Sechs, nicht „mindestens eine": das Dashboard rendert sechs `<Kachel>` UNBEDINGT
    // (`LageDashboardPage.tsx`, keine steht hinter einem `&&`), und der Mehr-Knopf sitzt im
    // Kachelkopf außerhalb der Zustandsweiche. Mit `1` bliebe der Test grün, wenn fünf
    // Kacheln verschwänden (Review-Befund).
    const mehr = await alleHaltenStufe(
      page.locator('.lfh-kachel__mehr'),
      soll,
      `Mehr-Knopf der Kachel (${dichte})`,
      6,
    );

    gemessen.push(`${dichte} (Soll ≥ ${soll}): Zeile ${zeile}, Kennzahl ${kennzahl}, Mehr ${mehr}`);
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Einsatzauswahl: Einsatzkarten-Titel-Link und Suchfeld folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);

  // Acht aktive Einsätze, damit das Suchfeld sicher erscheint — unabhängig davon, wie
  // viele Einsätze die parallel laufenden Specs in derselben Datenbank schon angelegt
  // haben. Der erste ist zugleich die Karte, deren Titel-Link gemessen wird.
  const stempel = Date.now();
  const kartenName = `E2E Gate3 ${stempel} Nr 1`;
  await einsatzAnlegen(page, kartenName);
  for (let n = 2; n <= SUCHE_AB; n += 1) {
    await einsatzAnlegen(page, `E2E Gate3 ${stempel} Nr ${n}`);
  }

  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    await page.goto('/einsaetze');
    await stelleDichte(page, dichte);

    // Der Titel-Link ist das Tastaturziel der Karte (`EinsaetzePage.tsx`, `renderKarte`) —
    // namentlich gegriffen, weil das Raster die Einsätze aller anderen Specs mitzeigt.
    const titelLink = page.getByRole('link', { name: kartenName, exact: true });
    const titel = await haeltStufe(titelLink, soll, `Titel-Link der Einsatzkarte (${dichte})`);
    await expect(titelLink).toHaveAttribute('href', /\/einsaetze\/\d+$/);

    // Das Suchfeld: gemessen wird die sichtbare Feldhülle (`.ant-input-affix-wrapper`, sie
    // trägt Rahmen und Polsterung), nicht das nackte `<input>` darin — das ist so hoch wie
    // seine Zeile, und seine Höhe sagt nichts über das Ziel, das jemand trifft. Der Anker
    // per zugänglichem Namen sichert, dass es DAS Suchfeld ist.
    const suche = page.locator('.ant-input-search');
    await expect(suche).toHaveCount(1);
    await expect(suche.getByLabel('Einsätze durchsuchen')).toHaveCount(1);
    const feld = await haeltStufe(
      suche.locator('.ant-input-affix-wrapper'),
      soll,
      `Suchfeld (${dichte})`,
    );
    // Der Such-Knopf heißt in antd 6 `.ant-input-search-btn` (`input/Search.js`:
    // `btnPrefixCls = \`${prefixCls}-btn\``) — NICHT mehr `-button`; der erste Anlauf dieses
    // Specs hatte die alte Klasse und fand 0 Knoten. Bewusst die Klasse statt
    // `getByRole('button')`: das Löschkreuz von `allowClear` trägt selbst `role="button"` und
    // ist bei leerem Feld nur `visibility: hidden` — ein Rollen-Locator hinge still daran, dass
    // vor der Messung niemand tippt (Review-Befund).
    const knopf = await haeltStufe(
      suche.locator('.ant-input-search-btn'),
      soll,
      `Such-Knopf (${dichte})`,
    );

    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Titel-Link ${titel}, Suchfeld ${feld}, Such-Knopf ${knopf}`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});


// ── Einheiten-Detailroute (LFH-446, Nachzug zu LFH-339 · Kriterium 2) ────────────────
// Sichtbare Feldhüllen, Zuordnungszeilen und Aktionsabstände werden im Browser gemessen.
// Die Böden stehen als Literale; weder CSS-Tokens noch `data-dichte` ersetzen die Geometrie.

test('Einheit: Formularfelder und Zuordnungszeilen halten 30 / 48 / 72 px und den Aktionsabstand', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const { pfad } = await einheitMitZuordnungen(page);
  const messwerte: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(pfad);
    await stelleDichte(page, dichte);
    await detailBereit(page);
    const ziele = kopfFelder(page).map(({ name, huelle }) => ({ name, ziel: huelle }));
    const aktionsreihen = [];
    let kleinsteZeile = Infinity;
    let kleinsterAbstand = Infinity;
    for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
      const karte = zuordnungsKarte(page, titel);
      const entfernen = karte.getByRole('button', { name: 'Entfernen', exact: true });
      // Die Zeile trägt minHeight; die Schaltfläche darin ist ein eigenes Bedienziel.
      const zeile = entfernen.locator('xpath=ancestor::div[contains(@style,"space-between")][1]');
      kleinsteZeile = Math.min(kleinsteZeile, await haeltStufe(zeile, soll, `${titel}-Zuordnungszeile (${dichte})`));
      ziele.push({ name: `${titel} entfernen`, ziel: entfernen });
      ziele.push({ name: `${titel} zuordnen`, ziel: karte.locator('.ant-select') });
      if (titel === 'Personal') {
        const fuehrer = karte.getByRole('button', { name: 'Als Einheitsführer' });
        ziele.push({ name: 'Als Einheitsführer', ziel: fuehrer });
        aktionsreihen.push([fuehrer, entfernen]);
      }
      if (dichte !== 'kompakt') {
        const r = (await zeile.boundingBox())!;
        const auswahl = (await karte.locator('.ant-select').boundingBox())!;
        // Abstand ab letzter wirklicher Trefffläche, nicht ab der gepolsterten Zeilenhülle.
        const knopf = (await entfernen.boundingBox())!;
        const abstand = auswahl.y - (knopf.y + knopf.height);
        kleinsterAbstand = Math.min(kleinsterAbstand, abstand);
        expect(abstand, `${titel}: Abstand Aktion/Zuordnung ${dichte}, Zeilenhöhe ${r.height}`).toBeGreaterThanOrEqual((dichte === 'handschuh' ? 16 : 8) - SUBPIXEL);
      }
    }
    const speichern = page.getByRole('main').getByRole('button', { name: 'Speichern', exact: true });
    const aufloesen = page.getByRole('main').getByRole('button', { name: 'Auflösen', exact: true });
    const neueSprechgruppe = page.getByRole('main').getByRole('button', { name: /neue Sprechgruppe anlegen$/ });
    ziele.push({ name: 'Speichern', ziel: speichern }, { name: 'Auflösen', ziel: aufloesen }, { name: 'neue Sprechgruppe anlegen', ziel: neueSprechgruppe });
    aktionsreihen.push([speichern, aufloesen]);
    const felder = kopfFelder(page);
    const staerke = ['Führer', 'Unterführer', 'Mannschaft'].map((name) => felder.find((f) => f.name === name)!.huelle);
    aktionsreihen.push([staerke[0], staerke[1]], [staerke[1], staerke[2]]);
    aktionsreihen.push([felder.find((f) => f.name === 'Sprechgruppen')!.huelle, neueSprechgruppe]);
    expect(ziele).toHaveLength(21);
    let minimum = Infinity;
    for (const { name, ziel } of ziele) {
      const hoehe = await haeltStufe(ziel, soll, `${name} (${dichte})`);
      const breite = (await ziel.boundingBox())!.width;
      expect(breite, `${name} (${dichte}): Breite`).toBeGreaterThanOrEqual(soll - SUBPIXEL);
      minimum = Math.min(minimum, hoehe, breite);
    }
    if (dichte !== 'kompakt') {
      for (const [links, rechts] of aktionsreihen) {
        const a = (await links.boundingBox())!;
        const b = (await rechts.boundingBox())!;
        const abstand = Math.max(b.x - a.x - a.width, b.y - a.y - a.height);
        kleinsterAbstand = Math.min(kleinsterAbstand, abstand);
        expect.soft(abstand, `Aktionsabstand ${dichte}: ${links} → ${rechts}`).toBeGreaterThanOrEqual((dichte === 'handschuh' ? 16 : 8) - SUBPIXEL);
      }
    }
    // Auch die einblendbaren Sprechgruppenfelder gehören zu dieser Formularroute.
    await neueSprechgruppe.click();
    const main = page.getByRole('main');
    const bezeichnung = main.getByRole('textbox', { name: 'Neue Bezeichnung', exact: true });
    const betriebsart = main.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: 'Neue Betriebsart', exact: true }) });
    const anlegen = main.getByRole('button', { name: 'Anlegen', exact: true });
    const abbrechen = main.getByRole('button', { name: 'Abbrechen', exact: true });
    for (const feld of [bezeichnung, betriebsart, anlegen, abbrechen]) {
      const hoehe = await haeltStufe(feld, soll, `Sprechgruppen-Schnellerfassung (${dichte})`);
      const breite = (await feld.boundingBox())!.width;
      expect(breite).toBeGreaterThanOrEqual(soll - SUBPIXEL);
      minimum = Math.min(minimum, hoehe, breite);
    }
    if (dichte !== 'kompakt') {
      const reihe = [bezeichnung, betriebsart, anlegen, abbrechen];
      for (let i = 1; i < reihe.length; i++) {
        const a = (await reihe[i - 1].boundingBox())!;
        const b = (await reihe[i].boundingBox())!;
        const abstand = Math.max(b.x - a.x - a.width, b.y - a.y - a.height);
        kleinsterAbstand = Math.min(kleinsterAbstand, abstand);
        expect.soft(abstand, `Sprechgruppen-Feldabstand ${dichte}, Paar ${i}`).toBeGreaterThanOrEqual((dichte === 'handschuh' ? 16 : 8) - SUBPIXEL);
      }
    }
    await abbrechen.click();
    messwerte.push(`${dichte}: ${ziele.length} Grundziele + 4 Sprechgruppenfelder, kleinste Achse ${minimum.toFixed(2)}px, Zuordnungszeile ${kleinsteZeile}px${dichte !== 'kompakt' ? `, Abstand ${kleinsterAbstand}px` : ''}`);
  }
  test.info().annotations.push({ type: 'messwert', description: messwerte.join(' | ') });
});

test('Einheit Selbstbeweis: feste Kompaktgröße fällt trotz aktiver Handschuhstufe durch', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const { pfad } = await einheitMitZuordnungen(page);
  await page.goto(pfad);
  await stelleDichte(page, 'handschuh');
  await detailBereit(page);
  const name = page.getByLabel('Name', { exact: true });
  await haeltStufe(name, 72, 'Handschuhfeld vor Mutation');
  await name.evaluate((el) => el.setAttribute('data-e2e-kompakt', 'true'));
  const mutation = await page.addStyleTag({ content: '[data-e2e-kompakt] { height: 30px !important; min-height: 30px !important; max-height: 30px !important; font-size: 13px !important; line-height: 1.5 !important; padding-block: 0 !important; transition: none !important; }' });
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  expect((await name.boundingBox())!.height).toBe(30);
  await expect(haeltStufe(name, 72, 'Feste Kompaktgröße')).rejects.toThrow(/Feste Kompaktgröße/);
  await mutation.evaluate((el) => el.parentNode?.removeChild(el));
  // Die Wiederherstellung durchläuft wieder den normalen Dichte-Übergang.
  await expect.poll(async () => (await name.boundingBox())!.height).toBeGreaterThanOrEqual(72 - SUBPIXEL);
  await haeltStufe(name, 72, 'Handschuhfeld nach Wiederherstellung');
});


// ── Einsatz-Navigationsrahmen (LFH-516, Nachzug zu LFH-337 · C2, Kriterium 2) ────────
//
// WARUM EIN EIGENER NACHZUG UND NICHT LFH-396: die Prüfliste von LFH-337 verwies Kriterium 2
// zunächst dorthin. LFH-396 ist aber namentlich auf Lage-Dashboard und Einsatzauswahl mit
// fünf benannten Zielen gescopt — die Tests oben decken keine Fläche des Rahmens. Mit dem
// Schließen von LFH-396 (05.09.2026) wäre der Verweis tot gewesen; dieselbe Lage, die
// LFH-446 und LFH-515 mit eigenen Nachzügen gelöst haben.
//
// ── WAS DER RAHMEN IST, UND WARUM ER NICHT WIE EINE ROUTE ZU MESSEN IST ─────────────
//
// Er steht auf JEDER Einsatzroute und hat ZWEI Gestalten, die einander ausschließen
// (Breitenweiche an antds `lg`, `EinsatzLayout.tsx`): oberhalb Rail + Modul-Panel inline,
// unterhalb dieselbe Navigation als Akkordeon im Drawer. Beide brauchen deshalb einen
// eigenen Durchgang mit eigenem Viewport — ein Test auf einer Breite ließe die andere
// Hälfte ungemessen, und genau das war der Bestand: `nav-schmal.spec.ts` misst den
// Drawer-Zweig, aber NUR gegen die feste 48 und in keiner gesetzten Dichtestufe;
// `trefflaeche-tablet.spec.ts` misst Panel und Rail, aber nur in `komfortabel`/`handschuh`
// und nur am Tablet. Die kompakte Stufe — die Fükw-Stufe, also der Primärkontext aus A1 —
// war an keiner Fläche des Rahmens im Browser belegt.
//
// ── DER DRAWER: GEMESSEN, MIT ZWEI BENANNTEN AUSNAHMEN ──────────────────────────────
//
// CLAUDE.md führt den Navigations-Drawer als benannte Ausnahme — das gilt der
// DRAWER-NUTZUNG (er trägt Navigation, keine Entität), nicht der Dichteachse. Er wird hier
// deshalb mitgemessen und nicht ausgenommen. Gemessen sind dabei zwei verschiedene Sorten:
//
//  (1) DIE MODULZEILEN IM DRAWER FOLGEN DER STAFFEL. `ModulAkkordeon.tsx:101` übergibt
//      `mindestTrefflaeche={48}`, und `ModulPanel.modulZeilenStil` verrechnet das per
//      `Math.max` mit `controlHeight` — 48 / 48 / 72. Der Prop-Kommentar dort hält
//      ausdrücklich fest, warum es `Math.max` und nicht `??` ist: mit `??` deckelte die
//      Drawer-Trefffläche die Handschuh-Stufe auf 48. Dieser Test ist der Browser-Beleg
//      dafür; bis hierher stand die Aussage nur als Begründung am Prop.
//
//  (2) DER AKKORDEON-KOPF UND DER DRAWER-SCHLIESSER TUN ES NICHT — gemessen, nicht
//      vermutet. Beide tragen ein nacktes `minHeight: 48` (`ModulAkkordeon.tsx:78`,
//      `EinsatzLayout.tsx:462`) und bleiben damit auch in `handschuh` bei 48 statt 72.
//      Sie stehen deshalb auf {@link BODEN}.fest48 statt auf der Staffel.
//
//      DAS IST HIER FESTGEHALTEN, NICHT BEHOBEN, und zwar aus demselben Grund, aus dem
//      LFH-367/B5g ein Popconfirm gehärtet statt entfernt hat: die Größe eines
//      Bedienziels im Drawer zu ändern ist eine Bedienentscheidung und gehört nicht ins
//      Akzeptanzkriterium eines Mess-Tickets. Der Befund liegt als LFH-537.
//
//      Der Widerspruch, der ihn auslöst, steht in `ModulAkkordeon.tsx:41-46` selbst: die
//      48 wird dort mit „dieselbe Zahl, die die Rail schon trägt" begründet — und die Rail
//      trägt sie seit LFH-337 als BODEN unter der Staffel (`Math.max(48, controlHeight)`),
//      nicht als Höhe. Die Begründung zeigt also auf eine Fundstelle, die inzwischen das
//      Gegenteil tut. Genau derselbe Satz stand bis LFH-337 auch an der Rail.
//
//      Weil {@link BODEN}.fest48 eine UNTERGRENZE ist, zementiert dieser Test die Ausnahme
//      nicht: hübe LFH-537 die zwei Stellen auf `Math.max(48, controlHeight)`, bliebe die
//      Zeile grün, und nur die Messwert-Anmerkung änderte sich.
//
// ── MUTATIONSPROBE (Akzeptanzkriterium) ─────────────────────────────────────────────
//
// Gefahren am 11.09.2026 nach dem Muster der LFH-396-Probe oben, mit einer temporären
// Kopie des Inline-Tests:
//  - `stelleDichte` auf `'kompakt'` festgenagelt, Staffel nur `handschuh`: rot an der
//    `data-dichte`-Wache in `stelleDichte` („Expected handschuh, Received kompakt"), noch
//    VOR jeder Höhenmessung.
//  - dieselbe Mutation, zusätzlich die Wache entfernt: rot an der ERSTEN Höhenmessung —
//    „Kategorie-Ziel (handschuh) #1 (gemessen 51.796875px hoch, Soll ≥ 72)". Der Spec misst
//    also die Staffel und nicht sich selbst. (Die 51,8 statt 48: das Rail-Ziel trägt Ikone
//    UND zweizeiliges Etikett, liegt in `kompakt` also über seinem eigenen Boden — genau die
//    Untergrenzen-Lesart, die im Kopfkommentar oben für die Routen begründet ist.)
//
// ── MESSWERTE DES ERSTEN GRÜNEN LAUFS (11.09.2026, kompakt / komfortabel / handschuh) ──
//
//  inline:  Rail 51,8 / 59,8 / 72 · Panel-Zeile 32 / 48 / 72 · Einsatz-Wechsler 30 / 48 / 72
//           · Alarm Desktop 30 / 48 / 72 · Alarm Ton 30 / 48 / 72 · Suchzugang 30 / 48 / 72
//           · Benutzermenü 40 / 48 / 72 · Palettenzeile 36 / 58 / 86
//  global:  Logo 34 / 48 / 72 · Verwaltung 30 / 48 / 72 · Suchzugang 30 / 48 / 72
//           · Benutzermenü 40 / 48 / 72
//  Drawer:  Hamburger 48 / 48 / 72 (beide Achsen) · Suchzugang schmal 48 / 48 / 72
//           · Modulzeile 48 / 48 / 72 · Akkordeon-Kopf 48 / 48 / **48** · Schließer 48 / 48 / **48**
//
// Die zwei fetten 48er sind der Befund dieses Laufs und liegen als LFH-537 (siehe unten).
// Das laufende Protokoll steht als `test.info().annotations` an jedem Test.

test('Navigationsrahmen inline: Rail, Modul-Panel, Einsatz-Kopfzeile und Kommandopalette folgen der Staffel', async ({
  page,
}) => {
  // Drei Stufen mit je einem Neuladen plus drei Paletten-Öffnungen (Begründung wie oben).
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const name = `E2E Gate3 ${Date.now()} Rahmen`;
  const einsatzId = await einsatzAnlegen(page, name);

  const gemessen: string[] = [];

  for (const { dichte } of STAFFEL) {
    // `…/personal` wie in `trefflaeche-tablet.spec.ts`: die Route öffnet die Kategorie
    // „Kräfte & Mittel", das Panel steht damit ohne Klick und trägt fünf Module.
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    await stelleDichte(page, dichte);

    // Wache vor jeder Messung: der INLINE-Rahmen steht und der Drawer ist gar nicht im
    // Baum. Ohne sie wäre der Test auch dann grün, wenn er versehentlich den Drawer misst
    // (Wortlaut aus `trefflaeche-tablet.spec.ts:174-178`).
    const rail = page.getByRole('navigation', { name: 'Kategorien' });
    await expect(rail, 'der inline-Rahmen steht am Fükw-Maß').toBeVisible();
    await expect(page.getByRole('button', { name: 'Navigation öffnen' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // (a) Kategorie-Rail — sechs Kategorien aus `modulRegistry.kategorien`. Die Zahl steht
    // als Mindestmenge: ein Locator, der weniger trifft, misst einen Ladezustand.
    const railZiel = await alleHaltenStufe(
      rail.locator('button'),
      BODEN.mitA1Boden[dichte],
      `Kategorie-Ziel (${dichte})`,
      6,
    );

    // (b) Modul-Panel — fünf freigegebene Module der Kategorie „Kräfte & Mittel".
    const panel = page.locator('[data-lfh="modul-panel"]');
    await expect(panel, 'das Modul-Panel steht am Fükw-Maß').toHaveCount(1);
    const panelZeile = await alleHaltenStufe(
      panel.locator('button'),
      BODEN.staffel[dichte],
      `Modul-Panel-Zeile (${dichte})`,
      5,
    );

    // (c) die Einsatz-Kopfzeile. Genau EINE — `EinsatzLayout` rendert seinen eigenen
    // `<Header>`, `AppLayout` ist auf Einsatzrouten nicht mit im Baum; ohne diese Wache
    // wären alle Kopfzeilen-Locator unten stillschweigend mehrdeutig.
    const kopf = page.locator('.ant-layout-header');
    await expect(kopf, 'genau eine Kopfzeile auf der Einsatzroute').toHaveCount(1);
    // Der Einsatz-Wechsler über sein `title`, NICHT über den zugänglichen Namen: sein
    // `DownOutlined` bringt ein eigenes englisches `aria-label` mit und stünde im Namen
    // („… down") — dieselbe Falle, die CLAUDE.md aus LFH-366 als „delete Bild entfernen"
    // führt.
    const wechsler = await haeltStufe(
      kopf.locator(`button[title="${name}"]`),
      BODEN.staffel[dichte],
      `Einsatz-Wechsler (${dichte})`,
    );
    // Die zwei Alarm-Knöpfe per Regex: ihr zugänglicher Name trägt den ZUSTAND
    // („Desktop blockiert", „Alarmton durch Klick entsperren"), und der hängt an
    // Browser-Berechtigung und Tonfreigabe — ein exakter Name pinnte eine Umgebung.
    const desktop = await haeltStufe(
      kopf.getByRole('button', { name: /^Desktop-Benachrichtigungen:/ }),
      BODEN.staffel[dichte],
      `Alarm-Knopf Desktop (${dichte})`,
    );
    const ton = await haeltStufe(
      kopf.getByRole('button', { name: /Alarmton/ }),
      BODEN.staffel[dichte],
      `Alarm-Knopf Ton (${dichte})`,
    );
    // Ab `lg` trägt der Suchzugang KEINE feste Größe (`CommandPaletteTrigger.tsx:32-39`)
    // und hängt allein an `controlHeight` — hier also die Staffel, nicht der A1-Boden.
    const suchen = await haeltStufe(
      kopf.getByRole('button', { name: 'Suchen', exact: true }),
      BODEN.staffel[dichte],
      `Suchzugang (${dichte})`,
    );
    const benutzer = await haeltStufe(
      kopf.getByRole('button', { name: 'Benutzermenü', exact: true }),
      BODEN.benutzermenue[dichte],
      `Benutzermenü (${dichte})`,
    );

    // (d) die Kommandopalette. Sie ist seit LFH-335 der Berührungsweg zu 42+ Befehlen;
    // gemessen werden ihre `role="option"`-Zeilen (`command-palette/zeilenStil.ts`).
    // Bei LEERER Suche steht die kuratierte Startansicht — ihre Einträge stehen im DOM,
    // auch wo der 480-px-Kasten sie abschneidet, und `boundingBox()` misst sie dort.
    await kopf.getByRole('button', { name: 'Suchen', exact: true }).click();
    await expect(page.getByRole('listbox'), 'die Palette ist offen').toBeVisible();
    /**
     * ERST WENN DIE EINBLENDUNG DURCH IST — und das ist eine KLASSENWACHE, kein Höhen-Poll.
     *
     * antds `Modal` fährt die `zoom`-Bewegung von `transform: scale(0.2)` hoch, und
     * `boundingBox()` liefert die TRANSFORMIERTE Box: der erste Anlauf dieses Specs meldete
     * „Palettenzeile (kompakt) gemessen 7.2px" — exakt 36 × 0,2 (die Zeile misst in
     * `kompakt` 36 px, `minHeight` 30 plus Polsterung). Dieselbe Falle beschreibt
     * `trefflaeche-tablet.spec.ts:138-148` an der Bestätigungsblase.
     *
     * DORT GENÜGT `expect.poll` AUF DIE HÖHE, HIER NICHT — im Browser nachgemessen
     * (Stichprobe alle 100 ms ab dem Klick): im ersten Frame trägt das Modal zwar schon
     * `ant-zoom-appear-start`, aber noch `transform: none`, die Zeile misst also volle
     * 36 px. Erst danach greift `scale(0.2)`. Ein Höhen-Poll ist damit KEIN Riegel: er
     * besteht auf dem Frame VOR der Bewegung und gibt die Messung genau in sie hinein
     * frei — beim zweiten Anlauf war der Test deshalb weiterhin rot, nur an einer anderen
     * Zeilennummer. Die Klasse verschwindet dagegen erst, wenn rc-motion fertig ist
     * (gemessen: ab ~200 ms trägt das Modal nur noch `ant-modal` + Emotion-Klasse).
     */
    await expect(page.locator('.ant-modal'), 'die Einblendung der Palette ist durch')
      .not.toHaveClass(/ant-zoom/);
    /**
     * Der Locator ist auf die Listbox GESCOPT. Gemessen ist das heute folgenlos (48
     * `role="option"` auf der Seite, alle 48 in der Palette), aber `role="option"` ist die
     * Rolle, die jedes antd-`Select`-Dropdown vergibt — eine Seite mit offener Auswahl zöge
     * deren Einträge sonst in diese Zusicherung.
     */
    const zeile = await alleHaltenStufe(
      page.getByRole('listbox').getByRole('option'),
      BODEN.staffel[dichte],
      `Palettenzeile (${dichte})`,
      5,
    );

    gemessen.push(
      `${dichte}: Rail ${railZiel} (Soll ≥ ${BODEN.mitA1Boden[dichte]}), Panel ${panelZeile}, `
        + `Wechsler ${wechsler}, Desktop ${desktop}, Ton ${ton}, Suchen ${suchen}, `
        + `Benutzermenü ${benutzer} (Soll ≥ ${BODEN.benutzermenue[dichte]}), Palette ${zeile}`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Globale Kopfzeile: Logo, Verwaltungs-Link, Suchzugang und Benutzermenü folgen der Staffel', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  // `/einsaetze` ist die Route von `AppLayout` — der ZWEITEN Kopfzeile. Sie teilt mit der
  // Einsatz-Kopfzeile nur `KOPF_STIL` und die zwei rechten Ziele; Logo und Verwaltungs-Link
  // tragen ihre Höhe über `linkStil` (`AppLayout.tsx:123-130`) und kommen sonst nirgends vor.
  await anmelden(page);

  const gemessen: string[] = [];

  for (const { dichte } of STAFFEL) {
    await page.goto('/einsaetze');
    await stelleDichte(page, dichte);

    const kopf = page.locator('.ant-layout-header');
    await expect(kopf, 'genau eine Kopfzeile auf der Einsatzauswahl').toHaveCount(1);

    const logo = await haeltStufe(
      kopf.getByRole('link', { name: 'lifeline-hub', exact: true }),
      BODEN.staffel[dichte],
      `Logo-Link (${dichte})`,
    );
    // Als `admin` ist die Verwaltung FREI, der Eintrag also ein `<Link>` und damit ein
    // Bedienziel. Gesperrt wäre er ein `Typography.Text` ohne Ziel — dann gäbe es hier
    // nichts zu messen, und `toHaveCount(1)` in `haeltStufe` sagt das laut.
    const verwaltung = await haeltStufe(
      kopf.getByRole('link', { name: 'Verwaltung', exact: true }),
      BODEN.staffel[dichte],
      `Verwaltungs-Link (${dichte})`,
    );
    const suchen = await haeltStufe(
      kopf.getByRole('button', { name: 'Suchen', exact: true }),
      BODEN.staffel[dichte],
      `Suchzugang (${dichte})`,
    );
    const benutzer = await haeltStufe(
      kopf.getByRole('button', { name: 'Benutzermenü', exact: true }),
      BODEN.benutzermenue[dichte],
      `Benutzermenü (${dichte})`,
    );

    gemessen.push(
      `${dichte}: Logo ${logo}, Verwaltung ${verwaltung}, Suchen ${suchen}, `
        + `Benutzermenü ${benutzer} (Soll ≥ ${BODEN.benutzermenue[dichte]})`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Navigations-Drawer auf 390 px: Hamburger und Modulzeilen folgen der Staffel, Akkordeon-Kopf und Schließer bleiben bei 48', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Anmelden und Anlegen am Fükw-Maß, erst danach umstellen — Vorgehen aus
  // `nav-schmal.spec.ts:14-17` und `trefflaeche-tablet.spec.ts:184-185`.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Drawer`);
  await page.setViewportSize(HANDSCHIRM);

  const gemessen: string[] = [];

  for (const { dichte } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    await stelleDichte(page, dichte);

    // Wache: hier gilt der SCHMAL-Zweig — der inline-Rahmen ist weg, der Griff steht.
    await expect(page.getByRole('navigation', { name: 'Kategorien' })).toHaveCount(0);
    const hamburger = page.getByRole('button', { name: 'Navigation öffnen' });
    // Beide Achsen: ein icon-only-Knopf setzt `width` UND `height` aus derselben Zahl
    // (`EinsatzLayout.tsx:319-320`), eine Messung allein der Höhe ließe die Hälfte offen.
    const griff = await haeltStufe(hamburger, BODEN.mitA1Boden[dichte], `Hamburger (${dichte})`);
    const griffBreite = (await hamburger.boundingBox())!.width;
    expect(
      griffBreite,
      `Hamburger-Breite (${dichte}, gemessen ${griffBreite}px, Soll ≥ ${BODEN.mitA1Boden[dichte]})`,
    ).toBeGreaterThanOrEqual(BODEN.mitA1Boden[dichte] - SUBPIXEL);

    // Unter `lg` bekommt der Suchzugang seine feste Trefffläche (`Math.max(48, …)`) — die
    // andere Hälfte der Aussage aus dem Inline-Test, wo derselbe Knopf an der Staffel hängt.
    const suchen = await haeltStufe(
      page.locator('.ant-layout-header').getByRole('button', { name: 'Suchen', exact: true }),
      BODEN.mitA1Boden[dichte],
      `Suchzugang schmal (${dichte})`,
    );

    await hamburger.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    const nav = drawer.getByRole('navigation', { name: 'Einsatz-Navigation' });
    await expect(nav).toBeVisible();

    // Kopfzeilen gegen Modulzeilen: die Kategorie-Köpfe tragen `aria-expanded`, die
    // Modulknöpfe darunter nicht. Das trennt die zwei Verträge ohne Strukturselektor —
    // ein `> div > button` bräche beim ersten Umbau der Verschachtelung.
    const koepfe = nav.locator('button[aria-expanded]');
    const kopfHoehe = await alleHaltenStufe(
      koepfe,
      BODEN.fest48[dichte],
      `Akkordeon-Kopf (${dichte})`,
      6,
    );
    // Die Route hat „Kräfte & Mittel" aufgeklappt — fünf Module stehen ohne Klick da.
    const modulZeile = await alleHaltenStufe(
      nav.locator('button:not([aria-expanded])'),
      BODEN.mitA1Boden[dichte],
      `Drawer-Modulzeile (${dichte})`,
      5,
    );
    const schliesser = await haeltStufe(
      drawer.locator('.ant-drawer-close'),
      BODEN.fest48[dichte],
      `Drawer-Schließer (${dichte})`,
    );

    gemessen.push(
      `${dichte}: Hamburger ${griff}×${griffBreite}, Suchen ${suchen} `
        + `(Soll ≥ ${BODEN.mitA1Boden[dichte]}), Modulzeile ${modulZeile}, `
        + `Akkordeon-Kopf ${kopfHoehe}, Schließer ${schliesser} `
        + `(feste 48 — LFH-537, Soll ≥ ${BODEN.fest48[dichte]})`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});


// ── Kräfteübersicht und Verdichtungszeile (LFH-515, Nachzug zu LFH-338 · C3, Kriterium 2) ──
//
// DIE VIERTE ROUTE dieser Datei, mit denselben Helfern — genau die Gestalt, die der
// Kopfkommentar oben vorsieht („wer hier etwas anhängt, nimmt dieselben Helfer").
//
// WARUM EIN EIGENER NACHZUG UND NICHT LFH-396: jenes Ticket ist namentlich auf Lage-Dashboard
// und Einsatzauswahl mit fünf benannten Zielen gescopt und deckt keine Fläche der
// Kräfteübersicht. Die Prüfliste von LFH-338 verwies zwischenzeitlich dorthin; mit dem
// Schließen von LFH-396 (05.09.2026) wären die Verweise tot gewesen — dieselbe Lage, die
// LFH-446 und LFH-516 mit eigenen Nachzügen gelöst haben.
//
// ── WAS DER ERSTE LAUF GEMESSEN HAT (vor jedem Fix, Fükw 1366 px) ───────────────────
//
//   Umschalter (Hülle)      30,00 / 48,00 / 72,00   ✓ hält
//   Umschalter (Wahlfeld)   26,00 / 44,00 / 68,00   — 4 px unter dem Boden, siehe unten
//   „Filter zurücksetzen"   30,00 / 48,00 / 72,00   ✓ hält
//   Suchfeld des Filters    30,09 / 48,00 / 72,00   ✓ hält
//   Filter-Marke            22,00 / 22,00 / 22,00   — dichteblind, benannte Ausnahme
//   Schließkreuz der Marke  10×10 in JEDER Stufe    — dichteblind, benannte Ausnahme
//   Kräfteübersicht-Link    15,00 / 16,00 / 16,00   ✗ BEFUND, behoben (s. u.)
//
// DER BEFUND: der Link der Verdichtungszeile ist das EINZIGE Bedienelement dieser Zeile und
// blieb im Handschuh-Betrieb bei 16 px — nicht einmal ein Viertel des Bodens, und schon in
// `kompakt` unter 24 px. Es ist wörtlich derselbe Befund, den LFH-396 am Titel-Link der
// Einsatzkarte gemessen hat (17 px in jeder Stufe): CLAUDE.md führt ihn seither als Regel
// „ein `<a>` erbt keine Steuerhöhe". Die Prüfliste von LFH-338 hatte für Kriterium 1
// geschrieben, alle neuen Bedienelemente seien echte antd-Steuerelemente und erbten die
// Staffel vom `ConfigProvider` — für `Segmented`, `Button type="link"` und `Input.Search`
// stimmt das (Messwerte oben), für `Link` nicht. Eine Annahme, keine Messung. Behoben über
// `verdichtungsLinkStil` (zwei Angaben nach LFH-365); danach gemessen **35,50 / 48,00 / 72,00**.
// Der Kompaktwert liegt über dem Boden, weil die Polsterung auf beiden Achsen liegt und die
// Zeilenhöhe des Textes dazukommt — Untergrenze, keine Gleichheit (siehe Kopfkommentar).
//
// DER UMSCHALTER: die Hülle trägt die Staffel punktgenau, das einzelne Wahlfeld liegt
// konstant 4 px darunter — das sind die 2 px Innenpolsterung, die antd der Hülle je Seite
// gibt (`segmentedContainerPadding`). Das ist KEIN Mangel und wird deshalb auch nicht
// „behoben": die beiden Wahlfelder kacheln die Hülle lückenlos, es gibt keine tote Zone
// zwischen ihnen, und ein Wahlfeld auf 72 px zu zwingen machte die Hülle 76 px hoch und
// damit die Staffel selbst falsch. Zugesichert wird deshalb (a) die Hülle gegen den Boden
// und (b) die lückenlose Kachelung — nicht eine Zahl, die man nur durch Brechen der Staffel
// erreichte. Die 4 px stehen als Literal, damit ein Wachsen der Innenpolsterung auffliegt.
//
// MUTATIONSPROBE (Akzeptanzkriterium), am 11.09.2026 nach dem Muster oben mit zwei
// temporären Kopien gefahren — beide Male danach zurückgedreht und byte-gleich verglichen:
//  - `localStorage` in `stelleDichte` auf `'kompakt'` festgenagelt, `STAFFEL` nur
//    `handschuh`: beide Tests rot an der `data-dichte`-Wache („Expected handschuh,
//    Received kompakt"), noch VOR jeder Höhenmessung.
//  - dieselbe Mutation, zusätzlich die Wache entfernt: rot an der ERSTEN Höhenmessung —
//    „Umschalter-Hülle (handschuh) (gemessen 30px hoch, Soll ≥ 72)" und
//    „Kräfteübersicht-Link (handschuh) (gemessen 35.5px hoch, Soll ≥ 72)".
//    Beide Tests messen also die Staffel, nicht sich selbst.
//
// DIE FILTER-MARKE ist die benannte Ausnahme aus Kriterium 1 der Prüfliste, und dieser Spec
// macht sie von einer Behauptung zu einer MESSUNG: `Tag closable` hängt nicht am
// `ConfigProvider` — weder die Marke (22 px) noch ihr Schließkreuz (10×10 px) bewegen sich
// über die Stufen. Getragen wird die Ausnahme allein davon, dass „Filter zurücksetzen" als
// vollwertiger Knopf danebensteht und dieselbe Wirkung für ALLE Filter auf einmal hat. Genau
// das ist hier die Zusicherung (und die kann rot werden): steht mindestens eine Marke, MUSS
// der Zweitweg dastehen und den Boden halten. Die Maße der Marke werden protokolliert, nicht
// gepinnt — sie sind antd-Bestand, kein C3-Erzeugnis, und ein Pin auf 22 bräche bei einem
// antd-Sprung, ohne dass jemand etwas falsch gemacht hätte. Eine dichteabhängige Projekt-Hülle
// um `Tag closable` ist Nachzug 1 der Prüfliste und eine Komponentenentscheidung mit eigenem
// Ticket, nicht ein Nebenprodukt dieses Nachweises.

/** Die Innenpolsterung, die antd der Segmented-Hülle je Seite gibt (`segmentedContainerPadding`).
 *  Literal wie die Böden: aus dem Token zurückgelesen prüfte es den Token gegen sich selbst. */
const SEGMENTED_POLSTER = 2;

test('Kräfteübersicht: Umschalter, Filterzeile und Suchfeld folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Meldebild`);

  // Ohne Kräfte hat das Meldebild keinen Baum — der Umschalter stünde über einer leeren
  // Tabelle, und der Suchfilter unten hätte nichts zu treffen. Ein Fahrzeug dazu, damit die
  // Fahrzeugachse des Kopfes nicht nur Nullen trägt.
  await anlegen(page, einsatzId, 'personal', { adhoc: { name: 'Messkraft Gate3' } }, 'Personal');
  await anlegen(
    page,
    einsatzId,
    'fahrzeuge',
    { adhoc: { funkrufname: 'Florian Musterstadt 1/44-1' } },
    'Fahrzeug',
  );

  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
    await stelleDichte(page, dichte);

    // Anker: die Seite ist fertig geladen. Ohne ihn misst der Rest einen Ladezustand.
    await expect(page.getByRole('region', { name: 'Meldebild' })).toHaveCount(1);

    // (1) DER UMSCHALTER. Gemessen wird die Hülle gegen den Boden — sie trägt die
    //     Steuerhöhe — und zusätzlich, dass die beiden Wahlfelder sie lückenlos kacheln.
    const huelle = page.locator('.ant-segmented');
    const umschalter = await haeltStufe(huelle, soll, `Umschalter-Hülle (${dichte})`);
    const wahlfelder = page.locator('.ant-segmented-item');
    const wahlfeld = await alleHaltenStufe(
      wahlfelder,
      soll - 2 * SEGMENTED_POLSTER,
      `Umschalter-Wahlfeld (${dichte})`,
      2,
    );
    // Lückenlos: das Wahlfeld füllt die Hülle abzüglich ihrer Innenpolsterung GENAU aus.
    // Ohne diese Hälfte wäre die Nachsicht oben ein Freibrief — ein Wahlfeld, das nur halb
    // so hoch wie seine Hülle ist, käme durch dieselbe gelockerte Schranke.
    expect(
      umschalter - wahlfeld,
      `Umschalter (${dichte}): Wahlfeld kachelt die Hülle (Hülle ${umschalter}, Wahlfeld ${wahlfeld})`,
    ).toBeLessThanOrEqual(2 * SEGMENTED_POLSTER + SUBPIXEL);

    // (2) DAS SUCHFELD DER FILTERLEISTE. Gemessen wird die sichtbare Feldhülle
    //     (`.ant-input-affix-wrapper`, sie trägt Rahmen und Polsterung), nicht das nackte
    //     `<input>` darin — das ist so hoch wie seine Zeile (Begründung wie bei der
    //     Einsatzauswahl oben).
    const suchfeld = page.locator('.ant-input-affix-wrapper');
    const feld = await haeltStufe(suchfeld, soll, `Filter-Suchfeld (${dichte})`);

    // (3) FILTER SETZEN. Der Suchfilter ist der einzige, der ohne Stammdaten auskommt:
    //     Abschnitt, Träger und Status ziehen ihre Optionen aus gepflegten Katalogen.
    //     Gegriffen über den Platzhalter und NICHT über `getByRole('textbox')`: antds
    //     `Input.Search` rendert `type="search"`, und das ist die Rolle `searchbox` — ein
    //     Rollen-Locator lief hier gemessen in den Zeitablauf statt in eine Aussage.
    await page.getByPlaceholder('Suche...').fill('Messkraft');
    const marke = page.locator('.ant-tag').filter({ hasText: 'Suche:' });
    await expect(marke).toHaveCount(1);

    // (4) DER ZWEITWEG, an dem die Ausnahme der Marke hängt — und er ist zuerst DA und
    //     dann groß genug. Beide Hälften zählen: ein Knopf, der bei gesetztem Filter
    //     fehlte, machte die Marke zum einzigen Weg, und dann wären ihre 22 px ein Mangel
    //     statt einer Ausnahme.
    const zuruecksetzen = page.getByRole('button', { name: 'Filter zurücksetzen', exact: true });
    const knopf = await haeltStufe(zuruecksetzen, soll, `„Filter zurücksetzen" (${dichte})`);

    // (5) …und die Marke selbst, protokolliert statt gepinnt (Begründung im Block oben).
    const markenKasten = (await marke.boundingBox())!;
    const kreuz = (await marke.locator('.ant-tag-close-icon').boundingBox())!;

    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Umschalter-Hülle ${umschalter}, Wahlfeld ${wahlfeld}, ` +
        `Suchfeld ${feld}, Zurücksetzen ${knopf} | dichteblind: Marke ${markenKasten.height}, ` +
        `Schließkreuz ${kreuz.height}×${kreuz.width}`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Verdichtungszeile: der Kräfteübersicht-Link folgt der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Verdichtung`);

  // Die Zeile rendert `null`, solange NICHT BEIDE Listen da sind (`Verdichtungszeile.tsx`,
  // Datenriegel). Leere Listen zählen als Daten — gesät wird trotzdem, sonst misst der Test
  // eine Zeile aus lauter Nullen und die Fahrzeugachse hätte nichts zu zeigen.
  await anlegen(page, einsatzId, 'personal', { adhoc: { name: 'Messkraft Verdichtung' } }, 'Personal');
  await anlegen(
    page,
    einsatzId,
    'fahrzeuge',
    { adhoc: { funkrufname: 'Florian Musterstadt 2/44-1' } },
    'Fahrzeug',
  );

  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    // Die Fahrzeugseite als einer der vier Einbauorte. Die Zeile ist dort dieselbe
    // Komponente wie auf Personal, Material und Einheiten — vier Messungen derselben
    // Komponente wären vier Abschriften desselben Satzes.
    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    await stelleDichte(page, dichte);

    const link = page.getByRole('link', { name: 'Kräfteübersicht', exact: true });
    const hoehe = await haeltStufe(link, soll, `Kräfteübersicht-Link (${dichte})`);
    // Er muss auch dorthin zeigen: ein Bedienziel der richtigen Größe am falschen Ziel
    // bestünde diese Messung ebenso.
    await expect(link).toHaveAttribute('href', `/einsaetze/${einsatzId}/kraefteuebersicht`);

    gemessen.push(`${dichte} (Soll ≥ ${soll}): Link ${hoehe}`);
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});
