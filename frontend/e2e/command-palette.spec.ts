import { expect, test, type Page, type Locator } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';
import { haeltStufe, ruhigeHoehe, SUBPIXEL } from './trefflaeche-kern';
import { einsatzAnlegen } from './einsatz-kern';

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
  // Exakt: am Ende steht auch „Adresse auf Lagekarte suchen · „lagekarte““ (LFH-638).
  await expect(page.getByRole('option', { name: 'Lagekarte', exact: true })).toHaveAttribute(
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
  // Die Tab-Kette erst prüfen, wenn das Einblenden durch ist (LFH-1055). Die Fokusfalle der
  // Palette greift erst einige Effekte nach dem Autofokus; bis dahin hält die Falle des Drawers,
  // holt den Fokus kurz zu sich (Feld → Drawer-Schließen → Feld), und am Ende der Animation setzt
  // der Dialog ihn ggf. auf seinen Rahmen. Ein Tab in diesem Fenster landete unter Last im
  // Drawer und kam nie in der Liste an.
  await expect(page.locator('.ant-modal').filter({ has: palette })).not.toHaveClass(
    /ant-zoom-(appear|enter)/,
  );
  await expect(palette).toBeFocused();
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

test('Schnellaktion „Person erfassen" navigiert und öffnet „Betroffene erfassen“ (Schnellaktionen)', async ({
  page,
}) => {
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Aktion ${Date.now()}`);
  await zumModul(page, id, 'etb');

  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  // Die frühere Beschriftung bleibt Schlagwort (LFH-1055).
  await paletteInput(page).fill('Neue Person');
  // Verankert: am Ende steht auch „Adresse auf Lagekarte suchen · „Neue Person““ (LFH-638).
  await page.getByRole('option', { name: /^Person erfassen/ }).click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/personen`));
  await expect(page.getByRole('dialog', { name: 'Betroffene erfassen' })).toBeVisible();
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

/** Nachbildung von `fmsEtikett` (`src/kraefte/meldebildRaster.ts`): „S2 · Frei auf Wache“. */
function fmsEtikett(label: string, anker: number | null): string {
  if (anker == null) return label;
  const m = /^\s*(\d+)\s*[–-]\s*(.+)$/.exec(label);
  return `S${anker} · ${m && Number(m[1]) === anker ? m[2] : label}`;
}

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
  const katalog = (await katalogAntwort.json()) as {
    id: number;
    label: string;
    fms_anker: number | null;
  }[];
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
  // Positivhälfte: der Anzeige-Fallback greift (die Werkzeugzeile der Datensicht meldet „Spalten“).
  await expect(page.getByRole('option', { name: 'Spalten', ...AKTION })).toBeVisible();
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

  // Menüpunkt und Auslöser tragen das FMS-Format „S2 · Frei auf Wache“ (LFH-973).
  await menue
    .getByRole('menuitem', { name: fmsEtikett(ziel.label, ziel.fms_anker), exact: true })
    .click();
  await expect(ausloeser(2)).toContainText(fmsEtikett(ziel.label, ziel.fms_anker));
  await expect(ausloeser(1)).toContainText(fmsEtikett(start.label, start.fms_anker));
});

/*
 * ── Suchfeld und Fußzeile (LFH-1055) ────────────────────────────────────────────────
 *
 * Was jsdom nicht kann: Chromium schickt nach Layoutwechseln Mausereignisse an einen RUHENDEN
 * Zeiger, und die Bearbeitungstasten wirken nur im echten Feld. Die Fußzeilenhöhe hängt an
 * Schrift und Breite.
 */
