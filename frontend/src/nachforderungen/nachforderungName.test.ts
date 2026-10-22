import { describe, expect, it } from 'vitest';
import { adressatText, nachforderungKurzname, nachforderungName } from './nachforderungName';

describe('nachforderungName', () => {
  it('nennt Anzahl und Art, mit Details dahinter', () => {
    expect(nachforderungName({ anzahl: 2, art: 'RTW', bezeichnung: 'Transport aus der UHS' })).toBe(
      '2× RTW — Transport aus der UHS',
    );
  });

  it('ohne Details und ohne Anzahl nur die Art', () => {
    expect(nachforderungName({ anzahl: null, art: 'Sandsäcke' })).toBe('Sandsäcke');
    expect(nachforderungKurzname({ anzahl: 3, art: 'Tauchpumpe' })).toBe('3× Tauchpumpe');
  });
});

describe('adressatText (LLH-1145)', () => {
  it('nennt die Kategorie, mit Bezeichnung dahinter', () => {
    expect(adressatText({ adressat_kategorie: 'leitstelle', adressat_bezeichnung: null })).toBe(
      'Leitstelle',
    );
    expect(
      adressatText({ adressat_kategorie: 'andere_bos', adressat_bezeichnung: 'THW OV Nord' }),
    ).toBe('Andere BOS (THW OV Nord)');
  });
});
