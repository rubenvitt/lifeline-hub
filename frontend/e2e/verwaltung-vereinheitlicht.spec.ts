import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Die Verwaltungsflächen im echten Layout: Trefflächenhöhe einer Zeilenaktion, Abstand zur
 * destruktiven Nachbarin, eine Rasterspalte, die nicht zusammenfällt, eine Speicherleiste im
 * Blickfeld. `test/utils.tsx` montiert ein nacktes `ConfigProvider`, jsdom rechnet kein Layout.
 *
 * DIE SCHWELLE IST DIE STAFFEL (30 / 48 / 72): die Zeilenknöpfe erben `controlHeight`. Ein
 * Test auf „≥ 32" liefe in keiner Stufe sinnvoll und fände weder eine punktuelle Klein-Angabe
 * noch eine durchgreifende falsche Stufe; gepinnt wird die Stufe selbst.
 *
 * ABSOLUTE PIXEL statt Verhältnis: `KatalogTabelle` rendert mit `width: max-content`, ein
 * Verhältnis Spalte-zu-Tabelle schrumpfte bei langem Inhalt. Wo ein Bezug nötig ist, ist es
 * die Contentbreite des Zeilencontainers (`clientWidth`).
 *
 * Die Dichte kommt aus der gespeicherten Wahl (`addInitScript`), nicht aus `hasTouch`: das
 * läge auf der ganzen Datei und höbe auch Test 2 und 3 von `kompakt` weg.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — der Wert ist Vertrag. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

const FUEKW = { width: 1280, height: 800 };
const HANDSCHIRM = { width: 390, height: 844 };

/** `boundingBox()` liefert Fließkomma, Chromium rechnet unter Last anders. */
const SUBPIXEL = 0.5;

/**
 * Die Staffel als Literale, nicht aus `theme/tokens` — sonst prüfte der Test sich selbst.
 * `zeilenhoehe` = `controlHeight`, `abstandSm` = `marginSM` (geforderter Mindestabstand zur
 * destruktiven Nachbarin), `abstandMd` = was `<Space size="middle">` tatsächlich legt.
 */
const STAFFEL = [
  { dichte: 'kompakt', zeilenhoehe: 30, abstandSm: 7, abstandMd: 11 },
  { dichte: 'komfortabel', zeilenhoehe: 48, abstandSm: 11, abstandMd: 18 },
  // Dritte Stufe (LFH-724, Prüfliste C11 Tabelle 1): die offene Hälfte war „ein dritter Eintrag
  // in STAFFEL, kein Umbau“.
  { dichte: 'handschuh', zeilenhoehe: 72, abstandSm: 16, abstandMd: 26 },
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
 * Fahrzeug über die API anlegen. Der `dienststatus` wird mitgelesen: nur an `in_dienst` steht
 * die destruktive Nachbarin „Außer Dienst" — sonst vergliche die Abstandsmessung zwei harmlose
 * Knöpfe und bliebe fälschlich grün.
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
// Zeilenaktion und ihr Abstand zur destruktiven Nachbarin. Die Stufen laufen als getrennte
// Tests: `addInitScript` wirkt beim Kontextaufbau.

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

    // (a) Höhe = die Steuerhöhe der Stufe. GLEICHHEIT: nach unten fängt sie eine punktuelle
    //     Klein-Angabe, nach oben eine durchgreifende falsche Stufe.
    for (const [name, box] of [
      ['Bearbeiten', links],
      ['Außer Dienst', rechts],
    ] as const) {
      expect(
        Math.abs(box.height - zeilenhoehe),
        `${name} (gemessen ${box.height} px) muss die Steuerhöhe der Stufe ${dichte} tragen (${zeilenhoehe} px)`,
      ).toBeLessThanOrEqual(SUBPIXEL);
    }

    // (b) Abstand zur destruktiven Nachbarin gegen die FORDERUNG (`marginSM`), nicht gegen
    //     den Ist-Wert — sonst bräche die Zusicherung bei jeder Abstandspflege. `Space` ohne
    //     `size` legte nur `paddingXS` und fiele durch.
    const luecke = rechts.x - (links.x + links.width);
    expect(
      luecke,
      `Abstand zwischen neutraler und destruktiver Aktion (gemessen ${luecke} px) muss mindestens marginSM (${abstandSm} px) betragen; erwartet aus size="middle": ${abstandMd} px`,
    ).toBeGreaterThanOrEqual(abstandSm - SUBPIXEL);
  });
}

