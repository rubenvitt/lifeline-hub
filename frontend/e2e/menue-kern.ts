import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Wahl im Aktionsmenü eines Datensatzes (`components/MenueAusloeser.tsx`), geteilt von den Specs
 * der Benutzerverwaltung, deren Zeilen seit LFH-1122 auf jeder Breite ein Menü tragen.
 *
 * Wie bei der Auswahlliste (`auswahl-kern.ts`) gilt: ein ausblendendes Menü (`-leave`) trägt
 * `ant-dropdown-hidden` erst am Ende seiner Animation, und ein einblendendes nimmt noch keinen
 * Klick an. Geklickt wird erst, wenn das Menü steht.
 */

const EINBLENDUNG = /ant-slide-(up|down)-(appear|enter)/;

/** Das offene Menü im Portal, ohne ein gerade ausblendendes. */
export function offenesMenue(page: Page): Locator {
  return page.locator(
    '.ant-dropdown:not(.ant-dropdown-hidden):not(.ant-slide-up-leave):not(.ant-slide-down-leave)',
  );
}

/** Öffnet das Menü am Auslöser und gibt es zurück, sobald es steht. */
export async function oeffneMenue(page: Page, ausloeser: Locator): Promise<Locator> {
  await ausloeser.click();
  const menue = offenesMenue(page);
  await expect(menue).toBeVisible();
  await expect(menue).not.toHaveClass(EINBLENDUNG);
  return menue.getByRole('menu');
}

/** Öffnet das Menü am Auslöser und wählt den Eintrag `eintrag`. */
export async function waehleImMenue(
  page: Page,
  ausloeser: Locator,
  eintrag: string,
): Promise<void> {
  const menue = await oeffneMenue(page, ausloeser);
  await menue.getByRole('menuitem', { name: eintrag, exact: true }).click();
}
