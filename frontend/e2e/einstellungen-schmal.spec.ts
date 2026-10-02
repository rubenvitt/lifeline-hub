import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Die Einsatz-Einstellungen am Handschirm. Die Modulzeile stapelt unter `md`, damit das
 * Modul-Label neben Sichtbar- und Rollen-Spalte nicht auf unter 100 px schrumpft. Dass die
 * Spaltenköpfe fehlen, prüft `ModulEinstellungsListe.test.tsx`; ob die Zeile stapelt, passt
 * und ihre Höhe hält, nur ein echtes Layout.
 *
 * DIE SCHWELLE IST DIE STAFFEL (30 / 48 / 72), nicht die 44 aus WCAG 2.5.5 — ein Test auf 44
 * ließe eine Regression auf 44–47 px durch.
 *
 * `hasTouch` (nur per `test.use`): ohne es bliebe `(pointer: coarse)` false und die Stufe
 * `kompakt`.
 */
test.use({ hasTouch: true });

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const HANDSCHIRM = { width: 390, height: 844 };
const FUEKW = { width: 1280, height: 800 };

/** Die Dichte-Staffel als Literale — aus `theme/tokens` importiert prüfte der Test sich selbst. */
const STAFFEL = [
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

/** Subpixel-Spielraum: `boundingBox()` liefert Fließkomma, Chromium rechnet unter Last anders. */
const SUBPIXEL = 0.5;

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — der Wert ist Vertrag. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/** Ein Modul, dessen Zeile in JEDER Stufe da ist und dessen Name lang genug zum Drücken ist. */
const MODUL = 'Einsatzabschnitte';

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
 * Breite des Dokuments gegen die Sichtfläche. Die Wache auf einen INHALTS-Wortlaut verhindert,
 * dass der Ladebildschirm gemessen wird (ohne Zeilen kein Überlauf); `poll` fängt ein Layout,
 * das erst nach dem ersten Bild in seine Endbreite wächst.
 */
async function keinQuerlauf(
  page: Page,
  pfad: string,
  inhaltsWortlaut: string | RegExp,
  vorbedingung?: (p: Page) => Promise<void>,
) {
  await page.goto(pfad);
  await expect(
    page.getByText(inhaltsWortlaut).first(),
    `${pfad}: der Inhalt muss vor der Messung stehen — sonst misst der Test den Ladezustand`,
  ).toBeVisible();
  // Der Rollenzweig (LFH-435) muss stehen, BEVOR gemessen wird.
  if (vorbedingung) await vorbedingung(page);
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

/** Pfad der Modul-Sektion. */
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
 * Beide Richtungen: „stapelt bei 390 px" erfüllte auch ein Layout, das IMMER stapelt — im Fükw
 * eine Verschlechterung. Bei 1280 px stehen Beschriftung und Schalter auf derselben Grundlinie.
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
 * Die Spaltenköpfe verschwinden mit den Spalten: über gestapelten Zeilen behauptete ein Kopf
 * eine Ordnung, die es nicht gibt.
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
      // Eine GESPEICHERTE Wahl gewinnt gegen die Zeigerart — nur so ist die Handschuh-Stufe
      // erreichbar; wirksam erst nach dem Neuladen.
      await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
        DICHTE_SCHLUESSEL,
        dichte,
      ] as const);
      await page.reload();
    }

    // Erste Zusicherung: die Stufe ist angekommen.
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    const beschriftung = page.locator(`label:has-text("${MODUL}")`).first();
    await expect(beschriftung).toBeVisible();

    const kasten = await beschriftung.boundingBox();
    expect(kasten, 'Beschriftung nicht messbar').not.toBeNull();
    expect(
      kasten!.height,
      `Modulzeile (gemessen ${kasten!.height} px) soll die Stufe ${dichte} halten`,
    ).toBeGreaterThanOrEqual(soll - SUBPIXEL);

    // Und sie SCHALTET auch — die Hälfte, die das `<label htmlFor>` erst rechtfertigt.
    const schalter = page.getByRole('switch', { name: `Sichtbar: ${MODUL}` });
    await expect(schalter).toBeChecked();
    await beschriftung.click();
    await expect(schalter).not.toBeChecked();
  });
}

/**
 * Der Rollen-Auswähler bleibt auf jeder Breite bedienbar: ein `<Select>` mit `width: 100%` hat
 * keine eigene Inhaltsbreite und fiel in einer `auto`-Spur bei 1280 px auf rund 56 px zusammen
 * (LFH-474). Bei 390 px stapelt das Raster, bei 1280 px trägt ihn die feste Rollen-Spur.
 */
