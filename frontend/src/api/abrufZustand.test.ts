import { describe, expect, it } from 'vitest';
import { abrufZustand, schlechtesterZustand } from './abrufZustand';
import { ApiError } from './client';

const ruhig = { error: null, isError: false, isPending: false };

describe('abrufZustand', () => {
  it('liest 403 als gesperrt, nicht als Fehler', () => {
    expect(
      abrufZustand({ error: new ApiError(403, 'nein'), isError: true, isPending: false }),
    ).toBe('gesperrt');
  });

  it('liest jeden anderen Fehler als fehler', () => {
    expect(
      abrufZustand({ error: new ApiError(500, 'kaputt'), isError: true, isPending: false }),
    ).toBe('fehler');
    expect(abrufZustand({ error: new Error('Netz'), isError: true, isPending: false })).toBe(
      'fehler',
    );
  });

  it('liest Laden und Daten', () => {
    expect(abrufZustand({ ...ruhig, isPending: true })).toBe('laden');
    expect(abrufZustand(ruhig)).toBe('daten');
  });

  it('liest eine pausierte Abfrage (offline, noch nie geladen) als laden, nie als Daten', () => {
    // TanStack v5: `isLoading = isPending && isFetching`. Pausiert ist `isFetching` false,
    // `isLoading` also auch; nur `isPending` sagt, dass nie Daten ankamen.
    const pausiert = { error: null, isError: false, isPending: true, isLoading: false };
    expect(abrufZustand(pausiert)).toBe('laden');
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
