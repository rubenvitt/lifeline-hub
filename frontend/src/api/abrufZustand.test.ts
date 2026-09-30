import { describe, expect, it } from 'vitest';
import { abrufZustand, schlechtesterZustand } from './abrufZustand';
import { ApiError } from './client';

const ruhig = { error: null, isError: false, isLoading: false };

describe('abrufZustand', () => {
  it('liest 403 als gesperrt, nicht als Fehler', () => {
    expect(
      abrufZustand({ error: new ApiError(403, 'nein'), isError: true, isLoading: false }),
    ).toBe('gesperrt');
  });

  it('liest jeden anderen Fehler als fehler', () => {
    expect(
      abrufZustand({ error: new ApiError(500, 'kaputt'), isError: true, isLoading: false }),
    ).toBe('fehler');
    expect(abrufZustand({ error: new Error('Netz'), isError: true, isLoading: false })).toBe(
      'fehler',
    );
  });

  it('liest Laden und Daten', () => {
    expect(abrufZustand({ ...ruhig, isLoading: true })).toBe('laden');
    expect(abrufZustand(ruhig)).toBe('daten');
  });
});

describe('schlechtesterZustand', () => {
  it('nimmt gesperrt vor fehler vor laden vor daten', () => {
    expect(schlechtesterZustand('daten', 'laden')).toBe('laden');
    expect(schlechtesterZustand('laden', 'fehler', 'daten')).toBe('fehler');
    expect(schlechtesterZustand('fehler', 'gesperrt')).toBe('gesperrt');
    expect(schlechtesterZustand('daten', 'daten')).toBe('daten');
  });
});