for (const [name, fenster] of [
  ['390 px', HANDSCHIRM],
  ['1280 px', FUEKW],
] as const) {
  test(`der Rollen-Auswähler bleibt auf ${name} breit genug zum Treffen`, async ({ page }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `Rollenspalte ${Date.now()}`);

    await page.setViewportSize(fenster);
    await page.goto(modulPfad(einsatzId));

    const auswahl = page.getByRole('combobox', { name: `Benötigte Rolle: ${MODUL}` });
    await expect(auswahl).toBeVisible();

    const kasten = await auswahl.boundingBox();
    expect(kasten, 'Rollen-Auswähler nicht messbar').not.toBeNull();
    const zeilenbreite = await auswahl.evaluate(
      (el) => (el.closest('[data-modul-zeile]') as HTMLElement).clientWidth,
    );
    // Die Breite, ab der die längste Option („Führungskraft") lesbar steht statt abgeschnitten.
    expect(
      kasten!.width,
      `Rollen-Auswähler bei ${name} (gemessen ${kasten!.width} px in einer ${zeilenbreite} px breiten Zeile) ist zu schmal zum Treffen und Lesen`,
    ).toBeGreaterThanOrEqual(120);
    // …und er sprengt die Zeile nicht: ohne Obergrenze erfüllte auch ein Überlauf die Aussage.
    expect(
      kasten!.width,
      `Rollen-Auswähler (${kasten!.width} px) darf die Contentbreite seiner Zeile (${zeilenbreite} px) nicht überschreiten`,
    ).toBeLessThanOrEqual(zeilenbreite + SUBPIXEL);
  });
}

// ── LFH-435: die Sektionen ohne volles Recht ────────────────────────────────────────────
//
// Ohne Recht fügen die Sektionen hinzu (Rechtehinweis, Sperrgrund „nur Einsatzleitung" an jeder
// Modulzeile) — genau die Zweige, die ein Admin-Durchgang nie sieht. Jede Vorbedingung steht
// VOR der Messung; ohne sie wäre der Durchgang grün durch Nichtstun.

/** Die Rechtehinweise der Sektionen, je über ein Fragment, das nur EINEN Hinweis trifft —
 *  auf der Aufbewahrung stehen zwei (Einstellungen und Frist). */
const HINWEIS_EINSTELLUNGEN = 'darf die Einstellungen dieses Einsatzes';
const HINWEIS_FRIST = 'darf die Aufbewahrungsfrist';
const HINWEIS_MODULE = 'darf die Modul-Sichtbarkeit';

function rechteHinweis(p: Page, fragment: string) {
  return p.getByRole('alert').filter({ hasText: fragment });
}

/** Der Speichern-Knopf der Formular-Sektion (die Frist trägt „Frist ändern", nicht „Speichern"). */
function speichern(p: Page) {
  return p.getByRole('button', { name: 'Speichern', exact: true });
}

/**
 * Keine Modulzeile läuft in sich über. Die Dokumentmessung sähe einen Sperrgrund nicht, der
 * nur seine Zeile sprengt; gemessen wird deshalb das Element, das die Rolle hinzufügt.
 */
async function modulZeilenOhneUeberlauf(page: Page) {
  const zeilen = page.locator('[data-modul-zeile]');
  await expect(zeilen.first()).toBeVisible();
  const befunde = await zeilen.evaluateAll((els) =>
    els
      .map((el) => ({
        modul: el.getAttribute('data-modul-zeile'),
        ueber: el.scrollWidth - el.clientWidth,
      }))
      .filter((z) => z.ueber > 0),
  );
  expect(befunde, 'Modulzeilen laufen waagerecht über').toEqual([]);
}

/** Die gesperrte Modulzeile: Sperrgrund sichtbar, Schalter und Auswähler gesperrt. */
async function modulZeileGesperrt(page: Page) {
  await expect(
    rechteHinweis(page, HINWEIS_MODULE),
    'Vorbedingung: der Rechtehinweis der Modul-Sektion steht',
  ).toBeVisible();
  await expect(
    page.locator(`[data-modul-zeile]`).filter({ hasText: MODUL }).getByText('nur Einsatzleitung'),
    'Vorbedingung: die Modulzeile nennt ihren Sperrgrund',
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: `Sichtbar: ${MODUL}` }),
    'Vorbedingung: der Schalter ist gesperrt, nicht versteckt',
  ).toBeDisabled();
}

/** Der Rollen-Auswähler hält auch gesperrt die Breite des Admin-Tests. */
async function rollenAuswaehlerLesbar(page: Page) {
  const auswahl = page.getByRole('combobox', { name: `Benötigte Rolle: ${MODUL}` });
  await expect(auswahl).toBeVisible();
  await expect(auswahl, 'der Rollen-Auswähler ist gesperrt, nicht versteckt').toBeDisabled();
  const kasten = await auswahl.boundingBox();
  expect(kasten, 'Rollen-Auswähler nicht messbar').not.toBeNull();
  expect(
    kasten!.width,
    `Rollen-Auswähler (gemessen ${kasten!.width} px) ist zu schmal zum Lesen`,
  ).toBeGreaterThanOrEqual(120);
}

