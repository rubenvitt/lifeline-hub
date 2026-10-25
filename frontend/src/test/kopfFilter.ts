import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Öffnet den Kopffilter einer Spalte und gibt SEIN Menü zurück (LLH-1431). Ein geschlossenes Menü
 * bleibt im DOM und trägt in jsdom nie `ant-dropdown-hidden` (die Abgangsbewegung endet dort
 * nicht); das erste Menü ohne die Klasse war deshalb beim zweiten Kopffilter eines Tests das des
 * ersten. Offen ist ein Menü, das rc-trigger nicht mit `pointer-events: none` stilllegt (das setzt
 * es genau bei `open === false`); nach dem Klick auf den Auslöser darf genau eines offen sein.
 */
export async function openKopfFilter(spalte: string): Promise<HTMLElement> {
  const ausloeser = await screen.findByRole('button', { name: new RegExp(`^${spalte} filtern`) });
  await userEvent.click(ausloeser);
  return waitFor(() => {
    if (!ausloeser.classList.contains('ant-dropdown-open')) {
      throw new Error(`Filtermenü „${spalte}“ ist nicht offen`);
    }
    const offen = [
      ...document.querySelectorAll<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden)'),
    ]
      .filter((d) => d.style.pointerEvents !== 'none')
      .map((d) => d.querySelector<HTMLElement>('.ant-table-filter-dropdown'))
      .filter((m): m is HTMLElement => m != null);
    if (offen.length !== 1) {
      throw new Error(
        `Nach „${spalte} filtern“ sind ${offen.length} Filtermenüs offen, nicht eins`,
      );
    }
    return offen[0];
  });
}

/**
 * Wählt im Kopffilter einer Tabellenspalte Werte und bestätigt (LLH-1086): Auslöser über seinen
 * Namen („Typ filtern“, `KatalogTabelle`, LLH-1227), Werte über ihren Text im Menü (im Clientmodus
 * mit Zähler, „Feuerwehr (2)“), dann antds Bestätigen-Knopf.
 */
export async function kopfFilterWaehlen(spalte: string, werte: readonly (string | RegExp)[]) {
  const menue = await openKopfFilter(spalte);
  for (const wert of werte) {
    const treffer = [
      ...menue.querySelectorAll<HTMLElement>('.ant-dropdown-menu-title-content'),
    ].find((e) =>
      typeof wert === 'string' ? e.textContent === wert : wert.test(e.textContent ?? ''),
    );
    if (!treffer) throw new Error(`Wert „${String(wert)}“ fehlt im Filtermenü „${spalte}“`);
    await userEvent.click(treffer);
  }
  await userEvent.click(
    menue.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
  );
}

/** Die Texte der Werte im offenen Filtermenü einer Spalte. */
export async function kopfFilterWerte(spalte: string): Promise<string[]> {
  const menue = await openKopfFilter(spalte);
  return [...menue.querySelectorAll('.ant-dropdown-menu-title-content')].map(
    (e) => e.textContent ?? '',
  );
}

/** Die Texte der angehakten, noch nicht bestätigten Werte in einem offenen Filtermenü. */
export function angehakteWerte(menue: HTMLElement): string[] {
  return [...menue.querySelectorAll('.ant-dropdown-menu-item')]
    .filter((e) => e.querySelector('.ant-checkbox-checked') != null)
    .map((e) => e.querySelector('.ant-dropdown-menu-title-content')?.textContent ?? '');
}
