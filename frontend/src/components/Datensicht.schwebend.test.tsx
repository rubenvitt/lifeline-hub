import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from 'antd';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import Datensicht, { spaltenFuer, type Kartenplan } from './Datensicht';
import { InlineAngabe } from './InlineAngabe';

/**
 * Eine offene schwebende Bearbeitung hält die Zeilenfolge der Tabelle, auch wenn der Fokus das
 * Popover verlassen hat (Touch, Klick ins Freie). Spec `einsatztauglichkeit-layout`, „Bearbeiten in
 * einer Tabellenzelle verschiebt die Tabelle nicht“; `components/angabeForm.tsx`.
 */

interface Fahrzeug {
  id: number;
  funkrufname: string;
  einheit: string;
}

const F = (id: number, funkrufname: string): Fahrzeug => ({ id, funkrufname, einheit: 'Zug 1' });
const DREI = [F(1, 'Florian 1'), F(2, 'Florian 2'), F(3, 'Florian 3')];
const VIER = [F(0, 'Florian 0'), ...DREI];

const spalten = spaltenFuer<Fahrzeug>()([
  { key: 'funkrufname', title: 'Funkrufname', dataIndex: 'funkrufname', immerSichtbar: true },
  {
    key: 'einheit',
    title: 'Einheit',
    render: (_: unknown, f: Fahrzeug) => (
      <InlineAngabe<string>
        etikett="Einheit"
        kennung={f.funkrufname}
        wert={f.einheit}
        anzeige={f.einheit}
        leer={(w) => w.trim() === ''}
        darfSchreiben
        onSpeichern={vi.fn().mockResolvedValue(undefined)}
        eingabe={({ feld, value, onChange }) => (
          <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
        )}
      />
    ),
  },
]);
type FahrzeugKey = (typeof spalten)[number]['key'];

const karte: Kartenplan<Fahrzeug, FahrzeugKey> = {
  art: 'plan',
  titel: { spalte: 'funkrufname', ziel: (f) => `/einsaetze/1/fahrzeuge?fahrzeug=${f.id}` },
};

function Sicht({ daten }: { daten: readonly Fahrzeug[] }) {
  return (
    <>
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge"
        form="tabelle"
        spalten={spalten}
        daten={daten}
        zeilenSchluessel="id"
        karte={karte}
      />
      <button type="button">daneben</button>
    </>
  );
}

function renderMitProviders(ui: ReactElement) {
  const ergebnis = renderMitBasisProviders(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);
  return {
    ...ergebnis,
    rerender: (naechstes: ReactElement) =>
      ergebnis.rerender(<CommandPaletteProvider>{naechstes}</CommandPaletteProvider>),
  };
}

const ersteZeile = (c: HTMLElement) => c.querySelector('tr.ant-table-row')?.textContent ?? '';

describe('Datensicht · schwebende Bearbeitung hält die Zeilenfolge (LLH-1795)', () => {
  it('ist die Bearbeitung offen und der Fokus woanders, rückt keine neue Zeile davor', async () => {
    const { container, rerender } = renderMitProviders(<Sicht daten={DREI} />);
    // Per Tastatur geöffnet: ein Mausklick ließe den Zeiger über der Sicht, und der hielte allein.
    screen.getByRole('button', { name: 'Einheit zu Florian 1 bearbeiten' }).focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('textbox', { name: 'Einheit zu Florian 1' });
    // Wie ein Tipp ins Freie am Tablet: der Fokus verlässt Sicht und Popover, das Popover bleibt.
    screen.getByRole('button', { name: 'daneben' }).focus();

    rerender(<Sicht daten={VIER} />);
    expect(ersteZeile(container)).toContain('Florian 1');
    expect(screen.getByRole('textbox', { name: 'Einheit zu Florian 1' })).toBeInTheDocument();
  });

  it('Gegenprobe: ohne offene Bearbeitung und ohne Fokus in der Sicht fließt die Zeile ein', () => {
    const { container, rerender } = renderMitProviders(<Sicht daten={DREI} />);
    screen.getByRole('button', { name: 'daneben' }).focus();
    rerender(<Sicht daten={VIER} />);
    expect(ersteZeile(container)).toContain('Florian 0');
  });
});