/**
 * LFH-435 · Zweig „Führungspersonal": schreibt, leitet aber nicht (`darfEinsatzLeiten` ≠
 * Schreibrecht). Die Modul-Sektion steht gesperrt mit Hinweis (`EinsatzModule.tsx`), die
 * Aufbewahrungsfrist ebenso (`darfFristSetzen`); Allgemein ist frei — das unterscheidet den
 * Zweig vom Beobachter und belegt, dass die Sitzung wirklich die gemeinte Rolle trägt.
 */
test('bei 390 px läuft keine Einstellungs-Sektion über — auch mit gesperrten Modulen (Führungspersonal)', async ({
  page,
}) => {
  // Fünf Sektionen plus Rollenwechsel: 30 s reichten unter Last nicht.
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Einstellungen Fuehrungspersonal ${Date.now()}`);
  await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);

  await page.setViewportSize(HANDSCHIRM);
  const basis = `/einsaetze/${einsatzId}/einstellungen`;

  await keinQuerlauf(page, `${basis}/allgemein`, 'Standard-Modul (Einstieg)', async (p) => {
    await expect(
      rechteHinweis(p, HINWEIS_EINSTELLUNGEN),
      'Vorbedingung: Führungspersonal darf die Einstellungen ändern — kein Hinweis',
    ).toHaveCount(0);
    await expect(speichern(p), 'Vorbedingung: Speichern ist frei').toBeEnabled();
  });
  await keinQuerlauf(page, `${basis}/verhalten`, /Präfix ETB/);
  await keinQuerlauf(page, `${basis}/aufbewahrung`, /Aufbewahrungs-Dauer/, async (p) => {
    await expect(
      rechteHinweis(p, HINWEIS_FRIST),
      'Vorbedingung: die Frist setzen nur Einsatzleitung und Admin der Einsatz-Org',
    ).toBeVisible();
    await expect(p.getByRole('button', { name: 'Frist ändern', exact: true })).toBeDisabled();
  });
  await keinQuerlauf(page, modulPfad(einsatzId), MODUL, modulZeileGesperrt);
  await modulZeilenOhneUeberlauf(page);
  await rollenAuswaehlerLesbar(page);
});

/**
 * LFH-435 · Zweig „Beobachter": weder Schreib- noch Leitungsrecht. JEDE Sektion trägt ihren
 * Rechtehinweis (`EinsatzAllgemein.tsx`, `EinsatzVerhalten.tsx`, `EinsatzAufbewahrung.tsx`,
 * `EinsatzPegel.tsx`, `EinsatzModule.tsx`), die Formulare stehen gesperrt. Die Pegel-Sektion
 * läuft hier zusätzlich mit: ihr Hinweis ist ein weiterer Zweig, den der Admin nicht sieht.
 */
test('bei 390 px läuft keine Einstellungs-Sektion über — auch mit Rechtehinweis (Beobachter)', async ({
  page,
}) => {
  // Fünf Sektionen plus Rollenwechsel: 30 s reichten unter Last nicht.
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Einstellungen Beobachter ${Date.now()}`);
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  await page.setViewportSize(HANDSCHIRM);
  const basis = `/einsaetze/${einsatzId}/einstellungen`;

  /** Hinweis sichtbar und Speichern gesperrt statt versteckt. */
  const formularGesperrt = async (p: Page) => {
    await expect(
      rechteHinweis(p, HINWEIS_EINSTELLUNGEN),
      'Vorbedingung: der Rechtehinweis der Sektion steht',
    ).toBeVisible();
    await expect(
      speichern(p),
      'Vorbedingung: Speichern ist gesperrt, nicht versteckt',
    ).toBeDisabled();
  };

  await keinQuerlauf(page, `${basis}/allgemein`, 'Standard-Modul (Einstieg)', formularGesperrt);
  await keinQuerlauf(page, `${basis}/verhalten`, /Präfix ETB/, formularGesperrt);
  await keinQuerlauf(page, `${basis}/aufbewahrung`, /Aufbewahrungs-Dauer/, async (p) => {
    await formularGesperrt(p);
    await expect(
      rechteHinweis(p, HINWEIS_FRIST),
      'Vorbedingung: auch der Frist-Hinweis steht',
    ).toBeVisible();
    await expect(p.getByRole('button', { name: 'Frist ändern', exact: true })).toBeDisabled();
  });
  await keinQuerlauf(page, `${basis}/pegel`, 'Maßgebliche Pegel', async (p) => {
    await expect(
      rechteHinweis(p, HINWEIS_EINSTELLUNGEN),
      'Vorbedingung: der Rechtehinweis der Pegel-Sektion steht',
    ).toBeVisible();
    await expect(
      p.getByRole('button', { name: 'Hinzufügen', exact: true }),
      'Vorbedingung: „Hinzufügen" ist gesperrt, nicht versteckt',
    ).toBeDisabled();
  });
  await keinQuerlauf(page, modulPfad(einsatzId), MODUL, modulZeileGesperrt);
  await modulZeilenOhneUeberlauf(page);
  await rollenAuswaehlerLesbar(page);
});
