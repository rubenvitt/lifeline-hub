import { expect, test, type Page, type Locator } from '@playwright/test';

// e2e-Smoke der Kommandopalette: echtes Hotkey-Verhalten, Navigation und die Koexistenz des
// Palette-Modals über einem offenen antd-Drawer — was jsdom nicht kann.

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

/** Hartes Navigieren zu einem Modul + warten, bis der Header gemountet ist — sonst kommt der
 *  Hotkey vor der Listener-Bindung des Providers. */
async function zumModul(page: Page, id: string, modul: string) {
  await page.goto(`/einsaetze/${id}/${modul}`);
  await expect(page.locator('header').first()).toBeVisible();
}

/** Das Suchfeld der Datensicht auf der Schadensliste — der verlässliche Weg, den Fokus IN die
 *  Werkzeugzeile zu setzen. */
function schadenSuche(page: Page): Locator {
  return page.getByPlaceholder('S-Nr., Ort, Beschreibung');
}

/**
 * Die Schadensliste als Prüffläche: dort stehen beide Ebenen zugleich — `EinsatzSeite` meldet
 * seitenweit „Neue Zeile", die Werkzeugzeile der `Datensicht` „Spalten". Gewartet wird auf das
 * Suchfeld: die Ebenen registrieren sich erst mit der gerenderten Liste.
 */
async function zurSchadensliste(page: Page, name: string): Promise<string> {
  await anmelden(page);
  const id = await einsatzAnlegen(page, name);
  await zumModul(page, id, 'schaeden');
  await expect(schadenSuche(page)).toBeVisible();
  return id;
}

/**
 * Steht der Fokus im SICHTBAREN Dropdown-Overlay? Gefragt am echten `document.activeElement`:
 * antds `autoFocus` darf den Menü-Container selbst fokussieren, den ein Nachfahren-Selektor
 * übersähe. `:not(.ant-dropdown-hidden)` ist Pflicht — antd lässt geschlossene Portale stehen.
 */
async function fokusImOffenenMenue(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const overlay = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden)');
    return (
      overlay != null && document.activeElement != null && overlay.contains(document.activeElement)
    );
  });
}

