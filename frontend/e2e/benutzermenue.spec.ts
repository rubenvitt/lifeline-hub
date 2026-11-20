import { expect, test, type Locator, type Page } from '@playwright/test';
import { einsatzAnlegen, einsatzPerApi } from './einsatz-kern';
import { offenesMenue, oeffneAbmeldenRueckfrage, oeffneMenue } from './menue-kern';
import {
  anmeldenAlsAdmin,
  benachrichtigungenQuittieren,
  benutzerAnlegen,
  mitgliedEintragen,
  wechsleZu,
  wechsleZuRolle,
} from './rollen-kern';

/**
 * Das entschlackte Benutzermenü (LLH-1642, Spec `benutzermenue`): Platz am Handy, Tastatur in der
 * Gruppe „Anzeige“ im echten Browser und der zweite Weg zu den Benachrichtigungen aus den
 * Eingängen. Die Reihenfolge und die Leisten selbst prüft `BenutzerMenu.test.tsx`; hier, was
 * jsdom nicht rechnet: Lage im Fenster, `rc-menu`/`rc-dropdown` mit echten Tasten.
 *
 * LLH-1730: „Abmelden“ steht zuletzt und fragt zurück (Fokus nach der Einblendung auf
 * „Abbrechen“, jsdom rechnet die Animation nicht); die Leisten stehen auch im Reiter „Anzeige“ der
 * Einsatz-Einstellungen.
 */

const HANDY = { width: 390, height: 844 };

async function dichte(page: Page, wert: 'kompakt' | 'komfortabel' | 'handschuh') {
  await page.addInitScript((w) => localStorage.setItem('lifeline-hub.dichte', w), wert);
}

function ausloeser(page: Page) {
  return page.getByRole('button', { name: 'Benutzermenü' });
}

/**
 * Der Kopf hängt an der Rolle (Tag „Admin“, „Führungskraft“ oder keiner). Gemessen wird jeder
 * Zweig (LFH-435, `e2e/AGENTS.md`): Admin, Org-Führungskraft mit dem längsten Tag (im
 * Handschuh-Betrieb neben dem Namen) und Beobachter ohne Tag. Den Wechsel sät der Admin; der
 * Beobachter braucht dafür einen Einsatz.
 */
const NUTZER = ['admin', 'fuehrungskraft', 'beobachter'] as const;
type Nutzer = (typeof NUTZER)[number];

const ROLLEN_TAGS: Record<Nutzer, string[]> = {
  admin: ['System-Admin'],
  fuehrungskraft: ['Führungskraft der Organisation'],
  beobachter: [],
};

async function anmelden(page: Page, nutzer: Nutzer): Promise<string> {
  await anmeldenAlsAdmin(page);
  if (nutzer === 'admin') return 'admin';
  const einsatzId =
    nutzer === 'beobachter'
      ? await einsatzAnlegen(page, `Benutzermenü Beobachter ${Date.now()}`)
      : undefined;
  const konto = await wechsleZuRolle(page, nutzer, einsatzId);
  return konto.benutzername;
}

/** Vorbedingung vor der Messung: der Kopf zeigt die Person und genau ihren Rollenzweig. */
async function pruefeKopf(menue: Locator, nutzer: Nutzer, benutzername: string) {
  await expect(menue.getByText(new RegExp(`@${benutzername}\\b`))).toBeVisible();
  for (const tag of ['System-Admin', 'Führungskraft der Organisation']) {
    const element = menue.getByText(tag, { exact: true });
    if (ROLLEN_TAGS[nutzer].includes(tag)) await expect(element).toBeVisible();
    else await expect(element).toHaveCount(0);
  }
}

