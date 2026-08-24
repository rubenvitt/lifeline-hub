import { expect, test, type Page } from '@playwright/test';

/**
 * Die Einsatz-Einstellungen am Handschirm (LFH-345 · C10, Befunde H16/M17).
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────────────────────
 *
 * In allen neun Dateien der Gruppe gab es KEINEN einzigen Breite-Breakpoint. Die Modulzeile
 * belegte fest 268 px (64 px Sichtbar-Spalte + 180 px Rollen-Spalte + zwei Abstände); bei
 * 390 px Gerätebreite blieben damit unter 100 px für das Modul-Label — bei Namen wie
 * „Einsatzabschnitte" oder „Unfallhilfsstellen" ist das keine Beschriftung mehr.
 *
 * ── WARUM ÜBERHAUPT PLAYWRIGHT ──────────────────────────────────────────────────────────
 *
 * jsdom rechnet kein Layout. Ein Vitest kann prüfen, dass die Spaltenköpfe unter `md`
 * fehlen (das tut `ModulEinstellungsListe.test.tsx`) — aber nicht, ob die Zeile dann
 * tatsächlich stapelt, ob sie in die Breite passt und ob das Bedienziel seine Höhe hält.
 * Die drei Aussagen unten sind genau die, die nur ein echtes Layout beantwortet.
 *
 * ── DIE SCHWELLE IST DIE STAFFEL, NICHT DIE 44 AUS DEM AK-TEXT ──────────────────────────
 *
 * Das Ticket nennt „≥ 44 px" (WCAG SC 2.5.5, AAA). Bindend für die Routen ist Gate 3 der
 * Bedien-Leitlinie mit 30 / 48 / 72; `kraefte-schmal.spec.ts` und `trefflaeche-tablet.spec.ts`
 * haben diese Korrektur schon zweimal begründet: ein Test auf 44 wäre SCHWÄCHER als der
 * Bestand und liesse eine Regression auf 44–47 px durch. Das AK ist damit übererfüllt.
 *
 * ── WARUM `hasTouch` ───────────────────────────────────────────────────────────────────
 *
 * `setViewportSize` allein liefert KEIN Touch — `matchMedia('(pointer: coarse)')` bliebe
 * false, die Stufe bliebe `kompakt` (30 px), und „Handschirm" wäre reine Prosa. `hasTouch`
 * ist eine BrowserContext-Option und lässt sich nicht zur Laufzeit umstellen, daher
 * `test.use` auf Dateiebene.
 */
test.use({ hasTouch: true });

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const HANDSCHIRM = { width: 390, height: 844 };
const FUEKW = { width: 1280, height: 800 };

/**
 * Die Dichte-Staffel als handgeschriebene Zahlen, NICHT aus `theme/tokens` importiert:
 * sonst prüfte der Test den Token gegen sich selbst und bliebe auch dann grün, wenn das
 * Maß am Bedienelement gar nicht mehr ankommt.
 */
const STAFFEL = [
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

/** Subpixel-Spielraum: `boundingBox()` liefert Fliesskomma, und Chromium rechnet unter Last
 *  anders als im Einzellauf (in `nav-schmal.spec.ts:26-46` dreimal gemessen). */
const SUBPIXEL = 0.5;

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — der Wert ist Vertrag. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/** Ein Modul, dessen Zeile in JEDER Stufe da ist und dessen Name lang genug zum Drücken ist. */
const MODUL = 'Einsatzabschnitte';

// Login-/Anlege-Helfer kopiert — es gibt (noch) kein geteiltes e2e-Hilfsmodul
// (gleichlautend in fünf Bestands-Specs vermerkt).
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
 * Breite des Dokuments gegen die Sichtfläche.
 *
 * Die Wache auf einen INHALTS-Wortlaut ist kein Beiwerk: `kraefte-schmal.spec.ts` hat
 * teuer gelernt, dass eine Messung vor dem Eintreffen der Daten den Ladebildschirm prüft —
 * ohne Zeilen gibt es keinen Überlauf, und der Test war zweimal grün, während die Seite in
 * Wirklichkeit 327 px überlief.
 *
 * `poll` statt Einmalmessung fängt den umgekehrten Fehler: ein Layout, das erst nach dem
 * ersten Bildaufbau in seine Endbreite wächst.
 */
async function keinQuerlauf(page: Page, pfad: string, inhaltsWortlaut: string | RegExp) {
  await page.goto(pfad);
  await expect(
    page.getByText(inhaltsWortlaut).first(),
    `${pfad}: der Inhalt muss vor der Messung stehen — sonst misst der Test den Ladezustand`,
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        page
          .evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          }))
          .then((m) => m.scroll - m.client),
      { message: `${pfad} läuft waagerecht über` },
    )
    .toBeLessThanOrEqual(SUBPIXEL);
}

