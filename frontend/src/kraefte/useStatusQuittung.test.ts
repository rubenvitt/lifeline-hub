import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { statusQuittungSchluessel, statusQuittungText } from '../kommunikation/rueckgaengig';
import {
  einheitQuittungName,
  materialStatusKurz,
  ohneBeleg,
  ruecknahmeFehlerText,
  statusKurz,
} from './useStatusQuittung';

const KATALOG = [
  { id: 1, label: 'Frei auf Funk', fms_anker: 1 },
  { id: 2, label: 'Hand', fms_anker: null },
];

describe('Statusquittung (LLH-1781, LLH-1986)', () => {
  it('kurzer Status: S-Code mit Anker, sonst das Label, ohne Status ein Strich', () => {
    expect(statusKurz(KATALOG, 1)).toBe('S1');
    expect(statusKurz(KATALOG, 2)).toBe('Hand');
    expect(statusKurz(KATALOG, null)).toBe('—');
    expect(statusKurz(KATALOG, 99)).toBe('—');
  });

  it('Materialstatus mit dem Wort der Oberfläche', () => {
    expect(materialStatusKurz('desinfektion_noetig')).toBe('Desinfektion nötig');
    expect(materialStatusKurz('im_einsatz')).toBe('im Einsatz');
    expect(materialStatusKurz(null)).toBe('—');
  });

  it('Einheit heißt nach dem Funkrufnamen, sonst nach dem Namen', () => {
    expect(einheitQuittungName({ funkrufname: 'Florian 1', name: 'Zug 1' })).toBe('Florian 1');
    expect(einheitQuittungName({ funkrufname: null, name: 'Zug 1' })).toBe('Zug 1');
    expect(einheitQuittungName({ funkrufname: '  ', name: 'Zug 1' })).toBe('Zug 1');
  });

  it('Text „85-1: S2 → S3“ und ein Schlüssel je Art und Kraft', () => {
    expect(statusQuittungText({ name: '85-1', vorher: 'S2', neu: 'S3' })).toBe('85-1: S2 → S3');
    expect(statusQuittungSchluessel('fahrzeug', 10)).not.toBe(
      statusQuittungSchluessel('fahrzeug', 11),
    );
    expect(statusQuittungSchluessel('fahrzeug', 7)).not.toBe(
      statusQuittungSchluessel('personal', 7),
    );
    expect(statusQuittungSchluessel('material', 7)).toBe('lfh-status-quittung-material-7');
  });

  it('ohne Beleg in den Cache', () => {
    const z = ohneBeleg({ id: 1, status_ruecknahme: { gesetzt_at: 'x' } });
    expect(z).toEqual({ id: 1 });
    expect('status_ruecknahme' in z).toBe(false);
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
