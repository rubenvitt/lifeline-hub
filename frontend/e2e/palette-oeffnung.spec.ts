import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Öffnungswege der Sprungpalette im echten Browser. In Vitest ist `window.open` ein Spy; ein
 * neuer Tab ist aber immer ein KALTSTART (kein Query-Cache, kein Router-Zustand, nur Cookie
 * und URL). Gemessen wird deshalb im neuen Tab am ZIEL und im alten daran, dass er stehen
 * blieb.
 *
 * Die Vorschau läuft ebenfalls hier: ob der Palette-Handler im Portal VOR dem globalen
 * Dispatcher auf `window` `preventDefault` setzt, ist eine Frage der echten
 * Ereignisreihenfolge.
 *
 * Seeding über die Schnellerfassung (Kennung aus der Quittung); kein `networkidle`.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.setTimeout(120_000);

function paletteInput(page: Page): Locator {
  return page.getByPlaceholder(/Suchen: Module/);
}

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

async function zumModul(page: Page, id: string, modul: string) {
  await page.goto(`/einsaetze/${id}/${modul}`);
  await expect(page.locator('header').first()).toBeVisible();
}

async function suche(page: Page, begriff: string) {
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await paletteInput(page).fill(begriff);
}

/** Eine Person über die Schnellerfassung — die Kennung aus der Quittung. */
async function personErfassen(page: Page, einsatzId: string): Promise<string> {
  await page.goto(`/einsaetze/${einsatzId}/personen?neu=1`);
  await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  const quittung = page.getByText(/Erfasst als R-\d+/);
  await expect(quittung).toBeVisible();
  return (await quittung.innerText()).match(/R-\d+/)![0];
}

function personOption(page: Page, kennung: string): Locator {
  // Ohne die Adresszeile am Ende („Adresse auf Lagekarte suchen · „R-001““, LFH-638).
  return page
    .getByRole('option', { name: new RegExp(kennung) })
    .filter({ hasNotText: 'Adresse auf Lagekarte suchen' });
}

/** Das Tippziel „Vorschau" rechts in einer Zeile. */
function vorschauZiel(zeile: Locator): Locator {
  return zeile.locator('[data-lfh="palette-vorschau-ziel"]');
}

test('Strg+↵ öffnet eine Person im neuen Tab — kalt, angemeldet, am Datensatz; der alte Tab bleibt', async ({
  page,
  context,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Neuer Tab ${Date.now()}`);
  const kennung = await personErfassen(page, einsatzId);

  await zumModul(page, einsatzId, 'etb');
  const vorher = page.url();
  await suche(page, kennung);
  await expect(personOption(page, kennung)).toBeVisible();

  const neuerTab = context.waitForEvent('page');
  await page.keyboard.press('Control+Enter');
  const tab = await neuerTab;

  // Der neue Tab: Detailseite genau dieser Person, ohne Umweg über die Anmeldung.
  await expect(tab).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/\\d+$`));
  await expect(tab.getByRole('heading', { name: `Person ${kennung}` })).toBeVisible();

  // Der alte Tab: dieselbe Adresse, Palette zu.
  expect(page.url()).toBe(vorher);
  await expect(paletteInput(page)).toBeHidden();
  await tab.close();
});

/**
 * Eine FESTE Navigationszeile (Modul) aus `useBefehle`, nicht aus dem Datensatz-Finder — ein
 * eigener Weg, der die Öffnungsart verlieren kann. Strg/⌘+KLICK, damit auch der Mausweg
 * belegt ist.
 */
test('Strg/⌘+Klick auf ein Modul öffnet es im neuen Tab, der alte Tab bleibt', async ({
  page,
  context,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Neuer Tab Modul ${Date.now()}`);
  await zumModul(page, einsatzId, 'etb');
  await suche(page, 'Lagekarte');
  const modul = page.getByRole('option', { name: 'Lagekarte', exact: true });
  await expect(modul).toBeVisible();

  const neuerTab = context.waitForEvent('page');
  await modul.click({ modifiers: ['ControlOrMeta'] });
  const tab = await neuerTab;

  await expect(tab).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lagekarte`));
  await expect(tab.locator('header').first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb$`));
  await expect(paletteInput(page)).toBeHidden();
  await tab.close();
});

test('der Koordinatensprung trägt auch im neuen Tab bis auf die Lagekarte', async ({
  page,
  context,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Neuer Tab Karte ${Date.now()}`);
  await zumModul(page, einsatzId, 'etb');
  await suche(page, '52.52194, 13.41321');
  await expect(page.getByRole('option', { name: /Auf Lagekarte zeigen/ })).toBeVisible();

  const neuerTab = context.waitForEvent('page');
  await page.keyboard.press('Control+Enter');
  const tab = await neuerTab;

  await expect(tab).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lagekarte`));
  await expect(tab.locator('header').first()).toBeVisible();
  await expect(tab).not.toHaveURL(/\/login/);
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb`));
  await tab.close();
});

