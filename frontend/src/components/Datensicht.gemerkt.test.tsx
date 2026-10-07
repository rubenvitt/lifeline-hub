import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import Datensicht, { spaltenFuer, type Kartenplan } from './Datensicht';

/**
 * Gemerktes Rendern (LFH-949, D4/D5): ein Live-Ereignis mit EINER geänderten Zeile rendert nur
 * deren Zellen bzw. Karte. Neue Spalten oder ein neuer Kartenplan rendern alles neu, damit keine
 * Zelle mit veraltetem Außenzustand stehen bleibt. Gezählt wird über das `render` der Titelspalte.
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
  gruppe: string;
}

const P = (id: number): Person => ({ id, name: `Person ${id}`, gruppe: 'a' });
const zwanzig = Array.from({ length: 20 }, (_, i) => P(i));

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
  { key: 'gruppe', title: 'Gruppe', dataIndex: 'gruppe' },
]);
type SpaltenKey = (typeof spalten)[number]['key'];
const karte: Kartenplan<Person, SpaltenKey> = { art: 'plan', titel: { spalte: 'name' } };

function Sicht(props: {
  daten: readonly Person[];
  form: 'tabelle' | 'karte';
  spalten?: typeof spalten;
  karte?: Kartenplan<Person, SpaltenKey>;
}) {
  return (
    <Datensicht<Person, SpaltenKey>
      bezeichnung="Personen"
      spalten={props.spalten ?? spalten}
      daten={props.daten}
      zeilenSchluessel="id"
      karte={props.karte ?? karte}
      form={props.form}
    />
  );
}

const ids = () => new Set(gezeichnet.mock.calls.map(([id]) => id));

beforeEach(() => {
  gezeichnet.mockClear();
});

describe.each(['tabelle', 'karte'] as const)('Datensicht rendert gemerkt (%s, LFH-949)', (form) => {
  beforeEach(() => {
    setzeViewportBreite(form === 'tabelle' ? 1440 : 390);
  });

  it('eine geänderte Zeile rendert nur sich', () => {
    const { rerender } = renderMitProviders(<Sicht daten={zwanzig} form={form} />);
    gezeichnet.mockClear();
    const neu = zwanzig.map((p) => (p.id === 5 ? { ...p, name: 'Geändert' } : p));
    rerender(<Sicht daten={neu} form={form} />);
    expect(ids()).toEqual(new Set([5]));
    expect(screen.getByText('Geändert')).toBeInTheDocument();
  });

  it('dieselben Daten in neuem Feld rendern nichts', () => {
    const { rerender } = renderMitProviders(<Sicht daten={zwanzig} form={form} />);
    gezeichnet.mockClear();
    rerender(<Sicht daten={[...zwanzig]} form={form} />);
    expect(ids().size).toBe(0);
  });

  it('neue Spalten und ein neuer Kartenplan rendern alle Zeilen', () => {
    const { rerender } = renderMitProviders(<Sicht daten={zwanzig} form={form} />);
    gezeichnet.mockClear();
    rerender(
      <Sicht
        daten={zwanzig}
        form={form}
        spalten={spalten.map((s) => ({ ...s })) as unknown as typeof spalten}
        karte={{ ...karte }}
      />,
    );
    expect(ids().size).toBe(20);
  });
});
