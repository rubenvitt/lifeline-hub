import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Gate 3 der Bedien-Leitlinie für Lage-Dashboard und Einsatzauswahl (LFH-396, Nachzug
 * zur Prüfliste von LFH-336 · C1, Kriterium 2).
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
    const mehr = await alleHaltenStufe(
      page.locator('.lfh-kachel__mehr'),
      soll,
      `Mehr-Knopf der Kachel (${dichte})`,
      1,
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
    // Der Such-Knopf trägt in antd 6 keine eigene Klasse mehr (`ant-input-search-button` ist
    // weg, gemessen) und keinen Namen — nur ein `role="img"`-Icon. Innerhalb des Suchfelds ist
    // er der einzige Knopf; das Löschkreuz von `allowClear` erscheint erst mit Inhalt.
    const knopf = await haeltStufe(suche.getByRole('button'), soll, `Such-Knopf (${dichte})`);

    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Titel-Link ${titel}, Suchfeld ${feld}, Such-Knopf ${knopf}`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});