test('→ zeigt die Personenvorschau in der Palette, Esc führt zurück, ein zweites Esc schliesst', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Vorschau ${Date.now()}`);
  const kennung = await personErfassen(page, einsatzId);

  await zumModul(page, einsatzId, 'etb');
  await suche(page, kennung);
  await expect(personOption(page, kennung)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowRight');
  const vorschau = page.getByRole('region', { name: /^Vorschau:/ });
  await expect(vorschau).toBeVisible();
  await expect(vorschau.getByText(/Medizinischer Verlauf/)).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCount(0);

  // Esc geht EINE Ebene zurück — der globale Dispatcher darf die Palette nicht mitschliessen.
  await page.keyboard.press('Escape');
  await expect(vorschau).toBeHidden();
  await expect(paletteInput(page)).toHaveValue(kennung);
  await expect(personOption(page, kennung)).toHaveAttribute('aria-selected', 'true');
  // Im BLICK, nicht nur markiert: die Liste kommt mit `scrollTop` 0 zurück. `toBeVisible`
  // hielte auch eine Zeile unterhalb des sichtbaren Bereichs für sichtbar.
  await expect(personOption(page, kennung)).toBeInViewport();

  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb`));
});

/** Schlüssel der gespeicherten Dichtewahl. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/** Böden der Dichte-Staffel als LITERALE — aus dem Token gelesen prüfte die Messung sich selbst. */
const BODEN = { kompakt: 30, komfortabel: 48, handschuh: 72 } as const;

/**
 * Beide sichtbaren Wege der Vorschau über alle drei Stufen:
 *
 * HINEIN das Tippziel (`vorschauZielStil`): Höhe UND Breite gegen den Boden, bündig an der
 * rechten Kante über die volle Zeilenhöhe — daneben bliebe sonst ein Streifen, der den
 * Datensatz öffnete. Geöffnet per KLICK aufs Ziel; der Tastaturweg steht im Test darüber.
 *
 * ZURÜCK „Zurück", ein antd-`Button`, der seine Höhe erben soll — eine Annahme, bis sie
 * gemessen ist. Für Maus und Finger der einzige sichtbare Weg zurück.
 */
