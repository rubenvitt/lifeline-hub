import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Wählt im Kopffilter einer Tabellenspalte Werte und bestätigt (LLH-1086): Auslöser über seinen
 * Namen („Typ filtern“, `KatalogTabelle`, LLH-1227), Werte über ihren Text im Menü (im Clientmodus
 * mit Zähler, „Feuerwehr (2)“), dann antds Bestätigen-Knopf.
 */
export async function kopfFilterWaehlen(spalte: string, werte: readonly (string | RegExp)[]) {
  await userEvent.click(
    await screen.findByRole('button', { name: new RegExp(`^${spalte} filtern`) }),
  );
  const menue = await waitFor(() => {
    const m = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) .ant-table-filter-dropdown',
    );
    if (!m) throw new Error(`Filtermenü „${spalte}“ ist nicht offen`);
    return m;
  });
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
  await userEvent.click(
    await screen.findByRole('button', { name: new RegExp(`^${spalte} filtern`) }),
  );
  const menue = await waitFor(() => {
    const m = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) .ant-table-filter-dropdown',
    );
    if (!m) throw new Error(`Filtermenü „${spalte}“ ist nicht offen`);
    return m;
  });
  return [...menue.querySelectorAll('.ant-dropdown-menu-title-content')].map(
    (e) => e.textContent ?? '',
  );
}
