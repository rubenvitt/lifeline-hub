import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GeoKennzahlen, { KennzahlZeile } from './GeoKennzahlen';

describe('GeoKennzahlen', () => {
  it('rendert Fläche und Umfang eines Polygons, aber keine Länge', () => {
    render(<GeoKennzahlen kennzahlen={{ flaecheM2: 1_000_000, umfangM: 4000 }} />);
    expect(screen.getByText('Fläche')).toBeInTheDocument();
    expect(screen.getByText('Umfang')).toBeInTheDocument();
    expect(screen.queryByText('Länge')).not.toBeInTheDocument();
  });

  it('rendert Länge einer Linie, aber keine Fläche', () => {
    render(<GeoKennzahlen kennzahlen={{ laengeM: 1500 }} />);
    expect(screen.getByText('Länge')).toBeInTheDocument();
    expect(screen.queryByText('Fläche')).not.toBeInTheDocument();
    // Der Wert kommt aus `pages/lagekarte/geo.ts` (`formatLaenge`, Intl de-DE, eine
    // Nachkommastelle) — NICHT aus `anzeige/format.ts` (`formatDistanz` → '1.50 km').
    // Dieses Literal ist der maschinelle Wächter gegen die verbotene Vereinheitlichung
    // der beiden Distanzformatierer (Plan §Global Constraints, Spec §3.2).
    expect(screen.getByText('1,5 km')).toBeInTheDocument();
  });

  it('setzt die Zahl in die Zahlenschrift mit tabular-nums (A0 Signatur 3)', () => {
    render(<GeoKennzahlen kennzahlen={{ laengeM: 1500 }} />);
    const wert = screen.getByText('1,5 km');
    expect(wert.style.fontVariantNumeric).toBe('tabular-nums');
    expect(wert.style.fontFamily).toContain('JetBrains Mono');
  });

  it('rendert nichts ohne Kennzahlen und ohne Zusatz', () => {
    const { container } = render(<GeoKennzahlen kennzahlen={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('rendert den Zusatz-Slot auch ohne Geo-Kennzahlen', () => {
    render(
      <GeoKennzahlen
        kennzahlen={null}
        zusatz={<KennzahlZeile label="Zonen" wert="3" />}
      />,
    );
    expect(screen.getByText('Zonen')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('lässt einen nicht-numerischen Zusatzwert aus der Zahlenschrift heraus', () => {
    render(
      <GeoKennzahlen
        kennzahlen={null}
        zusatz={<KennzahlZeile label="Höchste Warnstufe" wert="Hoch" zahl={false} />}
      />,
    );
    expect(screen.getByText('Hoch').style.fontVariantNumeric).toBe('');
  });
});
