import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StaerkeAnzeige from './StaerkeAnzeige';
import { STAERKE_AUSGESCHRIEBEN, STAERKE_SCHREIBWEISE, staerkeText } from './staerke';

describe('StaerkeAnzeige', () => {
  it('zeigt — bei null, ohne Beschreibung', () => {
    render(<StaerkeAnzeige wert={null} />);
    expect(screen.getByText('—')).not.toHaveAttribute('title');
  });

  it('zeigt F/UF/M//Σ mit berechneter Gesamtstärke', () => {
    render(<StaerkeAnzeige wert={{ fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }} />);
    expect(screen.getByText('1/3/18//22')).toBeInTheDocument();
  });

  it('zeigt 0/0/0//0 bei Nullen (nicht —)', () => {
    render(<StaerkeAnzeige wert={{ fuehrer: 0, unterfuehrer: 0, mannschaft: 0 }} />);
    expect(screen.getByText('0/0/0//0')).toBeInTheDocument();
  });

  // LLH-1750, Spec `lage-verdichtung`, „Die Stärke nennt ihre Schreibweise“: Vorlesehilfen hören
  // die ausgeschriebene Form, der Tooltip zeigt sie zusätzlich.
  it('beschreibt den Wert ausgeschrieben', () => {
    render(<StaerkeAnzeige wert={{ fuehrer: 1, unterfuehrer: 2, mannschaft: 5 }} />);
    expect(screen.getByText('1/2/5//8')).toHaveAccessibleDescription(
      'Führer / Unterführer / Mannschaft // Summe',
    );
  });

  it('steht in zusammengesetzten Zeilen als ein Textstück', () => {
    const { container } = render(
      <div>
        kumuliert <StaerkeAnzeige wert={{ fuehrer: 1, unterfuehrer: 0, mannschaft: 2 }} />
      </div>,
    );
    expect(container.textContent).toBe('kumuliert 1/0/2//3');
  });
});

describe('Schreibweise der Stärke', () => {
  it('heißt F/UF/M//Σ und schreibt die Summe aus', () => {
    expect(STAERKE_SCHREIBWEISE).toBe('F/UF/M//Σ');
    expect(STAERKE_AUSGESCHRIEBEN).toBe('Führer / Unterführer / Mannschaft // Summe');
    expect(staerkeText({ fuehrer: 1, unterfuehrer: 2, mannschaft: 5 })).toBe('1/2/5//8');
  });
});
