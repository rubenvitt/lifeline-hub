import { expect, test, type Page } from '@playwright/test';

/**
 * Die Verwaltungsflächen im echten Layout (LFH-346 · C11, Task A10 · Schritt 2).
 *
 * ── WARUM HIER UND NICHT IN VITEST ──────────────────────────────────────────────────────
 *
 * `test/utils.tsx` montiert ein NACKTES `ConfigProvider` ohne Theme, und jsdom rechnet kein
 * Layout. Alles, was C11 an Pixeln zusichert — Trefflächenhöhe einer Zeilenaktion, Abstand
 * zur destruktiven Nachbarin, eine Rasterspalte, die nicht auf ihre Pfeil-Ikone
 * zusammenfällt, eine Speicherleiste, die im Blickfeld steht — ist ausschliesslich hier
 * messbar. Die Unit-Suite pinnt daneben die Struktur (Prop-Werte, Inline-Stile, DOM).
 *
 * ── DIE SCHWELLE IST DIE STAFFEL, NICHT DIE 32 AUS DEM AK-TEXT ──────────────────────────
 *
 * Die Aufgabenstellung nennt „Zeilenaktion ≥ 32 px". Bindend für die Routen ist Gate 3 der
 * Bedien-Leitlinie mit **30 / 48 / 72** (`theme/tokens.ts`, `dichten.*.zeilenhoehe`) — die
 * Zeilenknöpfe tragen keine `size`-Angabe und erben `controlHeight` vom `ConfigProvider`.
 * In der Stufe `kompakt` sind das **30 px**, und das ist der Vertrag, nicht ein Mangel.
 *
 * `einstellungen-schmal.spec.ts:20-26` hat dieselbe Korrektur schon begründet (dort gegen
 * „≥ 44" aus dem Ticket), `kraefte-schmal.spec.ts` und `trefflaeche-tablet.spec.ts` davor.
 * Ein Test auf „≥ 32" wäre SCHWÄCHER als der Bestand: er liefe in jeder der drei Stufen
 * durch (30 fiele durch, 48 und 72 trivial hindurch) und könnte weder eine Regression auf
 * eine punktuelle Klein-Angabe (24 px) noch ein Durchgreifen der falschen Stufe zeigen.
 * Gepinnt wird deshalb die Stufe SELBST, als handgeschriebene Zahl.
 *
 * ── KEIN VERHÄLTNIS, SONDERN ABSOLUTE PIXEL ─────────────────────────────────────────────
 *
 * `KatalogTabelle` rendert mit `width: max-content`; bei langem Inhalt wächst die Tabelle
 * über ihren Container, und ein Verhältnis Spalte-zu-Tabelle würde kleiner, obwohl der
 * Inhalt mehr Platz hat. Test 1 misst deshalb ausschliesslich absolute Pixel an der
 * gerenderten Knopf-Box. Wo doch ein Bezug nötig ist (Test 2, Rollenspalte), ist er die
 * **Contentbreite des Zeilencontainers** (`clientWidth`), nie eine Scroll-Breite.
 *
 * ── WARUM `localStorage` UND KEIN `hasTouch` ────────────────────────────────────────────
 *
 * Die Dichtestufe wird über die gespeicherte Wahl gesetzt (`addInitScript`), nicht über
 * `test.use({ hasTouch: true })`: eine getroffene Wahl gewinnt immer gegen die
 * Zeigerart-Erkennung (`components/useViewport.ts`, `zeigerIstGrob`), und `hasTouch` ist
 * eine BrowserContext-Option — sie läge auf DER GANZEN DATEI und höbe auch Test 2 und 3
 * unbemerkt von `kompakt` weg.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — der Wert ist Vertrag. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

const FUEKW = { width: 1280, height: 800 };
const HANDSCHIRM = { width: 390, height: 844 };

/** `boundingBox()` liefert Fliesskomma, Chromium rechnet unter Last anders als im
 *  Einzellauf (dreimal gemessen in `nav-schmal.spec.ts:26-46`). */
const SUBPIXEL = 0.5;

/**
 * Die Staffel als HANDGESCHRIEBENE Zahlen, nicht aus `theme/tokens` importiert — sonst
 * prüfte der Test den Token gegen sich selbst und bliebe grün, wenn das Maß am Knopf gar
 * nicht mehr ankommt.
 *
 * `zeilenhoehe` = `controlHeight` (Knopfhöhe), `abstandSm` = `marginSM` (geforderter
 * Mindestabstand zur destruktiven Nachbarin, CLAUDE.md „Rot steht nicht bündig neben
 * Neutralem"), `abstandMd` = das, was `<Space size="middle">` tatsächlich legt.
 */
