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
    expect(screen.getByText('Amtliche Warnung vor Dauerregen')).toBeInTheDocument();
    expect(screen.getByText('Mäßig')).toBeInTheDocument();
    expect(screen.getByText('Sofort')).toBeInTheDocument();
    expect(screen.getByText('Es tritt Dauerregen auf.')).toBeInTheDocument();
    expect(screen.getByText('Meiden Sie überflutete Bereiche.')).toBeInTheDocument();
  });

  it('Pegel: Wasserstand mit Einheit, Zustand-Tag, Gewässer', () => {
    render(
      <FachebenenInspector
        quelle="pegelonline"
        properties={{ titel: 'KÖLN', gewaesser: 'RHEIN', wert: 320, einheit: 'cm', zustand: 'hoch' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText(/320 cm/)).toBeInTheDocument();
    expect(screen.getByText('Hoch')).toBeInTheDocument();
    expect(screen.getByText('RHEIN')).toBeInTheDocument();
  });

  it('KRITIS: Kategorie-Label, Adresse, klickbares Telefon', () => {
    render(
      <FachebenenInspector
        quelle="kritis"
        properties={{ titel: 'Uniklinik', kategorie: 'krankenhaus', adresse: 'Hauptstr. 1, 50667 Köln', telefon: '0221-1' }}
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
        // eslint-disable-next-line no-script-url
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
    render(<FachebenenInspector quelle="kritis" properties={{ titel: 'X' }} onSchliessen={onSchliessen} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onSchliessen).toHaveBeenCalledOnce();
  });
});
