import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  detailBereit,
  einheitMitZuordnungen,
  kopfFelder,
  zuordnungsKarte,
} from './einheit-fixture';
import { benutzerAnlegen, wechsleZu, wechsleZuRolle } from './rollen-kern';

/**
 * Gate 3 der Bedien-Leitlinie: Trefflächen gegen die Dichte-Staffel auf Lage-Dashboard,
 * Einsatzauswahl, Einheiten-Detailroute, Einsatz-Navigationsrahmen, Kräfteübersicht mit
 * Verdichtungszeile und Stab-Route. Alle Blöcke teilen die Helfer unten; wer etwas anhängt,
 * nimmt dieselben Helfer statt einer Kopie.
 *
 * Browser statt Vitest: Vitest fährt mit `css: false`, jsdom rechnet kein Layout. Ein
 * überschriebenes `min-height`, ein `display: inline` oder ein Wrapper ohne Staffel wären
 * dort grün; hier steht die gemessene `boundingBox()`.
 *
 * MENGEN STATT EINZELKNOTEN: wo ein Ziel bewusst mehrfach steht (Kennzahlen, Paneel-Ausgänge),
 * verlangt `alleHaltenStufe` eine MINDESTZAHL und misst jeden Knoten — ein leerer Locator wäre
 * sonst grün durch Nichtstun. Einzelknoten laufen über `haeltStufe` mit `toHaveCount(1)`.
 *
 * UNTERGRENZE, KEINE GLEICHHEIT: Polsterung und Zeilenumbruch dürfen ein Ziel größer machen,
 * nur nicht kleiner.
 *
 * DIE BÖDEN STEHEN ALS LITERALE (30 / 48 / 72), nicht aus `theme/tokens` gelesen — sonst
 * prüfte der Test den Token gegen sich selbst. Quellen: kompakt 30 px (A0) · komfortabel
 * 48 px = Material 48 dp · handschuh 72 px ≙ 19,05 mm nach MIL-STD-1472F Fig. 12.
 *
 * Die Stufe wird GESPEICHERT gestellt (nicht per `hasTouch`-Vorbelegung wie in
 * `trefflaeche-tablet.spec.ts`), damit alle drei Stufen auf demselben Kontext laufen.
 * Seeding per `page.request`, der den Cookie-Jar des Kontexts teilt.
 *
 * DIE EINSATZNAMEN tragen keinen Modulnamen (`E2E Gate3 <ts> Nr <n>`): die Kommandopalette
 * durchsucht Module und Einsätze in einer Liste, ein Modulwort im Namen ließe
 * `command-palette.spec.ts` per strict mode flaken.
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
 * Subpixel-Spielraum: `boundingBox()` liefert Fließkomma, und Chromium rundet unter Last
 * anders (47,99999809 gegen 48). Ein halbes Pixel trennt die Stufen weiterhin klar.
 */
const SUBPIXEL = 0.5;

/** Fükw-Maß aus der Bedien-Leitlinie (A1, Gate 1). */
const FUEKW = { width: 1366, height: 768 };

/** Handschirm-Maß aus A1 — unter antds `lg`, also der Drawer-Zweig des Navigationsrahmens. */
const HANDSCHIRM = { width: 390, height: 844 };

/**
 * Die Böden JE ZIEL des Navigationsrahmens, als Literale wie {@link STAFFEL}. Der Rahmen
 * trägt drei Verträge:
 *
 *  - `staffel` (30/48/72) — liest nur `token.controlHeight`: Modul-Panel-Zeilen,
 *    Palettenzeilen, Kopfzeilen-Ziele und der Suchzugang ab `lg`.
 *  - `mitA1Boden` (48/48/72) — `Math.max(48, controlHeight)`: Kategorie-Rail (Höhe UND
 *    Breite, die Spalte wächst in `handschuh` mit), Hamburger, Suchzugang unter `lg`,
 *    Akkordeon-Kopf, Modulzeilen und Schließer im Drawer. Die 48 ist BODEN unter der
 *    Staffel, deshalb misst `kompakt` hier ≥ 48.
 *  - `benutzermenue` (40/48/72) — `Math.max(40, controlHeight)`, weil der Auslöser einen
 *    28-px-Avatar trägt.
 *
 * Alle drei sind UNTERGRENZEN. Den vierten, `fest48` für Akkordeon-Kopf und Drawer-Schließer
 * (LFH-537), hat LFH-384 aufgelöst: beide folgen jetzt der Staffel.
 */
const BODEN = {
  staffel: { kompakt: 30, komfortabel: 48, handschuh: 72 },
  mitA1Boden: { kompakt: 48, komfortabel: 48, handschuh: 72 },
  benutzermenue: { kompakt: 40, komfortabel: 48, handschuh: 72 },
} as const;

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — Vertrag, kein Import. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/** `SUCHE_AB` aus `EinsaetzePage.tsx`, als Literal: fällt die Schwelle dort, fehlt das
 *  Suchfeld, und `toHaveCount(1)` sagt es laut. */
const SUCHE_AB = 8;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Einsatz per API: acht Einsätze über die UI wären 32 Formularaktionen ohne Erkenntnisgewinn. */
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
 * Stellt die Bediendichte und lädt neu — `ThemeModeProvider` liest den Speicher nur beim
 * Montieren. Die `data-dichte`-Wache trennt „Ziel zu klein" von „Stufe nicht angekommen".
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
 * trifft der Locator weniger, misst er einen Leer- oder Ladezustand. Zurück kommt das
 * kleinste Maß für die Anmerkung am Test.
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

// ── Nur-Lese-Zweig (LFH-435) ───────────────────────────────────────────────────────────
//
// Die Admin-Tests laufen nur durch die freien Zweige. Die Geschwister „… (Beobachter)" säen als
// Admin, wechseln im SELBEN Kontext auf einen Beobachter (`rollen-kern.ts`) und messen danach,
// was dem Beobachter bleibt. Reihenfolge je Stufe: erst ein DATENANKER (die Seite trägt ihre
// Daten), dann die Vorbedingungen des Zweigs, dann die Messung. Ein `toHaveCount(0)` vor dem
// Anker wäre grün durch Nichtstun — während des Ladens fehlen die Ziele ohnehin.

/** Wortanfang aller Rechtehinweise der Einsatzmodule (aktiver Einsatz, ohne Schreibrecht). */
const NUR_SCHREIBENDE = /^Nur Einsatzleitung und Führungspersonal/;

/** Der Rechtehinweis des Nur-Lese-Zweigs (`RechteHinweis`, antd `Alert` mit `role="alert"`). */
async function rechteHinweisSteht(page: Page) {
  await expect(
    page.getByRole('alert').filter({ hasText: NUR_SCHREIBENDE }),
    'Vorbedingung: der Rechtehinweis des Nur-Lese-Zweigs steht',
  ).toBeVisible();
}

/**
 * Eine gesperrte Primäraktion im Seitenkopf: gesperrt statt versteckt, also MUSS sie da und
 * gesperrt sein — und hält trotzdem die Stufe (ein gesperrtes Ziel ist ein sichtbares Ziel).
 */
async function gesperrtHaeltStufe(ziel: Locator, soll: number, name: string): Promise<number> {
  await expect(ziel, `Vorbedingung: ${name} steht gesperrt`).toBeDisabled();
  return haeltStufe(ziel, soll, name);
}

test('Lage-Dashboard: Kennzahl-Zellen und Paneel-Ausgänge folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  // Drei Stufen mit je einem Neuladen: unter Volllast der Suite reicht das Vorgabebudget nicht.
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Lage`);

  // Die Ziele stehen UNBEDINGT da: die sechs Kennzahl-Zellen des Bands „Lage in Zahlen" und
  // die drei Ausgänge in den Paneelköpfen, außerhalb der Zustandsweiche.
  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
    await stelleDichte(page, dichte);

    // Vor dem Laden stehen die Zellen als Platzhalter ohne Ziel (`div`); gemessen wird der Link.
    const kennzahlen = page
      .getByRole('group', { name: 'Lage in Zahlen' })
      .locator('a[data-lfh="kennzahl"]');
    await expect(kennzahlen).toHaveCount(6);
    const ausgaenge = page.locator('[data-lfh="lagebild-paneele"] [data-lfh="paneel-link"]');
    await expect(ausgaenge).toHaveCount(3);

    const kennzahl = await alleHaltenStufe(kennzahlen, soll, `Kennzahl-Zelle (${dichte})`, 6);
    // Drei, nicht „mindestens einer": mit `1` bliebe der Test grün, wenn zwei Paneele verschwänden.
    const ausgang = await alleHaltenStufe(ausgaenge, soll, `Paneel-Ausgang (${dichte})`, 3);

    gemessen.push(`${dichte} (Soll ≥ ${soll}): Kennzahl ${kennzahl}, Ausgang ${ausgang}`);
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Einsatzauswahl: Einsatzkarten-Titel-Link und Suchfeld folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);

  // Acht aktive Einsätze, damit das Suchfeld sicher erscheint; der erste ist die gemessene Karte.
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

    // Namentlich gegriffen, weil das Raster die Einsätze aller anderen Specs mitzeigt.
    const titelLink = page.getByRole('link', { name: kartenName, exact: true });
    const titel = await haeltStufe(titelLink, soll, `Titel-Link der Einsatzkarte (${dichte})`);
    await expect(titelLink).toHaveAttribute('href', /\/einsaetze\/\d+$/);

    // Gemessen wird die sichtbare Feldhülle, nicht das nackte `<input>` (so hoch wie seine Zeile).
    const suche = page.locator('.ant-input-search');
    await expect(suche).toHaveCount(1);
    await expect(suche.getByLabel('Einsätze durchsuchen')).toHaveCount(1);
    const feld = await haeltStufe(
      suche.locator('.ant-input-affix-wrapper'),
      soll,
      `Suchfeld (${dichte})`,
    );
    // antd 6: `.ant-input-search-btn` (nicht `-button`). Bewusst die Klasse statt
    // `getByRole('button')`: das Löschkreuz von `allowClear` trägt selbst `role="button"`.
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

// ── Einheiten-Detailroute ───────────────────────────────────────────────────────────
// Verwaltung → Führungsfunktionen (LFH-549): das Label ist eine Inline-Angabe, ihr Bearbeiten-Knopf
// ist das Bedienziel jeder Zeile. Gemessen wird er als Admin (nur dort ist er ein Ziel).
test('Führungsfunktionen: der Bearbeiten-Knopf je Zeile hält 30 / 48 / 72 px', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto('/admin/stammdaten/fuehrungsfunktionen');
    await stelleDichte(page, dichte);
    const knoepfe = page
      .getByRole('main')
      .getByRole('button', { name: /^Bezeichnung .+ bearbeiten$/ });
    // EL, S1–S6, Führungshilfspersonal, Fachberater — S7 ist ohne Schalter nicht bearbeitbar.
    const kleinstes = await alleHaltenStufe(knoepfe, soll, `Bezeichnung bearbeiten (${dichte})`, 9);
    gemessen.push(`${dichte} (Soll ≥ ${soll}): ${kleinstes}px`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// Sichtbare Feldhüllen, Zuordnungszeilen und Aktionsabstände, im Browser gemessen.

test('Einheit: Formularfelder und Zuordnungszeilen halten 30 / 48 / 72 px und den Aktionsabstand', async ({
  page,
}) => {
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
      kleinsteZeile = Math.min(
        kleinsteZeile,
        await haeltStufe(zeile, soll, `${titel}-Zuordnungszeile (${dichte})`),
      );
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
        expect(
          abstand,
          `${titel}: Abstand Aktion/Zuordnung ${dichte}, Zeilenhöhe ${r.height}`,
        ).toBeGreaterThanOrEqual((dichte === 'handschuh' ? 16 : 8) - SUBPIXEL);
      }
    }
    const speichern = page
      .getByRole('main')
      .getByRole('button', { name: 'Speichern', exact: true });
    const aufloesen = page.getByRole('main').getByRole('button', { name: 'Auflösen', exact: true });
    const neueSprechgruppe = page
      .getByRole('main')
      .getByRole('button', { name: /neue Sprechgruppe anlegen$/ });
    ziele.push(
      { name: 'Speichern', ziel: speichern },
      { name: 'Auflösen', ziel: aufloesen },
      { name: 'neue Sprechgruppe anlegen', ziel: neueSprechgruppe },
    );
    aktionsreihen.push([speichern, aufloesen]);
    const felder = kopfFelder(page);
    const staerke = ['Führer', 'Unterführer', 'Mannschaft'].map(
      (name) => felder.find((f) => f.name === name)!.huelle,
    );
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
        expect
          .soft(abstand, `Aktionsabstand ${dichte}: ${links} → ${rechts}`)
          .toBeGreaterThanOrEqual((dichte === 'handschuh' ? 16 : 8) - SUBPIXEL);
      }
    }
    // Auch die einblendbaren Sprechgruppenfelder gehören zu dieser Formularroute.
    await neueSprechgruppe.click();
    const main = page.getByRole('main');
    const bezeichnung = main.getByRole('textbox', { name: 'Neue Bezeichnung', exact: true });
    const betriebsart = main
      .locator('.ant-select')
      .filter({ has: page.getByRole('combobox', { name: 'Neue Betriebsart', exact: true }) });
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
        expect
          .soft(abstand, `Sprechgruppen-Feldabstand ${dichte}, Paar ${i}`)
          .toBeGreaterThanOrEqual((dichte === 'handschuh' ? 16 : 8) - SUBPIXEL);
      }
    }
    await abbrechen.click();
    messwerte.push(
      `${dichte}: ${ziele.length} Grundziele + 4 Sprechgruppenfelder, kleinste Achse ${minimum.toFixed(2)}px, Zuordnungszeile ${kleinsteZeile}px${dichte !== 'kompakt' ? `, Abstand ${kleinsterAbstand}px` : ''}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: messwerte.join(' | ') });
});

test('Einheit Selbstbeweis: feste Kompaktgröße fällt trotz aktiver Handschuhstufe durch', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const { pfad } = await einheitMitZuordnungen(page);
  await page.goto(pfad);
  await stelleDichte(page, 'handschuh');
  await detailBereit(page);
  const name = page.getByLabel('Name', { exact: true });
  await haeltStufe(name, 72, 'Handschuhfeld vor Mutation');
  await name.evaluate((el) => el.setAttribute('data-e2e-kompakt', 'true'));
  const mutation = await page.addStyleTag({
    content:
      '[data-e2e-kompakt] { height: 30px !important; min-height: 30px !important; max-height: 30px !important; font-size: 13px !important; line-height: 1.5 !important; padding-block: 0 !important; transition: none !important; }',
  });
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  expect((await name.boundingBox())!.height).toBe(30);
  await expect(haeltStufe(name, 72, 'Feste Kompaktgröße')).rejects.toThrow(/Feste Kompaktgröße/);
  await mutation.evaluate((el) => el.parentNode?.removeChild(el));
  // Die Wiederherstellung durchläuft wieder den normalen Dichte-Übergang.
  await expect
    .poll(async () => (await name.boundingBox())!.height)
    .toBeGreaterThanOrEqual(72 - SUBPIXEL);
  await haeltStufe(name, 72, 'Handschuhfeld nach Wiederherstellung');
});

