import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import Datensicht, { HERVORGEHOBEN, spaltenFuer, type Kartenplan } from './Datensicht';
import { STUECK_ZEILEN, setzeStueckweise } from './stueckweise';

/**
 * Stückweises Rendern beim ersten Anzeigen (LLH-1974): die erste Zeichnung trägt
 * {@link STUECK_ZEILEN} Zeilen, die übrigen folgen in eigenen Aufgaben.
 */
interface Person {
  id: number;
  name: string;
}
const viele = (n: number, ab = 0): Person[] =>
  Array.from({ length: n }, (_, i) => ({ id: ab + i, name: `Person ${ab + i}` }));

const spalten = spaltenFuer<Person>()([
  { key: 'name', title: 'Name', dataIndex: 'name', immerSichtbar: true, suchText: (p) => p.name },
]);
type SpaltenKey = (typeof spalten)[number]['key'];
const karte: Kartenplan<Person, SpaltenKey> = { art: 'plan', titel: { spalte: 'name' } };

function Sicht(props: { daten: readonly Person[]; hervorgehoben?: number; form?: 'karte' }) {
  return (
    <CommandPaletteProvider>
      <Datensicht<Person, SpaltenKey>
        bezeichnung="Personen"
        spalten={spalten}
        daten={props.daten}
        zeilenSchluessel="id"
        karte={karte}
        form={props.form ?? 'tabelle'}
        zeilenKlasse={(p) => (p.id === props.hervorgehoben ? HERVORGEHOBEN : undefined)}
      />
    </CommandPaletteProvider>
  );
}

const zeilen = () => document.querySelectorAll('tbody tr[data-row-key]');
const karten = () => document.querySelectorAll('[data-lfh="datensicht-karte"]');

describe('Datensicht rendert beim ersten Anzeigen stückweise (LLH-1974)', () => {
  beforeEach(() => {
    setzeStueckweise(true);
    setzeViewportBreite(1440);
  });
  afterEach(() => setzeStueckweise(false));

  it('rendert beim ersten Anzeigen 4 Zeilen und dann alle', async () => {
    renderMitProviders(<Sicht daten={viele(10)} />);
    expect(zeilen()).toHaveLength(STUECK_ZEILEN);
    await waitFor(() => expect(zeilen()).toHaveLength(10));
  });

  it('rendert die Karten beim ersten Anzeigen ebenso stückweise', async () => {
    setzeViewportBreite(390);
    renderMitProviders(<Sicht daten={viele(10)} form="karte" />);
    expect(karten()).toHaveLength(STUECK_ZEILEN);
    await waitFor(() => expect(karten()).toHaveLength(10));
  });

  it('rendert sofort alle, wenn eine Zeile hervorgehoben ist', () => {
    renderMitProviders(<Sicht daten={viele(10)} hervorgehoben={9} />);
    expect(zeilen()).toHaveLength(10);
  });

  it('rendert im Druck sofort alle', () => {
    renderMitProviders(<Sicht daten={viele(10)} />);
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(zeilen()).toHaveLength(10);
  });

  it('zeigt nach einer späteren Änderung sofort alle Zeilen', async () => {
    const { rerender } = renderMitProviders(<Sicht daten={viele(10)} />);
    await waitFor(() => expect(zeilen()).toHaveLength(10));
    rerender(<Sicht daten={viele(12, 100)} />);
    expect(zeilen()).toHaveLength(12);
  });
});
