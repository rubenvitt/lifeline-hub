import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FunkErreichbarkeit from './FunkErreichbarkeit';

const tmo = {
  id: 1,
  einsatz_id: 1,
  einsatz_lokal: false,
  bezeichnung: '412_F_DRK',
  betriebsart: 'TMO' as const,
  hinweis: null,
  aktiv: true,
  sortier: 0,
};
const dmo = {
  id: 2,
  einsatz_id: 1,
  einsatz_lokal: false,
  bezeichnung: 'DMO 31',
  betriebsart: 'DMO' as const,
  hinweis: null,
  aktiv: true,
  sortier: 1,
};

describe('FunkErreichbarkeit', () => {
  it('rendert TMO/DMO-Sprechgruppen, Kommunikationsmittel-Label und Erreichbarkeit', () => {
    render(
      <FunkErreichbarkeit
        sprechgruppen={[tmo, dmo]}
        kommunikationsmittel="digitalfunk"
        erreichbarkeit="0151 23456"
      />,
    );
    const box = screen.getByTestId('funk-erreichbarkeit');
    expect(box).toHaveTextContent('TMO: 412_F_DRK');
    expect(box).toHaveTextContent('DMO: DMO 31');
    expect(box).toHaveTextContent('Digitalfunk'); // Label statt Roh-Schlüssel
    expect(box).toHaveTextContent('☎ 0151 23456');
  });

  it('rendert nichts, wenn keine Funk-Daten vorliegen (ohne leerText)', () => {
    const { container } = render(
      <FunkErreichbarkeit sprechgruppen={[]} kommunikationsmittel={null} erreichbarkeit={null} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('funk-erreichbarkeit')).not.toBeInTheDocument();
  });

  it('zeigt leerText, wenn keine Daten und leerText gesetzt', () => {
    render(
      <FunkErreichbarkeit
        sprechgruppen={[]}
        kommunikationsmittel={null}
        erreichbarkeit={null}
        leerText="keine Funk-Angaben"
      />,
    );
    expect(screen.getByText('keine Funk-Angaben')).toBeInTheDocument();
  });
});
