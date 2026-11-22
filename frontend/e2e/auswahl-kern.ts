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
 * Die Liste, die zum Feld `feld` gehört: das Feld nennt sie in `aria-controls` (`<id>_list`), und
 * dieses Element liegt in der sichtbaren Liste im Portal.
 */
async function listeZu(feld: Locator): Promise<Locator> {
  const liste = await feld.getAttribute('aria-controls');
  expect(liste, 'Vorbedingung: das Feld nennt seine Liste (aria-controls)').toBeTruthy();
  const page = feld.page();
  return offeneAuswahl(page).filter({ has: page.locator(`[id="${liste}"]`) });
}

/**
 * Wählt im Feld `feld` (die `combobox`) die Option `titel` nur mit der Tastatur (LLH-2002):
 * Fokus, Pfeil nach unten öffnet die Liste und blättert, Enter wählt. Mit `beginntMit` genügt der
 * Anfang des Titels (etwa eine Einheit samt Stärke).
 *
 * Für Specs mit angehaltener Uhr (`uhrAnhalten` im Bildlauf): Playwright fälscht dann auch
 * `requestAnimationFrame`, über das antd die Einblendung schaltet, und Dialog wie Liste blenden
 * verspätet und unregelmäßig ein, einmal hing das Modal über 3 s in `ant-zoom-appear-start`. Läuft
 * die Einblendung während eines Klicks an, nimmt antd keine Zeigerereignisse an
 * (`-appear-active`), der Klick fällt auf das Feld darunter und auf `.ant-modal-wrap`, Playwright
 * scrollt zum Ausweichen und die Liste schließt sich. Die Tastatur trifft immer das Feld mit dem
 * Fokus, gleich wie weit die Einblendung ist.
 */
export async function waehlePerTastatur(
  feld: Locator,
  titel: string,
  { beginntMit = false }: { beginntMit?: boolean } = {},
): Promise<void> {
  const passt = (t: string | null) => t != null && (beginntMit ? t.startsWith(titel) : t === titel);
  await feld.focus();
  await feld.press('ArrowDown');
  const aktiv = (await listeZu(feld)).locator('.ant-select-item-option-active');
  const gesehen: string[] = [];
  let aktuell = await aktiv.getAttribute('title');
  while (!passt(aktuell)) {
    expect(
      gesehen,
      `Option „${titel}“ nicht in der Liste (gesehen: ${gesehen.join(', ')})`,
    ).not.toContain(aktuell);
    gesehen.push(aktuell ?? '');
    await feld.press('ArrowDown');
    aktuell = await aktiv.getAttribute('title');
  }
  await feld.press('Enter');
  await zeigtWahl(feld, aktuell ?? titel);
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
