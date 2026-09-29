import { expect, test, type Locator, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Das `Datensicht`-Primitiv am schmalen Schirm — gemessene Wirkung der Weiche (dass sie
 * existiert, pinnt `src/components/Datensicht.test.tsx`).
 *
 * Der Umbruch ist `md` (768 px) für alle Konsumenten; am Personal-Konsumenten wird 767/768
 * und 1199/1200 geprüft, damit keine ETB-Schwelle global wird.
 *
 * AN- UND ABWESENHEIT, je mit Gegenprobe auf der anderen Breite: „kein `.ant-table` bei
 * 390 px" erfüllt auch ein Lade-, Leer- oder Redirect-Zustand. Erst das Paar plus der gesäte
 * Datensatz als Anker in beiden schließt das aus.
 *
 * DIE TREFFFLÄCHEN FOLGEN DER DICHTE-STAFFEL (30 / 48 / 72), nicht einer festen 48: je Ziel
 * über alle drei Stufen gemessen. Ein hartkodiertes `height: 48` oder `size="small"` fiele
 * hier durch. Auf der Vorgabestufe gilt zusätzlich der 24-px-Boden aus Kriterium 1.
 *
 * WO WELCHES ZIEL GEMESSEN WIRD:
 *  - Aktionsknopf auf `/personal` bei 390 px.
 *  - Spaltenschalter auf `/personal` bei 1366 px — im Kartenzweig gibt es ihn nicht.
 *  - Titel-Link auf `/tiere` bei 390 px: die Personalseite setzt `titel` ohne `ziel` (der
 *    Link zeigte auf sie selbst) und rendert Text statt eines Ankers.
 *
 * `toHaveCount(1)` VOR JEDER ZUSICHERUNG: `boundingBox()` auf einem mehrdeutigen Locator misst
 * still den ersten Treffer.
 *
 * Anmelden und Anlegen am Fükw-Maß, erst danach umstellen; Seeding per `page.request`.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * Die Dichte-Staffel als Literale, nicht aus `theme/tokens` — sonst prüfte der Test den Token
 * gegen sich selbst. Quellen: kompakt 30 px (A0) · komfortabel 48 px = Material 48 dp ·
 * handschuh 72 px ≙ 19,05 mm nach MIL-STD-1472F Fig. 12.
 */
const STAFFEL = [
  { dichte: 'kompakt', soll: 30 },
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

/** Kriterium 1 der Bedien-Leitlinie kennt neben dem 48-px-Ziel einen harten Boden. */
const BODEN = 24;

/**
 * Subpixel-Spielraum für JEDEN Maßvergleich: `boundingBox()` liefert Fließkomma
 * (47,99999809 gegen 48 unter Last). Die Stufen bleiben klar getrennt.
 */
const SUBPIXEL = 0.5;

const HANDSCHIRM = { width: 390, height: 844 };
const FUEKW = { width: 1366, height: 768 };

/** Schlüssel aus `theme/ThemeModeProvider.tsx`, bewusst literal: der Wert ist Vertrag. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

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
 * Stellt die Bediendichte und lädt neu — `ThemeModeProvider` liest den Speicher nur beim
 * Montieren, sonst mäße der Test dreimal dieselbe Stufe.
 */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  // Kein `networkidle`: die Wache darunter wartet von selbst, und der Live-Stream gibt das
  // Schweigen des Netzes nur widerwillig her (bei zwölf Navigationen sprengte das das Budget).
  // Die Wache trennt einen verworfenen Speicherwert (Rückfall auf `kompakt`) von einem
  // Darstellungsfehler.
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

test('LFH-464: Personal behält md auch im Bereich des neuen ETB-Umbruchs', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Default-Umbruch ${Date.now()}`);
  await seedeKraft(page, einsatzId);
  for (const breite of [767, 768, 991, 992, 1024, 1199, 1200, 1280]) {
    await page.setViewportSize({ width: breite, height: 900 });
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    const sicht = page.getByRole('region', { name: 'Personal im Einsatz' });
    await expect(sicht.getByText(KRAFT, { exact: true })).toHaveCount(1);
    await expect(sicht.locator('.ant-table')).toHaveCount(breite >= 768 ? 1 : 0);
    await expect(sicht.locator('[data-lfh="datensicht-karte"]')).toHaveCount(breite >= 768 ? 0 : 1);
  }
});

test('Personalseite: bei 390 px Karten und kein Tabellenelement, bei 1366 px Tabelle — Gegenprobe in beide Richtungen', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Datensicht Zweig ${Date.now()}`);
  await seedeKraft(page, einsatzId);

  // ── 390 px: KARTENZWEIG
  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/personal`);

  const bereich = page.getByRole('region', { name: 'Personal im Einsatz' });
  await expect(bereich).toHaveCount(1);
  // Der gesäte Datensatz ist der Anker — sonst wäre „kein Tabellenelement" auch bei einer
  // leeren oder weggeleiteten Seite wahr.
  await expect(bereich.getByText(KRAFT)).toHaveCount(1);

  await expect(page.locator('.ant-table'), 'bei 390 px darf keine Tabelle stehen').toHaveCount(0);
  await expect(
    page.locator('[data-lfh="datensicht-karte"]'),
    'bei 390 px steht genau eine Karte je Datensatz',
  ).toHaveCount(1);
  // GENAU EIN Zweig im Baum: ein zweiter, verborgener machte die Aussage oben bedeutungslos.
  await expect(page.locator('tr.ant-table-row')).toHaveCount(0);
  // Der Spaltenschalter existiert im Kartenzweig NICHT.
  await expect(
    page.getByRole('button', { name: /^Spalten/ }),
    'im Kartenzweig gibt es keinen Spaltenschalter',
  ).toHaveCount(0);
  // Die Werkzeugzeile steht in BEIDEN Zweigen und immer, auch leer — sonst verschöbe sie die
  // Fläche beim Erscheinen.
  await expect(page.locator('[data-lfh="datensicht-werkzeuge"]')).toHaveCount(1);

  // ── 1366 px: GEGENPROBE, TABELLENZWEIG
  await page.setViewportSize(FUEKW);
  await page.goto(`/einsaetze/${einsatzId}/personal`);
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

/**
 * LFH-435 · Zweig: Beobachter (kein Schreibrecht) auf der Personalseite. Ohne Schreibrecht
 * verliert die Karte Statusauslöser und „Entfernen", die Tabelle die Aktionsspalte, und die
 * Position steht als Text statt als `Select` mit `minWidth: 130` (`PersonalPage.tsx`, Spalte
 * `position`). Gemessen wird dieselbe Weiche wie oben, dazu der waagerechte Überlauf beider
 * Zweige — der Nur-Lese-Zweig ist anders gebaut und wurde nie gemessen.
 *
 * Die Kraft trägt eine Position, damit die Zelle Text statt „—" zeigt: die Admin-Zeile zeigt
 * denselben Wortlaut als gewählten Wert im `Select`, deshalb sichert der Test zusätzlich die
 * ABWESENHEIT jeder Auswahl in der Zeile zu.
 */
test('Personalseite: Weiche und kein Querlauf auch im Nur-Lese-Zweig (Beobachter)', async ({
  page,
}) => {
  // Zusätzliche Anmeldung und zwei Messungen mehr als der Admin-Geschwister.
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Datensicht lesend ${Date.now()}`);
  await anlegen(
    page,
    einsatzId,
    'personal',
    {
      adhoc: {
        name: KRAFT,
        funktion: 'Abschnittsleitung Technische Hilfeleistung',
        traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
        staerke_position: 'unterfuehrer',
      },
    },
    'Personal mit Position',
  );
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  const bereich = page.getByRole('region', { name: 'Personal im Einsatz' });
  const statusAusloeser = page.getByRole('button', { name: `Status von ${KRAFT} ändern` });
  const querlauf = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

  // ── 390 px: KARTENZWEIG
  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/personal`);
  await expect(bereich.getByText(KRAFT)).toHaveCount(1);
  const karte = page.locator('[data-lfh="datensicht-karte"]');
  await expect(karte, 'bei 390 px steht genau eine Karte je Datensatz').toHaveCount(1);
  await expect(page.locator('.ant-table'), 'bei 390 px darf keine Tabelle stehen').toHaveCount(0);
  // ── VORBEDINGUNGEN: der Nur-Lese-Zweig steht.
  await expect(statusAusloeser, 'Vorbedingung: ohne Schreibrecht kein Statusauslöser').toHaveCount(
    0,
  );
  // Strukturell statt per Name: die Admin-Karte trägt Statusauslöser UND „Entfernen".
  await expect(
    karte.getByRole('button'),
    'Vorbedingung: die Karte trägt ohne Schreibrecht kein Bedienziel',
  ).toHaveCount(0);
  await expect
    .poll(querlauf, { message: 'Personal (390 px, Beobachter) läuft waagerecht über' })
    .toBeLessThanOrEqual(SUBPIXEL);

  // ── 1366 px: GEGENPROBE, TABELLENZWEIG
  await page.setViewportSize(FUEKW);
  await page.goto(`/einsaetze/${einsatzId}/personal`);
  const zeile = page.locator('tr.ant-table-row');
  await expect(zeile, 'bei 1366 px steht genau eine Tabellenzeile').toHaveCount(1);
  await expect(zeile.getByText(KRAFT)).toBeVisible();
  await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);
  // ── VORBEDINGUNGEN: Position als Text, keine Auswahl, keine Aktionsspalte.
  await expect(
    zeile.getByText('Unterführer', { exact: true }),
    'Vorbedingung: die Position steht als Text in der Zeile',
  ).toBeVisible();
  await expect(
    zeile.getByRole('combobox'),
    'Vorbedingung: ohne Schreibrecht keine Positions-Auswahl in der Zeile',
  ).toHaveCount(0);
  await expect(statusAusloeser, 'Vorbedingung: ohne Schreibrecht kein Statusauslöser').toHaveCount(
    0,
  );
  await expect(
    page.locator('th.ant-table-cell').filter({ hasText: 'Aktionen' }),
    'Vorbedingung: ohne Schreibrecht keine Aktionsspalte',
  ).toHaveCount(0);
  await expect
    .poll(querlauf, { message: 'Personal (1366 px, Beobachter) läuft waagerecht über' })
    .toBeLessThanOrEqual(SUBPIXEL);
});

test('Trefflächen des Primitivs folgen der Dichte-Staffel 30 / 48 / 72 px — Aktionsknopf, Spaltenschalter, Titel-Link', async ({
  page,
}) => {
  // Drei Dichtestufen mit je vier Seitenaufrufen samt Neuladen: unter Volllast reicht das
  // Vorgabebudget nicht.
  test.setTimeout(90_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Datensicht Dichte ${Date.now()}`);
  await seedeKraft(page, einsatzId);
  // Der Status-Default `aktiv` deckt sich mit dem Standardreiter der Tierseite; ein anderer
  // fiele aus der Sicht.
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
    // …und er zeigt wirklich auf die Detailroute — ein Anker ohne Ziel hätte dieselbe Höhe.
    await expect(titelLink).toHaveAttribute(
      'href',
      new RegExp(`/einsaetze/${einsatzId}/tiere/\\d+`),
    );

    // ── Spaltenschalter im Tabellenzweig (1366 px)
    await page.setViewportSize(FUEKW);
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    // Das `aria-label` wechselt mit dem Zähler („Spalten" bzw. „Spalten · n ausgeblendet"),
    // deshalb ein Präfix-Muster.
    const schalter = await haeltStufe(
      page.locator('[data-lfh="datensicht-werkzeuge"]').getByRole('button', { name: /^Spalten/ }),
      soll,
      `Spaltenschalter (1366 px, ${dichte})`,
    );

    gemessen.push(
      `${dichte} (Soll ${soll}): Aktionsknopf ${knopf}, Titel-Link ${titel}, Spaltenschalter ${schalter}`,
    );

    // Auf der Vorgabestufe zusätzlich der harte Boden aus Kriterium 1 — eine andere Aussage
    // als die Staffel, deshalb getrennt belegt.
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
 * Der Spaltenschalter trägt Prüflisten-Zeile 14 und braucht einen Tastaturweg (WCAG 2.1.1).
 * jsdom kennt weder Fokusfolge im Portal noch die `-active`-Hervorhebung von rc-menu.
 * Zugesichert ist die Eingabetaste; die Leertaste bindet rc-menu nicht.
 */
