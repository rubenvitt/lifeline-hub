import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Wege in die Kartenleiste der Lagekarte (LLH-1028, LLH-1033): die Leiste gliedert sich in die
 * Ansichten „Ebenen“, „Objekte“ und — solange etwas ausgewählt ist — „Auswahl“ (Tabliste über
 * ihrem Inhalt); die Ebenen stehen als Baum in einklappbaren Gruppen, die Objekte als eine Liste
 * mit Gruppen je Art (ohne Suchbegriff zugeklappt). Ohne gemerkte Wahl steht „Ebenen“ vorn, Kräfte
 * und Lage sind offen. Eine neue Auswahl steht vorn; ein Tipp auf „Ebenen“/„Objekte“ lässt sie
 * bestehen.
 */

export type LeistenAnsicht = 'Ebenen' | 'Objekte' | 'Auswahl';

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

/** Klappzustand der Objektliste (LLH-1033), je Art: `{ einheit: true, … }`. */
export const OBJEKTE_SCHLUESSEL = 'lfh:lagekarte:objekte-gruppen';

/** Die Objektliste der Ansicht „Objekte“. */
export const objektListe = (page: Page) => page.locator('[data-paneel="objekte"]');

/**
 * Sucht in der Objektliste nach `begriff` (Gruppen mit Treffern stehen dann offen) und gibt die
 * Zeile mit diesem Namen zurück — samt Zeilenaktion („Platzieren“, „Fläche zeichnen“, …).
 */
export async function objektZeile(page: Page, begriff: string, name = begriff): Promise<Locator> {
  await zeigeLeistenAnsicht(page, 'Objekte');
  await page.getByRole('textbox', { name: 'Kartenobjekte suchen' }).fill(begriff);
  const zeile = objektListe(page).locator('.listen-eintrag').filter({ hasText: name }).first();
  await expect(zeile).toBeVisible();
  return zeile;
}

/** Öffnet eine Gruppe der Objektliste (`section[data-paneel="objekte-<typ>"]`, z. B. `einheit`). */
export async function oeffneObjektGruppe(page: Page, typ: string) {
  await zeigeLeistenAnsicht(page, 'Objekte');
  const kopf = page.locator(`section[data-paneel="objekte-${typ}"] button[aria-expanded]`).first();
  await expect(kopf).toBeVisible();
  if ((await kopf.getAttribute('aria-expanded')) !== 'true') await kopf.click();
  await expect(kopf).toHaveAttribute('aria-expanded', 'true');
}

/** Die Fläche der Ansicht „Auswahl“ (Inspectors). */
export const auswahlAnsicht = (page: Page) => page.locator('[data-paneel="ausgewaehlt"]');

/** Knopf „Zeichenwerkzeuge“ an der Karte (LLH-1038) — ein Disclosure, kein Leistenschalter. */
export const zeichenwerkzeugeKnopf = (page: Page) =>
  page.getByRole('button', { name: 'Zeichenwerkzeuge', exact: true });

/** Das Werkzeugmenü an der Karte (`Werkzeugmenue.tsx`), offen über dem Kartenfuß. */
export const werkzeugmenue = (page: Page) =>
  page.getByRole('dialog', { name: 'Zeichenwerkzeuge', exact: true });

/** Öffnet das Werkzeugmenü (bleibt offen, wenn es schon offen ist) und gibt es zurück. */
export async function oeffneWerkzeugmenue(page: Page, tippen = false): Promise<Locator> {
  const knopf = zeichenwerkzeugeKnopf(page);
  if ((await knopf.getAttribute('aria-expanded')) !== 'true') {
    await (tippen ? knopf.tap() : knopf.click());
  }
  await expect(knopf).toHaveAttribute('aria-expanded', 'true');
  const menue = werkzeugmenue(page);
  await expect(menue).toBeVisible();
  return menue;
}

/**
 * Wählt einen Eintrag des Werkzeugmenüs — Name wie im Menü: „Gefahrengebiet“,
 * „Absperrbereich als Kreis“, „Freie Skizze als Linie“, „Weitere …“. Das Menü schließt dabei.
 */
export async function waehleWerkzeug(page: Page, eintrag: string, tippen = false) {
  const menue = await oeffneWerkzeugmenue(page, tippen);
  const ziel = menue.getByRole('button', { name: eintrag, exact: true });
  await (tippen ? ziel.tap() : ziel.click());
  await expect(menue).toHaveCount(0);
}

/** „Weitere …“: der Zeichen-Picker als Dialog „Taktisches Zeichen“ (`ZeichenWahlDialog`). */
export async function oeffneZeichenWahl(page: Page, tippen = false): Promise<Locator> {
  await waehleWerkzeug(page, 'Weitere …', tippen);
  const dialog = page.getByRole('dialog', { name: 'Taktisches Zeichen', exact: true });
  await expect(dialog).toBeVisible();
  // Erst nach dem Aufzoomen messen: während der Animation skaliert `transform` jeden Kasten.
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
  return dialog;
}