test('Vorschau-Ziel und „Zurück" halten den Dichte-Boden in allen drei Stufen', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Vorschau Dichte ${Date.now()}`);
  const kennung = await personErfassen(page, einsatzId);
  await zumModul(page, einsatzId, 'etb');

  for (const [stufe, boden] of Object.entries(BODEN)) {
    await page.evaluate(([s, w]) => window.localStorage.setItem(s, w), [
      DICHTE_SCHLUESSEL,
      stufe,
    ] as const);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', stufe);
    await expect(page.locator('header').first()).toBeVisible();

    await suche(page, kennung);
    const zeile = personOption(page, kennung);
    await expect(zeile).toHaveAttribute('aria-selected', 'true');
    const ziel = vorschauZiel(zeile);
    await expect(ziel).toBeVisible();
    const zBox = (await ziel.boundingBox())!;
    const zeilenBox = (await zeile.boundingBox())!;
    expect(zBox.height, `${stufe}: Höhe des Ziels`).toBeGreaterThanOrEqual(boden - 0.5);
    expect(zBox.width, `${stufe}: Breite des Ziels`).toBeGreaterThanOrEqual(boden - 0.5);
    // Bündig rechts und über die volle Zeilenhöhe (Toleranz: Subpixel-Rundung).
    expect(
      Math.abs(zBox.x + zBox.width - (zeilenBox.x + zeilenBox.width)),
      `${stufe}: rechte Kante`,
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(zBox.y - zeilenBox.y), `${stufe}: Oberkante`).toBeLessThanOrEqual(1);
    expect(Math.abs(zBox.height - zeilenBox.height), `${stufe}: volle Höhe`).toBeLessThanOrEqual(1);
    // Die Zeile bleibt die größere Trefffläche: das Ziel ist ein Rand, nicht die Zeile.
    expect(zBox.width, `${stufe}: Ziel schmaler als die Zeile`).toBeLessThan(zeilenBox.width / 2);

    await ziel.click();
    const zurueck = page
      .getByRole('region', { name: /^Vorschau:/ })
      .getByRole('button', { name: 'Zurück' });
    await expect(zurueck).toBeVisible();
    const box = (await zurueck.boundingBox())!;
    expect(box.height, `${stufe}: Höhe`).toBeGreaterThanOrEqual(boden - 0.5);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(paletteInput(page)).toBeHidden();
  }
});

/**
 * Als echter TIPP auf dem Führungs-Tablet (Handschuh): ein Tipp aufs Ziel öffnet die Vorschau
 * und lässt die Seite stehen, ein Tipp auf die übrige Zeile öffnet die Person. Erst der Tipp
 * belegt die Treffertrennung.
 */
test.describe('Tablet', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('ein Tipp aufs Vorschau-Ziel öffnet die Vorschau, ein Tipp auf die Zeile die Person', async ({
    page,
  }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Vorschau Tipp ${Date.now()}`);
    const kennung = await personErfassen(page, einsatzId);
    await zumModul(page, einsatzId, 'etb');
    await page.evaluate(([s, w]) => window.localStorage.setItem(s, w), [
      DICHTE_SCHLUESSEL,
      'handschuh',
    ] as const);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
    await expect(page.locator('header').first()).toBeVisible();
    const vorher = page.url();

    await suche(page, kennung);
    const zeile = personOption(page, kennung);
    await vorschauZiel(zeile).tap();
    const vorschau = page.getByRole('region', { name: /^Vorschau:/ });
    await expect(vorschau).toBeVisible();
    await expect(vorschau.getByText(/Medizinischer Verlauf/)).toBeVisible();
    expect(page.url()).toBe(vorher);
    // Der Fokus bleibt im Suchfeld: Esc führt von dort eine Ebene zurück.
    await expect(paletteInput(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(vorschau).toBeHidden();

    // Die übrige Zeile öffnet wie bisher — getippt auf das Label, links vom Ziel.
    await zeile.getByText(kennung).tap();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/\\d+$`));
    await expect(page.getByRole('heading', { name: `Person ${kennung}` })).toBeVisible();
  });
});

/**
 * Der engste Fall: Handschirm 390 px in der Stufe Handschuh. Das Label darf umbrechen, die
 * Zeile aber nicht über ihre Box ragen, und das Ziel muss ganz im Blick und tippbar bleiben.
 */
test.describe('Handschirm', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('bei 390 px in Stufe Handschuh läuft die Zeile nicht über und das Ziel bleibt tippbar', async ({
    page,
  }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Vorschau Schmal ${Date.now()}`);
    const kennung = await personErfassen(page, einsatzId);
    await zumModul(page, einsatzId, 'etb');
    await page.evaluate(([s, w]) => window.localStorage.setItem(s, w), [
      DICHTE_SCHLUESSEL,
      'handschuh',
    ] as const);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
    await expect(page.locator('header').first()).toBeVisible();

    await suche(page, kennung);
    const zeile = personOption(page, kennung);
    const ziel = vorschauZiel(zeile);
    await expect(ziel).toBeInViewport({ ratio: 1 });
    const zBox = (await ziel.boundingBox())!;
    expect(zBox.width, 'Breite des Ziels').toBeGreaterThanOrEqual(BODEN.handschuh - 0.5);
    expect(zBox.height, 'Höhe des Ziels').toBeGreaterThanOrEqual(BODEN.handschuh - 0.5);
    // Kein waagerechter Überlauf — weder in der Zeile noch in der Liste.
    const ueberlauf = await zeile.evaluate((el) => ({
      zeile: el.scrollWidth - el.clientWidth,
      liste:
        el.closest('[role="listbox"]')!.scrollWidth - el.closest('[role="listbox"]')!.clientWidth,
    }));
    expect(ueberlauf.zeile, 'Überlauf der Zeile').toBeLessThanOrEqual(0);
    expect(ueberlauf.liste, 'Überlauf der Liste').toBeLessThanOrEqual(0);

    await ziel.tap();
    await expect(page.getByRole('region', { name: /^Vorschau:/ })).toBeVisible();
  });
});

/**
 * Vorschauen der übrigen Datensatzsorten. Seeding über die API: eine Meldung mit Auftrag
 * entstünde sonst erst nach zwei Formularen, die nicht Gegenstand dieses Tests sind.
 */
async function apiPost(page: Page, pfad: string, data: unknown) {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), await antwort.text()).toBe(true);
  return antwort.json();
}