test('öffnet auf 390 px per sichtbarem Trigger, fokussiert die Palette und navigiert per Enter (AK1–AK3)', async ({
  page,
}) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Palette ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await zumModul(page, id, 'etb');

  const trigger = page.getByRole('button', { name: 'Suchen' });
  const kasten = (await trigger.boundingBox())!;
  expect(
    Math.min(kasten.width, kasten.height),
    'Trefffläche des Such-Triggers',
  ).toBeGreaterThanOrEqual(48);
  await trigger.click();
  await expect(paletteInput(page)).toBeFocused();

  await paletteInput(page).fill('lagekarte');
  await expect(page.getByRole('option', { name: /Lagekarte/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/lagekarte`));
  await expect(paletteInput(page)).toBeHidden();
});

test('öffnet global mit CMD+K und schließt mit ESC ohne Seiteneffekt (AK1, AK4)', async ({
  page,
}) => {
  await anmelden(page); // landet auf /einsaetze (kein Einsatz-Kontext)

  await page.keyboard.press('Meta+k');
  await expect(paletteInput(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();
  await expect(page).toHaveURL(/\/einsaetze$/);
});

test('legt sich über den mobilen Navigations-Drawer, ESC schließt nur die Palette, Drawer bleibt bedienbar (AK6)', async ({
  page,
}) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Drawer ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await zumModul(page, id, 'etb');

  // Den echten Navigations-Drawer aus EinsatzLayout öffnen.
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

test('Schnellaktion „Neue Person" navigiert und öffnet die Schnellerfassung (Schnellaktionen)', async ({
  page,
}) => {
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

test('Schnelleinstellung schaltet das Theme sichtbar um (Schnelleinstellungen)', async ({
  page,
}) => {
  await anmelden(page);

  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await paletteInput(page).fill('Dunkel');
  await page.getByRole('option', { name: /Dunkel/ }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

/*
 * ── Gruppe „Aktionen" ───────────────────────────────────────────────────────────────
 *
 * Geprüft wird, welche Ebenen der ECHTE Browser-Fokus in die Kette legt und wer das
 * Fokus-Rennen zwischen schließendem Palette-Modal und dem `autoFocus` des Spalten-Dropdowns
 * gewinnt. Die Beschriftungen stammen aus `TASTATUR_AKTIONEN` (gepinnt in `befehle.test.ts`).
 *
 * `exact: true` ist Pflicht: Playwright matcht `name` sonst als Teilstring, und die Gruppe
 * „Einsatz wechseln" führt den Einsatznamen als eigene Option.
 */
const AKTION = { exact: true } as const;

test('über den sichtbaren Trigger geöffnet, zeigt die Palette die Seitenaktion „Neue Zeile" (Aktionen)', async ({
  page,
}) => {
  await zurSchadensliste(page, `E2E Trigger ${Date.now()}`);

  // Der Klick nimmt den Fokus aus JEDER registrierten Wurzel; der Anzeige-Fallback sorgt
  // dafür, dass die Palette auf dem Berührungsweg trotzdem Aktionen zeigt.
  await page.getByRole('button', { name: 'Suchen' }).click();
  await expect(paletteInput(page)).toBeFocused();

  await expect(page.getByRole('option', { name: 'Neue Zeile', ...AKTION })).toBeVisible();

  // Gegenstück zum Fall darunter: der Fallback nimmt bewusst NUR die flachste Ebene
  // (`flachsteEbene`, Begründung dort) — Abwesenheit ist besser als Mehrdeutigkeit.
  await expect(page.getByRole('option', { name: 'Spalten', ...AKTION })).toHaveCount(0);
});

test('mit Fokus in der Werkzeugzeile stehen „Spalten" und „Neue Zeile" zusammen (Ebenen-Kette)', async ({
  page,
}) => {
  await zurSchadensliste(page, `E2E Kette ${Date.now()}`);

  // Fokus IN die Werkzeugzeile, danach per Tastenweg öffnen, damit die Kette erhalten bleibt.
  // „Spalten" kommt von der tiefen Werkzeugzeile, „Neue Zeile" von der Ebene darüber — dass
  // beide zugleich stehen, IST die Ketten-Aussage.
  await schadenSuche(page).click();
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();

  await expect(page.getByRole('option', { name: 'Spalten', ...AKTION })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Neue Zeile', ...AKTION })).toBeVisible();
});

test('„Spalten" öffnet die Spaltenwahl UND legt den Fokus hinein (Fokus-Rennen)', async ({
  page,
}) => {
  await zurSchadensliste(page, `E2E Fokus ${Date.now()}`);

  await schadenSuche(page).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('option', { name: 'Spalten', ...AKTION }).click();
  await expect(paletteInput(page)).toBeHidden();

  // Das SICHTBARE Overlay: antd lässt die Portale geschlossener Dropdowns im Baum stehen.
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  await expect(menue).toBeVisible();
  await expect(menue.getByRole('checkbox', { name: 'Typ' })).toBeVisible();

  // `CommandPalette.fuehreAus` ruft `schliesse()` VOR `ausfuehren()`: das Modal gibt den Fokus
  // ans Suchfeld zurück, während das Dropdown ihn per `autoFocus` zieht. Ohne Fokus im Menü
  // wäre der Befehl nur mit der Maus zu Ende bedienbar.
  await expect
    .poll(() => fokusImOffenenMenue(page), { message: 'Fokus steht im geöffneten Spalten-Menü' })
    .toBe(true);
});

/**
 * „Status setzen“ wirkt auf die FOKUSZEILE (LFH-507): die Ebene hängt am Primitiv `StatusWahl`,
 * ihre Wurzel ist die umgebende Tabellenzeile. Zwei Fahrzeuge, damit „genau diese Zeile“
 * widerlegbar ist; welche Zeile das Menü trägt, zeigt die Wahl darin.
 */
test('„Status setzen“ öffnet das Statusmenü der Fokuszeile UND legt den Fokus hinein (LFH-507)', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Status setzen ${Date.now()}`);
  const basis = `/api/einsaetze/${einsatzId}`;
  const katalogAntwort = await page.request.get('/api/fahrzeug-status');
  expect(katalogAntwort.ok(), await katalogAntwort.text()).toBeTruthy();
  const katalog = (await katalogAntwort.json()) as { id: number; label: string }[];
  const [start, ziel] = katalog;
  expect(ziel, 'Katalog mit mindestens zwei Status').toBeDefined();
  for (const funkrufname of ['Florian Palette 1', 'Florian Palette 2']) {
    const r = await page.request.post(`${basis}/fahrzeuge`, { data: { adhoc: { funkrufname } } });
    expect(r.ok(), await r.text()).toBeTruthy();
    const { id } = (await r.json()) as { id: number };
    const s = await page.request.patch(`${basis}/fahrzeuge/${id}`, {
      data: { status_id: start.id },
    });
    expect(s.ok(), await s.text()).toBeTruthy();
  }

  await zumModul(page, einsatzId, 'fahrzeuge');
  const ausloeser = (n: number) =>
    page.getByRole('button', { name: `Status von Florian Palette ${n} ändern` });
  await expect(ausloeser(2)).toBeVisible();

  // Gegenprobe ZUERST: über den „Suchen“-Knopf liegt der Fokus in keiner Zeile, die Aktion fehlt,
  // obwohl die Seite Zeilen mit Statuswechsel zeigt.
  await page.getByRole('button', { name: 'Suchen' }).click();
  await expect(paletteInput(page)).toBeFocused();
  await expect(page.getByRole('option', { name: 'Neue Zeile', ...AKTION })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Status setzen', ...AKTION })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();

  // Fokus in die Zeile von „Florian Palette 2“ (fokussiert, nicht geklickt: der Klick öffnete das
  // Menü schon selbst), dann per Tastenweg öffnen, damit die Kette erhalten bleibt.
  await ausloeser(2).focus();
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await page.getByRole('option', { name: 'Status setzen', ...AKTION }).click();
  await expect(paletteInput(page)).toBeHidden();

  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  await expect(menue).toHaveCount(1);
  await expect(menue).toBeVisible();
  // Dasselbe Fokus-Rennen wie bei „Spalten“: das schließende Modal gegen das `autoFocus` des Menüs.
  await expect
    .poll(() => fokusImOffenenMenue(page), { message: 'Fokus steht im geöffneten Statusmenü' })
    .toBe(true);

  await menue.getByRole('menuitem', { name: ziel.label, exact: true }).click();
  await expect(ausloeser(2)).toContainText(ziel.label);
  await expect(ausloeser(1)).toContainText(start.label);
});
