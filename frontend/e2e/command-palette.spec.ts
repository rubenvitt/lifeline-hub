import { expect, test, type Page, type Locator } from '@playwright/test';

// e2e-Smoke der CMD+K-Command-Palette (LFH-11). Deckt das ab, was jsdom nicht kann:
// echtes Hotkey-Verhalten, Navigation, und vor allem die Koexistenz des Palette-Modals
// über einem offenen antd-Drawer (AK6 — nur im echten Browser-Layout prüfbar).
// Harness: Backend und Vite startet playwright.config.ts selbst (LFH-309), Login
// admin / e2e-admin-pw gegen eine Temp-DB je Lauf.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const SCHMAL = { width: 390, height: 844 };

/** Eindeutiges Palette-Signal: das Suchfeld (Placeholder ist projektweit einmalig). */
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

/** Hartes Navigieren zu einem Modul + warten bis die App (EinsatzLayout-Header)
 *  gemountet ist — sonst kommt der Hotkey vor der Provider-Listener-Bindung. */
async function zumModul(page: Page, id: string, modul: string) {
  await page.goto(`/einsaetze/${id}/${modul}`);
  await expect(page.locator('header').first()).toBeVisible();
}

/** Das Suchfeld der Datensicht auf der Schadensliste — zugleich der einzige Weg, den
 *  Fokus verlässlich IN die Werkzeugzeile zu setzen (LFH-391 · B6). */
function schadenSuche(page: Page): Locator {
  return page.getByPlaceholder('S-Nr., Ort, Beschreibung');
}

/**
 * Die Schadensliste als Prüffläche: sie ist die einzige Konstellation, in der beide neuen
 * Ebenen gleichzeitig stehen — `EinsatzSeite` meldet seitenweit „Neue Zeile", die
 * Werkzeugzeile der `Datensicht` darunter „Spalten". Gewartet wird auf das Suchfeld, nicht
 * auf den Kopf: die Ebenen registrieren sich erst, wenn die Liste wirklich gerendert ist.
 */
async function zurSchadensliste(page: Page, name: string): Promise<string> {
  await anmelden(page);
  const id = await einsatzAnlegen(page, name);
  await zumModul(page, id, 'schaeden');
  await expect(schadenSuche(page)).toBeVisible();
  return id;
}

/**
 * Steht der Fokus im SICHTBAREN Dropdown-Overlay?
 *
 * Gefragt wird am echten `document.activeElement` statt über einen `:focus`-Nachfahren:
 * antds `autoFocus` darf den Fokus auch auf den Menü-Container selbst legen, und ein
 * Nachfahren-Selektor übersähe genau diesen Fall. Das `:not(.ant-dropdown-hidden)` ist
 * Pflicht — antd lässt die Portale geschlossener Dropdowns im Baum stehen (LFH-366).
 */
async function fokusImOffenenMenue(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const overlay = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden)');
    return overlay != null && document.activeElement != null && overlay.contains(document.activeElement);
  });
}