const STAFFEL = [
  { dichte: 'kompakt', zeilenhoehe: 30, abstandSm: 7, abstandMd: 11 },
  { dichte: 'komfortabel', zeilenhoehe: 48, abstandSm: 11, abstandMd: 18 },
] as const;

/** Ein Modul, dessen Zeile in den Einsatz-Defaults immer steht. */
const MODUL = 'Einsatzabschnitte';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/**
 * Fahrzeug über die API anlegen und den Datensatz zurückgeben.
 *
 * Der `dienststatus` wird MITGELESEN und in Test 1 geprüft: die destruktive Nachbaraktion
 * („Außer Dienst") steht nur an einer Zeile mit `in_dienst`. Käme ein frisch angelegtes
 * Fahrzeug als `ausser_dienst` zurück, hiesse der Nachbar „Wieder in Dienst" — neutral —,
 * und die Abstandsmessung vergliche zwei harmlose Knöpfe und bliebe fälschlich grün.
 */
async function fahrzeugAnlegen(page: Page, funkrufname: string) {
  const antwort = await page.request.post('/api/fahrzeuge', {
    data: { funkrufname, fahrzeugtyp: 'LF 20', kennzeichen: 'X-YZ 123' },
  });
  expect(
    antwort.ok(),
    `Seeding Fahrzeug: ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
  return (await antwort.json()) as { id: number; funkrufname: string; dienststatus: string };
}

/** Dichtestufe wie ein wiederkehrender Benutzer: gespeicherte Wahl vor dem ersten Bild. */
async function dichteSetzen(page: Page, dichte: string) {
  await page.addInitScript(
    ([schluessel, stufe]) => window.localStorage.setItem(schluessel, stufe),
    [DICHTE_SCHLUESSEL, dichte] as const,
  );
}

// ── MESSUNG 1 ───────────────────────────────────────────────────────────────────────────
//
// Zeilenaktion und ihr Abstand zur destruktiven Nachbarin, in beiden Stufen.
//
// Zwei Aussagen in einem Fall, weil sie dieselbe Vorbedingung teilen (eine Zeile mit
// `in_dienst` und zwei sichtbaren Knöpfen) und ein zweiter Fall sie nur erneut aufbauen
// würde. Die Stufen laufen als getrennte Tests: `addInitScript` wirkt beim Kontextaufbau,
// eine Stufenumschaltung mitten im Test wäre ein Neuladen mit halbem Zustand.

for (const { dichte, zeilenhoehe, abstandSm, abstandMd } of STAFFEL) {
  test(`Stufe ${dichte}: die Zeilenaktion misst ${zeilenhoehe} px und hält Abstand zur destruktiven Nachbarin`, async ({
    page,
  }) => {
    await dichteSetzen(page, dichte);
    await anmelden(page);
    const fahrzeug = await fahrzeugAnlegen(page, `E2E Verwaltung ${dichte} ${Date.now()}`);
    // Die Vorbedingung der Abstandsmessung — siehe `fahrzeugAnlegen`.
    expect(
      fahrzeug.dienststatus,
      `frisches Fahrzeug muss in Dienst sein, sonst fehlt die destruktive Nachbaraktion (gemessen: ${fahrzeug.dienststatus})`,
    ).toBe('in_dienst');

    await page.setViewportSize(FUEKW);
    await page.goto('/admin/stammdaten/fahrzeuge');

    // Das Merkmal setzt ein Effekt — beim ersten Bild fehlt es noch.
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    const zeile = page.locator('tr.ant-table-row').filter({ hasText: fahrzeug.funkrufname });
    await expect(zeile).toHaveCount(1);
    const bearbeiten = zeile.getByRole('button', { name: 'Bearbeiten' });
    const ausserDienst = zeile.getByRole('button', { name: 'Außer Dienst' });
    await expect(bearbeiten).toBeVisible();
    await expect(ausserDienst).toBeVisible();

    const links = (await bearbeiten.boundingBox())!;
    const rechts = (await ausserDienst.boundingBox())!;
    expect(links, 'Bearbeiten nicht messbar').not.toBeNull();
    expect(rechts, 'Außer Dienst nicht messbar').not.toBeNull();

    // (a) Höhe = die Steuerhöhe der Stufe. GLEICHHEIT, nicht „mindestens": nach unten
    //     fängt sie eine punktuelle Klein-Angabe (24 px in kompakt), nach oben eine
    //     durchgreifende falsche Stufe (48/72). Eine reine Untergrenze könnte beides nicht.
    //     GEMESSEN: kompakt 30,0 px, komfortabel 48,0 px — beide Knöpfe, ohne Subpixelrest.
    for (const [name, box] of [
      ['Bearbeiten', links],
      ['Außer Dienst', rechts],
    ] as const) {
      expect(
        Math.abs(box.height - zeilenhoehe),
        `${name} (gemessen ${box.height} px) muss die Steuerhöhe der Stufe ${dichte} tragen (${zeilenhoehe} px)`,
      ).toBeLessThanOrEqual(SUBPIXEL);
    }

    // (b) Der Abstand zur destruktiven Nachbarin. Gefordert ist `marginSM`; gelegt wird
    //     `abstand.md` durch `<Space size="middle">`. Geprüft wird gegen die FORDERUNG —
    //     eine Zusicherung auf den Ist-Wert bräche bei jeder Abstandspflege, obwohl die
    //     Regel weiter hielte. Der Ist-Wert steht in der Fehlermeldung.
    //
    //     Der Riegel gegen die Vorgabe: `Space` OHNE `size` legt `paddingXS` (3 px in
    //     kompakt) — das fiele hier durch, und genau das soll es.
    //
    //     GEMESSEN: kompakt 11 px (gefordert 7), komfortabel 18 px (gefordert 11) — also
    //     exakt `abstand.md` aus beiden Stufen.
    const luecke = rechts.x - (links.x + links.width);
    expect(
      luecke,
      `Abstand zwischen neutraler und destruktiver Aktion (gemessen ${luecke} px) muss mindestens marginSM (${abstandSm} px) betragen; erwartet aus size="middle": ${abstandMd} px`,
    ).toBeGreaterThanOrEqual(abstandSm - SUBPIXEL);
  });
}

// ── MESSUNG 2 ───────────────────────────────────────────────────────────────────────────
//
// Die Modulzeile der Einsatz-Defaults (`/admin/einstellungen/einsatz`).
//
// ABGRENZUNG gegen `einstellungen-schmal.spec.ts:249`: der dortige Fall misst die
// EINSATZ-Route (`/einsaetze/:id/einstellungen/module`) — dort trägt die Liste eine
// `sichtbarSpalte`, also DREI Kinder im Raster `minmax(0,1fr) auto auto`. Die
// Verwaltungsseite hier übergibt keine, hat also ZWEI Kinder in einem Dreispaltenraster.
// Wichtiger noch: der dortige Fall misst ausschliesslich bei 390 px — und da greift
// `istSchmal`, das Raster ist einspaltig und der Auswähler nimmt die volle Breite. Die
// `auto`-Spalte, um die es geht, existiert nur in der BREITEN Ansicht.

/** Breite des Auswählers UND die Contentbreite seiner Zeile — nie eine Scroll-Breite. */
async function rollenspaltenMasse(page: Page) {
  const auswahl = page.getByRole('combobox', { name: `Benötigte Rolle: ${MODUL}` });
  await expect(auswahl).toBeVisible();
  const box = (await auswahl.boundingBox())!;
  expect(box, 'Rollen-Auswähler nicht messbar').not.toBeNull();
  const zeilenbreite = await auswahl.evaluate(
    (el) => (el.closest('[data-modul-zeile]') as HTMLElement).clientWidth,
  );
  return { breite: box.width, zeilenbreite };
}

// 120 px ist kein Schönheitsmass, sondern die Breite, ab der die längste Option
// („Führungskraft") lesbar steht statt abgeschnitten — dieselbe Schwelle, die
// `einstellungen-schmal.spec.ts:264` schon setzt.
const LESBAR = 120;

test('bei 390 px stapelt die Modulzeile der Einsatz-Defaults, die Spaltenköpfe fallen weg und der Rollen-Auswähler bleibt breit', async ({
  page,
}) => {
  await anmelden(page);
  await page.setViewportSize(HANDSCHIRM);
  await page.goto('/admin/einstellungen/einsatz');

  const auswahl = page.getByRole('combobox', { name: `Benötigte Rolle: ${MODUL}` });
  await expect(auswahl).toBeVisible();

  // Ein Kopf über gestapelten Zeilen benennt keine Spalten mehr, sondern behauptet eine
  // Ordnung, die es nicht gibt.
  await expect(
    page.getByText('Benötigte Rolle (Default)', { exact: true }),
    'unter md fallen die Spaltenköpfe GANZ weg',
  ).toHaveCount(0);

  // Gestapelt: die Beschriftung steht ÜBER dem Auswähler, nicht daneben.
  const label = page.getByText(MODUL, { exact: true }).first();
  await expect(label).toBeVisible();
  const l = (await label.boundingBox())!;
  const a = (await auswahl.boundingBox())!;
  expect(
    a.y,
    `bei 390 px muss der Auswähler UNTER der Beschriftung liegen (Label y=${l.y}, Auswähler y=${a.y})`,
  ).toBeGreaterThan(l.y);

  const masse = await rollenspaltenMasse(page);
  // GEMESSEN: 317 px in einer 348 px breiten Zeile — das einspaltige Raster gibt dem
  // Auswähler praktisch die ganze Contentbreite; die Schwelle liegt bei 120.
  expect(
    masse.breite,
    `Rollen-Auswähler bei 390 px (gemessen ${masse.breite} px in einer ${masse.zeilenbreite} px breiten Zeile) ist zu schmal zum Treffen und Lesen`,
  ).toBeGreaterThanOrEqual(LESBAR);
  // …und er sprengt die Zeile auch nicht. Beide Hälften nötig: ohne die Obergrenze wäre
  // „nicht zusammengefallen" auch von einem Überlauf erfüllt.
  expect(
    masse.breite,
    `Rollen-Auswähler (${masse.breite} px) darf die Contentbreite seiner Zeile (${masse.zeilenbreite} px) nicht überschreiten`,
  ).toBeLessThanOrEqual(masse.zeilenbreite + SUBPIXEL);
});

/**
 * ── GEMESSENER BEFUND, BEWUSST NICHT BEHOBEN ────────────────────────────────────────────
 *
 * **Der Befund:** in der breiten Ansicht (1280 px, Fükw) fällt die `auto`-Spalte des
 * Rasters `minmax(0, 1fr) auto auto` auf **56,3 px** zusammen — die Option „Frei (alle)"
 * steht abgeschnitten, „Führungskraft" wäre nicht lesbar. Gemessen im selben Lauf:
 *
 *   Einsatz-Route  `/einsaetze/:id/einstellungen/module`  → 56,3 px  (Spuren 747,7 / 43 / 87,3)
 *   Admin-Route    `/admin/einstellungen/einsatz`         → 56,3 px  (Spuren 790,7 / 87,3 / 0)
 *
 * **Er ist NICHT von LFH-346 verursacht** und auch kein Sonderfall der Verwaltungsseite.
 * `git diff main` an `ModulEinstellungsListe.tsx` zeigt für Raster und `Select` nur eine
 * Umsortierung — die beiden Zeilen (`gridTemplateColumns: 'minmax(0, 1fr) auto auto'` und
 * `style={{ width: '100%' }}`) stehen unverändert seit LFH-345 · C10, und beide Routen
 * messen denselben Wert, obwohl die eine drei und die andere zwei Kinder im Raster hat.
 *
 * **Warum es bisher niemandem auffiel:** der Playwright-Nachweis aus LFH-345
 * (`einstellungen-schmal.spec.ts:249`) misst bei **390 px** — dort greift `istSchmal`, das
 * Raster ist einspaltig, und der Auswähler bekommt die volle Breite. Der Satz in CLAUDE.md
 * („dass die `auto`-Spalte dabei nicht auf ihre Pfeil-Ikone zusammenfällt, ist in
 * Playwright gemessen") gilt damit nur für die schmale Ansicht; für die breite war er nie
 * geprüft.
 *
 * **Warum hier nicht behoben:** A10 · Schritt 2 ist ein reiner Messschritt, der Dateiscope
 * ist `frontend/e2e/`. Die Behebung säße in `ModulEinstellungsListe.tsx` (naheliegend: eine
 * `minmax()`-Spur statt `auto`, oder eine Mindestbreite am Auswähler) und gehört in ein
 * eigenes Ticket mit eigener Bewertung.
 *
 * **Warum ein GRÜNER Pin und kein `test.fail()`:** `test.fail()` verlangt nur, dass
 * IRGENDETWAS fehlschlägt. Bräche der Locator — `closest('[data-modul-zeile]')` liefert
 * `null`, die Anmeldung scheitert, der zugängliche Name ändert sich —, wäre der geworfene
 * Fehler ebenfalls „erwartet", der Lauf bliebe grün, und der Pin hätte still aufgehört zu
 * messen. Ein Fenster um den Ist-Wert kann das nicht: es wird rot, wenn der Befund BEHOBEN
 * ist (dann bitte diesen Block samt Test entfernen), rot bei einer VERSCHLECHTERUNG auf die
 * nackte Pfeil-Ikone — und der kaputte Locator wirft, statt sich zu tarnen.
 */
test('BEFUND (Bestand seit LFH-345): der Rollen-Auswähler fällt bei 1280 px auf 56 px zusammen', async ({
  page,
}) => {
  await anmelden(page);
  await page.setViewportSize(FUEKW);
  await page.goto('/admin/einstellungen/einsatz');

  await expect(
    page.getByText('Benötigte Rolle (Default)', { exact: true }),
    'bei 1280 px gibt es Spalten, also auch Spaltenköpfe',
  ).toBeVisible();

  const masse = await rollenspaltenMasse(page);
  const meldung =
    `Rollen-Auswähler bei 1280 px: gemessen ${masse.breite} px in einer ` +
    `${masse.zeilenbreite} px breiten Zeile (Befundstand: 56,3 px).`;
  // Untergrenze: der Auswähler ist zusammengefallen, aber nicht auf die nackte Pfeil-Ikone
  // (die läge bei rund 32 px). Fällt sie, ist der Befund SCHLIMMER geworden.
  expect(masse.breite, `${meldung} Verschlechterung auf die Pfeil-Ikone.`).toBeGreaterThan(40);
  // Obergrenze: solange der Befund steht, bleibt der Auswähler unter der Lesbarkeitsschwelle.
  // Fällt sie, ist er BEHOBEN — dann gehören dieser Test und der Block darüber weg, und die
  // Aussage wandert als reguläre Zusicherung (`>= LESBAR`) in den 390-px-Fall daneben.
  expect(
    masse.breite,
    `${meldung} Sieht nach BEHOBEN aus — Befund-Test entfernen und die Zusicherung regulär stellen.`,
  ).toBeLessThan(LESBAR);
});

// ── MESSUNG 3 ───────────────────────────────────────────────────────────────────────────
//
// Die neue Fahrzeug-Detailseite: per Deeplink erreichbar, Sektionen da, Speicherleiste im
// Blickfeld.
//
// `toBeInViewport()` und NICHT `toBeVisible()`: ein Element unterhalb des sichtbaren
// Bereichs gilt für `toBeVisible` als sichtbar — genau der Zustand, den eine wirkungslose
// Speicherleiste hätte (CLAUDE.md, LFH-343 · C8 · H51).
//
// Und die BILDLAUFRESERVE ist die Vorbedingung des Nachweises: `position: sticky;
// bottom: 0` tut nichts, solange das Formular kürzer ist als das Sichtfeld — die Leiste
// stünde dann an ihrer natürlichen Stelle und wäre trivial im Blickfeld. Die Höhe ist
// deshalb bewusst verkürzt und die Reserve wird EIGENS geprüft (dieselbe Falle wie in
// `fokus-verdeckung.spec.ts:210`).

test('die Fahrzeug-Detailseite ist per Deeplink erreichbar und ihre Speicherleiste steht im Blickfeld', async ({
  page,
}) => {
  await anmelden(page);
  const fahrzeug = await fahrzeugAnlegen(page, `E2E Detail ${Date.now()}`);

  await page.setViewportSize({ width: 1280, height: 420 });
  // Echter Deeplink: direkt auf die Adresse, nicht über einen Klick in der Liste.
  await page.goto(`/admin/stammdaten/fahrzeuge/${fahrzeug.id}`);

  await expect(page.getByRole('heading', { name: fahrzeug.funkrufname })).toBeVisible();
  // Die vier Sektionen. Über die Überschriften-Rolle, nicht über `getByText`:
  // „Bemerkung" steht zweimal auf der Seite — als Sektionstitel UND als Feldbeschriftung.
  for (const titel of ['Identität', 'Funk & Sonderrechte', 'Kapazität', 'Bemerkung']) {
    await expect(page.getByRole('heading', { name: titel, exact: true })).toBeVisible();
  }

  const speichern = page.getByRole('button', { name: 'Speichern' });
  await expect(speichern).toBeVisible();

  // Vorbedingung: es gibt überhaupt etwas, an dem die Leiste kleben kann.
  const reserve = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(
    reserve.scrollHeight,
    `ohne Bildlaufreserve beweist toBeInViewport nichts (scrollHeight ${reserve.scrollHeight}, innerHeight ${reserve.innerHeight})`,
  ).toBeGreaterThan(reserve.innerHeight);

  // GEMESSEN bei 1280 × 420: scrollHeight 908 gegen innerHeight 420 — 488 px Reserve.
  // Ganz nach oben — dort steht die Leiste NUR durch ihr `sticky` im Blickfeld.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(speichern).toBeInViewport();
});
