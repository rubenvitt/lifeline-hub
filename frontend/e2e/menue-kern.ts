import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Wahl im Aktionsmenü eines Datensatzes (`components/MenueAusloeser.tsx`), geteilt von den Specs
 * der Benutzerverwaltung, deren Zeilen seit LFH-1122 auf jeder Breite ein Menü tragen.
 *
 * Wie bei der Auswahlliste (`auswahl-kern.ts`) gilt: ein ausblendendes Menü (`-leave`) trägt
 * `ant-dropdown-hidden` erst am Ende seiner Animation, und ein einblendendes nimmt noch keinen
 * Klick an. Geklickt wird erst, wenn das Menü steht.
 *
 * Ein langes Menü rollt in sich (`max-height`, das Benutzermenü im Handschuh). Liegt der Eintrag
 * unter dem Rand, zentriert Playwrights Klick ihn und rollt dabei auch das Dokument. Das Menü hängt
 * absolut im `body`, sein Auslöser im festen Kopf; antd richtet es nach dem Scroll-Ereignis neu am
 * Auslöser aus. Fällt das zwischen `pointerdown` und `pointerup`, landet `pointerup` neben dem
 * Eintrag, `click` geht an `body`, und die Wahl bleibt aus (LLH-1337). Deshalb rollt
 * `klickeEintrag` den Eintrag vorher in der Liste selbst nach oben und lässt das Dokument stehen.
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
  await klickeEintrag(menue.getByRole('menuitem', { name: eintrag, exact: true }));
}

/**
 * Klickt einen Eintrag des stehenden Menüs, ohne dass dabei das Dokument rollt: steht er nicht
 * ganz sichtbar in Liste und Fenster, rollt nur die Liste ihn an ihren oberen Rand.
 */
export async function klickeEintrag(eintrag: Locator): Promise<void> {
  await eintrag.evaluate((element) => {
    const liste = element.closest('.ant-dropdown-menu-root');
    if (!(liste instanceof HTMLElement)) return;
    const l = liste.getBoundingClientRect();
    const e = element.getBoundingClientRect();
    const sichtbar = e.top >= l.top && e.bottom <= Math.min(l.bottom, window.innerHeight);
    if (!sichtbar) liste.scrollTop += e.top - l.top;
  });
  // Ganz im Fenster: Playwright muss für den Klick nichts mehr rollen.
  await expect(eintrag).toBeInViewport({ ratio: 1 });
  await eintrag.click();
}
