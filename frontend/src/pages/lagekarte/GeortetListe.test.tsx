import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { KarteMarker } from './marker';
import GeortetListe from './GeortetListe';

const marker = (schluessel: string, label: string, extra: Partial<KarteMarker> = {}) =>
  ({
    schluessel,
    label,
    typ: 'fahrzeug',
    id: 1,
    lat: 52,
    lon: 9,
    farbe: '#555',
    ...extra,
  }) as KarteMarker;

describe('GeortetListe (Helfer-App)', () => {
  it('nennt geortete Ziele mit Quelle und Alter und springt zum Marker', async () => {
    const waehlen = vi.fn();
    render(
      <GeortetListe
        verortet={[
          marker('fahrzeug-1', 'RK 1/83-1', {
            untertitel: 'Helfer-App · vor 6 min',
            deckkraft: 0.5,
          }),
          marker('einheit-2', 'Zug 1'),
        ]}
        onMarkerWaehlen={waehlen}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Geortet' })).toBeInTheDocument();
    expect(screen.getByText('Helfer-App · vor 6 min · veraltet')).toBeInTheDocument();
    expect(screen.queryByText('Zug 1')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /RK 1\/83-1/ }));
    expect(waehlen).toHaveBeenCalledWith('fahrzeug-1');
  });

  it('steht ohne geortetes Ziel nicht da', () => {
    const { container } = render(
      <GeortetListe verortet={[marker('einheit-2', 'Zug 1')]} onMarkerWaehlen={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
