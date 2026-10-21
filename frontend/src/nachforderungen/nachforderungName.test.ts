import { describe, expect, it } from 'vitest';
import { nachforderungKurzname, nachforderungName } from './nachforderungName';

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
