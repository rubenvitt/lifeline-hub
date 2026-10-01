import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuchnadelBand from './SuchnadelBand';

describe('SuchnadelBand (LFH-638)', () => {
  it('rendert ohne Nadel nichts', () => {
    const { container } = render(<SuchnadelBand ort={null} onEntfernen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nennt den Ort und räumt über „Suchnadel entfernen“', async () => {
    const onEntfernen = vi.fn();
    render(
      <SuchnadelBand
        ort={{
          lat: 51.16,
          lon: 10.45,
          beschriftung: 'Hauptstraße 12, Musterstadt',
          art: 'adresse',
        }}
        onEntfernen={onEntfernen}
      />,
    );
    const region = screen.getByRole('region', { name: 'Suchnadel' });
    expect(region).toHaveTextContent('Hauptstraße 12, Musterstadt');
    await userEvent.click(screen.getByRole('button', { name: 'Suchnadel entfernen' }));
    expect(onEntfernen).toHaveBeenCalledTimes(1);
  });

  it('setzt eine Koordinate in Mono mit tabular-nums, eine Adresse nicht', () => {
    const { rerender } = render(
      <SuchnadelBand
        ort={{ lat: 52.52, lon: 13.4, beschriftung: '52.52000, 13.40000', art: 'koordinate' }}
        onEntfernen={vi.fn()}
      />,
    );
    expect(screen.getByText('52.52000, 13.40000').style.fontVariantNumeric).toBe('tabular-nums');
    rerender(
      <SuchnadelBand
        ort={{ lat: 52.52, lon: 13.4, beschriftung: 'Rathaus', art: 'adresse' }}
        onEntfernen={vi.fn()}
      />,
    );
    expect(screen.getByText('Rathaus').style.fontVariantNumeric).toBe('');
  });

  it('holt sich die Zeigerereignisse zurück (Band im Fuß-Rahmen ohne Zeiger)', () => {
    render(
      <SuchnadelBand
        ort={{ lat: 1, lon: 2, beschriftung: 'x', art: 'adresse' }}
        onEntfernen={vi.fn()}
      />,
    );
    const band = document.querySelector<HTMLElement>('[data-lfh="suchnadel-band"]');
    expect(band?.style.pointerEvents).toBe('auto');
  });
});
