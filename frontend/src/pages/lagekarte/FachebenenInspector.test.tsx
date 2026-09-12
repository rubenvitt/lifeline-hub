import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FachebenenInspector from './FachebenenInspector';

describe('FachebenenInspector', () => {
  it('Warnung (DWD): Headline, Schwere-Label, Beschreibung, Handlungsempfehlung', () => {
    render(
      <FachebenenInspector
        quelle="dwd"
        properties={{
          HEADLINE: 'Amtliche Warnung vor Dauerregen',
          EVENT: 'DAUERREGEN',
          SEVERITY: 'Moderate',
          URGENCY: 'Immediate',
          DESCRIPTION: 'Es tritt Dauerregen auf.',
          INSTRUCTION: 'Meiden Sie überflutete Bereiche.',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('🌧️ Dauerregen')).toBeInTheDocument(); // Icon + Ereignis im Titel
    expect(screen.getByText('Amtliche Warnung vor Dauerregen')).toBeInTheDocument(); // volle Headline im Body
    expect(screen.getByText('Mäßig')).toBeInTheDocument();
    expect(screen.getByText('Sofort')).toBeInTheDocument();
    expect(screen.getByText('Es tritt Dauerregen auf.')).toBeInTheDocument();
    expect(screen.getByText('Meiden Sie überflutete Bereiche.')).toBeInTheDocument();
  });

  it('Pegel: Wasserstand mit Einheit, Zustand-Tag (high→Hoch), Gewässer', () => {
    render(
      <FachebenenInspector
        quelle="pegelonline"
        properties={{
          titel: 'KÖLN',
          gewaesser: 'RHEIN',
          wert: 320,
          einheit: 'cm',
          zustand: 'high',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText(/320 cm/)).toBeInTheDocument();
    expect(screen.getByText('Hoch')).toBeInTheDocument();
    expect(screen.getByText('RHEIN')).toBeInTheDocument();
  });

  it('Pegel: Zustand "unknown" zeigt KEIN Tag (statt Rohwert)', () => {
    render(
      <FachebenenInspector
        quelle="pegelonline"
        properties={{ titel: 'X', wert: 100, einheit: 'cm', zustand: 'unknown' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.queryByText('unknown')).toBeNull();
    expect(screen.getByText(/100 cm/)).toBeInTheDocument();
  });

  it('KRITIS: Kategorie-Label, Adresse, klickbares Telefon', () => {
    render(
      <FachebenenInspector
        quelle="kritis"
        properties={{
          titel: 'Uniklinik',
          kategorie: 'krankenhaus',
          adresse: 'Hauptstr. 1, 50667 Köln',
          telefon: '0221-1',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Uniklinik')).toBeInTheDocument();
    expect(screen.getByText('Krankenhaus')).toBeInTheDocument();
    expect(screen.getByText('Hauptstr. 1, 50667 Köln')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '0221-1' })).toHaveAttribute('href', 'tel:0221-1');
  });

  it('KRITIS: http(s)-Website wird Link, javascript:-URI nur Klartext (kein href)', () => {
    const { rerender } = render(
      <FachebenenInspector
        quelle="kritis"
        properties={{ titel: 'A', website: 'https://example.org' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: 'https://example.org' })).toHaveAttribute(
      'href',
      'https://example.org',
    );

    rerender(
      <FachebenenInspector
        quelle="kritis"
        properties={{ titel: 'A', website: 'javascript:alert(1)' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });

  it('Schließen-Button ruft Callback', async () => {
    const onSchliessen = vi.fn();
    const { default: userEvent } = await import('@testing-library/user-event');
    render(
      <FachebenenInspector
        quelle="kritis"
        properties={{ titel: 'X' }}
        onSchliessen={onSchliessen}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onSchliessen).toHaveBeenCalledOnce();
  });
});

describe('FachebenenInspector — Fläche (LFH-146)', () => {
  const box = [
    [
      [8, 50],
      [8.1, 50],
      [8.1, 50.1],
      [8, 50.1],
      [8, 50],
    ],
  ];

  it('Warnung mit Polygon-Geometrie zeigt Fläche und Umfang', () => {
    render(
      <FachebenenInspector
        quelle="nina"
        properties={{ HEADLINE: 'X' }}
        geometrie={{ type: 'Polygon', coordinates: box }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Fläche')).toBeInTheDocument();
    expect(screen.getByText('Umfang')).toBeInTheDocument();
    expect(screen.getByText(/\d.*(m²|ha|km²)/)).toBeInTheDocument();
  });

  it('MultiPolygon-Geometrie zeigt (summierte) Fläche', () => {
    render(
      <FachebenenInspector
        quelle="dwd"
        properties={{ EVENT: 'STURM' }}
        geometrie={{ type: 'MultiPolygon', coordinates: [box, box] }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Fläche')).toBeInTheDocument();
  });

  it('Punkt-/keine Geometrie zeigt keine Fläche', () => {
    render(
      <FachebenenInspector
        quelle="pegelonline"
        properties={{ titel: 'X', wert: 100, einheit: 'cm' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.queryByText('Fläche')).not.toBeInTheDocument();
  });
});
