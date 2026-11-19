import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { statusQuittungSchluessel, statusQuittungText } from '../kommunikation/rueckgaengig';
import { ruecknahmeFehlerText, statusKurz } from './useFahrzeugStatusQuittung';

const KATALOG = [
  { id: 1, label: 'Frei auf Funk', fms_anker: 1 },
  { id: 2, label: 'Hand', fms_anker: null },
];

describe('Statusquittung (LLH-1781)', () => {
  it('kurzer Status: S-Code mit Anker, sonst das Label, ohne Status ein Strich', () => {
    expect(statusKurz(KATALOG, 1)).toBe('S1');
    expect(statusKurz(KATALOG, 2)).toBe('Hand');
    expect(statusKurz(KATALOG, null)).toBe('—');
    expect(statusKurz(KATALOG, 99)).toBe('—');
  });

  it('Text „85-1: S2 → S3“ und ein Schlüssel je Fahrzeug', () => {
    expect(statusQuittungText({ rufname: '85-1', vorher: 'S2', neu: 'S3' })).toBe('85-1: S2 → S3');
    expect(statusQuittungSchluessel(10)).not.toBe(statusQuittungSchluessel(11));
  });

  it('veraltet heißt „inzwischen geändert“, sonst der Grund des Servers', () => {
    const veraltet = new ApiError(409, 'veraltet', {
      grund: 'veraltet',
      vomAnwendungsserver: true,
    });
    expect(ruecknahmeFehlerText('85-1', veraltet)).toBe(
      '85-1: Nicht mehr zurückzunehmen, inzwischen geändert.',
    );
    const frist = new ApiError(409, 'nur direkt danach', { vomAnwendungsserver: true });
    expect(ruecknahmeFehlerText('85-1', frist)).toMatch(/^85-1: /);
    expect(ruecknahmeFehlerText('85-1', frist)).not.toMatch(/inzwischen geändert/);
  });
});
