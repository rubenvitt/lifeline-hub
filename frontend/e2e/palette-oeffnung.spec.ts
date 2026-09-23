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
 * „Zurück" in der Vorschau ist ein antd-`Button` und soll seine Höhe vom `ConfigProvider`
 * erben. Das ist eine ANNAHME, bis sie gemessen ist (LFH-396: ein Inline-`<a>` erbte gemessen
 * 17 px in jeder Stufe) — deshalb die Messung über alle drei Stufen. Er ist neben Esc/← der
 * einzige Weg zurück, und für Maus und Finger der einzige sichtbare. (Den Weg HINEIN gibt es
 * auf Touch noch nicht — LFH-665.)
 */
test('„Zurück" in der Vorschau hält den Dichte-Boden in allen drei Stufen', async ({ page }) => {
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
    await expect(personOption(page, kennung)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
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
