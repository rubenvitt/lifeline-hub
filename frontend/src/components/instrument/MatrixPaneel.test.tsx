import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import MatrixPaneel, { type Matrixzeile } from './MatrixPaneel';
import { MATRIX_KLASSE } from './matrixGeometrie';

const STUFEN = ['niedrig', 'mittel', 'hoch', 'akut'] as const;
const ZEILEN: Matrixzeile[] = [
  {
    schluessel: 'feuer',
    name: 'Feuer',
    beschriftung: 'Feuer: hoch',
    rang: 3,
    farbe: 'rgb(255, 0, 0)',
    stufenwort: 'hoch',
    ton: 'alarm',
    zusatz: <span data-testid="zeichen">◤</span>,
  },
  {
    schluessel: 'wasser',
    name: 'Wasser',
    beschriftung: 'Wasser: niedrig',
    rang: 1,
    farbe: null,
    stufenwort: 'niedrig',
    ton: 'neutral',
  },
];

function rendere(zustand: 'daten' | 'laden' | 'fehler' | 'leer' | 'gesperrt' = 'daten') {
  return renderMitProviders(
    <MatrixPaneel
      titel="Gefahrenmatrix"
      kennung="gefahren"
      zustand={zustand}
      zeilen={ZEILEN}
      stufen={STUFEN}
      unterLegende={<div data-testid="unter">mit Erläuterung</div>}
      leerText="Keine Gefahr."
      gesperrtText="Modul Gefahren nicht freigegeben."
      onNeuladen={vi.fn()}
    />,
  );
}

describe('MatrixPaneel', () => {
  it('Zeile: Name · Stufenbalken · Stufenwort, benannt als Ganzes', () => {
    const { container } = rendere();
    const zeilen = container.querySelectorAll('[data-lfh="gefahrenzeile"]');
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]).toHaveAttribute('aria-label', 'Feuer: hoch');
    expect(zeilen[0]).toHaveAttribute('data-stufe', 'hoch');
    expect(zeilen[0]).toHaveClass(MATRIX_KLASSE.zeile);
    expect(screen.getByTestId('zeichen')).toBeInTheDocument();
    const stufen = zeilen[0].querySelectorAll('[data-lfh="gefahrenbalken"] > span');
    expect(Array.from(stufen).map((s) => s.getAttribute('data-voll'))).toEqual([
      'ja',
      'ja',
      'ja',
      'nein',
    ]);
  });

  it('Legende in derselben Geometrie, Zusatz darunter', () => {
    const { container } = rendere();
    const legende = container.querySelector('[data-lfh="gefahrenlegende"]')!;
    expect(legende).toHaveClass(MATRIX_KLASSE.zeile, MATRIX_KLASSE.legende);
    expect(legende).toHaveTextContent('niedrigmittelhochakut');
    expect(screen.getByTestId('unter')).toBeInTheDocument();
  });

  it('ohne Daten keine Matrix; gesperrt nennt den Grund', () => {
    for (const z of ['laden', 'fehler', 'leer'] as const) {
      const { container, unmount } = rendere(z);
      expect(container.querySelector('[data-lfh="gefahrenzeile"]')).toBeNull();
      unmount();
    }
    rendere('gesperrt');
    expect(screen.getByText('Modul Gefahren nicht freigegeben.')).toBeInTheDocument();
  });
});