/** Pfad der Modul-Sektion — der Ort, an dem die Modulliste seit C10 wohnt (H15). */
function modulPfad(einsatzId: string): string {
  return `/einsaetze/${einsatzId}/einstellungen/module`;
}

test('bei 390 px läuft keine der vier Einstellungs-Sektionen waagerecht über', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Einstellungen schmal ${Date.now()}`);

  await page.setViewportSize(HANDSCHIRM);

  // Je Sektion ein Wortlaut, der erst MIT dem geladenen Inhalt erscheint.
  const sektionen: [string, string | RegExp][] = [
    ['allgemein', 'Standard-Modul (Einstieg)'],
    ['verhalten', /Präfix ETB/],
    ['aufbewahrung', /Aufbewahrungs-Dauer/],
    ['module', MODUL],
  ];
  for (const [sektion, wortlaut] of sektionen) {
    await keinQuerlauf(page, `/einsaetze/${einsatzId}/einstellungen/${sektion}`, wortlaut);
  }
});

/**
 * Die eigentliche H16-Aussage, und sie braucht BEIDE Richtungen.
 *
 * „Stapelt bei 390 px" allein wäre auch von einem Layout erfüllt, das IMMER stapelt — und
 * das wäre im Fükw (13–15", Vergleichsblick über 20 Modulzeilen) eine Verschlechterung.
 * Geprüft wird deshalb die Umkehrung mit: bei 1280 px stehen Beschriftung und Schalter auf
 * derselben Grundlinie.
 */
test('die Modulzeile stapelt bei 390 px — und steht bei 1280 px nebeneinander', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Modulzeile ${Date.now()}`);

  async function lagen(): Promise<{ label: number; schalter: number }> {
    await page.goto(modulPfad(einsatzId));
    const label = page.getByText(MODUL, { exact: true }).first();
    const schalter = page.getByRole('switch', { name: `Sichtbar: ${MODUL}` });
    await expect(label).toBeVisible();
    await expect(schalter).toBeVisible();
    const l = await label.boundingBox();
    const s = await schalter.boundingBox();
    expect(l, 'Beschriftung nicht messbar').not.toBeNull();
    expect(s, 'Schalter nicht messbar').not.toBeNull();
    return { label: l!.y, schalter: s!.y };
  }

  await page.setViewportSize(HANDSCHIRM);
  const schmal = await lagen();
  expect(
    schmal.schalter,
    `bei 390 px muss der Schalter UNTER der Beschriftung liegen (gemessen: Label y=${schmal.label}, Schalter y=${schmal.schalter})`,
  ).toBeGreaterThan(schmal.label);

  await page.setViewportSize(FUEKW);
  const breit = await lagen();
  expect(
    Math.abs(breit.schalter - breit.label),
    `bei 1280 px müssen Beschriftung und Schalter auf einer Zeile stehen (gemessen: Label y=${breit.label}, Schalter y=${breit.schalter})`,
  ).toBeLessThan(24);
});

/**
 * Die Spaltenköpfe verschwinden mit den Spalten.
 *
 * Ein Kopf über gestapelten Zeilen benennt keine Spalten mehr, sondern behauptet eine
 * Ordnung, die es nicht gibt — „Sichtbar" stünde dann als einzelnes Wort über einer Karte.
 */
