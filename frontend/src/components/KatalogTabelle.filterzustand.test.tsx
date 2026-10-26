import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import {
  angehakteWerte,
  kopfFilterWaehlen,
  kopfFilterWerte,
  openKopfFilter,
} from '../test/kopfFilter';
import KatalogTabelle, { type KatalogSpalte } from './KatalogTabelle';
import { GEDAECHTNIS_ENTPRELLUNG_MS, type ListenGedaechtnis } from './listenGedaechtnis';

/**
 * `KatalogTabelle` übernimmt das Bedienmuster der `Datensicht` (LLH-1086, Spec
 * `tabellen-sortieren-filtern`): Filter- und Sortierzustand liegen kontrolliert im Primitiv, aktive
 * Filter stehen als Chips, eine eingeschränkte Tabelle zeigt den `Filterhinweis`, und mit
 * `gedaechtnis` beginnt sie beim gemerkten Stand.
 */
function renderMitProviders(ui: ReactElement) {
  return renderMitBasisProviders(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);
}

interface Quelle {
  id: number;
  name: string;
  aktiv: boolean;
}
const ZEILEN: Quelle[] = [
  { id: 1, name: 'Basemap', aktiv: true },
  { id: 2, name: 'OSM', aktiv: false },
  { id: 3, name: 'Topo', aktiv: true },
];
const spalten = (): KatalogSpalte<Quelle>[] => [
  {
    title: 'Name',
    dataIndex: 'name',
    key: 'name',
    sorter: (a, b) => a.name.localeCompare(b.name),
  },
  {
    title: 'Aktiv',
    key: 'aktiv',
    render: (_, q) => (q.aktiv ? 'ja' : 'nein'),
    filters: [
      { text: 'aktiv', value: 'ja' },
      { text: 'inaktiv', value: 'nein' },
    ],
    onFilter: (w, q) => q.aktiv === (w === 'ja'),
  },
];

const namen = () =>
  [...document.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);
const hinweis = () => document.querySelector<HTMLElement>('[data-lfh="filterhinweis"]');

