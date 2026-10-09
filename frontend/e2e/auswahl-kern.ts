import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Wahl in einer antd-Auswahlliste, geteilt von allen Specs, die eine Option anklicken
 * (LFH-1119, Ursache in LFH-1058).
 *
 * Während die Liste einblendet (`ant-slide-up-appear`), nimmt sie keine Zeigerereignisse an.
 * Playwright versucht es dann mit anderen Scroll-Lagen und scrollt dabei das Dokument hinter dem
 * Dialog. Die Liste steht absolut im Dokument, wandert mit und wird von antd erst nach dem Scrollen
 * neu angelegt. Kommt das zwischen `mousedown` und `mouseup`, landet der Klick auf `body`, und die
 * Option bleibt ungewählt. Deshalb wird erst geklickt, wenn die Liste steht, und die Wahl danach
 * als Vorbedingung zugesichert: ein verlorener Klick wird dort rot, nicht erst Schritte später.
 */

/** Einblendende Liste: solange eine dieser Klassen steht, ist die Liste nicht klickbar. */
const EINBLENDUNG = /ant-slide-(up|down)-(appear|enter)/;

/**
 * Die offene Auswahlliste im Portal. Eine gerade ausblendende Liste (`-leave`) trägt
 * `ant-select-dropdown-hidden` erst am Ende ihrer Animation und zählt hier nicht mit.
 */
export function offeneAuswahl(page: Page): Locator {
  return page.locator(
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)' +
      ':not(.ant-slide-up-leave):not(.ant-slide-down-leave)',
  );
}

/** Die offene Auswahlliste, erst wenn sie fertig eingeblendet ist. */
export async function stehendeAuswahl(page: Page): Promise<Locator> {
  const liste = offeneAuswahl(page);
  await expect(liste).toBeVisible();
  await expect(liste).not.toHaveClass(EINBLENDUNG);
  return liste;
}

/** Klickt in der stehenden Auswahlliste die Option mit dem Titel `titel`. */
export async function waehleStehend(
  page: Page,
  titel: string,
  { exact = true }: { exact?: boolean } = {},
): Promise<void> {
  const liste = await stehendeAuswahl(page);
  await liste.getByTitle(titel, { exact }).click();
}

/**
 * Das antd-`Select`, zu dem das Feld `feld` (die `combobox`) gehört. Dort steht die Wahl als
 * Element mit dem Titel der Option, im Mehrfachfeld als Marke.
 */
function auswahlfeld(feld: Locator): Locator {
  return feld.locator(
    'xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]',
  );
}

/** Sichert zu, dass im Feld `feld` die Option `titel` gewählt ist. */
export async function zeigtWahl(feld: Locator, titel: string): Promise<void> {
  await expect(auswahlfeld(feld).getByTitle(titel, { exact: true })).toBeVisible();
}

/**
 * Öffnet das Feld `feld` (die `combobox`), klickt die Option `titel` in der stehenden Liste und
 * sichert zu, dass sie im Feld steht.
 */
export async function waehleIn(feld: Locator, titel: string): Promise<void> {
  await feld.click();
  await waehleStehend(feld.page(), titel);
  await zeigtWahl(feld, titel);
}
