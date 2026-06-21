import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StaerkeAnzeige from './StaerkeAnzeige';

describe('StaerkeAnzeige', () => {
  it('zeigt — bei null', () => {
    render(<StaerkeAnzeige wert={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('zeigt F/UF/M/Σ mit berechneter Gesamtstärke', () => {
    render(<StaerkeAnzeige wert={{ fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }} />);
    expect(screen.getByText('1/3/18/22')).toBeInTheDocument();
  });

  it('zeigt 0/0/0/0 bei Nullen (nicht —)', () => {
    render(<StaerkeAnzeige wert={{ fuehrer: 0, unterfuehrer: 0, mannschaft: 0 }} />);
    expect(screen.getByText('0/0/0/0')).toBeInTheDocument();
  });

  // KRITISCH: kein umschließendes Element — sonst splitten zusammengesetzte Tag-Zeilen
  // (z. B. "kumuliert 1/0/2/3" in EinheitenPage) und deren getByText-Substring-Matches brechen.
  it('rendert kein Wrapper-Element (Substring-Match in zusammengesetztem Text)', () => {
    render(
      <div>
        kumuliert <StaerkeAnzeige wert={{ fuehrer: 1, unterfuehrer: 0, mannschaft: 2 }} />
      </div>,
    );
    expect(screen.getByText('kumuliert 1/0/2/3')).toBeInTheDocument();
  });
});
