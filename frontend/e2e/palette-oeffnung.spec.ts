import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Öffnungswege der Sprungpalette im ECHTEN Browser (LFH-645, Raycast-Muster).
 *
 * WARUM NICHT NUR VITEST: dort ist `window.open` ein Spy — belegt ist, DASS der Aufruf
 * geschieht, nicht, dass im neuen Tab etwas Brauchbares ankommt. Ein neuer Tab ist immer ein
 * KALTSTART: kein warmer Query-Cache, kein Router-Zustand, nur Cookie und URL. Genau dort ist
 * ein Deeplink schon einmal still gescheitert (Review zu LFH-340, `?platzieren=`). Gemessen
 * wird deshalb im neuen Tab am ZIEL — Überschrift der Personenseite, Pfad der Lagekarte —
 * und im alten Tab daran, dass er stehen blieb.
 *
 * Die Vorschau wird hier ebenfalls gefahren, weil jsdom den zweiten Weg nicht sieht: der
 * globale Dispatcher läuft auf `window`, und ob der Palette-Handler im Portal VOR ihm
 * `preventDefault` setzt, ist eine Frage der echten Ereignisreihenfolge.
 *
 * SEEDING über die Oberfläche (Schnellerfassung) wie in `palette-datensaetze.spec.ts` — die
 * Kennung kommt aus der Quittung. KEIN `networkidle`: auf Einsatzrouten bleibt ein SSE-Strom
 * offen (LFH-385).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.setTimeout(120_000);

function paletteInput(page: Page): Locator {
  return page.getByPlaceholder(/Suchen: Module/);
}

// Login-/Anlege-Helfer wie in `palette-datensaetze.spec.ts` — es gibt kein geteiltes Modul.
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
  return page.getByRole('option', { name: new RegExp(kennung) });
}

/** Das Tippziel „Vorschau" rechts in einer Zeile (LFH-665). */
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
 * Eine FESTE Navigationszeile (Modul) — sie kommt aus `useBefehle`, nicht aus dem
 * Datensatz-Finder. Genau dieser Weg verwarf die Öffnungsart (Review-Befund): der Hook hatte
 * ein eigenes `navigate` und reichte nur den Pfad weiter. Strg/⌘+KLICK zugleich, damit auch
 * der Mausweg im Browser belegt ist.
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
  // Im BLICK, nicht nur markiert: die Liste kommt mit `scrollTop` 0 zurück (Review-Befund).
  // `toBeVisible` hielte auch eine Zeile unterhalb des sichtbaren Bereichs für sichtbar.
  await expect(personOption(page, kennung)).toBeInViewport();

  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb`));
});

/** Schlüssel der gespeicherten Dichtewahl (`e2e/dichte.spec.ts`). */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/**
 * Böden der Dichte-Staffel als LITERALE (CLAUDE.md, Gate 3): aus dem Token zurückgelesen
 * prüfte die Messung den Token gegen sich selbst.
 */
const BODEN = { kompakt: 30, komfortabel: 48, handschuh: 72 } as const;

/**
 * Beide sichtbaren Wege der Vorschau, gemessen über alle drei Stufen:
 *
 * HINEIN das Tippziel (LFH-665), ein handgebautes Bedienziel mit `vorschauZielStil`. Gemessen
 * werden Höhe UND Breite gegen den Boden und seine Lage in der Zeile: es endet bündig an deren
 * rechter Kante und füllt ihre volle Höhe — daneben bleibt kein Streifen, der zur Zeile
 * gehörte und dort den Datensatz öffnete. Geöffnet wird die Vorschau hier per KLICK auf das
 * Ziel, nicht per →: der Tastaturweg steht im Test darüber.
 *
 * ZURÜCK „Zurück", ein antd-`Button`, der seine Höhe vom `ConfigProvider` erben soll. Das ist
 * eine ANNAHME, bis sie gemessen ist (LFH-396: ein Inline-`<a>` erbte gemessen 17 px in jeder
 * Stufe). Er ist neben Esc/← der einzige Weg zurück, und für Maus und Finger der einzige
 * sichtbare.
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
 * Das Akzeptanzkriterium aus LFH-665 als echter TIPP auf dem Führungs-Tablet (1024 × 768,
 * `hasTouch`, Stufe Handschuh): ein Tipp aufs Ziel öffnet die Vorschau und lässt die Seite
 * stehen, ein Tipp auf die übrige Zeile öffnet die Person wie bisher. Erst der Tipp belegt die
 * Treffertrennung — `toBeVisible()` ist kein Beleg für Bedienbarkeit (LFH-355).
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
 * Der engste Fall (LFH-665, Review-Befund): Handschirm 390 px in der Stufe Handschuh. Das Ziel
 * belegt dort 72 px, daneben stehen Kontext (`nowrap`), ↵-Marke und Abstände. Das Label darf
 * umbrechen (`minWidth: 0`), die Zeile aber nicht über ihre Box hinausragen, und das Ziel muss
 * ganz im Blick und tippbar bleiben. `gate1-ueberlauf.spec.ts` fährt keine Palette mit einer
 * Vorschau-Zeile, deshalb steht die Messung hier.
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
 * Vorschauen der übrigen Datensatzsorten (LFH-664). Geseedet wird hier über die API, nicht
 * über die Oberfläche: eine Meldung mit erteiltem Auftrag entstünde sonst erst nach zwei
 * Formularen, und keins davon ist Gegenstand dieses Tests.
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

  // Geklickt, nicht nur `toBeVisible` — nur der Klick belegt, dass der Weg trägt (CLAUDE.md).
  await vorschau.getByRole('link', { name: /Auftrag/ }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/auftraege\\?auftrag=\\d+`));
  await expect(paletteInput(page)).toBeHidden();
});

/**
 * Über die VOLLTEXTSUCHE gefunden, nicht über die Nummer: `#1` hätte hinter dem Präfix nur ein
 * Zeichen und läge unter `DATENSATZ_MINDESTZEICHEN`. Der Volltextweg ist zugleich der
 * strengere — die Vorschau liest den Eintrag dann KALT über den Nummerncursor nach und prüft
 * die `id` (Design, Entscheidung 2).
 */
test('→ zeigt einen ETB-Eintrag aus der Volltextsuche', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Vorschau ETB ${Date.now()}`);
  await apiPost(page, `/api/einsaetze/${einsatzId}/etb`, {
    typ: 'lage',
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