for (const nutzer of NUTZER) {
  test(`Handy, komfortabel, ${nutzer}: das ganze Menü liegt im Fenster`, async ({ page }) => {
    await dichte(page, 'komfortabel');
    const benutzername = await anmelden(page, nutzer);
    await page.setViewportSize(HANDY);
    await page.goto('/einsaetze');
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'komfortabel');

    const menue = await oeffneMenue(page, ausloeser(page));
    await pruefeKopf(menue, nutzer, benutzername);
    const gerollt = await menue.evaluate((m) => m.scrollTop);
    expect(gerollt, 'Vorbedingung: das Menü steht am Anfang').toBe(0);
    // „Hilfe zu dieser Seite“ steht am Handy im Menü, weil der Kopf für „?“ keinen Platz hat
    // (LLH-1824), und ersetzt dort „Hilfe“ (Entscheidung 20.11.2026): beide zusammen schoben
    // „Abmelden“ unter den Rand.
    for (const name of ['Profil', 'Benachrichtigungen', 'Neuigkeiten', 'Hilfe zu dieser Seite']) {
      await expect(menue.getByRole('menuitem', { name })).toBeInViewport({ ratio: 1 });
    }
    await expect(menue.getByRole('menuitem', { name: 'Hilfe', exact: true })).toHaveCount(0);
    await expect(menue.getByRole('menuitem', { name: 'Abmelden' })).toBeInViewport({ ratio: 1 });
    for (const leiste of ['Darstellung', 'Bediendichte', 'Helligkeit in %']) {
      await expect(menue.getByRole('radiogroup', { name: leiste })).toBeInViewport({ ratio: 1 });
    }
    // Bedienbar, nicht nur sichtbar (`e2e/AGENTS.md`): „Hilfe zu dieser Seite“ öffnet die
    // Hilfe-Seitenleiste (ein Drawer, `hilfe/HilfeSeitenleiste.tsx`).
    await menue.getByRole('menuitem', { name: 'Hilfe zu dieser Seite' }).click();
    await expect(
      page.getByRole('dialog').filter({ has: page.locator('.hilfe-seitenleiste') }),
    ).toBeVisible();
  });

  test(`Handy, Handschuh, ${nutzer}: Profil und alle drei Leisten im Fenster`, async ({ page }) => {
    await dichte(page, 'handschuh');
    const benutzername = await anmelden(page, nutzer);
    await page.setViewportSize(HANDY);
    await page.goto('/einsaetze');
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

    const menue = await oeffneMenue(page, ausloeser(page));
    await pruefeKopf(menue, nutzer, benutzername);
    expect(await menue.evaluate((m) => m.scrollTop), 'Vorbedingung: ungerollt').toBe(0);
    await expect(menue.getByRole('menuitem', { name: 'Profil' })).toBeInViewport({ ratio: 1 });
    const helligkeit = menue.getByRole('radiogroup', { name: 'Helligkeit in %' });
    await expect(helligkeit).toBeInViewport({ ratio: 1 });
    // Bedienbar: eine Stufe wählen, das Menü bleibt offen und zeigt sie.
    await helligkeit.getByRole('radio', { name: '60 %' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-helligkeit', '60');
    await expect(helligkeit.getByRole('radio', { name: '60 %' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(offenesMenue(page)).toHaveCount(1);
    // „Abmelden“ steht zuletzt und ist durch Rollen erreichbar (LLH-1730); „Abbrechen“ lässt die
    // Person angemeldet. Per ↵ auf dem fokussierten „Abbrechen“: am Handy liegt eine
    // Info-Benachrichtigung des Rollenwechsels zeitweise über dem Dialogfuß und finge den Klick.
    const rueckfrage = await oeffneAbmeldenRueckfrage(page, menue);
    await page.keyboard.press('Enter');
    await expect(rueckfrage).toBeHidden();
    await expect(page).toHaveURL(/\/einsaetze/);
  });
}

/**
 * Die Rückfrage im echten Browser (LLH-1730, design.md D3): nach der Einblendung steht der Fokus
 * auf „Abbrechen“, ein ↵ meldet also nicht ab; bestätigt führt sie zur Anmeldung. Aus dem Menü und
 * aus der Sprungpalette.
 */
test('Rückfrage aus dem Menü: Fokus auf „Abbrechen“, Bestätigen meldet ab', async ({ page }) => {
  await anmeldenAlsAdmin(page, { startseite: false });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto('/einsaetze');
  const menue = await oeffneMenue(page, ausloeser(page));
  // Wartet die Einblendung ab und sichert den Fokus auf „Abbrechen“ zu.
  const rueckfrage = await oeffneAbmeldenRueckfrage(page, menue);
  await page.keyboard.press('Enter');
  await expect(rueckfrage).toBeHidden();
  await expect(page).toHaveURL(/\/einsaetze/);

  await oeffneAbmeldenRueckfrage(page, await oeffneMenue(page, ausloeser(page)));
  await rueckfrage.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('Rückfrage aus der Sprungpalette: ↵ schließt die Palette, ↵ in der Rückfrage bricht ab', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page, { startseite: false });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/einsaetze');
  await expect(page.getByRole('heading', { level: 1, name: 'Einsätze' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const suche = page.getByRole('combobox');
  await suche.fill('Abmelden');
  await expect(page.getByRole('option', { name: /Abmelden/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  const rueckfrage = page.getByRole('dialog', { name: 'Abmelden?' });
  await expect(rueckfrage.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await expect(suche).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(rueckfrage).toBeHidden();
  await expect(page).toHaveURL(/\/einsaetze/);
});

/**
 * Reiter „Anzeige“ der Einsatz-Einstellungen (LLH-1730, Szenario „Ohne Recht und im
 * abgeschlossenen Einsatz“): ein Beobachter im abgeschlossenen Einsatz, am Handy im
 * Handschuh-Betrieb. Die fünf Helligkeitsstufen stehen in einer Zeile, ohne über die Leiste zu
 * ragen, und eine Wahl wirkt. Der Rollenzweig ist Vorbedingung (`e2e/AGENTS.md`): „Allgemein“
 * zeigt diesem Nutzer „Nur Ansicht“, „Anzeige“ nicht.
 */
test('Reiter „Anzeige“ am Handy im Handschuh-Betrieb, als Beobachter im abgeschlossenen Einsatz', async ({
  page,
}) => {
  await dichte(page, 'handschuh');
  await anmeldenAlsAdmin(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `Anzeige Beobachter ${Date.now()}`);
  const konto = await benutzerAnlegen(page, 'beobachter');
  await mitgliedEintragen(page, einsatzId, konto.id, 'beobachter');
  const zu = await page.request.post(`/api/einsaetze/${einsatzId}/abschliessen`);
  expect(zu.ok(), await zu.text()).toBe(true);
  await benachrichtigungenQuittieren(konto);
  await wechsleZu(page, konto);
  await page.setViewportSize(HANDY);

  // Gegenprobe des Rollenzweigs mit demselben Locator: „Allgemein“ ist für ihn gesperrt.
  const rechteHinweis = page.locator('[data-lfh="rechte-hinweis"]');
  await page.goto(`/einsaetze/${einsatzId}/einstellungen/allgemein`);
  await expect(rechteHinweis).toBeVisible();
  await page.getByRole('tab', { name: 'Anzeige' }).click();
  await expect(page.getByRole('tab', { name: 'Anzeige', selected: true })).toBeVisible();
  await expect(rechteHinweis).toHaveCount(0);
  const helligkeit = page.getByRole('radiogroup', { name: 'Helligkeit in %' });
  const mass = await helligkeit.evaluate((leiste) => {
    const l = leiste.getBoundingClientRect();
    const k = [...leiste.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
    return {
      links: l.left,
      rechts: l.right,
      knoepfe: k.map((r) => ({ l: r.left, r: r.right, o: r.top })),
    };
  });
  expect(mass.knoepfe).toHaveLength(5);
  for (const k of mass.knoepfe) {
    expect(k.o).toBeCloseTo(mass.knoepfe[0]!.o, 0);
    expect(k.l).toBeGreaterThanOrEqual(mass.links);
    expect(k.r).toBeLessThanOrEqual(mass.rechts);
  }
  await helligkeit.getByRole('radio', { name: '60 %' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-helligkeit', '60');
});

/**
 * D12: fünf Helligkeitsstufen im Handschuh-Betrieb in einer Zeile, nicht überlappend, nicht über
 * die Leiste hinaus, Zielabstand ≥ 16 px (LFH-865), Höhe 72 px. Am Handy schmaler als die Staffel,
 * ab `md` (Menü 504 px) in voller Breite.
 */
for (const fenster of [HANDY, { width: 1024, height: 768 }]) {
  test(`Handschuh ${fenster.width} px: Helligkeit in einer Zeile mit Zielabstand`, async ({
    page,
  }) => {
    await dichte(page, 'handschuh');
    await anmeldenAlsAdmin(page, { startseite: false });
    await page.setViewportSize(fenster);
    await page.goto('/einsaetze');
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
    const menue = await oeffneMenue(page, ausloeser(page));
    const mass = await menue
      .getByRole('radiogroup', { name: 'Helligkeit in %' })
      .evaluate((leiste) => {
        const l = leiste.getBoundingClientRect();
        const k = [...leiste.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
        return {
          links: l.left,
          rechts: l.right,
          knoepfe: k.map((r) => ({ links: r.left, rechts: r.right, oben: r.top, hoehe: r.height })),
        };
      });
    expect(mass.knoepfe).toHaveLength(5);
    const oben = mass.knoepfe[0]!.oben;
    for (const [i, k] of mass.knoepfe.entries()) {
      expect(k.oben, `Stufe ${i} in derselben Zeile`).toBeCloseTo(oben, 0);
      expect(k.hoehe, `Stufe ${i} hoch genug`).toBeGreaterThanOrEqual(72);
      expect(k.links, `Stufe ${i} nicht links heraus`).toBeGreaterThanOrEqual(mass.links);
      expect(k.rechts, `Stufe ${i} nicht rechts heraus`).toBeLessThanOrEqual(mass.rechts);
      if (fenster.width >= 768) {
        expect(k.rechts - k.links, `Stufe ${i} hält 72 px ab md`).toBeGreaterThanOrEqual(72);
      }
      const naechster = mass.knoepfe[i + 1];
      if (naechster) {
        expect(naechster.links - k.rechts, `Abstand ${i}/${i + 1}`).toBeGreaterThanOrEqual(16);
      }
    }
  });
}

test('Tastatur: Tab führt in die Leisten, Pfeile bleiben darin, Tab hinter der letzten schließt', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page, { startseite: false });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto('/einsaetze');

  const menue = await oeffneMenue(page, ausloeser(page));
  const leiste = (name: string) => menue.getByRole('radiogroup', { name, exact: true });
  // Erster Tab: `rc-dropdown` holt den Fokus ins Menü; der zweite führt in die erste Leiste.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const gewaehlt = leiste('Darstellung').locator('[aria-checked="true"]');
  await expect(gewaehlt).toBeFocused();
  const vorher = await gewaehlt.textContent();

  // Pfeil rechts wählt den Nachbarn in DERSELBEN Leiste; der Menüfokus wandert nicht mit.
  await page.keyboard.press('ArrowRight');
  const danach = leiste('Darstellung').locator('[aria-checked="true"]');
  await expect(danach).toBeFocused();
  expect(await danach.textContent()).not.toBe(vorher);
  await expect(offenesMenue(page)).toHaveCount(1);
  // Pfeil runter und Ende sind die Tasten, mit denen `rc-menu` zwischen Einträgen wandert: sie
  // bleiben in der Leiste (Abfangen in `AnzeigeLeisten`), der Fokus springt nicht auf „Profil“.
  await page.keyboard.press('End');
  const ende = leiste('Darstellung').getByRole('radio').last();
  await expect(ende).toBeFocused();
  await expect(ende).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(leiste('Darstellung').getByRole('radio').first()).toBeFocused();
  await expect(offenesMenue(page)).toHaveCount(1);

  await page.keyboard.press('Tab');
  await expect(leiste('Bediendichte').locator('[aria-checked="true"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(leiste('Helligkeit in %').locator('[aria-checked="true"]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(leiste('Bediendichte').locator('[aria-checked="true"]')).toBeFocused();
  await page.keyboard.press('Tab');
  // Hinter der letzten Leiste schließt Tab das Menü wie bisher.
  await page.keyboard.press('Tab');
  await expect(offenesMenue(page)).toHaveCount(0);
});

test('Eingänge: „Benachrichtigungen einstellen“ führt auf die Einstellungen', async ({ page }) => {
  await anmeldenAlsAdmin(page, { startseite: false });
  await page.setViewportSize({ width: 1366, height: 900 });
  const einsatzId = await einsatzPerApi(page, `Benutzermenü Eingänge ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  await page.getByRole('button', { name: /^Eingänge, / }).click();
  const paneel = page.getByRole('region', { name: 'Eingänge' });
  await expect(paneel).toBeVisible();
  await paneel.getByRole('link', { name: /Benachrichtigungen einstellen/ }).click();
  await expect(page).toHaveURL(/\/benachrichtigungen$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Benachrichtigungen' })).toBeVisible();
  await expect(paneel).toBeHidden();
});
