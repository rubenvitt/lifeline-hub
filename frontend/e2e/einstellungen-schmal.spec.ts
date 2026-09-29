import { expect, test, type Page } from '@playwright/test';

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
 * Der Rollen-Auswähler bleibt auf der schmalen Karte bedienbar: im Raster
 * `minmax(0, 1fr) auto auto` hat ein `<Select>` mit `width: 100%` keine eigene Mindestbreite
 * und könnte auf seine Pfeil-Ikone zusammenfallen.
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
  // Die Breite, ab der die längste Option („Führungskraft") lesbar steht statt abgeschnitten.
  expect(
    kasten!.width,
    `Rollen-Auswähler (gemessen ${kasten!.width} px) ist zu schmal zum Treffen und Lesen`,
  ).toBeGreaterThanOrEqual(120);
});
