import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import Datensicht, {
  SERVER_SUCHE_ENTPRELLUNG_MS,
  spaltenFuer,
  type Kartenplan,
} from './Datensicht';
import type { ListenGedaechtnis } from './listenGedaechtnis';

/**
 * Sortieren und Filtern im Spaltenkopf (LLH-1086, Spec `tabellen-sortieren-filtern`): der Filter
 * sitzt im Kopf der Spalte, aktive Filter stehen als Chips über der Tabelle, eine eingeschränkte
 * Liste zeigt den `Filterhinweis`. Der Kartenzweig zeigt dieselbe Menge und eine Sortierauswahl.
 */

function renderMitProviders(ui: ReactElement) {
  const e = renderMitBasisProviders(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);
  return {
    ...e,
    rerender: (n: ReactElement) => e.rerender(<CommandPaletteProvider>{n}</CommandPaletteProvider>),
  };
}

interface Schaden {
  id: number;
  ort: string;
  ausmass: 'gering' | 'gross';
  typ: 'sturm' | 'wasser';
}
const S = (id: number, ort: string, ausmass: Schaden['ausmass'], typ: Schaden['typ']): Schaden => ({
  id,
  ort,
  ausmass,
  typ,
});
const DATEN = [
  S(1, 'Deich', 'gross', 'wasser'),
  S(2, 'Ufer', 'gering', 'wasser'),
  S(3, 'Wald', 'gross', 'sturm'),
];

const spalten = spaltenFuer<Schaden>()([
  {
    key: 'ort',
    title: 'Ort',
    dataIndex: 'ort',
    immerSichtbar: true,
    sortWert: (s) => s.ort,
    suchText: (s) => s.ort,
  },
  {
    key: 'ausmass',
    title: 'Ausmaß',
    dataIndex: 'ausmass',
    sortWert: (s) => (s.ausmass === 'gering' ? 0 : 1),
    filter: {
      werte: [
        { text: 'Gering', value: 'gering' },
        { text: 'Groß', value: 'gross' },
      ],
      trifft: (s, w) => s.ausmass === w,
    },
  },
  {
    key: 'typ',
    title: 'Typ',
    dataIndex: 'typ',
    filter: {
      werte: [
        { text: 'Sturm', value: 'sturm' },
        { text: 'Wasser', value: 'wasser' },
      ],
      trifft: (s, w) => s.typ === w,
    },
  },
]);
type Key = (typeof spalten)[number]['key'];
const karte: Kartenplan<Schaden, Key> = {
  art: 'plan',
  titel: { spalte: 'ort' },
  sekundaer: ['ausmass'],
};

function rendere(props: Partial<Parameters<typeof Datensicht<Schaden, Key>>[0]> = {}) {
  return renderMitProviders(
    <Datensicht<Schaden, Key>
      bezeichnung="Schäden"
      spalten={spalten}
      daten={DATEN}
      zeilenSchluessel="id"
      karte={karte}
      suche={{ platzhalter: 'Ort' }}
      mehrzahl="Schäden"
      {...props}
    />,
  );
}

const zeilen = () =>
  [...document.querySelectorAll('tbody tr[data-row-key]')].map((z) =>
    z.getAttribute('data-row-key'),
  );
const karten = () =>
  [...document.querySelectorAll('[data-lfh="datensicht-karte"]')].map((k) => k.textContent);
const hinweis = () => document.querySelector<HTMLElement>('[data-lfh="filterhinweis"]');