async function oeffnePalette(page: Page) {
  await expect(async () => {
    if (!(await paletteInput(page).isVisible())) await page.keyboard.press('Control+k');
    await expect(paletteInput(page)).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

function feldZustand(page: Page) {
  return paletteInput(page).evaluate((el: HTMLInputElement) => ({
    wert: el.value,
    start: el.selectionStart,
    ende: el.selectionEnd,
    fokus: document.activeElement === el,
  }));
}

test('ein ruhender Zeiger über der Liste stiehlt die Markierung nicht (LFH-1055)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmelden(page);
  const id = await einsatzAnlegen(page, `E2E Zeiger ${Date.now()}`);
  await zumModul(page, id, 'etb');
  await oeffnePalette(page);

  // Der Zeiger steht mitten über der Liste, wie nach einem Klick; danach bewegt er sich nicht.
  const liste = (await page.getByRole('listbox').boundingBox())!;
  await page.mouse.move(liste.x + liste.width / 2, liste.y + liste.height / 2);
  await paletteInput(page).pressSequentially('hell', { delay: 40 });

  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
});

test('Strg+Rücktaste löscht ein Wort, Strg/⌘+A markiert den Begriff (LFH-1055)', async ({
  page,
}) => {
  await anmelden(page);
  await oeffnePalette(page);

  await paletteInput(page).fill('einsatz tage');
  await paletteInput(page).press('Control+Backspace');
  expect(await feldZustand(page)).toMatchObject({ wert: 'einsatz ', fokus: true });
  await expect(paletteInput(page)).toBeVisible();

  await paletteInput(page).fill('einsatz tage');
  await paletteInput(page).press('ControlOrMeta+a');
  expect(await feldZustand(page)).toEqual({
    wert: 'einsatz tage',
    start: 0,
    ende: 12,
    fokus: true,
  });
});

test('die Fußzeile bleibt bei 1440 px in jeder Dichte einzeilig (LFH-1055)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmelden(page);
  for (const [label, stufe] of [
    ['Dichte: Kompakt', 'kompakt'],
    ['Dichte: Komfortabel', 'komfortabel'],
    ['Dichte: Handschuh', 'handschuh'],
  ] as const) {
    await oeffnePalette(page);
    await paletteInput(page).fill(label);
    await page.getByRole('option', { name: label }).click();
    // Erst ganz schließen lassen: sonst fände `oeffnePalette` noch das ausblendende Feld und tippte hinein.
    await expect(paletteInput(page)).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', stufe);

    await oeffnePalette(page);
    const fuss = page.locator('[data-lfh="palette-fuss"]');
    // Eine Zeile Tastenmarken (16 px) plus 2 × 6 px Polsterung und Rand; zwei Zeilen lägen über 50.
    expect((await fuss.boundingBox())!.height, stufe).toBeLessThanOrEqual(36);
    await page.keyboard.press('Escape');
    await expect(paletteInput(page)).toBeHidden();
  }
});

/**
 * Die Palette bei grobem Zeiger (LFH-982): `hasTouch` meldet `(pointer: coarse)`, ohne gespeicherte
 * Wahl startet die Dichte `komfortabel` (48). Geöffnet wird wie auf dem Gerät über die Lupe.
 *
 * Gemessen als Admin UND als Beobachter (LFH-435): der Palette-Inhalt hängt an der Rolle. Der
 * Rollenzweig ist Vorbedingung: unter dem Chip „Aktionen“ steht „ETB-Eintrag schreiben“ nur mit
 * Schreibrecht.
 */
for (const viewport of [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
]) {
  test.describe(`Berührung ${viewport.width} px (LFH-982)`, () => {
    test.use({ hasTouch: true, viewport });

    for (const rolle of ['admin', 'beobachter'] as const) {
      test(`${rolle}: Schließknopf, Chips, keine Tastenhinweise`, async ({ page }) => {
        await anmelden(page);
        const id = await einsatzAnlegen(page, `E2E Palette Touch ${rolle} ${Date.now()}`);
        if (rolle === 'beobachter') await wechsleZuRolle(page, 'beobachter', id);
        await zumModul(page, id, 'etb');
        await expect(page.locator('html')).toHaveAttribute('data-dichte', 'komfortabel');

        await page.getByRole('button', { name: 'Suchen', exact: true }).tap();
        await expect(paletteInput(page)).toBeVisible();
        const modal = page.locator('.ant-modal');
        const zu = page.getByRole('button', { name: 'Sprungpalette schließen' });
        // Erst messen, wenn antds Einblend-Zoom steht: mitten im `scale` misst alles zu klein.
        await ruhigeHoehe(zu, 'Schließknopf');

        // Keine Tastenmarke, weder im Kopf noch in Fußzeile oder Zeilen.
        await expect(modal.locator('kbd')).toHaveCount(0);

        // Fußzeile: EINE Reihe Chips mit 48er-Boden plus Polsterung; zwei Reihen lägen über 100 px.
        const fuss = page.locator('[data-lfh="palette-fuss"]');
        const fussHoehe = (await fuss.boundingBox())!.height;
        expect(fussHoehe, 'Höhe der Fußzeile').toBeLessThanOrEqual(70);
        const ueberlauf = await fuss.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(ueberlauf, 'Chips passen ohne Scrollen').toBeLessThanOrEqual(0);

        // Rollenzweig als Vorbedingung, zugleich der Chip im echten Browser.
        const aktionen = fuss.getByRole('button', { name: 'Aktionen', exact: true });
        await haeltStufe(aktionen, 48, 'Chip „Aktionen“');
        await aktionen.tap();
        await expect(paletteInput(page)).toHaveValue('>');
        await expect(paletteInput(page)).toBeFocused();
        await expect(aktionen).toHaveAttribute('aria-pressed', 'true');
        const schreiben = page.getByRole('option', { name: /ETB-Eintrag schreiben/ });
        if (rolle === 'admin') await expect(schreiben).toBeVisible();
        else await expect(schreiben).toHaveCount(0);
        await fuss.getByRole('button', { name: 'Personen & Kräfte', exact: true }).tap();
        await expect(paletteInput(page)).toHaveValue('@');

        // Der Schließknopf: Boden 48 in beiden Achsen, ganz im Bild, und ein Tipp schließt.
        await expect(zu).toBeInViewport({ ratio: 1 });
        const box = (await zu.boundingBox())!;
        expect(box.width, 'Breite des Schließknopfs').toBeGreaterThanOrEqual(48 - SUBPIXEL);
        expect(box.height, 'Höhe des Schließknopfs').toBeGreaterThanOrEqual(48 - SUBPIXEL);
        const vorher = page.url();
        await zu.tap();
        await expect(paletteInput(page)).toBeHidden();
        expect(page.url()).toBe(vorher);
      });
    }
  });
}
