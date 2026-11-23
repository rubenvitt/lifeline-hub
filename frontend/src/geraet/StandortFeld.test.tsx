import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beendeHuelle, starteAndroidHuelle } from '../test/huelle';
import StandortFeld from './StandortFeld';

/** `sofort` am Kontakt des Einheitengeräts (LLH-1580 K6): einmal beim Einhängen ermitteln. */

function geolocationMitAntwort() {
  const getCurrentPosition = vi.fn((ok: PositionCallback) => {
    setTimeout(
      () =>
        ok({ coords: { latitude: 50.11, longitude: 8.68, accuracy: 9 } } as GeolocationPosition),
      0,
    );
  });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  });
  return getCurrentPosition;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
});

describe('StandortFeld sofort', () => {
  it('liefert den Standort auch unter StrictMode (Aus- und Wiedereinhängen)', async () => {
    geolocationMitAntwort();
    const onChange = vi.fn();
    render(
      <StrictMode>
        <StandortFeld sofort onChange={onChange} />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ lat: 50.11, lon: 8.68, genauigkeit: 9 }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ohne `sofort` erst auf Knopfdruck', async () => {
    const getCurrentPosition = geolocationMitAntwort();
    render(<StandortFeld onChange={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe('StandortFeld verweigert (LLH-2071)', () => {
  afterEach(beendeHuelle);

  it('nennt in der App die Einstellungen des Geräts', async () => {
    starteAndroidHuelle({ bruecke: { postMessage: vi.fn() } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: PositionCallback, fehler: PositionErrorCallback) =>
          setTimeout(
            () => fehler({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
            0,
          ),
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
    render(<StandortFeld sofort onChange={vi.fn()} />);
    expect(
      await screen.findByText(
        'Standortzugriff verweigert – in den Einstellungen des Geräts für Lifeline freigeben, dann erneut einschalten.',
      ),
    ).toBeTruthy();
  });
});
