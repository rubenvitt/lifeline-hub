import { describe, expect, it } from 'vitest';
import { einsaetzeMeta, kachelKennung } from './einsatzKachelKern';

describe('kachelKennung', () => {
  it('nimmt die interne Nummer vor der Leitstellennummer', () => {
    expect(kachelKennung({ einsatznummer_intern: 'E-2026-014', leitstellen_nr: '4711' })).toBe(
      'E-2026-014',
    );
  });

  it('fällt auf die Leitstellennummer zurück, wenn die interne leer ist', () => {
    expect(kachelKennung({ einsatznummer_intern: '  ', leitstellen_nr: ' 4711 ' })).toBe('4711');
  });

  it('erfindet keine Nummer — ohne beide ist es null, nie die Datenbank-id', () => {
    expect(kachelKennung({ einsatznummer_intern: null, leitstellen_nr: undefined })).toBeNull();
  });
});

describe('einsaetzeMeta', () => {
  it('nennt beide Mengen', () => {
    expect(einsaetzeMeta(3, 12)).toBe('3 aktiv · 12 abgeschlossen');
  });
});