test('Spaltenschalter ist mit der Tastatur bedienbar — Eingabetaste schaltet die Spalte, der Zähler zieht mit', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Schalter Tastatur ${Date.now()}`);
  await seedeKraft(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/personal`);
  // Anker: die gesäte Zeile. Erst mit ihr steht die Tabelle, und der Zähler unten liest den
  // Endstand.
  await expect(
    page.getByRole('region', { name: 'Personal im Einsatz' }).locator('tr.ant-table-row'),
  ).toHaveCount(1);

  const werkzeuge = page.locator('[data-lfh="datensicht-werkzeuge"]');
  const schalter = werkzeuge.getByRole('button', { name: /^Spalten/ });
  await expect(schalter).toHaveCount(1);
  // Namentlich: „Träger" ist bei 1366 px sichtbar UND wählbar — beides braucht der Test.
  const ZIELSPALTE = 'Träger';

  // Der Zähler steht als Text im Namen des Knopfes und zählt Handauswahl und `abBreite`.
  const zaehler = async () => {
    const text = (await schalter.textContent()) ?? '';
    return Number(text.match(/·\s*(\d+)\s*ausgeblendet/)?.[1] ?? 0);
  };
  const vorher = await zaehler();

  // NUR das offene Menü: antd lässt das Portal nach dem Schließen im Baum stehen, und der
  // zuletzt hervorgehobene Eintrag behält seine `-active`-Klasse.
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu');
  const aktiv = menue.locator('li.ant-dropdown-menu-item-active');

  /**
   * Öffnet den Schalter per Tastatur und läuft mit `ArrowDown`, bis {@link ZIELSPALTE}
   * hervorgehoben ist. Suchschleife statt gezähltem `ArrowDown`: rc-menu merkt sich den
   * zuletzt aktiven Eintrag, und ob beim ersten Öffnen schon einer aktiv ist, hängt am
   * Zeitpunkt.
   */
  const oeffneUndHebeHervor = async (): Promise<void> => {
    /*
     * Bis zu drei Anläufe wegen des Zeitverhaltens des Portals: ein Tastendruck, während das
     * vorige Menü noch ausblendet, verschluckt rc-trigger. Auf `toHaveCount(0)` zu warten
     * reichte unter Volllast nicht.
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
     * ERST SCHAUEN, DANN DRÜCKEN: beim zweiten Öffnen steht die Hervorhebung schon auf der
     * Zielspalte, ein unbedingtes `ArrowDown` schob daran vorbei — und die Eingabetaste
     * schaltete dann eine FREMDE Spalte.
     */
    if (((await aktiv.textContent().catch(() => null)) ?? '').trim() === ZIELSPALTE) return;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('ArrowDown');
      // Belegt zugleich, dass der Fokus ins Menü gewandert ist.
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

  // Gegenrichtung: derselbe Weg holt dieselbe Spalte zurück.
  await oeffneUndHebeHervor();
  await page.keyboard.press('Enter');
  await expect.poll(zaehler, { message: 'derselbe Weg muss zurückschalten' }).toBe(vorher);
  expect(await spaltenKoepfe(), 'die Spalte steht wieder in der Tabelle').toContain(geschaltet);
});