// ── Einsatz-Navigationsrahmen ───────────────────────────────────────────────────────
//
// Der Rahmen steht auf JEDER Einsatzroute und hat zwei Gestalten (Weiche an antds `lg`):
// oberhalb Rail + Modul-Panel inline, darunter dieselbe Navigation als Akkordeon im Drawer.
// Beide brauchen einen eigenen Durchgang mit eigenem Viewport.
//
// Der Drawer ist nur als DRAWER-NUTZUNG eine benannte Ausnahme, nicht auf der Dichteachse,
// und wird deshalb mitgemessen:
//  (1) Die Modulzeilen im Drawer folgen der Staffel: `mindestTrefflaeche={48}` wird per
//      `Math.max` mit `controlHeight` verrechnet (mit `??` deckelte es `handschuh` auf 48).
//  (2) Akkordeon-Kopf und Drawer-Schließer ebenso — bis LFH-384 standen sie fest auf 48 und
//      unterschritten `handschuh` um 24 px. Der Schließer ist icon-only, deshalb beide Achsen.

test('Navigationsrahmen inline: Rail, Modul-Panel, Einsatz-Kopfzeile und Kommandopalette folgen der Staffel', async ({
  page,
}) => {
  // Drei Stufen mit je einem Neuladen plus drei Paletten-Öffnungen.
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const name = `E2E Gate3 ${Date.now()} Rahmen`;
  const einsatzId = await einsatzAnlegen(page, name);

  const gemessen: string[] = [];

  for (const { dichte } of STAFFEL) {
    // `…/personal` öffnet die Kategorie „Kräfte & Mittel": das Panel trägt ohne Klick fünf Module.
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    await stelleDichte(page, dichte);

    // Wache: der INLINE-Rahmen steht und der Drawer ist nicht im Baum — sonst wäre der Test
    // auch grün, wenn er versehentlich den Drawer misst.
    const rail = page.getByRole('navigation', { name: 'Kategorien' });
    await expect(rail, 'der inline-Rahmen steht am Fükw-Maß').toBeVisible();
    await expect(page.getByRole('button', { name: 'Navigation öffnen' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // (a) Kategorie-Rail — sechs Kategorien als Mindestmenge.
    const railZiel = await alleHaltenStufe(
      rail.locator('button'),
      BODEN.mitA1Boden[dichte],
      `Kategorie-Ziel (${dichte})`,
      6,
    );
    // Die Rail-Spalte ist fest; in `handschuh` muss sie mitwachsen, sonst bleibt das Ziel
    // 59 px breit (LFH-384). Ein Ziel genügt — alle teilen dieselbe Spaltenbreite.
    const railBreite = (await rail.locator('button').first().boundingBox())!.width;
    expect(
      railBreite,
      `Kategorie-Ziel (${dichte}, gemessen ${railBreite}px breit, Soll ≥ ${BODEN.mitA1Boden[dichte]})`,
    ).toBeGreaterThanOrEqual(BODEN.mitA1Boden[dichte] - SUBPIXEL);

    // (b) Modul-Panel — fünf freigegebene Module der Kategorie „Kräfte & Mittel".
    const panel = page.locator('[data-lfh="modul-panel"]');
    await expect(panel, 'das Modul-Panel steht am Fükw-Maß').toHaveCount(1);
    const panelZeile = await alleHaltenStufe(
      panel.locator('button'),
      BODEN.staffel[dichte],
      `Modul-Panel-Zeile (${dichte})`,
      5,
    );

    // (c) die Einsatz-Kopfzeile. Genau EINE (`EinsatzLayout` rendert seinen eigenen
    // `<Header>`); sonst wären die Kopfzeilen-Locator unten still mehrdeutig.
    const kopf = page.locator('.ant-layout-header');
    await expect(kopf, 'genau eine Kopfzeile auf der Einsatzroute').toHaveCount(1);
    // Der Einsatz-Wechsler über sein `title`: sein `DownOutlined` bringt ein englisches
    // `aria-label` mit, das im zugänglichen Namen stünde („… down").
    const wechsler = await haeltStufe(
      kopf.locator(`button[title="${name}"]`),
      BODEN.staffel[dichte],
      `Einsatz-Wechsler (${dichte})`,
    );
    // Alarm-Knöpfe per Regex: ihr Name trägt den ZUSTAND (Browser-Berechtigung, Tonfreigabe),
    // ein exakter Name pinnte eine Umgebung.
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
    // Ab `lg` hängt der Suchzugang allein an `controlHeight` — hier die Staffel, nicht der A1-Boden.
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

    // (d) die `role="option"`-Zeilen der Kommandopalette. Bei leerer Suche steht die
    // Startansicht; `boundingBox()` misst auch Einträge, die der Kasten abschneidet.
    await kopf.getByRole('button', { name: 'Suchen', exact: true }).click();
    await expect(page.getByRole('listbox'), 'die Palette ist offen').toBeVisible();
    /**
     * Erst wenn die Einblendung durch ist — per KLASSENWACHE, kein Höhen-Poll. antds `Modal`
     * zoomt von `scale(0.2)` hoch, und `boundingBox()` liefert die transformierte Box. Ein
     * Höhen-Poll ist kein Riegel: im ersten Frame steht noch `transform: none` (volle Höhe),
     * erst danach greift die Skalierung. Die `ant-zoom`-Klasse verschwindet erst, wenn
     * rc-motion fertig ist.
     */
    await expect(
      page.locator('.ant-modal'),
      'die Einblendung der Palette ist durch',
    ).not.toHaveClass(/ant-zoom/);
    /**
     * Auf die Listbox gescopt: `role="option"` vergibt auch jedes antd-`Select`-Dropdown.
     */
    const zeile = await alleHaltenStufe(
      page.getByRole('listbox').getByRole('option'),
      BODEN.staffel[dichte],
      `Palettenzeile (${dichte})`,
      5,
    );

    gemessen.push(
      `${dichte}: Rail ${railZiel}×${railBreite} (Soll ≥ ${BODEN.mitA1Boden[dichte]}), Panel ${panelZeile}, ` +
        `Wechsler ${wechsler}, Desktop ${desktop}, Ton ${ton}, Suchen ${suchen}, ` +
        `Benutzermenü ${benutzer} (Soll ≥ ${BODEN.benutzermenue[dichte]}), Palette ${zeile}`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Globale Kopfzeile: Logo, Verwaltungs-Link, Suchzugang und Benutzermenü folgen der Staffel', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  // `/einsaetze` ist die Route von `AppLayout`, der zweiten Kopfzeile. Logo und
  // Verwaltungs-Link kommen nur dort vor.
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
    // Als `admin` ist die Verwaltung frei, also ein `<Link>`; gesperrt wäre sie kein Ziel,
    // und `toHaveCount(1)` sagt das laut.
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
      `${dichte}: Logo ${logo}, Verwaltung ${verwaltung}, Suchen ${suchen}, ` +
        `Benutzermenü ${benutzer} (Soll ≥ ${BODEN.benutzermenue[dichte]})`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Globale Kopfzeile (ohne Verwaltungsrecht): Logo, Suchzugang und Benutzermenü folgen auf 1024 px der Staffel', async ({
  page,
}) => {
  // LFH-435: der gesperrte Zweig von `GlobalLink` — gedämpfter Text, ab `lg` plus Tag „Keine
  // Berechtigung". Er ist breiter als der freie Link und teilt sich die Zeile mit dem
  // Suchzugang, der ab `lg` `width: 100%` bei `minWidth: 0` trägt: er wird nicht niedriger,
  // sondern SCHMALER. Deshalb misst dieser Test den Suchzugang auf beiden Achsen. 1024 px ist
  // das Führungs-Tablet, die engste Breite, auf der der Tag steht.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await anmelden(page);
  // Ohne `org_rolle` gilt 'keiner'/'keine' — `darfVerwaltung` ist false. Mitglied eines
  // Einsatzes muss der Benutzer dafür nicht sein.
  await wechsleZu(page, await benutzerAnlegen(page, 'beobachter'));

  const gemessen: string[] = [];

  for (const { dichte } of STAFFEL) {
    await page.goto('/einsaetze');
    await stelleDichte(page, dichte);

    const kopf = page.locator('.ant-layout-header');
    await expect(kopf, 'genau eine Kopfzeile auf der Einsatzauswahl').toHaveCount(1);

    // ── VORBEDINGUNGEN: der gesperrte Zweig steht, und zwar in seiner breiten Form.
    await expect(
      page.getByRole('link', { name: 'Verwaltung' }),
      'Vorbedingung: kein freier Verwaltungs-Link — sonst misst der Test den Admin-Zweig',
    ).toHaveCount(0);
    // Präfix statt Wortlaut: ab `lg` trägt dasselbe Element den Tag mit.
    await expect(
      kopf.getByText(/^Verwaltung/),
      'Vorbedingung: der gedämpfte Eintrag steht (gesperrt statt versteckt)',
    ).toBeVisible();
    await expect(
      kopf.getByText('Keine Berechtigung'),
      'Vorbedingung: ab lg steht der Tag „Keine Berechtigung"',
    ).toHaveCount(1);

    // ── Die übrigen Kopfziele. Der gedämpfte Eintrag selbst ist kein Ziel.
    const logo = await haeltStufe(
      kopf.getByRole('link', { name: 'lifeline-hub', exact: true }),
      BODEN.staffel[dichte],
      `Logo-Link (${dichte})`,
    );
    const suchZiel = kopf.getByRole('button', { name: 'Suchen', exact: true });
    // Ab `lg` hängt der Suchzugang allein an `controlHeight` — die Staffel, nicht der A1-Boden.
    const suchen = await haeltStufe(suchZiel, BODEN.staffel[dichte], `Suchzugang (${dichte})`);
    const suchBreite = (await suchZiel.boundingBox())!.width;
    expect(
      suchBreite,
      `Suchzugang-Breite (${dichte}, gemessen ${suchBreite}px, Soll ≥ ${BODEN.staffel[dichte]}) — ` +
        'der gesperrte Verwaltungs-Eintrag darf ihn nicht zusammendrücken',
    ).toBeGreaterThanOrEqual(BODEN.staffel[dichte] - SUBPIXEL);
    const benutzer = await haeltStufe(
      kopf.getByRole('button', { name: 'Benutzermenü', exact: true }),
      BODEN.benutzermenue[dichte],
      `Benutzermenü (${dichte})`,
    );

    gemessen.push(
      `${dichte}: Logo ${logo}, Suchen ${suchen}×${suchBreite}, ` +
        `Benutzermenü ${benutzer} (Soll ≥ ${BODEN.benutzermenue[dichte]})`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Navigations-Drawer auf 390 px: Hamburger, Akkordeon-Kopf, Modulzeilen und Schließer folgen der Staffel', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Anmelden und Anlegen am Fükw-Maß, erst danach umstellen.
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
    // Beide Achsen: der icon-only-Knopf setzt `width` UND `height` aus derselben Zahl.
    const griff = await haeltStufe(hamburger, BODEN.mitA1Boden[dichte], `Hamburger (${dichte})`);
    const griffBreite = (await hamburger.boundingBox())!.width;
    expect(
      griffBreite,
      `Hamburger-Breite (${dichte}, gemessen ${griffBreite}px, Soll ≥ ${BODEN.mitA1Boden[dichte]})`,
    ).toBeGreaterThanOrEqual(BODEN.mitA1Boden[dichte] - SUBPIXEL);

    // Unter `lg` bekommt der Suchzugang seine feste Trefffläche (`Math.max(48, …)`).
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

    // Kategorie-Köpfe tragen `aria-expanded`, Modulknöpfe nicht — das trennt die zwei
    // Verträge ohne Strukturselektor.
    const koepfe = nav.locator('button[aria-expanded]');
    const kopfHoehe = await alleHaltenStufe(
      koepfe,
      BODEN.mitA1Boden[dichte],
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
    const schliesserZiel = drawer.locator('.ant-drawer-close');
    const schliesser = await haeltStufe(
      schliesserZiel,
      BODEN.mitA1Boden[dichte],
      `Drawer-Schließer (${dichte})`,
    );
    const schliesserBreite = (await schliesserZiel.boundingBox())!.width;
    expect(
      schliesserBreite,
      `Drawer-Schließer-Breite (${dichte}, gemessen ${schliesserBreite}px, Soll ≥ ${BODEN.mitA1Boden[dichte]})`,
    ).toBeGreaterThanOrEqual(BODEN.mitA1Boden[dichte] - SUBPIXEL);

    gemessen.push(
      `${dichte}: Hamburger ${griff}×${griffBreite}, Suchen ${suchen} ` +
        `(Soll ≥ ${BODEN.mitA1Boden[dichte]}), Modulzeile ${modulZeile}, ` +
        `Akkordeon-Kopf ${kopfHoehe}, Schließer ${schliesser}×${schliesserBreite}`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── Kräfteübersicht und Verdichtungszeile ────────────────────────────────────────────
//
// DER UMSCHALTER: die Hülle trägt die Staffel, das einzelne Wahlfeld liegt konstant 4 px
// darunter (antds `segmentedContainerPadding`, 2 px je Seite). Das ist kein Mangel: die
// Wahlfelder kacheln die Hülle lückenlos, und ein 72-px-Wahlfeld machte die Hülle 76 px hoch.
// Zugesichert werden deshalb die Hülle gegen den Boden und die lückenlose Kachelung.
//
// DIE FILTER-MARKE ist eine benannte Ausnahme: `Tag closable` hängt nicht am
// `ConfigProvider` (Marke 22 px, Kreuz 10×10 in jeder Stufe). Getragen wird sie davon, dass
// „Filter zurücksetzen" als vollwertiger Knopf danebensteht — steht eine Marke, MUSS dieser
// Zweitweg dastehen und den Boden halten. Die Maße der Marke werden protokolliert, nicht
// gepinnt: sie sind antd-Bestand, ein Pin bräche bei einem antd-Sprung grundlos.

/** Innenpolsterung der Segmented-Hülle je Seite (`segmentedContainerPadding`), als Literal. */
const SEGMENTED_POLSTER = 2;

test('Kräfteübersicht: Umschalter, Filterzeile und Suchfeld folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Meldebild`);

  // Ohne Kräfte hat das Meldebild keinen Baum und der Suchfilter nichts zu treffen.
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

    // Anker: die Seite ist fertig geladen.
    await expect(page.getByRole('region', { name: 'Meldebild' })).toHaveCount(1);

    // (1) Umschalter: Hülle gegen den Boden, dazu die lückenlose Kachelung.
    const huelle = page.locator('.ant-segmented');
    const umschalter = await haeltStufe(huelle, soll, `Umschalter-Hülle (${dichte})`);
    const wahlfelder = page.locator('.ant-segmented-item');
    const wahlfeld = await alleHaltenStufe(
      wahlfelder,
      soll - 2 * SEGMENTED_POLSTER,
      `Umschalter-Wahlfeld (${dichte})`,
      2,
    );
    // Lückenlos: ohne diese Hälfte wäre die Nachsicht oben ein Freibrief für ein halbhohes Wahlfeld.
    expect(
      umschalter - wahlfeld,
      `Umschalter (${dichte}): Wahlfeld kachelt die Hülle (Hülle ${umschalter}, Wahlfeld ${wahlfeld})`,
    ).toBeLessThanOrEqual(2 * SEGMENTED_POLSTER + SUBPIXEL);

    // (2) Suchfeld der Filterleiste, an der sichtbaren Feldhülle gemessen.
    const suchfeld = page.locator('.ant-input-affix-wrapper');
    const feld = await haeltStufe(suchfeld, soll, `Filter-Suchfeld (${dichte})`);

    // (3) Filter setzen — der Suchfilter kommt als einziger ohne Stammdaten aus. Über den
    //     Platzhalter gegriffen: `Input.Search` hat die Rolle `searchbox`, nicht `textbox`.
    await page.getByPlaceholder('Suche...').fill('Messkraft');
    const marke = page.locator('.ant-tag').filter({ hasText: 'Suche:' });
    await expect(marke).toHaveCount(1);

    // (4) Der Zweitweg, an dem die Ausnahme der Marke hängt: zuerst DA, dann groß genug.
    const zuruecksetzen = page.getByRole('button', { name: 'Filter zurücksetzen', exact: true });
    const knopf = await haeltStufe(zuruecksetzen, soll, `„Filter zurücksetzen" (${dichte})`);

    // (5) Die Marke selbst, protokolliert statt gepinnt.
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

test('Kräfteübersicht (Beobachter): Umschalter, Suchfeld und „Filter zurücksetzen" folgen der Staffel, Schreibziele fehlen', async ({
  page,
}) => {
  // LFH-435: der Nur-Lese-Zweig der Kräfteübersicht NIMMT WEG — Kopfknopf „Einheit" und „In
  // Lagebericht übernehmen" fehlen, die Statuszellen sind Text. Einen Rechtehinweis gibt es
  // hier nicht; der Zweig wird über die Abwesenheit belegt, gemessen wird, was bleibt.
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Meldebild Lesend`);
  await anlegen(page, einsatzId, 'personal', { adhoc: { name: 'Messkraft Gate3' } }, 'Personal');
  await anlegen(
    page,
    einsatzId,
    'fahrzeuge',
    { adhoc: { funkrufname: 'Florian Musterstadt 1/44-2' } },
    'Fahrzeug',
  );
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
    await stelleDichte(page, dichte);

    // Datenanker: die Seite steht UND die gesäten Kräfte sind angekommen (Auswahlzeile nicht
    // „0 von 0") — erst danach sagt eine Abwesenheit etwas.
    await expect(page.getByRole('region', { name: 'Meldebild' })).toHaveCount(1);
    await expect(
      page.locator('[data-lfh="meldebild-werkzeuge"]').getByText(/^[1-9]\d* von [1-9]\d* Kräften$/),
    ).toBeVisible();

    // ── VORBEDINGUNGEN: die Schreibziele fehlen.
    const kopfAktionen = page.locator('[data-lfh="seitenkopf-aktionen"]');
    await expect(
      kopfAktionen.getByTitle('Einheit anlegen (Einheiten-Seite)'),
      'Vorbedingung: ohne Schreibrecht kein Kopfknopf „Einheit"',
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'In Lagebericht übernehmen' }),
      'Vorbedingung: ohne Schreibrecht kein „In Lagebericht übernehmen"',
    ).toHaveCount(0);

    // ── Was bleibt: Umschalter, Suchfeld, nach dem Filtern „Filter zurücksetzen".
    const umschalter = await haeltStufe(
      page.locator('.ant-segmented'),
      soll,
      `Umschalter-Hülle (${dichte})`,
    );
    const wahlfeld = await alleHaltenStufe(
      page.locator('.ant-segmented-item'),
      soll - 2 * SEGMENTED_POLSTER,
      `Umschalter-Wahlfeld (${dichte})`,
      2,
    );
    const feld = await haeltStufe(
      page.locator('.ant-input-affix-wrapper'),
      soll,
      `Filter-Suchfeld (${dichte})`,
    );
    await page.getByPlaceholder('Suche...').fill('Messkraft');
    await expect(page.locator('.ant-tag').filter({ hasText: 'Suche:' })).toHaveCount(1);
    const knopf = await haeltStufe(
      page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }),
      soll,
      `„Filter zurücksetzen" (${dichte})`,
    );

    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Umschalter-Hülle ${umschalter}, Wahlfeld ${wahlfeld}, ` +
        `Suchfeld ${feld}, Zurücksetzen ${knopf}`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Verdichtungszeile: der Meldebild-Link folgt der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Verdichtung`);

  // Die Zeile rendert `null`, solange nicht beide Listen da sind; gesät wird, damit sie
  // nicht nur Nullen trägt.
  await anlegen(
    page,
    einsatzId,
    'personal',
    { adhoc: { name: 'Messkraft Verdichtung' } },
    'Personal',
  );
  await anlegen(
    page,
    einsatzId,
    'fahrzeuge',
    { adhoc: { funkrufname: 'Florian Musterstadt 2/44-1' } },
    'Fahrzeug',
  );

  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    // Die Fahrzeugseite steht für alle vier Einbauorte derselben Komponente.
    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    await stelleDichte(page, dichte);

    const link = page.getByRole('link', { name: 'Meldebild', exact: true });
    const hoehe = await haeltStufe(link, soll, `Meldebild-Link (${dichte})`);
    // Er muss auch dorthin zeigen: ein Ziel der richtigen Größe am falschen Ort bestünde sonst.
    await expect(link).toHaveAttribute('href', `/einsaetze/${einsatzId}/kraefteuebersicht`);

    gemessen.push(`${dichte} (Soll ≥ ${soll}): Link ${hoehe}`);
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── Stab ────────────────────────────────────────────────────────────────────────────
//
// Vitest belegt für `stabZeilenzielStil` nur den Inline-Style, nicht dass ein `<Link>` in
// einer `Descriptions`-Zelle die Höhe im Layout ERREICHT. Gemessen werden:
//  - die ETB-Links: „Letzte" plus je ein Link pro Historien-Eintrag. ZWEI gesäte
//    Lagebesprechungen → genau drei Links, damit die Historie als Schleife belegt ist.
//  - die Werkzeug-Links je Gruppe „Werkzeuge S…"; die Zahl kommt aus `stab/sachgebiete.ts`
//    und steht exakt, damit ein Modul, das aus der Freigabe fällt, auffällt.
//  - die sechs Knöpfe „Besetzung ändern" und die Kopfaktion „Lagebesprechung abschließen".
// Der Boden ist für alle die Staffel. Die Locator sind gescopt, sonst zögen Breadcrumb und
// Kopfzeilen-Links in die Zusicherung.

/** Zwei abgeschlossene Lagebesprechungen → Stand „Letzte" + zwei Historien-Einträge. */
const STAB_ETB_LINKS = 3;
/**
 * 3 + 3 + 3 + 3 + 0 + 2 Registry-Schlüssel aus `stab/sachgebiete.ts`, alle `fertig`, dazu die
 * Unterseiten aus `stab/unterseiten.ts`: „Funkplan“ in der S6-Zeile (LFH-548) sowie
 * „Pressearbeit“ und „Informationstelefon“ in der S5-Zeile (LFH-554), keine Module, gleicher Stil.
 */
const STAB_WERKZEUG_LINKS = 17;
/** Jede Zeile trägt jetzt eine Gruppe; S5 durch ihre zwei Unterseiten (LFH-554). */
const STAB_WERKZEUG_GRUPPEN = 6;
/** Sechs feste Sachgebietszeilen, je ein Knopf. */
const STAB_BESETZUNG_KNOEPFE = 6;
/**
 * Sieben feste Punkte der Arbeitsaufnahme (LFH-551), je ein Zeilen-Label um Box und Text. Die
 * antd-Box selbst erbt keine Steuerhöhe; das Label trägt den Boden (`checklistenZeileStil`).
 */
const STAB_CHECKLISTE_ZEILEN = 7;

/** Die Zeilen-Labels der Arbeitsaufnahme — antd rendert Box und Text als EIN `<label>`. */
function checklistenZeilen(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Arbeitsaufnahme', exact: true })
    .locator('label.ant-checkbox-wrapper');
}

test('Stab: ETB-Links, Werkzeug-Links, „Besetzung ändern", Kopfaktion und Arbeitsaufnahme folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  // Drei Stufen mit je einem Neuladen und 24 gemessenen Knoten je Stufe.
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Fuehrung`);

  // Ohne abgeschlossene Lagebesprechung gäbe es keinen ETB-Link zu messen.
  for (const nr of [1, 2]) {
    await anlegen(
      page,
      einsatzId,
      'stab/lagebesprechungen',
      { entschluss: `Lage unverändert, Maßnahmen fortführen (${nr})` },
      `Lagebesprechung ${nr}`,
    );
  }

  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/stab`);
    await stelleDichte(page, dichte);

    // Anker: beide Sektionen stehen, der Stand ist geladen und die Historie trägt zwei Einträge.
    const lage = page.getByRole('region', { name: 'Lagebesprechung', exact: true });
    const besetzung = page.getByRole('region', { name: 'Besetzung S1–S6', exact: true });
    await expect(lage).toHaveCount(1);
    await expect(besetzung).toHaveCount(1);
    const etbLinks = lage.getByRole('link', { name: /^ETB-Eintrag zu Lagebesprechung Nr\. \d+$/ });
    await expect(etbLinks).toHaveCount(STAB_ETB_LINKS);
    await expect(
      lage.getByRole('link', { name: 'ETB-Eintrag zu Lagebesprechung Nr. 1', exact: true }),
    ).toHaveCount(1);

    // (1) ETB-Links; sie müssen auch ins ETB zeigen.
    const etb = await alleHaltenStufe(etbLinks, soll, `ETB-Link (${dichte})`, STAB_ETB_LINKS);
    await expect(etbLinks.first()).toHaveAttribute(
      'href',
      new RegExp(`^/einsaetze/${einsatzId}/etb\\?eintrag=\\d+$`),
    );

    // (2) Werkzeug-Links, über ihre Gruppen gescopt.
    const gruppen = besetzung.getByRole('group', { name: /^Werkzeuge S\d$/ });
    await expect(gruppen).toHaveCount(STAB_WERKZEUG_GRUPPEN);
    const werkzeugLinks = gruppen.getByRole('link');
    await expect(werkzeugLinks).toHaveCount(STAB_WERKZEUG_LINKS);
    const werkzeug = await alleHaltenStufe(
      werkzeugLinks,
      soll,
      `Werkzeug-Link (${dichte})`,
      STAB_WERKZEUG_LINKS,
    );

    // (3) „Besetzung ändern" — der zugängliche Name trägt die Zeilenkennung.
    const aendern = besetzung.getByRole('button', { name: /^Besetzung ändern – S\d / });
    await expect(aendern).toHaveCount(STAB_BESETZUNG_KNOEPFE);
    const knopf = await alleHaltenStufe(
      aendern,
      soll,
      `„Besetzung ändern" (${dichte})`,
      STAB_BESETZUNG_KNOEPFE,
    );

    // (4) Die Kopfaktion: erst freigegeben, dann gemessen — gesperrt stünde sie ebenso hoch da.
    const kopfaktion = page
      .locator('[data-lfh="seitenkopf-aktionen"]')
      .getByRole('button', { name: 'Lagebesprechung abschließen', exact: true });
    await expect(kopfaktion).toBeEnabled();
    const kopf = await haeltStufe(kopfaktion, soll, `Kopfaktion (${dichte})`);

    // (5) Die Zeilen der Arbeitsaufnahme (LFH-551): erst bedienbar, dann gemessen.
    const zeilen = checklistenZeilen(page);
    await expect(zeilen).toHaveCount(STAB_CHECKLISTE_ZEILEN);
    await expect(zeilen.getByRole('checkbox').first()).toBeEnabled();
    const checkliste = await alleHaltenStufe(
      zeilen,
      soll,
      `Arbeitsaufnahme-Zeile (${dichte})`,
      STAB_CHECKLISTE_ZEILEN,
    );

    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): ETB-Link ${etb}, Werkzeug-Link ${werkzeug}, ` +
        `Besetzung ändern ${knopf}, Kopfaktion ${kopf}, Arbeitsaufnahme-Zeile ${checkliste}`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Stab (Beobachter): ETB-Links, Werkzeug-Links und die gesperrte Kopfaktion folgen der Staffel', async ({
  page,
}) => {
  // LFH-435: im Nur-Lese-Zweig des Stabs fehlt „Besetzung ändern" (versteckt), die Kopfaktion
  // „Lagebesprechung abschließen" steht GESPERRT, darüber der Rechtehinweis. Gemessen wird, was
  // bleibt: Lese-Links und die gesperrte Primäraktion.
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Fuehrung Lesend`);
  for (const nr of [1, 2]) {
    await anlegen(
      page,
      einsatzId,
      'stab/lagebesprechungen',
      { entschluss: `Lage unverändert, Maßnahmen fortführen (${nr})` },
      `Lagebesprechung ${nr}`,
    );
  }
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  const gemessen: string[] = [];

  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/stab`);
    await stelleDichte(page, dichte);

    // Datenanker: die ETB-Links hängen am geladenen Stand — derselbe Stand gibt im Schreibzweig
    // „Besetzung ändern" frei. Erst danach ist dessen Abwesenheit eine Aussage.
    const lage = page.getByRole('region', { name: 'Lagebesprechung', exact: true });
    const besetzung = page.getByRole('region', { name: 'Besetzung S1–S6', exact: true });
    await expect(lage).toHaveCount(1);
    await expect(besetzung).toHaveCount(1);
    const etbLinks = lage.getByRole('link', { name: /^ETB-Eintrag zu Lagebesprechung Nr\. \d+$/ });
    await expect(etbLinks).toHaveCount(STAB_ETB_LINKS);

    // ── VORBEDINGUNGEN: Rechtehinweis steht, „Besetzung ändern" fehlt.
    await rechteHinweisSteht(page);
    await expect(
      besetzung.getByRole('button', { name: /^Besetzung ändern/ }),
      'Vorbedingung: ohne Schreibrecht kein „Besetzung ändern"',
    ).toHaveCount(0);

    // ── Was bleibt.
    const etb = await alleHaltenStufe(etbLinks, soll, `ETB-Link (${dichte})`, STAB_ETB_LINKS);
    const gruppen = besetzung.getByRole('group', { name: /^Werkzeuge S\d$/ });
    await expect(gruppen).toHaveCount(STAB_WERKZEUG_GRUPPEN);
    const werkzeugLinks = gruppen.getByRole('link');
    await expect(werkzeugLinks).toHaveCount(STAB_WERKZEUG_LINKS);
    const werkzeug = await alleHaltenStufe(
      werkzeugLinks,
      soll,
      `Werkzeug-Link (${dichte})`,
      STAB_WERKZEUG_LINKS,
    );
    const kopf = await gesperrtHaeltStufe(
      page
        .locator('[data-lfh="seitenkopf-aktionen"]')
        .getByRole('button', { name: 'Lagebesprechung abschließen', exact: true }),
      soll,
      `Kopfaktion gesperrt (${dichte})`,
    );

    // Die Arbeitsaufnahme (LFH-551) steht lesend da: Vorbedingung gesperrte Boxen, dann die
    // Zeilenhöhe — ein gesperrtes Ziel ist ein sichtbares Ziel.
    const zeilen = checklistenZeilen(page);
    await expect(zeilen).toHaveCount(STAB_CHECKLISTE_ZEILEN);
    for (const box of await zeilen.getByRole('checkbox').all()) {
      await expect(box, 'Vorbedingung: ohne Schreibrecht ist jeder Haken gesperrt').toBeDisabled();
    }
    const checkliste = await alleHaltenStufe(
      zeilen,
      soll,
      `Arbeitsaufnahme-Zeile gesperrt (${dichte})`,
      STAB_CHECKLISTE_ZEILEN,
    );

    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): ETB-Link ${etb}, Werkzeug-Link ${werkzeug}, Kopfaktion gesperrt ${kopf}, ` +
        `Arbeitsaufnahme-Zeile gesperrt ${checkliste}`,
    );
  }

  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── Funkplan (LFH-548) ──────────────────────────────────────────────────────────────────
//
// Handgebaute Ziele: die Titel-Links der Baumtabelle (`Datensicht`, `minHeight`
// `controlHeight`) und die Verweise der Lücken (`stabZeilenzielStil`). Dazu die antd-Knöpfe der
// Werkzeugzeile. Gesät wird je Ebene eine Zeile und je Lücke ein Treffer mit Verweis.

// ── Presse und Informationstelefon S5 (LFH-554) ──────────────────────────────────────
//
// Gemessen werden die Ziele, die Vitest nur als Stil belegt: der Titel-Link der
// Pressemitteilung (`stabZeilenzielStil`), der Sprung „Vermisste ↗“, die Statusanzeigen als
// Auslöser (`StatusWahl`) und die antd-Knöpfe (Kopfaktionen, „Beantworten“, „Erfassen“).

async function presseSaeen(page: Page, einsatzId: string) {
  await anlegen(
    page,
    einsatzId,
    'stab/medienkontakte',
    { art: 'anfrage', medium: 'NDR 1', thema: 'Evakuierte' },
    'Medienkontakt',
  );
  await anlegen(
    page,
    einsatzId,
    'stab/pressemitteilungen',
    { vorlage: 'freitext', titel: 'Hochwasser Musterstadt' },
    'Pressemitteilung',
  );
  await anlegen(
    page,
    einsatzId,
    'stab/infotelefon',
    {
      anliegen: 'vermisstensuche',
      notiz: 'sucht Vater',
      rueckruf: '0171 000',
      rueckruf_noetig: true,
    },
    'Anruf',
  );
}

test('Presse S5: Kopfaktionen, Titel-Link, Statusauslöser, „Beantworten“ und die Telefon-Erfassung folgen der Staffel', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Presse`);
  await presseSaeen(page, einsatzId);

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/stab/presse`);
    await stelleDichte(page, dichte);
    await expect(page.getByText('NDR 1 · Evakuierte')).toHaveCount(1);
    const kopf = page.locator('[data-lfh="seitenkopf-aktionen"]');
    const aktionen = await alleHaltenStufe(
      kopf.getByRole('button'),
      soll,
      `Kopfaktion (${dichte})`,
      2,
    );
    const titel = await haeltStufe(
      page.getByRole('link', { name: 'Hochwasser Musterstadt', exact: true }),
      soll,
      `Titel-Link (${dichte})`,
    );
    const status = await haeltStufe(
      page.getByRole('button', { name: 'Status von NDR 1 · Evakuierte ändern' }),
      soll,
      `Statusauslöser (${dichte})`,
    );
    const beantworten = await haeltStufe(
      page.getByRole('button', { name: 'Anfrage von NDR 1 beantworten' }),
      soll,
      `Beantworten (${dichte})`,
    );

    await page.goto(`/einsaetze/${einsatzId}/stab/infotelefon`);
    await expect(page.getByText('sucht Vater')).toHaveCount(1);
    const erfassen = await haeltStufe(
      page.getByRole('button', { name: 'Erfassen', exact: true }),
      soll,
      `Erfassen (${dichte})`,
    );
    const anrufStatus = await haeltStufe(
      page.getByRole('button', { name: /^Status von Anruf Vermisstensuche .* ändern$/ }),
      soll,
      `Anruf-Status (${dichte})`,
    );
    const vermisste = await haeltStufe(
      page.getByRole('link', { name: /Vermisste/ }),
      soll,
      `Vermisste (${dichte})`,
    );
    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Kopf ${aktionen}, Titel ${titel}, Status ${status}, ` +
        `Beantworten ${beantworten}, Erfassen ${erfassen}, Anruf-Status ${anrufStatus}, Vermisste ${vermisste}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Presse S5 (Beobachter): Titel-Link und „Vermisste ↗“ folgen der Staffel, Auslöser fehlen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Presse Lesend`);
  await presseSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/stab/presse`);
    await stelleDichte(page, dichte);
    await expect(page.getByText('NDR 1 · Evakuierte')).toHaveCount(1);
    // Vorbedingung: der Rollenzweig steht, bevor gemessen wird.
    await expect(
      page.getByRole('button', { name: 'Anfrage von NDR 1 beantworten' }),
      'Vorbedingung: ohne Schreibrecht kein „Beantworten“',
    ).toHaveCount(0);
    const titel = await haeltStufe(
      page.getByRole('link', { name: 'Hochwasser Musterstadt', exact: true }),
      soll,
      `Titel-Link (${dichte})`,
    );

    await page.goto(`/einsaetze/${einsatzId}/stab/infotelefon`);
    await expect(page.getByText('sucht Vater')).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Erfassen', exact: true }),
      'Vorbedingung: ohne Schreibrecht keine Erfassung',
    ).toHaveCount(0);
    const vermisste = await haeltStufe(
      page.getByRole('link', { name: /Vermisste/ }),
      soll,
      `Vermisste (${dichte})`,
    );
    gemessen.push(`${dichte} (Soll ≥ ${soll}): Titel ${titel}, Vermisste ${vermisste}`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

/** Abschnitt, Einheit und Fahrzeug: drei Titel-Links in der Tabelle. */
const FUNKPLAN_TITEL_LINKS = 3;
/** Abschnitt ohne Sprechgruppe, Einheit ohne Sprechgruppe, Einheit ohne Erreichbarkeit. */
const FUNKPLAN_LUECKEN_LINKS = 3;

async function funkplanSaeen(page: Page, einsatzId: string) {
  const post = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  };
  const abschnitt = await post('abschnitte', { name: 'Abschnitt Nord' });
  const einheit = await post('einheiten', { name: '1. Zug', abschnitt_id: abschnitt });
  const fahrzeug = await post('fahrzeuge', { adhoc: { funkrufname: 'Florian 1/42-1' } });
  const zuordnung = await page.request.put(
    `/api/einsaetze/${einsatzId}/einheiten/${einheit}/fahrzeug/${fahrzeug}`,
  );
  expect(zuordnung.ok(), `Zuordnung: ${await zuordnung.text()}`).toBeTruthy();
}

test('Funkplan: Titel-Links, Lücken-Verweise und Werkzeugknöpfe folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Funkplan`);
  await funkplanSaeen(page, einsatzId);

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/stab/funkplan`);
    await stelleDichte(page, dichte);
    const tabelle = page.getByRole('region', { name: 'Funkplan', exact: true });
    const luecken = page.getByRole('region', { name: 'Lücken', exact: true });
    // Datenanker: das Fahrzeug steht erst, wenn alle drei Ebenen geladen sind.
    await expect(tabelle.getByRole('link', { name: 'Florian 1/42-1' })).toHaveCount(1);

    const titel = await alleHaltenStufe(
      tabelle.locator('tr.ant-table-row').getByRole('link'),
      soll,
      `Titel-Link (${dichte})`,
      FUNKPLAN_TITEL_LINKS,
    );
    const verweise = await alleHaltenStufe(
      luecken.getByRole('link'),
      soll,
      `Lücken-Verweis (${dichte})`,
      FUNKPLAN_LUECKEN_LINKS,
    );
    const uebernahme = await haeltStufe(
      page.getByRole('button', { name: 'In Lagebericht übernehmen', exact: true }),
      soll,
      `Übernahme (${dichte})`,
    );
    const druck = await haeltStufe(
      page.getByRole('button', { name: /Drucken/ }),
      soll,
      `Drucken (${dichte})`,
    );
    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Titel-Link ${titel}, Lücken-Verweis ${verweise}, ` +
        `Übernahme ${uebernahme}, Drucken ${druck}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Funkplan (Beobachter): Titel-Links, Lücken-Verweise und Drucken folgen der Staffel, die Übernahme fehlt', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Funkplan Lesend`);
  await funkplanSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/stab/funkplan`);
    await stelleDichte(page, dichte);
    const tabelle = page.getByRole('region', { name: 'Funkplan', exact: true });
    await expect(tabelle.getByRole('link', { name: 'Florian 1/42-1' })).toHaveCount(1);
    // Vorbedingung: der Rollenzweig steht, bevor gemessen wird.
    await expect(
      page.getByRole('button', { name: 'In Lagebericht übernehmen' }),
      'Vorbedingung: ohne Schreibrecht keine Übernahme',
    ).toHaveCount(0);

    const titel = await alleHaltenStufe(
      tabelle.locator('tr.ant-table-row').getByRole('link'),
      soll,
      `Titel-Link (${dichte})`,
      FUNKPLAN_TITEL_LINKS,
    );
    const verweise = await alleHaltenStufe(
      page.getByRole('region', { name: 'Lücken', exact: true }).getByRole('link'),
      soll,
      `Lücken-Verweis (${dichte})`,
      FUNKPLAN_LUECKEN_LINKS,
    );
    const druck = await haeltStufe(
      page.getByRole('button', { name: /Drucken/ }),
      soll,
      `Drucken (${dichte})`,
    );
    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Titel-Link ${titel}, Lücken-Verweis ${verweise}, Drucken ${druck}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── Ablösung ─────────────────────────────────────────────────────────────────────────
//
// Nur antd-`Button`, gemessen wird trotzdem: die Karte ist eine eigene Flex-Hülle, ein
// `align-items`/Schrumpfen darin drückte die Knöpfe unter den Boden, ohne dass eine
// Größen-Prop im Quelltext stünde. ZWEI Schichten, damit die Karten als Schleife belegt sind.

test('Ablösung: Kartenaktionen und Vorgabe-Knopf folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Abloesung`);

  const post = async (pfad: string, data: unknown, was: string) => {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  const abschnitt = await post('abschnitte', { name: 'Deichwache Nord' }, 'Abschnitt');
  for (const name of ['Florian Nord 1', 'Florian Nord 2']) {
    const einheit = await post('einheiten', { name, abschnitt_id: abschnitt.id }, name);
    await post('abloesungen', { einheit_id: einheit.id, rhythmus_minuten: 360 }, `Schicht ${name}`);
  }

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await stelleDichte(page, dichte);

    const karten = page.locator('[data-lfh="abloesung-karte"]');
    await expect(karten).toHaveCount(2);
    const vollziehen = karten.getByRole('button', { name: 'Ablösung vollziehen', exact: true });
    const primaer = await alleHaltenStufe(vollziehen, soll, `Vollziehen (${dichte})`, 2);
    const menue = karten.getByRole('button', { name: /^Aktionen zu Florian Nord \d$/ });
    const dreipunkt = await alleHaltenStufe(menue, soll, `Dreipunkt (${dichte})`, 2);
    const vorgabe = await haeltStufe(
      page.getByRole('button', { name: 'Rhythmus-Vorgabe Deichwache Nord ändern', exact: true }),
      soll,
      `Vorgabe-Knopf (${dichte})`,
    );
    // Abstand Kartenaktion ↔ Dreipunkt: im Handschuh-Betrieb ≥ 16 px (MIL-STD-1472F Fig. 24
    // [abgeleitet]). Gemessen an der ersten Karte.
    const links = (await vollziehen.first().boundingBox())!;
    const rechts = (await menue.first().boundingBox())!;
    const luecke = Math.round(rechts.x - (links.x + links.width));
    if (dichte === 'handschuh') {
      expect(
        luecke,
        `Abstand Kartenaktionen (handschuh, gemessen ${luecke}px)`,
      ).toBeGreaterThanOrEqual(16);
    }
    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Vollziehen ${primaer}, Dreipunkt ${dreipunkt}, Vorgabe ${vorgabe}, Abstand ${luecke}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Ablösung (Beobachter): gesperrte Primäraktion und Ansichtsleiste folgen der Staffel, Kartenaktionen fehlen', async ({
  page,
}) => {
  // LFH-435: ohne Schreibrecht steht „Schicht beginnen" GESPERRT im Kopf, darüber der
  // Rechtehinweis; Kartenaktionen und der Vorgabe-Knopf fehlen. Gemessen werden die gesperrte
  // Primäraktion und die Segmente der Ansichtsleiste — die Ziele, die dem Beobachter bleiben.
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Abloesung Lesend`);

  const post = async (pfad: string, data: unknown, was: string) => {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  const abschnitt = await post('abschnitte', { name: 'Deichwache Nord' }, 'Abschnitt');
  for (const name of ['Florian Nord 1', 'Florian Nord 2']) {
    const einheit = await post('einheiten', { name, abschnitt_id: abschnitt.id }, name);
    await post('abloesungen', { einheit_id: einheit.id, rhythmus_minuten: 360 }, `Schicht ${name}`);
  }
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await stelleDichte(page, dichte);

    // Datenanker: beide Karten und die Vorgabezeile des Abschnitts sind geladen.
    const karten = page.locator('[data-lfh="abloesung-karte"]');
    await expect(karten).toHaveCount(2);
    await expect(
      page
        .getByRole('region', { name: 'Rhythmus je Abschnitt', exact: true })
        .getByText('Deichwache Nord', { exact: true }),
    ).toBeVisible();

    // ── VORBEDINGUNGEN: Rechtehinweis steht, Karten- und Vorgabeaktionen fehlen.
    await rechteHinweisSteht(page);
    await expect(
      karten.getByRole('button'),
      'Vorbedingung: ohne Schreibrecht tragen die Karten keine Aktionen',
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^Rhythmus-Vorgabe .* ändern$/ }),
      'Vorbedingung: ohne Schreibrecht kein Vorgabe-Knopf',
    ).toHaveCount(0);

    // ── Was bleibt: die gesperrte Primäraktion und die zwei Segmente der Ansichtsleiste
    //    (`role="radio"`, deshalb per Struktur gegriffen, nicht per `getByRole('button')`).
    const kopf = await gesperrtHaeltStufe(
      page
        .locator('[data-lfh="seitenkopf-aktionen"]')
        .getByRole('button', { name: 'Schicht beginnen', exact: true }),
      soll,
      `„Schicht beginnen" gesperrt (${dichte})`,
    );
    const segmente = page.locator(
      '[data-lfh="abloesung-werkzeugzeile"] [data-lfh="segmentleiste"] button',
    );
    await expect(segmente).toHaveCount(2);
    const segment = await alleHaltenStufe(segmente, soll, `Ansichts-Segment (${dichte})`, 2);

    gemessen.push(`${dichte} (Soll ≥ ${soll}): Primär gesperrt ${kopf}, Segment ${segment}`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── Betreuung ────────────────────────────────────────────────────────────────────────
//
// Bezirke als Karten (`Datensicht`), Stellen als Tabelle, nur antd-`Button`. Gemessen wird
// trotzdem: der Menü-Auslöser `weitere` steht in der Aktionsleiste von `ListenEintrag`, und
// in der Tabellenzelle entscheidet der Abstand im `Space wrap` (≥ 16 px im Handschuh-Betrieb).
//
// Gesät: ZWEI Bezirke und DREI Stellen, davon eine geschlossen — dort entfällt „Belegung
// melden", der Dreipunkt bleibt. Namen ohne „Betreuung", weil die Palette Module und Einsätze
// gemeinsam durchsucht.

test('Betreuung: Karten- und Zeilenaktionen folgen der Dichte-Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Raeumung`);

  const senden = async (methode: 'post' | 'patch', pfad: string, data: unknown, was: string) => {
    const antwort = await page.request[methode](`/api/einsaetze/${einsatzId}/betreuung/${pfad}`, {
      data,
    });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  const BEZIRKE = ['Deichweg 1–9', 'Uferstraße 12–40'];
  for (const bezeichnung of BEZIRKE) {
    const bezirk = await senden(
      'post',
      'bezirke',
      { bezeichnung, plan_personen: 640, plan_erhebung: 'geschaetzt' },
      `Bezirk ${bezeichnung}`,
    );
    await senden(
      'post',
      `bezirke/${bezirk.id}/staende`,
      { evakuiert: 212, erhebung: 'gezaehlt' },
      'Stand',
    );
  }
  const OFFEN = ['Turnhalle Ost', 'Gemeindehaus Süd'];
  for (const bezeichnung of OFFEN) {
    const stelle = await senden(
      'post',
      'stellen',
      { bezeichnung, art: 'notunterkunft', kapazitaet_personen: 150 },
      `Stelle ${bezeichnung}`,
    );
    await senden('patch', `stellen/${stelle.id}`, { status: 'in_betrieb' }, 'Status');
    await senden('post', `stellen/${stelle.id}/belegungen`, { belegt: 140 }, 'Belegung');
  }
  // Ohne Meldung darf eine Stelle schließen.
  const zu = await senden(
    'post',
    'stellen',
    { bezeichnung: 'Schule Nord', art: 'anlaufstelle' },
    'Stelle Schule Nord',
  );
  await senden('patch', `stellen/${zu.id}`, { status: 'geschlossen' }, 'Schließen');

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/betreuung`);
    await stelleDichte(page, dichte);

    const karten = page
      .getByRole('region', { name: 'Evakuierungsbezirke' })
      .locator('[data-lfh="datensicht-karte"]');
    await expect(karten).toHaveCount(2);
    const standMelden = karten.getByRole('button', { name: /^Stand melden für Bezirk / });
    const karteMenue = karten.getByRole('button', { name: /^Aktionen zu Bezirk / });
    // GENAUE Zahlen vor der Messung: `alleHaltenStufe` prüft nur eine Untergrenze und bliebe
    // grün, wenn die geschlossene Stelle doch „Belegung melden" trüge.
    await expect(standMelden).toHaveCount(2);
    await expect(karteMenue).toHaveCount(2);
    const karteStand = await alleHaltenStufe(standMelden, soll, `Stand melden (${dichte})`, 2);
    const karteDrei = await alleHaltenStufe(karteMenue, soll, `Dreipunkt Bezirk (${dichte})`, 2);

    const tabelle = page.getByRole('region', { name: 'Betreuungsstellen' });
    await expect(tabelle.locator('tr[data-row-key^="stelle-"]')).toHaveCount(3);
    const belegung = tabelle.getByRole('button', { name: /^Belegung melden für / });
    const zeileMenue = tabelle.getByRole('button', { name: /^Aktionen zu Stelle / });
    await expect(belegung).toHaveCount(2);
    await expect(zeileMenue).toHaveCount(3);
    const zeileBelegung = await alleHaltenStufe(belegung, soll, `Belegung melden (${dichte})`, 2);
    // Drei, nicht zwei: auch die geschlossene Stelle behält ihr Menü.
    const zeileDrei = await alleHaltenStufe(zeileMenue, soll, `Dreipunkt Stelle (${dichte})`, 3);

    const kopf = await haeltStufe(
      page
        .locator('[data-lfh="seitenkopf-aktionen"]')
        .getByRole('button', { name: 'Evakuierungsbezirk anlegen', exact: true }),
      soll,
      `Kopfaktion (${dichte})`,
    );
    const stelleAnlegen = await haeltStufe(
      page.getByRole('button', { name: 'Betreuungsstelle anlegen', exact: true }),
      soll,
      `Betreuungsstelle anlegen (${dichte})`,
    );

    // Der Aufklapp-Auslöser „Verlauf" an jeder Karte und Zeile, dazu „Zurücknehmen" im
    // aufgeklappten Verlauf.
    const verlaufKarte = karten.getByRole('button', { name: /^Verlauf zu Bezirk / });
    const verlaufZeile = tabelle.getByRole('button', { name: /^Verlauf zu Stelle / });
    await expect(verlaufKarte).toHaveCount(2);
    await expect(verlaufZeile).toHaveCount(3);
    const vKarte = await alleHaltenStufe(verlaufKarte, soll, `Verlauf Bezirk (${dichte})`, 2);
    const vZeile = await alleHaltenStufe(verlaufZeile, soll, `Verlauf Stelle (${dichte})`, 3);
    await verlaufKarte.first().click();
    const zurueck = karten.first().getByRole('button', { name: /zurücknehmen$/ });
    const vZurueck = await haeltStufe(zurueck, soll, `Zurücknehmen im Verlauf (${dichte})`);
    gemessen.push(
      `${dichte}: Verlauf Bezirk ${vKarte}, Verlauf Stelle ${vZeile}, Zurücknehmen ${vZurueck}`,
    );

    // Abstand Primäraktion ↔ Dreipunkt an der ersten Karte bzw. Zeile: im Handschuh-Betrieb
    // ≥ 16 px (MIL-STD-1472F Fig. 24 [abgeleitet]).
    const luecke = async (links: Locator, rechts: Locator) => {
      const l = (await links.boundingBox())!;
      const r = (await rechts.boundingBox())!;
      return Math.round(r.x - (l.x + l.width));
    };
    const lueckeKarte = await luecke(standMelden.first(), karteMenue.first());
    const lueckeZeile = await luecke(belegung.first(), zeileMenue.first());
    if (dichte === 'handschuh') {
      expect(
        lueckeKarte,
        `Abstand Kartenaktionen (handschuh, gemessen ${lueckeKarte}px)`,
      ).toBeGreaterThanOrEqual(16);
      expect(
        lueckeZeile,
        `Abstand Zeilenaktionen (handschuh, gemessen ${lueckeZeile}px)`,
      ).toBeGreaterThanOrEqual(16);
    }
    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Stand melden ${karteStand}, Dreipunkt Bezirk ${karteDrei}, ` +
        `Belegung melden ${zeileBelegung}, Dreipunkt Stelle ${zeileDrei}, Kopf ${kopf}, ` +
        `Stelle anlegen ${stelleAnlegen}, Abstand Karte ${lueckeKarte}, Abstand Zeile ${lueckeZeile}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Betreuung (Beobachter): gesperrte Anlage-Knöpfe und Verlaufs-Auslöser folgen der Staffel, Meldeaktionen fehlen', async ({
  page,
}) => {
  // LFH-435: ohne Schreibrecht stehen „Evakuierungsbezirk anlegen" (Kopf) und
  // „Betreuungsstelle anlegen" (Block) GESPERRT, darüber der Rechtehinweis. „Stand melden",
  // „Belegung melden", beide Dreipunkte (die Bezirke haben keine Fläche, also kein „Auf Karte
  // zeigen") und „Zurücknehmen" im Verlauf fehlen. Die Verlaufs-Auslöser bleiben — Aufklappen
  // ist Lesen.
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Raeumung Lesend`);

  const senden = async (methode: 'post' | 'patch', pfad: string, data: unknown, was: string) => {
    const antwort = await page.request[methode](`/api/einsaetze/${einsatzId}/betreuung/${pfad}`, {
      data,
    });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  // Dieselbe Saat wie im Admin-Test: die Stände geben dem Verlauf Einträge, an denen
  // „Zurücknehmen" fehlen KANN; die offenen Stellen tragen Belegungen.
  for (const bezeichnung of ['Deichweg 1–9', 'Uferstraße 12–40']) {
    const bezirk = await senden(
      'post',
      'bezirke',
      { bezeichnung, plan_personen: 640, plan_erhebung: 'geschaetzt' },
      `Bezirk ${bezeichnung}`,
    );
    await senden(
      'post',
      `bezirke/${bezirk.id}/staende`,
      { evakuiert: 212, erhebung: 'gezaehlt' },
      'Stand',
    );
  }
  for (const bezeichnung of ['Turnhalle Ost', 'Gemeindehaus Süd']) {
    const stelle = await senden(
      'post',
      'stellen',
      { bezeichnung, art: 'notunterkunft', kapazitaet_personen: 150 },
      `Stelle ${bezeichnung}`,
    );
    await senden('patch', `stellen/${stelle.id}`, { status: 'in_betrieb' }, 'Status');
    await senden('post', `stellen/${stelle.id}/belegungen`, { belegt: 140 }, 'Belegung');
  }
  const zu = await senden(
    'post',
    'stellen',
    { bezeichnung: 'Schule Nord', art: 'anlaufstelle' },
    'Stelle Schule Nord',
  );
  await senden('patch', `stellen/${zu.id}`, { status: 'geschlossen' }, 'Schließen');
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/betreuung`);
    await stelleDichte(page, dichte);

    // Datenanker: zwei Bezirkskarten und drei Stellenzeilen sind geladen.
    const karten = page
      .getByRole('region', { name: 'Evakuierungsbezirke' })
      .locator('[data-lfh="datensicht-karte"]');
    await expect(karten).toHaveCount(2);
    const tabelle = page.getByRole('region', { name: 'Betreuungsstellen' });
    await expect(tabelle.locator('tr[data-row-key^="stelle-"]')).toHaveCount(3);

    // ── VORBEDINGUNGEN: Rechtehinweis steht, die Meldeaktionen fehlen.
    await rechteHinweisSteht(page);
    for (const [ziel, was] of [
      [karten.getByRole('button', { name: /^Stand melden für Bezirk / }), '„Stand melden"'],
      [karten.getByRole('button', { name: /^Aktionen zu Bezirk / }), 'Dreipunkt Bezirk'],
      [tabelle.getByRole('button', { name: /^Belegung melden für / }), '„Belegung melden"'],
      [tabelle.getByRole('button', { name: /^Aktionen zu Stelle / }), 'Dreipunkt Stelle'],
    ] as const) {
      await expect(ziel, `Vorbedingung: ohne Schreibrecht kein ${was}`).toHaveCount(0);
    }

    // ── Was bleibt: die zwei gesperrten Anlage-Knöpfe und die Verlaufs-Auslöser.
    const kopf = await gesperrtHaeltStufe(
      page
        .locator('[data-lfh="seitenkopf-aktionen"]')
        .getByRole('button', { name: 'Evakuierungsbezirk anlegen', exact: true }),
      soll,
      `Kopfaktion gesperrt (${dichte})`,
    );
    const stelleAnlegen = await gesperrtHaeltStufe(
      page.getByRole('button', { name: 'Betreuungsstelle anlegen', exact: true }),
      soll,
      `„Betreuungsstelle anlegen" gesperrt (${dichte})`,
    );
    const verlaufKarte = karten.getByRole('button', { name: /^Verlauf zu Bezirk / });
    const verlaufZeile = tabelle.getByRole('button', { name: /^Verlauf zu Stelle / });
    await expect(verlaufKarte).toHaveCount(2);
    await expect(verlaufZeile).toHaveCount(3);
    const vKarte = await alleHaltenStufe(verlaufKarte, soll, `Verlauf Bezirk (${dichte})`, 2);
    const vZeile = await alleHaltenStufe(verlaufZeile, soll, `Verlauf Stelle (${dichte})`, 3);

    // Aufgeklappt: erst der Verlaufseintrag (Anker), dann fehlt „Zurücknehmen".
    await verlaufKarte.first().click();
    await expect(karten.first().locator('[data-lfh="verlauf-eintrag"]').first()).toBeVisible();
    await expect(
      karten.first().getByRole('button', { name: /zurücknehmen/i }),
      'Vorbedingung: ohne Schreibrecht kein „Zurücknehmen" im Verlauf',
    ).toHaveCount(0);

    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Kopf gesperrt ${kopf}, Stelle anlegen gesperrt ${stelleAnlegen}, ` +
        `Verlauf Bezirk ${vKarte}, Verlauf Stelle ${vZeile}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── Verpflegung ──────────────────────────────────────────────────────────────────────
//
// Nur antd-`Button`, gemessen wird wegen der eigenen Flex-Hüllen (Aktionszeile der Karte,
// Aktionsspalte des `Zeitachseneintrag`). ZWEI Karten, damit BEIDE Aktionsformen stehen:
//  - „Frühstück Deich": Fehlmenge, KEINE Ausgabe → drei oder mehr Aktionen, also Menü. Ohne
//    Ausgabe, sonst hinge die dritte Aktion allein an „Nachfordern" und damit an einer
//    Abfrage, die erst nach dem ersten Bild eintrifft.
//  - „Mittag Deich": gedeckt durch zwei Ausgaben → „Bedarf bearbeiten" als zweiter Knopf,
//    dazu zwei „Zurücknehmen".
// Namen ohne den Modulnamen; jeder Namens-Regex endet mit dem Leerzeichen vor dem Zeitraum.

test('Verpflegung: Kartenaktionen folgen der Dichte-Staffel 30 / 48 / 72 px', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Essen`);

  const post = async (pfad: string, data: unknown, was: string) => {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/verpflegung/${pfad}`, {
      data,
    });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  const jetzt = Date.now();
  const zeit = (minuten: number) => new Date(jetzt + minuten * 60_000).toISOString();
  await post(
    'zeitfenster',
    {
      bezeichnung: 'Frühstück Deich',
      von_at: zeit(-30),
      bis_at: zeit(90),
      bedarf_kraefte: 60,
      bedarf_betreute: 20,
    },
    'Zeitfenster Frühstück',
  );
  const mittag = await post(
    'zeitfenster',
    {
      bezeichnung: 'Mittag Deich',
      von_at: zeit(-10),
      bis_at: zeit(110),
      bedarf_kraefte: 30,
      bedarf_betreute: 10,
    },
    'Zeitfenster Mittag',
  );
  for (const minuten of [-8, -4]) {
    await post(
      `zeitfenster/${mittag.id}/ausgaben`,
      { menge: 20, zeitpunkt_at: zeit(minuten), ort: 'Feldküche Nord' },
      'Ausgabe',
    );
  }

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/verpflegung`);
    await stelleDichte(page, dichte);

    const fruehstueck = page.getByRole('article', { name: /^Zeitfenster Frühstück Deich / });
    const mittagKarte = page.getByRole('article', { name: /^Zeitfenster Mittag Deich / });
    await expect(page.locator('[data-lfh="verpflegung-karte"]')).toHaveCount(2);
    await expect(fruehstueck).toHaveAttribute('data-einstufung', 'unterdeckung');
    await expect(mittagKarte).toHaveAttribute('data-einstufung', 'gedeckt');

    const erfassen = page.getByRole('button', { name: /^Ausgabe erfassen zu \S.* / });
    const menue = fruehstueck.getByRole('button', {
      name: /^Aktionen zu Zeitfenster Frühstück Deich /,
    });
    const bearbeiten = mittagKarte.getByRole('button', {
      name: /^Bedarf bearbeiten zu Mittag Deich /,
    });
    const zuruecknehmen = mittagKarte.getByRole('button', {
      name: /^Zurücknehmen: Ausgabe 20 EP um \d\d:\d\d zu Mittag Deich /,
    });
    // GENAUE Zahlen vor der Messung: `alleHaltenStufe` prüft nur eine Untergrenze.
    await expect(erfassen).toHaveCount(2);
    await expect(menue).toHaveCount(1);
    await expect(fruehstueck.getByRole('button', { name: /^Bedarf bearbeiten zu / })).toHaveCount(
      0,
    );
    await expect(bearbeiten).toHaveCount(1);
    await expect(mittagKarte.getByRole('button', { name: /^Aktionen zu / })).toHaveCount(0);
    await expect(zuruecknehmen).toHaveCount(2);

    const primaer = await alleHaltenStufe(erfassen, soll, `Ausgabe erfassen (${dichte})`, 2);
    const dreipunkt = await haeltStufe(menue, soll, `Dreipunkt (${dichte})`);
    const zweiter = await haeltStufe(bearbeiten, soll, `Bedarf bearbeiten (${dichte})`);
    const zurueck = await alleHaltenStufe(zuruecknehmen, soll, `Zurücknehmen (${dichte})`, 2);
    const kopf = await haeltStufe(
      page
        .locator('[data-lfh="seitenkopf-aktionen"]')
        .getByRole('button', { name: 'Zeitfenster anlegen', exact: true }),
      soll,
      `Kopfaktion (${dichte})`,
    );

    // Abstand Kartenaktion ↔ Nachbar: im Handschuh-Betrieb ≥ 16 px (MIL-STD-1472F Fig. 24
    // [abgeleitet]); „Zurücknehmen" gegen JEDES andere Bedienziel der Karte.
    const luecke = async (links: Locator, rechts: Locator) => {
      const l = (await links.boundingBox())!;
      const r = (await rechts.boundingBox())!;
      return Math.round(r.x - (l.x + l.width));
    };
    const lueckeMenue = await luecke(
      fruehstueck.getByRole('button', { name: /^Ausgabe erfassen zu / }),
      menue,
    );
    const lueckeKnopf = await luecke(
      mittagKarte.getByRole('button', { name: /^Ausgabe erfassen zu / }),
      bearbeiten,
    );
    const lueckeZurueck = Math.round(await abstandZuNachbarn(mittagKarte, zuruecknehmen.first()));
    if (dichte === 'handschuh') {
      expect(
        lueckeMenue,
        `Abstand „Ausgabe erfassen" ↔ Dreipunkt (handschuh, gemessen ${lueckeMenue}px)`,
      ).toBeGreaterThanOrEqual(16);
      expect(
        lueckeKnopf,
        `Abstand „Ausgabe erfassen" ↔ „Bedarf bearbeiten" (handschuh, gemessen ${lueckeKnopf}px)`,
      ).toBeGreaterThanOrEqual(16);
      expect(
        lueckeZurueck,
        `Abstand „Zurücknehmen" ↔ nächstes Ziel der Karte (handschuh, gemessen ${lueckeZurueck}px)`,
      ).toBeGreaterThanOrEqual(16);
    }
    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Ausgabe erfassen ${primaer}, Dreipunkt ${dreipunkt}, ` +
        `Bedarf bearbeiten ${zweiter}, Zurücknehmen ${zurueck}, Kopf ${kopf}, ` +
        `Abstand Menü ${lueckeMenue}, Abstand Knopf ${lueckeKnopf}, Abstand Zurücknehmen ${lueckeZurueck}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Verpflegung (Beobachter): gesperrte Primäraktion und Ansichtsleiste folgen der Staffel, Kartenaktionen fehlen', async ({
  page,
}) => {
  // LFH-435: ohne Schreibrecht steht „Zeitfenster anlegen" GESPERRT im Kopf, darüber der
  // Rechtehinweis. Die Aktionszeile der Karte (`verpflegung-aktionen`) entfällt ganz, ebenso
  // „Zurücknehmen" an den Ausgaben. Gemessen werden die gesperrte Primäraktion und die Segmente
  // der Ansichtsleiste.
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Essen Lesend`);

  const post = async (pfad: string, data: unknown, was: string) => {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/verpflegung/${pfad}`, {
      data,
    });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  const jetzt = Date.now();
  const zeit = (minuten: number) => new Date(jetzt + minuten * 60_000).toISOString();
  // Dieselbe Saat wie im Admin-Test: die Ausgaben am Mittag geben „Zurücknehmen" eine Stelle,
  // an der es fehlen KANN.
  await post(
    'zeitfenster',
    {
      bezeichnung: 'Frühstück Deich',
      von_at: zeit(-30),
      bis_at: zeit(90),
      bedarf_kraefte: 60,
      bedarf_betreute: 20,
    },
    'Zeitfenster Frühstück',
  );
  const mittag = await post(
    'zeitfenster',
    {
      bezeichnung: 'Mittag Deich',
      von_at: zeit(-10),
      bis_at: zeit(110),
      bedarf_kraefte: 30,
      bedarf_betreute: 10,
    },
    'Zeitfenster Mittag',
  );
  for (const minuten of [-8, -4]) {
    await post(
      `zeitfenster/${mittag.id}/ausgaben`,
      { menge: 20, zeitpunkt_at: zeit(minuten), ort: 'Feldküche Nord' },
      'Ausgabe',
    );
  }
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/verpflegung`);
    await stelleDichte(page, dichte);

    // Datenanker: beide Karten mit ihrer Einstufung und die zwei Ausgaben am Mittag.
    const karten = page.locator('[data-lfh="verpflegung-karte"]');
    const fruehstueck = page.getByRole('article', { name: /^Zeitfenster Frühstück Deich / });
    const mittagKarte = page.getByRole('article', { name: /^Zeitfenster Mittag Deich / });
    await expect(karten).toHaveCount(2);
    await expect(fruehstueck).toHaveAttribute('data-einstufung', 'unterdeckung');
    await expect(mittagKarte).toHaveAttribute('data-einstufung', 'gedeckt');
    await expect(mittagKarte.locator('[data-lfh="verpflegung-ausgabe"]')).toHaveCount(2);

    // ── VORBEDINGUNGEN: Rechtehinweis steht, die Karten tragen keine Aktion.
    await rechteHinweisSteht(page);
    await expect(
      karten.locator('[data-lfh="verpflegung-aktionen"]'),
      'Vorbedingung: ohne Schreibrecht keine Aktionszeile an den Karten',
    ).toHaveCount(0);
    await expect(
      karten.getByRole('button'),
      'Vorbedingung: ohne Schreibrecht kein Bedienziel in den Karten (auch kein „Zurücknehmen")',
    ).toHaveCount(0);

    // ── Was bleibt: gesperrte Primäraktion und die zwei Segmente der Ansichtsleiste
    //    (`role="radio"`, deshalb per Struktur gegriffen).
    const kopf = await gesperrtHaeltStufe(
      page
        .locator('[data-lfh="seitenkopf-aktionen"]')
        .getByRole('button', { name: 'Zeitfenster anlegen', exact: true }),
      soll,
      `„Zeitfenster anlegen" gesperrt (${dichte})`,
    );
    const segmente = page.locator(
      '[data-lfh="verpflegung-werkzeugzeile"] [data-lfh="segmentleiste"] button',
    );
    await expect(segmente).toHaveCount(2);
    const segment = await alleHaltenStufe(segmente, soll, `Ansichts-Segment (${dichte})`, 2);

    gemessen.push(`${dichte} (Soll ≥ ${soll}): Primär gesperrt ${kopf}, Segment ${segment}`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── Betroffene ───────────────────────────────────────────────────────────────────────
//
// Vier Flächen:
//  - Liste: der Zustand-Knopf leer („… hinzufügen") und gefüllt („… bearbeiten", der Wert
//    selbst ist ein Textknopf der `BemerkungZelle`), dazu der Abstand zum nächsten Ziel.
//  - Detailseite: „Auf Lagekarte verorten", ein handgebauter `<Link>` in einer
//    `Descriptions`-Zelle — ein `<a>` erbt keine Steuerhöhe.
//  - Aufnahme-Route und Modal mit „Weitere Angaben": Zustand, Koordinate, „vermisst seit".
//  - Karte `?ansicht=karte`: Marker (WebGL, per KLICK mit Versatz neben den gezeichneten
//    Kreis gemessen), Cluster-Donut (DOM) und die Kartenknöpfe.

/** Die Zeile einer Person in der Tabelle (antd `data-row-key` = DB-`id`). */
const personZeile = (page: Page, id: number) =>
  page.locator(`tr.ant-table-row[data-row-key="${id}"]`);

async function personAnlegen(page: Page, einsatzId: string, daten: object): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, { data: daten });
  expect(antwort.ok(), `Seeding Person: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

/**
 * Kleinster Achsen-Abstand von `ziel` zu irgendeinem anderen Bedienziel in `bereich`.
 * Vorfahren und Nachfahren des Ziels zählen nicht — sie SIND das Ziel.
 */
async function abstandZuNachbarn(bereich: Locator, ziel: Locator): Promise<number> {
  const zielGriff = await ziel.elementHandle();
  const abstand = await bereich.evaluate((wurzel, z) => {
    const a = (z as Element).getBoundingClientRect();
    const kandidaten = wurzel.querySelectorAll<HTMLElement>(
      'a[href], button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    let min = Number.POSITIVE_INFINITY;
    for (const k of kandidaten) {
      if (k === z || k.contains(z as Element) || (z as Element).contains(k)) continue;
      const b = k.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const dx = Math.max(b.left - a.right, a.left - b.right, 0);
      const dy = Math.max(b.top - a.bottom, a.top - b.bottom, 0);
      min = Math.min(min, Math.max(dx, dy));
    }
    return min;
  }, zielGriff);
  // Ohne jedes Nachbarziel bliebe der Wert +∞ und „≥ 16 px" trivial grün.
  expect(Number.isFinite(abstand), 'mindestens ein Nachbarziel in der Zeile').toBe(true);
  return abstand;
}

test('Betroffene Liste: Zustand-Knopf leer und gefüllt folgen der Staffel, Abstand ≥ 16 px im Handschuh', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Betroffene`);
  await personAnlegen(page, einsatzId, { name: 'Albers' });
  const gefuellt = await personAnlegen(page, einsatzId, { name: 'Brandt', zustand: 'gehfähig' });

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await stelleDichte(page, dichte);
    const leer = page.getByRole('button', { name: 'Zustand zu R-001 hinzufügen' });
    const voll = page.getByRole('button', { name: 'Zustand zu R-002 bearbeiten' });
    const hLeer = await haeltStufe(leer, soll, `Zustand-Knopf leer (${dichte})`);
    const hVoll = await haeltStufe(voll, soll, `Zustand-Knopf gefüllt (${dichte})`);
    for (const [ziel, name] of [
      [leer, 'leer'],
      [voll, 'gefüllt'],
    ] as const) {
      const breite = (await ziel.boundingBox())!.width;
      expect(breite, `Zustand-Knopf ${name} (${dichte}) breit ${breite}px`).toBeGreaterThanOrEqual(
        24 - SUBPIXEL,
      );
    }
    const abstand = await abstandZuNachbarn(personZeile(page, gefuellt), voll);
    if (dichte === 'handschuh') {
      expect(abstand, `Abstand Zustand-Knopf → Nachbarziel (handschuh)`).toBeGreaterThanOrEqual(
        16 - SUBPIXEL,
      );
    }
    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): leer ${hLeer}, gefüllt ${hVoll}, Abstand ${abstand}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Betroffene Liste (Beobachter): die Ansichtsleiste folgt der Staffel, Zustand-Knöpfe und Erfassung fehlen', async ({
  page,
}) => {
  // LFH-435: der Nur-Lese-Zweig der Betroffenen NIMMT WEG — Zustand steht als Text statt als
  // `BemerkungZelle`, Erfassungsband und die drei Kopfknöpfe fehlen. Einen Rechtehinweis gibt es
  // im aktiven Einsatz nicht (nur „abgeschlossen — nur Ansicht"). Dem Beobachter bleibt im Kopf
  // die Ansichtsleiste; sie wird gemessen.
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Betroffene Lesend`);
  await personAnlegen(page, einsatzId, { name: 'Albers' });
  const gefuellt = await personAnlegen(page, einsatzId, { name: 'Brandt', zustand: 'gehfähig' });
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await stelleDichte(page, dichte);

    // Datenanker: die Zeile mit gesätem Zustand ist geladen und zeigt ihn als Text.
    await expect(personZeile(page, gefuellt)).toContainText('gehfähig');

    // ── VORBEDINGUNGEN: die Schreibziele fehlen.
    await expect(
      page.getByRole('button', { name: /^Zustand zu R-\d+ (hinzufügen|bearbeiten)$/ }),
      'Vorbedingung: ohne Schreibrecht keine Zustand-Knöpfe',
    ).toHaveCount(0);
    await expect(page.locator('[data-lfh="zustand-zelle"]')).toHaveCount(0);
    await expect(
      page.locator('[data-lfh="erfassungsband"]'),
      'Vorbedingung: ohne Schreibrecht kein Erfassungsband',
    ).toHaveCount(0);
    const kopfAktionen = page.locator('[data-lfh="seitenkopf-aktionen"]');
    for (const name of ['Schnellerfassung', 'Vermisst melden', 'Betroffene/n erfassen']) {
      await expect(
        kopfAktionen.getByRole('button', { name, exact: true }),
        `Vorbedingung: ohne Schreibrecht kein Kopfknopf „${name}"`,
      ).toHaveCount(0);
    }

    // ── Was bleibt: die drei Segmente der Ansichtsleiste im Kopf (`role="radio"`).
    const segmente = kopfAktionen.locator('[data-lfh="segmentleiste"] button');
    await expect(segmente).toHaveCount(3);
    const segment = await alleHaltenStufe(segmente, soll, `Ansichts-Segment (${dichte})`, 3);

    gemessen.push(`${dichte} (Soll ≥ ${soll}): Segment ${segment}`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Betroffene Detailseite: „Auf Lagekarte verorten" folgt der Staffel', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Verorten`);
  const id = await personAnlegen(page, einsatzId, { name: 'Claasen' });

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/personen/${id}`);
    await stelleDichte(page, dichte);
    const link = page.getByRole('link', { name: 'Auf Lagekarte verorten', exact: true });
    const hoehe = await haeltStufe(link, soll, `Verorten-Link (${dichte})`);
    const breite = (await link.boundingBox())!.width;
    expect(breite).toBeGreaterThanOrEqual(24 - SUBPIXEL);
    await expect(link).toHaveAttribute('href', /platzieren=person/);
    gemessen.push(`${dichte} (Soll ≥ ${soll}): ${hoehe} × ${breite}`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

/**
 * Wartet, bis die Einblend-Animation des Modals vorbei ist — antds Zoom skaliert den Dialog,
 * sonst mäße der Test die Animation statt des Felds.
 */
async function modalRuht(page: Page) {
  await page.waitForFunction(() => {
    const m = document.querySelector('.ant-modal');
    return (
      m != null &&
      m.getAnimations({ subtree: true }).length === 0 &&
      !/ant-zoom-(enter|appear)/.test(m.className)
    );
  });
}

test('Betroffene Aufnahme: Zustand, Koordinate und „vermisst seit" folgen der Staffel (Route und Modal)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Aufnahme`);

  /**
   * Die sichtbare Feldhülle: beim `Input` das Element selbst (`ant-input`), beim DatePicker
   * der Vorfahr `.ant-picker` — nicht das nur 15 px hohe `.ant-picker-input`. Deshalb
   * Klassen-TOKEN statt Teilstring.
   */
  const huelle = (feld: Locator) =>
    feld.locator(
      'xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " ant-input ") or contains(concat(" ", normalize-space(@class), " "), " ant-picker ")][1]',
    );

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    // Route (Modus betroffen): Zustand + Koordinate.
    await page.goto(`/einsaetze/${einsatzId}/personen/aufnahme`);
    await stelleDichte(page, dichte);
    await page.getByRole('button', { name: /Weitere Angaben/ }).click();
    const zustand = await haeltStufe(
      huelle(page.getByLabel('Zustand', { exact: true })),
      soll,
      `Route Zustand (${dichte})`,
    );
    const koordinate = await haeltStufe(
      huelle(page.getByLabel('Koordinate', { exact: true })),
      soll,
      `Route Koordinate (${dichte})`,
    );

    // Modal „Schnellerfassung": dieselben zwei Felder im zweiten Mount von `AufnahmeFelder`.
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await page.getByRole('button', { name: 'Schnellerfassung' }).click();
    const schnell = page.getByRole('dialog');
    await schnell.getByRole('button', { name: /Weitere Angaben/ }).click();
    await modalRuht(page);
    const modalZustand = await haeltStufe(
      huelle(schnell.getByLabel('Zustand', { exact: true })),
      soll,
      `Modal Zustand (${dichte})`,
    );
    await haeltStufe(
      huelle(schnell.getByLabel('Koordinate', { exact: true })),
      soll,
      `Modal Koordinate (${dichte})`,
    );
    await page.keyboard.press('Escape');
    await expect(schnell).toBeHidden();

    // Modal „Vermisst melden": „vermisst seit".
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await page.getByRole('button', { name: 'Vermisst melden' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Weitere Angaben/ }).click();
    await modalRuht(page);
    const seit = await haeltStufe(
      huelle(dialog.getByLabel('vermisst seit', { exact: true })),
      soll,
      `Modal vermisst seit (${dichte})`,
    );
    await page.keyboard.press('Escape');
    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Zustand ${zustand}, Koordinate ${koordinate}, Modal Zustand ${modalZustand}, vermisst seit ${seit}`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

interface KartenHaken {
  loaded(): boolean;
  project(lngLat: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  queryRenderedFeatures(p: [number, number], o: { layers: string[] }): unknown[];
  once(ereignis: string, f: () => void): void;
}

async function karteBereit(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: KartenHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
}

/** Seitenkoordinaten eines Punkts auf der Karte. */
async function aufSeite(page: Page, lngLat: [number, number]) {
  return page.evaluate((ll) => {
    const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
    const p = k.project(ll);
    const r = k.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, lngLat);
}

test('Betroffene Karte: Marker-Trefferzone, Cluster-Donut und Kartenknöpfe folgen der Staffel', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate3 ${Date.now()} Karte`);
  // Zwei EINZELNE Marker weit auseinander und ein enges Paar (rund 20 m), das bei jedem
  // Startausschnitt zu einem Cluster verschmilzt.
  const einzeln: [number, number] = [8.8, 53.0];
  const zielId = await personAnlegen(page, einsatzId, {
    name: 'Einzeln',
    antreff_lat: einzeln[1],
    antreff_lon: einzeln[0],
    sichtung: 'sk2',
  });
  await personAnlegen(page, einsatzId, { name: 'Fern', antreff_lat: 53.3, antreff_lon: 9.3 });
  for (const [i, sk] of (['sk1', 'sk3'] as const).entries()) {
    await personAnlegen(page, einsatzId, {
      name: `Paar ${i}`,
      antreff_lat: 52.8 + i * 0.0002,
      antreff_lon: 8.6,
      sichtung: sk,
    });
  }

  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    // Dichte vor der Ansicht (LFH-770): `?ansicht=karte` räumt die Seite nach dem Anwenden aus
    // der URL; ein `reload` danach lüde die Zeilenansicht, und die Karte käme nie.
    await stelleDichte(page, dichte);
    await page.goto(`/einsaetze/${einsatzId}/personen?ansicht=karte`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    await karteBereit(page);

    // Kartenknöpfe (DOM): Hineinzoomen, Herauszoomen, Nach Norden.
    let knopf = Number.POSITIVE_INFINITY;
    for (const name of ['Hineinzoomen', 'Herauszoomen', 'Nach Norden ausrichten']) {
      knopf = Math.min(
        knopf,
        await haeltStufe(
          page.getByRole('button', { name, exact: true }),
          soll,
          `${name} (${dichte})`,
        ),
      );
    }

    // Cluster (DOM-Donut), in BEIDEN Achsen gemessen. MapLibre setzt `maplibregl-marker` auf
    // das übergebene Element selbst: ohne Hülle IST der Ring der Marker, mit Hülle steckt er darin.
    const cluster = page.locator(
      '.maplibregl-marker[data-sichtung], .maplibregl-marker:has([data-sichtung])',
    );
    await expect(cluster).toHaveCount(1, { timeout: 20_000 });
    const donut = (await cluster.boundingBox())!;
    expect(donut.height, `Cluster-Donut (${dichte}) hoch ${donut.height}`).toBeGreaterThanOrEqual(
      soll - SUBPIXEL,
    );
    expect(donut.width, `Cluster-Donut (${dichte}) breit ${donut.width}`).toBeGreaterThanOrEqual(
      soll - SUBPIXEL,
    );
    await expect(cluster.locator('[data-lfh="cluster-sichtung"]')).toHaveText('I');

    // Marker (WebGL): ein Klick NEBEN den gezeichneten Kreis (Kante bei 13 px), aber in der
    // Zone, öffnet die Person; Versatz = halbe Stufe minus 1 px. Vorher den Marker in die
    // Mitte holen und ins Bild scrollen — in `handschuh` schiebt der höhere Seitenkopf den
    // Ausschnitt sonst unter den Viewport. Zoom 15 liegt über `clusterMaxZoom` (14).
    await page.locator('[data-lfh="betroffene-karte"] canvas').scrollIntoViewIfNeeded();
    // `idle` statt `loaded()`: ohne Kachelquelle bleibt `loaded()` nach einem Sprung stehen.
    await page.evaluate(
      (ll) =>
        new Promise<void>((fertig) => {
          const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
          k.once('idle', () => fertig());
          k.jumpTo({ center: ll, zoom: 15 });
        }),
      einzeln,
    );
    const mitte = await aufSeite(page, einzeln);
    const versatz = soll / 2 - 1;
    const daneben = await page.evaluate(
      ([x, y]) => {
        const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
        const r = k.getCanvas().getBoundingClientRect();
        const p: [number, number] = [x - r.left, y - r.top];
        const sichtbar = ['marker-kante', 'marker-kreis', 'marker-kurz'];
        return k.queryRenderedFeatures(p, { layers: sichtbar }).length;
      },
      [mitte.x + versatz, mitte.y] as const,
    );
    // Selbstprobe des Versatzes: dort ist NICHTS gezeichnet, sonst mäße der Klick den Kreis.
    expect(daneben, `am Versatz ${versatz}px liegt kein gezeichneter Marker`).toBe(0);
    await page.mouse.click(mitte.x + versatz, mitte.y);
    await expect(page).toHaveURL(new RegExp(`/personen/${zielId}$`));
    gemessen.push(
      `${dichte} (Soll ≥ ${soll}): Knöpfe ${knopf}, Donut ${donut.width}×${donut.height}, Versatzklick ${versatz}px trifft`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── ETB, Lagekarte, Gefahrenmatrix ───────────────────────────────────────────────────
//
// Zwei Zusätze zu den Helfern oben:
//  - DIE KURZE ACHSE: ein unbeschriftetes Ziel (Symbolknopf, Matrixzelle) muss die Stufe auf
//    BEIDEN Achsen halten; {@link kurzeAchseHaelt} misst `min(Breite, Höhe)`.
//  - EINE GEGENPROBE, DIE ROT WERDEN KANN: Untergrenzen blieben grün, wenn jedes Ziel in
//    jeder Stufe 72 px mäße — dann hätte die Stufe nichts bewirkt. Jeder Block sichert
//    deshalb zu, dass das kleinste Maß in `kompakt` STRENG kleiner ist als in `handschuh`;
//    die Matrix hält in `kompakt` zusätzlich eine Obergrenze (< 48).

/** Boden der Menüeinträge eines `Dropdown`: antd gibt ihnen `controlHeightSM` (24 / 48 / 72). */
const BODEN_MENUE = { kompakt: 24, komfortabel: 48, handschuh: 72 } as const;

/** Boden der Kartenknöpfe: `kartenKnopfKante = max(32, controlHeight)` in
 *  `KartenUeberlagerung.tsx` — in `kompakt` also 32, nicht 30. Literal, kein Import. */
const BODEN_KARTE = { kompakt: 32, komfortabel: 48, handschuh: 72 } as const;

/**
 * Kurze Achse JEDES Knotens einer Menge: `min(Breite, Höhe) ≥ soll`. Zurück kommen das
 * kleinste Maß (für die Anmerkung und die Gegenprobe) und das größte Maß der LANGEN Achse
 * (für eine Obergrenze in `kompakt`).
 */
async function kurzeAchseHaelt(
  ziele: Locator,
  soll: number,
  name: string,
  mindestens: number,
): Promise<{ kleinstes: number; groesstes: number }> {
  const anzahl = await ziele.count();
  expect(anzahl, `${name}: mindestens ${mindestens} Knoten erwartet`).toBeGreaterThanOrEqual(
    mindestens,
  );
  let kleinstes = Number.POSITIVE_INFINITY;
  let groesstes = 0;
  for (let i = 0; i < anzahl; i += 1) {
    const kasten = await ziele.nth(i).boundingBox();
    expect(kasten, `${name} #${i + 1}: kein Kasten messbar`).not.toBeNull();
    const kurz = Math.min(kasten!.width, kasten!.height);
    expect(
      kurz,
      `${name} #${i + 1} (gemessen ${kasten!.width}×${kasten!.height}px, kurze Achse Soll ≥ ${soll})`,
    ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
    kleinstes = Math.min(kleinstes, kurz);
    groesstes = Math.max(groesstes, kasten!.width, kasten!.height);
  }
  return { kleinstes, groesstes };
}

/**
 * Höhe eines animiert aufklappenden Menüeintrags, erst wenn der Kasten STEHT (zwei gleiche
 * Lesungen). Mitten in der `scaleY`-Animation gelesen wäre er in `kompakt` zu klein, und die
 * Gegenprobe „kompakt < handschuh" grün durch zu frühes Hinsehen.
 */
async function ruhigeHoehe(ziel: Locator, name: string): Promise<number> {
  let vorher = -1;
  let jetzt = 0;
  await expect
    .poll(
      async () => {
        vorher = jetzt;
        jetzt = (await ziel.boundingBox())?.height ?? 0;
        return jetzt > 0 && jetzt === vorher;
      },
      { message: `${name}: der Kasten kommt nicht zur Ruhe`, intervals: [100, 150, 200] },
    )
    .toBe(true);
  return jetzt;
}

/** Legt die Gegenprobe für eine Zielsorte fest: kompakt STRENG kleiner als handschuh. */
function gegenprobe(je: Map<string, number>, sorte: string) {
  const k = je.get(`kompakt ${sorte}`);
  const h = je.get(`handschuh ${sorte}`);
  expect(k, `${sorte}: kompakt nicht gemessen`).toBeDefined();
  expect(h, `${sorte}: handschuh nicht gemessen`).toBeDefined();
  expect(
    k!,
    `${sorte}: die Stufe muss durchschlagen — kompakt ${k} px, handschuh ${h} px`,
  ).toBeLessThan(h!);
}

test('ETB (LFH-373): Slash-Menü, Zeilenauslöser und Zeilenmenü folgen der Dichte-Staffel', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E 373 Nord ${Date.now()}`);
  for (let n = 1; n <= 3; n += 1) {
    await anlegen(
      page,
      einsatzId,
      'etb',
      { typ: 'meldung', inhalt: `Probe ${n}: Lage unverändert`, von: 'ELW 1', an: 'Leitstelle' },
      `ETB-Eintrag ${n}`,
    );
  }

  const gemessen: string[] = [];
  const je = new Map<string, number>();

  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await stelleDichte(page, dichte);
    const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
    await expect(zeitachse.getByTestId('etb-ereigniszeile')).toHaveCount(3);

    // Zeilenauslöser: ein Symbolknopf ohne Beschriftung — kurze Achse.
    const ausloeser = zeitachse.getByRole('button', { name: /^Aktionen zu Eintrag \d+$/ });
    const zeile = await kurzeAchseHaelt(ausloeser, soll, `Zeilenauslöser (${dichte})`, 3);

    // Slash-Menü über „Feld" (öffnet deterministisch „Felder"). Auf `[data-slash-menu]`
    // eingegrenzt, weil die Kommandopalette ebenfalls `role="option"` rendert.
    await page.getByRole('button', { name: 'Feld', exact: true }).click();
    const optionen = page.locator('[data-slash-menu] [role="option"]');
    const slash = await alleHaltenStufe(optionen, soll, `Slash-Option (${dichte})`, 5);
    // Zu über denselben Knopf: Escape wirkt nur im Textfeld, der Fokus steht auf dem Knopf.
    await page.getByRole('button', { name: 'Feld', exact: true }).click();
    await expect(page.locator('[data-slash-menu]')).toHaveCount(0);

    // Zeilenmenü: die Einträge sind das Ziel, das nach dem Öffnen getroffen wird.
    await ausloeser.first().click();
    const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
    await expect(menue).toHaveCount(1);
    let eintrag = Number.POSITIVE_INFINITY;
    for (const name of ['Berichtigen', 'Wiedervorlage', 'Auftrag erteilen']) {
      const item = menue.getByRole('menuitem', { name: new RegExp(name) });
      await expect(item).toHaveCount(1);
      const h = await ruhigeHoehe(item, `Menüeintrag ${name} (${dichte})`);
      expect(
        h,
        `Menüeintrag ${name} (${dichte}), Soll ≥ ${BODEN_MENUE[dichte]}`,
      ).toBeGreaterThanOrEqual(BODEN_MENUE[dichte] - SUBPIXEL);
      eintrag = Math.min(eintrag, h);
    }
    await page.keyboard.press('Escape');

    je.set(`${dichte} Zeilenauslöser`, zeile.kleinstes);
    je.set(`${dichte} Slash-Option`, slash);
    je.set(`${dichte} Menüeintrag`, eintrag);
    gemessen.push(
      `${dichte}: Zeilenauslöser ${zeile.kleinstes}, Slash ${slash}, Menüeintrag ${eintrag}`,
    );
  }

  for (const sorte of ['Zeilenauslöser', 'Slash-Option', 'Menüeintrag']) gegenprobe(je, sorte);
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Lagekarte (LFH-373): „Verortet", Kartenknöpfe und Zeitachse folgen der Dichte-Staffel', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E 373 Ost ${Date.now()}`);
  const ablagen = ['Ablage Ost 1', 'Ablage Ost 2'];
  for (const [i, bezeichnung] of ablagen.entries()) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/uhs`, {
      data: { typ: 'patientenablage', bezeichnung },
    });
    expect(antwort.ok(), `Seeding UHS: ${await antwort.text()}`).toBeTruthy();
    const { id } = (await antwort.json()) as { id: number };
    const lage = await page.request.patch(`/api/einsaetze/${einsatzId}/uhs/${id}`, {
      data: { lat: 49.35 + i / 100, lon: 9.14 },
    });
    expect(lage.ok(), `Verortung UHS: ${await lage.text()}`).toBeTruthy();
  }
  for (const bezeichnung of ['Stand A', 'Stand B']) {
    await anlegen(page, einsatzId, 'lage-snapshots', { bezeichnung }, `Stand ${bezeichnung}`);
  }

  const gemessen: string[] = [];
  const je = new Map<string, number>();

  // Ab `xl` startet die Zeitachse ausgeklappt; die Wahl wird trotzdem gesetzt, damit ein
  // Nachbarspec im selben Browserprofil sie nicht eingeklappt hinterlässt.
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await page.evaluate(() => localStorage.setItem('lfh:lagekarte:zeitachse-eingeklappt', '0'));

  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await stelleDichte(page, dichte);
    await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
      1,
      { timeout: 60_000 },
    );

    // „Verortet": handgebaute Zeilen. Per exaktem Namen, weil sonst auch der Klappkopf träfe.
    const leiste = page.locator('[data-lfh="kartenleiste"]');
    let verortet = Number.POSITIVE_INFINITY;
    for (const name of ablagen) {
      verortet = Math.min(
        verortet,
        await haeltStufe(
          leiste.getByRole('button', { name, exact: true }),
          soll,
          `Verortet ${name} (${dichte})`,
        ),
      );
    }

    // Kartenknöpfe: Symbolknöpfe, kurze Achse, eigener Boden (32 in kompakt).
    const knoepfe = page.locator('[data-lfh="karten-knoepfe"]').getByRole('button', {
      name: /^(Hineinzoomen|Herauszoomen|Nach Norden ausrichten|Messen|Zeichenwerkzeuge)$/,
    });
    await expect(knoepfe).toHaveCount(5);
    const karte = await kurzeAchseHaelt(knoepfe, BODEN_KARTE[dichte], `Kartenknopf (${dichte})`, 5);

    // Zeitachse: beschriftete Knöpfe halten die Höhe, Symbolknöpfe die kurze Achse.
    const band = page.locator('[data-lfh="zeitachse"]');
    // Erst zählen, wenn die Stände geladen sind — sonst steht nur „Stand sichern" im Band.
    await expect(band.getByRole('button', { name: 'Stand B' })).toBeVisible();
    const beschriftet = band.getByRole('button', {
      // „Stand sichern" ohne `^` (vorn kann ein Icon-Label stehen); der Name ist in Vitest gepinnt.
      name: /(Stand sichern|^Aktuell|^Stand A|^Stand B)$/,
    });
    const zeitBeschriftet = await alleHaltenStufe(beschriftet, soll, `Zeitachse (${dichte})`, 4);
    const symbole = band.getByRole('button', { name: /^(Abspielen|Zeitachse ausblenden)$/ });
    const zeitSymbol = await kurzeAchseHaelt(symbole, soll, `Zeitachse Symbol (${dichte})`, 2);

    je.set(`${dichte} Verortet`, verortet);
    je.set(`${dichte} Kartenknopf`, karte.kleinstes);
    je.set(`${dichte} Zeitachse`, zeitBeschriftet);
    gemessen.push(
      `${dichte}: Verortet ${verortet}, Kartenknopf ${karte.kleinstes}, ` +
        `Zeitachse ${zeitBeschriftet}, Zeitachse Symbol ${zeitSymbol.kleinstes}`,
    );
  }

  for (const sorte of ['Verortet', 'Kartenknopf', 'Zeitachse']) gegenprobe(je, sorte);
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── Trefferzonen der Lagekarte ───────────────────────────────────────────────────────
//
// Jeder Marker-Builder setzt `trefferDurchmesser = controlHeight`; gemessen am UHS-Zeichen.
//
// Der Versatz ist nicht `soll/2 − 1` wie bei den Betroffenen: ein TZ-Symbol ist bis zu 34 px
// groß, in `kompakt` läge der Zonenrand (15) INNERHALB des Symbols. Geprüft wird deshalb EIN
// fester Punkt 23 px über dem Zeichen: in `komfortabel`/`handschuh` liegt er in der Zone und
// wählt den Marker, in `kompakt` liegt dort kein Klickziel — die Gegenprobe. Senkrecht, weil
// die Plakette rechts vom Zeichen steht.
//
// DICHT LIEGENDE MARKER: zwei Zeichen 50 px übereinander, `handschuh` (Radius 36). Geklickt
// wird 21 px unter dem oberen — außerhalb beider Symbole, innerhalb beider Zonen. „Die oberste
// gewinnt" wählte beide Male denselben Marker, „die nächste gewinnt" (`naechstesMerkmal`) je
// den richtigen.

/** Klickebenen der Zeichnung OHNE Trefferzonen, für die Selbstprobe „dort ist nichts
 *  gezeichnet". Die Plakette gehört dazu: sie ist Klickziel wie das Zeichen. */
const GEZEICHNETE_KLICKEBENEN = [
  'marker-symbol',
  'marker-kreis',
  'marker-kurz',
  'marker-status-ring',
  'marker-label',
  'marker-einsatzort-symbol',
  'marker-einsatzort-label',
];

/** Features an einem Seitenpunkt, je Ebenenliste. */
async function merkmaleAm(page: Page, punkt: { x: number; y: number }, ebenen: string[]) {
  return page.evaluate(
    ([x, y, ids]) => {
      const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
      const r = k.getCanvas().getBoundingClientRect();
      return k.queryRenderedFeatures([x - r.left, y - r.top], { layers: ids }).length;
    },
    [punkt.x, punkt.y, ebenen] as const,
  );
}

/** Springt ohne Animation und wartet, bis nichts mehr zu zeichnen ist (`idle`, s. o.). */
async function springe(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(
    ([ll, z]) =>
      new Promise<void>((fertig) => {
        const k = (window as unknown as { __lfhKarte: KartenHaken }).__lfhKarte;
        k.once('idle', () => fertig());
        k.jumpTo({ center: ll, zoom: z });
      }),
    [center, zoom] as const,
  );
}

/**
 * Wartet, bis die Karte steht: eine Markerauswahl fliegt die Karte zum Marker, ein vorher
 * berechneter Seitenpunkt wäre danach veraltet.
 */
async function kartenRuht(page: Page) {
  await page.waitForFunction(
    () => !(window as unknown as { __lfhKarte: { isMoving(): boolean } }).__lfhKarte.isMoving(),
    undefined,
    { timeout: 15_000 },
  );
}

test('Lagekarte (LFH-711): Objektmarker tragen die Trefferzone der Staffel, dicht liegende wählt der nächste', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E 711 Zone ${Date.now()}`);
  const einzeln: [number, number] = [9.14, 49.35];
  // Das Paar liegt weit genug vom Einzelnen, dass keine Zone hinüberreicht, und senkrecht
  // übereinander; den Pixelabstand stellt der Zoom unten auf 50 px.
  const nord: [number, number] = [9.3, 49.45];
  const sued: [number, number] = [9.3, 49.45 - 0.00035];
  for (const [bezeichnung, [lon, lat]] of [
    ['Zone Einzeln', einzeln],
    ['Zone Nord', nord],
    ['Zone Süd', sued],
  ] as const) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/uhs`, {
      data: { typ: 'patientenablage', bezeichnung },
    });
    expect(antwort.ok(), `Seeding UHS: ${await antwort.text()}`).toBeTruthy();
    const { id } = (await antwort.json()) as { id: number };
    const lage = await page.request.patch(`/api/einsaetze/${einsatzId}/uhs/${id}`, {
      data: { lat, lon },
    });
    expect(lage.ok(), `Verortung UHS: ${await lage.text()}`).toBeTruthy();
  }

  const auswahl = (name: string) =>
    page.locator('[data-lfh="auswahl"]').getByRole('heading', { name, exact: true });
  const VERSATZ = 23;
  const gemessen: string[] = [];

  for (const { dichte } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await stelleDichte(page, dichte);
    await karteBereit(page);
    await page.getByTestId('kartenflaeche').locator('canvas').scrollIntoViewIfNeeded();
    // Zoom 17 liegt über `clusterMaxZoom` (14): der Marker steht einzeln, nicht im Donut.
    await springe(page, einzeln, 17);
    const mitte = await aufSeite(page, einzeln);
    // Vorbedingung: das Zeichen ist WIRKLICH gezeichnet — sonst wäre die Selbstprobe unten grün.
    expect(await merkmaleAm(page, mitte, ['marker-symbol']), `Symbol (${dichte})`).toBe(1);
    const daneben = { x: mitte.x, y: mitte.y - VERSATZ };
    expect(
      await merkmaleAm(page, daneben, GEZEICHNETE_KLICKEBENEN),
      `am Versatz ${VERSATZ}px liegt nichts Gezeichnetes (${dichte})`,
    ).toBe(0);
    const inZone = await merkmaleAm(page, daneben, ['marker-treffer']);

    if (dichte === 'kompakt') {
      // Gegenprobe: 30-px-Zone, Radius 15 — der Punkt liegt außerhalb.
      expect(inZone, 'kompakt: der Versatzpunkt liegt außerhalb der 30-px-Zone').toBe(0);
      gemessen.push(`kompakt: Versatz ${VERSATZ}px außerhalb der Zone`);
      continue;
    }
    expect(inZone, `${dichte}: der Versatzpunkt liegt in der Zone`).toBe(1);
    await page.mouse.click(daneben.x, daneben.y);
    await expect(auswahl('Zone Einzeln')).toBeVisible();
    gemessen.push(`${dichte}: Versatzklick ${VERSATZ}px wählt den Marker`);

    if (dichte !== 'handschuh') continue;
    await kartenRuht(page);

    // Dicht liegende Marker: den Zoom so wählen, dass das Paar 50 px auseinander steht.
    const zoom = await page.evaluate(
      ([a, b]) => {
        const k = (window as unknown as { __lfhKarte: KartenHaken & { getZoom(): number } })
          .__lfhKarte;
        const pa = k.project(a);
        const pb = k.project(b);
        return k.getZoom() + Math.log2(50 / Math.hypot(pa.x - pb.x, pa.y - pb.y));
      },
      [nord, sued] as const,
    );
    expect(zoom, 'das Paar darf nicht clustern').toBeGreaterThan(14);
    for (const [ziel, anker, zu] of [
      ['Zone Nord', nord, 1],
      ['Zone Süd', sued, -1],
    ] as const) {
      // Eine Auswahl fliegt die Karte auf Zoom 15, dort stünde das Paar nur ~12 px auseinander.
      // Deshalb je Klick Ruhe abwarten, Ausschnitt und Zoom neu setzen, Lage neu lesen.
      await kartenRuht(page);
      await springe(page, [nord[0], (nord[1] + sued[1]) / 2], zoom);
      const oben = await aufSeite(page, nord);
      const unten = await aufSeite(page, sued);
      expect(Math.abs(unten.y - oben.y - 50), 'Paarabstand').toBeLessThan(1);
      const von = anker === nord ? oben : unten;
      const punkt = { x: von.x, y: von.y + zu * 21 };
      expect(
        await merkmaleAm(page, punkt, GEZEICHNETE_KLICKEBENEN),
        `${ziel}: nichts gezeichnet`,
      ).toBe(0);
      expect(await merkmaleAm(page, punkt, ['marker-treffer']), `${ziel}: beide Zonen`).toBe(2);
      await page.mouse.click(punkt.x, punkt.y);
      await expect(auswahl(ziel)).toBeVisible();
    }
    gemessen.push('handschuh: Paar 50 px, 21 px neben jedem wählt je den nächsten');
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

test('Gefahrenmatrix (LFH-373): 58 Zellen halten die kurze Achse, die Gebietszeilen die Staffel', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // Fükw OHNE `hasTouch`: mit grobem Zeiger belegte die App `komfortabel` vor, und die Wache
  // könnte eine halb umgeschaltete Stufe nicht von einer gewählten unterscheiden. Den
  // Tablet-Nachweis trägt `gefahren-matrix-zelle.spec.ts`.
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E 373 Sued ${Date.now()}`);
  const gebiete = ['Sektor Sued 1', 'Sektor Sued 2'];
  for (const [i, label] of gebiete.entries()) {
    const x = 10 + i / 20;
    await anlegen(
      page,
      einsatzId,
      'zonen',
      {
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
      `Gefahrengebiet ${label}`,
    );
  }

  const gemessen: string[] = [];
  const je = new Map<string, number>();
  let groesstesKompakt = 0;

  for (const { dichte, soll } of STAFFEL) {
    await page.goto(`/einsaetze/${einsatzId}/gefahren`);
    await stelleDichte(page, dichte);

    // 13 Gefahrentypen × 5 Schutzobjekte, davon 7 Paare „nicht anwendbar" = 58, exakt.
    const zellen = page.getByRole('button', { name: /^Bewertung / });
    await expect(zellen).toHaveCount(58);
    const zelle = await kurzeAchseHaelt(zellen, soll, `Matrixzelle (${dichte})`, 58);
    if (dichte === 'kompakt') groesstesKompakt = zelle.groesstes;

    let gebiet = Number.POSITIVE_INFINITY;
    for (const label of gebiete) {
      gebiet = Math.min(
        gebiet,
        await haeltStufe(
          page.getByRole('button', { name: new RegExp(label) }),
          soll,
          `Gebietszeile ${label} (${dichte})`,
        ),
      );
    }

    je.set(`${dichte} Matrixzelle`, zelle.kleinstes);
    je.set(`${dichte} Gebietszeile`, gebiet);
    gemessen.push(
      `${dichte}: Zelle kurz ${zelle.kleinstes} / lang ${zelle.groesstes}, Gebietszeile ${gebiet}`,
    );
  }

  for (const sorte of ['Matrixzelle', 'Gebietszeile']) gegenprobe(je, sorte);
  // Obergrenze: in `kompakt` ist keine Zelle ≥ 48 px — sonst stünde sie auch ohne Staffel auf
  // komfortabel-Maß, und die Messung oben bewiese nichts.
  expect(
    groesstesKompakt,
    `Matrixzelle in kompakt: größtes Maß ${groesstesKompakt} px, Soll < 48`,
  ).toBeLessThan(48);
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});
