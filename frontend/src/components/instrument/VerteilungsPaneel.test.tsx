import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import VerteilungsPaneel, { Verteilungsliste, type Verteilungszeile } from './VerteilungsPaneel';

const ZEILEN: Verteilungszeile[] = [
  {
    schluessel: 'frei',
    wort: 'frei',
    beschreibung: 'einsatzbereit',
    wert: 3,
    anteil: 0.75,
    balkenFarbe: 'rgb(0, 128, 0)',
    farbfeld: { farbe: 'rgb(0, 128, 0)', umrandung: 'rgb(0, 0, 0)' },
    attribute: { 'data-status': '2' },
  },
  { schluessel: 'weg', wort: 'unterwegs', wert: 1, anteil: 0.25, balkenFarbe: 'rgb(0, 0, 255)' },
  { schluessel: 'aus', wort: 'Ausfall', wert: null, anteil: 0, balkenFarbe: 'rgb(255, 0, 0)' },
];

function rendere(zustand: 'daten' | 'laden' | 'fehler' | 'leer' | 'gesperrt' = 'daten') {
  return renderMitProviders(
    <VerteilungsPaneel
      titel="Einheiten nach FMS-Status"
      kennung="fms"
      zustand={zustand}
      zeilen={ZEILEN}
      leerText="Keine Einheiten."
      gesperrtText="Modul Einheiten nicht freigegeben."
      onNeuladen={vi.fn()}
    />,
  );
}

describe('VerteilungsPaneel', () => {
  it('Zahl führt: je Kategorie Wort, Zahl und ein Anteilsbalken als Ergänzung', () => {
    const { container } = rendere();
    const zeilen = container.querySelectorAll('li');
    expect(zeilen).toHaveLength(3);
    expect(within(zeilen[0]).getByText('frei')).toBeInTheDocument();
    expect(within(zeilen[0]).getByText('einsatzbereit')).toBeInTheDocument();
    expect(zeilen[0].querySelector('[data-lfh="fms-wert"]')).toHaveTextContent('3');
    const balken = zeilen[0].querySelector<HTMLElement>('[data-lfh="fms-anteil"]')!;
    expect(balken.style.width).toBe('75%');
    expect(balken.style.background).toBe('rgb(0, 128, 0)');
    // Der Balken ist Dekoration neben der Zahl.
    expect(balken.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('Farbfeld nur, wo es gesetzt ist; Attribute landen an der Zeile', () => {
    const { container } = rendere();
    const zeilen = container.querySelectorAll('li');
    expect(zeilen[0]).toHaveAttribute('data-status', '2');
    expect(zeilen[0].querySelector('[data-lfh="fms-feld"]')).not.toBeNull();
    expect(zeilen[1].querySelector('[data-lfh="fms-feld"]')).toBeNull();
  });

  it('Ausfall steht als „—“, nie als 0, und ohne Balken', () => {
    const { container } = rendere();
    const ausfall = container.querySelectorAll('li')[2];
    expect(ausfall.querySelector('[data-lfh="fms-wert"]')).toHaveTextContent('—');
    expect(ausfall.querySelector('[data-lfh="fms-anteil"]')).toBeNull();
  });

  it('Laden, Fehler, Leer und Gesperrt zeigen keine Zeilen', () => {
    for (const z of ['laden', 'fehler', 'leer', 'gesperrt'] as const) {
      const { container, unmount } = rendere(z);
      expect(container.querySelectorAll('li')).toHaveLength(0);
      unmount();
    }
    rendere('gesperrt');
    expect(screen.getByText('Modul Einheiten nicht freigegeben.')).toBeInTheDocument();
  });

  it('die Liste steht auch ohne Paneel, dicht für eine Zeile', () => {
    const { container } = renderMitProviders(
      <Verteilungsliste kennung="abschnitt-status" zeilen={ZEILEN} dichte="zeile" />,
    );
    expect(container.querySelectorAll('[data-lfh="abschnitt-status-wert"]')).toHaveLength(3);
  });

  it('kompakt im Paneel: kleinere Zahl, dieselben Greifer', () => {
    const { container } = renderMitProviders(
      <VerteilungsPaneel
        titel="Einheiten nach FMS-Status"
        kennung="fms"
        dichte="kompakt"
        zustand="daten"
        zeilen={ZEILEN}
        leerText="Keine Einheiten."
        gesperrtText="Modul Einheiten nicht freigegeben."
        onNeuladen={vi.fn()}
      />,
    );
    const werte = container.querySelectorAll<HTMLElement>('[data-lfh="fms-wert"]');
    expect(werte).toHaveLength(3);
    expect(werte[0].style.fontSize).toBe('15px');
  });
});
