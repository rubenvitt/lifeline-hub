import { describe, expect, it } from 'vitest';
import {
  istBildMime,
  originalDateiname,
  originalPfad,
  originalZugaenglicherName,
} from './anhangFassung';

describe('anhangFassung (LFH-747)', () => {
  it('hängt die Fassung an die Download-Adresse', () => {
    expect(originalPfad('/api/einsaetze/5/etb/40/anhaenge/9')).toBe(
      '/api/einsaetze/5/etb/40/anhaenge/9?fassung=original',
    );
  });

  it('ergänzt einen vorhandenen Query-String', () => {
    expect(originalPfad('/api/x?a=1')).toBe('/api/x?a=1&fassung=original');
  });

  it('benennt das Original unterscheidbar', () => {
    expect(originalDateiname('dach.jpg')).toBe('dach.original.jpg');
    expect(originalDateiname('IMG_0001.HEIC')).toBe('IMG_0001.original.HEIC');
    expect(originalDateiname('foto.final.png')).toBe('foto.final.original.png');
    expect(originalDateiname('ohneendung')).toBe('ohneendung.original');
    expect(originalDateiname('.versteckt')).toBe('.versteckt.original');
  });

  it('baut den zugänglichen Namen aus der Zeilenkennung', () => {
    expect(originalZugaenglicherName('dach.jpg, Schaden S-003')).toBe(
      'Original (mit Standort) herunterladen: dach.jpg, Schaden S-003',
    );
  });

  it('erkennt Bilder am MIME-Typ', () => {
    expect(istBildMime('image/heic')).toBe(true);
    expect(istBildMime('image/jpeg')).toBe(true);
    expect(istBildMime('application/pdf')).toBe(false);
    expect(istBildMime(undefined)).toBe(false);
  });
});
