import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import Datensicht, {
  DATENSICHT_SCHWELLE,
  SERVER_SUCHE_ENTPRELLUNG_MS,
  spaltenFuer,
  type Kartenplan,
  type ServerSicht,
} from './Datensicht';

/**
 * Servermodus (LFH-1075): Suche, Spaltenfilter und Sortierung wirken am Server. `Datensicht` meldet
 * die Werte und zeigt `daten` so, wie sie kommen, ohne zweite Filterung und Sortierung im Client.
 */

function renderMitProviders(ui: ReactElement) {
  const ergebnis = renderMitBasisProviders(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);
  return {
    ...ergebnis,
    rerender: (naechstes: ReactElement) =>
      ergebnis.rerender(<CommandPaletteProvider>{naechstes}</CommandPaletteProvider>),
  };
}

interface Schaden {
  id: number;
  ort: string;
  typ: string;
}

const S = (id: number, typ = 'sachschaden'): Schaden => ({ id, ort: `Ort ${id}`, typ });

const spalten = spaltenFuer<Schaden>()([
  {
    key: 'ort',
    title: 'Ort',
    dataIndex: 'ort',
    immerSichtbar: true,
    suchText: (s) => s.ort,
    sortWert: (s) => s.ort,
  },
  {
    key: 'typ',
    title: 'Typ',
    dataIndex: 'typ',
    filter: {
      werte: [
        { text: 'Sachschaden', value: 'sachschaden' },
        { text: 'Personenschaden', value: 'personenschaden' },
      ],
      trifft: (s, w) => s.typ === w,
    },
  },
]);
type SpaltenKey = (typeof spalten)[number]['key'];
const karte: Kartenplan<Schaden, SpaltenKey> = { art: 'plan', titel: { spalte: 'ort' } };

function Sicht(props: { daten: readonly Schaden[]; server: ServerSicht; leerText?: string }) {
  return (
    <Datensicht<Schaden, SpaltenKey>
      bezeichnung="Schäden"
      spalten={spalten}
      daten={props.daten}
      zeilenSchluessel="id"
      karte={karte}
      form="tabelle"
      suche={{ platzhalter: 'Suche' }}
      sortierung={{ spalte: 'ort', richtung: 'auf' }}
      leerText={props.leerText}
      serverseitig={props.server}
    />
  );
}

const server = (stand = 'a'): ServerSicht => ({ stand, onSuche: vi.fn(), onFilter: vi.fn() });
const zeilenTexte = () =>
  [...document.querySelectorAll('tbody tr[data-row-key]')].map((z) =>
    z.getAttribute('data-row-key'),
  );

afterEach(() => {
  vi.useRealTimers();
});

describe('Datensicht · Servermodus (LFH-1075)', () => {
  it('zeigt die Zeilen in der Folge des Servers, ohne sie zu sortieren oder zu filtern', () => {
    setzeViewportBreite(1366);
    // Nach Ort aufsteigend stünde 1 vor 3; der Server hat 3 zuerst geliefert.
    renderMitProviders(<Sicht daten={[S(3), S(1, 'personenschaden'), S(2)]} server={server()} />);
    expect(zeilenTexte()).toEqual(['3', '1', '2']);
  });

  it('meldet den Suchbegriff entprellt und filtert selbst nicht', () => {
    vi.useFakeTimers();
    setzeViewportBreite(1366);
    const s = server();
    renderMitProviders(<Sicht daten={[S(1), S(2)]} server={s} />);
    const feld = screen.getByRole('searchbox', { name: 'Suche in Schäden' });

    fireEvent.change(feld, { target: { value: 'De' } });
    fireEvent.change(feld, { target: { value: 'Deich ' } });
    expect(zeilenTexte()).toEqual(['1', '2']);
    expect(s.onSuche).not.toHaveBeenCalledWith('Deich');

    act(() => vi.advanceTimersByTime(SERVER_SUCHE_ENTPRELLUNG_MS));
    expect(s.onSuche).toHaveBeenLastCalledWith('Deich');
    expect(s.onSuche).not.toHaveBeenCalledWith('De');
    expect(zeilenTexte()).toEqual(['1', '2']);
  });

  it('meldet die Spaltenfilter und filtert selbst nicht', async () => {
    setzeViewportBreite(1366);
    const s = server();
    renderMitProviders(<Sicht daten={[S(1), S(2)]} server={s} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Typ' }));
    await userEvent.click(await screen.findByTitle('Personenschaden'));

    expect(s.onFilter).toHaveBeenLastCalledWith({ typ: ['personenschaden'] });
    expect(zeilenTexte()).toEqual(['1', '2']);
  });

  it('ohne Treffer bei aktiver Einschränkung steht der Filter-Leerzustand und setzt zurück', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setzeViewportBreite(1366);
    const s = server();
    const { rerender } = renderMitProviders(<Sicht daten={[S(1)]} server={s} leerText="Leer" />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nichts' } });
    act(() => vi.advanceTimersByTime(SERVER_SUCHE_ENTPRELLUNG_MS));
    rerender(<Sicht daten={[]} server={{ ...s, stand: 'b' }} leerText="Leer" />);

    expect(screen.getByText('Keine Treffer für die gewählten Filter')).toBeInTheDocument();
    expect(screen.queryByText('Leer')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    act(() => vi.advanceTimersByTime(SERVER_SUCHE_ENTPRELLUNG_MS));
    expect(s.onSuche).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('ohne Einschränkung bleibt der leerText des Moduls', () => {
    setzeViewportBreite(1366);
    renderMitProviders(<Sicht daten={[]} server={server()} leerText="Noch keine Schäden" />);
    expect(screen.getByText('Noch keine Schäden')).toBeInTheDocument();
  });

  it('eine neue Antwort des Servers ist kein Zufluss, eine Live-Zeile im selben Stand schon', () => {
    setzeViewportBreite(1366);
    const s = server('a');
    const { rerender } = renderMitProviders(<Sicht daten={[S(1), S(2)]} server={s} />);
    // Fokus in der Sicht friert die Folge ein.
    screen.getByRole('searchbox').focus();
    fireEvent.focus(screen.getByRole('searchbox'));

    rerender(<Sicht daten={[S(3), S(1), S(2)]} server={s} />);
    expect(zeilenTexte()).toEqual(['1', '2']);
    expect(screen.getByRole('button', { name: /1 neuer Eintrag/ })).toBeInTheDocument();

    rerender(<Sicht daten={[S(7), S(8)]} server={{ ...s, stand: 'b' }} />);
    expect(zeilenTexte()).toEqual(['7', '8']);
    expect(screen.queryByRole('button', { name: /neue[rn]? Eintr/ })).toBeNull();
  });

  it('große Mengen schneidet der Servermodus weiter auf den Sichtbereich', () => {
    setzeViewportBreite(1366);
    const viele = Array.from({ length: DATENSICHT_SCHWELLE + 50 }, (_, i) => S(i + 1));
    renderMitProviders(<Sicht daten={viele} server={server()} />);
    expect(zeilenTexte().length).toBeLessThan(viele.length);
  });
});
