import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';
import { offenesMenue, oeffneMenue } from './menue-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

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

test('Handy, komfortabel: das ganze Menü liegt ohne Rollen im Fenster', async ({ page }) => {
  await dichte(page, 'komfortabel');
  await anmeldenAlsAdmin(page);
  await page.setViewportSize(HANDY);
  await page.goto('/einsaetze');
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'komfortabel');

  const menue = await oeffneMenue(page, ausloeser(page));
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

test('Handy, Handschuh: Abmelden und alle drei Leisten ohne Rollen im Fenster', async ({
  page,
}) => {
  await dichte(page, 'handschuh');
  await anmeldenAlsAdmin(page);
  await page.setViewportSize(HANDY);
  await page.goto('/einsaetze');
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  const menue = await oeffneMenue(page, ausloeser(page));
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
