import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { ApiError } from '../api/client';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import Datensicht, { spaltenFuer, type Kartenplan } from './Datensicht';
import type { ZeilenGrund } from './useZeilenFehler';

/**
 * Zeilenfehler der Datensicht (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): der Grund
 * einer abgelehnten Zeilenaktion steht an genau dieser Zeile, in Tabelle UND Karte. Die Zeilen
 * rendern gemerkt (LFH-949); ein neuer Grund bei unverändertem Datensatz muss trotzdem erscheinen
 * und wieder verschwinden, ohne dass die übrigen Zeilen neu zeichnen.
 */

function renderMitProviders(ui: ReactElement) {
  const ergebnis = renderMitBasisProviders(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);
  return {
    ...ergebnis,
    rerender: (naechstes: ReactElement) =>
      ergebnis.rerender(<CommandPaletteProvider>{naechstes}</CommandPaletteProvider>),
  };
}

interface Person {
  id: number;
  name: string;
}

const personen: Person[] = [
  { id: 1, name: 'Anna' },
  { id: 2, name: 'Bert' },
  { id: 3, name: 'Cora' },
];

const gezeichnet = vi.fn<(id: number) => void>();
const spalten = spaltenFuer<Person>()([
  {
    key: 'name',
    title: 'Name',
    dataIndex: 'name',
    immerSichtbar: true,
    render: (_wert: unknown, p: Person) => {
      gezeichnet(p.id);
      return p.name;
    },
  },
]);
type SpaltenKey = (typeof spalten)[number]['key'];
const karte: Kartenplan<Person, SpaltenKey> = { art: 'plan', titel: { spalte: 'name' } };

function Sicht({
  form,
  gruende,
}: {
  form: 'tabelle' | 'karte';
  gruende?: ReadonlyMap<number, ZeilenGrund>;
}) {
  return (
    <Datensicht<Person, SpaltenKey>
      bezeichnung="Personen"
      spalten={spalten}
      daten={personen}
      zeilenSchluessel="id"
      karte={karte}
      form={form}
      zeilenFehler={gruende ? (p) => gruende.get(p.id) ?? null : undefined}
    />
  );
}

const abgelehnt: ZeilenGrund = { fehler: new ApiError(409, 'Status abgelehnt') };

