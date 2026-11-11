/**
 * Kontextmenü der `KatalogTabelle` über `zeilenMenue` (LLH-1599, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/archive/2026-11-09-lor2qhep-kontextmenue-tabellen/design.md` D2).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import KatalogTabelle, { type KatalogSpalte } from './KatalogTabelle';
import type { WeitereAktionen } from './Datensicht';

function renderMitProviders(ui: ReactElement) {
  const ergebnis = renderMitBasisProviders(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);
  return {
    ...ergebnis,
    rerender: (naechstes: ReactElement) =>
      ergebnis.rerender(<CommandPaletteProvider>{naechstes}</CommandPaletteProvider>),
  };
}

interface Stelle {
  id: number;
  bezeichnung: string;
  art: string;
}
const ZEILEN: Stelle[] = [
  { id: 1, bezeichnung: 'Leitstelle Nord', art: 'Leitstelle' },
  { id: 2, bezeichnung: 'Polizei Süd', art: 'Polizei' },
];
const SPALTEN: KatalogSpalte<Stelle>[] = [
  { title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bezeichnung' },
  { title: 'Art', dataIndex: 'art', key: 'art' },
];

function menue(extra: Partial<WeitereAktionen<Stelle>> = {}): WeitereAktionen<Stelle> {
  return {
    eintraege: () => [
      { key: 'bearbeiten', label: 'Bearbeiten' },
      { key: 'deaktivieren', label: 'Deaktivieren', gefahr: true },
    ],
    zugaenglicherName: (s) => `Aktionen zu ${s.bezeichnung}`,
    onWahl: vi.fn(),
    ...extra,
  };
}

const offenesMenue = () =>
  document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label^="Aktionen zu"]',
  );
const kontextAnker = () => document.querySelector('[data-lfh="datensatz-kontextmenue-anker"]');
const zelle = (text: string) => screen.getByText(text).closest('td')!;

describe('KatalogTabelle · zeilenMenue (LLH-1599, D2)', () => {
  it('Rechtsklick auf eine Zeile öffnet ihr Menü; die Wahl geht mit der Zeile an `onWahl`', async () => {
    const m = menue();
    renderMitProviders(
      <KatalogTabelle<Stelle> rowKey="id" columns={SPALTEN} dataSource={ZEILEN} zeilenMenue={m} />,
    );
    expect(fireEvent.contextMenu(zelle('Polizei'), { button: 2 })).toBe(false);
    const liste = await waitFor(() => offenesMenue()!);
    expect(liste).toHaveAttribute('aria-label', 'Aktionen zu Polizei Süd');
    expect(
      within(liste)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Bearbeiten', 'Deaktivieren']);
    expect(liste.querySelectorAll('.ant-dropdown-menu-item-divider')).toHaveLength(1);
    await userEvent.click(within(liste).getByRole('menuitem', { name: 'Bearbeiten' }));
    expect(m.onWahl).toHaveBeenCalledWith('bearbeiten', ZEILEN[1]);
  });

  it('läuft eine Aktion der Zeile, stehen alle Einträge gesperrt', async () => {
    renderMitProviders(
      <KatalogTabelle<Stelle>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZEILEN}
        zeilenMenue={menue({ laeuft: (s) => s.id === 1 })}
      />,
    );
    fireEvent.contextMenu(zelle('Leitstelle'), { button: 2 });
    const liste = await waitFor(() => offenesMenue()!);
    for (const eintrag of within(liste).getAllByRole('menuitem')) {
      expect(eintrag).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('ohne `zeilenMenue` bleibt das Browsermenü', () => {
    renderMitProviders(
      <KatalogTabelle<Stelle> rowKey="id" columns={SPALTEN} dataSource={ZEILEN} />,
    );
    expect(fireEvent.contextMenu(zelle('Polizei'), { button: 2 })).toBe(true);
    expect(kontextAnker()).toBeNull();
  });

  it('eine Zeile ohne Einträge behält das Browsermenü', () => {
    renderMitProviders(
      <KatalogTabelle<Stelle>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZEILEN}
        zeilenMenue={menue({ eintraege: (s) => (s.id === 1 ? [] : [{ key: 'a', label: 'A' }]) })}
      />,
    );
    expect(fireEvent.contextMenu(zelle('Leitstelle'), { button: 2 })).toBe(true);
    expect(kontextAnker()).toBeNull();
  });

  it('ein `onRow` des Aufrufers wirkt neben dem Kontextmenü weiter (3.3)', async () => {
    const onClick = vi.fn();
    const onContextMenuDesAufrufers = vi.fn();
    renderMitProviders(
      <KatalogTabelle<Stelle>
        rowKey={(s) => `s-${s.id}`}
        columns={SPALTEN}
        dataSource={ZEILEN}
        zeilenMenue={menue()}
        onRow={(s) => ({
          onClick: () => onClick(s),
          onContextMenu: onContextMenuDesAufrufers,
        })}
      />,
    );
    await userEvent.click(zelle('Leitstelle'));
    expect(onClick).toHaveBeenCalledWith(ZEILEN[0]);
    fireEvent.contextMenu(zelle('Polizei'), { button: 2 });
    // `rowKey` als Funktion findet die Zeile.
    const liste = await waitFor(() => offenesMenue()!);
    expect(liste).toHaveAttribute('aria-label', 'Aktionen zu Polizei Süd');
    expect(onContextMenuDesAufrufers).toHaveBeenCalledTimes(1);
  });

  it('verschwindet die Zeile aus den Daten, schließt das Menü', async () => {
    const { rerender } = renderMitProviders(
      <KatalogTabelle<Stelle>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZEILEN}
        zeilenMenue={menue()}
      />,
    );
    fireEvent.contextMenu(zelle('Polizei'), { button: 2 });
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    rerender(
      <KatalogTabelle<Stelle>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZEILEN.slice(0, 1)}
        zeilenMenue={menue()}
      />,
    );
    await waitFor(() => expect(kontextAnker()).toBeNull());
  });
});