// ── MESSUNG 2 ───────────────────────────────────────────────────────────────────────────
//
// Die Modulzeile der Einsatz-Defaults (`/admin/einstellungen/einsatz`), bei 390 px
// gestapelt. `einstellungen-schmal.spec.ts` misst dagegen die Einsatz-Route mit drei
// Rasterkindern.

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

// Die Breite, ab der die längste Option („Führungskraft") lesbar steht statt abgeschnitten.
const LESBAR = 120;

test('bei 390 px stapelt die Modulzeile der Einsatz-Defaults, die Spaltenköpfe fallen weg und der Rollen-Auswähler bleibt breit', async ({
  page,
}) => {
  await anmelden(page);
  await page.setViewportSize(HANDSCHIRM);
  await page.goto('/admin/einstellungen/einsatz');

  const auswahl = page.getByRole('combobox', { name: `Benötigte Rolle: ${MODUL}` });
  await expect(auswahl).toBeVisible();

  // Ein Kopf über gestapelten Zeilen benennt keine Spalten mehr.
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
  expect(
    masse.breite,
    `Rollen-Auswähler bei 390 px (gemessen ${masse.breite} px in einer ${masse.zeilenbreite} px breiten Zeile) ist zu schmal zum Treffen und Lesen`,
  ).toBeGreaterThanOrEqual(LESBAR);
  // …und er sprengt die Zeile nicht: ohne Obergrenze erfüllte auch ein Überlauf die Aussage.
  expect(
    masse.breite,
    `Rollen-Auswähler (${masse.breite} px) darf die Contentbreite seiner Zeile (${masse.zeilenbreite} px) nicht überschreiten`,
  ).toBeLessThanOrEqual(masse.zeilenbreite + SUBPIXEL);
});

/**
 * Die breite Ansicht (LFH-474): bis dahin fiel die `auto`-Spur der Rollen-Spalte hier auf rund
 * 56 px zusammen, weil ein `<Select>` mit `width: 100%` keine Inhaltsbreite beiträgt. Die Spur
 * ist jetzt fest (`modulRasterSpalten`); gemessen wird dieselbe Schwelle wie bei 390 px.
 */