test('die Spaltenköpfe stehen nur dort, wo es Spalten gibt', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Spaltenkopf ${Date.now()}`);

  await page.setViewportSize(FUEKW);
  await page.goto(modulPfad(einsatzId));
  await expect(page.getByText(MODUL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Sichtbar', { exact: true })).toBeVisible();

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(modulPfad(einsatzId));
  await expect(page.getByText(MODUL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Sichtbar', { exact: true })).toHaveCount(0);
});

for (const { dichte, soll } of STAFFEL) {
  test(`Stufe ${dichte}: die Modulzeile ist auf 390 px ein Ziel von ${soll} px`, async ({
    page,
  }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `Modulziel ${dichte} ${Date.now()}`);

    await page.setViewportSize(HANDSCHIRM);
    await page.goto(modulPfad(einsatzId));

    if (dichte === 'handschuh') {
      // Eine GESPEICHERTE Wahl gewinnt gegen die Zeigerart (LFH-361) — nur so ist die
      // Handschuh-Stufe erreichbar. `ThemeModeProvider` liest den Speicher beim Montieren,
      // ein Setzen ohne Neuladen bliebe folgenlos.
      await page.evaluate(
        ([schluessel, wert]) => window.localStorage.setItem(schluessel, wert),
        [DICHTE_SCHLUESSEL, dichte] as const,
      );
      await page.reload();
    }

    // Erste Zusicherung: die Stufe ist angekommen. Ohne sie hätte jedes „zu klein" zwei
    // mögliche Ursachen.
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    const beschriftung = page.locator(`label:has-text("${MODUL}")`).first();
    await expect(beschriftung).toBeVisible();

    const kasten = await beschriftung.boundingBox();
    expect(kasten, 'Beschriftung nicht messbar').not.toBeNull();
    expect(
      kasten!.height,
      `Modulzeile (gemessen ${kasten!.height} px) soll die Stufe ${dichte} halten`,
    ).toBeGreaterThanOrEqual(soll - SUBPIXEL);

    // Und sie SCHALTET auch: ein Ziel der richtigen Größe, das nichts tut, wäre die halbe
    // Aussage — genau die Hälfte, die das `<label htmlFor>` überhaupt erst rechtfertigt.
    const schalter = page.getByRole('switch', { name: `Sichtbar: ${MODUL}` });
    await expect(schalter).toBeChecked();
    await beschriftung.click();
    await expect(schalter).not.toBeChecked();
  });
}

/**
 * Der Rollen-Auswähler muss auf der schmalen Karte bedienbar BLEIBEN.
 *
 * Die feste `width: 180` ist einem `minmax(0, 1fr) auto auto`-Raster gewichen — eine
 * `auto`-Spalte bemisst sich nach ihrem Inhalt, und ein `<Select>` mit `width: 100%` hat
 * keine eigene Mindestbreite. Ohne diese Messung wäre die Spalte theoretisch auf ihre
 * Pfeil-Ikone zusammenfallbar, und der Befund H16 wäre gegen einen neuen eingetauscht.
 */
test('der Rollen-Auswähler bleibt auf 390 px breit genug zum Treffen', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Rollenspalte ${Date.now()}`);

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(modulPfad(einsatzId));

  const auswahl = page.getByRole('combobox', { name: `Benötigte Rolle: ${MODUL}` });
  await expect(auswahl).toBeVisible();

  const kasten = await auswahl.boundingBox();
  expect(kasten, 'Rollen-Auswähler nicht messbar').not.toBeNull();
  // 120 px ist kein Schönheitsmass, sondern die Breite, ab der die längste Option
  // („Führungskraft") überhaupt lesbar steht statt abgeschnitten.
  expect(
    kasten!.width,
    `Rollen-Auswähler (gemessen ${kasten!.width} px) ist zu schmal zum Treffen und Lesen`,
  ).toBeGreaterThanOrEqual(120);
});
