import { describe, expect, it } from 'vitest';
import { adressBegriff } from './ortssuche';

describe('adressBegriff (LFH-638)', () => {
  it('liefert den getrimmten Text ab drei Zeichen', () => {
    expect(adressBegriff('  Hauptstraße 12  ')).toBe('Hauptstraße 12');
    expect(adressBegriff('Ulm')).toBe('Ulm');
  });

  it('zu kurz, leer oder zu lang ist keine Adresssuche', () => {
    expect(adressBegriff('')).toBeNull();
    expect(adressBegriff('  Ha ')).toBeNull();
    expect(adressBegriff('x'.repeat(201))).toBeNull();
    expect(adressBegriff('x'.repeat(200))).toBe('x'.repeat(200));
  });

  it('zählt Zeichen, nicht UTF-16-Einheiten', () => {
    expect(adressBegriff('äöü')).toBe('äöü');
    expect(adressBegriff('🏠🏠')).toBeNull();
  });

  it('eine Koordinate ist keine Adresse', () => {
    expect(adressBegriff('51.16040, 10.45140')).toBeNull();
  });
});
