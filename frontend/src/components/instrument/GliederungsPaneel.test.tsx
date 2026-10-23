import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import GliederungsPaneel, { GLIEDERUNG_KLASSE, type Gliederungszeile } from './GliederungsPaneel';

const ZEILEN: Gliederungszeile[] = [
  {
    schluessel: 1,
    ziel: '/abschnitt/1',
    kante: { farbe: 'rgb(255, 0, 0)', rolle: 'alarm' },
    kopf: <span>EA 1 Brandbekämpfung</span>,
    inhalt: <span>Riegelstellung halten</span>,
    zahl: <span>1/2/9//12</span>,
  },
  {
    schluessel: 2,
    ziel: '/abschnitt/2',
    kante: null,
    kopf: <span>EA 2 Wasserversorgung</span>,
    zahl: <span>0/1/4//5</span>,
  },
];

function rendere(zustand: 'daten' | 'laden' | 'fehler' | 'leer' | 'gesperrt' = 'daten') {
  return renderMitProviders(
    <GliederungsPaneel
      titel="Einsatzabschnitte"
      kennung="abschnitt"
      zustand={zustand}
      zeilen={ZEILEN}
      vorspann={<div data-testid="legende">Einheiten nach Status</div>}
      leerText="Noch keine Abschnitte."
      gesperrtText="Modul Einsatzabschnitte nicht freigegeben."
      onNeuladen={vi.fn()}
    />,
  );
}

describe('GliederungsPaneel', () => {
  it('jede Zeile ist ein Link mit Kopf, Inhalt und Zahlspalte', () => {
    rendere();
    const link = screen.getByRole('link', { name: /EA 1 Brandbekämpfung/ });
    expect(link).toHaveAttribute('href', '/abschnitt/1');
    expect(link).toHaveAttribute('data-lfh', 'abschnitt');
    expect(link).toHaveClass(GLIEDERUNG_KLASSE.zeile);
    expect(link).toHaveTextContent('Riegelstellung halten');
    expect(link).toHaveTextContent('1/2/9//12');
    expect(screen.getByTestId('legende')).toBeInTheDocument();
  });

  it('die Lagekante trägt nur Farbe (Wort steht im Kopf), ohne Beurteilung durchsichtig', () => {
    const { container } = rendere();
    const kanten = container.querySelectorAll<HTMLElement>('[data-lfh="abschnitt-kante"]');
    expect(kanten[0]).toHaveAttribute('aria-hidden', 'true');
    expect(kanten[0]).toHaveAttribute('data-rolle', 'alarm');
    expect(kanten[0].style.background).toBe('rgb(255, 0, 0)');
    expect(kanten[1].style.background).toBe('transparent');
  });

  it('Laden, Fehler, Leer, Gesperrt ohne Zeilen', () => {
    for (const z of ['laden', 'fehler', 'leer', 'gesperrt'] as const) {
      const { unmount } = rendere(z);
      expect(screen.queryByRole('link')).toBeNull();
      unmount();
    }
  });
});
