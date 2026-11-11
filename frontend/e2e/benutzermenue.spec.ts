import { expect, test, type Locator, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';
import { offenesMenue, oeffneMenue } from './menue-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Das entschlackte Benutzermenü (LLH-1642, Spec `benutzermenue`): Platz am Handy, Tastatur in der
 * Gruppe „Anzeige“ im echten Browser und der zweite Weg zu den Benachrichtigungen aus den
 * Eingängen. Die Reihenfolge und die Leisten selbst prüft `BenutzerMenu.test.tsx`; hier, was
 * jsdom nicht rechnet: Lage im Fenster, `rc-menu`/`rc-dropdown` mit echten Tasten.
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
  admin: ['Admin'],
  fuehrungskraft: ['Führungskraft'],
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
  for (const tag of ['Admin', 'Führungskraft']) {
    await expect(menue.getByText(tag, { exact: true })).toHaveCount(
      ROLLEN_TAGS[nutzer].includes(tag) ? 1 : 0,
    );
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
    for (const name of ['Profil', 'Abmelden', 'Benachrichtigungen', 'Neuigkeiten', 'Hilfe']) {
      await expect(menue.getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeInViewport({
        ratio: 1,
      });
    }
    for (const leiste of ['Darstellung', 'Bediendichte', 'Helligkeit in %']) {
      await expect(menue.getByRole('radiogroup', { name: leiste })).toBeInViewport({ ratio: 1 });
    }
    // Bedienbar, nicht nur sichtbar (`e2e/AGENTS.md`): „Hilfe“ führt auf die Hilfe.
    await menue.getByRole('menuitem', { name: 'Hilfe' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Hilfe' })).toBeVisible();
  });

  test(`Handy, Handschuh, ${nutzer}: Abmelden und alle drei Leisten im Fenster`, async ({
    page,
  }) => {
    await dichte(page, 'handschuh');
    const benutzername = await anmelden(page, nutzer);
    await page.setViewportSize(HANDY);
    await page.goto('/einsaetze');
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

    const menue = await oeffneMenue(page, ausloeser(page));
    await pruefeKopf(menue, nutzer, benutzername);
    expect(await menue.evaluate((m) => m.scrollTop), 'Vorbedingung: ungerollt').toBe(0);
    await expect(menue.getByRole('menuitem', { name: 'Abmelden' })).toBeInViewport({ ratio: 1 });
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
  });
}

/**
 * D12: fünf Helligkeitsstufen im Handschuh-Betrieb in einer Zeile, nicht überlappend, nicht über
 * die Leiste hinaus, Zielabstand ≥ 16 px (LFH-865), Höhe 72 px. Am Handy schmaler als die Staffel,
 * ab `md` (Menü 480 px) in voller Breite.
 */
for (const fenster of [HANDY, { width: 1024, height: 768 }]) {
  test(`Handschuh ${fenster.width} px: Helligkeit in einer Zeile mit Zielabstand`, async ({
    page,
  }) => {
    await dichte(page, 'handschuh');
    await anmeldenAlsAdmin(page);
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
  await anmeldenAlsAdmin(page);
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
  await anmeldenAlsAdmin(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  const einsatzId = await einsatzAnlegen(page, `Benutzermenü Eingänge ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  await page.getByRole('button', { name: /^Eingänge, / }).click();
  const paneel = page.getByRole('region', { name: 'Eingänge' });
  await expect(paneel).toBeVisible();
  await paneel.getByRole('link', { name: /Benachrichtigungen einstellen/ }).click();
  await expect(page).toHaveURL(/\/benachrichtigungen$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Benachrichtigungen' })).toBeVisible();
  await expect(paneel).toBeHidden();
});
