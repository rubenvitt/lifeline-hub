import { expect, type Page } from '@playwright/test';

/**
 * Wege in die Kartenleiste der Lagekarte (LLH-1028): die Leiste gliedert sich in die Ansichten
 * „Ebenen“ und „Objekte“ (Tabliste über ihrem Inhalt); die Ebenen stehen als Baum in einklappbaren
 * Gruppen. Ohne gemerkte Wahl steht „Ebenen“ vorn, Kräfte und Lage sind offen.
 */

export type LeistenAnsicht = 'Ebenen' | 'Objekte';

/** Holt die Ansicht nach vorn — wie ein Tipp aufs Segment (gemerkt je Gerät). */
export async function zeigeLeistenAnsicht(page: Page, ansicht: LeistenAnsicht) {
  const tab = page
    .getByRole('tablist', { name: 'Ansicht der Leiste' })
    .getByRole('tab', { name: ansicht });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Gruppen des Ebenenbaums samt der Gruppe, in der sie stehen (Untergruppen). */
const ELTERN: Record<string, string> = {
  warnungen: 'fachebenen',
  wasser: 'fachebenen',
  umwelt: 'fachebenen',
  verkehr: 'fachebenen',
  grundlage: 'hintergrund',
  bilder: 'hintergrund',
};

/**
 * Öffnet eine Gruppe des Ebenenbaums (`section[data-paneel=…]`) samt ihrer Elterngruppe und holt
 * dafür die Ansicht „Ebenen“ nach vorn. Kennungen: kraefte, lage, betroffene, fachebenen,
 * warnungen, wasser, umwelt, verkehr, hintergrund, grundlage, bilder.
 */
export async function oeffneEbenenGruppe(page: Page, kennung: string) {
  await zeigeLeistenAnsicht(page, 'Ebenen');
  const kette = ELTERN[kennung] ? [ELTERN[kennung], kennung] : [kennung];
  for (const k of kette) {
    const kopf = page.locator(`section[data-paneel="${k}"] button[aria-expanded]`).first();
    await expect(kopf).toBeVisible();
    if ((await kopf.getAttribute('aria-expanded')) !== 'true') await kopf.click();
    await expect(kopf).toHaveAttribute('aria-expanded', 'true');
  }
}

/** Alle Fachebenen-Untergruppen offen — für Prüfungen über jede Fachebene. */
export async function oeffneAlleFachebenen(page: Page) {
  for (const k of ['warnungen', 'wasser', 'umwelt', 'verkehr']) await oeffneEbenenGruppe(page, k);
}

/**
 * Für `addInitScript`/`page.evaluate`: Gruppen des Ebenenbaums vor dem Laden offen, ohne einen
 * Klick (Schlüssel `lfh:lagekarte:ebenen-gruppen`).
 */
export const BAUM_SCHLUESSEL = 'lfh:lagekarte:ebenen-gruppen';
export const ANSICHT_SCHLUESSEL = 'lfh:lagekarte:leiste-ansicht';

/** Klappzustand mit „Fachebenen“ und allen Untergruppen offen — für `addInitScript` ohne Klick. */
export const FACHEBENEN_OFFEN = JSON.stringify({
  fachebenen: true,
  warnungen: true,
  wasser: true,
  umwelt: true,
  verkehr: true,
});