describe.each(['tabelle', 'karte'] as const)('Datensicht-Zeilenfehler (%s, LFH-1077)', (form) => {
  beforeEach(() => {
    setzeViewportBreite(form === 'tabelle' ? 1440 : 390);
    gezeichnet.mockClear();
  });

  /** Die Zeile bzw. Karte, die den Namen trägt. */
  const zeileVon = (name: string): HTMLElement => {
    const text = screen.getByText(name);
    const zeile =
      form === 'tabelle'
        ? text.closest<HTMLElement>('tr[data-row-key]')
        : text.closest<HTMLElement>('[data-lfh="datensicht-karte"]');
    if (!zeile) throw new Error(`Zeile zu ${name} fehlt`);
    return zeile;
  };

  it('zeigt den Grund an genau der Zeile, die übrigen zeigen nichts', () => {
    renderMitProviders(<Sicht form={form} gruende={new Map([[2, abgelehnt]])} />);
    const fehler = within(zeileVon('Bert')).getByRole('alert');
    expect(fehler).toHaveTextContent('Status abgelehnt');
    expect(fehler).toHaveAttribute('data-fehler', 'true');
    expect(within(zeileVon('Anna')).queryByRole('alert')).toBeNull();
    expect(within(zeileVon('Cora')).queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);
  });

  it('ein neuer und ein geräumter Grund erscheinen trotz gemerkter Zeilen, nur die betroffene zeichnet', () => {
    const { rerender } = renderMitProviders(<Sicht form={form} gruende={new Map()} />);
    expect(screen.queryByRole('alert')).toBeNull();
    gezeichnet.mockClear();

    rerender(<Sicht form={form} gruende={new Map([[3, abgelehnt]])} />);
    expect(within(zeileVon('Cora')).getByRole('alert')).toHaveTextContent('Status abgelehnt');
    expect(new Set(gezeichnet.mock.calls.map(([id]) => id))).toEqual(new Set([3]));

    // Derselbe Grund in einer neuen Map: nichts zeichnet neu.
    gezeichnet.mockClear();
    rerender(<Sicht form={form} gruende={new Map([[3, abgelehnt]])} />);
    expect(gezeichnet).not.toHaveBeenCalled();

    // Geräumt (nächstes Absenden): der Grund ist weg.
    rerender(<Sicht form={form} gruende={new Map()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ein Fehler ohne Servermeldung nimmt den Rückfalltext der Zeilenaktion', () => {
    renderMitProviders(
      <Sicht
        form={form}
        gruende={
          new Map([[1, { fehler: new Error('kaputt'), fallback: 'Entfernen fehlgeschlagen' }]])
        }
      />,
    );
    expect(within(zeileVon('Anna')).getByRole('alert')).toHaveTextContent(
      'Entfernen fehlgeschlagen',
    );
  });

  it('ohne `zeilenFehler` steht nichts da', () => {
    renderMitProviders(<Sicht form={form} />);
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
  });
});

describe('Datensicht-Zeilenfehler in der Tabelle (LFH-1077)', () => {
  beforeEach(() => setzeViewportBreite(1440));

  it('der Grund trägt nichts zur Breite der Kennungsspalte bei', () => {
    /**
     * Die Tabelle legt die Spalten automatisch aus: ein langer Grund verbreiterte die erste Spalte
     * und schöbe alle übrigen. jsdom rechnet kein Layout; geprüft wird die Hülle, die das verhindert.
     */
    renderMitProviders(<Sicht form="tabelle" gruende={new Map([[2, abgelehnt]])} />);
    const huelle = screen.getByRole('alert').parentElement!;
    expect(huelle.style.width).toBe('0px');
    expect(huelle.style.minWidth).toBe('100%');
  });

  it('eine erste Spalte mit eigenem `shouldCellUpdate` übernimmt einen neuen Grund', () => {
    const eigene = spaltenFuer<Person>()([
      {
        key: 'name',
        title: 'Name',
        dataIndex: 'name',
        immerSichtbar: true,
        shouldCellUpdate: (zeile, vorher) => zeile !== vorher,
      },
    ]);
    const zeige = (gruende: ReadonlyMap<number, ZeilenGrund>) => (
      <Datensicht<Person, SpaltenKey>
        bezeichnung="Personen"
        spalten={eigene}
        daten={personen}
        zeilenSchluessel="id"
        karte={karte}
        form="tabelle"
        zeilenFehler={(p) => gruende.get(p.id) ?? null}
      />
    );
    const { rerender } = renderMitProviders(zeige(new Map()));
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(zeige(new Map([[1, abgelehnt]])));
    expect(screen.getByRole('alert')).toHaveTextContent('Status abgelehnt');

    rerender(zeige(new Map()));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe.each(['tabelle', 'karte'] as const)(
  'Datensicht-Zeilenfehler hinter Suche und Filter (%s, LFH-1077)',
  (form) => {
    beforeEach(() => setzeViewportBreite(form === 'tabelle' ? 1440 : 390));

    interface Mitglied {
      id: number;
      name: string;
      gruppe: 'A' | 'B';
    }
    const mitglieder: Mitglied[] = [
      { id: 1, name: 'Anna', gruppe: 'A' },
      { id: 2, name: 'Bert', gruppe: 'B' },
      { id: 3, name: 'Cora', gruppe: 'B' },
    ];
    const mitgliederSpalten = spaltenFuer<Mitglied>()([
      {
        key: 'name',
        title: 'Name',
        dataIndex: 'name',
        immerSichtbar: true,
        suchText: (m) => m.name,
      },
      {
        key: 'gruppe',
        title: 'Gruppe',
        dataIndex: 'gruppe',
        filter: {
          werte: [
            { text: 'Gruppe A', value: 'A' },
            { text: 'Gruppe B', value: 'B' },
          ],
          trifft: (m, wert) => m.gruppe === wert,
        },
      },
    ]);
    type MitgliedKey = (typeof mitgliederSpalten)[number]['key'];

    const rendere = (gruende: ReadonlyMap<number, ZeilenGrund>) =>
      renderMitProviders(
        <Datensicht<Mitglied, MitgliedKey>
          bezeichnung="Mitglieder"
          spalten={mitgliederSpalten}
          daten={mitglieder}
          zeilenSchluessel="id"
          karte={{ art: 'plan', titel: { spalte: 'name' } }}
          form={form}
          suche={{ platzhalter: 'Name' }}
          zeilenFehler={(m) => gruende.get(m.id) ?? null}
        />,
      );
    const verdeckt = () => document.querySelector('[data-lfh="datensicht-verdeckte-fehler"]');

    it('die Suche blendet die Zeile aus: der Grund steht mit Kennung über der Liste', () => {
      rendere(new Map([[2, abgelehnt]]));
      expect(verdeckt()).toBeNull();
      const suche = screen.getByRole('searchbox', { name: 'Suche in Mitglieder' });

      fireEvent.change(suche, { target: { value: 'Anna' } });
      const block = verdeckt() as HTMLElement | null;
      expect(block).not.toBeNull();
      // Kennung und Grund in EINER Meldung: vorgelesen wird, welche Zeile abgelehnt wurde.
      expect(within(block!).getByRole('alert')).toHaveTextContent('Bert · Status abgelehnt');
      // Genau einmal: die verborgene Zeile zeigt ihn nicht zusätzlich.
      expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);

      // Wieder sichtbar: der Grund steht an der Zeile, der Block ist weg.
      fireEvent.change(suche, { target: { value: '' } });
      expect(verdeckt()).toBeNull();
      expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);
    });

    it('ein Spaltenfilter blendet die Zeile aus: der Grund steht über der Liste', async () => {
      rendere(new Map([[1, abgelehnt]]));
      await userEvent.click(screen.getByRole('combobox', { name: 'Gruppe' }));
      await userEvent.click(await screen.findByTitle('Gruppe B'));
      const block = verdeckt() as HTMLElement | null;
      expect(block).not.toBeNull();
      expect(within(block!).getByRole('alert')).toHaveTextContent('Anna · Status abgelehnt');
    });
  },
);