test('bei 1280 px steht der Rollen-Auswähler der Einsatz-Defaults breit genug zum Lesen', async ({
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
  expect(
    masse.breite,
    `Rollen-Auswähler bei 1280 px (gemessen ${masse.breite} px in einer ${masse.zeilenbreite} px breiten Zeile) ist zu schmal zum Lesen`,
  ).toBeGreaterThanOrEqual(LESBAR);
  expect(
    masse.breite,
    `Rollen-Auswähler (${masse.breite} px) darf die Contentbreite seiner Zeile (${masse.zeilenbreite} px) nicht überschreiten`,
  ).toBeLessThanOrEqual(masse.zeilenbreite + SUBPIXEL);
});

/**
 * LFH-435 · Zweig „Org-Führungskraft": dieselbe Messung ohne Admin-Recht. Die Führungskraft
 * erreicht die Einsatz-Defaults, darf sie aber nicht ändern: Rechtehinweis, gesperrtes
 * Formular, und JEDE Modulzeile trägt den Sperrgrund „nur Admins" in ihrer Beschriftungszelle
 * (`EinsatzDefaults.tsx`, `ModulEinstellungsListe.tsx`). Der Sperrgrund ist das Element, das
 * die Rolle hinzufügt — gemessen wird deshalb zusätzlich, dass keine Zeile in sich überläuft;
 * die Breite des Auswählers sähe einen Sperrgrund nicht, der nur die Beschriftung sprengt.
 *
 * Nicht gespiegelt: Messung 1 (die Aktionsspalte entfällt ohne Admin-Recht, `dienststatus.tsx`
 * — es gibt nichts zu messen) und Messung 3 (1280 px, außerhalb dieses Auftrags).
 */
test('bei 390 px stapelt die gesperrte Modulzeile der Einsatz-Defaults, und keine Zeile läuft über (Führungskraft)', async ({
  page,
}) => {
  await anmelden(page);
  await wechsleZuRolle(page, 'fuehrungskraft');
  await page.setViewportSize(HANDSCHIRM);
  await page.goto('/admin/einstellungen/einsatz');

  const auswahl = page.getByRole('combobox', { name: `Benötigte Rolle: ${MODUL}` });
  await expect(auswahl).toBeVisible();

  // ── VORBEDINGUNGEN: der Nur-Lese-Zweig steht.
  await expect(
    page.getByRole('alert').filter({ hasText: 'dürfen die Org-Defaults ändern' }),
    'Vorbedingung: der Rechtehinweis des Nur-Lese-Zweigs steht',
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Speichern', exact: true }),
    'Vorbedingung: Speichern ist gesperrt, nicht versteckt',
  ).toBeDisabled();
  const modulZeile = page.locator('[data-modul-zeile]').filter({ hasText: MODUL });
  await expect(
    modulZeile.getByText('nur Admins', { exact: true }),
    'Vorbedingung: die Modulzeile nennt ihren Sperrgrund',
  ).toBeVisible();
  await expect(auswahl, 'Vorbedingung: der Auswähler ist gesperrt, nicht versteckt').toBeDisabled();

  // Wie im Admin-Test: Spaltenköpfe weg, gestapelt, Auswähler lesbar und in seiner Zeile.
  await expect(
    page.getByText('Benötigte Rolle (Default)', { exact: true }),
    'unter md fallen die Spaltenköpfe GANZ weg',
  ).toHaveCount(0);
  const label = page.getByText(MODUL, { exact: true }).first();
  await expect(label).toBeVisible();
  const l = (await label.boundingBox())!;
  const a = (await auswahl.boundingBox())!;
  expect(
    a.y,
    `bei 390 px muss der Auswähler UNTER der Beschriftung liegen (Label y=${l.y}, Auswähler y=${a.y})`,
  ).toBeGreaterThan(l.y);

  const masse = await rollenspaltenMasse(page);
  expect(
    masse.breite,
    `Rollen-Auswähler bei 390 px (gemessen ${masse.breite} px in einer ${masse.zeilenbreite} px breiten Zeile) ist zu schmal zum Treffen und Lesen`,
  ).toBeGreaterThanOrEqual(LESBAR);
  expect(
    masse.breite,
    `Rollen-Auswähler (${masse.breite} px) darf die Contentbreite seiner Zeile (${masse.zeilenbreite} px) nicht überschreiten`,
  ).toBeLessThanOrEqual(masse.zeilenbreite + SUBPIXEL);

  // Zusätzlich: der Sperrgrund sprengt keine Zeile.
  const befunde = await page.locator('[data-modul-zeile]').evaluateAll((els) =>
    els
      .map((el) => ({
        modul: el.getAttribute('data-modul-zeile'),
        ueber: el.scrollWidth - el.clientWidth,
      }))
      .filter((z) => z.ueber > 0),
  );
  expect(befunde, 'Modulzeilen laufen waagerecht über (gesperrter Zweig)').toEqual([]);
});

// ── MESSUNG 3 ───────────────────────────────────────────────────────────────────────────
//
// Die Fahrzeug-Detailseite: per Deeplink erreichbar, Sektionen da, Speicherleiste im
// Blickfeld — per `toBeInViewport()`, weil `toBeVisible()` auch ein Element unterhalb des
// sichtbaren Bereichs durchwinkt. Die BILDLAUFRESERVE ist Vorbedingung: ohne sie stünde die
// sticky Leiste an ihrer natürlichen Stelle und wäre trivial im Blickfeld.

test('die Fahrzeug-Detailseite ist per Deeplink erreichbar und ihre Speicherleiste steht im Blickfeld', async ({
  page,
}) => {
  await anmelden(page);
  const fahrzeug = await fahrzeugAnlegen(page, `E2E Detail ${Date.now()}`);

  await page.setViewportSize({ width: 1280, height: 420 });
  // Echter Deeplink: direkt auf die Adresse, nicht über einen Klick in der Liste.
  await page.goto(`/admin/stammdaten/fahrzeuge/${fahrzeug.id}`);

  await expect(page.getByRole('heading', { name: fahrzeug.funkrufname })).toBeVisible();
  // Die vier Paneele über ihre Überschriften. Das vierte heißt „Freitext": als „Bemerkung"
  // hieße es wie das Feld darin, und `getByLabelText('Bemerkung')` träfe zwei Knoten.
  for (const titel of ['Identität', 'Funk & Sonderrechte', 'Kapazität', 'Freitext']) {
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

  // Ganz nach oben — dort steht die Leiste NUR durch ihr `sticky` im Blickfeld.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(speichern).toBeInViewport();
});