describe('KatalogTabelle · Filterzustand (LLH-1086)', () => {
  it('ein Kopffilter steht als Chip da, der Filterhinweis zählt', async () => {
    setzeViewportBreite(1366);
    renderMitProviders(
      <KatalogTabelle<Quelle>
        rowKey="id"
        columns={spalten()}
        dataSource={ZEILEN}
        mehrzahl="Quellen"
      />,
    );
    expect(hinweis()).toBeNull();
    await kopfFilterWaehlen('Aktiv', [/^inaktiv/]);
    await waitFor(() => expect(namen()).toEqual(['OSM']));
    expect(
      screen.getByRole('button', { name: 'Filter Aktiv: inaktiv entfernen' }),
    ).toBeInTheDocument();
    expect(hinweis()).toHaveTextContent('1 von 3 Quellen sichtbar');
    const kopf = screen.getByRole('button', { name: /^Aktiv filtern/ }).closest('th')!;
    expect(kopf.style.boxShadow).toMatch(/inset 0 -2px 0/);
  });

  it('der Chip nimmt den Wert heraus, „Filter zurücksetzen“ leert Suche und Filter', async () => {
    setzeViewportBreite(1366);
    renderMitProviders(
      <KatalogTabelle<Quelle>
        rowKey="id"
        columns={spalten()}
        dataSource={ZEILEN}
        suche={{ platzhalter: 'Name' }}
      />,
    );
    await kopfFilterWaehlen('Aktiv', [/^aktiv/]);
    await waitFor(() => expect(namen()).toEqual(['Basemap', 'Topo']));
    await userEvent.click(screen.getByRole('button', { name: 'Filter Aktiv: aktiv entfernen' }));
    await waitFor(() => expect(namen()).toEqual(['Basemap', 'OSM', 'Topo']));

    await kopfFilterWaehlen('Aktiv', [/^aktiv/]);
    await userEvent.type(screen.getByPlaceholderText('Name'), 'Top');
    await waitFor(() => expect(namen()).toEqual(['Topo']));
    expect(hinweis()).toHaveTextContent('„Top“');
    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    await waitFor(() => expect(namen()).toEqual(['Basemap', 'OSM', 'Topo']));
    expect(screen.getByPlaceholderText('Name')).toHaveValue('');
    expect(hinweis()).toBeNull();
  });

  it('das Kopfmenü zählt je Wert unter Suche und den übrigen Filtern (LLH-1096)', async () => {
    setzeViewportBreite(1366);
    renderMitProviders(
      <KatalogTabelle<Quelle>
        rowKey="id"
        columns={spalten()}
        dataSource={ZEILEN}
        suche={{ platzhalter: 'Name' }}
      />,
    );
    expect(await kopfFilterWerte('Aktiv')).toEqual(['aktiv (2)', 'inaktiv (1)']);
    await userEvent.keyboard('{Escape}');
    await userEvent.type(screen.getByPlaceholderText('Name'), 'O');
    await waitFor(() => expect(namen()).toEqual(['OSM', 'Topo']));
    expect(await kopfFilterWerte('Aktiv')).toEqual(['aktiv (1)', 'inaktiv (1)']);
  });

  it('ohne `onFilter` zählt das Kopfmenü nicht', async () => {
    setzeViewportBreite(1366);
    const ohne = spalten().map((s) => {
      if (s.key !== 'aktiv') return s;
      const { onFilter: _weg, ...rest } = s;
      void _weg;
      return rest;
    });
    renderMitProviders(<KatalogTabelle<Quelle> rowKey="id" columns={ohne} dataSource={ZEILEN} />);
    expect(await kopfFilterWerte('Aktiv')).toEqual(['aktiv', 'inaktiv']);
  });

  it('der Aufrufer bekommt onChange weiter', async () => {
    setzeViewportBreite(1366);
    const onChange = vi.fn();
    renderMitProviders(
      <KatalogTabelle<Quelle>
        rowKey="id"
        columns={spalten()}
        dataSource={ZEILEN}
        onChange={onChange}
      />,
    );
    await kopfFilterWaehlen('Aktiv', [/^inaktiv/]);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[1]).toMatchObject({ aktiv: ['nein'] });
  });

  it('ein selbst kontrollierter Filter bleibt beim Aufrufer: keine Chips, kein Hinweis', () => {
    setzeViewportBreite(1366);
    const eigene = spalten().map((s) =>
      s.key === 'aktiv' ? { ...s, filteredValue: ['nein'] } : s,
    );
    renderMitProviders(<KatalogTabelle<Quelle> rowKey="id" columns={eigene} dataSource={ZEILEN} />);
    expect(namen()).toEqual(['OSM']);
    expect(screen.queryByRole('group', { name: 'Aktive Filter' })).toBeNull();
    expect(hinweis()).toBeNull();
  });

  it('mit Gedächtnis: beginnt beim gemerkten Stand und meldet Änderungen entprellt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setzeViewportBreite(1366);
      const g: ListenGedaechtnis = {
        start: {
          sortierung: { spalte: 'name', richtung: 'ab' },
          filter: { aktiv: ['ja'] },
          suche: '',
        },
        spaltenStart: { aus: [], an: [] },
        melde: vi.fn(),
        meldeSpalten: vi.fn(),
      };
      renderMitProviders(
        <KatalogTabelle<Quelle>
          rowKey="id"
          columns={spalten()}
          dataSource={ZEILEN}
          gedaechtnis={g}
        />,
      );
      expect(namen()).toEqual(['Topo', 'Basemap']);
      act(() => vi.advanceTimersByTime(GEDAECHTNIS_ENTPRELLUNG_MS));
      expect(g.melde).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Filter Aktiv: aktiv entfernen' }));
      act(() => vi.advanceTimersByTime(GEDAECHTNIS_ENTPRELLUNG_MS));
      expect(g.melde).toHaveBeenLastCalledWith({
        sortierung: { spalte: 'name', richtung: 'ab' },
        filter: {},
        suche: '',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('KatalogTabelle · offenes Filtermenü behält seinen Entwurf (LLH-1427)', () => {
  // Die Zähler im Kopfmenü hängen an den Zeilen: jeder neue Datenstand baut die Spalten neu, und
  // antd setzte dabei den Entwurf eines offenen, schon gefilterten Menüs zurück.
  const element = (zeilen: Quelle[]) => (
    <CommandPaletteProvider>
      <KatalogTabelle<Quelle>
        rowKey="id"
        columns={spalten()}
        dataSource={zeilen}
        mehrzahl="Quellen"
      />
    </CommandPaletteProvider>
  );

  it('neue Zeilen lassen die Häkchen stehen, Bestätigen wirkt beide', async () => {
    setzeViewportBreite(1366);
    const { rerender } = renderMitBasisProviders(element(ZEILEN));
    await kopfFilterWaehlen('Aktiv', [/^aktiv/]);
    await waitFor(() => expect(namen()).toEqual(['Basemap', 'Topo']));

    const menue = await openKopfFilter('Aktiv');
    await userEvent.click(within(menue).getByText('inaktiv (1)'));
    expect(angehakteWerte(menue)).toEqual(['aktiv (2)', 'inaktiv (1)']);

    rerender(element([...ZEILEN, { id: 4, name: 'Luftbild', aktiv: false }]));
    expect(angehakteWerte(menue)).toHaveLength(2);

    await userEvent.click(
      menue.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    await waitFor(() => expect(namen()).toEqual(['Basemap', 'OSM', 'Topo', 'Luftbild']));
    expect(await kopfFilterWerte('Aktiv')).toEqual(['aktiv (2)', 'inaktiv (2)']);
  });

  it('ein neuer Filterstand des Aufrufers gilt auch bei offenem Menü', async () => {
    // Gehalten wird nur die Garnitur, nie ein überholter Filterstand: antd rechnete sonst beim
    // Bestätigen mit dem alten weiter.
    setzeViewportBreite(1366);
    const kontrolliert = (gewaehlt: string[] | null) => (
      <CommandPaletteProvider>
        <KatalogTabelle<Quelle>
          rowKey="id"
          columns={spalten().map((s) =>
            s.key === 'aktiv' ? { ...s, filteredValue: gewaehlt } : s,
          )}
          dataSource={ZEILEN}
          mehrzahl="Quellen"
        />
      </CommandPaletteProvider>
    );
    const { rerender } = renderMitBasisProviders(kontrolliert(['ja']));
    const menue = await openKopfFilter('Aktiv');
    expect(angehakteWerte(menue)).toEqual(['aktiv']);

    rerender(kontrolliert(['nein']));
    await waitFor(() => expect(angehakteWerte(menue)).toEqual(['inaktiv']));
  });
});