test('öffnet auf 390 px per sichtbarem Trigger, fokussiert die Palette und navigiert per Enter (AK1–AK3)', async ({ page }) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Palette ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await zumModul(page, id, 'etb');

  const trigger = page.getByRole('button', { name: 'Suchen' });
  const kasten = (await trigger.boundingBox())!;
  expect(Math.min(kasten.width, kasten.height), 'Trefffläche des Such-Triggers').toBeGreaterThanOrEqual(48);
  await trigger.click();
  await expect(paletteInput(page)).toBeFocused();

  await paletteInput(page).fill('lagekarte');
  await expect(page.getByRole('option', { name: /Lagekarte/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/lagekarte`));
  await expect(paletteInput(page)).toBeHidden();
});

test('öffnet global mit CMD+K und schließt mit ESC ohne Seiteneffekt (AK1, AK4)', async ({ page }) => {
  await anmelden(page); // landet auf /einsaetze (kein Einsatz-Kontext)

  await page.keyboard.press('Meta+k');
  await expect(paletteInput(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();
  await expect(page).toHaveURL(/\/einsaetze$/);
});

test('legt sich über den mobilen Navigations-Drawer, ESC schließt nur die Palette, Drawer bleibt bedienbar (AK6)', async ({ page }) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Drawer ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await zumModul(page, id, 'etb');

  // Den echten Navigations-Drawer aus EinsatzLayout öffnen. Ein fachlicher
  // Anlegen-Drawer belegt den mobilen Navigationsvertrag nicht.
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  const navDrawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(navDrawer).toBeVisible();
  await expect(navDrawer.getByRole('navigation')).toBeVisible();

  // Palette ÜBER dem Drawer öffnen — beide Overlays gleichzeitig sichtbar
  await page.keyboard.press('Control+k');
  const palette = paletteInput(page);
  const paletteDialog = page.getByRole('dialog').filter({ has: palette });
  await expect(palette).toBeVisible();
  await expect(navDrawer).toBeVisible();

  // Der Fokus bleibt sichtbar innerhalb der obersten Palette und läuft nicht
  // in den darunterliegenden Drawer.
  await expect(palette).toBeFocused();
  await expect(page.locator(':focus-visible')).toHaveAttribute('placeholder', /Suchen: Module/);
  await page.keyboard.press('Tab');
  await expect(palette).not.toBeFocused();
  await expect(paletteDialog.locator(':focus-visible')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(palette).toBeFocused();
  await expect(page.locator(':focus-visible')).toHaveAttribute('placeholder', /Suchen: Module/);

  // ESC schließt NUR die Palette, der Drawer bleibt offen …
  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();
  await expect(navDrawer).toBeVisible();

  // … und bleibt bedienbar: die echte Modulnavigation reagiert weiter.
  await navDrawer.getByRole('button', { name: 'Lage' }).click();
  await navDrawer.getByRole('button', { name: 'Lagekarte' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/lagekarte`));
});

test('Schnellaktion „Neue Person" navigiert und öffnet die Schnellerfassung (Schnellaktionen)', async ({ page }) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Aktion ${Date.now()}`);
  await zumModul(page, id, 'etb');

  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await paletteInput(page).fill('Neue Person');
  await page.getByRole('option', { name: /Neue Person/ }).click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/personen`));
  await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
});