test('→ zeigt eine Meldung, und ihr Verweis „↗ Auftrag" führt hin und schließt die Palette', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Vorschau Meldung ${Date.now()}`);
  const basis = `/api/einsaetze/${einsatzId}`;
  const meldung = await apiPost(page, `${basis}/meldungen`, {
    absender: 'Florian Nordwache',
    meldeweg: 'funk',
    inhalt: 'Deich am Pegel hält, Sickerstelle beobachtet',
    ereigniszeit: new Date().toISOString(),
  });
  await apiPost(page, `${basis}/meldungen/${meldung.id}/auftrag`, {
    auftrag_text: 'Sickerstelle sichern',
    empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EL' }],
  });

  await zumModul(page, einsatzId, 'etb');
  await suche(page, 'Nordwache');
  const zeile = page.getByRole('option', { name: /Florian Nordwache/ });
  await expect(zeile).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');

  const vorschau = page.getByRole('region', { name: /^Vorschau:/ });
  await expect(
    vorschau.getByText('Deich am Pegel hält, Sickerstelle beobachtet', { exact: true }),
  ).toBeVisible();
  // Nur lesen: die Triage-Knöpfe der Meldungskarte stehen in der Vorschau nicht.
  await expect(vorschau.getByRole('button', { name: 'Sichten' })).toHaveCount(0);

  // Geklickt, nicht nur `toBeVisible` — nur der Klick belegt, dass der Weg trägt.
  await vorschau.getByRole('link', { name: /Auftrag/ }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/auftraege\\?auftrag=\\d+`));
  await expect(paletteInput(page)).toBeHidden();
});

/**
 * Über die VOLLTEXTSUCHE gefunden: `#1` läge unter `DATENSATZ_MINDESTZEICHEN`. Der strengere
 * Weg — die Vorschau liest den Eintrag KALT über den Nummerncursor nach und prüft die `id`.
 */
test('→ zeigt einen ETB-Eintrag aus der Volltextsuche', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Vorschau ETB ${Date.now()}`);
  await apiPost(page, `/api/einsaetze/${einsatzId}/etb`, {
    typ: 'lage',
    an: 'Leitstelle',
    inhalt: 'Wasserstand steigt um zehn Zentimeter je Stunde',
    von: 'Abschnitt Nord',
  });

  await zumModul(page, einsatzId, 'personen');
  await suche(page, '#Wasserstand');
  await expect(page.getByRole('option', { name: /Wasserstand steigt/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowRight');

  const vorschau = page.getByRole('region', { name: /^Vorschau:/ });
  // `exact`: der Kopf der Vorschau trägt dieselben Worte im Label („#n · Wasserstand …").
  await expect(
    vorschau.getByText('Wasserstand steigt um zehn Zentimeter je Stunde', { exact: true }),
  ).toBeVisible();
  await expect(vorschau.getByText('Abschnitt Nord → —')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(vorschau).toBeHidden();
  await expect(paletteInput(page)).toHaveValue('#Wasserstand');
});

/**
 * Die Rückrichtung der Berichtigung (LFH-689): der Grundeintrag steht allein auf der Seite des
 * Nummerncursors, seine Berichtigung nicht — der Server trägt sie trotzdem an ihm mit. Der Klick
 * auf den Verweis öffnet die Berichtigung im ETB und schließt die Palette.
 */
test('→ nennt am berichtigten ETB-Eintrag „berichtigt durch Nr. …" und führt hin', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Vorschau Berichtigung ${Date.now()}`);
  const basis = `/api/einsaetze/${einsatzId}/etb`;
  const grund = await apiPost(page, basis, {
    typ: 'meldung',
    von: 'ELW 1',
    an: 'Leitstelle',
    inhalt: 'Pegel Nordbrücke bei vier Metern zwanzig',
  });
  const berichtigung = await apiPost(page, basis, {
    typ: 'berichtigung',
    von: 'ELW 1',
    an: 'Leitstelle',
    inhalt: 'Pegel Nordbrücke richtig: drei Meter zwanzig',
    berichtigt_eintrag_id: grund.id,
  });

  await zumModul(page, einsatzId, 'personen');
  await suche(page, '#vier Metern');
  await expect(page.getByRole('option', { name: /vier Metern zwanzig/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowRight');

  const vorschau = page.getByRole('region', { name: /^Vorschau:/ });
  const verweis = vorschau.getByRole('link', {
    name: `berichtigt durch Nr. ${berichtigung.lfd_nr}`,
  });
  await verweis.click();
  await expect(page).toHaveURL(
    new RegExp(`/einsaetze/${einsatzId}/etb\\?eintrag=${berichtigung.id}$`),
  );
  await expect(paletteInput(page)).toBeHidden();
});
