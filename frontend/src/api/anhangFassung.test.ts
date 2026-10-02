import { describe, expect, it } from 'vitest';
import { istBildMime, originalPfad } from './anhangFassung';

describe('anhangFassung (LFH-747)', () => {
  it('hängt die Fassung an die Download-Adresse', () => {
    expect(originalPfad('/api/einsaetze/5/etb/40/anhaenge/9')).toBe(
      '/api/einsaetze/5/etb/40/anhaenge/9?fassung=original',
    );
  });

  it('ergänzt einen vorhandenen Query-String', () => {
    expect(originalPfad('/api/x?a=1')).toBe('/api/x?a=1&fassung=original');
  });

  it('erkennt Bilder am MIME-Typ', () => {
    expect(istBildMime('image/heic')).toBe(true);
    expect(istBildMime('image/jpeg')).toBe(true);
    expect(istBildMime('application/pdf')).toBe(false);
    expect(istBildMime(undefined)).toBe(false);
  });
});