describe('Datensicht · Filter im Spaltenkopf (LLH-1086)', () => {
  it('der Filter sitzt im Kopf, nicht mehr als Auswahlfeld über der Tabelle', () => {
    setzeViewportBreite(1366);
    rendere();
    expect(screen.queryByRole('combobox', { name: 'Ausmaß' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ausmaß filtern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Typ filtern' })).toBeInTheDocument();
  });

  it('das Menü zählt je Wert über die übrigen Einschränkungen', async () => {
    setzeViewportBreite(1366);
    rendere();
    expect(await kopfFilterWerte('Ausmaß')).toEqual(['Gering (1)', 'Groß (2)']);
  });

  it('ein gewählter Wert filtert, steht als Chip da und im Filterhinweis mit Zahl', async () => {
    setzeViewportBreite(1366);
    rendere();
    await kopfFilterWaehlen('Ausmaß', ['Groß (2)']);
    await waitFor(() => expect(zeilen()).toEqual(['1', '3']));

    const chips = screen.getByRole('group', { name: 'Aktive Filter' });
    expect(
      within(chips).getByRole('button', { name: 'Filter Ausmaß: Groß entfernen' }),
    ).toHaveTextContent('Ausmaß: Groß');
    expect(hinweis()).toHaveTextContent('Gefiltert');
    expect(hinweis()).toHaveTextContent('2 von 3 Schäden sichtbar');
    expect(hinweis()).toHaveTextContent('Ausmaß: Groß');
    expect(screen.getByRole('button', { name: 'Ausmaß filtern, gefiltert' })).toBeInTheDocument();
  });

  it('die gefilterte Kopfzelle trägt die Linie in Bedienfarbe', async () => {
    setzeViewportBreite(1366);
    rendere();
    const kopf = () => screen.getByRole('button', { name: /^Typ filtern/ }).closest('th')!;
    expect(kopf().style.boxShadow).toBe('');
    await kopfFilterWaehlen('Typ', ['Sturm (1)']);
    await waitFor(() => expect(kopf().style.boxShadow).toMatch(/inset 0 -2px 0/));
  });

  it('der Chip nimmt genau seinen Wert heraus', async () => {
    setzeViewportBreite(1366);
    rendere();
    await kopfFilterWaehlen('Typ', ['Sturm (1)', 'Wasser (2)']);
    await waitFor(() => expect(zeilen()).toEqual(['1', '2', '3']));
    await userEvent.click(screen.getByRole('button', { name: 'Filter Typ: Sturm entfernen' }));
    await waitFor(() => expect(zeilen()).toEqual(['1', '2']));
    expect(screen.queryByRole('button', { name: 'Filter Typ: Sturm entfernen' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Filter Typ: Wasser entfernen' }),
    ).toBeInTheDocument();
  });

  it('„Filter zurücksetzen“ leert Suche und alle Filter, die Sortierung bleibt', async () => {
    setzeViewportBreite(1366);
    rendere({ standardSortierung: { spalte: 'ort', richtung: 'ab' } });
    await kopfFilterWaehlen('Typ', ['Wasser (2)']);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Suche in Schäden' }), 'e');
    await waitFor(() => expect(zeilen()).toEqual(['2', '1']));
    expect(hinweis()).toHaveTextContent('„e“');

    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(zeilen()).toEqual(['3', '2', '1']);
    expect(screen.getByRole('searchbox', { name: 'Suche in Schäden' })).toHaveValue('');
    expect(screen.queryByRole('group', { name: 'Aktive Filter' })).toBeNull();
    expect(hinweis()).toBeNull();
  });

  it('ohne Einschränkung steht weder Chipleiste noch Filterhinweis', () => {
    setzeViewportBreite(1366);
    rendere();
    expect(screen.queryByRole('group', { name: 'Aktive Filter' })).toBeNull();
    expect(hinweis()).toBeNull();
  });
});

describe('Datensicht · offenes Filtermenü behält seinen Entwurf (LLH-1427)', () => {
  /**
   * antds FilterDropdown setzt bei offenem Menü den Entwurf auf `filteredKeys` zurück, sobald es
   * eine neue Spaltenliste bekommt (es bildet `filteredValue` dabei jedes Mal neu ab). Die Sicht
   * baut ihre Spalten bei jedem Render neu: Live-Daten oder das Schreiben der Adresse verwarfen so
   * die frisch angehakten Werte einer schon gefilterten Spalte.
   */
  const element = (daten: Schaden[]) => (
    <Datensicht<Schaden, Key>
      bezeichnung="Schäden"
      spalten={spalten}
      daten={daten}
      zeilenSchluessel="id"
      karte={karte}
      mehrzahl="Schäden"
    />
  );

  it('ein Neuaufbau mit gleichen Daten lässt die Häkchen stehen', async () => {
    setzeViewportBreite(1366);
    const { rerender } = renderMitProviders(element(DATEN));
    await kopfFilterWaehlen('Ausmaß', ['Groß (2)']);
    await waitFor(() => expect(zeilen()).toEqual(['1', '3']));

    const menue = await openKopfFilter('Ausmaß');
    await userEvent.click(within(menue).getByText('Gering (1)'));
    expect(angehakteWerte(menue)).toEqual(['Gering (1)', 'Groß (2)']);

    rerender(element([...DATEN]));
    expect(angehakteWerte(menue)).toEqual(['Gering (1)', 'Groß (2)']);
  });

  it('neue Daten mit neuen Zählern lassen die Häkchen stehen, Bestätigen wirkt beide', async () => {
    setzeViewportBreite(1366);
    const { rerender } = renderMitProviders(element(DATEN));
    await kopfFilterWaehlen('Ausmaß', ['Groß (2)']);
    await waitFor(() => expect(zeilen()).toEqual(['1', '3']));

    const menue = await openKopfFilter('Ausmaß');
    await userEvent.click(within(menue).getByText('Gering (1)'));

    rerender(element([...DATEN, S(4, 'Hafen', 'gering', 'sturm')]));
    expect(angehakteWerte(menue)).toHaveLength(2);

    await userEvent.click(
      menue.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    await waitFor(() => expect(zeilen()).toEqual(['1', '2', '3', '4']));
    // Geschlossen zählt das Menü wieder den neuen Stand.
    expect(await kopfFilterWerte('Ausmaß')).toEqual(['Gering (2)', 'Groß (2)']);
  });

  it('nach dem Schließen zeichnen die Zellen eine Garnitur, die bei offenem Menü kam', async () => {
    // Die Tabelle hält ihre Spalten, solange das Menü offen ist: die neue Garnitur kommt erst beim
    // Schließen an. Der zweite Neuaufbau zeigt keinen Garniturwechsel mehr; ohne das einmalige
    // Neuzeichnen beim Loslassen bliebe die Zelle beim alten `render`.
    setzeViewportBreite(1366);
    const mitEinheit = (einheit: string) =>
      spalten.map((s) =>
        s.key === 'ort' ? { ...s, render: (_: unknown, z: Schaden) => `${z.ort} ${einheit}` } : s,
      );
    const mit = (garnitur: typeof spalten) => (
      <Datensicht<Schaden, Key>
        bezeichnung="Schäden"
        spalten={garnitur}
        daten={DATEN}
        zeilenSchluessel="id"
        karte={karte}
        mehrzahl="Schäden"
      />
    );
    const ortZelle = () => document.querySelector('tbody tr[data-row-key="1"] td')!.textContent;
    const { rerender } = renderMitProviders(mit(mitEinheit('alt')));
    expect(ortZelle()).toBe('Deich alt');

    const menue = await openKopfFilter('Ausmaß');
    const neu = mitEinheit('neu');
    rerender(mit(neu));
    rerender(mit(neu));
    expect(ortZelle()).toBe('Deich alt');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(menue.closest('.ant-dropdown')).toHaveStyle({ pointerEvents: 'none' }),
    );
    await waitFor(() => expect(ortZelle()).toBe('Deich neu'));
  });
});

describe('Datensicht · Kartenzweig (LLH-1086)', () => {
  it('dieselbe Menge, eine Sortierauswahl und die Chips', async () => {
    setzeViewportBreite(390);
    rendere();
    const sortieren = screen.getByRole('combobox', { name: 'Sortieren' });
    await userEvent.click(sortieren);
    await userEvent.click(await screen.findByTitle('Ort, absteigend'));
    await waitFor(() =>
      expect(karten().map((t) => t?.slice(0, 4))).toEqual(['Wald', 'Ufer', 'Deic']),
    );

    await userEvent.click(screen.getByRole('combobox', { name: 'Ausmaß' }));
    await userEvent.click(await screen.findByTitle('Gering'));
    await waitFor(() => expect(karten()).toHaveLength(1));
    expect(
      screen.getByRole('button', { name: 'Filter Ausmaß: Gering entfernen' }),
    ).toBeInTheDocument();
    expect(hinweis()).toHaveTextContent('1 von 3 Schäden sichtbar');
  });

  it('ein Filter mit `ohneKartenfeld` hat kein Auswahlfeld, wirkt aber und steht als Chip da (LLH-1096)', () => {
    setzeViewportBreite(390);
    const ohneFeld = spalten.map((s) =>
      s.key === 'typ' && s.filter ? { ...s, filter: { ...s.filter, ohneKartenfeld: true } } : s,
    );
    rendere({
      spalten: ohneFeld,
      gedaechtnis: {
        start: { sortierung: null, filter: { typ: ['sturm'] }, suche: '' },
        spaltenStart: null,
        melde: vi.fn(),
        meldeSpalten: vi.fn(),
      },
    });
    expect(screen.queryByRole('combobox', { name: 'Typ' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Ausmaß' })).toBeInTheDocument();
    expect(karten()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Filter Typ: Sturm entfernen' })).toBeInTheDocument();
  });
});

describe('Datensicht · Gedächtnis (LLH-1086)', () => {
  const gedaechtnis = (over: Partial<ListenGedaechtnis<Key>> = {}): ListenGedaechtnis<Key> => ({
    start: { sortierung: null, filter: {}, suche: '' },
    spaltenStart: { aus: [], an: [] },
    melde: vi.fn(),
    meldeSpalten: vi.fn(),
    ...over,
  });

  it('beginnt mit dem gemerkten Stand: Sortierung, Filter, Suche und Spaltenwahl', () => {
    setzeViewportBreite(1366);
    rendere({
      gedaechtnis: gedaechtnis({
        start: {
          sortierung: { spalte: 'ort', richtung: 'ab' },
          filter: { typ: ['wasser'] },
          suche: 'u',
        },
        spaltenStart: { aus: ['ausmass'], an: [] },
      }),
    });
    expect(zeilen()).toEqual(['2']);
    expect(screen.getByRole('searchbox', { name: 'Suche in Schäden' })).toHaveValue('u');
    expect(
      screen.getByRole('button', { name: 'Filter Typ: Wasser entfernen' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ausmaß filtern/ })).toBeNull();
  });

  it('meldet jede Änderung entprellt, nicht schon den Anfangsstand', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setzeViewportBreite(1366);
      const g = gedaechtnis();
      rendere({ gedaechtnis: g });
      act(() => vi.advanceTimersByTime(SERVER_SUCHE_ENTPRELLUNG_MS));
      expect(g.melde).not.toHaveBeenCalled();

      await kopfFilterWaehlen('Typ', ['Sturm (1)']);
      act(() => vi.advanceTimersByTime(SERVER_SUCHE_ENTPRELLUNG_MS));
      expect(g.melde).toHaveBeenLastCalledWith({
        sortierung: null,
        filter: { typ: ['sturm'] },
        suche: '',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ohne gemerkte Spaltenwahl gilt die Voreinstellung der Seite (LLH-1096)', () => {
    setzeViewportBreite(1366);
    rendere({
      gedaechtnis: gedaechtnis({ spaltenStart: null }),
      spaltenAusVoreinstellung: ['typ'],
    });
    expect(screen.queryByRole('button', { name: /^Typ filtern/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ })).toBeInTheDocument();
  });

  it('meldet die Spaltenwahl ans Gerät', async () => {
    setzeViewportBreite(1366);
    const g = gedaechtnis();
    rendere({ gedaechtnis: g });
    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Typ' }));
    expect(g.meldeSpalten).toHaveBeenLastCalledWith({ aus: ['typ'], an: [] });
  });
});