test('Schnelleinstellung schaltet das Theme sichtbar um (Schnelleinstellungen)', async ({ page }) => {
  await anmelden(page);

  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await paletteInput(page).fill('Dunkel');
  await page.getByRole('option', { name: /Dunkel/ }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

/*
 * ── Gruppe „Aktionen" (LFH-391 · B6) ────────────────────────────────────────────────
 *
 * Die drei Fälle darunter prüfen genau das, was jsdom nicht beantworten kann: welche
 * Ebenen der ECHTE Browser-Fokus in die Kette legt, und wer das Fokus-Rennen zwischen dem
 * schließenden Palette-Modal und dem `autoFocus` des Spalten-Dropdowns gewinnt.
 *
 * Prüffläche ist die Schadensliste, weil dort beide neuen Ebenen übereinanderliegen:
 * `EinsatzSeite` meldet seitenweit „Neue Zeile" (`neueZeile`-Prop), die Werkzeugzeile der
 * `Datensicht` darunter „Spalten". Die Beschriftungen stammen aus `TASTATUR_AKTIONEN` und
 * sind in `befehle.test.ts` gepinnt — hier ist der Wortlaut der sichtbare Bedienweg.
 *
 * `exact: true` ist an jedem dieser Locator Pflicht und gemessen: Playwright matcht
 * `name` sonst als TEILSTRING, und die Gruppe „Einsatz wechseln" führt den Namen des
 * Einsatzes als eigene Option. Ein Fixture „E2E Aktionen Spalten …" ließ
 * `getByRole('option', { name: 'Spalten' })` auf zwei Knoten laufen — und die
 * Abwesenheitsaussage unten wäre umgekehrt allein vom Fixturenamen abhängig gewesen.
 */
const AKTION = { exact: true } as const;

test('über den sichtbaren Trigger geöffnet, zeigt die Palette die Seitenaktion „Neue Zeile" (Aktionen)', async ({ page }) => {
  await zurSchadensliste(page, `E2E Trigger ${Date.now()}`);

  // Der Klick nimmt den Fokus aus JEDER registrierten Wurzel — genau das war vor dem
  // Anzeige-Fallback der gemessene Befund (per Hotkey eine Aktion, per Trigger keine). Die
  // Palette blieb damit auf dem Berührungsweg leer, für den der Trigger gebaut wurde.
  await page.getByRole('button', { name: 'Suchen' }).click();
  await expect(paletteInput(page)).toBeFocused();

  await expect(page.getByRole('option', { name: 'Neue Zeile', ...AKTION })).toBeVisible();

  // Gegenstück zum Fall darunter, keine eigenständige Behauptung: der Fallback nimmt
  // bewusst NUR die flachste Ebene (`flachsteEbene`), nicht alle der Seite. Stünden
  // mehrere gleichrangige Kandidaten zugleich in der Liste, trüge sie dieselbe
  // Beschriftung mehrfach, ohne dass die Zeile sagt, welche Fläche sie meint —
  // Abwesenheit ist an dieser Stelle besser als Mehrdeutigkeit. Die Begründung steht
  // ausführlich am Doc-Block von `flachsteEbene`; wer sie ändert, ändert sie dort.
  await expect(page.getByRole('option', { name: 'Spalten', ...AKTION })).toHaveCount(0);
});

test('mit Fokus in der Werkzeugzeile stehen „Spalten" und „Neue Zeile" zusammen (Ebenen-Kette)', async ({ page }) => {
  await zurSchadensliste(page, `E2E Kette ${Date.now()}`);

  // Fokus IN die Werkzeugzeile, danach per Tastenweg öffnen: nur so bleibt die Kette
  // erhalten, und nur dann trägt die Aussage. Die zwei Optionen stammen aus ZWEI
  // verschiedenen Ebenen — „Spalten" von der tiefen Werkzeugzeile, „Neue Zeile" von der
  // seitenweiten Ebene darüber. Mit der früheren Auswahl „genau eine Ebene" verdeckte die
  // tiefere die flachere vollständig; dass beide zugleich stehen, IST die Ketten-Aussage.
  await schadenSuche(page).click();
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();

  await expect(page.getByRole('option', { name: 'Spalten', ...AKTION })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Neue Zeile', ...AKTION })).toBeVisible();
});

test('„Spalten" öffnet die Spaltenwahl UND legt den Fokus hinein (Fokus-Rennen)', async ({ page }) => {
  await zurSchadensliste(page, `E2E Fokus ${Date.now()}`);

  await schadenSuche(page).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('option', { name: 'Spalten', ...AKTION }).click();
  await expect(paletteInput(page)).toBeHidden();

  // Das SICHTBARE Overlay, nicht irgendeines: antd lässt die Portale geschlossener
  // Dropdowns im Baum stehen (LFH-366).
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  await expect(menue).toBeVisible();
  await expect(menue.getByRole('checkbox', { name: 'Typ' })).toBeVisible();

  // Die zweite Hälfte und der eigentliche Grund für diesen Fall: `CommandPalette.fuehreAus`
  // ruft `schliesse()` VOR `ausfuehren()`. Das Modal gibt den Fokus an das zuvor
  // fokussierte Suchfeld zurück, während das Dropdown ihn per `autoFocus` zieht — wer
  // gewinnt, rechnet jsdom nicht. Ohne Fokus im Menü heben die Pfeiltasten keinen Eintrag
  // hervor, und der Befehl wäre nur mit der Maus zu Ende bedienbar.
  await expect
    .poll(() => fokusImOffenenMenue(page), { message: 'Fokus steht im geöffneten Spalten-Menü' })
    .toBe(true);
});
